// Small helpers shared by the new admin screens.
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';

export const authHeaders = (extra = {}) => ({
  ...extra,
  Authorization: 'Bearer ' + (localStorage.getItem('lss_token') || '')
});

// fetch + JSON + readable error message
export async function apiFetch(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || data.detail || `Request failed (${response.status})`);
  }
  return data;
}

// Avatar helpers
const AVATAR_COLORS = [
  'linear-gradient(135deg,#2b7a8c,#b7d83b)',
  'linear-gradient(135deg,#60a5fa,#a78bfa)',
  'linear-gradient(135deg,#f59e0b,#f472b6)',
  'linear-gradient(135deg,#34d399,#22d3ee)',
  'linear-gradient(135deg,#fb7185,#f59e0b)'
];

export const avatarColor = (text) =>
  AVATAR_COLORS[[...(text || '?')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];

export const initials = (name) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || '?';
