# Meridian Clinic — Healthcare Appointment & Follow-up Manager

A full-stack, enterprise-grade healthcare appointment and care management platform with dedicated portals for **Patients**, **Doctors**, and **Admins**. 

Patients can browse doctors by specialization, hold and book appointment slots, submit symptoms in advance, receive AI-generated pre-visit summaries and urgency triage, access patient-friendly post-visit notes and prescriptions, receive scheduled medication reminders, and keep everything synced across **Email** and **Google Calendar**.

Doctors can review an urgency-triaged consultation queue with AI pre-visit briefings, complete visits with clinical notes and prescriptions, and generate structured care summaries. Admins have complete control over doctor profiles, schedule configurations, whole-day leave management with automated patient conflict resolution, and real-time notification diagnostics.

---

## Technical Stack & Architecture

- **Backend:** Node.js, Express, Prisma ORM (SQLite out-of-the-box for zero-config local dev; PostgreSQL-ready for production), JWT authentication, `node-cron` background job engine.
- **Frontend:** React 18, Vite, React Router v6, vanilla responsive design system with accessible contrast and custom triage badges.
- **AI / LLM Integration:** Multi-provider support (**Google Gemini**, **Anthropic Claude**, **OpenAI**) with deterministic, rule-based clinical fallback so the entire platform operates 100% reliably even with zero API keys configured.
- **Email Service:** Nodemailer with native **Gmail App Password** support, generic SMTP (SendGrid, Mailgun, AWS SES), **Resend HTTPS API** (for environments like Render free tier that restrict outbound SMTP), and console dev-mode logging with durable database logging (`EmailLog`).
- **Calendar Integration:** **Google Calendar API (OAuth 2.0)** with automatic event creation on booking, real-time update on reschedule, dual-party deletion on cancellation/leave, automatic retroactive sync on account connection, and 1-click direct Google Calendar web links.
- **Concurrency & Concurrency Control:** Enforced database unique constraint on `SlotLock(doctorId, slotStart)` to strictly eliminate race conditions and double-booking attempts under high load.

---

## Quick Start Setup Guide

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- npm

### 2. Backend Setup
```bash
cd backend

# 1. Copy environment template
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Initialize SQLite database & apply migrations
npx prisma db push

# 4. Seed database with Admin, Doctors across 15 specialisations, and sample Patient
npm run seed

# 5. Run test suite to verify all integrations (concurrency, AI, email, calendar, cron)
npm test

# 6. Start backend development server (defaults to http://localhost:4000)
npm run dev
```

### 3. Frontend Setup
```bash
cd ../frontend

# 1. Copy frontend environment template
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start Vite frontend dev server (runs on http://localhost:5173)
npm run dev
```

Open your browser and navigate to **`http://localhost:5173`**.

---

## Demo Accounts (Pre-Seeded)

| Role | Email | Password | Details |
|---|---|---|---|
| **Admin** | `admin@clinic.local` | `password123` | Full clinic management, leave scheduling, email audit logs |
| **Doctor** | `dr.mehta@clinic.local` | `password123` | Dr. Aisha Mehta (General Physician) |
| **Doctor** | `dr.rao@clinic.local` | `password123` | Dr. Karthik Rao (Dermatology) |
| **Doctor** | `dr.iyer@clinic.local` | `password123` | Dr. Priya Iyer (Cardiology) |
| **Patient** | `patient@example.com` | `password123` | Riya Sharma (Patient Portal) |

> Patients can also self-register at `/register`. Doctor and Admin accounts are provisioned exclusively through the Admin Panel.

---

## Gmail / Email Configuration Guide

The application supports multiple email providers configured in `backend/.env`.

### Setting up Gmail (Recommended for Live Email Testing)
1. Go to your **[Google Account Security Settings](https://myaccount.google.com/security)** and ensure **2-Step Verification** is enabled.
2. Visit **[Google App Passwords](https://myaccount.google.com/apppasswords)**.
3. Select App: **Mail**, Device: **Other (Custom name)** e.g., `Clinic App`, and click **Generate**.
4. Copy the generated 16-character password (e.g. `abcd efgh ijkl mnop`).
5. In `backend/.env`, set:
   ```env
   EMAIL_PROVIDER=gmail
   GMAIL_USER=your-actual-email@gmail.com
   GMAIL_APP_PASSWORD=abcdefghijklmnop
   SMTP_FROM="Meridian Clinic <your-actual-email@gmail.com>"
   EMAIL_ENABLED=true
   ```
6. Verify your connection in real time: Go to **Admin Panel > Notification Log > Send Test Email** to send an instant verification email!

### Setting up Generic SMTP / SendGrid / Resend
- **SendGrid / Mailgun / SMTP:**
  ```env
  EMAIL_PROVIDER=smtp
  SMTP_HOST=smtp.sendgrid.net
  SMTP_PORT=587
  SMTP_USER=apikey
  SMTP_PASS=your-sendgrid-api-key
  ```
- **Resend (HTTPS API - Ideal for Render Free Tier):**
  ```env
  EMAIL_PROVIDER=resend
  RESEND_API_KEY=re_xxxxxxxxxxxx
  SMTP_FROM="Meridian Clinic <onboarding@resend.dev>"
  ```
- **Dev-Mode Fallback:** If no credentials are configured, the platform logs all formatted HTML emails to the server console and durable `EmailLog` database table without throwing errors.

---

## Google Calendar API (OAuth 2.0) Setup Guide

To enable live bidirectional Google Calendar sync:

1. Go to the **[Google Cloud Console](https://console.cloud.google.com/)**.
2. Create a new project (e.g., `Meridian Clinic`).
3. Navigate to **APIs & Services > Library**, search for **Google Calendar API**, and click **Enable**.
4. Go to **APIs & Services > OAuth consent screen**:
   - User Type: **External**
   - App Name: `Meridian Clinic Appointment Manager`
   - User Support Email: your email
   - Developer Contact Email: your email
   - Under **Scopes**, add: `.../auth/calendar.events` and `.../auth/calendar`
   - Under **Test Users**, add your personal Google email.
5. Go to **APIs & Services > Credentials** > **Create Credentials** > **OAuth client ID**:
   - Application Type: **Web application**
   - Name: `Meridian Clinic Client`
   - Authorized JavaScript origins: `http://localhost:5173`
   - Authorized redirect URIs: `http://localhost:4000/api/calendar/oauth/callback`
6. Copy your **Client ID** and **Client Secret** into `backend/.env`:
   ```env
   CALENDAR_ENABLED=true
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/calendar/oauth/callback
   ```
7. In the application: Log in as any Patient or Doctor, open **Settings**, and click **"Connect Google Calendar"**.
8. All subsequent bookings, reschedules, and cancellations will automatically sync to Google Calendar. Furthermore, clicking **"Sync Appointments"** will automatically back-sync all existing upcoming confirmed appointments.

*(Note: Even if Google Calendar OAuth is unconfigured, patients and doctors receive 1-click **Add to Google Calendar** web links in confirmation emails and on their appointment cards).*

---

## AI / LLM Integration & Prompts

The system works out-of-the-box with zero keys using an intelligent clinical triage algorithm, or with live LLMs by setting `LLM_PROVIDER` in `backend/.env`:

```env
# Free tier via Google AI Studio (No credit card required): https://aistudio.google.com/apikey
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
```

### Exact Prompts Used (`backend/src/services/llm.service.js`)

1. **Pre-Visit Symptom Analysis Prompt:**
   > *"Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: `<symptoms>`"*
   - Returns structured JSON: `{ urgency: "Low" | "Medium" | "High", chiefComplaint: string, suggestedQuestions: string[] }`

2. **Post-Visit Patient Summary Prompt:**
   > *"Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: `<notes>`"*
   - Returns structured JSON: `{ summary: string, medicationSchedule: [{ medication: string, instructions: string }], followUpSteps: string[], dietAndLifestyle: string[], warningSigns: string[] }`

---

## Complete API Reference

All endpoints are prefixed with `/api`. Authenticated endpoints require `Authorization: Bearer <token>`.

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Patient self-registration `{ name, email, password, phone }`
- `POST /api/auth/login` — User login `{ email, password }`
- `GET /api/auth/me` — Current user profile & integration status

### Doctors (`/api/doctors`)
- `GET /api/doctors` — Search doctors by `?specialisation=`
- `GET /api/doctors/:id/slots?date=YYYY-MM-DD` — Real-time open slot computation
- `GET /api/doctors/me/profile` — Doctor's profile and working schedule *(Doctor only)*
- `GET /api/doctors/me/appointments` — Urgency-triaged patient queue *(Doctor only)*
- `POST /api/doctors/me/appointments/:id/complete` — Complete consultation, generate AI summary, and schedule medication reminders *(Doctor only)*

### Appointments (`/api/appointments`)
- `POST /api/appointments/hold` — Atomically reserve a slot for 5 minutes `{ doctorId, slotStart }`
- `POST /api/appointments/:id/pre-visit-summary` — Run AI symptom analysis `{ symptomsText }`
- `POST /api/appointments/:id/confirm` — Finalize booking, trigger dual-party emails & Google Calendar sync `{ symptomsText, preVisitSummary }`
- `POST /api/appointments/:id/reschedule` — Atomically move booking to new slot, update calendar events & notify parties `{ newSlotStart }`
- `POST /api/appointments/:id/cancel` — Cancel appointment, release slot lock, remove calendar events, notify parties `{ reason? }`
- `GET /api/appointments/mine` — Retrieve user's appointment history with pre/post-visit summaries

### Google Calendar (`/api/calendar`)
- `GET /api/calendar/status` — Returns configuration status
- `GET /api/calendar/oauth/start` — Generates signed Google OAuth 2.0 authorization URL
- `GET /api/calendar/oauth/callback` — Handles OAuth redirect, saves refresh token, and auto-syncs existing appointments
- `POST /api/calendar/sync` — Manually triggers retroactive calendar sync for user's confirmed appointments
- `POST /api/calendar/disconnect` — Disconnects Google account

### Administration (`/api/admin`)
- `POST /api/admin/doctors` — Provision doctor profile and working hours
- `GET /api/admin/doctors` — List all doctors and scheduled leaves
- `PATCH /api/admin/doctors/:id` — Update doctor profile
- `POST /api/admin/doctors/:id/leave` — Schedule leave date; cancels conflicting bookings, frees slots, and notifies affected patients
- `DELETE /api/admin/doctors/:id/leave/:date` — Remove scheduled leave
- `GET /api/admin/email-logs` — Audit log of all dispatched notification attempts
- `GET /api/admin/email-status` — Live email connection diagnostics
- `POST /api/admin/test-email` — Dispatches test email to verify SMTP / Gmail setup
- `POST /api/admin/email-logs/:id/retry` — Manually retry a failed email notification

---

## Database Schema Model

```prisma
model User {
  id                 String         @id @default(uuid())
  email              String         @unique
  passwordHash       String
  name               String
  phone              String?
  role               String         // "PATIENT" | "DOCTOR" | "ADMIN"
  googleRefreshToken String?        // OAuth 2.0 token
  createdAt          DateTime       @default(now())
  doctorProfile      DoctorProfile?
  appointments       Appointment[]  @relation("PatientAppointments")
}

model DoctorProfile {
  id                  String         @id @default(uuid())
  userId              String         @unique
  user                User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  specialisation      String
  bio                 String?
  slotDurationMinutes Int            @default(30)
  workStartMinutes    Int            @default(540)  // 09:00
  workEndMinutes      Int            @default(1020) // 17:00
  workingDays         String         @default("MON,TUE,WED,THU,FRI")
  leaves              DoctorLeave[]
  slotLocks           SlotLock[]
}

model SlotLock {
  id            String        @id @default(uuid())
  doctorId      String
  doctor        DoctorProfile @relation(fields: [doctorId], references: [id], onDelete: Cascade)
  slotStart     DateTime
  status        String        @default("HELD") // "HELD" | "CONFIRMED"
  appointmentId String?       @unique
  expiresAt     DateTime?     // Expiry for temporary holds
  @@unique([doctorId, slotStart])
}

model Appointment {
  id               String              @id @default(uuid())
  patientId        String
  doctorId         String
  slotStart        DateTime
  slotEnd          DateTime
  status           String              @default("HELD") // HELD, CONFIRMED, COMPLETED, CANCELLED, LEAVE_CANCELLED
  symptomsText     String?
  preVisitSummary  String?             // JSON: { urgency, chiefComplaint, suggestedQuestions }
  urgencyLevel     String?             // "Low" | "Medium" | "High"
  doctorNotes      String?
  prescriptionText String?
  postVisitSummary String?             // JSON: { summary, medicationSchedule, followUpSteps, etc. }
  calendarEvent    CalendarEvent?
  emailLogs        EmailLog[]
  reminders        MedicationReminder[]
}

model CalendarEvent {
  id             String      @id @default(uuid())
  appointmentId  String      @unique
  appointment    Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  patientEventId String?
  doctorEventId  String?
}

model EmailLog {
  id                   String       @id @default(uuid())
  toEmail              String
  subject              String
  body                 String
  type                 String       // BOOKING_CONFIRMATION, REMINDER, CANCELLATION, LEAVE_NOTICE, MEDICATION_REMINDER
  status               String       @default("PENDING") // PENDING, SENT, FAILED
  attempts             Int          @default(0)
  lastError            String?
  relatedAppointmentId String?
  createdAt            DateTime     @default(now())
}

model MedicationReminder {
  id             String      @id @default(uuid())
  appointmentId  String
  appointment    Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  patientId      String
  medicationText String
  frequencyHours Int
  nextRunAt      DateTime
  remainingCount Int         @default(1)
  status         String      @default("ACTIVE")
}
```

---

## Production Deployment Guide

### Deploying to Render / Railway / Vercel
1. **Database:** Create a managed PostgreSQL instance on **[Neon.tech](https://neon.tech)**, **Supabase**, or **Render**.
2. In `backend/prisma/schema.prisma`, change datasource provider:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Set environment variables on your host:
   - `DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require`
   - `JWT_SECRET=your-production-secret`
   - `FRONTEND_URL=https://your-frontend-domain.com`
   - `EMAIL_PROVIDER=resend` (or `gmail`)
   - `CALENDAR_ENABLED=true`
4. **Backend Build Command:** `npm install && npx prisma generate && npx prisma db push && npm run seed`
5. **Backend Start Command:** `npm start`
6. **Frontend:** Build with `npm run build` and deploy the `dist/` directory to Vercel/Netlify with `VITE_API_URL=https://your-backend-api.onrender.com/api`.
