const prisma = require('../config/prisma');
const emailService = require('../services/email.service');

async function runMedicationReminders() {
  const due = await prisma.medicationReminder.findMany({
    where: { status: 'ACTIVE', nextRunAt: { lte: new Date() } },
    include: { appointment: { include: { patient: true } } },
    take: 50,
  });

  for (const reminder of due) {
    const patient = reminder.appointment.patient;
    await emailService
      .queueAndSend({
        toEmail: patient.email,
        relatedAppointmentId: reminder.appointmentId,
        type: 'MEDICATION_REMINDER',
        ...emailService.templates.medicationReminder(patient.name, reminder.medicationText),
      })
      .catch((e) => console.error('medication reminder email failed', e.message));

    const remaining = reminder.remainingCount - 1;
    if (remaining <= 0) {
      await prisma.medicationReminder.update({ where: { id: reminder.id }, data: { status: 'COMPLETED', remainingCount: 0 } });
    } else {
      await prisma.medicationReminder.update({
        where: { id: reminder.id },
        data: {
          remainingCount: remaining,
          nextRunAt: new Date(Date.now() + reminder.frequencyHours * 3600000),
        },
      });
    }
  }

  return due.length;
}

module.exports = { runMedicationReminders };
