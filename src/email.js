// Monthly summary email: per ledger, main categories with their subcategories (never individual purchases).
import { buildTree, fmtAmount, monthLabel, computeMaaser, sumBy } from '../public/js/aggregate.js';
import { nowIso } from './lib.js';
import { WorkerMailer } from 'worker-mailer';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (a) => `<span dir="ltr" style="unicode-bidi:isolate">₪${fmtAmount(a)}</span>`;

const C = { ink: '#1b2430', muted: '#6b7685', line: '#e6e9ef', income: '#14925a', expense: '#d6455d', accent: '#f5b800' };

/** Gather numbers for one ledger + month. */
export async function ledgerSummary(env, ledger, month) {
  const from = `${month}-01`, to = `${month}-31`;
  const [cats, tx] = await Promise.all([
    env.DB.prepare('SELECT id,name,parent_id,sort,archived FROM categories WHERE ledger_id=?').bind(ledger.id).all(),
    env.DB.prepare('SELECT type,amount,category_id,date FROM transactions WHERE ledger_id=? AND date>=? AND date<=?')
      .bind(ledger.id, from, to).all(),
  ]);
  const rows = tx.results;
  const tree = buildTree(cats.results, rows.filter((r) => r.type === 'expense'));
  const incomeTotal = sumBy(rows, 'income');
  const expenseTotal = sumBy(rows, 'expense');
  return { ledger, month, tree, incomeTotal, expenseTotal, balance: incomeTotal - expenseTotal, empty: rows.length === 0 };
}

export async function maaserFor(env, ledgerId, createdAt, today) {
  const [inc, giv] = await Promise.all([
    env.DB.prepare("SELECT date,amount FROM transactions WHERE ledger_id=? AND type='income'").bind(ledgerId).all(),
    env.DB.prepare('SELECT date,amount FROM maaser_gives WHERE ledger_id=?').bind(ledgerId).all(),
  ]);
  return computeMaaser({ incomes: inc.results, gives: giv.results, today, ledgerMonth: createdAt.slice(0, 7) });
}

function sectionHtml(s, maaser) {
  const rowStyle = `padding:6px 0;border-bottom:1px solid ${C.line}`;
  const cats = s.tree.filter((c) => c.total > 0).map((c) => {
    const subs = c.children.filter((k) => k.total > 0).map((k) => `
      <tr><td style="padding:3px 0 3px 18px;font-size:13px;color:${C.muted}">${esc(k.name)}</td>
          <td align="right" style="padding:3px 0;font-size:13px;color:${C.muted}">${money(k.total)}</td></tr>`).join('');
    return `
      <tr><td style="${rowStyle};font-weight:600">${esc(c.name)}</td>
          <td align="right" style="${rowStyle};font-weight:600;color:${C.expense}">${money(c.total)}</td></tr>${subs}`;
  }).join('') || `<tr><td colspan="2" style="padding:8px 0;color:${C.muted}">No expenses this month.</td></tr>`;

  return `
  <div style="margin:24px 0 0">
    <div style="font-size:17px;font-weight:700;margin-bottom:10px">${esc(s.ledger.name)}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;margin-bottom:10px">
      <tr><td style="padding:3px 0">Income</td><td align="right" style="color:${C.income};font-weight:700">${money(s.incomeTotal)}</td></tr>
      <tr><td style="padding:3px 0">Expenses</td><td align="right" style="color:${C.expense};font-weight:700">${money(s.expenseTotal)}</td></tr>
      <tr><td style="padding:3px 0;border-top:1px solid ${C.line}">Balance</td>
          <td align="right" style="border-top:1px solid ${C.line};font-weight:700;color:${s.balance < 0 ? C.expense : C.income}">${s.balance < 0 ? '-' : ''}${money(Math.abs(s.balance))}</td></tr>
    </table>
    <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};margin:14px 0 4px">Expenses by category</div>
    <table width="100%" cellpadding="0" cellspacing="0">${cats}</table>
    ${maaser ? `<div style="margin-top:14px;font-size:14px;color:${C.muted}"><bdi lang="he">מעשר</bdi> (maaser) ${maaser.left < 0 ? `covered - you've given ${money(Math.abs(maaser.left))} extra` : `left to give: <strong style="color:${C.ink}">${money(maaser.left)}</strong>`}</div>` : ''}
  </div>`;
}

export function buildEmail({ name, month, sections }) {
  const label = monthLabel(month);
  const body = sections.map((x) => sectionHtml(x.summary, x.maaser)).join(`<hr style="border:none;border-top:1px solid ${C.line};margin:24px 0 0">`);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink}">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:16px;padding:28px 24px;border-top:6px solid ${C.accent}">
      <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">Budget Up</div>
      <h1 style="font-size:22px;margin:8px 0 6px">Hi ${esc(name)},</h1>
      <p style="margin:0;font-size:15px;line-height:1.5">here is your budget summary from <strong>${esc(label)}</strong>:</p>
      ${body}
      <p style="margin:28px 0 0;font-size:16px;font-weight:600">Budget well! 🦆</p>
    </div>
    <p style="text-align:center;font-size:12px;color:${C.muted};margin:14px 0 0">You can turn this email off in Budget Up → Settings → Account.</p>
  </div></body></html>`;

  const text = [`Hi ${name},`, `here is your budget summary from ${label}:`, ''];
  for (const { summary: s, maaser } of sections) {
    text.push(s.ledger.name, `  Income:   ₪${fmtAmount(s.incomeTotal)}`, `  Expenses: ₪${fmtAmount(s.expenseTotal)}`,
      `  Balance:  ₪${fmtAmount(s.balance)}`, '  Expenses by category:');
    for (const c of s.tree.filter((c) => c.total > 0)) {
      text.push(`    ${c.name}: ₪${fmtAmount(c.total)}`);
      for (const k of c.children.filter((k) => k.total > 0)) text.push(`        ${k.name}: ₪${fmtAmount(k.total)}`);
    }
    if (maaser) text.push(maaser.left < 0 ? `  Maaser: covered (₪${fmtAmount(-maaser.left)} extra given)` : `  Maaser left to give: ₪${fmtAmount(maaser.left)}`);
    text.push('');
  }
  text.push('Budget well!');
  return { subject: `Your Budget Up summary for ${label}`, html, text: text.join('\n') };
}

/** Sends via Gmail SMTP (app password) if configured, else Resend, else skips. */
export async function sendMail(env, { to, subject, html, text }) {
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    try {
      await WorkerMailer.send(
        { host: 'smtp.gmail.com', port: 465, secure: true, authType: 'plain',
          credentials: { username: env.GMAIL_USER, password: env.GMAIL_APP_PASSWORD } },
        { from: { name: 'Budget Up', email: env.GMAIL_USER }, to, subject, text, html });
      return { ok: true };
    } catch (e) {
      console.log('Gmail SMTP failed', e && e.message || e);
      return { ok: false };
    }
  }
  if (!env.RESEND_API_KEY) {
    console.log('No email provider configured - skipping email to', to);
    return { ok: false, skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) console.log('Email failed', res.status, await res.text());
  return { ok: res.ok };
}

/** Build + send one user's summary for `month` covering every ledger they belong to. */
export async function sendUserSummary(env, user, month, today, { force = false } = {}) {
  if (!user.email) return { ok: false, reason: 'no-email' };
  if (!force) {
    const claimed = await env.DB.prepare('INSERT OR IGNORE INTO summary_log (user_id,month,sent_at) VALUES (?,?,?)')
      .bind(user.id, month, nowIso()).run();
    if (!claimed.meta.changes) return { ok: false, reason: 'already-sent' };
  }
  const ledgers = (await env.DB.prepare(
    'SELECT l.id,l.name,l.created_at FROM ledgers l JOIN members m ON m.ledger_id=l.id WHERE m.user_id=? ORDER BY l.created_at')
    .bind(user.id).all()).results;
  const sections = [];
  for (const l of ledgers) {
    const summary = await ledgerSummary(env, l, month);
    if (summary.empty && !force) continue;
    sections.push({ summary, maaser: await maaserFor(env, l.id, l.created_at, today) });
  }
  if (!sections.length) return { ok: false, reason: 'nothing-to-report' };
  const mail = buildEmail({ name: user.display_name, month, sections });
  const r = await sendMail(env, { to: user.email, ...mail });
  if (!r.ok && !force) await env.DB.prepare('DELETE FROM summary_log WHERE user_id=? AND month=?').bind(user.id, month).run();
  return { ok: r.ok, reason: r.skipped ? 'email-not-configured' : r.ok ? 'sent' : 'send-failed' };
}
