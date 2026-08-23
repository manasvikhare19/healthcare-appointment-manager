/**
 * Appointment Reminder Job
 * ------------------------
 * Runs periodically to find confirmed appointments coming up in the next 24 hours
 * and sends reminder emails to both the patient and doctor.
 *
 * Idempotency:
 * Checks EmailLog for existing 'REMINDER' logs linked to the appointment so
 * each appointment is only reminded once per 24h window.
 */
const prisma = require('../config/prisma');
const emailService = require('../services/email.service');
const calendarService = require('../services/calendar.service');

async function runAppointmentReminders() {
  const now = new Date();
  const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcoming = await prisma.appointment.findMany({
    where: {
      status: 'CONFIRMED',
      slotStart: {
        gte: now,
        lte: next24Hours,
      },
    },
    include: {
      patient: true,
      doctor: { include: { user: true } },
      emailLogs: {
        where: { type: 'REMINDER' },
      },
    },
  });

  let sentCount = 0;

  for (const appt of upcoming) {
    // If a reminder was already dispatched in this window, skip to ensure idempotency
    if (appt.emailLogs && appt.emailLogs.length > 0) {
      continue;
    }

    const gcalLink = calendarService.generateGoogleCalendarLink({
      summary: `Consultation: Dr. ${appt.doctor.user.name}`,
      description: `Doctor: Dr. ${appt.doctor.user.name} (${appt.doctor.specialisation})\nUrgency: ${appt.urgencyLevel || 'Normal'}`,
      start: appt.slotStart,
      end: appt.slotEnd,
    });

    // 1. Patient reminder
    await emailService
      .queueAndSend({
        toEmail: appt.patient.email,
        relatedAppointmentId: appt.id,
        type: 'REMINDER',
        ...emailService.templates.reminderPatient(
          appt.patient.name,
          appt.doctor.user.name,
          appt.doctor.specialisation,
          appt.slotStart,
          gcalLink
        ),
      })
      .catch((err) => console.error(`[appointmentReminder.job] patient reminder failed for ${appt.id}:`, err.message));

    // 2. Doctor reminder
    await emailService
      .queueAndSend({
        toEmail: appt.doctor.user.email,
        relatedAppointmentId: appt.id,
        type: 'REMINDER',
        ...emailService.templates.reminderDoctor(
          appt.doctor.user.name,
          appt.patient.name,
          appt.slotStart,
          appt.urgencyLevel
        ),
      })
      .catch((err) => console.error(`[appointmentReminder.job] doctor reminder failed for ${appt.id}:`, err.message));

    sentCount++;
  }

  return sentCount;
}

module.exports = { runAppointmentReminders };
