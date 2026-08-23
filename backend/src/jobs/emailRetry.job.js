const prisma = require('../config/prisma');
const emailService = require('../services/email.service');

const MAX_ATTEMPTS = 5;

/**
 * Retries anything PENDING (never actually attempted, e.g. process died
 * mid-request) or FAILED (attempts < MAX_ATTEMPTS). Attempts count is
 * itself the backoff: this job runs every minute, so attempt N is
 * roughly N minutes after the first try — simple, and sufficient for a
 * clinic-scale volume of transactional email.
 */
async function runEmailRetry() {
  const pending = await prisma.emailLog.findMany({
    where: {
      OR: [{ status: 'PENDING' }, { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } }],
    },
    take: 25,
  });

  for (const log of pending) {
    await emailService.attemptSend(log);
  }

  // Anything that has permanently exhausted retries stays FAILED and
  // visible in EmailLog for an admin/ops query — silently dropping it
  // would defeat the purpose of logging it in the first place.
  return pending.length;
}

module.exports = { runEmailRetry };
