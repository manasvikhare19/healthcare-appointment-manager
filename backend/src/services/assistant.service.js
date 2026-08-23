/**
 * Assistant Service
 * -----------------
 * A role-aware in-app chatbot. It does NOT require an LLM key to be useful:
 * common questions/actions for each role are handled by pattern-matching
 * against real data (appointments, doctors, leave, email health) so the
 * bot is genuinely useful out of the box, same philosophy as llm.service.js.
 *
 * If an LLM provider IS configured, unmatched questions are handed off to
 * it with a short role-appropriate context so the bot can answer more
 * open-ended questions too. If that call fails or no provider is set, we
 * fall back to a helpful "I didn't catch that" message with suggestions —
 * the chatbot should never throw and never leave the user stuck.
 *
 * The bot intentionally does NOT perform destructive actions (cancelling,
 * booking) directly — it points the user to the right screen instead.
 * That keeps a fuzzy natural-language interface from ever mis-firing an
 * irreversible action on someone's medical appointment.
 */
const prisma = require('../config/prisma');
const { LLM_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY } = require('../config/env');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(dt) {
  return new Date(dt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------- PATIENT intents ----------

async function patientIntents(message, user) {
  const m = message.toLowerCase();

  if (/\b(next|upcoming) appointment\b|\bmy appointments\b|\bwhat.*booked\b/.test(m)) {
    const appts = await prisma.appointment.findMany({
      where: { patientId: user.id, status: { in: ['HELD', 'CONFIRMED'] }, slotStart: { gte: new Date() } },
      include: { doctor: { include: { user: true } } },
      orderBy: { slotStart: 'asc' },
      take: 5,
    });
    if (appts.length === 0) {
      return {
        reply: "You don't have any upcoming appointments. Want to find a doctor?",
        quickReplies: ['Find a dermatologist', 'Find a cardiologist', 'Show all specialisations'],
      };
    }
    const lines = appts.map((a) => `• Dr. ${a.doctor.user.name} (${a.doctor.specialisation}) — ${fmt(a.slotStart)} [${a.status}]`);
    return { reply: `Here's what's on your calendar:\n${lines.join('\n')}`, quickReplies: ['Cancel an appointment', 'My prescriptions'] };
  }

  if (/\bcancel\b/.test(m)) {
    return {
      reply:
        "For your safety, I won't cancel appointments directly from chat — please open **My Appointments** and use the Cancel button there. Want me to show what's currently booked first?",
      quickReplies: ['Show my appointments'],
    };
  }

  if (/\bprescription|medication|medicine\b/.test(m)) {
    const appt = await prisma.appointment.findFirst({
      where: { patientId: user.id, status: 'COMPLETED', postVisitSummary: { not: null } },
      orderBy: { slotStart: 'desc' },
    });
    if (!appt) return { reply: "You don't have any prescriptions on file yet.", quickReplies: ['Show my appointments'] };
    const summary = JSON.parse(appt.postVisitSummary);
    const meds = summary.medicationSchedule || [];
    if (meds.length === 0) return { reply: 'Your most recent visit summary has no medication listed.', quickReplies: [] };
    const lines = meds.map((mm) => `• ${mm.medication} — ${mm.instructions}`);
    return { reply: `From your most recent visit:\n${lines.join('\n')}`, quickReplies: ['Show my appointments'] };
  }

  // Direct specialisation mention, in any phrasing ("find a dermatologist",
  // "dermatologist near me", "I need a cardiologist", etc.) — no longer
  // requires the word "find" right before it.
  const specMatch = m.match(/\b(dermatolog\w*|cardiolog\w*|pediatric\w*|orthoped\w*|gynec\w*|psychiatr\w*|ent\b|neurolog\w*|gastroenterolog\w*|endocrinolog\w*|ophthalmolog\w*|urolog\w*|pulmonolog\w*|dent\w*|general physician|physician)\b/);

  // Symptom-based routing: people rarely know the specialisation name, they
  // describe what's wrong ("I have a skin rash", "my chest hurts"). Map
  // common symptom words/phrases to the right specialisation.
  const SYMPTOM_TO_SPECIALTY = [
    { pattern: /\b(skin|rash|acne|eczema|itch\w*|hives|mole)\b/, specialty: 'dermatolog', label: 'a dermatologist' },
    { pattern: /\b(chest pain|heart|palpitation|blood pressure|hypertension)\b/, specialty: 'cardiolog', label: 'a cardiologist' },
    { pattern: /\b(child|infant|baby|kid|toddler)\b/, specialty: 'pediatric', label: 'a pediatrician' },
    { pattern: /\b(joint|bone|fracture|sprain|back pain|knee|shoulder|hip)\b/, specialty: 'orthoped', label: 'an orthopedist' },
    { pattern: /\b(pregnan\w*|period|menstrual|gynec\w*)\b/, specialty: 'gynec', label: 'a gynecologist' },
    { pattern: /\b(anxiety|depress\w*|stress|mental health|panic)\b/, specialty: 'psychiatr', label: 'a psychiatrist' },
    { pattern: /\b(ear|nose|throat|sinus|hearing)\b/, specialty: 'ent', label: 'an ENT specialist' },
    { pattern: /\b(headache|migraine|seizure|numbness|memory loss|dizz\w*)\b/, specialty: 'neurolog', label: 'a neurologist' },
    { pattern: /\b(stomach|abdomen|digestion|acid reflux|nausea|vomit\w*|diarrhea)\b/, specialty: 'gastroenterolog', label: 'a gastroenterologist' },
    { pattern: /\b(diabet\w*|thyroid|hormone)\b/, specialty: 'endocrinolog', label: 'an endocrinologist' },
    { pattern: /\b(eye|vision|blurry)\b/, specialty: 'ophthalmolog', label: 'an ophthalmologist' },
    { pattern: /\b(urinat\w*|bladder|kidney stone)\b/, specialty: 'urolog', label: 'a urologist' },
    { pattern: /\b(cough|breath\w*|asthma|lung)\b/, specialty: 'pulmonolog', label: 'a pulmonologist' },
    { pattern: /\b(tooth|teeth|gum|dental|cavity)\b/, specialty: 'dent', label: 'a dentist' },
  ];
  const symptomMatch = !specMatch && SYMPTOM_TO_SPECIALTY.find((s) => s.pattern.test(m));

  // If the person is clearly asking for guidance ("whom should I consult",
  // "what doctor do I need") but described no recognisable symptom, ask a
  // clarifying question instead of falling through to "I'm not sure".
  const wantsRecommendation =
    /\bwhom?\b.*\bconsult\b|\bwho\b.*\bconsult\b|\bwhich doctor\b|\bwhat (kind of )?doctor\b|\bwho.*should i (see|consult|talk to)\b/.test(m);
  if (!specMatch && !symptomMatch && wantsRecommendation) {
    return {
      reply: "I can help point you to the right specialist — could you tell me a bit more about your symptoms (e.g. 'skin rash', 'chest pain', 'tooth ache')?",
      quickReplies: ['Show all specialisations'],
    };
  }

  if (specMatch || symptomMatch || /\bfind a doctor\b|\bbook\b.*\bappointment\b|\bsearch doctor\b/.test(m)) {
    const specKeyword = specMatch
      ? specMatch[1].replace(/\w*$/, '').slice(0, 6)
      : symptomMatch ? symptomMatch.specialty : null;
    const doctors = await prisma.doctorProfile.findMany({
      where: specKeyword ? { specialisation: { contains: specKeyword } } : undefined,
      include: { user: true },
      take: 4,
    });
    if (doctors.length === 0) {
      return { reply: "I couldn't find a doctor matching that specialisation — try the Find a Doctor page to browse everyone.", quickReplies: ['Show all specialisations'] };
    }
    const lines = doctors.map((d) => `• Dr. ${d.user.name} — ${d.specialisation}${d.bio ? `\n   ${d.bio}` : ''}`);
    const intro = symptomMatch
      ? `Based on what you described, I'd suggest ${symptomMatch.label}. Here's who's available:`
      : `Here's who I found:`;
    return {
      reply: `${intro}\n${lines.join('\n')}\n\nHead to **Find a Doctor** to view live availability and book.`,
      quickReplies: ['Show my appointments'],
    };
  }

  if (/\bhow.*(booking|book).*work\b|\bhow.*it work\b/.test(m)) {
    return {
      reply:
        'Booking is simple: search for a doctor by specialisation, pick an open time slot (it\'s held for you for a few minutes), describe your symptoms, review the AI pre-visit summary, then confirm. You\'ll get an email and calendar invite once confirmed.',
      quickReplies: ['Find a doctor', 'Show my appointments'],
    };
  }

  return null;
}

// ---------- DOCTOR intents ----------

async function doctorIntents(message, user) {
  const m = message.toLowerCase();
  const profile = await prisma.doctorProfile.findUnique({ where: { userId: user.id } });
  if (!profile) return { reply: "I couldn't find your doctor profile — please contact the clinic admin.", quickReplies: [] };

  if (/\btoday\b|\bqueue\b|\bschedule\b|\bpatients\b/.test(m)) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const appts = await prisma.appointment.findMany({
      where: { doctorId: profile.id, status: 'CONFIRMED', slotStart: { gte: start, lte: end } },
      include: { patient: true },
      orderBy: { slotStart: 'asc' },
    });
    if (appts.length === 0) return { reply: "You have no confirmed appointments today.", quickReplies: [] };
    const urgencyRank = { High: 0, Medium: 1, Low: 2 };
    appts.sort((a, b) => (urgencyRank[a.urgencyLevel] ?? 3) - (urgencyRank[b.urgencyLevel] ?? 3));
    const high = appts.filter((a) => a.urgencyLevel === 'High').length;
    const lines = appts.map((a) => `• ${fmt(a.slotStart).split(', ').slice(1).join(', ')} — ${a.patient.name} [${a.urgencyLevel || 'Low'}]`);
    return {
      reply: `You have ${appts.length} patient${appts.length > 1 ? 's' : ''} today (${high} high priority):\n${lines.join('\n')}`,
      quickReplies: ['How many high priority today?'],
    };
  }

  if (/\bhigh priority|urgent\b/.test(m)) {
    const appts = await prisma.appointment.findMany({
      where: { doctorId: profile.id, status: 'CONFIRMED', urgencyLevel: 'High', slotStart: { gte: new Date() } },
      include: { patient: true },
      orderBy: { slotStart: 'asc' },
    });
    if (appts.length === 0) return { reply: 'No high-priority patients on your upcoming schedule.', quickReplies: [] };
    const lines = appts.map((a) => `• ${a.patient.name} — ${fmt(a.slotStart)}`);
    return { reply: `High priority upcoming:\n${lines.join('\n')}`, quickReplies: [] };
  }

  if (/\bleave\b/.test(m)) {
    return { reply: 'Leave days are managed by the clinic admin — reach out to them to block a date on your calendar.', quickReplies: [] };
  }

  if (/\burgency|triage\b/.test(m)) {
    return {
      reply:
        'Urgency levels come from the AI pre-visit summary based on the patient\'s reported symptoms: High (possible emergency indicators), Medium (concerning but not acute), Low (routine). Always use clinical judgment over the label.',
      quickReplies: ['Show today\'s queue'],
    };
  }

  return null;
}

// ---------- ADMIN intents ----------

async function adminIntents(message) {
  const m = message.toLowerCase();

  if (/\bon leave\b.*today\b|\bwho.*leave today\b/.test(m)) {
    const leaves = await prisma.doctorLeave.findMany({
      where: { date: todayStr() },
      include: { doctor: { include: { user: true } } },
    });
    if (leaves.length === 0) return { reply: 'No doctors are on leave today.', quickReplies: [] };
    const lines = leaves.map((l) => `• Dr. ${l.doctor.user.name} (${l.doctor.specialisation})${l.reason ? ` — ${l.reason}` : ''}`);
    return { reply: `On leave today:\n${lines.join('\n')}`, quickReplies: [] };
  }

  if (/\bappointments today\b|\bhow many appointments\b/.test(m)) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const count = await prisma.appointment.count({
      where: { slotStart: { gte: start, lte: end }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
    });
    return { reply: `There are ${count} appointment${count === 1 ? '' : 's'} scheduled today.`, quickReplies: [] };
  }

  if (/\bhow many doctors\b|\bdoctor count\b/.test(m)) {
    const count = await prisma.doctorProfile.count();
    return { reply: `There are currently ${count} doctors in the system.`, quickReplies: ['Who is on leave today?'] };
  }

  if (/\bfailed email|email health|notification\b/.test(m)) {
    const [failed, pending, sent] = await Promise.all([
      prisma.emailLog.count({ where: { status: 'FAILED' } }),
      prisma.emailLog.count({ where: { status: 'PENDING' } }),
      prisma.emailLog.count({ where: { status: 'SENT' } }),
    ]);
    return {
      reply: `Email status — Sent: ${sent}, Pending: ${pending}, Failed: ${failed}.${failed > 0 ? ' Failed emails are automatically retried by the background job.' : ''}`,
      quickReplies: [],
    };
  }

  if (/\badd a doctor|new doctor|create doctor\b/.test(m)) {
    return {
      reply: 'Go to the Admin panel → Doctors tab → "Add Doctor", and fill in their specialisation, working hours, slot duration, and working days.',
      quickReplies: [],
    };
  }

  return null;
}

// ---------- LLM fallback for unmatched questions (optional) ----------

async function llmFallback(message, role) {
  if (LLM_PROVIDER === 'none' || (!ANTHROPIC_API_KEY && !OPENAI_API_KEY && !GEMINI_API_KEY)) return null;
  const prompt =
    `You are a helpful assistant inside a healthcare appointment app, talking to a user with the role "${role}". ` +
    `Answer briefly (2-3 sentences max) and only about using the app or general non-diagnostic guidance. ` +
    `Never give a medical diagnosis. If asked something clearly outside the app's scope, say you can only help with appointment-related questions.\n\nUser: ${message}`;
  try {
    if (LLM_PROVIDER === 'anthropic' && ANTHROPIC_API_KEY) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const text = (data.content || []).map((b) => b.text || '').join('');
      return text || null;
    }
    if (LLM_PROVIDER === 'openai' && OPENAI_API_KEY) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3 }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || null;
    }
    if (LLM_PROVIDER === 'gemini' && GEMINI_API_KEY) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
          }),
        }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return text || null;
    }
  } catch (err) {
    console.error('[assistant.service] llmFallback failed:', err.message);
  }
  return null;
}

const DEFAULT_QUICK_REPLIES = {
  PATIENT: ['Show my appointments', 'Find a dermatologist', 'How does booking work?'],
  DOCTOR: ["Show today's queue", 'How many high priority today?', 'What do urgency levels mean?'],
  ADMIN: ['Who is on leave today?', 'How many appointments today?', 'Email health'],
};

async function handleMessage({ message, user }) {
  const trimmed = (message || '').trim();
  if (!trimmed) return { reply: 'Go ahead, ask me something!', quickReplies: DEFAULT_QUICK_REPLIES[user.role] || [] };

  let result = null;
  if (user.role === 'PATIENT') result = await patientIntents(trimmed, user);
  else if (user.role === 'DOCTOR') result = await doctorIntents(trimmed, user);
  else if (user.role === 'ADMIN') result = await adminIntents(trimmed);

  if (result) return result;

  const llmText = await llmFallback(trimmed, user.role);
  if (llmText) return { reply: llmText, quickReplies: DEFAULT_QUICK_REPLIES[user.role] || [], generatedBy: LLM_PROVIDER };

  return {
    reply: "I'm not sure about that one yet. Here's what I can help with:",
    quickReplies: DEFAULT_QUICK_REPLIES[user.role] || [],
  };
}

module.exports = { handleMessage };