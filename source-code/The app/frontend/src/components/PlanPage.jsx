import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Lock, Check, Paperclip, Send, Loader2, Download, Trash2, ChevronDown, ChevronUp, FileText,
  FileSpreadsheet, Image as ImageIcon, PartyPopper, RefreshCw, ExternalLink, ClipboardCheck
} from 'lucide-react';
import { API_BASE, apiFetch, authHeaders } from '../api';
import { useLang } from '../i18n';
import '../plan.css';

const DIM_CLASS = { IL: 'is-il', IS: 'is-is', IM: 'is-m' };
const dimOf = (factor) => factor.slice(0, 2);
const fmtPct = (v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : '—');
const fmtDate = (iso, lang) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.length <= 10 ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Ring({ pct, size = 44 }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="pl-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chip-bg)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#pl-grad)" strokeWidth="4" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <b>{pct}%</b>
    </span>
  );
}

function Bar({ pct }) {
  return <div className="pl-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}

function FileIcon({ kind }) {
  if (kind === 'csv' || kind === 'excel') return <FileSpreadsheet className="w-4 h-4" />;
  if (kind === 'image') return <ImageIcon className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

// What the app read from a file (CSV/Excel numbers, or "stored")
function FileSummary({ file, compact }) {
  const { t } = useLang();
  const s = file.summary;
  if (!s) return null;
  if (s.status === 'stored') return <div className="pl-fsum">{t('pl.file.stored')}</div>;
  if (s.status === 'error') return <div className="pl-fsum is-err">{t('pl.file.error', { msg: s.error })}</div>;
  const cols = compact ? s.numeric.slice(0, 3) : s.numeric;
  return (
    <div className="pl-fsum">
      <div>{t('pl.file.read', { rows: s.rows, cols: s.columns.length })}{s.period?.from ? ` · ${t('pl.file.period', { from: s.period.from, to: s.period.to })}` : ''}</div>
      {cols.map((c) => (
        <div key={c.name} className="pl-fnum">
          <b>{c.name}</b> {c.first} → {c.last}
          {typeof c.changePct === 'number' && (
            <span className="pl-change"> ({c.changePct > 0 ? '+' : ''}{Math.round(c.changePct)}%)</span>
          )}
          <span className="pl-faint"> · min {c.min} · max {c.max} · avg {c.mean}</span>
        </div>
      ))}
    </div>
  );
}

export default function PlanPage({ onHome, onStartAssessment, pendingParams, pendingResult, showToast }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null); // { view, assessment }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('plan');
  const [wsKey, setWsKey] = useState('lead');
  const [openStep, setOpenStep] = useState(null);
  const [targets, setTargets] = useState(null);   // ladder from the real companies
  const [targetKey, setTargetKey] = useState(null);
  const [preview, setPreview] = useState(null);   // what the selected target asks
  const [busy, setBusy] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const detailRef = useRef(null);

  const fr = lang === 'fr';
  const view = data?.view || null;
  const L = (en, frText) => (fr ? frText || en : en);

  const fail = (err) => {
    const key = `pl.err.${err.message}`;
    const text = t(key) !== key ? t(key) : t('pl.err.generic', { msg: err.message });
    showToast?.(text, true);
  };

  const load = () => {
    setLoading(true);
    apiFetch('/api/plans/active')
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // keep the selected workstream valid
  useEffect(() => {
    if (view && !view.workstreams.some((w) => w.key === wsKey)) setWsKey(view.workstreams[0].key);
  }, [view, wsKey]);

  // a new workstream opens at the top
  useEffect(() => { if (detailRef.current) detailRef.current.scrollTop = 0; }, [wsKey]);

  const apply = (d) => setData((prev) => ({ ...prev, view: d.view }));

  const call = async (key, path, opts) => {
    setBusy(key);
    try {
      const d = await apiFetch(path, opts);
      apply(d);
      return d;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      setBusy(null);
    }
  };

  // ---------- create ----------
  const pendingComplete = pendingParams
    && ['IL', 'IS', 'IM'].every((g) => pendingParams[g]?.every((v) => String(v).trim() !== ''));
  // the test just taken in this browser, if it is newer than the saved one
  const usePending = Boolean(pendingComplete && (!data?.assessment || pendingResult?._savedId !== data.assessment.id));
  const sourceBody = () => (usePending ? {
    parameters: pendingParams,
    prediction: typeof pendingResult?.prediction === 'number' ? pendingResult.prediction : undefined,
    strategy: pendingResult?.parameter_analysis?.strategy || null
  } : {});
  const hasTest = usePending || Boolean(data?.assessment);
  const choosing = !loading && (!view || showCreate) && hasTest;

  // load the ladder of targets, then what the selected one asks
  useEffect(() => {
    if (!choosing) return;
    let alive = true;
    apiFetch('/api/plans/targets', { method: 'POST', body: sourceBody() })
      .then((d) => { if (alive) { setTargets(d); setTargetKey((k) => k || d.recommended); } })
      .catch(fail);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing, usePending, data?.assessment?.id]);

  useEffect(() => {
    if (!choosing || !targetKey) return;
    let alive = true;
    setPreview(null);
    apiFetch('/api/plans/preview', { method: 'POST', body: { ...sourceBody(), target: targetKey } })
      .then((d) => { if (alive) setPreview(d); })
      .catch(fail);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing, targetKey, usePending, data?.assessment?.id]);

  const createPlan = async () => {
    const body = { ...sourceBody(), target: targetKey };
    const d = await call('create', '/api/plans', { method: 'POST', body });
    if (d) { setShowCreate(false); setTab('plan'); setWsKey('lead'); setOpenStep(null); load(); }
  };

  // ---------- steps ----------
  const base = view ? `/api/plans/${view.plan.id}` : '';
  const patchStep = (step, body) => call(`patch-${step.id}`, `${base}/steps/${step.id}`, { method: 'PATCH', body });
  const toggleCheck = (step, i) => {
    if (step.status === 'done') return;
    const checklist = step.checklist.map((v, j) => (j === i ? !v : v));
    // optimistic update so the tick feels instant
    setData((prev) => ({
      ...prev,
      view: {
        ...prev.view,
        workstreams: prev.view.workstreams.map((w) => ({
          ...w,
          stages: w.stages.map((st) => ({
            ...st,
            steps: st.steps.map((s) => (s.id === step.id ? { ...s, checklist } : s))
          }))
        }))
      }
    }));
    patchStep(step, { checklist });
  };
  const saveKpi = (step, index, input) => call(`kpi-${step.id}-${index}`, `${base}/steps/${step.id}/kpis/${index}`, { method: 'POST', body: input });
  const saveKpiTarget = (step, index, target, direction) => call(`kt-${step.id}-${index}`, `${base}/steps/${step.id}/kpis/${index}/target`, { method: 'PUT', body: { target, direction } });
  const sendUpdate = (step, text) => call(`msg-${step.id}`, `${base}/steps/${step.id}/messages`, { method: 'POST', body: { text, lang } });
  const markDone = (step) => call(`done-${step.id}`, `${base}/steps/${step.id}/done`, { method: 'POST' });
  const reopen = (step) => call(`done-${step.id}`, `${base}/steps/${step.id}/reopen`, { method: 'POST' });

  const uploadFile = async (step, file, note) => {
    setBusy(`file-${step.id}`);
    try {
      const form = new FormData();
      form.append('file', file);
      if (note) form.append('note', note);
      form.append('lang', lang);
      const res = await fetch(`${API_BASE}${base}/steps/${step.id}/files`, { method: 'POST', headers: authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Upload failed (${res.status})`);
      apply(d);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const download = async (file) => {
    try {
      const res = await fetch(`${API_BASE}/api/files/${file.id}/download`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      fail(err);
    }
  };

  const removeFile = async (file) => {
    if (!window.confirm(t('pl.file.deleteConfirm'))) return;
    const d = await call(`del-${file.id}`, `/api/files/${file.id}`, { method: 'DELETE' });
    if (d && !d.view) load();
  };

  const validateStage = async (stage) => {
    const d = await call(`val-${stage.id}`, `${base}/stages/${stage.id}/validate`, { method: 'POST' });
    if (d?.celebration) setCelebration(d.celebration);
  };

  // ---------- derived ----------
  const ws = view?.workstreams.find((w) => w.key === wsKey) || view?.workstreams[0];
  const wsName = (key) => {
    const w = view?.workstreams.find((x) => x.key === key);
    return w ? L(w.nameEn, w.nameFr) : key;
  };
  const stepLabel = useMemo(() => {
    const map = {};
    view?.workstreams.forEach((w) => w.stages.forEach((st) => st.steps.forEach((s) => {
      map[s.id] = `${s.factor} → ${s.to_level}`;
    })));
    return map;
  }, [view]);

  // ---------- render ----------
  if (loading && !data) {
    return <section className="panel pl-page"><div className="pl-center"><Loader2 className="w-6 h-6 animate-spin" />{t('pl.loading')}</div></section>;
  }
  if (error) {
    return <section className="panel pl-page"><div className="pl-center is-err">{t('pl.loadError', { msg: error })}</div></section>;
  }

  const gradient = (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="pl-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
    </svg>
  );

  // ===== empty state / choose the target =====
  if (!view || showCreate) {
    const a = data?.assessment;
    const scores = usePending
      ? Object.fromEntries(['IL', 'IS', 'IM'].flatMap((g) => pendingParams[g].map((v, i) => [`${g}${i + 1}`, Number(v)])))
      : a?.scores;
    const prediction = targets?.prediction ?? (usePending ? pendingResult?.prediction : a?.prediction);
    const option = targets?.options.find((o) => o.key === targetKey);
    const tlevels = preview?.key === targetKey ? preview.levels : null;
    return (
      <section className="panel pl-page">
        {gradient}
        <div className="l6s-work__head">
          <div>
            <div className="l6s-crumb"><button type="button" onClick={onHome}>{t('top.home')}</button><span>/</span>{t('pl.title')}</div>
            <h2>{t('pl.title')}</h2>
          </div>
          {view && <button type="button" className="button-secondary" onClick={() => setShowCreate(false)}>{t('cp.back')}</button>}
        </div>
        <div className="pl-scroll">
          <div className="pl-empty">
            <div className="pl-empty__icon"><ClipboardCheck className="w-7 h-7" /></div>
            <h3>{t('pl.empty.title')}</h3>
            {!scores ? (
              <>
                <p>{t('pl.empty.text')}</p>
                <p className="pl-muted">{t('pl.empty.noTest')}</p>
                <button type="button" className="button-primary" onClick={onStartAssessment}>{t('pl.empty.start')}</button>
              </>
            ) : (
              <>
                <div className="pl-testcard">
                  <div className="pl-testcard__head">
                    <span>{usePending ? t('pl.empty.unsaved') : `${t('pl.empty.lastTest')} · ${fmtDate(a.created_at, lang)}`}</span>
                    <span>{t('pl.tg.now')}: <b>{fmtPct(prediction)}</b></span>
                  </div>
                  <div className="pl-lbl">{t('pl.tg.title')}</div>
                  <p className="pl-muted" style={{ margin: '0 0 8px' }}>{t('pl.tg.intro', { total: targets?.total ?? '…' })}</p>
                  {!targets ? <div className="pl-hint"><Loader2 className="w-3 h-3 animate-spin" style={{ display: 'inline' }} /> …</div> : (
                    <div className="pl-ladder2">
                      {targets.options.map((o) => (
                        <button key={o.key} type="button" className={`pl-rung${o.key === targetKey ? ' is-on' : ''}${typeof prediction === 'number' && o.pct <= prediction ? ' is-below' : ''}`}
                          onClick={() => setTargetKey(o.key)}>
                          <b>{o.pct}%</b>
                          <span>{L(o.labelEn, o.labelFr)}</span>
                          <small>{t('pl.tg.companies', { n: o.n })}</small>
                          {o.key === targets.recommended && <em>{t('pl.tg.recommended')}</em>}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="pl-preview">
                    {!preview || preview.key !== targetKey ? (
                      <div className="pl-hint"><Loader2 className="w-3 h-3 animate-spin" style={{ display: 'inline' }} /> {t('pl.tg.loading')}</div>
                    ) : (
                      <>
                        <b>{t('pl.tg.needs', { pct: preview.pct, stages: preview.stages, steps: preview.steps })}</b>
                        <div>
                          {t('pl.tg.model', { pred: fmtPct(preview.prediction) })}
                          {' · '}
                          {preview.reached ? <span className="is-up">✓ {t('pl.tg.reached')}</span> : <span className="pl-faint">{t('pl.tg.notReached', { pct: preview.pct })}</span>}
                        </div>
                        <div className="pl-hint">{t('pl.tg.basis', { n: preview.n, pct: preview.pct, avg: preview.avgPerf })}</div>
                      </>
                    )}
                  </div>

                  <div className="pl-lbl">{t('pl.tg.grid')}</div>
                  <div className="pl-levels">
                    {['IL', 'IS', 'IM'].map((g) => (
                      <div key={g} className="pl-levels__row">
                        <span className={`pl-fb ${DIM_CLASS[g]}`}>{g}</span>
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                          const f = `${g}${n}`;
                          const now = scores[f];
                          const to = tlevels?.[f];
                          return (
                            <span key={n} className={`pl-lvcell${to && now && to > now ? ' is-up' : ''}`} title={f}>
                              <small>{n}</small>
                              <b>{now || '—'}{to && now && to > now ? <em> → {to}</em> : ''}</b>
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <button type="button" className="button-primary" onClick={createPlan} disabled={busy === 'create' || !option || !preview || preview.key !== targetKey || preview.steps === 0}>
                  {busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {busy === 'create' ? t('pl.empty.creating') : t('pl.empty.create')}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  const { plan, totals } = view;
  const predDelta = typeof plan.current_prediction === 'number' && typeof plan.start_prediction === 'number'
    ? plan.current_prediction - plan.start_prediction : null;

  // ===== plan =====
  return (
    <section className="panel pl-page">
      {gradient}
      <div className="l6s-work__head">
        <div>
          <div className="l6s-crumb"><button type="button" onClick={onHome}>{t('top.home')}</button><span>/</span>{t('pl.title')}</div>
          <h2>{t('pl.title')}</h2>
          <div className="l6s-work__sub">
            {t('pl.createdOn', { date: fmtDate(plan.created_at, lang), test: fmtDate(view.assessment?.created_at, lang) })}
          </div>
        </div>
        <button type="button" className="button-secondary" onClick={() => { if (window.confirm(t('pl.newConfirm'))) setShowCreate(true); }}>
          <RefreshCw className="w-4 h-4" />{t('pl.new')}
        </button>
      </div>

      <div className="pl-stats">
        <div className="pl-stat">
          <small>{t('pl.stat.pred')}</small>
          <b className="pl-big">{fmtPct(plan.current_prediction)}</b>
          <span className="pl-sub">
            {t('pl.stat.predSub', { start: fmtPct(plan.start_prediction) })}
            {predDelta !== null && Math.abs(predDelta) >= 0.05 && (
              <em className={predDelta > 0 ? 'is-up' : 'is-down'}> {predDelta > 0 ? '+' : ''}{predDelta.toFixed(1)} pts</em>
            )}
          </span>
        </div>
        <div className="pl-stat">
          <small>{t('pl.stat.progress')}</small>
          <b>{totals.pct}%</b>
          <Bar pct={totals.pct} />
        </div>
        <div className="pl-stat">
          <small>{t('pl.stat.stages')}</small>
          <b>{totals.validated} / {totals.stages}</b>
          <span className="pl-sub">{t('pl.stat.steps', { done: totals.stepsDone, total: totals.steps })}</span>
        </div>
        <div className="pl-stat">
          <small>{t('pl.stat.duration')}</small>
          <b>{t('pl.stat.weeks', { n: totals.weeks })}</b>
          <span className="pl-sub">{t('pl.stat.durationSub')}</span>
        </div>
        <div className="pl-stat">
          <small>{t('pl.stat.target')}</small>
          <b>{plan.target_pct ? `${plan.target_pct}%` : '—'}</b>
          <span className="pl-sub">
            {plan.target_basis ? `${L(plan.target_basis.labelEn, plan.target_basis.labelFr)} · ` : ''}
            {t('pl.stat.targetSub', { pred: fmtPct(plan.target_prediction) })}
          </span>
        </div>
      </div>

      <div className="pl-tabs">
        {['plan', 'files', 'history', 'how'].map((k) => (
          <button key={k} type="button" className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {t(`pl.tab.${k}`)}
            {k === 'files' && view.files.length > 0 && <i>{view.files.length}</i>}
            {k === 'history' && <i>{view.events.length}</i>}
          </button>
        ))}
      </div>

      {tab === 'plan' && (
        <div className="pl-body">
          {/* workstreams by phase */}
          <nav className="pl-wlist">
            {[1, 2].map((phase) => (
              <React.Fragment key={phase}>
                <div className="pl-phase">{t(`pl.phase${phase}`)}</div>
                {view.workstreams.filter((w) => w.phase === phase).map((w) => (
                  <button key={w.key} type="button" className={`pl-wcard${w.key === ws.key ? ' is-on' : ''}${w.locked ? ' is-locked' : ''}`}
                    onClick={() => { setWsKey(w.key); setOpenStep(null); }}>
                    <div className="pl-wtop">
                      <Ring pct={w.pct} />
                      <div>
                        <b>{L(w.nameEn, w.nameFr)}</b>
                        <small>
                          {w.locked ? <><Lock className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-1px' }} /> {t('pl.wsLocked')}</>
                            : w.stages.length ? `${t('pl.stages', { n: w.stages.length })} · ${w.validated}/${w.stages.length}` : t('pl.step.done')}
                        </small>
                      </div>
                    </div>
                    <div className="pl-badges">
                      {w.factors.map((f) => <span key={f} className={`pl-fb ${DIM_CLASS[dimOf(f)]}`}>{f}</span>)}
                    </div>
                  </button>
                ))}
              </React.Fragment>
            ))}
          </nav>

          {/* selected workstream */}
          <div className="pl-detail" ref={detailRef}>
            <div className="pl-dhead">
              <div>
                <span className="pl-k">{t('pl.phase', { n: ws.phase })}</span>
                <h3>{L(ws.nameEn, ws.nameFr)}</h3>
                <p className="pl-why">{L(ws.whyEn, ws.whyFr)}</p>
              </div>
              <span className="pl-chip">{ws.pct}%</span>
            </div>

            <div className="pl-lbl" style={{ marginTop: 14 }}>{t('pl.factorsMoved')}</div>
            <div className="pl-fgrid">
              {ws.factors.map((f) => {
                const start = plan.start_scores[f];
                const now = plan.current_scores[f];
                const target = plan.target_levels?.[f]
                  ?? Math.max(now || 0, ...ws.stages.flatMap((st) => st.steps.filter((s) => s.factor === f).map((s) => s.to_level)));
                const sample = ws.stages.flatMap((st) => st.steps).find((s) => s.factor === f)?.action;
                return (
                  <div key={f} className="pl-fbox">
                    <div className="pl-row">
                      <b><span className={`pl-fb ${DIM_CLASS[dimOf(f)]}`}>{f}</span> {sample ? L(sample.factorName, sample.factorNameFr) : ''}</b>
                      <span className="pl-faint">{now ? `${t('pl.levelNow', { now })} → ${t('pl.levelTarget', { target })}` : '—'}</span>
                    </div>
                    <div className="pl-lvls">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <i key={n} className={`${n <= (now || 0) ? 'f' : ''}${n > (now || 0) && n <= target ? ' t' : ''}${n <= (start || 0) ? ' s' : ''}`} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {!ws.stages.length && <div className="pl-biglock">{t('pl.wsDoneAll')}</div>}

            <div className="pl-ladder">
              {ws.stages.map((st) => {
                const doneSteps = st.steps.filter((s) => s.status === 'done').length;
                const lockText = st.locked?.reason === 'phase'
                  ? t('pl.lock.phase', { ws: wsName(st.locked.ws), n: st.locked.stage })
                  : st.locked ? t('pl.lock.stage', { n: st.locked.stage }) : '';
                return (
                  <div key={st.id} className={`pl-lvl is-${st.state}`}>
                    <div className="pl-dot">{st.state === 'done' ? <Check className="w-5 h-5" /> : st.state === 'locked' ? <Lock className="w-4 h-4" /> : st.stage_no}</div>
                    <div className="pl-lbox">
                      <div className="pl-lhead">
                        <div style={{ minWidth: 0 }}>
                          <span className="pl-k">{t('pl.stage', { n: st.stage_no })} · {st.time ? t('pl.weeksRange', { a: st.time.start, b: st.time.end }) : ''}</span>
                          <b className="pl-stagename">{L(st.name_en, st.name_fr)}</b>
                          <small>{t('pl.stepsDone', { done: doneSteps, total: st.steps.length })}</small>
                        </div>
                        <div className="pl-lright">
                          <span className="pl-pct">{st.pct}%</span>
                          <span className={`pl-status s-${st.state}`}>{t(`pl.status.${st.state}`)}</span>
                        </div>
                      </div>
                      <div className="pl-lprog"><Bar pct={st.pct} /></div>

                      {st.state === 'locked' ? (
                        <div className="pl-lockwrap">
                          <div className="pl-steps is-blur">
                            {st.steps.map((s) => (
                              <div key={s.id} className="pl-step"><div className="pl-srow"><span className="pl-chk" /><div className="pl-stxt"><b>{L(s.action.actionEn, s.action.actionFr)}</b></div></div></div>
                            ))}
                          </div>
                          <div className="pl-lockover"><div><Lock className="w-5 h-5" style={{ margin: '0 auto' }} /><span className="pl-lt">{t('pl.lock.title')}</span><p>{lockText}</p></div></div>
                        </div>
                      ) : (
                        <>
                          <div className="pl-steps">
                            {st.steps.map((s) => (
                              <StepItem
                                key={s.id}
                                step={s}
                                open={openStep === s.id}
                                onToggle={() => setOpenStep(openStep === s.id ? null : s.id)}
                                busy={busy}
                                stageValidated={st.status === 'validated'}
                                weight={Math.round(100 / st.steps.length)}
                                onCheck={(i) => toggleCheck(s, i)}
                                onPatch={(body) => patchStep(s, body)}
                                onKpi={(i, input) => saveKpi(s, i, input)}
                                onKpiTarget={(i, target, direction) => saveKpiTarget(s, i, target, direction)}
                                onSend={(text) => sendUpdate(s, text)}
                                onUpload={(file, note) => uploadFile(s, file, note)}
                                onDone={() => markDone(s)}
                                onReopen={() => reopen(s)}
                                onDownload={download}
                                onDeleteFile={removeFile}
                              />
                            ))}
                          </div>
                          {st.status !== 'validated' && (
                            <div className={`pl-validate${st.allDone ? ' is-ready' : ''}`}>
                              <div>
                                <b>{t('pl.validate')}</b>
                                <p>{st.allDone ? t('pl.validateHint') : t('pl.notReady')}</p>
                              </div>
                              <button type="button" className="button-primary" disabled={!st.allDone || busy === `val-${st.id}`} onClick={() => validateStage(st)}>
                                {busy === `val-${st.id}` && <Loader2 className="w-4 h-4 animate-spin" />}
                                {busy === `val-${st.id}` ? t('pl.validating') : t('pl.validate')}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'files' && (
        <div className="pl-scroll pl-pad">
          {view.files.length === 0 ? <div className="pl-center">{t('pl.files.empty')}</div> : (
            <div className="l6s-tablewrap" style={{ overflow: 'visible' }}>
              <table className="l6s-table pl-ftable">
                <thead>
                  <tr><th>{t('pl.files.name')}</th><th>{t('pl.files.step')}</th><th>{t('pl.files.what')}</th><th>{t('pl.files.date')}</th><th /></tr>
                </thead>
                <tbody>
                  {[...view.files].reverse().map((f) => (
                    <tr key={f.id}>
                      <td><span className="pl-fname"><FileIcon kind={f.kind} />{f.original_name}</span><small className="pl-faint">{fmtSize(f.size)}</small></td>
                      <td>{stepLabel[f.step_id] || '—'}</td>
                      <td><FileSummary file={f} compact /></td>
                      <td>{fmtDate(f.created_at, lang)}</td>
                      <td>
                        <div className="pl-factions">
                          <button type="button" className="pl-mini" onClick={() => download(f)} title={t('pl.file.download')}><Download className="w-4 h-4" /></button>
                          <button type="button" className="pl-mini" onClick={() => removeFile(f)} title={t('pl.file.delete')}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="pl-scroll pl-pad">
          {view.events.length === 0 ? <div className="pl-center">{t('pl.history.empty')}</div> : (
            <div className="pl-hist">
              {view.events.map((e) => (
                <div key={e.id} className={`pl-hitem is-${e.type}`}>
                  <span className="pl-hdate">{fmtDate(e.created_at, lang)}</span>
                  <span>{fr ? e.text_fr : e.text_en}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'how' && <HowPanel view={view} />}

      {celebration && (
        <div className="pl-cele" onClick={() => setCelebration(null)}>
          <div className="pl-cele__box" onClick={(e) => e.stopPropagation()}>
            <PartyPopper className="w-9 h-9" style={{ margin: '0 auto', color: 'var(--accent-2)' }} />
            <h3>{t('pl.cele.title')}</h3>
            <p className="pl-muted">{wsName(celebration.workstream)} · {t('pl.stage', { n: celebration.stageNo })}</p>
            <div className="pl-lbl">{t('pl.cele.raised')}</div>
            <div className="pl-raised">
              {celebration.raised.map((r) => (
                <span key={r.factor} className={`pl-fb ${DIM_CLASS[dimOf(r.factor)]}`}>{r.factor} {r.from}→{r.to}</span>
              ))}
            </div>
            <div className="pl-lbl">{t('pl.cele.pred')}</div>
            <div className="pl-celepred">{fmtPct(celebration.before)} → <b>{fmtPct(celebration.after)}</b></div>
            {celebration.unlocked.map((k) => <div key={k} className="pl-unlock">🔓 {t('pl.cele.unlocked', { ws: wsName(k) })}</div>)}
            {celebration.completed && <div className="pl-unlock">🏁 {t('pl.cele.completed')}</div>}
            <button type="button" className="button-primary" onClick={() => setCelebration(null)}>{t('pl.cele.ok')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

// One step (= one catalog action for one factor level)
function StepItem({ step, open, onToggle, busy, stageValidated, weight, onCheck, onPatch, onKpi, onKpiTarget, onSend, onUpload, onDone, onReopen, onDownload, onDeleteFile }) {
  const { t, lang } = useLang();
  const fr = lang === 'fr';
  const a = step.action;
  const [text, setText] = useState('');
  const [owner, setOwner] = useState(step.owner || '');
  const [due, setDue] = useState(step.due_date || '');
  const fileRef = useRef(null);
  const msgsRef = useRef(null);

  useEffect(() => { setOwner(step.owner || ''); setDue(step.due_date || ''); }, [step.owner, step.due_date]);
  useEffect(() => { if (open && msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [open, step.messages.length]);

  const done = step.status === 'done';
  const updates = step.messages.filter((m) => m.kind === 'update' || m.kind === 'kpi').length;
  const uploading = busy === `file-${step.id}`;
  const statusLabel = done ? t('pl.step.done') : step.status === 'in_progress' ? t('pl.step.inprog') : t('pl.step.todo');

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    const d = await onSend(value);
    if (d) setText('');
  };
  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ok = await onUpload(file, text.trim());
    if (ok) setText('');
  };
  const filesById = Object.fromEntries(step.files.map((f) => [f.id, f]));

  return (
    <div className={`pl-step${done ? ' is-done' : ''}${open ? ' is-open' : ''}`}>
      <div className="pl-srow">
        <span className={`pl-chk${done ? ' is-on' : ''}`}>{done && <Check className="w-4 h-4" />}</span>
        <div className="pl-stxt">
          <b>{fr ? a.actionFr : a.actionEn}</b>
          <div className="pl-stags">
            <span className="pl-l">{t('pl.step.improves')}</span>
            <span className={`pl-fb ${DIM_CLASS[step.factor.slice(0, 2)]}`}>{step.factor} {step.from_level}→{step.to_level}</span>
            {a.alsoImproves && a.alsoImproves !== '—' && (
              <><span className="pl-l">{t('pl.step.also')}</span>{a.alsoImproves.split(/[ ,]+/).filter(Boolean).map((f) => (
                <span key={f} className={`pl-fb ${DIM_CLASS[f.slice(0, 2)] || ''}`}>{f}</span>
              ))}</>
            )}
            <span className="pl-meta">{fr ? a.stageFr : a.stageEn} · {t('pl.step.effort', { e: a.effort })} · {t('pl.step.weeks', { w: a.duration })}</span>
          </div>
        </div>
        <div className="pl-sright">
          <span className="pl-spct">{step.pct}%</span>
          <span className={`pl-sstat is-${step.status}`}>{statusLabel}</span>
          <span className="pl-weight">{t('pl.step.weight', { w: weight })}</span>
        </div>
      </div>
      <div className="pl-sact">
        <button type="button" className="pl-mini" onClick={onToggle}>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {open ? t('pl.step.close') : t('pl.step.open')}
          <span className="pl-count">{updates}</span>
        </button>
        <div className="pl-sbar"><Bar pct={step.pct} /></div>
      </div>

      {open && (
        <div className="pl-sopen">
          {fr && <div className="pl-hint">{t('pl.step.enDetails')}</div>}
          <div className="pl-grid2">
            <div className="pl-card">
              <div className="pl-lbl">{t('pl.step.checklist')}</div>
              <ul className="pl-check">
                {a.steps.map((txt, i) => (
                  <li key={i}>
                    <button type="button" disabled={done || stageValidated} className={step.checklist[i] ? 'is-on' : ''} onClick={() => onCheck(i)}>
                      <span className="pl-cbox">{step.checklist[i] && <Check className="w-3 h-3" />}</span>
                      <span>{txt}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="pl-hint">{t('pl.step.duration', { d: a.duration, basis: a.durationBasis })}</div>
              {a.prerequisites.length > 0 && <div className="pl-hint">{t('pl.step.prereq')}: {a.prerequisites.join(', ')}</div>}
            </div>
            <div className="pl-card">
              <div className="pl-lbl">{t('pl.step.proof')}</div>
              <p className="pl-p">{a.proof}</p>
              <div className="pl-fields">
                <label>
                  <span className="pl-lbl">{t('pl.step.owner')}</span>
                  <input className="l6s-field" value={owner} placeholder={t('pl.step.ownerPh')} disabled={stageValidated}
                    onChange={(e) => setOwner(e.target.value)} onBlur={() => owner !== (step.owner || '') && onPatch({ owner })} />
                </label>
                <label>
                  <span className="pl-lbl">{t('pl.step.due')}</span>
                  <input className="l6s-field" type="date" value={due || ''} disabled={stageValidated}
                    onChange={(e) => setDue(e.target.value)} onBlur={() => due !== (step.due_date || '') && onPatch({ due_date: due })} />
                </label>
              </div>
            </div>
          </div>

          {step.kpis.length > 0 && (
            <div>
              <div className="pl-lbl">{t('pl.kpi.title')}</div>
              <div className="pl-kpigrid">
                {step.kpis.map((k) => (
                  <KpiBox key={k.index} kpi={k} disabled={stageValidated} busy={busy} stepId={step.id}
                    onSave={(input) => onKpi(k.index, input)} onTarget={(target, direction) => onKpiTarget(k.index, target, direction)} />
                ))}
              </div>
            </div>
          )}
          {a.kpis.length > 0 && (
            <details className="pl-evidence">
              <summary>{t('pl.kpi.more')}</summary>
              <ul className="pl-kpis">{a.kpis.map((k) => <li key={k}>{k}</li>)}</ul>
            </details>
          )}

          <details className="pl-evidence">
            <summary>{t('pl.step.why')} · <span className={`pl-ev is-${a.evidence.toLowerCase()}`}>{t('pl.step.evidence', { e: a.evidence })}</span></summary>
            <div className="pl-lbl">{t('pl.step.example')}</div>
            <p className="pl-p">{a.example}</p>
            {a.exampleSource && (
              <a className="pl-link" href={a.exampleSource} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" />{t('pl.step.source')}: {a.exampleSource.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a>
            )}
            {a.pitfalls && <><div className="pl-lbl">{t('pl.step.pitfalls')}</div><p className="pl-p">{a.pitfalls}</p></>}
          </details>

          <div className="pl-thread">
            <div className="pl-thead">{t('pl.thread.title')}</div>
            <div className="pl-msgs" ref={msgsRef}>
              {step.messages.length === 0 && <div className="pl-hint" style={{ padding: 4 }}>{t('pl.thread.empty')}</div>}
              {step.messages.map((m) => {
                const f = m.file_id ? filesById[m.file_id] : null;
                if (m.kind === 'coach') {
                  return (
                    <div key={m.id} className="pl-tm is-coach">
                      <small>🤖 {t('pl.thread.coach')}</small>
                      <CoachText text={m.text} />
                    </div>
                  );
                }
                if (m.kind === 'system' && m.text.startsWith('coach_error:')) {
                  const code = m.text.split(':')[1];
                  return <div key={m.id} className="pl-tm is-sys is-warn">{t(code === 'quota' || code === 'no_key' ? `pl.coach.err.${code}` : 'pl.coach.err.other')}</div>;
                }
                if (m.kind === 'kpi') {
                  const k = JSON.parse(m.text);
                  return (
                    <div key={m.id} className="pl-tm is-me">
                      <small>{t('pl.thread.you')} · {new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                      <div className="pl-ttext">📏 {t('pl.kpi.msg', { name: lang === 'fr' && k.nameFr ? k.nameFr : k.name, value: fmtKpi(k.value, k.unit) })}{k.den !== null && k.den !== undefined ? ` (${k.num} / ${k.den})` : ''}</div>
                    </div>
                  );
                }
                if (m.kind === 'system') {
                  return <div key={m.id} className="pl-tm is-sys">✓ {m.text === 'step_done' ? t('pl.thread.stepDone') : m.text}</div>;
                }
                return (
                  <div key={m.id} className="pl-tm is-me">
                    <small>{t('pl.thread.you')} · {new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                    {!(f && m.text === `📎 ${f.original_name}`) && <div className="pl-ttext">{m.text}</div>}
                    {f && (
                      <div className="pl-fattach">
                        <div className="pl-fchip">
                          <FileIcon kind={f.kind} /><span>{f.original_name}</span><small className="pl-faint">{fmtSize(f.size)}</small>
                          <button type="button" onClick={() => onDownload(f)} title={t('pl.file.download')}><Download className="w-3 h-3" /></button>
                          {!done && <button type="button" onClick={() => onDeleteFile(f)} title={t('pl.file.delete')}><Trash2 className="w-3 h-3" /></button>}
                        </div>
                        <FileSummary file={f} />
                      </div>
                    )}
                  </div>
                );
              })}
              {uploading && <div className="pl-tm is-sys"><Loader2 className="w-3 h-3 animate-spin" style={{ display: 'inline' }} /> {t('pl.thread.uploading')}</div>}
              {(uploading || busy === `msg-${step.id}`) && <div className="pl-tm is-coach is-typing"><Loader2 className="w-3 h-3 animate-spin" style={{ display: 'inline' }} /> {t('pl.thread.thinking')}</div>}
            </div>
            {!stageValidated && (
              <div className="pl-composer">
                <div className="pl-crow">
                  <button type="button" className="pl-attach" title={t('pl.thread.attach')} onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input ref={fileRef} type="file" hidden accept=".csv,.txt,.xlsx,.xlsm,.pdf,.png,.jpg,.jpeg,.webp,.docx" onChange={pickFile} />
                  <textarea value={text} placeholder={t('pl.thread.ph')} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                  <button type="button" className="button-primary pl-send" onClick={send} disabled={!text.trim() || busy === `msg-${step.id}`}>
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <div className="pl-hint">{t('pl.thread.hint')}</div>
              </div>
            )}
          </div>

          {!stageValidated && (
            <div className="pl-doneRow">
              {done ? (
                <button type="button" className="button-secondary" onClick={onReopen} disabled={busy === `done-${step.id}`}>{t('pl.step.reopen')}</button>
              ) : (
                <>
                  {step.proofs === 0 && <span className="pl-hint">{t('pl.step.needProof')}</span>}
                  <button type="button" className="button-primary" onClick={onDone} disabled={step.proofs === 0 || busy === `done-${step.id}`}>
                    <Check className="w-4 h-4" />{t('pl.step.markDone')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fmtKpi = (v, unit) => {
  if (typeof v !== 'number') return '—';
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  if (unit === '%') return `${n}%`;
  return unit && unit !== 'ratio' ? `${n} ${unit}` : `${n}`;
};

function Spark({ values }) {
  if (values.length < 2) return null;
  const w = 90;
  const h = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return <svg width={w} height={h} className="pl-spark"><polyline points={pts} fill="none" stroke="url(#pl-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Main KPI of a step: a simple question, the user types the numbers, the app calculates,
// compares with the suggested target (can be changed) and keeps the history.
function KpiBox({ kpi, disabled, busy, stepId, onSave, onTarget }) {
  const { t, lang } = useLang();
  const fr = lang === 'fr';
  const [num, setNum] = useState('');
  const [den, setDen] = useState('');
  const [value, setValue] = useState('');
  const [target, setTarget] = useState(kpi.target?.target ?? '');
  useEffect(() => { setTarget(kpi.target?.target ?? ''); }, [kpi.target?.target]);

  const ratio = kpi.type === 'ratio';
  const unit = fr && kpi.unitFr ? kpi.unitFr : kpi.unit;
  const ready = ratio ? num !== '' && den !== '' : value !== '';
  const preview = ratio && num !== '' && den !== '' && Number(den) !== 0 ? (Number(num) / Number(den)) * (kpi.percent ? 100 : 1) : null;
  const save = async () => {
    const d = await onSave(ratio ? { num: Number(num), den: Number(den) } : { value: Number(value) });
    if (d) { setNum(''); setDen(''); setValue(''); }
  };
  const dir = kpi.target?.direction || kpi.direction;
  const saveTarget = () => {
    if (String(target) !== String(kpi.target?.target ?? '')) onTarget(target === '' ? null : Number(target), dir);
  };
  const latest = kpi.latest?.value;
  const tv = kpi.target?.target;
  const gap = typeof latest === 'number' && typeof tv === 'number' ? Math.abs(tv - latest) : null;
  const progress = typeof latest === 'number' && typeof tv === 'number'
    ? (dir === 'down' ? (latest <= 0 ? 100 : Math.min(100, (tv / latest) * 100)) : (tv <= 0 ? 100 : Math.min(100, (latest / tv) * 100))) : 0;

  return (
    <div className={`pl-card pl-kpi${kpi.reached ? ' is-reached' : ''}`}>
      <div className="pl-lbl" style={{ marginTop: 2 }}>{kpi.index === 0 ? t('pl.kpi.main') : t('pl.kpi.extra', { n: kpi.index + 1 })}</div>
      <div className="pl-kpihead">
        <b>{fr ? kpi.nameFr : kpi.name}</b>
        <span className="pl-kpival">{kpi.latest ? fmtKpi(latest, unit) : <span className="pl-faint">{t('pl.kpi.none')}</span>}</span>
      </div>
      <div className="pl-kpiq">{fr ? kpi.questionFr : kpi.question}</div>
      {!disabled && (
        <div className="pl-kpiin">
          {ratio ? (
            <>
              <label><span>{fr ? kpi.numFr : kpi.num}</span><input type="number" min="0" className="l6s-field" value={num} onChange={(e) => setNum(e.target.value)} /></label>
              <span className="pl-div">÷</span>
              <label><span>{fr ? kpi.denFr : kpi.den}</span><input type="number" min="0" className="l6s-field" value={den} onChange={(e) => setDen(e.target.value)} /></label>
              <span className="pl-div">=</span>
              <span className="pl-kpipreview">{preview !== null ? fmtKpi(preview, unit) : '—'}</span>
            </>
          ) : (
            <label className="pl-wide"><span>{fr ? kpi.labelFr : kpi.label} ({unit})</span><input type="number" min="0" className="l6s-field" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          )}
          <button type="button" className="button-primary pl-kpibtn" disabled={!ready || busy === `kpi-${stepId}-${kpi.index}`} onClick={save}>{t('pl.kpi.save')}</button>
        </div>
      )}
      <div className="pl-kpitarget">
        <span className="pl-lbl" style={{ margin: 0 }}>{t('pl.kpi.target')}</span>
        <input type="number" className="l6s-field" value={target} disabled={disabled}
          onChange={(e) => setTarget(e.target.value)} onBlur={saveTarget} />
        <span className="pl-faint">{unit === '%' ? '%' : unit} · {dir === 'down' ? t('pl.kpi.down') : t('pl.kpi.up')}</span>
        {kpi.customTarget
          ? <button type="button" className="pl-linkbtn" disabled={disabled} onClick={() => onTarget(null, dir)}>{t('pl.kpi.reset')}</button>
          : <span className="pl-sug">{t('pl.kpi.suggested')}</span>}
        {kpi.reached ? <span className="pl-sstat is-done">✓ {t('pl.kpi.reached')}</span>
          : gap !== null ? <span className="pl-sstat">{t('pl.kpi.toGo', { gap: fmtKpi(gap, unit) })}</span> : null}
      </div>
      {kpi.latest && <div className="pl-bar" style={{ marginTop: 0 }}><i style={{ width: `${progress}%` }} /></div>}
      {kpi.history.length > 0 && (
        <div className="pl-kpihist">
          <Spark values={kpi.history.map((h) => h.value)} />
          <span className="pl-faint">
            {t('pl.kpi.history')}: {kpi.history.slice(-5).map((h) => `${fmtDate(h.created_at, lang).replace(/ \d{4}$/, '')} ${fmtKpi(h.value, unit)}`).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

// Coach answers: plain text with **bold** and "- " bullets
function CoachText({ text }) {
  const inline = (line, key) => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (
    part.startsWith('**') && part.endsWith('**') ? <b key={`${key}-${i}`}>{part.slice(2, -2)}</b> : <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>
  ));
  const blocks = [];
  let list = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { list.push(<li key={i}>{inline(m[1], i)}</li>); return; }
    if (list.length) { blocks.push(<ul key={`u${i}`}>{list}</ul>); list = []; }
    if (line) blocks.push(<p key={i}>{inline(line, i)}</p>);
  });
  if (list.length) blocks.push(<ul key="u-end">{list}</ul>);
  return <div className="pl-coachtext">{blocks}</div>;
}

function HowPanel({ view }) {
  const { t } = useLang();
  const { lang } = useLang();
  const p = view.plan;
  const b = p.target_basis || {};
  const items = [
    ['s1', { start: fmtPct(p.start_prediction) }],
    ['s2', { total: b.total ?? '—', target: p.target_pct ?? '—', label: lang === 'fr' ? b.labelFr : b.labelEn, n: b.n ?? '—', pred: fmtPct(p.target_prediction) }],
    ['s3', {}],
    ['s4', {}],
    ['s5', { pct: view.totals.pct }],
    ['s6', {}],
    ['s7', { start: fmtPct(view.plan.start_prediction), now: fmtPct(view.plan.current_prediction) }],
    ['s8', { weeks: view.totals.weeks }],
    ['s9', {}],
    ['s10', {}]
  ];
  return (
    <div className="pl-scroll pl-pad">
      <div className="pl-how">
        <h3>{t('pl.how.title')}</h3>
        <p className="pl-muted">{t('pl.how.intro')}</p>
        <div className="pl-howgrid">
          {items.map(([k, vars]) => (
            <div key={k} className="pl-card">
              <b>{t(`pl.how.${k}`)}</b>
              <p className="pl-p">{t(`pl.how.${k}t`, vars)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
