/**
 * Google Calendar Service
 * -----------------------
 * Manages calendar events for patients and doctors:
 * 1. OAuth 2.0 Integration: per-user refresh token stored on User model.
 * 2. Event Lifecycle: create on booking, update on reschedule, delete on cancellation.
 * 3. Retroactive Sync: syncs all existing upcoming confirmed appointments when a user connects.
 * 4. Instant Web Calendar Link: generates 1-click 'Add to Google Calendar' links.
 *
 * Resilience Pattern:
 * All calendar operations are non-blocking and fail-safe. If Google Calendar API is
 * unavailable, credentials are unset, or user has not linked their Google account,
 * the operations resolve gracefully without breaking the primary booking flow.
 */
const { google } = require('googleapis');
const prisma = require('../config/prisma');
const {
  CALENDAR_ENABLED,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = require('../config/env');

function isConfigured() {
  return Boolean(CALENDAR_ENABLED && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function getOAuthClient() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar',
    ],
    state,
  });
}

async function exchangeCodeForTokens(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, ... }
}

function getCalendarClient(googleRefreshToken) {
  if (!googleRefreshToken) return null;
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: googleRefreshToken });
  return google.calendar({ version: 'v3', auth: client });
}

/**
 * Format a Date object into Google Calendar web link format (YYYYMMDDTHHmmssZ)
 */
function toGCalDateTime(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Generates an instant, direct "Add to Google Calendar" web link
 * (Works immediately in browser without requiring OAuth backend connection).
 */
function generateGoogleCalendarLink({ summary, description, start, end, location }) {
  const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const startStr = toGCalDateTime(start);
  const endStr = toGCalDateTime(end);
  const params = new URLSearchParams({
    text: summary || 'Clinic Appointment',
    dates: `${startStr}/${endStr}`,
    details: description || 'Consultation at Meridian Clinic',
    location: location || 'Meridian Clinic & Consultation Suite',
  });
  return `${baseUrl}&${params.toString()}`;
}

/**
 * Create an event on one user's Google Calendar for an appointment.
 * @returns {Promise<string|null>} created event id or null
 */
async function createEvent({ googleRefreshToken, summary, description, start, end, attendeeEmail }) {
  if (!isConfigured() || !googleRefreshToken) return null;
  try {
    const cal = getCalendarClient(googleRefreshToken);
    const res = await cal.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: summary || 'Medical Consultation',
        description: description || 'Scheduled appointment at Meridian Clinic',
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end).toISOString() },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : undefined,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 },
          ],
        },
      },
    });
    return res.data.id;
  } catch (err) {
    console.error('[calendar.service] createEvent failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Update an existing event on user's Google Calendar (used during reschedule).
 * @returns {Promise<boolean>}
 */
async function updateEvent({ googleRefreshToken, eventId, summary, description, start, end }) {
  if (!isConfigured() || !googleRefreshToken || !eventId) return false;
  try {
    const cal = getCalendarClient(googleRefreshToken);
    const patchBody = {
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
    };
    if (summary) patchBody.summary = summary;
    if (description) patchBody.description = description;

    await cal.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: patchBody,
    });
    return true;
  } catch (err) {
    console.error('[calendar.service] updateEvent failed (non-fatal):', err.message);
    return false;
  }
}

/**
 * Delete an event from user's Google Calendar (used on cancellation / doctor leave).
 * @returns {Promise<boolean>}
 */
async function deleteEvent({ googleRefreshToken, eventId }) {
  if (!isConfigured() || !googleRefreshToken || !eventId) return false;
  try {
    const cal = getCalendarClient(googleRefreshToken);
    await cal.events.delete({ calendarId: 'primary', eventId });
    return true;
  } catch (err) {
    console.error('[calendar.service] deleteEvent failed (non-fatal):', err.message);
    return false;
  }
}

/**
 * Sync all upcoming confirmed appointments for a user who just connected Google Calendar.
 */
async function syncUserAppointments(userId) {
  if (!isConfigured()) return 0;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { doctorProfile: true },
  });
  if (!user || !user.googleRefreshToken) return 0;

  const now = new Date();
  let appointments = [];

  if (user.role === 'PATIENT') {
    appointments = await prisma.appointment.findMany({
      where: { patientId: userId, status: 'CONFIRMED', slotStart: { gte: now } },
      include: { doctor: { include: { user: true } }, calendarEvent: true },
    });
  } else if (user.role === 'DOCTOR' && user.doctorProfile) {
    appointments = await prisma.appointment.findMany({
      where: { doctorId: user.doctorProfile.id, status: 'CONFIRMED', slotStart: { gte: now } },
      include: { patient: true, doctor: { include: { user: true } }, calendarEvent: true },
    });
  }

  let syncedCount = 0;
  for (const appt of appointments) {
    try {
      const isPatient = user.role === 'PATIENT';
      const eventSummary = isPatient
        ? `Appointment with Dr. ${appt.doctor.user.name}`
        : `Consultation with ${appt.patient.name}`;
      const description = `Meridian Clinic Consultation\nUrgency: ${appt.urgencyLevel || 'Standard'}\n${appt.symptomsText ? `Symptoms: ${appt.symptomsText}` : ''}`;

      const eventId = await createEvent({
        googleRefreshToken: user.googleRefreshToken,
        summary: eventSummary,
        description,
        start: appt.slotStart,
        end: appt.slotEnd,
      });

      if (eventId) {
        syncedCount++;
        await prisma.calendarEvent.upsert({
          where: { appointmentId: appt.id },
          create: {
            appointmentId: appt.id,
            patientEventId: isPatient ? eventId : null,
            doctorEventId: !isPatient ? eventId : null,
          },
          update: isPatient ? { patientEventId: eventId } : { doctorEventId: eventId },
        });
      }
    } catch (e) {
      console.error(`[calendar.service] sync error for appt ${appt.id}:`, e.message);
    }
  }

  return syncedCount;
}

module.exports = {
  isConfigured,
  getAuthUrl,
  exchangeCodeForTokens,
  createEvent,
  updateEvent,
  deleteEvent,
  generateGoogleCalendarLink,
  syncUserAppointments,
};

