// Shared browser helpers: API client, formatting, icons. All text is rendered through
// Preact (auto-escaped); nothing from PayPal or uploads is ever inserted as HTML.
import { html } from '/vendor/htm-preact.js';

export async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the Dispute Defender server.');
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed (HTTP ${res.status}).`);
    err.status = res.status;
    err.paypal = json?.paypal ?? null;
    throw err;
  }
  return json;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');

export function fmtMoney(m) {
  if (!m) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(Number(m.value));
  } catch {
    return `${m.value} ${m.currency}`;
  }
}

export const humanize = (code) => (code ? String(code).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

/** "19d 4h left", "5h 12m left", "overdue by 2d 1h". */
export function fmtRemaining(dueAt, now = Date.now()) {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const span = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? `overdue by ${span}` : `${span} left`;
}

export function fmtAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(iso);
}

export const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export const urgencyTone = { overdue: 'danger', critical: 'danger', soon: 'warn', ok: 'ok', closed: '', waiting: '', unknown: '' };
export const waitingLabel = { paypal: 'Waiting on PayPal', buyer: 'Waiting on the buyer' };

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const svg = (paths) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const Icon = {
  shield: () => html`<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 4 6.5v8.2c0 7.2 4.900 13 12 15.300 7.100-2.300 12-8.100 12-15.300V6.500L16 2Z" fill="#3b5bdb" /><path d="m10.500 16.200 3.800 3.800 7.200-7.600" fill="none" stroke="#fff" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round" /></svg>`,
  shieldOutline: () => svg(html`<path d="M12 3 4.500 6v5.500c0 4.700 3.100 8.400 7.500 9.800 4.400-1.400 7.500-5.100 7.500-9.800V6L12 3Z" /><path d="m9 12 2.200 2.200L15 10.200" />`),
  clock: () => svg(html`<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />`),
  sync: () => svg(html`<path d="M20 11a8 8 0 0 0-14.300-4.500L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.300 4.500L20 16" /><path d="M20 20v-4h-4" />`),
  spark: () => svg(html`<path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3Z" /><path d="M19 16l.700 2.300L22 19l-2.300.700L19 22l-.700-2.300L16 19l2.300-.700L19 16Z" />`),
  check: () => svg(html`<path d="m5 12.500 4.500 4.500L19 7.500" />`),
  alert: () => svg(html`<path d="M12 4 2.500 20h19L12 4Z" /><path d="M12 10v4.500" /><path d="M12 17.500v.010" />`),
  info: () => svg(html`<circle cx="12" cy="12" r="9" /><path d="M12 11v5.500" /><path d="M12 7.500v.010" />`),
  copy: () => svg(html`<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" />`),
  send: () => svg(html`<path d="M21 3 10 14" /><path d="M21 3l-7 18-4-7-7-4 18-7Z" />`),
  file: () => svg(html`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" />`),
  x: () => svg(html`<path d="M6 6l12 12M18 6 6 18" />`),
  plus: () => svg(html`<path d="M12 5v14M5 12h14" />`),
  list: () => svg(html`<path d="M8 6h12M8 12h12M8 18h12M4 6h.010M4 12h.010M4 18h.010" />`),
  external: () => svg(html`<path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />`),
};
