const express = require('express');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const slotService = require('../services/slot.service');
const llmService = require('../services/llm.service');
const emailService = require('../services/email.service');

const router = express.Router();

// --- Public: search doctors (patients don't need to be logged in to browse) ---
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { specialisation } = req.query;
    const doctors = await prisma.doctorProfile.findMany({
      where: specialisation ? { specialisation: { contains: String(specialisation) } } : undefined,
      include: { user: { select: { id: true, name: true } } },
    });
    res.json(doctors);
  })
);

router.get(
  '/:id/slots',
  asyncHandler(async (req, res) => {
    const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw new ApiError(400, 'date query param required as YYYY-MM-DD');
    const result = await slotService.getAvailableSlots(req.params.id, parsed.data.date);
    res.json(result);
  })
);

// --- Doctor-self routes (require DOCTOR role) ---
router.use('/me', requireAuth, requireRole('DOCTOR'));

router.get(
  '/me/profile',
  asyncHandler(async (req, res) => {
    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: req.user.id },
      include: { user: true, leaves: true },
    });
    if (!profile) throw new ApiError(404, 'Doctor profile not found for this account');
    res.json(profile);
  })
);

/** Upcoming confirmed appointments with pre-visit AI summaries, sorted by urgency then time. */
router.get(
  '/me/appointments',
  asyncHandler(async (req, res) => {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) throw new ApiError(404, 'Doctor profile not found');

    const status = req.query.status ? String(req.query.status) : 'CONFIRMED';
    const appointments = await prisma.appointment.findMany({
      where: { doctorId: profile.id, status },
      include: { patient: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: [{ slotStart: 'asc' }],
    });

    const urgencyRank = { High: 0, Medium: 1, Low: 2 };
    appointments.sort((a, b) => (urgencyRank[a.urgencyLevel] ?? 3) - (urgencyRank[b.urgencyLevel] ?? 3));

    res.json(
      appointments.map((a) => ({
        ...a,
        preVisitSummary: a.preVisitSummary ? JSON.parse(a.preVisitSummary) : null,
      }))
    );
  })
);

const completeSchema = z.object({
  doctorNotes: z.string().min(3),
  prescriptionText: z.string().optional().default(''),
});

/**
 * Doctor submits post-visit notes + prescription. This generates the
 * patient-friendly post-visit summary via the LLM, marks the appointment
 * COMPLETED, and schedules medication reminders parsed from the
 * prescription's stated frequency.
 */
router.post(
  '/me/appointments/:id/complete',
  asyncHandler(async (req, res) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input', parsed.error.flatten());
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id } });
    if (!profile) throw new ApiError(404, 'Doctor profile not found');

    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { patient: true, doctor: { include: { user: true } } },
    });
    if (!appointment || appointment.doctorId !== profile.id) throw new ApiError(404, 'Appointment not found');
    if (appointment.status !== 'CONFIRMED') throw new ApiError(409, `Appointment is ${appointment.status}, cannot complete`);

    const { doctorNotes, prescriptionText } = parsed.data;
    const postVisitSummary = await llmService.generatePostVisitSummary(
      `Clinical notes: ${doctorNotes}\nPrescription: ${prescriptionText}`
    );

    const updated = await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'COMPLETED', doctorNotes, prescriptionText, postVisitSummary: JSON.stringify(postVisitSummary) },
    });

    // Schedule medication reminders from whatever the LLM (or fallback)
    // extracted. We keep this defensive — malformed items are skipped
    // rather than crashing the whole completion flow.
    const schedule = Array.isArray(postVisitSummary.medicationSchedule) ? postVisitSummary.medicationSchedule : [];
    for (const item of schedule) {
      if (!item?.medication) continue;
      const frequencyHours = parseFrequencyHours(item.instructions) || 8;
      await prisma.medicationReminder.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          medicationText: `${item.medication}${item.instructions ? ` — ${item.instructions}` : ''}`,
          frequencyHours,
          nextRunAt: new Date(Date.now() + frequencyHours * 3600000),
          remainingCount: 10,
        },
      });
    }

    emailService
      .queueAndSend({
        toEmail: appointment.patient.email,
        relatedAppointmentId: appointment.id,
        type: 'BOOKING_CONFIRMATION',
        ...emailService.templates.visitSummaryPatient(
          appointment.patient.name,
          appointment.doctor.user.name,
          postVisitSummary.summary,
          postVisitSummary.medicationSchedule,
          postVisitSummary.followUpSteps,
          postVisitSummary.warningSigns
        ),
      })
      .catch((e) => console.error('email queue failed', e.message));

    res.json({ ...updated, postVisitSummary });
  })
);

/**
 * Direct doctor-to-patient message/email endpoint.
 * Allows the doctor to send a custom care message or consultation followup
 * straight to the patient's email from the Doctor Dashboard.
 */
router.post(
  '/me/appointments/:id/message',
  asyncHandler(async (req, res) => {
    const { subject, message } = req.body;
    if (!message || message.trim().length === 0) {
      throw new ApiError(400, 'Message cannot be empty');
    }

    const profile = await prisma.doctorProfile.findUnique({
      where: { userId: req.user.id },
      include: { user: true },
    });
    if (!profile) throw new ApiError(404, 'Doctor profile not found');

    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params.id },
      include: { patient: true },
    });
    if (!appointment || appointment.doctorId !== profile.id) {
      throw new ApiError(404, 'Appointment not found');
    }

    const mailSubject = subject?.trim() || `Message from Dr. ${profile.user.name} — Meridian Clinic`;
    const mailBody = `
      <p>Hello <b>${appointment.patient.name}</b>,</p>
      <p>Dr. <b>${profile.user.name}</b> (${profile.specialisation}) has sent you a direct message regarding your consultation:</p>
      <div style="background: #f0fdf4; border-left: 4px solid #0d9488; padding: 14px 18px; margin: 16px 0; border-radius: 6px; font-size: 14px; line-height: 1.6;">
        ${message.replace(/\n/g, '<br/>')}
      </div>
      <p style="font-size: 13px; color: #64748b;">You can reply to this email or visit your patient portal to book or manage your appointments.</p>
    `;

    const log = await emailService.queueAndSend({
      toEmail: appointment.patient.email,
      relatedAppointmentId: appointment.id,
      type: 'BOOKING_CONFIRMATION',
      subject: mailSubject,
      body: mailBody,
    });

    res.json({ success: true, message: `Email sent to ${appointment.patient.email}`, log });
  })
);

/** Very small natural-language frequency parser: "every 8 hours" / "twice a day" / "once daily" etc. */
function parseFrequencyHours(instructions = '') {
  const lower = instructions.toLowerCase();
  const everyNHours = lower.match(/every\s+(\d+)\s*hours?/);
  if (everyNHours) return Number(everyNHours[1]);
  if (/three times a day|thrice/.test(lower)) return 8;
  if (/twice a day|two times a day/.test(lower)) return 12;
  if (/once a day|once daily|every day/.test(lower)) return 24;
  return null;
}

module.exports = router;
