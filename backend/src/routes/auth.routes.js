const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  // Only PATIENT can self-register. Doctor and Admin accounts are
  // provisioned by an existing admin (see admin.routes.js) — this is
  // intentional: a clinic shouldn't let random signups grant themselves
  // doctor/admin access.
});

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input', parsed.error.flatten());
    const { name, email, password, phone } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError(409, 'An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, phone, passwordHash, role: 'PATIENT' },
    });

    // Send welcome email notification
    emailService
      .queueAndSend({
        toEmail: user.email,
        type: 'SECURITY_ALERT',
        ...emailService.templates.loginAlert(user.name, user.email, user.role),
      })
      .catch((err) => console.error('[auth.routes] Welcome notification email failed:', err.message));

    res.status(201).json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, calendarConnected: false },
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const schema = z.object({ email: z.string().email(), password: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'Invalid input');

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) throw new ApiError(401, 'Invalid email or password');

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) throw new ApiError(401, 'Invalid email or password');

    // Dispatch a real-time login alert notification to the user's email
    emailService
      .queueAndSend({
        toEmail: user.email,
        type: 'SECURITY_ALERT',
        ...emailService.templates.loginAlert(user.name, user.email, user.role),
      })
      .catch((err) => console.error('[auth.routes] Login notification email failed:', err.message));

    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, calendarConnected: !!user.googleRefreshToken },
    });
  })
);

const emailService = require('../services/email.service');
const { EMAIL_PROVIDER } = require('../config/env');

// Lets the frontend re-check "am I still logged in / is Calendar connected"
// without a full re-login — used by the Settings page after the OAuth
// redirect comes back.
router.get(
  '/me',
  require('../middleware/auth').requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new ApiError(404, 'User not found');
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, calendarConnected: !!user.googleRefreshToken });
  })
);

// Allows any authenticated user (Patient, Doctor, Admin) to send a test verification email
router.post(
  '/test-email',
  require('../middleware/auth').requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new ApiError(404, 'User not found');
    const targetEmail = req.body.toEmail || user.email;
    const log = await emailService.queueAndSend({
      toEmail: targetEmail,
      type: 'REMINDER',
      ...emailService.templates.testEmail(targetEmail, EMAIL_PROVIDER),
    });
    res.json({ success: true, message: `Test email dispatched to ${targetEmail}`, log });
  })
);

module.exports = router;
