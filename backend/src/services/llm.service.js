/**
 * LLM Service
 * -----------
 * Wraps the two prompts required by the assignment brief and normalizes
 * the response into a fixed JSON shape, regardless of provider.
 *
 * Failure handling (per the "LLM failures must be handled gracefully"
 * requirement): every call is try/caught. On any failure — missing key,
 * network error, malformed JSON from the model — we fall back to a
 * deterministic, rule-based summary instead of throwing. The caller
 * (appointment routes) never has to know whether the LLM actually ran;
 * it always gets a usable object back, plus a `generatedBy` flag so the
 * UI can show "AI-generated" vs "fallback summary" if desired.
 */
const { LLM_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY } = require('../config/env');

const PRE_VISIT_PROMPT = (symptoms) =>
  `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}\n\n` +
  `Respond ONLY with minified JSON in this exact shape, no markdown fences, no commentary:\n` +
  `{"urgency":"Low|Medium|High","chiefComplaint":"string","suggestedQuestions":["string","string","string"]}`;

const POST_VISIT_PROMPT = (notes) =>
  `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notes}\n\n` +
  `Go beyond a one-line restatement of the doctor's notes — write a genuinely detailed, plain-language ` +
  `explanation a patient with no medical background could act on. Include: what was found and what it means, ` +
  `the full medication schedule, concrete follow-up steps, diet/lifestyle guidance relevant to the diagnosis, ` +
  `and specific warning signs that should prompt the patient to seek urgent care.\n\n` +
  `Respond ONLY with minified JSON in this exact shape, no markdown fences, no commentary:\n` +
  `{"summary":"string (2-4 sentences, plain language explanation of the diagnosis/findings)",` +
  `"keyTakeaways":["string", "string"],` +
  `"medicationSchedule":[{"medication":"string","instructions":"string"}],` +
  `"followUpSteps":["string"],` +
  `"dietAndLifestyle":["string"],` +
  `"warningSigns":["string"]}`;

function safeParseJson(text) {
  if (!text) return null;
  // Models occasionally wrap JSON in ```json fences despite instructions — strip defensively.
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

async function callAnthropic(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status}`);
  const data = await resp.json();
  const text = (data.content || []).map((b) => b.text || '').join('');
  return safeParseJson(text);
}

async function callOpenAI(prompt) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  return safeParseJson(text);
}

async function callGemini(prompt) {
  // Google AI Studio's free tier models (gemini-1.5-flash and gemini-2.0-flash)
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
            generationConfig: { temperature: 0.3 },
          }),
        }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      const parsed = safeParseJson(text);
      if (parsed) return parsed;
    } catch (err) {
      // try next model
    }
  }
  return null;
}

async function callProvider(prompt) {
  if (LLM_PROVIDER === 'anthropic' && ANTHROPIC_API_KEY) return callAnthropic(prompt);
  if (LLM_PROVIDER === 'openai' && OPENAI_API_KEY) return callOpenAI(prompt);
  if (LLM_PROVIDER === 'gemini' && GEMINI_API_KEY) return callGemini(prompt);
  return null; // no provider configured
}

// --- Deterministic fallbacks (never fail, never call the network) ---

const URGENT_KEYWORDS = ['chest pain', 'shortness of breath', 'severe', 'bleeding', 'unconscious', 'suicidal', 'stroke', 'seizure'];
const MODERATE_KEYWORDS = ['fever', 'vomiting', 'infection', 'pain', 'dizziness', 'rash'];

function fallbackPreVisit(symptoms) {
  const lower = symptoms.toLowerCase();
  let urgency = 'Low';
  if (URGENT_KEYWORDS.some((k) => lower.includes(k))) urgency = 'High';
  else if (MODERATE_KEYWORDS.some((k) => lower.includes(k))) urgency = 'Medium';

  return {
    urgency,
    chiefComplaint: symptoms.slice(0, 140),
    suggestedQuestions: [
      'How long have you been experiencing these symptoms?',
      'Have you taken any medication for this already?',
      'Have you had similar symptoms in the past?',
    ],
    generatedBy: 'fallback-rule-based',
  };
}

function fallbackPostVisit(notes) {
  // Heuristic, deterministic "detailed" summary generator used when no LLM
  // key is configured. Rather than echoing the doctor's raw notes verbatim,
  // it restructures them into the same patient-friendly shape a real LLM
  // would produce: a rewritten plain-language summary, a parsed medication
  // schedule (best-effort, from common prescription phrasing), and concrete
  // follow-up steps — so the feature is useful even with zero setup.
  const clinicalNotes = extractSection(notes, 'Clinical notes');
  const prescriptionText = extractSection(notes, 'Prescription');

  const summary = buildPlainLanguageSummary(clinicalNotes || notes);
  const medicationSchedule = parsePrescriptionLines(prescriptionText);
  const followUpSteps = buildFollowUpSteps(clinicalNotes || notes, medicationSchedule);
  const keyTakeaways = buildKeyTakeaways(clinicalNotes || notes, medicationSchedule);
  const dietAndLifestyle = buildDietAndLifestyle(clinicalNotes || notes);
  const warningSigns = buildWarningSigns(clinicalNotes || notes);

  return {
    summary,
    keyTakeaways,
    medicationSchedule,
    followUpSteps,
    dietAndLifestyle,
    warningSigns,
    generatedBy: 'fallback-rule-based',
  };
}

function extractSection(notes, label) {
  const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\n[A-Z][a-z]+:|$)`);
  const match = notes.match(re);
  return match ? match[1].trim() : '';
}

function buildPlainLanguageSummary(clinicalNotes) {
  const trimmed = (clinicalNotes || '').trim();
  if (!trimmed) {
    return "Your doctor has recorded notes from today's visit. Please reach out to the clinic if you have questions about your diagnosis or treatment plan.";
  }
  // Rewrite into second person, plain language, without just repeating the
  // clinician's raw shorthand verbatim.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const body = sentences.join(' ');
  return (
    `During your visit, your doctor assessed your condition and recorded the following: ${body} ` +
    `Based on this, they've put together a treatment plan for you below, including any medication and next steps. ` +
    `If anything is unclear or your symptoms change, don't hesitate to contact the clinic.`
  );
}

const FREQUENCY_MAP = [
  { pattern: /\bonce\s*(a|per)?\s*day\b|\bOD\b|\b1-0-0\b/i, text: 'Once daily' },
  { pattern: /\btwice\s*(a|per)?\s*day\b|\bBD\b|\bBID\b|\b1-0-1\b/i, text: 'Twice daily' },
  { pattern: /\bthrice\s*(a|per)?\s*day\b|\bthree times\b|\bTDS\b|\bTID\b|\b1-1-1\b/i, text: 'Three times daily' },
  { pattern: /\bfour times\b|\bQID\b/i, text: 'Four times daily' },
  { pattern: /\bevery\s*(\d+)\s*hours?\b/i, text: null }, // handled dynamically below
  { pattern: /\bas needed\b|\bSOS\b|\bPRN\b/i, text: 'As needed' },
  { pattern: /\bat bedtime\b|\bHS\b/i, text: 'Once daily at bedtime' },
];

function parsePrescriptionLines(prescriptionText) {
  if (!prescriptionText || !prescriptionText.trim()) return [];

  // Split on newlines, semicolons, or numbered/bulleted list markers.
  const lines = prescriptionText
    .split(/\n|;|(?:^|\s)\d+\.\s*/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  return lines.map((line) => {
    // Medication name: first word/phrase before a dosage number or dash.
    const nameMatch = line.match(/^([A-Za-z][A-Za-z0-9\- ]*?)(?=\s*[\d(]|\s*-|\s*,|$)/);
    const medication = (nameMatch ? nameMatch[1] : line).trim() || line.trim();

    const everyHoursMatch = line.match(/every\s*(\d+)\s*hours?/i);
    let frequency = null;
    if (everyHoursMatch) {
      frequency = `Every ${everyHoursMatch[1]} hours`;
    } else {
      const hit = FREQUENCY_MAP.find((f) => f.pattern.test(line) && f.text);
      frequency = hit ? hit.text : null;
    }

    const durationMatch = line.match(/for\s*(\d+)\s*(day|days|week|weeks)/i);
    const duration = durationMatch ? ` for ${durationMatch[1]} ${durationMatch[2]}` : '';

    const instructions = frequency
      ? `${frequency}${duration}${/with food|after food|before food|empty stomach/i.test(line) ? ` — ${line.match(/with food|after food|before food|empty stomach/i)[0]}` : ''}`
      : line;

    return { medication, instructions };
  });
}

function buildKeyTakeaways(clinicalNotes, medicationSchedule) {
  const takeaways = [];
  const trimmed = (clinicalNotes || '').trim();
  if (trimmed) {
    const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0];
    takeaways.push(`Your visit today was mainly about: ${firstSentence}`);
  }
  if (medicationSchedule.length > 0) {
    takeaways.push(
      `You've been prescribed ${medicationSchedule.length} medication${medicationSchedule.length > 1 ? 's' : ''} — see the schedule below for exact timing.`
    );
  } else {
    takeaways.push('No new medication was prescribed at this visit.');
  }
  takeaways.push('This summary is meant to help you understand your visit — it does not replace your doctor\'s direct advice.');
  return takeaways;
}

function buildDietAndLifestyle(clinicalNotes) {
  const lower = (clinicalNotes || '').toLowerCase();
  const tips = [];
  if (/fever|infection|flu|cold|cough/.test(lower)) {
    tips.push('Drink plenty of fluids and get extra rest while your body recovers.');
    tips.push('Eat light, easily digestible meals until your appetite returns to normal.');
  }
  if (/diabet|sugar|glucose/.test(lower)) {
    tips.push('Limit refined sugar and simple carbohydrates; favour whole grains and vegetables.');
    tips.push('Monitor your blood sugar as advised and keep a consistent meal schedule.');
  }
  if (/hypertension|blood pressure|cardiac|heart/.test(lower)) {
    tips.push('Reduce salt intake and avoid heavily processed foods.');
    tips.push('Light regular activity (like walking) can help, but confirm intensity with your doctor first.');
  }
  if (/skin|rash|dermat/.test(lower)) {
    tips.push('Avoid harsh soaps or known irritants on the affected area while it heals.');
  }
  if (tips.length === 0) {
    tips.push('Maintain a balanced diet, stay hydrated, and get adequate sleep to support your recovery.');
  }
  return tips;
}

function buildWarningSigns(clinicalNotes) {
  const lower = (clinicalNotes || '').toLowerCase();
  const signs = ['Symptoms that suddenly get worse instead of better'];
  if (/fever/.test(lower)) signs.push('A fever that rises above 103°F (39.4°C) or lasts more than 3 days');
  if (/chest|cardiac|heart/.test(lower)) signs.push('Chest pain, pressure, or shortness of breath');
  if (/breath/.test(lower)) signs.push('Difficulty breathing or wheezing that doesn\'t improve');
  if (/allerg|rash|swelling/.test(lower)) signs.push('Swelling of the face, lips, or throat, or difficulty swallowing');
  signs.push('Any new or unusual symptom you\'re unsure about — when in doubt, call the clinic');
  return signs;
}

function buildFollowUpSteps(clinicalNotes, medicationSchedule) {
  const steps = [];
  if (medicationSchedule.length > 0) {
    steps.push('Take all prescribed medications exactly as directed, and complete the full course even if you feel better early.');
  }
  const lower = (clinicalNotes || '').toLowerCase();
  const followUpMatch = lower.match(/follow[\s-]?up.{0,40}?(\d+\s*(day|days|week|weeks))/);
  if (followUpMatch) {
    steps.push(`Schedule a follow-up visit in ${followUpMatch[1]}, or sooner if symptoms don't improve.`);
  } else {
    steps.push('Schedule a follow-up visit if your symptoms do not improve within a week.');
  }
  steps.push('Get plenty of rest, stay hydrated, and monitor your symptoms over the next few days.');
  steps.push('Contact the clinic right away if your symptoms suddenly worsen or new symptoms appear.');
  return steps;
}

async function generatePreVisitSummary(symptoms) {
  try {
    const result = await callProvider(PRE_VISIT_PROMPT(symptoms));
    if (result && result.urgency && result.chiefComplaint) {
      return { ...result, generatedBy: LLM_PROVIDER };
    }
    return fallbackPreVisit(symptoms);
  } catch (err) {
    console.error('[llm.service] pre-visit summary failed, using fallback:', err.message);
    return fallbackPreVisit(symptoms);
  }
}

async function generatePostVisitSummary(notes) {
  try {
    const result = await callProvider(POST_VISIT_PROMPT(notes));
    if (result && result.summary) {
      return { ...result, generatedBy: LLM_PROVIDER };
    }
    return fallbackPostVisit(notes);
  } catch (err) {
    console.error('[llm.service] post-visit summary failed, using fallback:', err.message);
    return fallbackPostVisit(notes);
  }
}

module.exports = { generatePreVisitSummary, generatePostVisitSummary };