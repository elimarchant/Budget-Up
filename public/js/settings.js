// Settings: categories, default (recurring) items, sharing & budgets, account. Also the budget switcher.
import { S, ledger, setLedger, clearCache } from './state.js';
import { get, post, patch, del } from './api.js';
import { html, render, ut, money, openSheet, confirmSheet, toast, withBusy } from './ui.js';
import { loadCategories, categoryPicker, catLabel } from './views.js';

const rerender = () => S.rerender && S.rerender();
const L = () => `/api/ledgers/${S.ledgerId}`;
const back = (to = '#/settings') => html`<a href="${to}" class="muted small" style="text-decoration:none;display:inline-block;margin-bottom:6px">‹ Back</a>`;

/** A one-field sheet. Resolves with the text, or null if cancelled. */
function promptSheet({ title, label, value = '', cta = 'Save', max = 40 }) {
  return new Promise((resolve) => {
    let done = false;
    openSheet({
      title,
      body: html`<form novalidate><div class="form-error hidden"></div>
        <label class="field"><span>${label}</span><input type="text" name="v" dir="auto" maxlength="${max}" value="${value}" autocomplete="off"></label>
        <button class="btn primary block" type="submit">${cta}</button></form>`,
      mount(el, close) {
        const f = el.querySelector('form');
        setTimeout(() => { f.v.focus(); f.v.select(); }, 60);
        f.onsubmit = (e) => {
          e.preventDefault();
          if (!f.v.value.trim()) { const er = el.querySelector('.form-error'); er.textContent = 'Please type a name'; er.classList.remove('hidden'); return; }
          done = true; resolve(f.v.value.trim()); close();
        };
      },
      onClose() { if (!done) resolve(null); },
    });
  });
}

// ---------------------------------------------------------------- budget switcher (top-right)
export function openLedgerSwitcher() {
  openSheet({
    title: 'Switch budget',
    body: html`<div>${S.ledgers.map((l) => html`<button class="list-btn ${l.id === S.ledgerId ? 'on' : ''}" data-id="${l.id}" type="button">
        <span>${ut(l.name)} ${l.member_count > 1 ? html`<span class="muted small">· ${l.member_count} people</span>` : ''}</span><span>${l.id === S.ledgerId ? '✓' : ''}</span></button>`)}</div>
      <button class="btn block" data-new type="button" style="margin-top:12px">+ New budget</button>
      <p class="muted small">Each budget is completely separate — for example “Family” and “Parents”.</p>`,
    mount(el, close) {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-id]');
        if (b) { close(); if (b.dataset.id !== S.ledgerId) { setLedger(b.dataset.id); location.hash = '#/'; rerender(); } return; }
        if (e.target.closest('[data-new]')) {
          close();
          const name = await promptSheet({ title: 'New budget', label: 'Name (e.g. Parents)', cta: 'Create', max: 60 });
          if (!name) return;
          try {
            const r = await post('/api/ledgers', { name });
            S.ledgers = r.ledgers; setLedger(r.id); location.hash = '#/'; toast('Budget created'); rerender();
          } catch (err) { toast(err.message, true); }
        }
      });
    },
  });
}

// ---------------------------------------------------------------- settings menu
export async function viewSettings(el, sub) {
  if (sub === 'categories') return viewCategories(el);
  if (sub === 'defaults') return viewDefaults(el);
  if (sub === 'sharing') return viewSharing(el);
  if (sub === 'account') return viewAccount(el);
  const row = (href, ico, title, desc) => html`<a class="row-link" href="${href}" style="text-decoration:none;color:inherit">
    <span><span style="font-size:1.3rem;margin-right:10px">${ico}</span><b>${title}</b><br><span class="muted small" style="margin-left:34px">${desc}</span></span><span class="chev">›</span></a>`;
  render(el, html`<div class="page-head"><h1>Settings</h1></div>
    <div class="card" style="overflow:hidden">
      ${row('#/settings/categories', '🏷️', 'Categories', 'Add, rename, remove or regroup categories')}
      ${row('#/settings/defaults', '🔁', 'Make default expenses', 'Rent, bills, salary… added automatically each month')}
      ${row('#/settings/sharing', '👥', 'Sharing & budgets', 'Invite people, switch or rename budgets')}
      ${row('#/settings/account', '👤', 'Account', 'Your name, email, monthly summary, password')}
    </div>`);
  el.onclick = null;
}

// ---------------------------------------------------------------- categories
async function viewCategories(el) {
  render(el, html`${back()}<div class="page-head"><h1>Categories</h1></div><div class="spinner"></div>`);
  await loadCategories(true);
  const draw = () => {
    const tops = S.categories.filter((c) => !c.parent_id && !c.archived);
    render(el, html`${back()}<div class="page-head"><h1>Categories</h1></div>
      <p class="muted small" style="margin-top:-6px">Main categories can hold subcategories (like Food → Shopping). When adding an expense you pick the most specific one.</p>
      <div class="card" style="overflow:hidden">
        ${tops.map((t) => html`<div class="set-main"><span class="nm">${ut(t.name)}</span><button class="dots" data-act="menu" data-id="${t.id}" aria-label="Options for ${t.name}">⋯</button></div>
          ${S.categories.filter((c) => c.parent_id === t.id && !c.archived).map((k) =>
            html`<div class="set-sub"><span class="nm">${ut(k.name)}</span><button class="dots" data-act="menu" data-id="${k.id}" aria-label="Options for ${k.name}">⋯</button></div>`)}`)}
      </div>
      <button class="btn primary block" data-act="add-main" style="margin-top:14px">+ Add main category</button>`);
  };
  const apply = (r) => { S.categories = r.categories; clearCache(); draw(); };
  draw();

  async function addCategory(parentId) {
    const parent = parentId && S.categories.find((c) => c.id === parentId);
    const name = await promptSheet({ title: parent ? `New subcategory in ${parent.name}` : 'New main category', label: 'Name', cta: 'Add' });
    if (!name) return;
    try { apply(await post(`${L()}/categories`, { name, parent_id: parentId || null })); toast('Added'); } catch (e) { toast(e.message, true); }
  }

  function menu(id) {
    const c = S.categories.find((x) => x.id === id);
    const isSub = !!c.parent_id;
    const hasKids = S.categories.some((x) => x.parent_id === id && !x.archived);
    openSheet({
      title: c.name,
      body: html`<div>
        <button class="list-btn" data-do="rename" type="button">✏️ Rename</button>
        ${isSub ? '' : html`<button class="list-btn" data-do="addsub" type="button">➕ Add a subcategory</button>`}
        <button class="list-btn" data-do="move" type="button">↔️ ${isSub ? 'Move or make main' : 'Turn into a subcategory'}</button>
        <button class="list-btn" data-do="delete" type="button" style="color:var(--expense)">🗑 Remove${hasKids ? ' (and its subcategories)' : ''}</button></div>`,
      mount(sheetEl, close) {
        sheetEl.addEventListener('click', async (e) => {
          const act = (e.target.closest('[data-do]') || {}).dataset;
          if (!act) return;
          close();
          if (act.do === 'rename') {
            const name = await promptSheet({ title: 'Rename', label: 'Name', value: c.name });
            if (name && name !== c.name) try { apply(await patch(`/api/categories/${id}`, { name })); toast('Renamed'); } catch (er) { toast(er.message, true); }
          } else if (act.do === 'addsub') addCategory(id);
          else if (act.do === 'move') moveSheet(c, hasKids);
          else if (act.do === 'delete') {
            if (await confirmSheet({ title: `Remove “${c.name}”?`, message: 'Past entries keep their category in your history, but you will no longer be able to pick it. Any default items using it are removed too.', confirmLabel: 'Remove' })) {
              try { apply(await del(`/api/categories/${id}`)); toast('Removed'); } catch (er) { toast(er.message, true); }
            }
          }
        });
      },
    });
  }

  function moveSheet(c, hasKids) {
    if (hasKids) {
      openSheet({ title: 'Can’t move yet', body: html`<p style="margin-top:0">“${ut(c.name)}” has subcategories of its own. A category can only be one level deep, so move or remove its subcategories first.</p><button class="btn block" data-close type="button">OK</button>` });
      return;
    }
    const targets = S.categories.filter((x) => !x.parent_id && !x.archived && x.id !== c.id);
    openSheet({
      title: `Move “${c.name}”`,
      body: html`<div>${c.parent_id ? html`<button class="list-btn" data-to="" type="button">⬆️ Make it a main category</button>` : ''}
        ${targets.filter((t) => t.id !== c.parent_id).map((t) => html`<button class="list-btn" data-to="${t.id}" type="button">Put under <b>${ut(t.name)}</b></button>`)}</div>`,
      mount(sheetEl, close) {
        sheetEl.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-to]');
          if (!b) return;
          close();
          try { apply(await patch(`/api/categories/${c.id}`, { parent_id: b.dataset.to || null })); toast('Moved'); } catch (er) { toast(er.message, true); }
        });
      },
    });
  }

  el.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'menu') menu(a.dataset.id);
    if (a.dataset.act === 'add-main') addCategory(null);
  };
}

// ---------------------------------------------------------------- default (recurring) items
async function viewDefaults(el) {
  render(el, html`${back()}<div class="page-head"><h1>Default expenses</h1></div><div class="spinner"></div>`);
  await loadCategories();
  let defs = (await get(`${L()}/defaults`)).defaults;
  const draw = () => {
    const row = (d) => html`<button class="row-link" data-act="edit" data-id="${d.id}"><span>
        <b>${d.type === 'expense' ? ut(catLabel(d.category_id)) : 'Income'}</b>${d.comment ? html`<br><span class="muted small">${ut(d.comment)}</span>` : ''}</span>
        <span>${money(d.amount, d.type)} <span class="chev">›</span></span></button>`;
    const ex = defs.filter((d) => d.type === 'expense'), inc = defs.filter((d) => d.type === 'income');
    render(el, html`${back()}<div class="page-head"><h1>Default expenses</h1></div>
      <p class="muted small" style="margin-top:-6px">Things that are the same every month — rent, electricity, your salary. They’re added automatically on the 1st of each month and counted in your totals.</p>
      <div class="section-title">Default expenses</div>
      <div class="card" style="overflow:hidden">${ex.length ? ex.map(row) : html`<div class="empty">No default expenses yet.</div>`}</div>
      <button class="btn expense block" data-act="add" data-type="expense" style="margin-top:10px">+ Add default expense</button>
      <div class="section-title">Default income</div>
      <div class="card" style="overflow:hidden">${inc.length ? inc.map(row) : html`<div class="empty">No default income yet.</div>`}</div>
      <button class="btn income block" data-act="add" data-type="income" style="margin-top:10px">+ Add default income</button>`);
  };
  draw();

  function sheet(type, d) {
    const isExp = type === 'expense';
    openSheet({
      title: `${d ? 'Edit' : 'New'} default ${isExp ? 'expense' : 'income'}`,
      body: html`<form novalidate><div class="form-error hidden"></div>
        <label class="field"><span>Amount every month (₪)</span><div class="amount-field"><span class="cur">₪</span>
          <input type="text" name="amount" inputmode="decimal" autocomplete="off" value="${d ? d.amount / 100 : ''}" placeholder="0"></div></label>
        ${isExp ? html`<div style="margin-bottom:14px">${categoryPicker(d && d.category_id)}</div>` : ''}
        <label class="field"><span>Comment (optional)</span><input type="text" name="comment" dir="auto" maxlength="100" value="${d ? d.comment : ''}" placeholder="${isExp ? 'e.g. monthly rent' : 'e.g. salary'}"></label>
        <div class="actions">${d ? html`<button class="btn danger" type="button" data-del>Delete</button>` : ''}<button class="btn ${isExp ? 'expense' : 'income'}" type="submit">Save</button></div>
        ${d ? '' : html`<p class="muted small">It will be added for this month right away, then every 1st.</p>`}</form>`,
      mount(sheetEl, close) {
        const f = sheetEl.querySelector('form'); const err = sheetEl.querySelector('.form-error');
        f.onsubmit = (e) => {
          e.preventDefault();
          const body = { amount: f.amount.value, comment: f.comment.value };
          if (isExp) {
            body.category_id = (f.querySelector('input[name=category]:checked') || {}).value;
            if (!body.category_id) { err.textContent = 'Pick a category'; err.classList.remove('hidden'); return; }
          }
          withBusy(f.querySelector('[type=submit]'), async () => {
            const r = d ? await patch(`/api/defaults/${d.id}`, body) : await post(`${L()}/defaults`, { ...body, type });
            defs = r.defaults; clearCache(); close(); draw(); toast('Saved');
          }, err);
        };
        const delBtn = sheetEl.querySelector('[data-del]');
        if (delBtn) delBtn.onclick = async () => {
          if (!(await confirmSheet({ title: 'Delete this default?', message: 'Entries already added to past months stay as they are.' }))) return;
          try { defs = (await del(`/api/defaults/${d.id}`)).defaults; close(); draw(); toast('Deleted'); } catch (er) { toast(er.message, true); }
        };
      },
    });
  }
  el.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'add') sheet(a.dataset.type, null);
    if (a.dataset.act === 'edit') { const d = defs.find((x) => x.id === a.dataset.id); sheet(d.type, d); }
  };
}

// ---------------------------------------------------------------- sharing & budgets
async function viewSharing(el) {
  render(el, html`${back()}<div class="page-head"><h1>Sharing & budgets</h1></div><div class="spinner"></div>`);
  const draw = async () => {
    const info = await get(`${L()}/members`);
    const cur = ledger();
    const owner = info.role === 'owner';
    render(el, html`${back()}<div class="page-head"><h1>Sharing & budgets</h1></div>
      <div class="card pad"><div class="muted small" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">Current budget</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px"><b style="font-size:1.15rem">${ut(cur.name)}</b>
          ${owner ? html`<button class="btn small" data-act="rename">Rename</button>` : ''}</div></div>
      <div class="section-title">People in this budget</div>
      <div class="card" style="overflow:hidden">${info.members.map((m) => html`<div class="set-main"><span class="nm">${ut(m.display_name)} <span class="muted small">@${m.username}</span></span>
        <span class="pill ${m.role}">${m.role === 'owner' ? 'Owner' : 'Member'}</span>
        ${owner && m.role !== 'owner' ? html`<button class="dots" data-act="remove" data-id="${m.id}" data-name="${m.display_name}" aria-label="Remove ${m.display_name}">✕</button>` : ''}</div>`)}</div>
      <button class="btn primary block" data-act="invite" style="margin-top:12px">🔗 Invite someone</button>
      <p class="muted small">They’ll get a link. If they don’t have an account they create one; if they do, they get access straight away. Everyone can add, edit and see everything in this budget.</p>
      ${info.invites.length ? html`<div class="section-title">Active invite links</div><div class="card" style="overflow:hidden">${info.invites.map((i) => html`
        <div class="set-main"><span class="nm muted small">…/join/${i.token.slice(0, 8)}… · expires ${new Date(i.expires_at).toLocaleDateString('en-GB')}</span>
        <button class="btn small" data-act="copy" data-token="${i.token}">Copy</button>
        <button class="dots" data-act="revoke" data-token="${i.token}" aria-label="Revoke link">✕</button></div>`)}</div>` : ''}
      <div class="section-title">Your budgets</div>
      <div class="card" style="overflow:hidden">${S.ledgers.map((l) => html`<button class="row-link" data-act="switch" data-id="${l.id}"><span>${ut(l.name)}</span><span class="muted small">${l.id === S.ledgerId ? 'current ✓' : l.role === 'owner' ? 'owner' : 'member'}</span></button>`)}</div>
      <button class="btn block" data-act="new" style="margin-top:10px">+ New budget</button>
      <div class="section-title">Danger zone</div>
      ${owner ? html`<button class="btn danger block" data-act="delete-ledger">Delete this budget</button>`
        : html`<button class="btn danger block" data-act="leave">Leave this budget</button>`}
      `);
    el._info = info;
  };
  await draw();

  const linkFor = (t) => `${location.origin}/join/${t}`;
  function inviteSheet(token) {
    const url = linkFor(token);
    openSheet({
      title: 'Invite link',
      body: html`<p style="margin-top:0">Send this link to the person you want to share <b>${ut(ledger().name)}</b> with. It works for 14 days.</p>
        <div class="linkbox"><input type="text" readonly value="${url}" aria-label="Invite link"><button class="btn primary" data-copy type="button">Copy</button></div>
        ${navigator.share ? html`<button class="btn block" data-share type="button" style="margin-top:10px">Share…</button>` : ''}`,
      mount(sheetEl) {
        const input = sheetEl.querySelector('input');
        input.onfocus = () => input.select();
        sheetEl.querySelector('[data-copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { input.select(); toast('Press and hold to copy'); }
        };
        const s = sheetEl.querySelector('[data-share]');
        if (s) s.onclick = () => navigator.share({ title: 'Join my budget on Budget Up', text: `Join “${ledger().name}” on Budget Up`, url }).catch(() => {});
      },
    });
  }

  el.onclick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    try {
      if (act === 'invite') { const r = await post(`${L()}/invites`); inviteSheet(r.token); draw(); }
      else if (act === 'copy') { await navigator.clipboard.writeText(linkFor(a.dataset.token)); toast('Link copied'); }
      else if (act === 'revoke') { await del(`${L()}/invites/${a.dataset.token}`); toast('Link disabled'); draw(); }
      else if (act === 'rename') {
        const name = await promptSheet({ title: 'Rename budget', label: 'Name', value: ledger().name, max: 60 });
        if (name) { S.ledgers = (await patch(L(), { name })).ledgers; rerender(); }
      } else if (act === 'remove') {
        if (await confirmSheet({ title: `Remove ${a.dataset.name}?`, message: 'They will no longer see this budget. Their past entries stay.', confirmLabel: 'Remove' })) {
          await del(`${L()}/members/${a.dataset.id}`); toast('Removed'); draw();
        }
      } else if (act === 'switch') { setLedger(a.dataset.id); rerender(); }
      else if (act === 'new') {
        const name = await promptSheet({ title: 'New budget', label: 'Name (e.g. Parents)', cta: 'Create', max: 60 });
        if (name) { const r = await post('/api/ledgers', { name }); S.ledgers = r.ledgers; setLedger(r.id); toast('Budget created'); location.hash = '#/'; rerender(); }
      } else if (act === 'leave' || act === 'delete-ledger') {
        const leaving = act === 'leave';
        const ok = await confirmSheet({
          title: leaving ? 'Leave this budget?' : 'Delete this budget?',
          message: leaving ? 'You will lose access unless someone invites you again.' : 'This permanently deletes every entry for everyone in this budget. This cannot be undone.',
          confirmLabel: leaving ? 'Leave' : 'Delete forever',
        });
        if (!ok) return;
        const r = leaving ? await del(`${L()}/members/${el._info.me}`) : await del(L());
        S.ledgers = r.ledgers;
        if (!S.ledgers.length) { S.ledgers = (await post('/api/ledgers', { name: `${S.user.display_name}'s budget` })).ledgers; }
        setLedger(S.ledgers[0].id); location.hash = '#/'; rerender();
      }
    } catch (err) { toast(err.message, true); }
  };
}

// ---------------------------------------------------------------- account
async function viewAccount(el) {
  const u = S.user;
  render(el, html`${back()}<div class="page-head"><h1>Account</h1></div>
    <form class="card pad" id="profile" novalidate><div class="form-error hidden"></div>
      <div class="muted small" style="margin-bottom:12px">Signed in as <b>@${u.username}</b></div>
      <label class="field"><span>Your name</span><input type="text" name="display_name" dir="auto" maxlength="40" value="${u.display_name}"></label>
      <label class="field"><span>Email (for your monthly summary)</span><input type="email" name="email" autocomplete="email" value="${u.email}" placeholder="you@example.com"></label>
      <label class="toggle"><span>Email me a summary on the 1st of every month</span><input type="checkbox" name="email_summary" ${u.email_summary ? 'checked' : ''}></label>
      <button class="btn primary block" type="submit">Save</button></form>
    <button class="btn block" id="sample" style="margin-top:10px">Send me last month’s summary now</button>
    <div class="section-title">Change password</div>
    <form class="card pad" id="pw" novalidate><div class="form-error hidden"></div>
      <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password"></label>
      <label class="field"><span>New password (8+ characters)</span><input type="password" name="next" autocomplete="new-password"></label>
      <button class="btn block" type="submit">Change password</button></form>`);
  const f = el.querySelector('#profile');
  f.onsubmit = (e) => {
    e.preventDefault();
    withBusy(f.querySelector('[type=submit]'), async () => {
      S.user = (await patch('/api/me', { display_name: f.display_name.value, email: f.email.value, email_summary: f.email_summary.checked })).user;
      toast('Saved'); rerender();
    }, f.querySelector('.form-error'));
  };
  el.querySelector('#sample').onclick = (e) => withBusy(e.currentTarget, async () => {
    const r = await post('/api/me/test-summary'); toast(`Sent the ${r.month} summary to ${S.user.email}`);
  });
  const pw = el.querySelector('#pw');
  pw.onsubmit = (e) => {
    e.preventDefault();
    withBusy(pw.querySelector('[type=submit]'), async () => {
      await post('/api/me/password', { current: pw.current.value, next: pw.next.value });
      pw.reset(); toast('Password changed');
    }, pw.querySelector('.form-error'));
  };
  el.onclick = null;
}


