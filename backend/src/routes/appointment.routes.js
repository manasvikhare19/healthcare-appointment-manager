const express = require('express');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const slotService = require('../services/slot.service');
const llmService = require('../services/llm.service');

const router = express.Router();
router.use(requireAuth);

// Step 1: hold a slot (atomic, race-safe — see slot.service.js)
router.post(
  '/hold',
  requireRole('PATIENT'),
  asyncHandler(async (req, res) => {
    const schema = z.object({ doctorId: z.string().min(1), slotStart: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'doctorId and slotStart are required');

    const appointment = await slotService.holdSlot({
      doctorId: parsed.data.doctorId,
      patientId: req.user.id,
      slotStart: parsed.data.slotStart,
    });
    res.status(201).json({
      appointment,
      holdExpiresInMinutes: Number(process.env.SLOT_HOLD_MINUTES || 5),
      message: 'Slot held. Submit your symptoms and confirm before the hold expires.',
    });
  })
);

// Step 2: submit symptoms -> get AI pre-visit summary preview (doesn't confirm yet)
router.post(
  '/:id/pre-visit-summary',
  requireRole('PATIENT'),
  asyncHandler(async (req, res) => {
    const schema = z.object({ symptomsText: z.string().min(3) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'symptomsText is required');

    const appointment = await prisma.appointment.findUnique({ where: { id: req.params.id } });
    if (!appointment || appointment.patientId !== req.user.id) throw new ApiError(404, 'Appointment not found');
    if (appointment.status !== 'HELD') throw new ApiError(409, `Appointment is ${appointment.status}`);

    const summary = await llmService.generatePreVisitSummary(parsed.data.symptomsText);
    res.json({ symptomsText: parsed.data.symptomsText, preVisitSummary: summary });
  })
);

// Step 3: confirm — locks in the symptoms + summary and finalizes the booking
router.post(
  '/:id/confirm',
  requireRole('PATIENT'),
  asyncHandler(async (req, res) => {
    const schema = z.object({
      symptomsText: z.string().min(3),
      preVisitSummary: z.object({
        urgency: z.enum(['Low', 'Medium', 'High']),
        chiefComplaint: z.string(),
        suggestedQuestions: z.array(z.string()).optional(),
        patientAnswers: z.string().optional(),
      }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input', parsed.error.flatten());

    const appointment = await slotService.confirmAppointment({
      appointmentId: req.params.id,
      patientId: req.user.id,
      symptomsText: parsed.data.symptomsText,
      preVisitSummary: parsed.data.preVisitSummary,
    });
    res.json(appointment);
  })
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const where =
      req.user.role === 'PATIENT'
        ? { patientId: req.user.id }
        : req.user.role === 'DOCTOR'
        ? { doctor: { userId: req.user.id } }
        : {};
    const appointments = await prisma.appointment.findMany({
      where,
      include: {
        doctor: { include: { user: { select: { name: true, email: true } } } },
        patient: { select: { name: true, email: true } },
      },
      orderBy: { slotStart: 'desc' },
    });
    res.json(
      appointments.map((a) => ({
        ...a,
        preVisitSummary: a.preVisitSummary ? JSON.parse(a.preVisitSummary) : null,
        postVisitSummary: a.postVisitSummary ? JSON.parse(a.postVisitSummary) : null,
      }))
    );
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const reason = req.body?.reason;
    await slotService.cancelAppointment({
      appointmentId: req.params.id,
      actorId: req.user.id,
      actorRole: req.user.role,
      reason,
    });
    res.json({ message: 'Appointment cancelled' });
  })
);

// Reschedule appointment to a new slot
router.post(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const schema = z.object({ newSlotStart: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'newSlotStart is required');

    const appointment = await slotService.rescheduleAppointment({
      appointmentId: req.params.id,
      actorId: req.user.id,
      actorRole: req.user.role,
      newSlotStart: parsed.data.newSlotStart,
    });
    res.json({ message: 'Appointment rescheduled successfully', appointment });
  })
);

module.exports = router;
