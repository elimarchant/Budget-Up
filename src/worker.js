// Budget Up API (Cloudflare Worker + D1). Static app files are served by the assets binding.
import {
  HttpError, json, uuid, nowIso, randomToken, sha256Hex, hashPassword, safeEqual,
  str, amountToAgorot, dateStr, monthStr, oneOf, validEmail, todayIL,
} from './lib.js';
import { sendUserSummary, maaserFor } from './email.js';
import { addMonths } from '../public/js/aggregate.js';

const COOKIE = 'bu_session';
const SESSION_DAYS = 365;

// Default categories for a new ledger: null items = standalone, arrays = subcategories.
const SEED = [
  ['Rent'], ['Bills'],
  ['Food', ['Shopping', 'Restaurants', 'Snacks', 'Treats']],
  ['Hygiene', ['Beauty', 'Toiletries']],
  ['Medical'], ['SIM'], ['WIFI'], ['Transportation'], ['Gifts to others'], ['Clothes'], ['Household'],
];

// ---------------------------------------------------------------- helpers
const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);

function getCookie(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

function sessionCookie(url, token, days = SESSION_DAYS) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure}`;
}

async function createSession(env, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await run(env, 'INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)',
    await sha256Hex(token), userId, nowIso(), expires);
  return token;
}

async function authUser(req, env) {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const row = await first(env,
    `SELECT u.id,u.username,u.display_name,u.email,u.email_summary,s.expires_at
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, await sha256Hex(token));
  if (!row || row.expires_at < nowIso()) return null;
  return { ...row, _token: token };
}

const publicUser = (u) => ({
  id: u.id, username: u.username, display_name: u.display_name, email: u.email || '', email_summary: !!u.email_summary,
});

async function requireMember(env, ledgerId, userId) {
  const m = await first(env, 'SELECT role FROM members WHERE ledger_id=? AND user_id=?', ledgerId, userId);
  if (!m) throw new HttpError(404, 'Budget not found');
  return m.role;
}

async function createLedger(env, userId, name) {
  const id = uuid(), now = nowIso();
  const stmts = [
    stmt(env, 'INSERT INTO ledgers (id,name,owner_id,created_at) VALUES (?,?,?,?)', id, name, userId, now),
    stmt(env, "INSERT INTO members (ledger_id,user_id,role,joined_at) VALUES (?,?, 'owner', ?)", id, userId, now),
  ];
  let sort = 0;
  for (const [name, subs] of SEED) {
    const cid = uuid();
    stmts.push(stmt(env, 'INSERT INTO categories (id,ledger_id,name,parent_id,sort) VALUES (?,?,?,NULL,?)', cid, id, name, sort++));
    (subs || []).forEach((s, i) =>
      stmts.push(stmt(env, 'INSERT INTO categories (id,ledger_id,name,parent_id,sort) VALUES (?,?,?,?,?)', uuid(), id, s, cid, i)));
  }
  await env.DB.batch(stmts);
  return id;
}

async function userLedgers(env, userId) {
  return all(env,
    `SELECT l.id,l.name,m.role,(SELECT COUNT(*) FROM members x WHERE x.ledger_id=l.id) AS member_count
       FROM ledgers l JOIN members m ON m.ledger_id=l.id WHERE m.user_id=? ORDER BY l.created_at`, userId);
}

/** Add the ledger's default income/expenses for `month` once (idempotent, race-safe). */
async function ensureDefaults(env, ledgerId, month) {
  const defs = await all(env, 'SELECT * FROM defaults WHERE ledger_id=? AND start_month<=?', ledgerId, month);
  for (const d of defs) {
    const claimed = await run(env, 'INSERT OR IGNORE INTO defaults_applied (default_id,month) VALUES (?,?)', d.id, month);
    if (claimed.meta.changes) {
      await run(env,
        `INSERT INTO transactions (id,ledger_id,type,amount,category_id,comment,date,created_by,created_at,default_id)
         VALUES (?,?,?,?,?,?,?,NULL,?,?)`,
        uuid(), ledgerId, d.type, d.amount, d.category_id, d.comment, `${month}-01`, nowIso(), d.id);
    }
  }
}

async function checkCategory(env, ledgerId, categoryId) {
  const c = await first(env, 'SELECT id,archived FROM categories WHERE id=? AND ledger_id=?', categoryId, ledgerId);
  if (!c) throw new HttpError(400, 'Pick a category');
  return c;
}

const txSelect = `SELECT t.id,t.type,t.amount,t.category_id,t.comment,t.date,t.default_id,t.created_at,
  u.display_name AS created_by_name FROM transactions t LEFT JOIN users u ON u.id=t.created_by`;

// ---------------------------------------------------------------- handlers
const routes = [];
const route = (method, pattern, handler, { auth = true } = {}) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, auth });

// ---- auth
async function startSession(c, userId, extra = {}) {
  const token = await createSession(c.env, userId);
  const user = await first(c.env, 'SELECT * FROM users WHERE id=?', userId);
  return json({ user: publicUser(user), ledgers: await userLedgers(c.env, userId), ...extra }, 200,
    { 'set-cookie': sessionCookie(c.url, token) });
}

async function acceptInvite(env, token, userId) {
  const inv = await first(env, 'SELECT * FROM invites WHERE token=?', token);
  if (!inv || inv.expires_at < nowIso()) throw new HttpError(410, 'This invite link has expired');
  await run(env, "INSERT OR IGNORE INTO members (ledger_id,user_id,role,joined_at) VALUES (?,?, 'member', ?)", inv.ledger_id, userId, nowIso());
  return inv.ledger_id;
}

route('POST', '/api/signup', async (c) => {
  const b = c.body;
  const username = str(b.username, { min: 3, max: 30, field: 'Username' }).toLowerCase();
  if (!/^[a-z0-9_.-]+$/.test(username)) throw new HttpError(400, 'Username can use letters, numbers, . _ and -');
  const password = str(b.password, { min: 8, max: 200, field: 'Password' });
  const display = str(b.display_name || username, { min: 1, max: 40, field: 'Name' });
  const email = b.email ? validEmail(b.email) : '';
  let inviteLedger = null;
  if (b.invite) {
    const inv = await first(c.env, 'SELECT * FROM invites WHERE token=?', String(b.invite));
    if (!inv || inv.expires_at < nowIso()) throw new HttpError(410, 'This invite link has expired');
    inviteLedger = inv.ledger_id;
  }
  const { hash, salt } = await hashPassword(password);
  const id = uuid();
  try {
    await run(c.env, 'INSERT INTO users (id,username,display_name,email,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?,?,?)',
      id, username, display, email || null, hash, salt, nowIso());
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'That username is taken');
    throw e;
  }
  let ledgerId = inviteLedger;
  if (inviteLedger) await acceptInvite(c.env, String(b.invite), id);
  else ledgerId = await createLedger(c.env, id, `${display}'s budget`);
  return startSession(c, id, { joined_ledger: ledgerId });
}, { auth: false });

route('POST', '/api/login', async (c) => {
  const username = str(c.body.username, { max: 30 }).toLowerCase();
  const password = str(c.body.password, { max: 200 });
  const since = Date.now() - 15 * 60 * 1000;
  const recent = await first(c.env, 'SELECT COUNT(*) AS n FROM login_attempts WHERE username=? AND at>?', username, since);
  if (recent.n >= 8) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const u = await first(c.env, 'SELECT * FROM users WHERE username=?', username);
  const { hash } = await hashPassword(password, u ? u.pw_salt : btoa('0000000000000000'));
  if (!u || !safeEqual(hash, u.pw_hash)) {
    await run(c.env, 'INSERT INTO login_attempts (username,ip,at) VALUES (?,?,?)', username, c.req.headers.get('cf-connecting-ip'), Date.now());
    await run(c.env, 'DELETE FROM login_attempts WHERE at<?', Date.now() - 864e5);
    throw new HttpError(401, 'Wrong username or password');
  }
  await run(c.env, 'DELETE FROM login_attempts WHERE username=?', username);
  let joined = null;
  if (c.body.invite) joined = await acceptInvite(c.env, String(c.body.invite), u.id);
  return startSession(c, u.id, { joined_ledger: joined });
}, { auth: false });

route('POST', '/api/logout', async (c) => {
  await run(c.env, 'DELETE FROM sessions WHERE token_hash=?', await sha256Hex(c.user._token));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(c.url, '', 0) });
});

route('GET', '/api/me', async (c) => {
  if (!c.user) return json({ user: null }); // signed out: a normal answer, not an error
  // Rolling session: refresh the cookie + expiry each time the app opens, so you stay signed in.
  const th = await sha256Hex(c.user._token);
  await run(c.env, 'UPDATE sessions SET expires_at=? WHERE token_hash=?',
    new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), th);
  return json({ user: publicUser(c.user), ledgers: await userLedgers(c.env, c.user.id) }, 200,
    { 'set-cookie': sessionCookie(c.url, c.user._token) });
}, { auth: false });

route('PATCH', '/api/me', async (c) => {
  const b = c.body;
  const name = b.display_name !== undefined ? str(b.display_name, { min: 1, max: 40, field: 'Name' }) : c.user.display_name;
  const email = b.email !== undefined ? (b.email ? validEmail(b.email) : '') : (c.user.email || '');
  const summary = b.email_summary !== undefined ? (b.email_summary ? 1 : 0) : c.user.email_summary;
  await run(c.env, 'UPDATE users SET display_name=?, email=?, email_summary=? WHERE id=?', name, email || null, summary, c.user.id);
  const u = await first(c.env, 'SELECT * FROM users WHERE id=?', c.user.id);
  return json({ user: publicUser(u) });
});

route('POST', '/api/me/password', async (c) => {
  const u = await first(c.env, 'SELECT * FROM users WHERE id=?', c.user.id);
  const { hash } = await hashPassword(str(c.body.current, { max: 200 }), u.pw_salt);
  if (!safeEqual(hash, u.pw_hash)) throw new HttpError(401, 'Current password is wrong');
  const next = await hashPassword(str(c.body.next, { min: 8, max: 200, field: 'New password' }));
  const keep = await sha256Hex(c.user._token);
  await env_batch(c.env, [
    stmt(c.env, 'UPDATE users SET pw_hash=?, pw_salt=? WHERE id=?', next.hash, next.salt, c.user.id),
    stmt(c.env, 'DELETE FROM sessions WHERE user_id=? AND token_hash<>?', c.user.id, keep), // sign out other devices
  ]);
  return json({ ok: true });
});
const env_batch = (env, stmts) => env.DB.batch(stmts);

route('POST', '/api/me/test-summary', async (c) => {
  const today = todayIL();
  const month = addMonths(today.slice(0, 7), -1);
  const u = await first(c.env, 'SELECT * FROM users WHERE id=?', c.user.id);
  const r = await sendUserSummary(c.env, u, month, today, { force: true });
  if (r.reason === 'no-email') throw new HttpError(400, 'Add your email address in Account first');
  if (r.reason === 'email-not-configured') throw new HttpError(503, 'Email sending is not set up on the server yet');
  if (!r.ok) throw new HttpError(502, 'Could not send the email');
  return json({ ok: true, month });
});

// ---- invites
route('GET', '/api/invites/:token', async (c) => {
  const inv = await first(c.env,
    `SELECT i.expires_at,l.name AS ledger_name,u.display_name AS inviter FROM invites i
       JOIN ledgers l ON l.id=i.ledger_id JOIN users u ON u.id=i.created_by WHERE i.token=?`, c.params.token);
  if (!inv || inv.expires_at < nowIso()) throw new HttpError(410, 'This invite link has expired');
  return json({ ledger_name: inv.ledger_name, inviter: inv.inviter });
}, { auth: false });

route('POST', '/api/invites/:token/accept', async (c) => {
  const ledgerId = await acceptInvite(c.env, c.params.token, c.user.id);
  return json({ ledger_id: ledgerId, ledgers: await userLedgers(c.env, c.user.id) });
});

// ---- ledgers
route('POST', '/api/ledgers', async (c) => {
  const id = await createLedger(c.env, c.user.id, str(c.body.name, { min: 1, max: 60, field: 'Name' }));
  return json({ id, ledgers: await userLedgers(c.env, c.user.id) });
});

route('PATCH', '/api/ledgers/:id', async (c) => {
  if (await requireMember(c.env, c.params.id, c.user.id) !== 'owner') throw new HttpError(403, 'Only the owner can rename this budget');
  await run(c.env, 'UPDATE ledgers SET name=? WHERE id=?', str(c.body.name, { min: 1, max: 60, field: 'Name' }), c.params.id);
  return json({ ledgers: await userLedgers(c.env, c.user.id) });
});

route('DELETE', '/api/ledgers/:id', async (c) => {
  if (await requireMember(c.env, c.params.id, c.user.id) !== 'owner') throw new HttpError(403, 'Only the owner can delete this budget');
  const id = c.params.id;
  await env_batch(c.env, [
    stmt(c.env, 'DELETE FROM defaults_applied WHERE default_id IN (SELECT id FROM defaults WHERE ledger_id=?)', id),
    stmt(c.env, 'DELETE FROM transactions WHERE ledger_id=?', id),
    stmt(c.env, 'DELETE FROM defaults WHERE ledger_id=?', id),
    stmt(c.env, 'DELETE FROM maaser_gives WHERE ledger_id=?', id),
    stmt(c.env, 'DELETE FROM invites WHERE ledger_id=?', id),
    stmt(c.env, 'DELETE FROM members WHERE ledger_id=?', id),
    stmt(c.env, 'DELETE FROM categories WHERE ledger_id=? AND parent_id IS NOT NULL', id),
    stmt(c.env, 'DELETE FROM categories WHERE ledger_id=?', id),
    stmt(c.env, 'DELETE FROM ledgers WHERE id=?', id),
  ]);
  return json({ ledgers: await userLedgers(c.env, c.user.id) });
});

route('GET', '/api/ledgers/:id/members', async (c) => {
  const role = await requireMember(c.env, c.params.id, c.user.id);
  const members = await all(c.env,
    `SELECT u.id,u.display_name,u.username,m.role FROM members m JOIN users u ON u.id=m.user_id
      WHERE m.ledger_id=? ORDER BY m.joined_at`, c.params.id);
  const invites = await all(c.env, 'SELECT token,expires_at FROM invites WHERE ledger_id=? AND expires_at>? ORDER BY created_at DESC',
    c.params.id, nowIso());
  return json({ role, me: c.user.id, members, invites });
});

route('POST', '/api/ledgers/:id/invites', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  const token = randomToken(18);
  const expires = new Date(Date.now() + 14 * 864e5).toISOString();
  await run(c.env, 'INSERT INTO invites (token,ledger_id,created_by,created_at,expires_at) VALUES (?,?,?,?,?)',
    token, c.params.id, c.user.id, nowIso(), expires);
  return json({ token, expires_at: expires });
});

route('DELETE', '/api/ledgers/:id/invites/:token', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  await run(c.env, 'DELETE FROM invites WHERE token=? AND ledger_id=?', c.params.token, c.params.id);
  return json({ ok: true });
});

route('DELETE', '/api/ledgers/:id/members/:uid', async (c) => {
  const role = await requireMember(c.env, c.params.id, c.user.id);
  const self = c.params.uid === c.user.id;
  if (!self && role !== 'owner') throw new HttpError(403, 'Only the owner can remove people');
  const target = await first(c.env, 'SELECT role FROM members WHERE ledger_id=? AND user_id=?', c.params.id, c.params.uid);
  if (!target) throw new HttpError(404, 'Not a member');
  if (target.role === 'owner') throw new HttpError(400, 'The owner cannot leave. Delete the budget instead.');
  await run(c.env, 'DELETE FROM members WHERE ledger_id=? AND user_id=?', c.params.id, c.params.uid);
  return json({ ledgers: await userLedgers(c.env, c.user.id) });
});

// ---- categories
const catList = (env, ledgerId) =>
  all(env, 'SELECT id,name,parent_id,sort,archived FROM categories WHERE ledger_id=? ORDER BY sort,name', ledgerId);

route('GET', '/api/ledgers/:id/categories', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  return json({ categories: await catList(c.env, c.params.id) });
});

route('POST', '/api/ledgers/:id/categories', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  const name = str(c.body.name, { min: 1, max: 40, field: 'Name' });
  let parent = null;
  if (c.body.parent_id) {
    parent = await first(c.env, 'SELECT id,parent_id FROM categories WHERE id=? AND ledger_id=? AND archived=0', c.body.parent_id, c.params.id);
    if (!parent || parent.parent_id) throw new HttpError(400, 'Subcategories can only go under a main category');
  }
  const max = await first(c.env, 'SELECT COALESCE(MAX(sort),-1) AS m FROM categories WHERE ledger_id=? AND parent_id IS ?', c.params.id, parent ? parent.id : null);
  await run(c.env, 'INSERT INTO categories (id,ledger_id,name,parent_id,sort) VALUES (?,?,?,?,?)',
    uuid(), c.params.id, name, parent ? parent.id : null, max.m + 1);
  return json({ categories: await catList(c.env, c.params.id) });
});

route('PATCH', '/api/categories/:cid', async (c) => {
  const cat = await first(c.env, 'SELECT * FROM categories WHERE id=?', c.params.cid);
  if (!cat) throw new HttpError(404, 'Category not found');
  await requireMember(c.env, cat.ledger_id, c.user.id);
  const name = c.body.name !== undefined ? str(c.body.name, { min: 1, max: 40, field: 'Name' }) : cat.name;
  let parentId = cat.parent_id, sort = cat.sort;
  if (c.body.parent_id !== undefined) {
    parentId = c.body.parent_id || null;
    if (parentId) {
      const p = await first(c.env, 'SELECT id,parent_id FROM categories WHERE id=? AND ledger_id=? AND archived=0', parentId, cat.ledger_id);
      if (!p || p.parent_id || p.id === cat.id) throw new HttpError(400, 'Pick a main category to move it under');
      const kids = await first(c.env, 'SELECT COUNT(*) AS n FROM categories WHERE parent_id=? AND archived=0', cat.id);
      if (kids.n) throw new HttpError(400, `"${cat.name}" has subcategories. Move or remove them first.`);
    }
    if (parentId !== cat.parent_id) {
      const max = await first(c.env, 'SELECT COALESCE(MAX(sort),-1) AS m FROM categories WHERE ledger_id=? AND parent_id IS ?', cat.ledger_id, parentId);
      sort = max.m + 1;
    }
  }
  if (c.body.sort !== undefined) sort = Number(c.body.sort) | 0;
  await run(c.env, 'UPDATE categories SET name=?, parent_id=?, sort=? WHERE id=?', name, parentId, sort, cat.id);
  return json({ categories: await catList(c.env, cat.ledger_id) });
});

route('DELETE', '/api/categories/:cid', async (c) => {
  const cat = await first(c.env, 'SELECT * FROM categories WHERE id=?', c.params.cid);
  if (!cat) throw new HttpError(404, 'Category not found');
  await requireMember(c.env, cat.ledger_id, c.user.id);
  // Archive rather than delete so past spending keeps its category in reports.
  await env_batch(c.env, [
    stmt(c.env, 'DELETE FROM defaults WHERE category_id IN (SELECT id FROM categories WHERE id=? OR parent_id=?)', cat.id, cat.id),
    stmt(c.env, 'UPDATE categories SET archived=1 WHERE id=? OR parent_id=?', cat.id, cat.id),
  ]);
  return json({ categories: await catList(c.env, cat.ledger_id) });
});

// ---- transactions
route('GET', '/api/ledgers/:id/transactions', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  const from = dateStr(c.url.searchParams.get('from'), 'from');
  const to = dateStr(c.url.searchParams.get('to'), 'to');
  await ensureDefaults(c.env, c.params.id, todayIL().slice(0, 7));
  const rows = await all(c.env, `${txSelect} WHERE t.ledger_id=? AND t.date>=? AND t.date<=? ORDER BY t.date DESC, t.created_at DESC LIMIT 5000`,
    c.params.id, from, to);
  return json({ transactions: rows });
});

async function readTx(c, ledgerId, existing) {
  const b = c.body;
  const type = existing ? existing.type : oneOf(b.type, ['income', 'expense'], 'type');
  const amount = b.amount !== undefined || !existing ? amountToAgorot(b.amount) : existing.amount;
  const date = b.date !== undefined || !existing ? dateStr(b.date) : existing.date;
  const comment = b.comment !== undefined ? str(b.comment, { max: 200, field: 'Comment' }) : (existing ? existing.comment : '');
  let categoryId = null;
  if (type === 'expense') {
    categoryId = b.category_id !== undefined ? b.category_id : (existing ? existing.category_id : null);
    const cat = await checkCategory(c.env, ledgerId, categoryId);
    if (cat.archived && (!existing || existing.category_id !== categoryId)) throw new HttpError(400, 'That category was removed');
  }
  return { type, amount, date, comment, categoryId };
}

route('POST', '/api/ledgers/:id/transactions', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  const t = await readTx(c, c.params.id, null);
  const id = uuid();
  await run(c.env, `INSERT INTO transactions (id,ledger_id,type,amount,category_id,comment,date,created_by,created_at)
                    VALUES (?,?,?,?,?,?,?,?,?)`, id, c.params.id, t.type, t.amount, t.categoryId, t.comment, t.date, c.user.id, nowIso());
  return json({ transaction: await first(c.env, `${txSelect} WHERE t.id=?`, id) });
});

route('PATCH', '/api/transactions/:tid', async (c) => {
  const ex = await first(c.env, 'SELECT * FROM transactions WHERE id=?', c.params.tid);
  if (!ex) throw new HttpError(404, 'Entry not found');
  await requireMember(c.env, ex.ledger_id, c.user.id);
  const t = await readTx(c, ex.ledger_id, ex);
  await run(c.env, 'UPDATE transactions SET amount=?, category_id=?, comment=?, date=? WHERE id=?',
    t.amount, t.categoryId, t.comment, t.date, ex.id);
  return json({ transaction: await first(c.env, `${txSelect} WHERE t.id=?`, ex.id) });
});

route('DELETE', '/api/transactions/:tid', async (c) => {
  const ex = await first(c.env, 'SELECT ledger_id FROM transactions WHERE id=?', c.params.tid);
  if (!ex) throw new HttpError(404, 'Entry not found');
  await requireMember(c.env, ex.ledger_id, c.user.id);
  await run(c.env, 'DELETE FROM transactions WHERE id=?', c.params.tid);
  return json({ ok: true });
});

// ---- default (recurring) income / expenses
const defaultsList = (env, ledgerId) =>
  all(env, 'SELECT id,type,category_id,amount,comment FROM defaults WHERE ledger_id=? ORDER BY type DESC, created_at', ledgerId);

route('GET', '/api/ledgers/:id/defaults', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  return json({ defaults: await defaultsList(c.env, c.params.id) });
});

async function readDefault(c, ledgerId, existing) {
  const b = c.body;
  const type = existing ? existing.type : oneOf(b.type, ['income', 'expense'], 'type');
  const amount = b.amount !== undefined || !existing ? amountToAgorot(b.amount) : existing.amount;
  const comment = b.comment !== undefined ? str(b.comment, { max: 100, field: 'Comment' }) : (existing ? existing.comment : '');
  let categoryId = null;
  if (type === 'expense') {
    categoryId = b.category_id !== undefined ? b.category_id : existing.category_id;
    const cat = await checkCategory(c.env, ledgerId, categoryId);
    if (cat.archived) throw new HttpError(400, 'That category was removed');
  }
  return { type, amount, comment, categoryId };
}

route('POST', '/api/ledgers/:id/defaults', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  const d = await readDefault(c, c.params.id, null);
  const month = todayIL().slice(0, 7);
  await run(c.env, 'INSERT INTO defaults (id,ledger_id,type,category_id,amount,comment,start_month,created_at) VALUES (?,?,?,?,?,?,?,?)',
    uuid(), c.params.id, d.type, d.categoryId, d.amount, d.comment, month, nowIso());
  await ensureDefaults(c.env, c.params.id, month); // counts for this month straight away
  return json({ defaults: await defaultsList(c.env, c.params.id) });
});

route('PATCH', '/api/defaults/:did', async (c) => {
  const ex = await first(c.env, 'SELECT * FROM defaults WHERE id=?', c.params.did);
  if (!ex) throw new HttpError(404, 'Not found');
  await requireMember(c.env, ex.ledger_id, c.user.id);
  const d = await readDefault(c, ex.ledger_id, ex);
  await run(c.env, 'UPDATE defaults SET amount=?, category_id=?, comment=? WHERE id=?', d.amount, d.categoryId, d.comment, ex.id);
  return json({ defaults: await defaultsList(c.env, ex.ledger_id) });
});

route('DELETE', '/api/defaults/:did', async (c) => {
  const ex = await first(c.env, 'SELECT * FROM defaults WHERE id=?', c.params.did);
  if (!ex) throw new HttpError(404, 'Not found');
  await requireMember(c.env, ex.ledger_id, c.user.id);
  await run(c.env, 'DELETE FROM defaults WHERE id=?', ex.id);
  return json({ defaults: await defaultsList(c.env, ex.ledger_id) });
});

// ---- maaser
async function maaserPayload(env, ledgerId) {
  const ledger = await first(env, 'SELECT created_at FROM ledgers WHERE id=?', ledgerId);
  await ensureDefaults(env, ledgerId, todayIL().slice(0, 7));
  const summary = await maaserFor(env, ledgerId, ledger.created_at, todayIL());
  const gives = await all(env,
    `SELECT g.id,g.amount,g.date,g.comment,u.display_name AS created_by_name FROM maaser_gives g
       LEFT JOIN users u ON u.id=g.created_by WHERE g.ledger_id=? ORDER BY g.date DESC, g.created_at DESC LIMIT 200`, ledgerId);
  return { maaser: summary, gives };
}

route('GET', '/api/ledgers/:id/maaser', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  return json(await maaserPayload(c.env, c.params.id));
});

route('POST', '/api/ledgers/:id/maaser/gives', async (c) => {
  await requireMember(c.env, c.params.id, c.user.id);
  await run(c.env, 'INSERT INTO maaser_gives (id,ledger_id,amount,date,comment,created_by,created_at) VALUES (?,?,?,?,?,?,?)',
    uuid(), c.params.id, amountToAgorot(c.body.amount), dateStr(c.body.date), str(c.body.comment, { max: 200, field: 'Comment' }),
    c.user.id, nowIso());
  return json(await maaserPayload(c.env, c.params.id));
});

route('DELETE', '/api/maaser/gives/:gid', async (c) => {
  const g = await first(c.env, 'SELECT ledger_id FROM maaser_gives WHERE id=?', c.params.gid);
  if (!g) throw new HttpError(404, 'Not found');
  await requireMember(c.env, g.ledger_id, c.user.id);
  await run(c.env, 'DELETE FROM maaser_gives WHERE id=?', c.params.gid);
  return json(await maaserPayload(c.env, g.ledger_id));
});

// ---------------------------------------------------------------- entry points
async function handle(req, env) {
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
  try {
    const mutating = !['GET', 'HEAD'].includes(req.method);
    if (mutating && !(req.headers.get('content-type') || '').includes('application/json')) {
      throw new HttpError(415, 'Expected JSON');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const user = await authUser(req, env);
      if (r.auth && !user) throw new HttpError(401, 'Please sign in');
      let body = {};
      if (mutating) {
        try { body = (await req.json()) || {}; } catch { body = {}; }
        if (typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Bad request');
      }
      return await r.handler({ req, env, url, user, body, params: m.groups || {} });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.log('Unhandled error', e && e.stack || e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

async function monthly(env) {
  const today = todayIL();
  const thisMonth = today.slice(0, 7);
  const prev = addMonths(thisMonth, -1);
  for (const l of await all(env, 'SELECT id FROM ledgers')) await ensureDefaults(env, l.id, thisMonth);
  const users = await all(env, "SELECT * FROM users WHERE email IS NOT NULL AND email<>'' AND email_summary=1");
  for (const u of users) {
    try {
      const r = await sendUserSummary(env, u, prev, today);
      console.log('summary', u.username, prev, r.reason || (r.ok ? 'sent' : 'failed'));
    } catch (e) { console.log('summary failed for', u.username, e && e.stack || e); }
  }
}

export default {
  fetch: handle,
  scheduled: (event, env, ctx) => { ctx.waitUntil(monthly(env)); },
};
