// UI helpers: safe HTML templating, money/date formatting, sheets, toasts.
import { fmtAmount, MONTH_NAMES } from './aggregate.js';

// ---------- safe html templates: every ${value} is escaped unless it is already html ----------
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Safe(out);
}
export const render = (el, safe) => { el.innerHTML = safe.s; };

// ---------- Hebrew + English together ----------
// User-written text can be either language: <bdi> lets the browser pick the direction of each piece
// so Hebrew never reorders the English around it. Fixed Hebrew labels use .he.
export const ut = (text) => html`<bdi>${text}</bdi>`;
export const HE_MAASER = html`<bdi class="he" lang="he" dir="rtl">מעשר</bdi>`;

// ---------- money ----------
/** kind: 'income' | 'expense' | 'balance' | 'maaser' | undefined. Negative balances turn red. */
export function money(agorot, kind = '') {
  const neg = agorot < 0 && (kind === 'balance' || kind === 'maaser');
  return html`<span class="amt ${kind} ${neg ? 'neg' : ''}" dir="ltr">${agorot < 0 ? '-' : ''}₪${fmtAmount(Math.abs(agorot))}</span>`;
}

// ---------- dates ----------
const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const lastDay = (month) => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const monthRange = (month) => ({ from: `${month}-01`, to: `${month}-${pad(lastDay(month))}` });
export const yearRange = (year) => ({ from: `${year}-01-01`, to: `${year}-12-31` });
export const dayParts = (date) => {
  const [, m, d] = date.split('-').map(Number);
  return { day: d, mon: MONTH_NAMES[m - 1].slice(0, 3) };
};
export function dayHeading(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = dt.toLocaleDateString('en-GB', { weekday: 'long' });
  return `${wd}, ${d} ${MONTH_NAMES[m - 1]}`;
}

// ---------- toast ----------
let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show ${isError ? 'err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 4200 : 2200);
}

// ---------- bottom sheet ----------
const sheetRoot = () => document.getElementById('sheet-root');
let sheetStack = [];

/** Opens a sheet. `body` is html. `mount(el, close)` wires up events. Returns close(). */
export function openSheet({ title, body, mount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  // `title` may be plain text or html (e.g. with the Hebrew label); the aria label needs plain text.
  const label = title instanceof Safe ? title.s.replace(/<[^>]*>/g, '') : title;
  render(wrap, html`<div class="sheet" role="dialog" aria-modal="true" aria-label="${label}">
    <div class="grip"></div>
    <div class="sheet-head"><h2>${title}</h2><button class="close" type="button" aria-label="Close" data-close>✕</button></div>
    <div class="sheet-body">${body}</div></div>`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.remove();
    sheetStack = sheetStack.filter((s) => s !== close);
    if (onClose) onClose();
  };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  sheetRoot().appendChild(wrap);
  sheetStack.push(close);
  if (mount) mount(wrap.querySelector('.sheet-body'), close);
  return close;
}
export const closeAllSheets = () => [...sheetStack].forEach((c) => c());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1](); });

export function confirmSheet({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      body: html`<p style="margin-top:0">${message}</p>
        <div class="actions"><button class="btn" data-no type="button">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes type="button">${confirmLabel}</button></div>`,
      mount(el, close) {
        el.querySelector('[data-no]').onclick = close;
        el.querySelector('[data-yes]').onclick = () => { answered = true; resolve(true); close(); };
      },
      onClose() { if (!answered) resolve(false); },
    });
  });
}

/** Run an async action with the button disabled; show errors in the form's .form-error slot or a toast. */
export async function withBusy(btn, fn, errEl) {
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');
  try { return await fn(); } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.classList.remove('hidden'); } else toast(e.message, true);
  } finally { btn.disabled = false; }
}
