require('dotenv').config();

function bool(val, fallback) {
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
}

function cleanString(val) {
  if (!val) return '';
  return String(val).trim();
}

// Clean Gmail App Passwords which are generated as 4 groups of 4 letters with spaces
function cleanAppPassword(val) {
  if (!val) return '';
  return String(val).replace(/\s+/g, '');
}

const GMAIL_USER = cleanString(process.env.GMAIL_USER || process.env.SMTP_USER);
const GMAIL_APP_PASSWORD = cleanAppPassword(process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS);

module.exports = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '2h',
  REFRESH_TOKEN_DAYS: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  SLOT_HOLD_MINUTES: Number(process.env.SLOT_HOLD_MINUTES || 5),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // LLM — any provider works; if none is set, llm.service.js falls back
  // to a deterministic rule-based summary so the app never breaks.
  LLM_PROVIDER: cleanString(process.env.LLM_PROVIDER || 'none').toLowerCase(), // 'gemini' | 'anthropic' | 'openai' | 'none'
  ANTHROPIC_API_KEY: cleanString(process.env.ANTHROPIC_API_KEY),
  OPENAI_API_KEY: cleanString(process.env.OPENAI_API_KEY),
  GEMINI_API_KEY: cleanString(process.env.GEMINI_API_KEY),

  // Email Configuration
  // EMAIL_PROVIDER: 'resend' | 'gmail' | 'smtp'
  EMAIL_PROVIDER: cleanString(
    process.env.EMAIL_PROVIDER ||
      (process.env.RESEND_API_KEY ? 'resend' : GMAIL_USER ? 'gmail' : 'smtp')
  ).toLowerCase(),
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  RESEND_API_KEY: cleanString(process.env.RESEND_API_KEY),
  SMTP_HOST: cleanString(process.env.SMTP_HOST),
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_USER: cleanString(process.env.SMTP_USER || GMAIL_USER),
  SMTP_PASS: cleanAppPassword(process.env.SMTP_PASS || GMAIL_APP_PASSWORD),
  SMTP_FROM: cleanString(
    process.env.SMTP_FROM ||
      (process.env.RESEND_API_KEY || process.env.EMAIL_PROVIDER === 'resend'
        ? 'Meridian Clinic <onboarding@resend.dev>'
        : GMAIL_USER
        ? `Meridian Clinic <${GMAIL_USER}>`
        : 'Meridian Clinic <no-reply@clinic.local>')
  ),
  EMAIL_ENABLED: bool(process.env.EMAIL_ENABLED, true),
  // Optional override: redirects all outgoing emails during dev/testing to this email address
  EMAIL_OVERRIDE: cleanString(process.env.EMAIL_OVERRIDE),

  // Google Calendar OAuth2
  GOOGLE_CLIENT_ID: cleanString(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: cleanString(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_REDIRECT_URI: cleanString(process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/calendar/oauth/callback'),
  CALENDAR_ENABLED: bool(process.env.CALENDAR_ENABLED, false),
};
