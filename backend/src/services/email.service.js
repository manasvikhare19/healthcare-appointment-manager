/**
 * Email Service
 * -------------
 * Provides reliable, multi-provider email delivery:
 * 1. Gmail (via Nodemailer service: 'gmail' or smtp.gmail.com with 16-char App Passwords)
 * 2. Generic SMTP (SendGrid, Mailgun, AWS SES, custom SMTP servers)
 * 3. Resend (HTTP API on port 443 — ideal for hosts that block SMTP like Render free tier)
 * 4. Dev-friendly console fallback when no credentials are configured
 *
 * Reliability Pattern:
 * Every notification is written to EmailLog in 'PENDING' status BEFORE dispatch.
 * If the process crashes mid-send or SMTP is unreachable, the notification is
 * preserved in the database and automatically retried by jobs/emailRetry.job.js.
 */
const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');
const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, EMAIL_ENABLED,
  EMAIL_PROVIDER, RESEND_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_OVERRIDE,
} = require('../config/env');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  // Option A: Gmail Service
  if (EMAIL_PROVIDER === 'gmail' || (GMAIL_USER && GMAIL_APP_PASSWORD)) {
    const user = GMAIL_USER || SMTP_USER;
    const pass = GMAIL_APP_PASSWORD || SMTP_PASS;
    if (!user || !pass) return null;

    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    return transporter;
  }

  // Option B: Standard / Custom SMTP
  if (SMTP_HOST) {
    const isGmailHost = SMTP_HOST.toLowerCase().includes('gmail.com');
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT || (isGmailHost ? 465 : 587),
      secure: SMTP_PORT === 465 || isGmailHost,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      tls: { rejectUnauthorized: false },
    });
    return transporter;
  }

  return null;
}

/**
 * Resend sends over HTTPS (port 443), not raw SMTP — this makes it
 * work on hosts like Render's free tier, which blocks outbound SMTP ports.
 */
async function sendViaResend({ to, subject, html }) {
  const fromAddress = SMTP_FROM || 'Meridian Clinic <onboarding@resend.dev>';
  let recipients = Array.isArray(to) ? to : [to];

  let resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from: fromAddress, to: recipients, subject, html }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    // If Resend sandbox restricts recipient to account owner (e.g. 403 or 422)
    const matchAccount = errText.match(/your own email address \(([^)]+)\)/);
    if (matchAccount && matchAccount[1] && recipients[0] !== matchAccount[1]) {
      console.log(`[email.service] Resend sandbox rerouting to registered account: ${matchAccount[1]}`);
      const retryResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [matchAccount[1]],
          subject: `[For: ${recipients.join(', ')}] ${subject}`,
          html,
        }),
      });
      if (retryResp.ok) {
        return retryResp.json();
      }
    }
    throw new Error(`Resend API error (${resp.status}): ${errText}`);
  }
  return resp.json();
}

/** Verify email connection and return diagnostic status */
async function verifyConnection() {
  if (!EMAIL_ENABLED) {
    return { success: false, provider: EMAIL_PROVIDER, message: 'Email is disabled via EMAIL_ENABLED=false' };
  }

  if (EMAIL_PROVIDER === 'resend') {
    if (!RESEND_API_KEY) return { success: false, provider: 'resend', message: 'RESEND_API_KEY is missing in .env' };
    return { success: true, provider: 'resend', message: 'Resend API key configured' };
  }

  const t = getTransporter();
  if (!t) {
    return {
      success: false,
      provider: EMAIL_PROVIDER,
      message: 'No email credentials configured. Operating in dev mode (emails logged to console & DB).',
    };
  }

  try {
    await t.verify();
    return {
      success: true,
      provider: EMAIL_PROVIDER === 'gmail' ? 'Gmail' : `SMTP (${SMTP_HOST})`,
      message: 'Connection verified successfully. Ready to send emails.',
    };
  } catch (err) {
    return {
      success: false,
      provider: EMAIL_PROVIDER,
      message: `Connection test failed: ${err.message}. If using Gmail, ensure 2-Step Verification is enabled and a 16-character App Password is used.`,
    };
  }
}

/** Queue + immediately attempt an email. Returns the EmailLog row. */
async function queueAndSend({ toEmail, subject, body, type, relatedAppointmentId }) {
  const log = await prisma.emailLog.create({
    data: { toEmail, subject, body, type, relatedAppointmentId, status: 'PENDING' },
  });
  return attemptSend(log);
}

/** Attempt to send a logged email with error tracking */
async function attemptSend(log) {
  if (!EMAIL_ENABLED) {
    return prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'SENT', attempts: { increment: 1 } },
    });
  }

  const targetEmail = EMAIL_OVERRIDE || log.toEmail;
  const targetSubject = EMAIL_OVERRIDE ? `[To: ${log.toEmail}] ${log.subject}` : log.subject;

  // Option 1: Resend HTTP API
  if (EMAIL_PROVIDER === 'resend' && RESEND_API_KEY) {
    try {
      await sendViaResend({ to: targetEmail, subject: targetSubject, html: log.body });
      return prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'SENT', attempts: { increment: 1 }, lastError: null },
      });
    } catch (err) {
      console.error(`[email.service] Resend send failed for log ${log.id}:`, err.message);
      return prisma.emailLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastError: err.message },
      });
    }
  }

  const t = getTransporter();
  if (!t) {
    // No email provider configured — dev-mode friendly fallback:
    // Log to console and mark SENT so it doesn't backlog the retry queue.
    console.log(`\n📧 [DEV EMAIL] To: ${targetEmail} | Subject: ${targetSubject}\nType: ${log.type}\nBody: ${log.body.replace(/<[^>]*>?/gm, ' ')}\n`);
    return prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'SENT', attempts: { increment: 1 }, lastError: null },
    });
  }

  try {
    const from = SMTP_FROM || 'Meridian Clinic <no-reply@clinic.local>';
    await t.sendMail({
      from,
      to: targetEmail,
      subject: targetSubject,
      html: log.body,
    });
    return prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'SENT', attempts: { increment: 1 }, lastError: null },
    });
  } catch (err) {
    console.error(`[email.service] Email send failed for log ${log.id}:`, err.message);
    return prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: err.message },
    });
  }
}

// --- Responsive HTML Email Wrapper & Templated helpers ---

function wrapHtml(title, content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f9f8; color: #1a2e2b; margin: 0; padding: 20px; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e1e8e5; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.04); }
    .header { background: #134e4a; color: #ffffff; padding: 24px; text-align: left; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.2px; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #99f6e4; }
    .content { padding: 28px 24px; line-height: 1.6; font-size: 14.5px; }
    .card-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 18px 0; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .badge-high { background: #fee2e2; color: #991b1b; }
    .badge-med { background: #fef3c7; color: #92400e; }
    .badge-low { background: #e0f2fe; color: #075985; }
    .btn { display: inline-block; background: #0d9488; color: #ffffff !important; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 500; font-size: 13.5px; margin-top: 12px; }
    .footer { padding: 20px 24px; background: #fafbfc; border-top: 1px solid #e1e8e5; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Meridian Health Clinic</h1>
      <p>Appointment &amp; Care Management</p>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>Meridian Clinic &bull; Automated Healthcare Notification</p>
      <p>Need assistance? Contact the clinic directly or visit our portal.</p>
    </div>
  </div>
</body>
</html>`;
}

const templates = {
  // 1. Patient Booking Confirmation
  bookingConfirmationPatient: (patientName, doctorName, specialisation, slotStart, calendarLink) => {
    const formattedDate = new Date(slotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `Confirmed: Appointment with Dr. ${doctorName}`,
      body: wrapHtml('Appointment Confirmed', `
        <p>Hello <b>${patientName}</b>,</p>
        <p>Your appointment has been successfully scheduled and confirmed.</p>
        <div class="card-box">
          <p style="margin: 0 0 6px;"><strong>Doctor:</strong> Dr. ${doctorName} (${specialisation || 'Specialist'})</p>
          <p style="margin: 0 0 6px;"><strong>Date &amp; Time:</strong> ${formattedDate}</p>
          <p style="margin: 0;"><strong>Location:</strong> Meridian Clinic &bull; Main Consultation Suite</p>
        </div>
        ${calendarLink ? `<p><a href="${calendarLink}" target="_blank" class="btn">📅 Add to Google Calendar</a></p>` : ''}
        <p style="margin-top: 20px; font-size: 13px; color: #64748b;">
          Please arrive 10 minutes early. If you need to reschedule or cancel, you can do so anytime from your patient dashboard.
        </p>
      `),
    };
  },

  // 2. Doctor Booking Notification
  bookingConfirmationDoctor: (doctorName, patientName, slotStart, urgency, chiefComplaint) => {
    const formattedDate = new Date(slotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const urgencyClass = urgency === 'High' ? 'badge-high' : urgency === 'Medium' ? 'badge-med' : 'badge-low';
    return {
      subject: `[New Appointment] ${patientName} on ${formattedDate} (${urgency || 'Normal'} urgency)`,
      body: wrapHtml('New Appointment Booked', `
        <p>Hello <b>Dr. ${doctorName}</b>,</p>
        <p>A new appointment has been scheduled for your schedule:</p>
        <div class="card-box">
          <p style="margin: 0 0 6px;"><strong>Patient:</strong> ${patientName}</p>
          <p style="margin: 0 0 6px;"><strong>Time:</strong> ${formattedDate}</p>
          <p style="margin: 0 0 6px;"><strong>AI Urgency Triage:</strong> <span class="badge ${urgencyClass}">${urgency || 'Low'}</span></p>
          ${chiefComplaint ? `<p style="margin: 6px 0 0;"><strong>Chief Complaint:</strong> ${chiefComplaint}</p>` : ''}
        </div>
        <p>The pre-visit summary and suggested triage questions are ready in your Doctor Dashboard queue.</p>
      `),
    };
  },

  // 3. Patient Reschedule Notification
  reschedulePatient: (patientName, doctorName, oldSlotStart, newSlotStart, calendarLink) => {
    const formattedNew = new Date(newSlotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const formattedOld = new Date(oldSlotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `Rescheduled: Appointment with Dr. ${doctorName}`,
      body: wrapHtml('Appointment Rescheduled', `
        <p>Hello <b>${patientName}</b>,</p>
        <p>Your appointment with Dr. ${doctorName} has been successfully rescheduled.</p>
        <div class="card-box">
          <p style="margin: 0 0 6px; color: #64748b; text-decoration: line-through;"><strong>Previous Time:</strong> ${formattedOld}</p>
          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #0d9488;"><strong>New Date &amp; Time:</strong> ${formattedNew}</p>
        </div>
        ${calendarLink ? `<p><a href="${calendarLink}" target="_blank" class="btn">📅 Update Google Calendar</a></p>` : ''}
        <p style="font-size: 13px; color: #64748b;">If you have connected Google Calendar, your calendar event has also been updated automatically.</p>
      `),
    };
  },

  // 4. Doctor Reschedule Notification
  rescheduleDoctor: (doctorName, patientName, oldSlotStart, newSlotStart) => {
    const formattedNew = new Date(newSlotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const formattedOld = new Date(oldSlotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `[Rescheduled] ${patientName} moved to ${formattedNew}`,
      body: wrapHtml('Appointment Rescheduled', `
        <p>Hello <b>Dr. ${doctorName}</b>,</p>
        <p>Patient <b>${patientName}</b> has rescheduled their consultation:</p>
        <div class="card-box">
          <p style="margin: 0 0 6px; color: #64748b; text-decoration: line-through;"><strong>Previous Time:</strong> ${formattedOld}</p>
          <p style="margin: 0; font-weight: 600; color: #0d9488;"><strong>New Time:</strong> ${formattedNew}</p>
        </div>
        <p>Your dashboard and synced Google Calendar have been updated accordingly.</p>
      `),
    };
  },

  // 5. Patient Cancellation
  cancellationPatient: (patientName, doctorName, slotStart, reason) => {
    const formattedDate = new Date(slotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `Cancelled: Appointment with Dr. ${doctorName}`,
      body: wrapHtml('Appointment Cancelled', `
        <p>Hello <b>${patientName}</b>,</p>
        <p>Your appointment with Dr. ${doctorName} on <b>${formattedDate}</b> has been cancelled.${reason ? ` Reason: <em>${reason}</em>` : ''}</p>
        <p>The time slot has been released. You can book a new appointment at any time from your portal.</p>
      `),
    };
  },

  // 6. Doctor Cancellation Notification
  cancellationDoctor: (doctorName, patientName, slotStart, reason) => {
    const formattedDate = new Date(slotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `[Cancelled] Appointment with ${patientName} on ${formattedDate}`,
      body: wrapHtml('Appointment Cancelled', `
        <p>Hello <b>Dr. ${doctorName}</b>,</p>
        <p>The scheduled appointment with patient <b>${patientName}</b> on <b>${formattedDate}</b> has been cancelled.${reason ? ` Reason: <em>${reason}</em>` : ''}</p>
        <p>This slot is now freed up for other bookings.</p>
      `),
    };
  },

  // 7. Doctor Leave Notice to Patient
  leaveNotice: (patientName, doctorName, slotStart, reason) => {
    const formattedDate = new Date(slotStart).toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    });
    const formattedTime = new Date(slotStart).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `Urgent: Dr. ${doctorName} is Unavailable on ${formattedDate}`,
      body: wrapHtml('Schedule Update: Doctor on Leave', `
        <p>Hello <b>${patientName}</b>,</p>
        <p>We regret to inform you that Dr. <b>${doctorName}</b> will be on leave on <b>${formattedDate}</b>${reason ? ` (${reason})` : ''}.</p>
        <p>As a result, your scheduled appointment at <b>${formattedTime}</b> has been cancelled. We sincerely apologise for this inconvenience.</p>
        <p>Please log in to your patient portal to choose another convenient date or consult with another specialist in the same field.</p>
      `),
    };
  },

  // 8. 24-Hour Appointment Reminder (Patient)
  reminderPatient: (patientName, doctorName, specialisation, slotStart, calendarLink) => {
    const formattedDate = new Date(slotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `Reminder: Tomorrow's Appointment with Dr. ${doctorName}`,
      body: wrapHtml('Appointment Reminder', `
        <p>Hello <b>${patientName}</b>,</p>
        <p>This is a friendly reminder for your upcoming consultation with Dr. <b>${doctorName}</b>:</p>
        <div class="card-box">
          <p style="margin: 0 0 6px;"><strong>Doctor:</strong> Dr. ${doctorName} (${specialisation || 'Doctor'})</p>
          <p style="margin: 0;"><strong>Date &amp; Time:</strong> ${formattedDate}</p>
        </div>
        ${calendarLink ? `<p><a href="${calendarLink}" target="_blank" class="btn">📅 View on Google Calendar</a></p>` : ''}
        <p style="font-size: 13px; color: #64748b;">If you need to reschedule, please do so as soon as possible via the patient portal.</p>
      `),
    };
  },

  // 9. 24-Hour Appointment Reminder (Doctor)
  reminderDoctor: (doctorName, patientName, slotStart, urgency) => {
    const formattedDate = new Date(slotStart).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `Schedule Reminder: Consultation with ${patientName} on ${formattedDate}`,
      body: wrapHtml('Appointment Reminder', `
        <p>Hello <b>Dr. ${doctorName}</b>,</p>
        <p>Reminder for your upcoming scheduled consultation:</p>
        <div class="card-box">
          <p style="margin: 0 0 6px;"><strong>Patient:</strong> ${patientName}</p>
          <p style="margin: 0 0 6px;"><strong>Time:</strong> ${formattedDate}</p>
          <p style="margin: 0;"><strong>Urgency:</strong> ${urgency || 'Low'}</p>
        </div>
      `),
    };
  },

  // 10. Medication Reminder
  medicationReminder: (patientName, medicationText, instructions) => ({
    subject: `Care Reminder: Time to take your medication`,
    body: wrapHtml('Medication Reminder', `
      <p>Hello <b>${patientName}</b>,</p>
      <p>This is your scheduled reminder from Meridian Clinic to take your prescribed medication:</p>
      <div class="card-box">
        <p style="margin: 0 0 6px; font-size: 16px; font-weight: 600; color: #0d9488;">💊 ${medicationText}</p>
        ${instructions ? `<p style="margin: 0; color: #64748b;">${instructions}</p>` : ''}
      </div>
      <p style="font-size: 13px; color: #64748b;">Please follow the dosage instructions given by your doctor. Contact the clinic if you experience any adverse reactions.</p>
    `),
  }),

  // 11. Post-Visit Summary
  visitSummaryPatient: (patientName, doctorName, summary, medicationSchedule = [], followUpSteps = [], warningSigns = []) => {
    const medRows = medicationSchedule.map((m) => `
      <tr style="border-bottom: 1px solid #e1e8e5;">
        <td style="padding: 6px 8px 6px 0; font-weight: 600;">💊 ${m.medication}</td>
        <td style="padding: 6px 0; color: #475569;">${m.instructions || ''}</td>
      </tr>
    `).join('');

    const followUps = followUpSteps.length > 0 ? `
      <div style="margin-top: 14px;">
        <p style="font-weight: 600; margin: 0 0 4px;">📅 Next Steps &amp; Follow-up:</p>
        <ul style="margin: 0; padding-left: 18px; color: #475569; font-size: 13.5px;">
          ${followUpSteps.map((s) => `<li>${s}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    const warnings = warningSigns.length > 0 ? `
      <div class="card-box" style="background: #fef2f2; border-color: #fecaca; margin-top: 14px;">
        <p style="font-weight: 600; color: #991b1b; margin: 0 0 4px;">⚠️ Seek Immediate Care If You Notice:</p>
        <ul style="margin: 0; padding-left: 18px; color: #7f1d1d; font-size: 13px;">
          ${warningSigns.map((w) => `<li>${w}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    return {
      subject: `Your Consultation Summary & Care Plan — Dr. ${doctorName}`,
      body: wrapHtml('Consultation Summary', `
        <p>Hello <b>${patientName}</b>,</p>
        <p>Dr. <b>${doctorName}</b> has finalized the care plan and clinical summary from your recent visit:</p>
        <div class="card-box">
          <p style="margin: 0; font-size: 14px; line-height: 1.6;">${summary}</p>
        </div>
        ${medicationSchedule.length > 0 ? `
          <div style="margin-top: 14px;">
            <p style="font-weight: 600; margin: 0 0 6px;">Prescribed Medications &amp; Schedule:</p>
            <table style="width: 100%; font-size: 13.5px; border-collapse: collapse;">
              <tbody>${medRows}</tbody>
            </table>
          </div>
        ` : ''}
        ${followUps}
        ${warnings}
        <p style="margin-top: 18px; font-size: 13px; color: #64748b;">You can also view this summary anytime by logging into your patient dashboard.</p>
      `),
    };
  },

  // 12. Test Email
  testEmail: (recipientEmail, providerName) => ({
    subject: `Meridian Clinic — Email Integration Test Successful`,
    body: wrapHtml('Email System Test', `
      <p>Hello,</p>
      <p>This is a test notification confirming that the email integration for <b>Meridian Clinic</b> is operational.</p>
      <div class="card-box">
        <p style="margin: 0 0 6px;"><strong>Provider:</strong> ${providerName}</p>
        <p style="margin: 0 0 6px;"><strong>Sent To:</strong> ${recipientEmail}</p>
        <p style="margin: 0;"><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </div>
      <p style="font-size: 13px; color: #15803d;">All notification services (booking confirmations, cancellations, reminders, and leave notices) are ready.</p>
    `),
  }),

  // 13. Security Login Alert
  loginAlert: (name, email, role, timestamp = new Date()) => {
    const formatted = new Date(timestamp).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return {
      subject: `🔐 Security Notice: New sign-in to your Meridian Clinic account`,
      body: wrapHtml('Security Alert', `
        <p>Hello <b>${name}</b>,</p>
        <p>We detected a new sign-in to your <b>Meridian Clinic</b> account with the following details:</p>
        <div class="card-box">
          <p style="margin: 0 0 6px;"><strong>Account:</strong> ${email}</p>
          <p style="margin: 0 0 6px;"><strong>Role:</strong> ${role.charAt(0) + role.slice(1).toLowerCase()}</p>
          <p style="margin: 0;"><strong>Sign-in Time:</strong> ${formatted}</p>
        </div>
        <p style="font-size: 13.5px; color: #475569;">If this was you, you can safely ignore this email. If you did not log in, please secure your account or contact the clinic administrator immediately.</p>
      `),
    };
  },
};

module.exports = { queueAndSend, attemptSend, verifyConnection, templates };


