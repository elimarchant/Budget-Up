// Small helpers: responses, errors, crypto, validation, dates.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export const uuid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Workers' WebCrypto caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- validation ----------
export function str(v, { max = 200, min = 0, field = 'value' } = {}) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}

/** Shekels (number or "12.50") -> integer agorot. */
export function amountToAgorot(v) {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '').trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'Enter a valid amount');
  const agorot = Math.round(n * 100);
  if (agorot <= 0) throw new HttpError(400, 'Amount must be more than zero');
  if (agorot > 100_000_000_00) throw new HttpError(400, 'Amount is too large');
  return agorot;
}

export function dateStr(v, field = 'date') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `Invalid ${field}`);
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new HttpError(400, `Invalid ${field}`);
  return v;
}

export function monthStr(v) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(400, 'Invalid month');
  return v;
}

export function oneOf(v, allowed, field = 'value') {
  if (!allowed.includes(v)) throw new HttpError(400, `Invalid ${field}`);
  return v;
}

export function validEmail(v) {
  const s = str(v, { max: 254, field: 'Email' });
  if (!s) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'That email address does not look right');
  return s;
}

// ---------- time (the app is for Israel) ----------
export const TZ = 'Asia/Jerusalem';

/** Today's date in Israel as YYYY-MM-DD. */
export function todayIL(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: TZ });
}
