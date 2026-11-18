// How a plan is built from the test, and how its progress is calculated.
// No AI here: the rules are fixed, so the same test always gives the same plan.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'action_catalog.json');

export const CATALOG = Object.fromEntries(
  JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')).actions.map((a) => [a.id, a])
);

export const DIMENSIONS = ['IL', 'IS', 'IM'];
export const FACTOR_KEYS = DIMENSIONS.flatMap((d) => [1, 2, 3, 4, 5, 6, 7].map((n) => `${d}${n}`));

// Linked factors are merged into one workstream (plan only; the test is unchanged).
// Theme numbers: 1 Leadership, 2 Culture, 3 Communication, 4 Training, 5 Tools, 6 Involvement, 7 Expertise.
export const WORKSTREAMS = [
  {
    key: 'lead', phase: 1, themes: [1, 3], unlock: null,
    nameEn: 'Leadership & communication', nameFr: 'Leadership & communication',
    whyEn: 'Leaders set the vision and the budget, and communication carries them to everyone. Most actions here move both themes.',
    whyFr: 'La direction fixe la vision et le budget, la communication les porte à tous. La plupart des actions font avancer les deux thèmes.'
  },
  {
    key: 'skills', phase: 1, themes: [4, 7], unlock: null,
    nameEn: 'Skills', nameFr: 'Compétences',
    whyEn: 'One training programme raises both Training and Expertise (e.g. a Green Belt wave).',
    whyFr: 'Un même programme de formation fait monter Formation et Expertise (ex. une vague Green Belt).'
  },
  {
    key: 'tools', phase: 2, themes: [5], unlock: { ws: 'skills', stage: 1 },
    nameEn: 'Tools & methods', nameFr: 'Outils & méthodes',
    whyEn: 'Tools need trained people first, so this starts once Skills validates its first stage.',
    whyFr: "Les outils demandent des personnes formées : ce chantier démarre quand Compétences valide sa première étape."
  },
  {
    key: 'culture', phase: 2, themes: [2, 6], unlock: { ws: 'lead', stage: 1 },
    nameEn: 'Culture & involvement', nameFr: 'Culture & implication',
    whyEn: 'Culture change and employee involvement grow together through participation, autonomy and recognition. Starts once leaders have set the direction.',
    whyFr: "Le changement culturel et l'implication avancent ensemble (participation, autonomie, reconnaissance). Démarre quand la direction a fixé le cap."
  }
];
export const WS = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w]));

export const workstreamFactors = (ws) => ws.themes.flatMap((t) => DIMENSIONS.map((d) => `${d}${t}`));

// "6-12" -> 9 weeks (middle of the range). Steps of one stage run in parallel,
// so a stage lasts as long as its longest step.
export const durationWeeks = (text) => {
  const nums = String(text || '').match(/\d+(\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return 4;
  const [a, b = a] = nums;
  return Math.max(1, Math.round((a + b) / 2));
};

// Same level names exist for Lean, Six Sigma and Maturity ("Lean Financial Support",
// "Six Sigma Financial Support", "Financial Support"); the stage uses the shared one.
const genericStageName = (catalogId, lang) => {
  const [factor, level] = catalogId.split('-');
  const theme = factor.slice(2);
  const generic = CATALOG[`IM${theme}-${level}`] || CATALOG[catalogId];
  return lang === 'fr' ? generic.stageFr : generic.stageEn;
};

const joinNames = (names) => [...new Set(names)].join(' + ');

// ---------- target from the real companies of the study ----------
// Same filter as the prediction model: a numeric performance (not "<30%"),
// and a known strategy (not "Failure" / empty). Maturity "M1" = "IM1"; levels above 5 are capped.
const DATA_PATH = path.join(__dirname, '..', 'data', 'unified_lss_data_final.json');
const loadCompanies = () => {
  const samples = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')).quantitative_data?.samples || [];
  return samples.map((row) => {
    const perfText = String(row.estimations ?? '').trim();
    const perf = perfText.startsWith('<') ? NaN : parseFloat(perfText.replace('%', ''));
    const strategy = String(row.strategie ?? '').trim();
    if (!Number.isFinite(perf) || ['', 'NaN', 'nan', 'None', 'Unknown', 'Failure'].includes(strategy)) return null;
    const levels = {};
    FACTOR_KEYS.forEach((f) => {
      const key = f.startsWith('IM') ? `M${f.slice(2)}` : f;
      const v = Number(row[key]);
      if (Number.isFinite(v)) levels[f] = Math.min(5, v);
    });
    return { perf, levels };
  }).filter(Boolean);
};
export const COMPANIES = loadCompanies();

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

// Rungs of the ladder: where real companies stand.
const perfs = COMPANIES.map((c) => c.perf);
export const LADDER = [
  { key: 'q1', p: 0.25, en: 'Leave the bottom quarter', fr: 'Sortir du dernier quart' },
  { key: 'median', p: 0.5, en: 'Reach the median company', fr: "Atteindre l'entreprise médiane" },
  { key: 'q3', p: 0.75, en: 'Join the top 25%', fr: 'Rejoindre les 25 % meilleures' },
  { key: 'p90', p: 0.9, en: 'Join the top 10%', fr: 'Rejoindre les 10 % meilleures' }
].map((r) => ({ ...r, pct: Math.round(percentile(perfs, r.p)) }))
  .concat([{ key: 'best', p: null, pct: 80, en: 'Best performers (80% and more)', fr: 'Les meilleures (80 % et plus)' }])
  .filter((r, i, all) => i === 0 || r.pct > all[i - 1].pct);

// Average levels of the companies that reach the target ("reverse recommendation").
export function profileFor(targetPct) {
  let group = COMPANIES.filter((c) => c.perf >= targetPct);
  if (group.length < 3) group = [...COMPANIES].sort((a, b) => b.perf - a.perf).slice(0, Math.max(3, Math.round(COMPANIES.length * 0.1)));
  const levels = {};
  FACTOR_KEYS.forEach((f) => {
    const vals = group.map((c) => c.levels[f]).filter((v) => Number.isFinite(v));
    if (vals.length) levels[f] = Math.min(5, Math.max(1, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)));
  });
  return { levels, n: group.length, avgPerf: Math.round((group.reduce((a, c) => a + c.perf, 0) / group.length) * 10) / 10 };
}

// Target level of each factor: the level of the companies at the target, never below today.
export const targetLevelsFor = (scores, profileLevels) => Object.fromEntries(
  FACTOR_KEYS.filter((f) => Number.isInteger(scores[f])).map((f) => [f, Math.max(scores[f], profileLevels[f] ?? scores[f])])
);

// All rungs with what each one asks; the recommended one is the first above today's prediction
// that still asks for at least one level.
export function targetOptions(scores, prediction) {
  const options = LADDER.map((rung) => {
    const profile = profileFor(rung.pct);
    const target = targetLevelsFor(scores, profile.levels);
    const gaps = Object.fromEntries(Object.keys(target).map((f) => [f, target[f] - scores[f]]));
    const steps = Object.values(gaps).reduce((a, b) => a + b, 0);
    return {
      key: rung.key, pct: rung.pct, labelEn: rung.en, labelFr: rung.fr,
      n: profile.n, avgPerf: profile.avgPerf, levels: target, gaps, steps,
      maxGap: Math.max(0, ...Object.values(gaps))
    };
  });
  const useful = options.filter((o) => o.steps > 0);
  const above = useful.find((o) => typeof prediction !== 'number' || o.pct > prediction);
  return { options, recommended: (above || useful[useful.length - 1] || options[0]).key, total: COMPANIES.length };
}

// Levels after k stages on the way to the target companies' levels:
// every factor below them climbs one level per stage.
export function climb(scores, profileLevels, k) {
  return Object.fromEntries(Object.entries(scores).map(([f, v]) => {
    const goal = Math.max(v, profileLevels[f] ?? v);
    return [f, Math.min(goal, v + k)];
  }));
}

// scores: {"IL1": 2, ...}; target: {"IL1": 5, ...}. Each factor climbs one level per stage
// until it reaches its target, so stage k holds the factors that still need a k-th level.
export function buildPlan(scores, target) {
  const notAssessed = FACTOR_KEYS.filter((f) => !Number.isInteger(scores[f]));
  const atTarget = FACTOR_KEYS.filter((f) => Number.isInteger(scores[f]) && (target[f] ?? scores[f]) <= scores[f]);
  const stages = [];

  WORKSTREAMS.forEach((ws) => {
    const factors = workstreamFactors(ws).filter((f) => Number.isInteger(scores[f]) && (target[f] ?? scores[f]) > scores[f]);
    const depth = Math.max(0, ...factors.map((f) => target[f] - scores[f]));
    for (let k = 1; k <= depth; k += 1) {
      const steps = factors
        .filter((f) => scores[f] + k <= target[f])
        .map((f) => ({ factor: f, from: scores[f] + k - 1, to: scores[f] + k, catalogId: `${f}-${scores[f] + k}` }))
        .filter((s) => CATALOG[s.catalogId]);
      if (!steps.length) break;
      stages.push({
        ws: ws.key,
        stageNo: k,
        nameEn: joinNames(steps.map((s) => genericStageName(s.catalogId, 'en'))),
        nameFr: joinNames(steps.map((s) => genericStageName(s.catalogId, 'fr'))),
        weeks: Math.max(...steps.map((s) => durationWeeks(CATALOG[s.catalogId].duration))),
        steps
      });
    }
  });
  return { stages, notAssessed, atTarget };
}

// ---------- KPIs: the user types the inputs, the app calculates ----------
export function kpiValue(def, input) {
  if (def.type === 'ratio') {
    const num = Number(input.num);
    const den = Number(input.den);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    const v = def.percent ? (num / den) * 100 : num / den;
    return { value: Math.round(v * 100) / 100, num, den };
  }
  const v = Number(input.value);
  return Number.isFinite(v) ? { value: v, num: null, den: null } : null;
}

// Week when each stage starts and ends. Phase 1 workstreams start at week 0;
// a phase 2 workstream starts when the stage that unlocks it ends.
export function timeline(stages) {
  const byWs = {};
  stages.forEach((s) => { (byWs[s.workstream ?? s.ws] ||= []).push(s); });
  Object.values(byWs).forEach((list) => list.sort((a, b) => (a.stage_no ?? a.stageNo) - (b.stage_no ?? b.stageNo)));
  const result = {};
  const endOf = (wsKey, stageNo) => {
    const list = byWs[wsKey] || [];
    let week = startOf(wsKey);
    for (const s of list) {
      week += s.weeks;
      if ((s.stage_no ?? s.stageNo) === stageNo) return week;
    }
    return week;
  };
  const startOf = (wsKey) => {
    const ws = WS[wsKey];
    if (!ws.unlock || !(byWs[ws.unlock.ws] || []).length) return 0;
    return endOf(ws.unlock.ws, ws.unlock.stage);
  };
  Object.entries(byWs).forEach(([wsKey, list]) => {
    let week = startOf(wsKey);
    list.forEach((s) => {
      result[`${wsKey}:${s.stage_no ?? s.stageNo}`] = { start: week, end: week + s.weeks };
      week += s.weeks;
    });
  });
  return result;
}

// ---------- progress and locks (computed every time the plan is read) ----------
// Step %      = ticked sub-steps / sub-steps (a step is only "done" with a proof: an update or a file)
// Stage %     = average of its steps
// Workstream% = average of its stages
// Plan %      = average of all steps (each step weighs the same)
export function computeView(plan, stages, steps, proofCount) {
  const stepView = steps.map((s) => {
    const checklist = JSON.parse(s.checklist);
    const ticked = checklist.filter(Boolean).length;
    const pct = s.status === 'done' ? 100 : checklist.length ? Math.round((ticked / checklist.length) * 100) : 0;
    return { ...s, checklist, pct, proofs: proofCount[s.id] || 0 };
  });

  const stageByKey = {};
  const stageView = stages.map((st) => {
    const mine = stepView.filter((s) => s.stage_id === st.id);
    const pct = mine.length ? Math.round(mine.reduce((a, s) => a + s.pct, 0) / mine.length) : 0;
    const v = { ...st, pct, steps: mine, allDone: mine.length > 0 && mine.every((s) => s.status === 'done') };
    stageByKey[`${st.workstream}:${st.stage_no}`] = v;
    return v;
  });

  const wsValidated = (wsKey, stageNo) => {
    const st = stageByKey[`${wsKey}:${stageNo}`];
    return !st || st.status === 'validated'; // no such stage (already at level 5) = nothing blocks
  };

  const times = timeline(stages);
  const wsView = WORKSTREAMS.map((ws) => {
    const mine = stageView.filter((s) => s.workstream === ws.key).sort((a, b) => a.stage_no - b.stage_no);
    const wsLocked = ws.unlock && !wsValidated(ws.unlock.ws, ws.unlock.stage);
    mine.forEach((st, i) => {
      const prev = mine[i - 1];
      st.time = times[`${ws.key}:${st.stage_no}`];
      if (wsLocked) {
        st.locked = { reason: 'phase', ws: ws.unlock.ws, stage: ws.unlock.stage };
      } else if (prev && prev.status !== 'validated') {
        st.locked = { reason: 'stage', stage: prev.stage_no };
      } else {
        st.locked = null;
      }
      st.state = st.status === 'validated' ? 'done' : st.locked ? 'locked' : 'active';
    });
    const pct = mine.length ? Math.round(mine.reduce((a, s) => a + s.pct, 0) / mine.length) : 100;
    return {
      ...ws,
      factors: workstreamFactors(ws),
      locked: Boolean(wsLocked),
      stages: mine,
      pct,
      validated: mine.filter((s) => s.status === 'validated').length
    };
  });

  const allSteps = stepView;
  const planPct = allSteps.length ? Math.round(allSteps.reduce((a, s) => a + s.pct, 0) / allSteps.length) : 0;
  const totalWeeks = Math.max(0, ...Object.values(times).map((t) => t.end));

  return {
    plan: {
      ...plan,
      start_scores: JSON.parse(plan.start_scores),
      current_scores: JSON.parse(plan.current_scores)
    },
    workstreams: wsView,
    totals: {
      pct: planPct,
      stages: stages.length,
      validated: stages.filter((s) => s.status === 'validated').length,
      steps: allSteps.length,
      stepsDone: allSteps.filter((s) => s.status === 'done').length,
      weeks: totalWeeks
    }
  };
}
