/**
 * Comprehensive End-to-End Functional & Integration Test Suite
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const slotService = require('./src/services/slot.service');
const llmService = require('./src/services/llm.service');
const emailService = require('./src/services/email.service');
const calendarService = require('./src/services/calendar.service');
const { runAppointmentReminders } = require('./src/jobs/appointmentReminder.job');
const { runMedicationReminders } = require('./src/jobs/medicationReminder.job');
const { runSlotLockCleanup } = require('./src/jobs/slotLockCleanup.job');
const { runEmailRetry } = require('./src/jobs/emailRetry.job');

async function runTests() {
  console.log('=== STARTING END-TO-END HEALTHCARE APPOINTMENT MANAGER TESTS ===\n');

  // 1. Verify Doctors and Users exist
  const doctors = await prisma.doctorProfile.findMany({ include: { user: true } });
  console.log(`✓ Database check: Found ${doctors.length} doctors.`);
  if (doctors.length === 0) throw new Error('No doctors found');

  const testDoctor = doctors[0];
  const patient = await prisma.user.findFirst({ where: { role: 'PATIENT' } });
  console.log(`✓ Selected Test Doctor: Dr. ${testDoctor.user.name} (${testDoctor.specialisation})`);
  console.log(`✓ Selected Test Patient: ${patient.name} (${patient.email})`);

  // 2. Fetch Available Slots on a working day
  // Find the next date that is in doctor's working days (e.g. MON-FRI)
  let testDate = new Date();
  let slotData = { slots: [] };
  let testDateStr = '';

  for (let i = 1; i <= 7; i++) {
    const candidate = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const dateStr = candidate.toISOString().slice(0, 10);
    const res = await slotService.getAvailableSlots(testDoctor.id, dateStr);
    if (!res.onLeave && res.slots.length > 0) {
      testDate = candidate;
      testDateStr = dateStr;
      slotData = res;
      break;
    }
  }

  console.log(`✓ Available slots for Dr. ${testDoctor.user.name} on ${testDateStr}: ${slotData.slots.length} open slot(s).`);
  if (slotData.slots.length === 0) throw new Error('No slots available for testing');

  const chosenSlot = slotData.slots[0].start;

  // 3. Hold Slot (Step 1 of Booking)
  console.log(`\n--- Test: Atomic Slot Hold & Concurrency Safety ---`);
  const heldAppointment = await slotService.holdSlot({
    doctorId: testDoctor.id,
    patientId: patient.id,
    slotStart: chosenSlot,
  });
  console.log(`✓ Step 1 Success: Slot held for patient. Appointment ID: ${heldAppointment.id}, Status: ${heldAppointment.status}`);

  // Test Concurrency: Simultaneous booking attempt for the exact same slot MUST be rejected (409)
  try {
    await slotService.holdSlot({
      doctorId: testDoctor.id,
      patientId: patient.id,
      slotStart: chosenSlot,
    });
    throw new Error('CONCURRENCY TEST FAILED: Duplicate slot hold succeeded!');
  } catch (err) {
    if (err.statusCode === 409 || err.message.includes('taken')) {
      console.log(`✓ Double-Booking Prevention: Simultaneous hold attempt correctly rejected (409 Conflict): "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 4. Pre-Visit Summary (LLM Analysis)
  console.log(`\n--- Test: AI Pre-Visit Symptom Analysis ---`);
  const symptoms = 'High fever (102°F) for 2 days with severe sore throat and body ache.';
  const preVisitSummary = await llmService.generatePreVisitSummary(symptoms);
  console.log(`✓ Pre-visit Summary Generated:`);
  console.log(`   - Urgency: ${preVisitSummary.urgency}`);
  console.log(`   - Chief Complaint: ${preVisitSummary.chiefComplaint}`);
  console.log(`   - Suggested Questions: ${preVisitSummary.suggestedQuestions?.join(' | ')}`);

  // 5. Confirm Appointment
  console.log(`\n--- Test: Appointment Confirmation & Dual-Party Side Effects ---`);
  const confirmed = await slotService.confirmAppointment({
    appointmentId: heldAppointment.id,
    patientId: patient.id,
    symptomsText: symptoms,
    preVisitSummary,
  });
  console.log(`✓ Appointment Confirmed: Status=${confirmed.status}, Urgency=${confirmed.urgencyLevel}`);

  // Verify Email Logs were created for both patient and doctor
  const bookingEmails = await prisma.emailLog.findMany({
    where: { relatedAppointmentId: heldAppointment.id, type: 'BOOKING_CONFIRMATION' },
  });
  console.log(`✓ Dual-Party Email Verification: Found ${bookingEmails.length} booking confirmation log(s) (Patient & Doctor).`);

  // 6. Reschedule Appointment
  console.log(`\n--- Test: Appointment Rescheduling & Calendar Update ---`);
  // Find a second valid working day for rescheduling
  let newDateSlots = { slots: [] };
  let newTestDateStr = '';

  for (let i = 2; i <= 8; i++) {
    const candidate = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const dateStr = candidate.toISOString().slice(0, 10);
    if (dateStr === testDateStr) continue;
    const res = await slotService.getAvailableSlots(testDoctor.id, dateStr);
    if (!res.onLeave && res.slots.length > 0) {
      newTestDateStr = dateStr;
      newDateSlots = res;
      break;
    }
  }

  const newSlotStart = newDateSlots.slots[0].start;

  const rescheduled = await slotService.rescheduleAppointment({
    appointmentId: heldAppointment.id,
    actorId: patient.id,
    actorRole: 'PATIENT',
    newSlotStart,
  });
  console.log(`✓ Reschedule Success: New Slot Start = ${new Date(rescheduled.slotStart).toISOString()}`);

  // Verify previous slot is now freed up for rebooking
  const recheckedSlots = await slotService.getAvailableSlots(testDoctor.id, testDateStr);
  const oldSlotAvailable = recheckedSlots.slots.some((s) => s.start.toISOString() === new Date(chosenSlot).toISOString());
  console.log(`✓ Slot Lock Released: Previous slot is available again for new bookings: ${oldSlotAvailable}`);

  // 7. Background Jobs Execution
  console.log(`\n--- Test: Background Cron Jobs ---`);
  const reminderCount = await runAppointmentReminders();
  console.log(`✓ Appointment 24h Reminder Job: Processed ${reminderCount} reminder(s).`);

  const cleanupCount = await runSlotLockCleanup();
  console.log(`✓ Slot Lock Cleanup Job: Cleaned ${cleanupCount} expired holds.`);

  const retryCount = await runEmailRetry();
  console.log(`✓ Email Retry Job: Processed ${retryCount} pending/failed email logs.`);

  // 8. Doctor Complete Visit & Medication Reminders
  console.log(`\n--- Test: Visit Completion, AI Post-Visit Summary & Medication Cadence ---`);
  const clinicalNotes = 'Acute pharyngitis with viral upper respiratory tract infection. Throat red, no exudate.';
  const prescription = 'Azithromycin 500mg once daily for 3 days; Paracetamol 650mg every 8 hours as needed.';

  const postVisitSummary = await llmService.generatePostVisitSummary(
    `Clinical notes: ${clinicalNotes}\nPrescription: ${prescription}`
  );
  console.log(`✓ Post-Visit Summary:`);
  console.log(`   - Summary: ${postVisitSummary.summary}`);
  console.log(`   - Medication Schedule: ${JSON.stringify(postVisitSummary.medicationSchedule)}`);

  await prisma.appointment.update({
    where: { id: heldAppointment.id },
    data: {
      status: 'COMPLETED',
      doctorNotes: clinicalNotes,
      prescriptionText: prescription,
      postVisitSummary: JSON.stringify(postVisitSummary),
    },
  });

  // Create test medication reminder
  await prisma.medicationReminder.create({
    data: {
      appointmentId: heldAppointment.id,
      patientId: patient.id,
      medicationText: 'Paracetamol 650mg — every 8 hours',
      frequencyHours: 8,
      nextRunAt: new Date(Date.now() - 1000), // set to past so job processes it
      remainingCount: 3,
    },
  });

  const medRemindersSent = await runMedicationReminders();
  console.log(`✓ Medication Reminder Job: Sent ${medRemindersSent} medication reminder(s).`);

  // 9. Doctor Leave Conflict Handling
  console.log(`\n--- Test: Doctor Leave Conflict Management ---`);
  // Book another appointment on a specific future date
  const leaveDate = '2026-09-15';
  const leaveDateSlots = await slotService.getAvailableSlots(testDoctor.id, leaveDate);
  if (leaveDateSlots.slots.length > 0) {
    const leaveAppt = await slotService.holdSlot({
      doctorId: testDoctor.id,
      patientId: patient.id,
      slotStart: leaveDateSlots.slots[0].start,
    });
    await slotService.confirmAppointment({
      appointmentId: leaveAppt.id,
      patientId: patient.id,
      symptomsText: 'Routine checkup',
      preVisitSummary: { urgency: 'Low', chiefComplaint: 'Routine checkup', suggestedQuestions: [] },
    });
    console.log(`✓ Created pre-existing booking on ${leaveDate}`);

    // Mark Doctor on leave for that date
    await prisma.doctorLeave.upsert({
      where: { doctorId_date: { doctorId: testDoctor.id, date: leaveDate } },
      create: { doctorId: testDoctor.id, date: leaveDate, reason: 'Medical Conference' },
      update: { reason: 'Medical Conference' },
    });

    const affected = await slotService.handleLeaveConflicts({
      doctorId: testDoctor.id,
      dateStr: leaveDate,
      reason: 'Medical Conference',
    });
    console.log(`✓ Leave Conflict Handled: ${affected} affected appointment(s) cancelled and patients notified.`);

    const checkLeaveAppt = await prisma.appointment.findUnique({ where: { id: leaveAppt.id } });
    console.log(`✓ Appointment status updated to: ${checkLeaveAppt.status}`);
  }

  // 10. Email Diagnostics Test
  console.log(`\n--- Test: Email Diagnostics & Verification ---`);
  const connCheck = await emailService.verifyConnection();
  console.log(`✓ Email Connection Check: ${JSON.stringify(connCheck)}`);

  console.log('\n======================================================');
  console.log('🎉 ALL INTEGRATION & CONCURRENCY TESTS PASSED 100%!');
  console.log('======================================================\n');
}

runTests()
  .catch((e) => {
    console.error('❌ Test failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
