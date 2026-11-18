// Routes for assessments, plans, step discussions and files. Every route needs a
// logged-in user and only ever reads or writes that user's own rows.
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db, { UPLOAD_DIR } from './db.js';
import { CATALOG, FACTOR_KEYS, WS, LADDER, buildPlan, computeView, targetOptions, profileFor, climb, kpiValue } from './planEngine.js';
import { fileKind, readFile } from './fileReader.js';
import { coachReply } from './coach.js';

const nowIso = () => new Date().toISOString();

// {IL:["3",...], IS:[...], IM:[...]} -> {"IL1":3,...}
const paramsToScores = (parameters) => {
  const scores = {};
  ['IL', 'IS', 'IM'].forEach((d) => {
    (parameters?.[d] || []).forEach((v, i) => {
      const n = Math.round(Number(v));
      if (v !== '' && v !== null && Number.isInteger(n) && n >= 1 && n <= 5) scores[`${d}${i + 1}`] = n;
    });
  });
  return scores;
};
const scoresToParams = (scores) => Object.fromEntries(
  ['IL', 'IS', 'IM'].map((d) => [d, [1, 2, 3, 4, 5, 6, 7].map((n) => scores[`${d}${n}`] ?? '')])
);

const fmtPct = (v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '—');

export default function planRoutes({ requireAuth, predict }) {
  const router = express.Router();
  router.use(['/assessments', '/plans', '/files'], requireAuth);

  // ---------- helpers ----------
  const event = (planId, type, textEn, textFr, data = null) => db.prepare(
    'INSERT INTO plan_events (plan_id, type, text_en, text_fr, data) VALUES (?, ?, ?, ?, ?)'
  ).run(planId, type, textEn, textFr, data ? JSON.stringify(data) : null);

  const touch = (planId) => db.prepare("UPDATE plans SET updated_at = datetime('now') WHERE id = ?").run(planId);

  const ownPlan = (req, res) => {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').get(Number(req.params.planId), req.user.id);
    if (!plan) { res.status(404).json({ error: 'Plan not found' }); return null; }
    return plan;
  };

  const ownStep = (req, res, plan) => {
    const step = db.prepare('SELECT * FROM plan_steps WHERE id = ? AND plan_id = ?').get(Number(req.params.stepId), plan.id);
    if (!step) { res.status(404).json({ error: 'Step not found' }); return null; }
    return step;
  };

  const fileRow = (f) => ({ ...f, summary: f.summary ? JSON.parse(f.summary) : null });

  // Ask the AI coach to answer in the step's discussion. Its answers are not proof.
  const runCoach = async (plan, stepId, lang) => {
    const view = planView(plan);
    const step = view.workstreams.flatMap((w) => w.stages).flatMap((st) => st.steps).find((s) => s.id === stepId);
    if (!step) return;
    const reply = await coachReply({
      lang: lang === 'fr' ? 'fr' : 'en', plan: view.plan, step, action: step.action,
      kpis: step.kpis, messages: step.messages, files: step.files
    });
    if (reply.text) {
      db.prepare("INSERT INTO step_messages (step_id, user_id, kind, text) VALUES (?, NULL, 'coach', ?)").run(stepId, reply.text);
    } else {
      db.prepare("INSERT INTO step_messages (step_id, user_id, kind, text) VALUES (?, NULL, 'system', ?)").run(stepId, `coach_error:${reply.error}`);
    }
  };

  // Full plan as the interface needs it: workstreams, stages, steps with their
  // catalog content, threads, files, history and the calculated progress.
  const planView = (plan) => {
    const stages = db.prepare('SELECT * FROM plan_stages WHERE plan_id = ? ORDER BY workstream, stage_no').all(plan.id);
    const steps = db.prepare('SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY stage_id, position').all(plan.id);
    const messages = db.prepare(
      'SELECT m.* FROM step_messages m JOIN plan_steps s ON s.id = m.step_id WHERE s.plan_id = ? ORDER BY m.id'
    ).all(plan.id);
    const files = db.prepare('SELECT * FROM files WHERE plan_id = ? ORDER BY id').all(plan.id).map(fileRow);
    const proofCount = {};
    messages.filter((m) => m.kind === 'update' || m.kind === 'kpi').forEach((m) => { proofCount[m.step_id] = (proofCount[m.step_id] || 0) + 1; });
    files.filter((f) => f.step_id).forEach((f) => { proofCount[f.step_id] = (proofCount[f.step_id] || 0) + 1; });

    const entries = db.prepare(
      'SELECT k.* FROM kpi_entries k JOIN plan_steps s ON s.id = k.step_id WHERE s.plan_id = ? ORDER BY k.id'
    ).all(plan.id);
    const view = computeView(plan, stages, steps, proofCount);
    view.workstreams.forEach((ws) => ws.stages.forEach((st) => st.steps.forEach((s) => {
      s.action = CATALOG[s.catalog_id];
      s.messages = messages.filter((m) => m.step_id === s.id);
      s.files = files.filter((f) => f.step_id === s.id);
      // KPIs of the step (main one first); targets are suggested by the app and can be changed
      const targets = JSON.parse(s.kpi_targets || '{}');
      s.kpis = (s.action.kpiList || []).map((def, i) => {
        const history = entries.filter((e) => e.step_id === s.id && e.kpi_index === i);
        const latest = history[history.length - 1] || null;
        const custom = targets[i] || null;
        const t = custom || { target: def.target, direction: def.direction };
        const reached = Boolean(latest && typeof t.target === 'number'
          && (t.direction === 'down' ? latest.value <= t.target : latest.value >= t.target));
        return { index: i, ...def, history, latest, target: t, customTarget: Boolean(custom), reached };
      });
    })));
    view.plan.target_levels = plan.target_levels ? JSON.parse(plan.target_levels) : null;
    view.plan.target_basis = plan.target_basis ? JSON.parse(plan.target_basis) : null;
    view.files = files;
    view.events = db.prepare('SELECT * FROM plan_events WHERE plan_id = ? ORDER BY id DESC').all(plan.id);
    view.assessment = plan.assessment_id
      ? db.prepare('SELECT * FROM assessments WHERE id = ?').get(plan.assessment_id) : null;
    return view;
  };

  const latestAssessment = (userId) => {
    const a = db.prepare('SELECT * FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
    return a ? { ...a, scores: JSON.parse(a.scores) } : null;
  };

  // ---------- assessments (one row per completed test) ----------
  router.post('/assessments', (req, res) => {
    const scores = paramsToScores(req.body?.parameters);
    if (!Object.keys(scores).length) return res.status(400).json({ error: 'No scores' });
    const prediction = typeof req.body?.prediction === 'number' ? req.body.prediction : null;
    const info = db.prepare('INSERT INTO assessments (user_id, scores, prediction, strategy) VALUES (?, ?, ?, ?)')
      .run(req.user.id, JSON.stringify(scores), prediction, req.body?.strategy || null);
    res.json({ id: info.lastInsertRowid, scores, prediction });
  });

  router.get('/assessments/latest', (req, res) => res.json(latestAssessment(req.user.id)));

  // ---------- plans ----------
  router.get('/plans', (req, res) => {
    res.json(db.prepare('SELECT id, title, status, created_at, updated_at FROM plans WHERE user_id = ? ORDER BY id DESC').all(req.user.id));
  });

  router.get('/plans/active', (req, res) => {
    const plan = db.prepare("SELECT * FROM plans WHERE user_id = ? AND status IN ('active','completed') ORDER BY id DESC LIMIT 1").get(req.user.id);
    res.json({ view: plan ? planView(plan) : null, assessment: latestAssessment(req.user.id) });
  });

  router.get('/plans/:planId', (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    res.json({ view: planView(plan) });
  });

  // The assessment the plan starts from: the one sent by the page (just taken), or the latest saved.
  const resolveAssessment = (req) => {
    if (req.body?.parameters) {
      const scores = paramsToScores(req.body.parameters);
      if (!Object.keys(scores).length) return null;
      return { id: null, scores, prediction: typeof req.body.prediction === 'number' ? req.body.prediction : null, strategy: req.body.strategy || null };
    }
    return latestAssessment(req.user.id);
  };

  const predCache = new Map();
  const predictCached = async (scores) => {
    const key = FACTOR_KEYS.map((f) => scores[f] ?? '').join(',');
    if (!predCache.has(key)) {
      const r = await predict(scoresToParams(scores));
      if (typeof r?.prediction === 'number') predCache.set(key, r.prediction);
      else return null;
    }
    return predCache.get(key);
  };

  // Path to a target: climb stage by stage toward the levels of the real companies at that
  // target, and stop at the first stage where the model predicts the target is reached.
  const pathTo = async (scores, rungKey) => {
    const rung = LADDER.find((r) => r.key === rungKey) || LADDER[0];
    const profile = profileFor(rung.pct);
    const maxK = Math.max(0, ...Object.keys(scores).map((f) => Math.max(0, (profile.levels[f] ?? 0) - scores[f])));
    const predictions = [];
    let chosen = maxK;
    let reached = false;
    for (let k = 1; k <= maxK; k += 1) {
      const p = await predictCached(climb(scores, profile.levels, k));
      predictions.push({ stage: k, prediction: p });
      if (typeof p === 'number' && p >= rung.pct) { chosen = k; reached = true; break; }
    }
    const levels = climb(scores, profile.levels, chosen);
    const last = predictions.find((p) => p.stage === chosen);
    return {
      key: rung.key, pct: rung.pct, labelEn: rung.en, labelFr: rung.fr,
      n: profile.n, avgPerf: profile.avgPerf,
      levels, stages: chosen, reached, predictions,
      prediction: last ? last.prediction : null,
      steps: Object.keys(levels).reduce((a, f) => a + (levels[f] - scores[f]), 0)
    };
  };

  // Ladder of targets from the real companies, with the recommended one.
  router.post('/plans/targets', async (req, res) => {
    const assessment = resolveAssessment(req);
    if (!assessment) return res.status(400).json({ error: 'Take the guided assessment first.' });
    let prediction = assessment.prediction;
    if (typeof prediction !== 'number') prediction = await predictCached(assessment.scores);
    const ladder = targetOptions(assessment.scores, prediction);
    res.json({ prediction, ...ladder });
  });

  // What one target asks: levels per factor, number of stages, model prediction.
  router.post('/plans/preview', async (req, res) => {
    const assessment = resolveAssessment(req);
    if (!assessment) return res.status(400).json({ error: 'Take the guided assessment first.' });
    res.json(await pathTo(assessment.scores, req.body?.target));
  });

  // Build a plan from the test and a target. Replaces the active plan.
  router.post('/plans', async (req, res) => {
    let assessment = resolveAssessment(req);
    if (!assessment) return res.status(400).json({ error: 'Take the guided assessment first.' });
    if (assessment.id === null) {
      const info = db.prepare('INSERT INTO assessments (user_id, scores, prediction, strategy) VALUES (?, ?, ?, ?)')
        .run(req.user.id, JSON.stringify(assessment.scores), assessment.prediction, assessment.strategy);
      assessment = { ...assessment, id: info.lastInsertRowid };
    }
    const scores = assessment.scores;
    let startPrediction = assessment.prediction;
    if (typeof startPrediction !== 'number') startPrediction = await predictCached(scores);

    const ladder = targetOptions(scores, startPrediction);
    const target = await pathTo(scores, req.body?.target || ladder.recommended);
    const built = buildPlan(scores, target.levels);
    if (!built.stages.length) return res.status(400).json({ error: 'nothing_to_do' });

    const create = db.transaction(() => {
      db.prepare("UPDATE plans SET status = 'archived' WHERE user_id = ? AND status IN ('active','completed')").run(req.user.id);
      const title = `Plan ${new Date().toISOString().slice(0, 10)}`;
      const depth = Math.max(...built.stages.map((st) => st.stageNo));
      const planId = db.prepare(`INSERT INTO plans (user_id, assessment_id, title, depth, start_scores, current_scores, start_prediction, current_prediction,
        target_pct, target_levels, target_basis, target_prediction) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.user.id, assessment.id, title, depth, JSON.stringify(scores), JSON.stringify(scores), startPrediction, startPrediction,
        target.pct, JSON.stringify(target.levels),
        JSON.stringify({ key: target.key, n: target.n, avgPerf: target.avgPerf, labelEn: target.labelEn, labelFr: target.labelFr, reached: target.reached, total: ladder.total }),
        target.prediction
      ).lastInsertRowid;

      const created = new Date();
      const insertStage = db.prepare('INSERT INTO plan_stages (plan_id, workstream, stage_no, name_en, name_fr, weeks) VALUES (?, ?, ?, ?, ?, ?)');
      const insertStep = db.prepare(`INSERT INTO plan_steps (plan_id, stage_id, catalog_id, factor, from_level, to_level, checklist, due_date, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const stageIds = {};
      built.stages.forEach((st) => {
        stageIds[`${st.ws}:${st.stageNo}`] = insertStage.run(planId, st.ws, st.stageNo, st.nameEn, st.nameFr, st.weeks).lastInsertRowid;
      });
      // due dates follow the timeline (computed once the stages exist)
      const rows = db.prepare('SELECT * FROM plan_stages WHERE plan_id = ?').all(planId);
      const view = computeView({ start_scores: '{}', current_scores: '{}' }, rows, [], {});
      const endWeek = {};
      view.workstreams.forEach((w) => w.stages.forEach((s) => { endWeek[s.id] = s.time?.end ?? s.weeks; }));
      built.stages.forEach((st) => {
        const stageId = stageIds[`${st.ws}:${st.stageNo}`];
        const due = new Date(created.getTime() + endWeek[stageId] * 7 * 864e5).toISOString().slice(0, 10);
        st.steps.forEach((s, i) => {
          const checklist = CATALOG[s.catalogId].steps.map(() => false);
          insertStep.run(planId, stageId, s.catalogId, s.factor, s.from, s.to, JSON.stringify(checklist), due, i);
        });
      });
      const nSteps = built.stages.reduce((a, s) => a + s.steps.length, 0);
      event(planId, 'created',
        `Plan created from the test. Target ${target.pct}% (${target.labelEn}, based on ${target.n} real companies). ${nSteps} steps. Prediction ${fmtPct(startPrediction)} now, ${fmtPct(target.prediction)} with the target levels.`,
        `Plan créé à partir du test. Cible ${target.pct} % (${target.labelFr}, d'après ${target.n} entreprises réelles). ${nSteps} actions. Prédiction ${fmtPct(startPrediction)} aujourd'hui, ${fmtPct(target.prediction)} avec les niveaux cibles.`,
        { notAssessed: built.notAssessed, atTarget: built.atTarget, predictions: target.predictions });
      return planId;
    });
    const planId = create();
    res.json({ view: planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(planId)) });
  });

  // ---------- KPIs: the user types the inputs, the app calculates the value ----------
  router.post('/plans/:planId/steps/:stepId/kpis/:index', (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    const index = Number(req.params.index);
    const def = CATALOG[step.catalog_id].kpiList?.[index];
    if (!def) return res.status(404).json({ error: 'KPI not found' });
    const result = kpiValue(def, req.body || {});
    if (!result) return res.status(400).json({ error: 'kpi_input' });
    const info = db.prepare('INSERT INTO kpi_entries (step_id, kpi_index, num, den, value) VALUES (?, ?, ?, ?, ?)')
      .run(step.id, index, result.num, result.den, result.value);
    // the measurement is posted in the discussion and counts as proof
    db.prepare("INSERT INTO step_messages (step_id, user_id, kind, text) VALUES (?, ?, 'kpi', ?)").run(
      step.id, req.user.id, JSON.stringify({ entryId: info.lastInsertRowid, index, name: def.name, nameFr: def.nameFr, unit: def.unit, ...result })
    );
    if (step.status === 'todo') db.prepare("UPDATE plan_steps SET status = 'in_progress' WHERE id = ?").run(step.id);
    touch(plan.id);
    res.json({ view: planView(plan) });
  });

  router.put('/plans/:planId/steps/:stepId/kpis/:index/target', (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    const index = Number(req.params.index);
    if (!CATALOG[step.catalog_id].kpiList?.[index]) return res.status(404).json({ error: 'KPI not found' });
    const targets = JSON.parse(step.kpi_targets || '{}');
    const t = req.body?.target === '' || req.body?.target === null ? null : Number(req.body?.target);
    if (t === null) delete targets[index];
    else if (Number.isFinite(t)) targets[index] = { target: t, direction: req.body?.direction === 'down' ? 'down' : 'up' };
    else return res.status(400).json({ error: 'kpi_input' });
    db.prepare('UPDATE plan_steps SET kpi_targets = ? WHERE id = ?').run(JSON.stringify(targets), step.id);
    touch(plan.id);
    res.json({ view: planView(plan) });
  });

  // ---------- steps ----------
  router.patch('/plans/:planId/steps/:stepId', (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    const b = req.body || {};
    let checklist = JSON.parse(step.checklist);
    if (Array.isArray(b.checklist) && b.checklist.length === checklist.length) checklist = b.checklist.map(Boolean);
    const status = step.status === 'done' ? 'done' : checklist.some(Boolean) ? 'in_progress' : 'todo';
    db.prepare('UPDATE plan_steps SET checklist = ?, status = ?, owner = ?, due_date = ?, kpi_target = ? WHERE id = ?').run(
      JSON.stringify(checklist), status,
      b.owner !== undefined ? String(b.owner).slice(0, 80) : step.owner,
      b.due_date !== undefined ? (b.due_date || null) : step.due_date,
      b.kpi_target !== undefined ? String(b.kpi_target).slice(0, 160) : step.kpi_target,
      step.id
    );
    touch(plan.id);
    res.json({ view: planView(plan) });
  });

  router.post('/plans/:planId/steps/:stepId/messages', async (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'Write an update first.' });
    db.prepare('INSERT INTO step_messages (step_id, user_id, kind, text) VALUES (?, ?, ?, ?)').run(step.id, req.user.id, 'update', text);
    if (step.status === 'todo') db.prepare("UPDATE plan_steps SET status = 'in_progress' WHERE id = ?").run(step.id);
    touch(plan.id);
    await runCoach(plan, step.id, req.body?.lang);
    res.json({ view: planView(plan) });
  });

  // Mark a step done: needs a proof (an update or a file) in its discussion.
  router.post('/plans/:planId/steps/:stepId/done', (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    const view = planView(plan);
    const stage = view.workstreams.flatMap((w) => w.stages).find((s) => s.id === step.stage_id);
    if (stage?.locked) return res.status(409).json({ error: 'This stage is locked.' });
    const proofs = db.prepare("SELECT COUNT(*) n FROM step_messages WHERE step_id = ? AND kind IN ('update','kpi')").get(step.id).n
      + db.prepare('SELECT COUNT(*) n FROM files WHERE step_id = ?').get(step.id).n;
    if (!proofs) return res.status(409).json({ error: 'proof_needed' });
    const checklist = JSON.parse(step.checklist).map(() => true);
    db.prepare("UPDATE plan_steps SET status = 'done', checklist = ?, done_at = datetime('now') WHERE id = ?").run(JSON.stringify(checklist), step.id);
    const a = CATALOG[step.catalog_id];
    event(plan.id, 'step_done', `Step done: ${step.factor} → level ${step.to_level} (${a.stageEn}).`, `Action terminée : ${step.factor} → niveau ${step.to_level} (${a.stageFr}).`, { stepId: step.id });
    db.prepare("INSERT INTO step_messages (step_id, user_id, kind, text) VALUES (?, NULL, 'system', ?)").run(step.id, 'step_done');
    touch(plan.id);
    res.json({ view: planView(plan) });
  });

  router.post('/plans/:planId/steps/:stepId/reopen', (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    const stage = db.prepare('SELECT * FROM plan_stages WHERE id = ?').get(step.stage_id);
    if (stage.status === 'validated') return res.status(409).json({ error: 'This stage is already validated.' });
    db.prepare("UPDATE plan_steps SET status = 'in_progress', done_at = NULL WHERE id = ?").run(step.id);
    event(plan.id, 'step_reopened', `Step reopened: ${step.factor} → level ${step.to_level}.`, `Action rouverte : ${step.factor} → niveau ${step.to_level}.`);
    touch(plan.id);
    res.json({ view: planView(plan) });
  });

  // ---------- validate a stage: factors go up, score is re-predicted, next parts unlock ----------
  router.post('/plans/:planId/stages/:stageId/validate', async (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const before = planView(plan);
    const stage = before.workstreams.flatMap((w) => w.stages).find((s) => s.id === Number(req.params.stageId));
    if (!stage) return res.status(404).json({ error: 'Stage not found' });
    if (stage.status === 'validated') return res.status(409).json({ error: 'Already validated.' });
    if (stage.locked) return res.status(409).json({ error: 'This stage is locked.' });
    if (!stage.allDone) return res.status(409).json({ error: 'steps_not_done' });

    const scores = JSON.parse(plan.current_scores);
    const raised = stage.steps.map((s) => {
      const from = scores[s.factor];
      scores[s.factor] = Math.max(from ?? 0, s.to_level);
      return { factor: s.factor, from, to: scores[s.factor] };
    });
    const predicted = await predict(scoresToParams(scores));
    const newPrediction = predicted?.prediction ?? plan.current_prediction;

    db.prepare("UPDATE plan_stages SET status = 'validated', validated_at = datetime('now') WHERE id = ?").run(stage.id);
    db.prepare("UPDATE plans SET current_scores = ?, current_prediction = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(scores), newPrediction, plan.id);
    const ws = WS[stage.workstream];
    event(plan.id, 'stage_validated',
      `Stage validated: ${ws.nameEn} · stage ${stage.stage_no} (${stage.name_en}). ${raised.map((r) => `${r.factor} ${r.from}→${r.to}`).join(', ')}. Prediction ${fmtPct(plan.current_prediction)} → ${fmtPct(newPrediction)}.`,
      `Étape validée : ${ws.nameFr} · étape ${stage.stage_no} (${stage.name_fr}). ${raised.map((r) => `${r.factor} ${r.from}→${r.to}`).join(', ')}. Prédiction ${fmtPct(plan.current_prediction)} → ${fmtPct(newPrediction)}.`,
      { raised, before: plan.current_prediction, after: newPrediction });

    const updatedPlan = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan.id);
    let after = planView(updatedPlan);
    const unlocked = after.workstreams.filter((w) => {
      const old = before.workstreams.find((o) => o.key === w.key);
      return old.locked && !w.locked;
    });
    unlocked.forEach((w) => event(plan.id, 'unlocked', `Unlocked: ${w.nameEn} (phase ${w.phase}).`, `Débloqué : ${w.nameFr} (phase ${w.phase}).`));
    if (after.totals.validated === after.totals.stages) {
      db.prepare("UPDATE plans SET status = 'completed' WHERE id = ?").run(plan.id);
      event(plan.id, 'completed', 'All stages validated. The plan is complete.', 'Toutes les étapes sont validées. Le plan est terminé.');
    }
    after = planView(db.prepare('SELECT * FROM plans WHERE id = ?').get(plan.id));
    res.json({
      view: after,
      celebration: {
        workstream: stage.workstream, stageNo: stage.stage_no, nameEn: stage.name_en, nameFr: stage.name_fr,
        raised, before: plan.current_prediction, after: newPrediction,
        unlocked: unlocked.map((w) => w.key), completed: after.plan.status === 'completed'
      }
    });
  });

  // ---------- files ----------
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(UPLOAD_DIR, `u${req.user.id}`);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, Boolean(fileKind(file.originalname)))
  });

  router.post('/plans/:planId/steps/:stepId/files', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 15 MB).' : err.message });
      return next();
    });
  }, async (req, res) => {
    const plan = ownPlan(req, res); if (!plan) return;
    const step = ownStep(req, res, plan); if (!step) return;
    if (!req.file) return res.status(400).json({ error: 'File type not accepted. Use CSV, Excel (.xlsx), PDF, Word (.docx) or an image.' });
    // multer reads names as latin1; restore UTF-8 (accents in French file names)
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const kind = fileKind(original);
    const summary = await readFile(req.file.path, kind);
    const info = db.prepare(`INSERT INTO files (user_id, plan_id, step_id, original_name, stored_name, mime, size, kind, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, plan.id, step.id, original, path.basename(req.file.path),
      req.file.mimetype, req.file.size, kind, JSON.stringify(summary));
    const note = String(req.body?.note || '').trim().slice(0, 4000);
    db.prepare("INSERT INTO step_messages (step_id, user_id, kind, text, file_id) VALUES (?, ?, 'update', ?, ?)")
      .run(step.id, req.user.id, note || `📎 ${original}`, info.lastInsertRowid);
    if (step.status === 'todo') db.prepare("UPDATE plan_steps SET status = 'in_progress' WHERE id = ?").run(step.id);
    await runCoach(plan, step.id, req.body?.lang);
    event(plan.id, 'file', `File added to ${step.factor} → ${step.to_level}: ${original}.`, `Fichier ajouté à ${step.factor} → ${step.to_level} : ${original}.`, { fileId: info.lastInsertRowid });
    touch(plan.id);
    res.json({ view: planView(plan), fileId: info.lastInsertRowid });
  });

  router.get('/files/:fileId/download', (req, res) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(Number(req.params.fileId), req.user.id);
    if (!f) return res.status(404).json({ error: 'File not found' });
    const full = path.join(UPLOAD_DIR, `u${req.user.id}`, path.basename(f.stored_name));
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File missing on disk' });
    res.download(full, f.original_name);
  });

  router.delete('/files/:fileId', (req, res) => {
    const f = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(Number(req.params.fileId), req.user.id);
    if (!f) return res.status(404).json({ error: 'File not found' });
    const step = f.step_id ? db.prepare('SELECT * FROM plan_steps WHERE id = ?').get(f.step_id) : null;
    if (step?.status === 'done') return res.status(409).json({ error: 'This file is the proof of a finished step. Reopen the step first.' });
    db.prepare('DELETE FROM step_messages WHERE file_id = ?').run(f.id);
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    try { fs.unlinkSync(path.join(UPLOAD_DIR, `u${req.user.id}`, path.basename(f.stored_name))); } catch { /* already gone */ }
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(f.plan_id);
    res.json({ view: plan ? planView(plan) : null });
  });

  return router;
}

export { paramsToScores, scoresToParams, FACTOR_KEYS };
