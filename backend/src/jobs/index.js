const cron = require('node-cron');
const { runEmailRetry } = require('./emailRetry.job');
const { runSlotLockCleanup } = require('./slotLockCleanup.job');
const { runMedicationReminders } = require('./medicationReminder.job');
const { runAppointmentReminders } = require('./appointmentReminder.job');

function startBackgroundJobs() {
  // Every minute: retry any email that didn't go out, and free up
  // slot holds nobody confirmed in time.
  cron.schedule('* * * * *', async () => {
    try {
      const n = await runEmailRetry();
      if (n) console.log(`[jobs] email retry: processed ${n} log(s)`);
    } catch (err) {
      console.error('[jobs] email retry failed', err);
    }
  });

  cron.schedule('* * * * *', async () => {
    try {
      const n = await runSlotLockCleanup();
      if (n) console.log(`[jobs] slot lock cleanup: freed ${n} expired hold(s)`);
    } catch (err) {
      console.error('[jobs] slot lock cleanup failed', err);
    }
  });

  // Every 5 minutes: run medication reminders (scheduled by prescription frequency)
  cron.schedule('*/5 * * * *', async () => {
    try {
      const n = await runMedicationReminders();
      if (n) console.log(`[jobs] medication reminders: sent ${n}`);
    } catch (err) {
      console.error('[jobs] medication reminders failed', err);
    }
  });

  // Every 15 minutes: check for appointments in the next 24h and send reminders
  cron.schedule('*/15 * * * *', async () => {
    try {
      const n = await runAppointmentReminders();
      if (n) console.log(`[jobs] appointment reminders: sent ${n}`);
    } catch (err) {
      console.error('[jobs] appointment reminders failed', err);
    }
  });

  // Every 10 minutes: Self-ping health check to prevent Render free-tier cold starts
  cron.schedule('*/10 * * * *', async () => {
    const targetUrl = process.env.RENDER_EXTERNAL_URL || process.env.HOSTED_URL || `http://localhost:${process.env.PORT || 4000}`;
    try {
      await fetch(`${targetUrl}/api/health`);
    } catch (e) {
      // ignore
    }
  });

  console.log('[jobs] background jobs scheduled (email retry, slot cleanup, medication reminders, appointment reminders, keep-alive)');
}

module.exports = { startBackgroundJobs };
