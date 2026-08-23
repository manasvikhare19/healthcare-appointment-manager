/**
 * Slot / Booking Service
 * ----------------------
 * Core concurrency control, double-booking prevention, and lifecycle state manager:
 *
 * 1. Double-Booking Prevention:
 *    SlotLock has a DB UNIQUE(doctorId, slotStart) constraint. Two simultaneous requests
 *    attempting to hold or book the same slot will result in one succeeding while the other
 *    is rejected with unique constraint violation (P2002). We never rely on an unsafe
 *    application-level check-then-write pattern.
 *
 * 2. Slot-Hold Mechanism:
 *    When a patient selects a slot, an atomic HELD lock is created with an expiration
 *    window (SLOT_HOLD_MINUTES). The background cleanup job releases abandoned holds.
 *
 * 3. Doctor Leave Conflict Handling:
 *    When leave is scheduled for a date with existing bookings, affected appointments
 *    are transitioned to LEAVE_CANCELLED, locks are removed, and patients are notified.
 *
 * 4. Dual-Party Notifications & Calendar Sync:
 *    Confirmations, cancellations, and reschedules update both patient and doctor
 *    via email and Google Calendar events.
 */
const prisma = require('../config/prisma');
const { ApiError } = require('../utils/asyncHandler');
const { generateDaySlots, toDateStr } = require('../utils/slots');
const { SLOT_HOLD_MINUTES } = require('../config/env');
const emailService = require('./email.service');
const calendarService = require('./calendar.service');

/** Available slots for a doctor on a date, after removing leave days and taken slots. */
async function getAvailableSlots(doctorId, dateStr) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const leave = await prisma.doctorLeave.findUnique({ where: { doctorId_date: { doctorId, date: dateStr } } });
  if (leave) return { onLeave: true, reason: leave.reason, slots: [] };

  const candidates = generateDaySlots(doctor, dateStr);
  if (candidates.length === 0) return { onLeave: false, slots: [] };

  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59`);
  const taken = await prisma.slotLock.findMany({
    where: { doctorId, slotStart: { gte: dayStart, lte: dayEnd } },
    select: { slotStart: true, status: true, expiresAt: true },
  });
  const now = new Date();
  const takenTimes = new Set(
    taken
      .filter((t) => t.status === 'CONFIRMED' || (t.status === 'HELD' && t.expiresAt && t.expiresAt > now))
      .map((t) => t.slotStart.toISOString())
  );

  const slots = candidates
    .filter((s) => s.start.toISOString() > new Date().toISOString()) // no past slots
    .filter((s) => !takenTimes.has(s.start.toISOString()))
    .map((s) => ({ start: s.start, end: s.end }));

  return { onLeave: false, slots };
}

/**
 * Step 1 of booking: atomically reserve a slot for SLOT_HOLD_MINUTES.
 * Throws ApiError(409) if the slot is already held/confirmed.
 */
async function holdSlot({ doctorId, patientId, slotStart }) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, 'Doctor not found');

  const start = new Date(slotStart);
  const end = new Date(start.getTime() + doctor.slotDurationMinutes * 60000);
  const dateStr = toDateStr(start);

  const leave = await prisma.doctorLeave.findUnique({ where: { doctorId_date: { doctorId, date: dateStr } } });
  if (leave) throw new ApiError(409, 'Doctor is on leave that day');

  try {
    const result = await prisma.$transaction(async (tx) => {
      // The INSERT is the atomic operation guarded by DB unique constraint
      const appointment = await tx.appointment.create({
        data: { patientId, doctorId, slotStart: start, slotEnd: end, status: 'HELD' },
      });
      const lock = await tx.slotLock.create({
        data: {
          doctorId,
          slotStart: start,
          status: 'HELD',
          appointmentId: appointment.id,
          expiresAt: new Date(Date.now() + SLOT_HOLD_MINUTES * 60000),
        },
      });
      return { appointment, lock };
    });
    return result.appointment;
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'This slot was just taken by another patient. Please choose a different time.');
    }
    throw err;
  }
}

/**
 * Step 2: attach the symptom form + LLM pre-visit summary and confirm
 * the hold into a confirmed booking.
 */
async function confirmAppointment({ appointmentId, patientId, symptomsText, preVisitSummary }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { user: true } }, patient: true, slotLock: true },
  });
  if (!appointment) throw new ApiError(404, 'Appointment not found');
  if (appointment.patientId !== patientId) throw new ApiError(403, 'Not your appointment');
  if (appointment.status !== 'HELD') throw new ApiError(409, `Appointment is ${appointment.status}, cannot confirm`);
  if (appointment.slotLock?.expiresAt && appointment.slotLock.expiresAt < new Date()) {
    throw new ApiError(410, 'Your hold on this slot expired. Please choose a slot again.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CONFIRMED',
        symptomsText,
        preVisitSummary: JSON.stringify(preVisitSummary),
        urgencyLevel: preVisitSummary.urgency,
      },
    });
    await tx.slotLock.update({
      where: { appointmentId },
      data: { status: 'CONFIRMED', expiresAt: null },
    });
    return appt;
  });

  // Generate 1-click Google Calendar Web Link
  const gcalLink = calendarService.generateGoogleCalendarLink({
    summary: `Consultation: Dr. ${appointment.doctor.user.name}`,
    description: `Doctor: Dr. ${appointment.doctor.user.name} (${appointment.doctor.specialisation})\nUrgency: ${preVisitSummary.urgency}\nSymptoms: ${symptomsText}`,
    start: appointment.slotStart,
    end: appointment.slotEnd,
  });

  // Dual-Party Email Notifications
  emailService
    .queueAndSend({
      toEmail: appointment.patient.email,
      relatedAppointmentId: appointmentId,
      type: 'BOOKING_CONFIRMATION',
      ...emailService.templates.bookingConfirmationPatient(
        appointment.patient.name,
        appointment.doctor.user.name,
        appointment.doctor.specialisation,
        appointment.slotStart,
        gcalLink
      ),
    })
    .catch((e) => console.error('[slot.service] Patient booking email failed:', e.message));

  emailService
    .queueAndSend({
      toEmail: appointment.doctor.user.email,
      relatedAppointmentId: appointmentId,
      type: 'BOOKING_CONFIRMATION',
      ...emailService.templates.bookingConfirmationDoctor(
        appointment.doctor.user.name,
        appointment.patient.name,
        appointment.slotStart,
        preVisitSummary.urgency,
        preVisitSummary.chiefComplaint
      ),
    })
    .catch((e) => console.error('[slot.service] Doctor booking email failed:', e.message));

  // Sync Google Calendar API events
  syncCalendarForAppointment(appointmentId).catch((e) => console.error('[slot.service] calendar sync failed:', e.message));

  return updated;
}

/** Sync Google Calendar events for both patient and doctor */
async function syncCalendarForAppointment(appointmentId) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { user: true } }, patient: true },
  });
  if (!appointment || appointment.status !== 'CONFIRMED') return;

  const patientSummary = `Appointment: Dr. ${appointment.doctor.user.name} (${appointment.doctor.specialisation})`;
  const doctorSummary = `Consultation: ${appointment.patient.name} (${appointment.urgencyLevel || 'Normal'} urgency)`;
  const description = `Meridian Clinic Consultation\nUrgency: ${appointment.urgencyLevel || 'Normal'}\n${appointment.symptomsText ? `Symptoms: ${appointment.symptomsText}` : ''}`;

  const [patientEventId, doctorEventId] = await Promise.all([
    calendarService.createEvent({
      googleRefreshToken: appointment.patient.googleRefreshToken,
      summary: patientSummary,
      description,
      start: appointment.slotStart,
      end: appointment.slotEnd,
    }),
    calendarService.createEvent({
      googleRefreshToken: appointment.doctor.user.googleRefreshToken,
      summary: doctorSummary,
      description,
      start: appointment.slotStart,
      end: appointment.slotEnd,
    }),
  ]);

  if (patientEventId || doctorEventId) {
    await prisma.calendarEvent.upsert({
      where: { appointmentId },
      create: { appointmentId, patientEventId, doctorEventId },
      update: {
        ...(patientEventId && { patientEventId }),
        ...(doctorEventId && { doctorEventId }),
      },
    });
  }
}

/**
 * Reschedule an appointment to a new slot.
 * Ensures concurrency safety via unique SlotLock constraint, updates calendar events,
 * and sends reschedule notifications to both patient and doctor.
 */
async function rescheduleAppointment({ appointmentId, actorId, actorRole, newSlotStart }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { user: true } }, patient: true, calendarEvent: true, slotLock: true },
  });
  if (!appointment) throw new ApiError(404, 'Appointment not found');

  const isOwner = appointment.patientId === actorId || appointment.doctor.userId === actorId;
  if (!isOwner && actorRole !== 'ADMIN') {
    throw new ApiError(403, 'Not authorized to reschedule this appointment');
  }

  if (['CANCELLED', 'LEAVE_CANCELLED', 'COMPLETED'].includes(appointment.status)) {
    throw new ApiError(409, `Cannot reschedule an appointment that is ${appointment.status}`);
  }

  const doctor = appointment.doctor;
  const newStart = new Date(newSlotStart);
  const newEnd = new Date(newStart.getTime() + doctor.slotDurationMinutes * 60000);
  const newDateStr = toDateStr(newStart);

  // Check if doctor is on leave on new date
  const leave = await prisma.doctorLeave.findUnique({
    where: { doctorId_date: { doctorId: doctor.id, date: newDateStr } },
  });
  if (leave) throw new ApiError(409, 'Doctor is on leave on the selected date');

  const oldSlotStart = appointment.slotStart;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Delete old slot lock
      await tx.slotLock.deleteMany({ where: { appointmentId } });

      // 2. Insert new slot lock (atomic conflict check)
      await tx.slotLock.create({
        data: {
          doctorId: doctor.id,
          slotStart: newStart,
          status: 'CONFIRMED',
          appointmentId: appointment.id,
          expiresAt: null,
        },
      });

      // 3. Update appointment times
      return tx.appointment.update({
        where: { id: appointmentId },
        data: { slotStart: newStart, slotEnd: newEnd, status: 'CONFIRMED' },
        include: { doctor: { include: { user: true } }, patient: true, calendarEvent: true },
      });
    });

    // 4. Update Google Calendar Events
    if (updated.calendarEvent) {
      if (updated.calendarEvent.patientEventId && appointment.patient.googleRefreshToken) {
        calendarService
          .updateEvent({
            googleRefreshToken: appointment.patient.googleRefreshToken,
            eventId: updated.calendarEvent.patientEventId,
            start: newStart,
            end: newEnd,
          })
          .catch((e) => console.error('[slot.service] update patient calendar failed:', e.message));
      }
      if (updated.calendarEvent.doctorEventId && appointment.doctor.user.googleRefreshToken) {
        calendarService
          .updateEvent({
            googleRefreshToken: appointment.doctor.user.googleRefreshToken,
            eventId: updated.calendarEvent.doctorEventId,
            start: newStart,
            end: newEnd,
          })
          .catch((e) => console.error('[slot.service] update doctor calendar failed:', e.message));
      }
    } else {
      // Attempt to create calendar events if not already present
      syncCalendarForAppointment(appointmentId).catch(() => {});
    }

    // 5. Generate updated Google Calendar link
    const gcalLink = calendarService.generateGoogleCalendarLink({
      summary: `Consultation: Dr. ${appointment.doctor.user.name}`,
      description: `Rescheduled Consultation\nDoctor: Dr. ${appointment.doctor.user.name} (${appointment.doctor.specialisation})\nUrgency: ${appointment.urgencyLevel || 'Normal'}`,
      start: newStart,
      end: newEnd,
    });

    // 6. Dual-Party Reschedule Emails
    emailService
      .queueAndSend({
        toEmail: appointment.patient.email,
        relatedAppointmentId: appointmentId,
        type: 'BOOKING_CONFIRMATION',
        ...emailService.templates.reschedulePatient(
          appointment.patient.name,
          appointment.doctor.user.name,
          oldSlotStart,
          newStart,
          gcalLink
        ),
      })
      .catch((e) => console.error('[slot.service] Patient reschedule email failed:', e.message));

    emailService
      .queueAndSend({
        toEmail: appointment.doctor.user.email,
        relatedAppointmentId: appointmentId,
        type: 'BOOKING_CONFIRMATION',
        ...emailService.templates.rescheduleDoctor(
          appointment.doctor.user.name,
          appointment.patient.name,
          oldSlotStart,
          newStart
        ),
      })
      .catch((e) => console.error('[slot.service] Doctor reschedule email failed:', e.message));

    return updated;
  } catch (err) {
    if (err.code === 'P2002') {
      throw new ApiError(409, 'The chosen slot was just taken by another booking. Please choose another time.');
    }
    throw err;
  }
}

/** Cancel an appointment — frees the slot lock immediately for rebooking. */
async function cancelAppointment({ appointmentId, actorId, actorRole, reason }) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: { include: { user: true } }, patient: true, calendarEvent: true },
  });
  if (!appointment) throw new ApiError(404, 'Appointment not found');

  const isOwner = appointment.patientId === actorId || appointment.doctor.userId === actorId;
  if (!isOwner && actorRole !== 'ADMIN') {
    throw new ApiError(403, 'Not authorized to cancel this appointment');
  }

  if (['CANCELLED', 'LEAVE_CANCELLED', 'COMPLETED'].includes(appointment.status)) {
    throw new ApiError(409, `Appointment is already ${appointment.status}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELLED' } });
    await tx.slotLock.deleteMany({ where: { appointmentId } });
  });

  // Dual-Party Cancellation Emails
  emailService
    .queueAndSend({
      toEmail: appointment.patient.email,
      relatedAppointmentId: appointmentId,
      type: 'CANCELLATION',
      ...emailService.templates.cancellationPatient(
        appointment.patient.name,
        appointment.doctor.user.name,
        appointment.slotStart,
        reason
      ),
    })
    .catch((e) => console.error('[slot.service] Patient cancellation email failed:', e.message));

  emailService
    .queueAndSend({
      toEmail: appointment.doctor.user.email,
      relatedAppointmentId: appointmentId,
      type: 'CANCELLATION',
      ...emailService.templates.cancellationDoctor(
        appointment.doctor.user.name,
        appointment.patient.name,
        appointment.slotStart,
        reason
      ),
    })
    .catch((e) => console.error('[slot.service] Doctor cancellation email failed:', e.message));

  // Dual-Party Calendar Event Deletion
  if (appointment.calendarEvent) {
    if (appointment.calendarEvent.patientEventId && appointment.patient.googleRefreshToken) {
      calendarService
        .deleteEvent({
          googleRefreshToken: appointment.patient.googleRefreshToken,
          eventId: appointment.calendarEvent.patientEventId,
        })
        .catch(() => {});
    }
    if (appointment.calendarEvent.doctorEventId && appointment.doctor.user.googleRefreshToken) {
      calendarService
        .deleteEvent({
          googleRefreshToken: appointment.doctor.user.googleRefreshToken,
          eventId: appointment.calendarEvent.doctorEventId,
        })
        .catch(() => {});
    }
  }

  return true;
}

/**
 * Doctor-leave conflict handling: when a doctor is marked on leave for a
 * date that already has confirmed bookings, every affected appointment is
 * cancelled, locks released, and every affected patient notified.
 */
async function handleLeaveConflicts({ doctorId, dateStr, reason }) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59`);
  const affected = await prisma.appointment.findMany({
    where: { doctorId, slotStart: { gte: dayStart, lte: dayEnd }, status: { in: ['HELD', 'CONFIRMED'] } },
    include: { doctor: { include: { user: true } }, patient: true, calendarEvent: true },
  });

  for (const appt of affected) {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id: appt.id }, data: { status: 'LEAVE_CANCELLED' } });
      await tx.slotLock.deleteMany({ where: { appointmentId: appt.id } });
    });

    emailService
      .queueAndSend({
        toEmail: appt.patient.email,
        relatedAppointmentId: appt.id,
        type: 'LEAVE_NOTICE',
        ...emailService.templates.leaveNotice(appt.patient.name, appt.doctor.user.name, appt.slotStart, reason),
      })
      .catch((e) => console.error('[slot.service] leave notice email failed:', e.message));

    // Delete calendar events for both patient and doctor
    if (appt.calendarEvent) {
      if (appt.calendarEvent.patientEventId && appt.patient.googleRefreshToken) {
        calendarService
          .deleteEvent({
            googleRefreshToken: appt.patient.googleRefreshToken,
            eventId: appt.calendarEvent.patientEventId,
          })
          .catch(() => {});
      }
      if (appt.calendarEvent.doctorEventId && appt.doctor.user.googleRefreshToken) {
        calendarService
          .deleteEvent({
            googleRefreshToken: appt.doctor.user.googleRefreshToken,
            eventId: appt.calendarEvent.doctorEventId,
          })
          .catch(() => {});
      }
    }
  }

  return affected.length;
}

module.exports = {
  getAvailableSlots,
  holdSlot,
  confirmAppointment,
  rescheduleAppointment,
  cancelAppointment,
  handleLeaveConflicts,
  syncCalendarForAppointment,
};

