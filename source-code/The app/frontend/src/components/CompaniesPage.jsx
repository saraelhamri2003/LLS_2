import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { apiFetch } from '../api';

const PAGE_SIZE = 12;
const GROUPS = [
  { key: 'IL', label: 'Lean (IL)', tone: 'is-il' },
  { key: 'IS', label: 'Six Sigma (IS)', tone: 'is-is' },
  { key: 'M', label: 'Maturity (M)', tone: 'is-m' }
];

const average = (company, prefix) => {
  const values = Array.from({ length: 7 }, (_, i) => Number(company[`${prefix}${i + 1}`])).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

// "65%" -> 65, "<30%" -> 30, "NaN" -> null
const parsePerf = (text) => {
  const match = String(text ?? '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
};

const COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'il', label: 'Lean avg (IL)' },
  { key: 'is', label: 'Six Sigma avg (IS)' },
  { key: 'm', label: 'Maturity avg (M)' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'perf', label: 'Performance' },
  { key: 'cluster', label: 'Cluster' }
];

export default function CompaniesPage({ onHome }) {
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [strategy, setStrategy] = useState('all');
  const [cluster, setCluster] = useState('all');
  const [sort, setSort] = useState({ key: 'id', dir: 1 });
  const [page, setPage] = useState(1);
  const [pickedId, setPickedId] = useState(null);
  const [drawerTop, setDrawerTop] = useState(0);
  const toolRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    apiFetch('/api/companies')
      .then((data) => setRaw(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Esc closes the detail panel first (the app's Esc handler then goes home)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && pickedId !== null) {
        e.stopPropagation();
        setPickedId(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pickedId]);

  const companies = useMemo(() => raw.map((c, index) => ({
    ...c,
    id: index + 1,
    il: average(c, 'IL'),
    is: average(c, 'IS'),
    m: average(c, 'M'),
    strategy: c.strategie || '—',
    perf: parsePerf(c.estimations),
    perfLabel: c.estimations && c.estimations !== 'NaN' ? c.estimations : '—',
    cluster: c.cluster_id
  })), [raw]);

  const strategies = useMemo(() => [...new Set(companies.map((c) => c.strategy))].sort(), [companies]);
  const clusters = useMemo(() => [...new Set(companies.map((c) => c.cluster))].filter((c) => c !== undefined).sort(), [companies]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, '');
    const rows = companies.filter((c) =>
      (strategy === 'all' || c.strategy === strategy)
      && (cluster === 'all' || String(c.cluster) === cluster)
      && (!q || String(c.id) === q || c.strategy.toLowerCase().includes(q) || c.perfLabel.toLowerCase().includes(q)));
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const x = a[key]; const y = b[key];
      if (x === y) return a.id - b.id;
      if (x === null || x === undefined) return 1; // empty values last
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * dir;
    });
  }, [companies, search, strategy, cluster, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);
  const picked = companies.find((c) => c.id === pickedId);

  const goPage = (n) => {
    setPage(n);
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
  };
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const openCompany = (id) => {
    const tool = toolRef.current;
    setDrawerTop(window.innerWidth > 760 && tool ? tool.offsetTop + tool.offsetHeight : 0);
    setPickedId(id);
  };

  const lo = Math.max(1, Math.min(current - 2, pages - 4));
  const pageNumbers = Array.from({ length: Math.min(5, pages) }, (_, i) => lo + i);
  const fmt = (v) => (v === null ? '—' : v.toFixed(1));

  return (
    <section className="panel l6s-work">
      <div className="l6s-work__head">
        <div>
          <div className="l6s-crumb"><button type="button" onClick={onHome}>Home</button><span>/</span>Manage companies</div>
          <h2>Manage companies</h2>
          <div className="l6s-work__sub">
            {loading ? 'Loading…' : `${companies.length} companies · ${filtered.length} shown with current filters`}
          </div>
        </div>
        <button type="button" className="button-secondary" onClick={onHome}>← Back to chat</button>
      </div>

      <div className="l6s-tool" ref={toolRef}>
        <label className="l6s-search">
          <Search className="w-4 h-4" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by ID, strategy or performance…" />
        </label>
        <select className="l6s-select" value={strategy} onChange={(e) => { setStrategy(e.target.value); setPage(1); }}>
          <option value="all">All strategies</option>
          {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="l6s-select" value={cluster} onChange={(e) => { setCluster(e.target.value); setPage(1); }}>
          <option value="all">All clusters</option>
          {clusters.map((c) => <option key={c} value={String(c)}>Cluster {c}</option>)}
        </select>
      </div>

      <div className="l6s-tablewrap" ref={wrapRef}>
        {loading ? (
          <div className="l6s-loading"><Loader2 className="w-6 h-6 animate-spin" style={{ margin: '0 auto 8px' }} />Loading companies…</div>
        ) : error ? (
          <div className="l6s-loading" style={{ color: 'var(--l6s-admin)' }}>Could not load companies: {error}</div>
        ) : (
          <table className="l6s-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={`is-sortable${sort.key === col.key ? ' is-sorted' : ''}`} onClick={() => sortBy(col.key)}>
                    {col.label}<span className="l6s-arr">{sort.key === col.key ? (sort.dir > 0 ? '↑' : '↓') : '↕'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={pickedId === c.id ? 'is-picked' : ''} onClick={() => openCompany(c.id)}>
                  <td className="l6s-id">#{c.id}</td>
                  <td><span className="l6s-num is-il">{fmt(c.il)}</span></td>
                  <td><span className="l6s-num is-is">{fmt(c.is)}</span></td>
                  <td><span className="l6s-num is-m">{fmt(c.m)}</span></td>
                  <td><span className="l6s-strat">{c.strategy}</span></td>
                  <td>
                    <div className="l6s-perf">
                      <b>{c.perfLabel}</b>
                      <div className="l6s-qbar"><i style={{ width: `${c.perf ?? 0}%` }} /></div>
                    </div>
                  </td>
                  <td>Cluster {c.cluster}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr className="l6s-empty"><td colSpan={COLUMNS.length}>No companies match the filters.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="l6s-work__foot">
        <span>
          {filtered.length
            ? `Showing ${start + 1} - ${start + rows.length} of ${filtered.length} companies`
            : 'No companies match'}
        </span>
        {pages > 1 && (
          <div className="l6s-pages">
            <button type="button" disabled={current === 1} onClick={() => goPage(current - 1)}>‹</button>
            {pageNumbers.map((n) => (
              <button type="button" key={n} className={n === current ? 'is-on' : ''} onClick={() => goPage(n)}>{n}</button>
            ))}
            <button type="button" disabled={current === pages} onClick={() => goPage(current + 1)}>›</button>
          </div>
        )}
      </div>

      <aside className={`l6s-drawer${picked ? ' is-open' : ''}`} style={{ '--l6s-drawer-top': `${drawerTop}px` }}>
        {picked && (
          <>
            <div className="l6s-drawer__top">
              <div>
                <div className="section-label">Company</div>
                <div className="l6s-drawer__big">#{picked.id}</div>
                <div className="l6s-work__sub">Cluster {picked.cluster} · {picked.strategy}</div>
              </div>
              <button type="button" className="l6s-mini" title="Close" onClick={() => setPickedId(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="l6s-perfcard">
              <div className="section-label">Performance</div>
              <div className="l6s-big">{picked.perfLabel}</div>
              <div className="l6s-qbar"><i style={{ width: `${picked.perf ?? 0}%` }} /></div>
            </div>
            {GROUPS.map((g) => (
              <div key={g.key}>
                <span className="l6s-lbl">{g.label}</span>
                <div className="l6s-fgrid">
                  {Array.from({ length: 7 }, (_, i) => `${g.key}${i + 1}`).map((code) => (
                    <div className="l6s-fcell" key={code}>
                      <small>{code}</small>
                      <b className={`l6s-num ${g.tone}`} style={{ background: 'none', minWidth: 0, padding: 0 }}>{picked[code] ?? '—'}</b>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </aside>
    </section>
  );
}
