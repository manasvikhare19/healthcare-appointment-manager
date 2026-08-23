const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const calendarService = require('../services/calendar.service');
const { JWT_SECRET, FRONTEND_URL } = require('../config/env');

const router = express.Router();

// Check if calendar integration is enabled on this backend
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({
      configured: calendarService.isConfigured(),
      redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/calendar/oauth/callback',
    });
  })
);

// Start Google Calendar OAuth connection for logged-in user
router.get(
  '/oauth/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!calendarService.isConfigured()) {
      throw new ApiError(
        400,
        'Google Calendar is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and CALENDAR_ENABLED=true in backend/.env.'
      );
    }
    // Short-lived signed state token carries the user id through Google's redirect securely
    const state = jwt.sign({ userId: req.user.id }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ url: calendarService.getAuthUrl(state) });
  })
);

// Google redirects here after consent
router.get(
  '/oauth/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(`${FRONTEND_URL}/settings?calendar=error&message=${encodeURIComponent(String(error))}`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/settings?calendar=error&message=Missing+code+or+state`);
    }

    let userId;
    try {
      ({ userId } = jwt.verify(String(state), JWT_SECRET));
    } catch {
      return res.redirect(`${FRONTEND_URL}/settings?calendar=error&message=Expired+or+invalid+session`);
    }

    try {
      const tokens = await calendarService.exchangeCodeForTokens(String(code));
      if (tokens.refresh_token) {
        await prisma.user.update({
          where: { id: userId },
          data: { googleRefreshToken: tokens.refresh_token },
        });

        // Automatically sync existing upcoming confirmed appointments to user's Google Calendar!
        calendarService.syncUserAppointments(userId).catch((err) => {
          console.error('[calendar.routes] Auto-sync on connect failed:', err.message);
        });
      }

      res.redirect(`${FRONTEND_URL}/settings?calendar=connected`);
    } catch (err) {
      console.error('[calendar.routes] OAuth token exchange failed:', err.message);
      res.redirect(`${FRONTEND_URL}/settings?calendar=error&message=${encodeURIComponent(err.message)}`);
    }
  })
);

// Disconnect Google Calendar
router.post(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { googleRefreshToken: null },
    });
    res.json({ message: 'Google Calendar disconnected successfully.' });
  })
);

// Manually trigger a calendar sync for the current user's appointments
router.post(
  '/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.googleRefreshToken) {
      throw new ApiError(400, 'Google Calendar is not connected to your account.');
    }

    const syncedCount = await calendarService.syncUserAppointments(req.user.id);
    res.json({ message: `Calendar synced successfully. ${syncedCount} appointment(s) synced.`, count: syncedCount });
  })
);

module.exports = router;
