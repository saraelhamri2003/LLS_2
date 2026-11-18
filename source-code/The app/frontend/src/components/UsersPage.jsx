import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Pencil, Trash2, Loader2, RotateCcw } from 'lucide-react';
import { avatarColor, initials } from '../api';
import UserForm, { TempPasswordCard } from './UserForm';
import { useLang } from '../i18n';

const COLUMNS = [
  { key: 'name', label: 'up.col.name' },
  { key: 'email', label: 'up.col.email' },
  { key: 'role', label: 'up.col.role' },
  { key: 'createdAt', label: 'up.col.added' }
];

const formatDate = (iso, lang) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function UsersPage({ usersApi, currentUser, onHome, showToast }) {
  const { t, lang } = useLang();
  const { users, loading, error, addUser, updateUser, deleteUser, resetPassword } = usersApi;
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [sort, setSort] = useState({ key: 'createdAt', dir: -1 });
  const [drawer, setDrawer] = useState(null); // null | { mode: 'new' } | { mode: 'edit', id }
  const [drawerTop, setDrawerTop] = useState(0);
  const [created, setCreated] = useState(null); // { user, tempPassword }
  const toolRef = useRef(null);

  const rows = useMemo(() => users.map((u) => ({
    ...u,
    name: u.name || u.username,
    email: u.email || '',
    login: u.email || u.username
  })), [users]);

  const counts = {
    '': rows.length,
    admin: rows.filter((u) => u.role === 'admin').length,
    utilisateur: rows.filter((u) => u.role !== 'admin').length
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((u) =>
      (!roleFilter || (roleFilter === 'admin' ? u.role === 'admin' : u.role !== 'admin'))
      && (!q || u.name.toLowerCase().includes(q) || u.login.toLowerCase().includes(q)));
    const { key, dir } = sort;
    return [...list].sort((a, b) => {
      const x = String(a[key] || ''); const y = String(b[key] || '');
      return x.localeCompare(y) * dir;
    });
  }, [rows, search, roleFilter, sort]);

  const editing = drawer?.mode === 'edit' ? rows.find((u) => u.id === drawer.id) : null;

  const openDrawer = (next) => {
    const tool = toolRef.current;
    setDrawerTop(window.innerWidth > 760 && tool ? tool.offsetTop + tool.offsetHeight : 0);
    setCreated(null);
    setDrawer(next);
  };
  const closeDrawer = () => { setDrawer(null); setCreated(null); };

  // Esc closes the panel first
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && drawer) {
        e.stopPropagation();
        closeDrawer();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));

  const handleDelete = async (user) => {
    if (!window.confirm(t('up.confirmDelete', { name: user.name, login: user.login }))) return;
    try {
      await deleteUser(user.id);
      if (drawer?.id === user.id) closeDrawer();
      showToast(t('up.toastRemoved', { name: user.name }));
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleReset = async (user) => {
    if (!window.confirm(t('up.confirmReset', { name: user.name }))) return;
    try {
      const data = await resetPassword(user.id);
      setCreated({ user, tempPassword: data.tempPassword });
    } catch (err) {
      showToast(err.message, true);
    }
  };

  return (
    <section className="panel l6s-work">
      <div className="l6s-work__head">
        <div>
          <div className="l6s-crumb"><button type="button" onClick={onHome}>{t('top.home')}</button><span>/</span>{t('up.title')}</div>
          <h2>{t('up.title')}</h2>
          <div className="l6s-work__sub">{t('up.count', { n: rows.length, a: counts.admin })}</div>
        </div>
        <div className="l6s-row" style={{ marginTop: 0 }}>
          <button type="button" className="button-secondary" onClick={onHome}>{t('up.back')}</button>
          <button type="button" className="button-primary" onClick={() => openDrawer({ mode: 'new' })}>{t('up.add')}</button>
        </div>
      </div>

      <div className="l6s-tool" ref={toolRef}>
        <label className="l6s-search">
          <Search className="w-4 h-4" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('up.search')} />
        </label>
        <div className="l6s-rfilter">
          {[['', t('up.all')], ['admin', t('up.admins')], ['utilisateur', t('up.users')]].map(([key, label]) => (
            <button type="button" key={label} className={roleFilter === key ? 'is-on' : ''} onClick={() => setRoleFilter(key)}>
              {label}<i>{counts[key]}</i>
            </button>
          ))}
        </div>
      </div>

      <div className="l6s-tablewrap">
        {loading && !rows.length ? (
          <div className="l6s-loading"><Loader2 className="w-6 h-6 animate-spin" style={{ margin: '0 auto 8px' }} />{t('up.loading')}</div>
        ) : error ? (
          <div className="l6s-loading" style={{ color: 'var(--l6s-admin)' }}>{t('up.loadError', { msg: error })}</div>
        ) : (
          <table className="l6s-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={`is-sortable${sort.key === col.key ? ' is-sorted' : ''}`} onClick={() => sortBy(col.key)}>
                    {t(col.label)}<span className="l6s-arr">{sort.key === col.key ? (sort.dir > 0 ? '↑' : '↓') : '↕'}</span>
                  </th>
                ))}
                <th>{t('up.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} className={drawer?.id === u.id ? 'is-picked' : ''} onClick={() => openDrawer({ mode: 'edit', id: u.id })}>
                  <td>
                    <div className="l6s-ucell">
                      <div className="l6s-ua" style={{ background: avatarColor(u.name) }}>{initials(u.name)}</div>
                      <b>{u.name}</b>
                      {u.id === currentUser?.id && <span className="l6s-muted" style={{ fontSize: 12 }}>{t('up.you')}</span>}
                    </div>
                  </td>
                  <td className="l6s-muted">{u.email || <i>{t('up.noEmail', { u: u.username })}</i>}</td>
                  <td><span className={`l6s-role${u.role === 'admin' ? '' : ' is-user'}`}>{u.role === 'admin' ? t('role.ADMIN') : t('role.USER')}</span></td>
                  <td className="l6s-muted">{formatDate(u.createdAt, lang)}</td>
                  <td>
                    <div className="l6s-acts" onClick={(e) => e.stopPropagation()}>
                      <button type="button" title={t('up.edit')} onClick={() => openDrawer({ mode: 'edit', id: u.id })}><Pencil className="w-4 h-4" /></button>
                      {u.id !== currentUser?.id && (
                        <button type="button" className="is-del" title={t('up.delete')} onClick={() => handleDelete(u)}><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr className="l6s-empty"><td colSpan={COLUMNS.length + 1}>{t('up.noMatchRow')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="l6s-work__foot">
        <span>{visible.length ? t('up.showing', { n: visible.length, total: rows.length }) : t('up.noMatch')}</span>
        <span>{t('up.clickRow')}</span>
      </div>

      <aside className={`l6s-drawer${drawer ? ' is-open' : ''}`} style={{ '--l6s-drawer-top': `${drawerTop}px` }}>
        {drawer?.mode === 'new' && (
          <>
            <div className="l6s-drawer__top">
              <div className="section-label">{t('up.newUser')}</div>
              <button type="button" className="l6s-mini" title={t('up.close')} onClick={closeDrawer}><X className="w-4 h-4" /></button>
            </div>
            {created?.tempPassword && (
              <div style={{ marginBottom: 12 }}>
                <TempPasswordCard user={created.user} password={created.tempPassword} />
              </div>
            )}
            <UserForm
              submitLabel={t('up.add')}
              resetKey={created ? created.user?.id : 0}
              autoFocus
              onSubmit={async (data) => {
                const result = await addUser(data);
                setCreated(result);
                showToast(t('up.toastAdded', { name: data.name, role: data.role === 'admin' ? t('role.admin') : t('role.user') }));
              }}
            />
          </>
        )}

        {editing && (
          <>
            <div className="l6s-drawer__top">
              <div>
                <div className="section-label">{t('up.editUser')}</div>
                <div className="l6s-work__sub">{t('up.addedOn', { date: formatDate(editing.createdAt, lang) })}</div>
              </div>
              <button type="button" className="l6s-mini" title={t('up.close')} onClick={closeDrawer}><X className="w-4 h-4" /></button>
            </div>
            <UserForm
              initial={editing}
              emailOptional={!editing.email}
              submitLabel={t('uf.save')}
              onSubmit={async (data) => {
                await updateUser(editing.id, data);
                showToast(t('up.toastUpdated', { name: data.name }));
                closeDrawer();
              }}
            >
              {editing.id !== currentUser?.id && (
                <button type="button" className="button-ghost" style={{ color: 'var(--l6s-admin)' }} onClick={() => handleDelete(editing)}>
                  {t('up.delete')}
                </button>
              )}
            </UserForm>
            <div className="l6s-row">
              <button type="button" className="l6s-linkbtn" onClick={() => handleReset(editing)}>
                <RotateCcw className="w-3 h-3" style={{ display: 'inline', marginRight: 4 }} />{t('up.resetPwd')}
              </button>
            </div>
            {created?.tempPassword && <TempPasswordCard user={created.user} password={created.tempPassword} />}
          </>
        )}
      </aside>
    </section>
  );
}
