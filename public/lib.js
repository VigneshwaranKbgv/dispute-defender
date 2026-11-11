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

/** Deadline urgency -> notice/pill tone. */
export const urgencyTone = { overdue: 'danger', critical: 'danger', soon: 'warn', ok: 'warn', closed: 'neutral', waiting: 'neutral', unknown: 'neutral' };
export const waitingLabel = { paypal: 'PayPal is reviewing this case', buyer: 'Waiting for the buyer to respond' };

/** PayPal dispute status -> short status pill. */
export function statusPill(status) {
  switch (status) {
    case 'WAITING_FOR_SELLER_RESPONSE':
      return { label: 'Waiting on you', tone: 'warn' };
    case 'WAITING_FOR_BUYER_RESPONSE':
      return { label: 'Waiting on buyer', tone: 'info' };
    case 'UNDER_REVIEW':
      return { label: 'Under review', tone: 'info' };
    case 'RESOLVED':
      return { label: 'Resolved', tone: 'ok' };
    case 'OPEN':
      return { label: 'Open', tone: 'info' };
    default:
      return { label: humanize(status), tone: '' };
  }
}

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
  shield: () => html`<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 4 6.5v8.2c0 7.2 4.9 13 12 15.3 7.1-2.3 12-8.1 12-15.3V6.5L16 2Z" fill="#003087" /><path d="m10.5 16.2 3.8 3.8 7.2-7.6" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`,
  clock: () => svg(html`<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />`),
  check: () => svg(html`<circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16 9.8" />`),
  alert: () => svg(html`<path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4.5" /><path d="M12 17.5v.01" />`),
  info: () => svg(html`<circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5v.01" />`),
  file: () => svg(html`<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" />`),
  note: () => svg(html`<path d="M5 5h14v10l-4 4H5V5Z" /><path d="M8 9h8M8 13h5" />`),
  x: () => svg(html`<path d="M6 6l12 12M18 6 6 18" />`),
  back: () => svg(html`<path d="M15 5l-7 7 7 7" />`),
};
