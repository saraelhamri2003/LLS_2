// AI coach for the discussion of one plan step (Gemini, called directly from Node).
// The API key stays in backend/.env (GOOGLE_API_KEY), never in the code.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = path.join(__dirname, '..', 'data', 'llm_usage.json');
const MODEL = (process.env.COACH_MODEL || process.env.SIMPLE_MODEL || 'gemini-3.5-flash-lite').trim();
const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS || 30000);
const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';

// Same daily counter as the chat (sidebar), Google's day = Pacific time
const pacificToday = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
const recordUsage = (model) => {
  try {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); } catch { /* new file */ }
    if (data.day !== pacificToday()) data = { day: pacificToday(), counts: {} };
    data.counts = data.counts || {};
    data.counts[model] = (data.counts[model] || 0) + 1;
    fs.writeFileSync(USAGE_FILE, JSON.stringify(data));
  } catch (error) {
    console.error(`[coach] could not save usage: ${error.message}`);
  }
};

const fmt = (v) => (typeof v === 'number' ? `${Math.round(v * 10) / 10}` : '—');

// What the coach knows about the step: action, sub-steps (done or not), proof required,
// main KPI with target and measurements, files read by the app, and the discussion so far.
function context({ lang, plan, step, action, kpis, files }) {
  const fr = lang === 'fr';
  const lines = [
    `Plan target: ${plan.target_pct ?? '—'}% predicted performance (now ${fmt(plan.current_prediction)}%, start ${fmt(plan.start_prediction)}%).`,
    `Step: factor ${step.factor} (${fr ? action.factorNameFr : action.factorName}, ${action.dimension}) from level ${step.from_level} to ${step.to_level} — "${fr ? action.stageFr : action.stageEn}".`,
    `Action: ${fr ? action.actionFr : action.actionEn}`,
    'Sub-steps (✓ = ticked by the user):',
    ...action.steps.map((s, i) => `  ${step.checklist[i] ? '✓' : '○'} ${s}`),
    `Proof expected to validate: ${action.proof}`,
    `Step status: ${step.status}. Owner: ${step.owner || 'not set'}. Deadline: ${step.due_date || 'not set'}.`
  ];
  (kpis || []).forEach((kpi, i) => {
    const hist = kpi.history.map((h) => `${h.created_at.slice(0, 10)}: ${fmt(h.value)}${kpi.unit === '%' ? '%' : ` ${kpi.unit}`}`).join('; ');
    const how = kpi.type === 'ratio' ? `${kpi.num} ÷ ${kpi.den}${kpi.percent ? ' × 100' : ''}` : kpi.label;
    lines.push(`KPI ${i + 1}${i === 0 ? ' (main)' : ''}: ${fr ? kpi.nameFr : kpi.name} = ${how}. Target ${kpi.target?.target}${kpi.unit === '%' ? '%' : ` ${kpi.unit}`} (${kpi.target?.direction === 'down' ? 'lower is better' : 'higher is better'}). Measurements: ${hist || 'none yet'}.`);
  });
  files.forEach((f) => {
    const s = f.summary;
    if (s?.status === 'read') {
      const cols = s.numeric.map((c) => `${c.name} ${c.first}→${c.last}${typeof c.changePct === 'number' ? ` (${Math.round(c.changePct)}%)` : ''}, avg ${c.mean}`).join('; ');
      lines.push(`File "${f.original_name}": ${s.rows} rows${s.period?.from ? `, ${s.period.from} → ${s.period.to}` : ''}. ${cols}`);
    } else {
      lines.push(`File "${f.original_name}" (${f.kind}) stored; its content was not read.`);
    }
  });
  return lines.join('\n');
}

const systemPrompt = (lang) => `You are the Lean Six Sigma coach inside the "L6S Expert Advisor" app.
You follow ONE step of a company's improvement plan with the person in charge of it.
Answer in ${lang === 'fr' ? 'French' : 'English'}, in plain words, short (at most about 120 words), with at most 3 bullet points.
How to answer an update:
- Say briefly what the update shows, compared with the sub-steps and the proof expected.
- Say what is still missing for this step, then give ONE concrete next action.
- If the user gives numbers that fit one of the step's KPIs, compute it and remind them to save it in the KPI box.
- When the step looks complete and a proof exists (an update, a file or a KPI measurement), tell them they can click "Mark step done".
- If something is blocked, suggest 1 or 2 alternatives used in Lean Six Sigma practice.
Rules: use only the facts in the context and the discussion; never invent company numbers, names or results.
If information is missing, ask one precise question. Do not repeat the whole context back.`;

export async function coachReply({ lang, plan, step, action, kpis, messages, files }) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { error: 'no_key' };

  // discussion so far (updates, KPI measurements, coach answers), oldest first, last 12
  const contents = [];
  const push = (role, text) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n${text}`;
    else contents.push({ role, parts: [{ text }] });
  };
  push('user', `CONTEXT OF THE STEP\n${context({ lang, plan, step, action, kpis, files })}`);
  messages.slice(-12).forEach((m) => {
    if (m.kind === 'coach') push('model', m.text);
    else if (m.kind === 'update') push('user', m.text);
    else if (m.kind === 'kpi') {
      try {
        const k = JSON.parse(m.text);
        push('user', `[KPI saved] ${k.name}: ${fmt(k.value)}${k.unit === '%' ? '%' : ` ${k.unit}`}${k.den != null ? ` (${k.num} / ${k.den})` : ''}`);
      } catch { /* ignore */ }
    }
  });
  if (contents[contents.length - 1].role !== 'user') push('user', '(continue)');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(lang) }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
      }),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      console.error(`[coach] Gemini error: ${msg}`);
      return { error: res.status === 429 ? 'quota' : 'api', detail: msg };
    }
    recordUsage(MODEL);
    const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
    return text ? { text, model: MODEL } : { error: 'empty' };
  } catch (error) {
    console.error(`[coach] ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    return { error: error.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
