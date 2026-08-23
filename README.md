# Meridian Clinic — Healthcare Appointment & Follow-up Manager

> 🌐 **Live Hosted Application:** [https://healthcare-appointment-manager-z3t2.onrender.com](https://healthcare-appointment-manager-1-ig40.onrender.com)(https://healthcare-appointment-manager-z3t2.onrender.com)  
> 🎥 **Demo Video Walkthrough (Google Drive):** [Click to Watch Demo Video](https://drive.google.com/file/d/YOUR_DRIVE_VIDEO_ID/view?usp=sharing)  
> 📂 **GitHub Repository:** [https://github.com/manasvikhare19/healthcare-appointment-manager](https://github.com/manasvikhare19/healthcare-appointment-manager) (Branch: `main` — Public & Downloadable)

---

## 📋 Table of Contents
1. [Submission Links & Demo Credentials](#submission-links--demo-credentials)
2. [Evaluation Focus & Architecture Deep-Dive](#-evaluation-focus-architecture-deep-dive)
   - [1. Slot Conflicts, Leave Management & Notification Reliability](#1-slot-conflicts-leave-management--notification-reliability)
   - [2. LLM Prompt Quality & Failure Handling](#2-llm-prompt-quality--failure-handling)
   - [3. Database Schema Design](#3-database-schema-design)
   - [4. API Design & Code Structure](#4-api-design--code-structure)
   - [5. Email & Google Calendar Integration](#5-email--google-calendar-integration)
3. [Technical Stack & Architecture](#technical-stack--architecture)
4. [Quick Start Setup Guide](#quick-start-setup-guide)
5. [Database Schema Model](#database-schema-model)
6. [Complete API Reference](#complete-api-reference)
7. [AI / LLM Integration & Prompts](#ai--llm-integration--prompts)
8. [Google Calendar & Email Notification Setup](#google-calendar--email-notification-setup)
9. [Automated Verification & Testing](#automated-verification--testing)

---

## 🔑 Submission Links & Demo Credentials

| Portal | URL Path | Demo Email | Demo Password |
| :--- | :--- | :--- | :--- |
| **Patient Portal** | `/login` or `/patient/dashboard` | `manasvikhare19@gmail.com` | `password123` |
| **Doctor Portal** | `/login` or `/doctor/dashboard` | `manasvikhare9@gmail.com` | `password123` |
| **Admin Portal** | `/login` or `/admin` | `admin@clinic.local` | `password123` |

---

## 🌟 Evaluation Focus: Architecture Deep-Dive

This section directly addresses the core evaluation criteria outlined in the project specification:

### 1. Slot Conflicts, Leave Management & Notification Reliability

#### A. Concurrency Safety & Double-Booking Prevention
- **The Problem:** The naive pattern (*"check availability then insert"*) has a race condition where simultaneous requests can both observe an empty slot before either writes, causing catastrophic double-booking.
- **Our Solution:** Concurrency serialization is enforced directly in the database engine using an atomic `SlotLock` table with a **`UNIQUE(doctorId, slotStart)`** constraint.
- **Mechanism:** Reserving a slot executes an atomic `INSERT` inside a database transaction. When concurrent requests attempt to reserve the same doctor slot:
  1. The database serializes the operations.
  2. Exactly one transaction acquires the unique constraint and commits (`200 OK`).
  3. The competing transaction fails immediately with unique violation code `P2002`.
  4. The backend catches this code and returns a graceful `409 Conflict` (*"This slot was just taken by another patient. Please choose a different time."*).

#### B. 2-Phase Slot Hold Protocol
- **Step 1 — Atomic Hold (`POST /api/appointments/hold`):** When a patient selects a slot, an atomic `SlotLock` and `Appointment` record are created with `status: 'HELD'` and `expiresAt: now() + 5 minutes`.
- **Step 2 — Confirmation (`POST /api/appointments/:id/confirm`):** Once symptoms are entered and the AI pre-visit summary is approved, the status is promoted to `CONFIRMED` and `expiresAt` is cleared.
- **Orphan Cleanup:** A background cron job (`slotLockCleanup.job.js`) runs every minute. Any abandoned holds (`expiresAt < now()`) are purged, returning the slot to the available pool.

#### C. Doctor Leave Conflict Resolution
- When an admin marks a doctor on leave for a date (`POST /api/admin/doctors/:id/leave`):
  1. **Audit Transition:** Conflicting appointments are updated to `LEAVE_CANCELLED`.
  2. **Lock Release:** Associated `SlotLock` records are purged.
  3. **Patient Alerts:** Urgent cancellation emails (`LEAVE_NOTICE`) are dispatched to each affected patient with direct rebooking links.
  4. **Calendar Sync:** Google Calendar events are automatically deleted via the Calendar API.

#### D. Notification Reliability
- **Durable Pre-Logging:** Every email notification is written to the database (`EmailLog` with `status: 'PENDING'`) *before* network dispatch. If a host crashes or network drops, the notification is preserved.
- **Automated Retry Engine:** A background cron job (`emailRetry.job.js`) retries failed emails up to 5 times with exponential backoff.
- **Admin Audit Log:** Admins have live visibility into sent, pending, and failed notifications with full error traces and 1-click manual retry.

---

### 2. LLM Prompt Quality & Failure Handling

#### A. Prompt Engineering & Alignment
- **Pre-Visit Triage Prompt:**
  > *"Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: `<symptoms>`"*
  - Returns structured JSON validated via Zod: `{ urgency: "Low" | "Medium" | "High", chiefComplaint: string, suggestedQuestions: string[] }`.
- **Post-Visit Summary Prompt:**
  > *"Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: `<notes>`"*
  - Returns structured JSON: `{ summary, keyTakeaways, medicationSchedule, followUpSteps, dietAndLifestyle, warningSigns }`.

#### B. Multi-Tier Provider & Graceful Failure Handling
- **Multi-Model Provider Support:** Compatible with **Google Gemini 1.5 Flash / 2.0 Flash**, **Anthropic Claude 3.5 Sonnet**, and **OpenAI GPT-4o-mini**.
- **Deterministic Offline Fallback:** Per the requirement (*"LLM failures must be handled gracefully, system should not break"*), if an LLM key is missing, invalid, or rate-limited, the system executes an intelligent rule-based clinical parser:
  - Detects high-acuity indicators (`chest pain`, `shortness of breath`, `bleeding`) &rarr; `High` Urgency.
  - Detects moderate indicators (`fever`, `vomiting`, `infection`) &rarr; `Medium` Urgency.
  - Parses medication schedules (`every 8 hours`, `twice daily`, `for 5 days`) deterministically.
  - **Result:** 100% platform availability with zero crashes.

---

### 3. Database Schema Design

The Prisma database schema is designed with strict separation of concerns:
- **Decoupled Lifecycle:** Clinical data (`Appointment`) is decoupled from concurrency locking (`SlotLock`). When an appointment is cancelled or rescheduled, its `SlotLock` is freed while the medical record and audit trail remain intact.
- **Audit Logging:** Every email attempt is stored in `EmailLog` with status, attempt counters, and error traces.
- **Medication Scheduling:** Prescriptions generate discrete `MedicationReminder` records with calculated `nextRunAt` timestamps for automated background dispatch.
- **OAuth Token Storage:** Encrypted Google OAuth refresh tokens are stored per user for automated background calendar synchronisation.

---

### 4. API Design & Code Structure

- **Layered Clean Architecture:**
  - **Routes Layer (`src/routes/`):** Express routing with Zod schema validation.
  - **Middleware Layer (`src/middleware/`):** JWT authentication, role guards (`requireRole('PATIENT' | 'DOCTOR' | 'ADMIN')`), rate limiting, and centralized async error handling.
  - **Service Layer (`src/services/`):** Encapsulated business logic (`slot.service.js`, `llm.service.js`, `email.service.js`, `calendar.service.js`, `assistant.service.js`).
  - **Background Engine (`src/jobs/`):** Scheduled cron workers for slot cleanup, email retries, 24-hour visit reminders, and prescription medication alerts.

---

### 5. Email & Google Calendar Integration

- **Multi-Provider Email Engine:**
  - Native **Gmail App Password** support (16-char app credentials).
  - Standard **SMTP** (SendGrid, Mailgun, AWS SES).
  - **Resend HTTPS API** with automatic Sandbox domain fallback to ensure delivery on cloud hosts like Render that restrict outbound SMTP ports (587/465).
- **Bidirectional Google Calendar:**
  - **OAuth 2.0:** Auto-creates events on booking for both patient and doctor calendars.
  - **Lifecycle Updates:** Updates calendar event times on reschedule and deletes events on cancellation or doctor leave.
  - **Retroactive Sync:** Automatically back-syncs existing appointments when a user connects their Google account.
  - **1-Click Web Links:** In-app direct Google Calendar links (`calendar.google.com/render?...`) embedded in confirmation emails and cards for zero-config calendar addition.

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
