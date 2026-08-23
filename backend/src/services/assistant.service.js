/**
 * Assistant Service
 * -----------------
 * A role-aware in-app chatbot. Handles common clinical and navigation
 * questions with high-accuracy symptom-to-specialist matching and database
 * lookups across all 15 medical departments.
 */
const prisma = require('../config/prisma');
const { LLM_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY } = require('../config/env');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(dt) {
  return new Date(dt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Comprehensive mapping from patient symptoms to department and specialist label
const SYMPTOM_TO_SPECIALTY = [
  // General symptoms & infectious (fever, cough + fever, weakness)
  { pattern: /\b(fever|chills|cold|flu|viral|weakness|fatigue|body ache|shivering|infection|malaise)\b/, dbKeyword: 'General Physician', label: 'a General Physician' },
  // Respiratory / Pulmonology
  { pattern: /\b(cough|breath\w*|asthma|lung|chest congestion|wheezing|bronchitis|shortness of breath)\b/, dbKeyword: 'Pulmonology', label: 'a Pulmonologist' },
  // Neurology
  { pattern: /\b(headache|migraine|seizure|numbness|memory loss|dizz\w*|nerve|vertigo|paralysis)\b/, dbKeyword: 'Neurology', label: 'a Neurologist' },
  // Dermatology
  { pattern: /\b(skin|rash|acne|eczema|itch\w*|hives|mole|pimples|allergy|dermatitis|hair loss|scalp)\b/, dbKeyword: 'Dermatology', label: 'a Dermatologist' },
  // Cardiology
  { pattern: /\b(chest pain|heart|palpitation|blood pressure|hypertension|bp|cholesterol|angina)\b/, dbKeyword: 'Cardiology', label: 'a Cardiologist' },
  // Pediatrics
  { pattern: /\b(child|infant|baby|kid|toddler|newborn|pediatric|vaccination)\b/, dbKeyword: 'Pediatrics', label: 'a Pediatrician' },
  // Orthopedics
  { pattern: /\b(joint|bone|fracture|sprain|back pain|knee|shoulder|hip|arthritis|spine|muscle pain)\b/, dbKeyword: 'Orthopedics', label: 'an Orthopedic Specialist' },
  // Gynecology
  { pattern: /\b(pregnan\w*|period|menstrual|gynec\w*|pcos|cramps|fertility|ovary|uterus)\b/, dbKeyword: 'Gynecology', label: 'a Gynecologist' },
  // Psychiatry
  { pattern: /\b(anxiety|depress\w*|stress|mental health|panic|insomnia|sleep|mood|bipolar)\b/, dbKeyword: 'Psychiatry', label: 'a Psychiatrist' },
  // ENT
  { pattern: /\b(ear|nose|throat|sinus|hearing|sore throat|tonsil|voice|hoarseness|earache|tinnitus)\b/, dbKeyword: 'ENT', label: 'an ENT Specialist' },
  // Gastroenterology
  { pattern: /\b(stomach|abdomen|digestion|acid reflux|nausea|vomit\w*|diarrhea|constipation|acidity|gas|bloating|ulcer|liver|gut)\b/, dbKeyword: 'Gastroenterology', label: 'a Gastroenterologist' },
  // Endocrinology
  { pattern: /\b(diabet\w*|sugar|thyroid|hormone|weight loss|weight gain|pms|metabolism)\b/, dbKeyword: 'Endocrinology', label: 'an Endocrinologist' },
  // Ophthalmology
  { pattern: /\b(eye|vision|blurry|red eye|spectacles|cataract|glaucoma|dry eye)\b/, dbKeyword: 'Ophthalmology', label: 'an Ophthalmologist' },
  // Urology
  { pattern: /\b(urinat\w*|bladder|kidney stone|urine|prostate|uti)\b/, dbKeyword: 'Urology', label: 'a Urologist' },
  // Dentistry
  { pattern: /\b(tooth|teeth|gum|dental|cavity|toothache|root canal|bleeding gums)\b/, dbKeyword: 'Dentistry', label: 'a Dentist' },
];

const SPECIALTY_DIRECT_MATCH = [
  { pattern: /\b(general physician|physician|general doctor|internal medicine|gp)\b/, dbKeyword: 'General Physician', label: 'a General Physician' },
  { pattern: /\b(dermatolog\w*|skin specialist)\b/, dbKeyword: 'Dermatology', label: 'a Dermatologist' },
  { pattern: /\b(cardiolog\w*|heart specialist)\b/, dbKeyword: 'Cardiology', label: 'a Cardiologist' },
  { pattern: /\b(pediatric\w*|child specialist)\b/, dbKeyword: 'Pediatrics', label: 'a Pediatrician' },
  { pattern: /\b(orthoped\w*|bone specialist)\b/, dbKeyword: 'Orthopedics', label: 'an Orthopedic Specialist' },
  { pattern: /\b(gynec\w*|women specialist|obstetric\w*)\b/, dbKeyword: 'Gynecology', label: 'a Gynecologist' },
  { pattern: /\b(psychiatr\w*|therapist|psychologist)\b/, dbKeyword: 'Psychiatry', label: 'a Psychiatrist' },
  { pattern: /\b(ent\b|ear nose throat)\b/, dbKeyword: 'ENT', label: 'an ENT Specialist' },
  { pattern: /\b(neurolog\w*|brain specialist)\b/, dbKeyword: 'Neurology', label: 'a Neurologist' },
  { pattern: /\b(gastroenterolog\w*|gastro\b|stomach specialist)\b/, dbKeyword: 'Gastroenterology', label: 'a Gastroenterologist' },
  { pattern: /\b(endocrinolog\w*|thyroid specialist|hormone specialist)\b/, dbKeyword: 'Endocrinology', label: 'an Endocrinologist' },
  { pattern: /\b(ophthalmolog\w*|eye specialist)\b/, dbKeyword: 'Ophthalmology', label: 'an Ophthalmologist' },
  { pattern: /\b(urolog\w*|kidney specialist)\b/, dbKeyword: 'Urology', label: 'a Urologist' },
  { pattern: /\b(pulmonolog\w*|chest specialist|lung specialist)\b/, dbKeyword: 'Pulmonology', label: 'a Pulmonologist' },
  { pattern: /\b(dent\w*|tooth specialist)\b/, dbKeyword: 'Dentistry', label: 'a Dentist' },
];

// ---------- PATIENT intents ----------

async function patientIntents(message, user) {
  const m = message.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|namaste)\b/.test(m)) {
    return {
      reply: "Hello! I'm here to help you navigate Meridian Clinic. You can tell me your symptoms (e.g. 'fever', 'cough', 'headache'), ask to find a doctor, or check your appointments.",
      quickReplies: ['Find a doctor for fever', 'Show my appointments', 'Show all specialisations'],
    };
  }

  // Show all specialisations / departments
  if (/\b(all specialis\w*|all specialt\w*|departments|list.*doctors|what doctors|who is available)\b/.test(m)) {
    const doctors = await prisma.doctorProfile.findMany({ include: { user: true } });
    const specs = [...new Set(doctors.map((d) => d.specialisation))];
    return {
      reply: `Meridian Clinic has specialists across ${specs.length} medical departments:\n${specs.map((s) => `• ${s}`).join('\n')}\n\nType any symptom or department to see available doctors!`,
      quickReplies: ['General Physician', 'Dermatology', 'Cardiology', 'Pediatrics'],
    };
  }

  // My Appointments
  if (/\b(next|upcoming) appointment\b|\bmy appointments\b|\bwhat.*booked\b|\bview.*appointment\b/.test(m)) {
    const appts = await prisma.appointment.findMany({
      where: { patientId: user.id, status: { in: ['HELD', 'CONFIRMED'] }, slotStart: { gte: new Date() } },
      include: { doctor: { include: { user: true } } },
      orderBy: { slotStart: 'asc' },
      take: 5,
    });
    if (appts.length === 0) {
      return {
        reply: "You don't have any upcoming appointments on your calendar right now. Would you like to book one?",
        quickReplies: ['Find a doctor for fever', 'Find a dermatologist', 'Show all specialisations'],
      };
    }
    const lines = appts.map((a) => `• Dr. ${a.doctor.user.name} (${a.doctor.specialisation}) — ${fmt(a.slotStart)} [${a.status}]`);
    return { reply: `Here are your scheduled appointments:\n${lines.join('\n')}`, quickReplies: ['Show my appointments', 'My prescriptions'] };
  }

  // Cancellation guidance
  if (/\bcancel\b/.test(m)) {
    return {
      reply:
        "To cancel an appointment safely, navigate to **My Appointments** and click the **Cancel** button next to your booking. This will instantly release your slot.",
      quickReplies: ['Show my appointments'],
    };
  }

  // Prescriptions / Medication
  if (/\bprescription|medication|medicine\b/.test(m)) {
    const appt = await prisma.appointment.findFirst({
      where: { patientId: user.id, status: 'COMPLETED', postVisitSummary: { not: null } },
      orderBy: { slotStart: 'desc' },
    });
    if (!appt) return { reply: "You don't have any completed prescriptions on file yet.", quickReplies: ['Show my appointments'] };
    const summary = JSON.parse(appt.postVisitSummary);
    const meds = summary.medicationSchedule || [];
    if (meds.length === 0) return { reply: 'Your most recent visit summary has no medication listed.', quickReplies: ['Show my appointments'] };
    const lines = meds.map((mm) => `• ${mm.medication} — ${mm.instructions}`);
    return { reply: `From your most recent visit:\n${lines.join('\n')}`, quickReplies: ['Show my appointments'] };
  }

  // Urgency triage explanation
  if (/\burgency|triage|priority\b/.test(m)) {
    return {
      reply:
        "When you describe symptoms, our AI triage evaluates them into 3 clinical urgency levels:\n• 🔴 **High**: Acute/urgent symptoms requiring prompt attention.\n• 🟡 **Medium**: Moderate symptoms needing evaluation.\n• 🟢 **Low**: Routine/mild complaints.",
      quickReplies: ['Find a doctor', 'How does booking work?'],
    };
  }

  // How booking works
  if (/\bhow.*(booking|book).*work\b|\bhow.*it work\b/.test(m)) {
    return {
      reply:
        "Booking is quick and seamless:\n1. Search for a doctor by department or symptoms.\n2. Pick an open time slot (it's held for 5 minutes).\n3. Enter your symptoms to receive an instant AI pre-visit briefing.\n4. Confirm to get automatic email & Google Calendar confirmation!",
      quickReplies: ['Find a doctor', 'Show my appointments'],
    };
  }

  // 1. Check direct specialty match (e.g. "dermatologist", "cardiologist", "physician")
  const specMatch = SPECIALTY_DIRECT_MATCH.find((s) => s.pattern.test(m));

  // 2. Check symptom match (e.g. "cough and fever", "fever", "headache", "throat")
  const symptomMatch = !specMatch && SYMPTOM_TO_SPECIALTY.find((s) => s.pattern.test(m));

  if (specMatch || symptomMatch || /\bfind a doctor\b|\bbook\b.*\bappointment\b|\bsearch doctor\b/.test(m)) {
    const targetDbKeyword = specMatch ? specMatch.dbKeyword : symptomMatch ? symptomMatch.dbKeyword : null;
    const doctors = await prisma.doctorProfile.findMany({
      where: targetDbKeyword ? { specialisation: { contains: targetDbKeyword } } : undefined,
      include: { user: true },
      take: 4,
    });

    if (doctors.length === 0) {
      const fallbackDoctors = await prisma.doctorProfile.findMany({ include: { user: true }, take: 3 });
      const lines = fallbackDoctors.map((d) => `• Dr. ${d.user.name} — ${d.specialisation}`);
      return {
        reply: `Here are doctors currently available at Meridian Clinic:\n${lines.join('\n')}\n\nGo to **Find a Doctor** to choose a slot and book.`,
        quickReplies: ['Show all specialisations', 'Show my appointments'],
      };
    }

    const lines = doctors.map((d) => `• Dr. ${d.user.name} — ${d.specialisation}${d.bio ? ` (${d.bio})` : ''}`);
    const intro = symptomMatch
      ? `For **${m}**, we recommend consulting **${symptomMatch.label}** (${symptomMatch.dbKeyword}):`
      : specMatch
      ? `Here are our specialists in **${specMatch.dbKeyword}**:`
      : `Here are available doctors:`;

    return {
      reply: `${intro}\n${lines.join('\n')}\n\nClick **Find a Doctor** in the top navigation to select a slot and book your visit!`,
      quickReplies: ['Show my appointments', 'Show all specialisations'],
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
        "Urgency levels come from the AI pre-visit summary based on the patient's reported symptoms: High (possible emergency indicators), Medium (concerning but not acute), Low (routine). Always use clinical judgment over the label.",
      quickReplies: ["Show today's queue"],
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

// ---------- LLM fallback for unmatched open-ended questions ----------

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
      const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
      for (const model of models) {
        try {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
              }),
            }
          );
          if (!resp.ok) continue;
          const data = await resp.json();
          const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
          if (text) return text;
        } catch (e) {}
      }
      return null;
    }
  } catch (err) {
    console.error('[assistant.service] llmFallback failed:', err.message);
  }
  return null;
}

const DEFAULT_QUICK_REPLIES = {
  PATIENT: ['Find a doctor for fever', 'Show my appointments', 'Show all specialisations'],
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
    reply: "I'm not sure about that one yet. You can describe your symptoms (e.g. 'cough and fever', 'headache'), search for specialists, or check your appointments.",
    quickReplies: DEFAULT_QUICK_REPLIES[user.role] || [],
  };
}

module.exports = { handleMessage };
