import React, { useEffect, useState } from 'react';
import { Shield, User, Copy, Check } from 'lucide-react';
import { avatarColor, initials } from '../api';
import { useLang } from '../i18n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Name, email and role, with a live preview card on top.
export default function UserForm({ initial = {}, submitLabel, onSubmit, children, resetKey = 0, autoFocus = false, emailOptional = false }) {
  const { t } = useLang();
  const [name, setName] = useState(initial.name || '');
  const [email, setEmail] = useState(initial.email || '');
  const [role, setRole] = useState(initial.role === 'admin' ? 'admin' : 'utilisateur');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reload the fields when another user is opened, or after a successful add
  useEffect(() => {
    setName(initial.name || '');
    setEmail(initial.email || '');
    setRole(initial.role === 'admin' ? 'admin' : 'utilisateur');
    setError('');
  }, [initial.id, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) return setError(t('uf.errName'));
    if (!(emailOptional && !cleanEmail) && !EMAIL_RE.test(cleanEmail)) return setError(t('uf.errEmail'));
    setBusy(true);
    setError('');
    try {
      await onSubmit({ name: cleanName, email: cleanEmail, role });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isAdminRole = role === 'admin';

  return (
    <form className="l6s-box" onSubmit={handleSubmit}>
      <div className="l6s-uform__head">
        <div className="l6s-ua is-big" style={{ background: avatarColor(name) }}>{initials(name)}</div>
        <div>
          <b>{name.trim() || t('uf.newUser')}</b>
          <small>{email.trim() || 'name@company.com'}</small>
        </div>
        <span className={`l6s-role${isAdminRole ? '' : ' is-user'}`}>{isAdminRole ? t('role.ADMIN') : t('role.USER')}</span>
      </div>

      <label className="l6s-lbl">{t('uf.fullName')}</label>
      <input
        className="l6s-field"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(''); }}
        placeholder={t('uf.namePh')}
        autoComplete="off"
        autoFocus={autoFocus}
      />

      <label className="l6s-lbl">{t('uf.email')}</label>
      <input
        className="l6s-field"
        type="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(''); }}
        placeholder="name@company.com"
        autoComplete="off"
      />

      <label className="l6s-lbl">{t('uf.role')}</label>
      <div className="l6s-rolepick">
        <button type="button" className={isAdminRole ? '' : 'is-on'} onClick={() => setRole('utilisateur')}>
          <span><User className="w-4 h-4" />{t('uf.user')}</span>
          <small>{t('uf.userSub')}</small>
        </button>
        <button type="button" className={`is-admin${isAdminRole ? ' is-on' : ''}`} onClick={() => setRole('admin')}>
          <span><Shield className="w-4 h-4" />{t('uf.admin')}</span>
          <small>{t('uf.adminSub')}</small>
        </button>
      </div>

      {error && <div className="l6s-err">{error}</div>}

      <div className="l6s-row" style={{ marginTop: 14 }}>
        <button type="submit" className={`button-primary${children ? '' : ' l6s-full'}`} disabled={busy}>
          {busy ? t('uf.saving') : submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

// Shows a one-time password once, with a copy button.
export function TempPasswordCard({ user, password, onClose }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  if (!password) return null;
  const copy = async () => {
    const text = `Email: ${user?.email || user?.username}\nPassword: ${password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(t('uf.copyPrompt'), text);
    }
  };
  return (
    <div className="l6s-cred">
      <div className="l6s-cred__top">
        <b>{t('uf.credTitle', { name: user?.name || t('uf.theUser') })}</b>
        {onClose && <button type="button" className="l6s-linkbtn" onClick={onClose}>{t('uf.hide')}</button>}
      </div>
      <code>{password}</code>
      <div className="l6s-muted">{t('uf.credHint')}</div>
      <div className="l6s-row">
        <button type="button" className="button-secondary" onClick={copy}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? t('uf.copied') : t('uf.copy')}
        </button>
      </div>
    </div>
  );
}
