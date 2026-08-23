const prisma = require('../config/prisma');

/**
 * A patient who holds a slot but never finishes the symptom form /
 * confirmation step would otherwise keep that slot locked forever. This
 * job deletes expired HELD locks and marks their appointment CANCELLED,
 * which is what actually makes the slot bookable again (the unique
 * constraint only blocks on rows that still exist).
 */
async function runSlotLockCleanup() {
  const expired = await prisma.slotLock.findMany({
    where: { status: 'HELD', expiresAt: { lt: new Date() } },
  });

  for (const lock of expired) {
    await prisma.$transaction(async (tx) => {
      if (lock.appointmentId) {
        await tx.appointment.update({ where: { id: lock.appointmentId }, data: { status: 'CANCELLED' } });
      }
      await tx.slotLock.delete({ where: { id: lock.id } });
    });
  }

  return expired.length;
}

module.exports = { runSlotLockCleanup };
