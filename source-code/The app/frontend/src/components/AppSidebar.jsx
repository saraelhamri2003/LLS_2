import React, { useEffect, useState } from 'react';
import {
  ChevronLeft, Crown, Cpu, Clock, BarChart3, Users, Database, Sun, Moon, User, LogOut, Loader2
} from 'lucide-react';
import { apiFetch } from '../api';
import UserForm, { TempPasswordCard } from './UserForm';

const API_MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

// One sidebar entry: icon always visible, label visible when expanded.
function Item({ icon: Icon, label, sub, on, danger, tip, onClick, onDoubleClick }) {
  return (
    <button
      type="button"
      className={`l6s-item${on ? ' is-on' : ''}${danger ? ' is-danger' : ''}`}
      data-tip={tip || label}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className="l6s-ic"><Icon className="w-5 h-5" /></span>
      <span className="l6s-lab l6s-fade">{label}{sub && <small>{sub}</small>}</span>
    </button>
  );
}

export default function AppSidebar({
  currentUser,
  isAdmin,
  expanded,
  setExpanded,
  section,
  setSection,
  view,
  navigate,
  llm,
  isDark,
  onToggleTheme,
  onLogout,
  usersApi,
  usageRefreshKey
}) {
  const [usage, setUsage] = useState(null);
  const [stats, setStats] = useState(null);
  const [created, setCreated] = useState(null); // { user, tempPassword } after a quick add
  const [formKey, setFormKey] = useState(0);

  const { modelConfig, updateModelConfig, activeModelLabel, runApiTest, apiTestState, apiTestBadge, localModelOptions } = llm;

  // Gemini usage today (admin only), refreshed after answers and every minute
  useEffect(() => {
    if (!isAdmin) return undefined;
    let alive = true;
    const load = () => apiFetch('/api/usage').then((data) => alive && setUsage(data)).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [isAdmin, usageRefreshKey]);

  useEffect(() => {
    if (section === 'stats' && !stats) {
      apiFetch('/api/model-stats').then(setStats).catch(() => setStats({}));
    }
  }, [section, stats]);

  const name = currentUser?.name || currentUser?.username || 'User';
  const mainModel = (modelConfig.apiModel || '').trim();
  const mainUsage = usage?.models?.find((m) => m.model === mainModel) || usage?.models?.[0];
  const ratio = mainUsage?.limit ? Math.min(1, mainUsage.used / mainUsage.limit) : 0;
  const nearLimit = ratio >= 0.8;
  const usageLine = mainUsage
    ? `${mainUsage.used}${mainUsage.limit ? `/${mainUsage.limit}` : ''} today`
    : 'Usage not available yet';

  // Click rules (same as the mockup)
  const toggleSection = (key) => {
    if (expanded && section === key) {
      setSection(null);
    } else {
      setExpanded(true);
      setSection(key);
    }
  };
  const clickUsers = () => {
    if (view === 'users') return navigate('chat'); // 3rd click: home
    if (expanded && section === 'users') return navigate('users'); // 2nd click: full page
    setExpanded(true); // 1st click: quick add
    setSection('users');
    return undefined;
  };
  const clickCompanies = () => navigate(view === 'companies' ? 'chat' : 'companies');

  const quickAdd = async (data) => {
    const result = await usersApi.addUser(data);
    setCreated(result);
    setFormKey((k) => k + 1);
  };

  return (
    <>
      <div className={`l6s-scrim${expanded ? ' is-on' : ''}`} onClick={() => setExpanded(false)} />
      <aside className={`panel l6s-rail${expanded ? ' is-expanded' : ''}`} aria-label="Sidebar">
        <button type="button" className="l6s-handle" title="Expand / collapse" onClick={() => setExpanded(!expanded)}>
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="l6s-rail__inner">
          {/* who is signed in */}
          <div className="l6s-me">
            <button
              type="button"
              className={`l6s-ava${isAdmin ? '' : ' is-user'}`}
              title={name}
              onClick={() => setExpanded(!expanded)}
            >
              {name[0]?.toUpperCase()}
              {isAdmin && <span className="l6s-ava__crown"><Crown className="w-3 h-3" color="#fff" /></span>}
            </button>
            <div className="l6s-who">
              <b>{name}</b>
              <small className={isAdmin ? '' : 'is-user'}>{isAdmin ? 'ADMINISTRATOR' : 'USER'}</small>
            </div>
          </div>

          {isAdmin && (
            <>
              {/* live model status + today's usage ring */}
              <button
                type="button"
                className="l6s-live"
                data-tip={`${activeModelLabel} · ${usageLine}`}
                onClick={() => { setExpanded(true); setSection('usage'); }}
              >
                <span className="l6s-ring">
                  <svg viewBox="0 0 36 36" width="26" height="26">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="var(--chip-bg)" strokeWidth="4" />
                    <circle
                      cx="18" cy="18" r="15" fill="none"
                      stroke={nearLimit ? '#f59e0b' : 'var(--accent-2)'}
                      strokeWidth="4" strokeLinecap="round"
                      strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - ratio)}
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                  <span className={`l6s-dot${nearLimit ? ' is-off' : ''}`} />
                </span>
                <span className="l6s-live__txt l6s-fade">
                  <b>{modelConfig.useApi ? 'Gemini · API' : 'Local model'}</b><br />
                  <span>{modelConfig.useApi ? `Smart routing on · ${usageLine}` : modelConfig.localModel}</span>
                </span>
              </button>

              <div className="l6s-sec">Model</div>
              <div className="l6s-grp">
                <Item icon={Cpu} label="LLM configuration" sub="Mode, model, API key, test" on={section === 'llm'} onClick={() => toggleSection('llm')} />
              </div>
              {section === 'llm' && (
                <div className="l6s-detail">
                  <div className="l6s-box">
                    <div className="l6s-active-line">Active: <b>{activeModelLabel}</b></div>
                    <span className="l6s-lbl">Mode</span>
                    <div className="mode-switch" style={{ width: 'max-content' }}>
                      <button type="button" onClick={() => updateModelConfig({ useApi: false })} className={`mode-button ${modelConfig.useApi ? '' : 'is-active'}`}>Local</button>
                      <button type="button" onClick={() => updateModelConfig({ useApi: true })} className={`mode-button ${modelConfig.useApi ? 'is-active' : ''}`}>API</button>
                    </div>
                    <div className="l6s-hint">Local uses Ollama on the server; API uses Gemini.</div>

                    {modelConfig.useApi ? (
                      <>
                        <label className="l6s-lbl" htmlFor="l6s-api-model">Main model (complex questions)</label>
                        <input id="l6s-api-model" className="l6s-field" list="l6s-api-models" value={modelConfig.apiModel}
                          onChange={(e) => updateModelConfig({ apiModel: e.target.value })} placeholder="gemini-3.8-flash" />
                        <datalist id="l6s-api-models">
                          {API_MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
                        </datalist>

                        <label className="l6s-lbl" htmlFor="l6s-api-key">API key</label>
                        <input id="l6s-api-key" className="l6s-field" type="password" value={modelConfig.apiKey}
                          onChange={(e) => updateModelConfig({ apiKey: e.target.value })} placeholder="Leave blank to use the server key" />
                        <div className="l6s-hint">The server key (.env) is used when this is empty. A key typed here is never saved.</div>

                        <div className="l6s-route">
                          <b>Automatic routing</b><br />
                          Simple questions → gemini-3.5-flash-lite<br />
                          Complex questions → {mainModel || 'main model'}<br />
                          If one model is out of quota, the other answers.
                        </div>

                        <div className="l6s-row">
                          <button type="button" className="button-secondary" onClick={runApiTest} disabled={apiTestState.status === 'loading'}>
                            {apiTestState.status === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
                            Test connection
                          </button>
                          {apiTestBadge && apiTestState.status !== 'loading' && (
                            <span className={apiTestBadge.className}>{apiTestBadge.label}</span>
                          )}
                        </div>
                        {apiTestState.message && apiTestState.status !== 'loading' && (
                          <div className="l6s-hint">{apiTestState.message}</div>
                        )}
                      </>
                    ) : (
                      <>
                        <label className="l6s-lbl" htmlFor="l6s-local-model">Local model</label>
                        <input id="l6s-local-model" className="l6s-field" list="l6s-local-models" value={modelConfig.localModel}
                          onChange={(e) => updateModelConfig({ localModel: e.target.value })} placeholder="llama3:8b" />
                        <datalist id="l6s-local-models">
                          {localModelOptions.map((m) => <option key={m} value={m} />)}
                        </datalist>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="l6s-grp">
                <Item icon={Clock} label="Usage today" sub="Requests per model" on={section === 'usage'} onClick={() => toggleSection('usage')} />
              </div>
              {section === 'usage' && (
                <div className="l6s-detail">
                  <div className="l6s-box">
                    {!usage && <div className="l6s-muted" style={{ fontSize: 12.5 }}>Loading…</div>}
                    {usage?.models?.map((m) => {
                      const pct = m.limit ? Math.min(100, (m.used / m.limit) * 100) : 0;
                      return (
                        <div className="l6s-qrow" key={m.model}>
                          <div><b>{m.model}</b><span>{m.used}{m.limit ? ` / ${m.limit}` : ''}</span></div>
                          <div className="l6s-qbar"><i className={pct >= 80 ? 'is-warn' : ''} style={{ width: `${pct}%` }} /></div>
                        </div>
                      );
                    })}
                    <div className="l6s-hint">Free daily limits reset at midnight Pacific time (about 8:00 in Morocco).</div>
                  </div>
                </div>
              )}

              <div className="l6s-grp">
                <Item icon={BarChart3} label="Model statistics" sub="Accuracy & metrics" on={section === 'stats'} onClick={() => toggleSection('stats')} />
              </div>
              {section === 'stats' && (
                <div className="l6s-detail">
                  <div className="l6s-stats">
                    {[
                      ['Samples', stats?.trainingSamples ?? '…'],
                      ['RF trees', stats?.rfTrees ?? '…'],
                      ['CSF factors', stats?.csfFactors ?? '…'],
                      ['Strategies', stats?.strategies ?? '…']
                    ].map(([label, value]) => (
                      <div className="l6s-stat" key={label}><small>{label}</small><b>{value}</b></div>
                    ))}
                  </div>
                </div>
              )}

              <div className="l6s-sec">Admin</div>
              <div className="l6s-grp">
                <Item
                  icon={Users}
                  label="Manage users"
                  sub="Quick add · click again for all users"
                  on={view === 'users' || section === 'users'}
                  onClick={clickUsers}
                  onDoubleClick={() => navigate('users')}
                />
              </div>
              {section === 'users' && view !== 'users' && (
                <div className="l6s-detail">
                  {created?.tempPassword && (
                    <div style={{ marginBottom: 10 }}>
                      <TempPasswordCard user={created.user} password={created.tempPassword} onClose={() => setCreated(null)} />
                    </div>
                  )}
                  <UserForm submitLabel="+ Add user" onSubmit={quickAdd} resetKey={formKey} />
                  <button type="button" className="l6s-openall" onClick={() => navigate('users')}>
                    <span>See all users<small>or click the users icon again</small></span>
                    <span>{usersApi.users.length} →</span>
                  </button>
                </div>
              )}
              <div className="l6s-grp">
                <Item icon={Database} label="Manage companies" sub="Opens the full table · click again to close" on={view === 'companies'} onClick={clickCompanies} />
              </div>
            </>
          )}

          <div className="l6s-grow" />
          <div className="l6s-foot l6s-grp">
            <Item icon={isDark ? Sun : Moon} label={isDark ? 'Light mode' : 'Dark mode'} onClick={onToggleTheme} />
            <Item icon={User} label="My profile" on={section === 'profile'} onClick={() => toggleSection('profile')} />
            {section === 'profile' && (
              <div className="l6s-detail" style={{ padding: '4px 0 8px' }}>
                <div className="l6s-box" style={{ fontSize: 13 }}>
                  <div><b>{name}</b></div>
                  <div className="l6s-muted">{currentUser?.email || currentUser?.username}</div>
                  <div style={{ marginTop: 8 }}>
                    <span className={`l6s-role${isAdmin ? '' : ' is-user'}`}>{isAdmin ? 'ADMIN' : 'USER'}</span>
                  </div>
                </div>
              </div>
            )}
            <Item icon={LogOut} label="Logout" danger onClick={onLogout} />
          </div>
        </div>
      </aside>
    </>
  );
}
