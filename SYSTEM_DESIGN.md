# System Design — Healthcare Appointment & Follow-up Manager

## 1. Double-Booking Prevention & Concurrency Safety

The naive booking pattern — "query existing bookings, then insert if clear" — suffers from a critical race condition: two concurrent requests can both execute the read check before either insert commits, leading to catastrophic double-booking.

Instead of relying on application-level checks, our system delegates concurrency serialization directly to the database storage engine.

The `SlotLock` table enforces a database-level **`UNIQUE(doctorId, slotStart)`** constraint. Reserving or booking a slot is an `INSERT` into `SlotLock` inside an atomic ACID transaction:
1. When concurrent requests attempt to reserve the same doctor and time slot simultaneously, the database serializes both transactions.
2. Exactly one transaction acquires the unique index entry and commits successfully.
3. The competing transaction fails immediately with a unique constraint violation (`P2002` in Prisma).
4. The backend catches this specific code and returns `409 Conflict` (*"This slot was just taken by another patient"*).

The clinical narrative (`Appointment` table) is decoupled from the lock index (`SlotLock` table). An appointment tracks history, symptoms, triage, notes, and prescriptions across its lifecycle (`HELD`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `LEAVE_CANCELLED`), while `SlotLock` holds only the active reservation. Cancelling an appointment deletes its `SlotLock` row, immediately restoring slot availability.

---

## 2. Slot Hold Mechanism

Booking is not instantaneous: a patient must select a slot, input detailed symptoms, and review their AI pre-visit summary before finalizing. If slot reservation were deferred until final confirmation, competing patients could spend minutes writing symptom details only to suffer an unexpected collision at the final step.

To prevent this, booking uses a two-phase reservation protocol:

1. **Atomic Hold (`POST /api/appointments/hold`):**
   The patient selects a slot, which immediately creates a `SlotLock` and `Appointment` with status `HELD` and `expiresAt = now() + SLOT_HOLD_MINUTES` (5 minutes). This atomically reserves the slot against all other users.
2. **Confirmation (`POST /api/appointments/:id/confirm`):**
   Once the patient submits symptoms and reviews the AI summary, the transaction sets the appointment status to `CONFIRMED` and clears `expiresAt`.

**Handling Abandoned Holds:**
If a patient abandons their booking flow, the system releases the slot automatically without requiring client-side WebSockets. A background cron job (`jobs/slotLockCleanup.job.js`) runs every minute, queries expired `HELD` locks (`expiresAt < now()`), deletes the `SlotLock` rows in a transaction, and transitions the orphaned appointments to `CANCELLED`.

---

## 3. Doctor Leave Conflict Handling

When an administrator marks a doctor on leave for a specific date (`POST /api/admin/doctors/:id/leave`), existing confirmed or held bookings must be resolved cleanly without manual clinic overhead.

The leave handler (`slot.service.js#handleLeaveConflicts`) performs an automated sweep across all appointments matching that doctor and date range:
1. **Status Transition:** Each conflicting appointment is updated to `LEAVE_CANCELLED`, preserving a clear audit trail distinguishing clinic cancellations from patient cancellations.
2. **Lock Release:** All associated `SlotLock` records are purged in the transaction, unblocking the schedule.
3. **Automated Patient Notification:** An urgent leave notification email (`LEAVE_NOTICE`) is queued to each affected patient explaining the cancellation and inviting them to rebook.
4. **Calendar Event Cleanup:** Google Calendar events associated with the appointment for both the patient and doctor are deleted via the Google Calendar API.

---

## 4. Notification & Calendar Reliability

Outbound notifications (booking confirmations, reschedules, cancellations, reminders, and prescription medication schedules) and Google Calendar synchronizations are designed for resilience against transient network failures and host crashes:

1. **Durable Database Queue (`EmailLog`):**
   Every outbound notification is written to `EmailLog` with `status: 'PENDING'` *before* network dispatch. If a process terminates mid-request, the pending log persists in the database.
2. **Multi-Provider Dispatcher (`email.service.js`):**
   Supports native Gmail (with 16-character App Passwords), standard SMTP (SendGrid, Mailgun), and Resend HTTPS API (to bypass outbound port 587/465 blocks on platforms like Render free tier). If credentials are unconfigured in development, emails are logged to the console and database without throwing errors.
3. **Automated Retry with Incremental Backoff (`jobs/emailRetry.job.js`):**
   A cron job executes every minute to retry `PENDING` or `FAILED` emails up to 5 attempts. Permanent failures remain visible in the Admin Notification Log with recorded error traces (`lastError`) for operator inspection and manual retry.
4. **Google Calendar Sync & Web Link Fallback:**
   Google Calendar OAuth 2.0 synchronizes events for both parties, updating on reschedule and deleting on cancellation. For users without OAuth connected, 1-click direct Google Calendar web links are embedded in every confirmation email and dashboard card.
