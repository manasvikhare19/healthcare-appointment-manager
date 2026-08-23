const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const slotService = require('../services/slot.service');
const emailService = require('../services/email.service');
const { EMAIL_PROVIDER } = require('../config/env');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

const createDoctorSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  specialisation: z.string().min(2),
  bio: z.string().optional(),
  slotDurationMinutes: z.number().int().min(5).max(240).default(30),
  workStartMinutes: z.number().int().min(0).max(1440).default(540),
  workEndMinutes: z.number().int().min(0).max(1440).default(1020),
  workingDays: z.string().default('MON,TUE,WED,THU,FRI'),
});

router.post(
  '/doctors',
  asyncHandler(async (req, res) => {
    const parsed = createDoctorSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input', parsed.error.flatten());
    const d = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email: d.email } });
    if (existing) throw new ApiError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(d.password, 10);
    const doctorProfile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: d.name, email: d.email, passwordHash, role: 'DOCTOR' },
      });
      return tx.doctorProfile.create({
        data: {
          userId: user.id,
          specialisation: d.specialisation,
          bio: d.bio,
          slotDurationMinutes: d.slotDurationMinutes,
          workStartMinutes: d.workStartMinutes,
          workEndMinutes: d.workEndMinutes,
          workingDays: d.workingDays,
        },
        include: { user: true },
      });
    });

    res.status(201).json(doctorProfile);
  })
);

router.get(
  '/doctors',
  asyncHandler(async (req, res) => {
    const doctors = await prisma.doctorProfile.findMany({ include: { user: true, leaves: true } });
    res.json(doctors);
  })
);

const updateDoctorSchema = createDoctorSchema.partial().omit({ password: true });

router.patch(
  '/doctors/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateDoctorSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input', parsed.error.flatten());
    const { name, email, ...profileFields } = parsed.data;

    const doctor = await prisma.doctorProfile.findUnique({ where: { id: req.params.id } });
    if (!doctor) throw new ApiError(404, 'Doctor not found');

    if (name || email) {
      await prisma.user.update({ where: { id: doctor.userId }, data: { ...(name && { name }), ...(email && { email }) } });
    }
    const updated = await prisma.doctorProfile.update({
      where: { id: req.params.id },
      data: profileFields,
      include: { user: true },
    });
    res.json(updated);
  })
);

// Mark a doctor on leave for a date. Any existing HELD/CONFIRMED
// appointments that day are cascaded to LEAVE_CANCELLED and patients notified.
router.post(
  '/doctors/:id/leave',
  asyncHandler(async (req, res) => {
    const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input — date must be YYYY-MM-DD');
    const { date, reason } = parsed.data;

    const doctor = await prisma.doctorProfile.findUnique({ where: { id: req.params.id } });
    if (!doctor) throw new ApiError(404, 'Doctor not found');

    await prisma.doctorLeave.upsert({
      where: { doctorId_date: { doctorId: doctor.id, date } },
      create: { doctorId: doctor.id, date, reason },
      update: { reason },
    });

    const affectedCount = await slotService.handleLeaveConflicts({ doctorId: doctor.id, dateStr: date, reason });

    res.status(201).json({ message: 'Leave recorded', affectedAppointments: affectedCount });
  })
);

router.delete(
  '/doctors/:id/leave/:date',
  asyncHandler(async (req, res) => {
    await prisma.doctorLeave.delete({
      where: { doctorId_date: { doctorId: req.params.id, date: req.params.date } },
    }).catch(() => {});
    res.json({ message: 'Leave removed' });
  })
);

router.get(
  '/email-logs',
  asyncHandler(async (req, res) => {
    const logs = await prisma.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(logs);
  })
);

// Check email service connection status
router.get(
  '/email-status',
  asyncHandler(async (req, res) => {
    const status = await emailService.verifyConnection();
    res.json(status);
  })
);

// Send a test email to verify credentials
router.post(
  '/test-email',
  asyncHandler(async (req, res) => {
    const schema = z.object({ toEmail: z.string().email() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Valid recipient email is required');

    const providerName = EMAIL_PROVIDER === 'gmail' ? 'Gmail (App Password)' : EMAIL_PROVIDER;
    const template = emailService.templates.testEmail(parsed.data.toEmail, providerName);

    const log = await emailService.queueAndSend({
      toEmail: parsed.data.toEmail,
      subject: template.subject,
      body: template.body,
      type: 'BOOKING_CONFIRMATION',
    });

    res.json({
      message: log.status === 'SENT' ? 'Test email dispatched successfully' : 'Test email failed to send',
      log,
    });
  })
);

// Manually retry a specific failed email log
router.post(
  '/email-logs/:id/retry',
  asyncHandler(async (req, res) => {
    const log = await prisma.emailLog.findUnique({ where: { id: req.params.id } });
    if (!log) throw new ApiError(404, 'Email log not found');

    const updated = await emailService.attemptSend(log);
    res.json({ message: `Email status: ${updated.status}`, log: updated });
  })
);

module.exports = router;
