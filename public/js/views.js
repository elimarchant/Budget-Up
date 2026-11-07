// Main screens: Home, View, Edit entries (history), Maaser — plus the add/edit entry sheet.
import { S, clearCache } from './state.js';
import { get, post, patch, del } from './api.js';
import { buildTree, addMonths, monthLabel, MONTH_NAMES, sumBy, fmtAmount } from './aggregate.js';
import {
  html, render, ut, money, HE_MAASER, todayStr, monthRange, yearRange, dayParts, dayHeading,
  openSheet, confirmSheet, toast, withBusy,
} from './ui.js';

S.txById = new Map();
const rerender = () => S.rerender && S.rerender();

// ---------------------------------------------------------------- data
export async function loadCategories(force = false) {
  if (!force && S.categories.length) return S.categories;
  S.categories = (await get(`/api/ledgers/${S.ledgerId}/categories`)).categories;
  return S.categories;
}

export async function loadTx(from, to) {
  const key = `${S.ledgerId}|${from}|${to}`;
  if (!S.cache.has(key)) {
    const { transactions } = await get(`/api/ledgers/${S.ledgerId}/transactions?from=${from}&to=${to}`);
    S.cache.set(key, transactions);
  }
  const list = S.cache.get(key);
  list.forEach((t) => S.txById.set(t.id, t));
  return list;
}

const catById = (id) => S.categories.find((c) => c.id === id);
export function catLabel(id) {
  const c = catById(id);
  if (!c) return 'Uncategorised';
  const p = c.parent_id && catById(c.parent_id);
  return p ? `${p.name} › ${c.name}` : c.name;
}
const activeKids = (id) => S.categories.filter((c) => c.parent_id === id && !c.archived);
const topCats = () => S.categories.filter((c) => !c.parent_id && !c.archived);

// ---------------------------------------------------------------- shared pieces
/** Category chips: main categories on their own, subcategories grouped under their main category. */
export function categoryPicker(selectedId, name = 'category') {
  const standalone = topCats().filter((c) => !activeKids(c.id).length);
  const groups = topCats().filter((c) => activeKids(c.id).length);
  const sel = catById(selectedId);
  const chip = (c, cls = '') => html`<label class="chip ${cls}"><input type="radio" name="${name}" value="${c.id}" ${c.id === selectedId ? 'checked' : ''}><span>${ut(c.name)}</span></label>`;
  return html`
    <div class="chips-title">Categories</div>
    <div class="chips">${standalone.map((c) => chip(c))}${sel && sel.archived ? chip({ ...sel, name: `${sel.name} (removed)` }) : ''}</div>
    ${groups.map((g) => html`<div class="chip-group"><div class="chips-title">${ut(g.name)}</div>
      <div class="chips">${g.id === selectedId ? chip({ ...g, name: 'General' }, 'sub') : ''}${activeKids(g.id).map((k) => chip(k, 'sub'))}</div></div>`)}`;
}

export function txRow(t, { showCat = true } = {}) {
  const { day, mon } = dayParts(t.date);
  const title = t.type === 'income' ? (t.comment || 'Income') : (showCat ? catLabel(t.category_id) : (t.comment || catLabel(t.category_id)));
  const meta =(t.type === 'expense' && showCat ? [t.comment, t.created_by_name] : [t.created_by_name]).filter(Boolean);
  return html`<button type="button" class="tx ${t.type}" data-act="edit-tx" data-id="${t.id}">
    <div class="date"><b>${day}</b><span>${mon}</span></div>
    <div class="body"><div class="title">${ut(title)}${t.default_id ? html`<span class="auto">auto</span>` : ''}</div>
      <div class="meta">${meta.length ? ut(meta.join(' · ')) : ''}</div></div>
    ${money(t.amount, t.type)}</button>`;
}

const spinner = html`<div class="spinner"></div>`;
const monthNav = (value, id = 'mnav') => html`<div class="nav-row">
  <button class="arrow" data-act="${id}-prev" aria-label="Previous month">◀</button>
  <div class="mid"><span class="month-label">${monthLabel(value)} <small>▾</small></span>
    <input type="month" id="${id}-input" value="${value}" aria-label="Pick a month"></div>
  <button class="arrow" data-act="${id}-next" aria-label="Next month">▶</button></div>`;

// ---------------------------------------------------------------- add / edit entry
export async function openEntrySheet({ type, tx } = {}) {
  await loadCategories();
  const editing = !!tx;
  const kind = tx ? tx.type : type;
  const isExp = kind === 'expense';
  const amountVal = tx ? String(tx.amount / 100) : '';
  openSheet({
    title: editing ? (isExp ? 'Edit expense' : 'Edit income') : (isExp ? 'Add expense' : 'Add income'),
    body: html`<form novalidate>
      <div class="form-error hidden"></div>
      <label class="field"><span>Amount (₪)</span><div class="amount-field"><span class="cur">₪</span>
        <input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${amountVal}" required></div></label>
      ${isExp ? html`<div style="margin-bottom:14px">${categoryPicker(tx && tx.category_id)}</div>` : ''}
      <label class="field"><span>Comment (optional)</span><input type="text" name="comment" dir="auto" maxlength="200" autocomplete="off" value="${tx ? tx.comment : ''}"></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${tx ? tx.date : todayStr()}" required></label>
      <div class="actions">
        ${editing ? html`<button class="btn danger" type="button" data-del>Delete</button>` : ''}
        <button class="btn ${isExp ? 'expense' : 'income'}" type="submit">Save</button></div></form>`,
    mount(el, close) {
      const form = el.querySelector('form');
      const err = el.querySelector('.form-error');
      setTimeout(() => { if (!editing) form.amount.focus(); }, 60);
      form.onsubmit = (e) => {
        e.preventDefault();
        const body = { amount: form.amount.value, comment: form.comment.value, date: form.date.value };
        if (isExp) body.category_id = (form.querySelector('input[name=category]:checked') || {}).value;
        if (isExp && !body.category_id) { err.textContent = 'Pick a category'; err.classList.remove('hidden'); return; }
        withBusy(form.querySelector('[type=submit]'), async () => {
          if (editing) await patch(`/api/transactions/${tx.id}`, body);
          else await post(`/api/ledgers/${S.ledgerId}/transactions`, { ...body, type: kind });
          clearCache(); close(); toast(editing ? 'Saved' : isExp ? 'Expense added' : 'Income added'); rerender();
        }, err);
      };
      const delBtn = el.querySelector('[data-del]');
      if (delBtn) delBtn.onclick = async () => {
        if (!(await confirmSheet({ title: 'Delete this entry?', message: 'This cannot be undone.' }))) return;
        try { await del(`/api/transactions/${tx.id}`); clearCache(); close(); toast('Deleted'); rerender(); } catch (e2) { toast(e2.message, true); }
      };
    },
  });
}

function bindTxClicks(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="edit-tx"]');
    if (b) openEntrySheet({ tx: S.txById.get(b.dataset.id) });
  });
}

// ---------------------------------------------------------------- HOME
export async function viewHome(el) {
  render(el, spinner);
  const month = todayStr().slice(0, 7);
  const [tx] = await Promise.all([loadTx(...Object.values(monthRange(month))), loadCategories()]);
  const inc = sumBy(tx, 'income'), exp = sumBy(tx, 'expense');
  const recent = tx.slice(0, 8);
  render(el, html`
    <div class="card hero">
      <div class="month"><span>${monthLabel(month)}</span><span class="muted small">so far</span></div>
      <div class="tiles">
        <div class="tile"><div class="lbl">Income</div>${money(inc, 'income')}</div>
        <div class="tile"><div class="lbl">Spent</div>${money(exp, 'expense')}</div>
        <div class="tile"><div class="lbl">Balance</div>${money(inc - exp, 'balance')}</div>
      </div>
    </div>
    <div class="big-actions">
      <button class="big-action income" data-act="add-income"><span class="plus">+</span>Income</button>
      <button class="big-action expense" data-act="add-expense"><span class="plus">+</span>Expense</button>
    </div>
    <a class="card row-link" href="#/maaser" style="text-decoration:none;color:inherit" id="maaser-link">
      <span>${HE_MAASER} <span class="muted small">left to give</span></span><span id="maaser-amt" class="muted">…</span></a>
    <div class="section-title">Latest this month</div>
    ${recent.length ? html`<div>${recent.map((t) => txRow(t))}</div>`
      : html`<div class="card empty"><span class="em">🦆</span>Nothing yet this month.<br>Tap Income or Expense to add your first entry.</div>`}
  `);
  el.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'add-income') openEntrySheet({ type: 'income' });
    if (a.dataset.act === 'add-expense') openEntrySheet({ type: 'expense' });
  };
  bindTxClicks(el);
  get(`/api/ledgers/${S.ledgerId}/maaser`).then((m) => {
    const t = el.querySelector('#maaser-amt');
    if (t) render(t, money(m.maaser.left, 'maaser'));
  }).catch(() => {});
}

// ---------------------------------------------------------------- VIEW
function viewState() {
  if (!S.view) {
    const t = todayStr();
    S.view = { period: 'month', month: t.slice(0, 7), year: t.slice(0, 4), show: 'all', picked: new Set(), open: new Set(), tx: [] };
  }
  return S.view;
}

export async function viewView(el) {
  const v = viewState();
  render(el, html`<div class="page-head"><h1>View</h1></div><div id="view-body">${spinner}</div>`);
  await loadCategories();
  const body = () => el.querySelector('#view-body');

  async function load() {
    const r = v.period === 'month' ? monthRange(v.month) : yearRange(v.year);
    try { v.tx = await loadTx(r.from, r.to); } catch (e) { toast(e.message, true); v.tx = []; }
    draw();
  }

  function draw() {
    const exp = v.tx.filter((t) => t.type === 'expense');
    const inc = v.tx.filter((t) => t.type === 'income');
    let expShown = exp;
    if (v.show === 'income') expShown = [];
    if (v.show === 'pick') expShown = exp.filter((t) => v.picked.has(t.category_id));
    const showIncome = v.show === 'all' || v.show === 'income';
    const tree = buildTree(S.categories, expShown).filter((c) => v.show !== 'pick' || c.count > 0)
      .map((c) => (v.show === 'pick' ? { ...c, children: c.children.filter((k) => k.count > 0) } : c));
    const expTotal = sumBy(expShown, 'expense');
    const incTotal = sumBy(inc, 'income');
    const tiles = v.show === 'all'
      ? [['Income', money(incTotal, 'income')], ['Spent', money(expTotal, 'expense')], ['Balance', money(incTotal - expTotal, 'balance')]]
      : v.show === 'income' ? [['Income', money(incTotal, 'income')]] : [['Spent', money(expTotal, 'expense')]];

    const catRow = (c) => {
      const pct = expTotal ? Math.max(2, Math.round((c.total / expTotal) * 100)) : 0;
      const zero = !c.count;
      if (!c.children.length) {
        return html`<button class="cat-main" data-act="entries" data-cat="${c.id}" style="${zero ? 'opacity:.55' : ''}">
          <span class="name">${ut(c.name)}</span>${money(c.total, 'expense')}<span class="chev">›</span>${c.total ? html`<i class="bar" style="width:${pct}%"></i>` : ''}</button>`;
      }
      const open = v.open.has(c.id);
      return html`<button class="cat-main ${open ? 'open' : ''}" data-act="toggle" data-cat="${c.id}" aria-expanded="${open}" style="${zero ? 'opacity:.55' : ''}">
          <span class="name">${ut(c.name)}</span>${money(c.total, 'expense')}<span class="chev">›</span>${c.total ? html`<i class="bar" style="width:${pct}%"></i>` : ''}</button>
        ${open ? html`<div class="cat-subs">
          ${c.children.map((k) => html`<button class="cat-sub ${k.general ? 'general' : ''}" data-act="entries" data-cat="${k.id}" data-general="${k.general ? 1 : ''}" style="${k.count ? '' : 'opacity:.6'}">
            <span class="name">${ut(k.name)}</span>${money(k.total, 'expense')}</button>`)}
          ${c.count ? html`<button class="all-link" data-act="entries-group" data-cat="${c.id}">See all ${ut(c.name)} entries →</button>` : ''}</div>` : ''}`;
    };

    render(body(), html`
      <div class="seg" role="tablist" style="margin-bottom:2px">
        <button class="${v.period === 'month' ? 'on' : ''}" data-act="period" data-v="month">Month</button>
        <button class="${v.period === 'year' ? 'on' : ''}" data-act="period" data-v="year">Year</button></div>
      ${v.period === 'month' ? monthNav(v.month, 'v') : html`<div class="nav-row">
        <button class="arrow" data-act="v-prev" aria-label="Previous year">◀</button><div class="mid"><div class="yr">${v.year}</div></div>
        <button class="arrow" data-act="v-next" aria-label="Next year">▶</button></div>`}
      <div class="seg" style="margin-bottom:12px">
        ${[['all', 'Everything'], ['expenses', 'Expenses'], ['income', 'Income']].map(([k, l]) =>
          html`<button class="${v.show === k ? 'on' : ''}" data-act="show" data-v="${k}">${l}</button>`)}
        <button class="${v.show === 'pick' ? 'on' : ''}" data-act="pick">Choose${v.show === 'pick' ? ` (${[...v.picked].filter((id) => !activeKids(id).length).length})` : '…'}</button></div>
      <div class="card pad"><div class="tiles" style="grid-template-columns:repeat(${tiles.length},1fr)">
        ${tiles.map(([l, m]) => html`<div class="tile"><div class="lbl">${l}</div>${m}</div>`)}</div></div>
      ${v.period === 'year' && v.show !== 'income' && v.show !== 'pick' ? yearTable(v) : ''}
      ${v.show !== 'income' ? html`<div class="section-title">Expenses by category</div>
        <div class="card" style="overflow:hidden">${tree.length ? tree.map(catRow) : html`<div class="empty"><span class="em">🧾</span>No expenses to show for this period.</div>`}
          ${tree.length ? html`<div class="total-row"><span>Total spent</span>${money(expTotal, 'expense')}</div>` : ''}</div>` : ''}
      ${showIncome ? html`<div class="section-title">Income</div>
        <div class="card" style="overflow:hidden"><button class="row-link" data-act="income-list" ${inc.length ? '' : 'disabled'}>
          <span>All income</span><span>${money(incTotal, 'income')} <span class="chev">›</span></span></button></div>` : ''}
    `);
  }

  function yearTable(v) {
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${v.year}-${String(m).padStart(2, '0')}`;
      const list = v.tx.filter((t) => t.date.startsWith(key));
      if (!list.length) continue;
      const i = sumBy(list, 'income'), x = sumBy(list, 'expense');
      rows.push(html`<tr class="link" data-act="goto-month" data-v="${key}"><td>${MONTH_NAMES[m - 1]}</td><td>${money(i, 'income')}</td><td>${money(x, 'expense')}</td><td>${money(i - x, 'balance')}</td></tr>`);
    }
    return html`<div class="section-title">Month by month</div><div class="card" style="overflow:auto"><table class="table">
      <thead><tr><th>Month</th><th>Income</th><th>Spent</th><th>Balance</th></tr></thead><tbody>${rows.length ? rows : html`<tr><td colspan="4" class="muted">No entries this year yet.</td></tr>`}</tbody></table></div>`;
  }

  function entriesSheet(title, list, showCat) {
    const total = list.reduce((s, t) => s + t.amount, 0);
    const type = list[0] ? list[0].type : 'expense';
    openSheet({
      title,
      body: html`<div class="card-head" style="padding:0 0 12px"><span class="muted">${list.length} ${list.length === 1 ? 'entry' : 'entries'} · ${v.period === 'month' ? monthLabel(v.month) : v.year}</span>${money(total, type)}</div>
        <div id="entries">${list.map((t) => txRow(t, { showCat }))}</div>`,
      mount(sheetEl, close) {
        sheetEl.addEventListener('click', (e) => {
          const b = e.target.closest('[data-act="edit-tx"]');
          if (b) { close(); openEntrySheet({ tx: S.txById.get(b.dataset.id) }); }
        });
      },
    });
  }

  function pickSheet() {
    const standalone = topCats().filter((c) => !activeKids(c.id).length);
    const groups = topCats().filter((c) => activeKids(c.id).length);
    const chk = (id, label, cls = '', extra = '') => html`<label class="list-btn ${cls}" style="cursor:pointer"><span>${ut(label)}</span>
      <input type="checkbox" data-id="${id}" ${extra} ${v.picked.has(id) ? 'checked' : ''} style="width:22px;height:22px;min-height:0"></label>`;
    openSheet({
      title: 'Choose what to see',
      body: html`<div>${standalone.map((c) => chk(c.id, c.name))}
        ${groups.map((g) => html`<div class="chip-group" style="margin:6px 0">${chk(g.id, g.name, '', 'data-group="1"')}
          ${activeKids(g.id).map((k) => html`<div style="padding-left:14px;font-size:.92rem">${chk(k.id, k.name, '', `data-parent="${g.id}"`)}</div>`)}</div>`)}</div>
        <div class="actions" style="margin-top:14px"><button class="btn" data-clear type="button">Clear</button><button class="btn primary" data-apply type="button">Show</button></div>`,
      mount(sheetEl, close) {
        const boxes = [...sheetEl.querySelectorAll('input[type=checkbox]')];
        sheetEl.addEventListener('change', (e) => {
          const b = e.target;
          if (b.dataset.group) boxes.filter((x) => x.dataset.parent === b.dataset.id).forEach((x) => { x.checked = b.checked; });
          if (b.dataset.parent) {
            const g = boxes.find((x) => x.dataset.id === b.dataset.parent);
            g.checked = boxes.filter((x) => x.dataset.parent === g.dataset.id).every((x) => x.checked);
          }
        });
        sheetEl.querySelector('[data-clear]').onclick = () => boxes.forEach((x) => { x.checked = false; });
        sheetEl.querySelector('[data-apply]').onclick = () => {
          const picked = new Set(boxes.filter((x) => x.checked).map((x) => x.dataset.id));
          if (!picked.size) { toast('Tick at least one category', true); return; }
          v.picked = picked; v.show = 'pick'; close(); draw();
        };
      },
    });
  }

  el.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'period') { v.period = a.dataset.v; load(); }
    else if (act === 'show') { v.show = a.dataset.v; draw(); }
    else if (act === 'pick') pickSheet();
    else if (act === 'v-prev') { if (v.period === 'month') v.month = addMonths(v.month, -1); else v.year = String(+v.year - 1); load(); }
    else if (act === 'v-next') { if (v.period === 'month') v.month = addMonths(v.month, 1); else v.year = String(+v.year + 1); load(); }
    else if (act === 'goto-month') { v.period = 'month'; v.month = a.dataset.v; load(); }
    else if (act === 'toggle') { const id = a.dataset.cat; v.open.has(id) ? v.open.delete(id) : v.open.add(id); draw(); }
    else if (act === 'entries') {
      const id = a.dataset.cat;
      const list = v.tx.filter((t) => t.type === 'expense' && t.category_id === id);
      entriesSheet(catLabel(id) + (a.dataset.general ? ' (general)' : ''), list, false);
    } else if (act === 'entries-group') {
      const id = a.dataset.cat;
      const ids = new Set([id, ...activeKids(id).map((k) => k.id), ...S.categories.filter((c) => c.parent_id === id).map((k) => k.id)]);
      entriesSheet(catById(id).name, v.tx.filter((t) => t.type === 'expense' && ids.has(t.category_id)), true);
    } else if (act === 'income-list') entriesSheet('Income', v.tx.filter((t) => t.type === 'income'), true);
  };
  el.onchange = (e) => {
    if (e.target.id === 'v-input' && e.target.value) { v.month = e.target.value; load(); }
  };
  await load();
}

// ---------------------------------------------------------------- EDIT ENTRIES (history)
export async function viewHistory(el) {
  const h = S.hist || (S.hist = { month: todayStr().slice(0, 7), q: '', type: 'all' });
  render(el, html`<div class="page-head"><h1>Edit entries</h1></div>
    <p class="muted small" style="margin-top:-6px">Pick a month, find the entry, and tap it to fix or delete it.</p>
    ${monthNav(h.month, 'h')}
    <input type="search" id="h-q" placeholder="Search comment, category or amount…" value="${h.q}" dir="auto" style="margin-bottom:10px">
    <div class="seg" style="margin-bottom:6px">${[['all', 'All'], ['expense', 'Expenses'], ['income', 'Income']].map(([k, l]) =>
      html`<button class="${h.type === k ? 'on' : ''}" data-act="htype" data-v="${k}">${l}</button>`)}</div>
    <div id="h-list">${spinner}</div>`);
  await loadCategories();
  let list = [];

  function draw() {
    const q = h.q.trim().toLowerCase();
    const shown = list.filter((t) => (h.type === 'all' || t.type === h.type) && (!q || [
      t.comment, catLabel(t.category_id), t.created_by_name, String(t.amount / 100), t.type,
    ].some((s) => String(s || '').toLowerCase().includes(q))));
    const box = el.querySelector('#h-list');
    if (!shown.length) { render(box, html`<div class="card empty"><span class="em">🔍</span>No entries found for ${monthLabel(h.month)}.</div>`); return; }
    const days = [];
    for (const t of shown) {
      const last = days[days.length - 1];
      if (last && last.date === t.date) last.items.push(t); else days.push({ date: t.date, items: [t] });
    }
    render(box, html`${days.map((d) => html`<div class="day-head">${dayHeading(d.date)}</div>${d.items.map((t) => txRow(t))}`)}`);
  }
  async function load() {
    el.querySelector('#h-input').value = h.month;
    el.querySelector('.month-label').firstChild.textContent = `${monthLabel(h.month)} `;
    render(el.querySelector('#h-list'), spinner);
    try { list = await loadTx(...Object.values(monthRange(h.month))); } catch (e) { toast(e.message, true); list = []; }
    draw();
  }
  el.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'h-prev') { h.month = addMonths(h.month, -1); load(); }
    if (a.dataset.act === 'h-next') { h.month = addMonths(h.month, 1); load(); }
    if (a.dataset.act === 'htype') {
      h.type = a.dataset.v;
      el.querySelectorAll('[data-act=htype]').forEach((b) => b.classList.toggle('on', b.dataset.v === h.type));
      draw();
    }
  };
  el.onchange = (e) => { if (e.target.id === 'h-input' && e.target.value) { h.month = e.target.value; load(); } };
  el.oninput = (e) => { if (e.target.id === 'h-q') { h.q = e.target.value; draw(); } };
  bindTxClicks(el);
  await load();
}

// ---------------------------------------------------------------- MAASER (charity)
export async function viewMaaser(el) {
  render(el, html`<div class="page-head"><h1>${HE_MAASER} <small>Maaser · charity</small></h1></div>${spinner}`);
  const draw = (data) => {
    const m = data.maaser;
    const extra = m.left < 0;
    const span = m.months === 1 ? 'the current month' : `the last ${m.months} months`;
    render(el, html`
      <div class="page-head"><h1>${HE_MAASER} <small>Maaser · charity</small></h1></div>
      <div class="maaser-card">
        <div class="lbl">${extra ? 'Extra given — already covered' : 'Left to give'}</div>
        <span class="big" dir="ltr">₪${fmtAmount(Math.abs(m.left))}</span>
        ${extra ? html`<div class="extra">You've given more than needed — this credit is remembered for future months.</div>`
          : html`<div class="extra">10% of your income over ${span}</div>`}
      </div>
      <button class="btn maaser block" data-act="give" style="margin-top:14px;min-height:54px;font-size:1.05rem">Give ${HE_MAASER}</button>
      <div class="section-title">How it adds up</div>
      <div class="card">
        <div class="kv"><span>Income (${monthLabel(m.start)}${m.months > 1 ? ` – ${monthLabel(m.end)}` : ''})</span>${money(m.windowIncome, 'income')}</div>
        <div class="kv"><span>${HE_MAASER} owed (10%)</span>${money(m.owed, 'maaser')}</div>
        <div class="kv"><span>Already given</span>${money(m.givenInWindow, 'income')}</div>
        ${m.credit ? html`<div class="kv"><span>Extra credit from earlier</span>${money(m.credit, 'income')}</div>` : ''}
        <div class="kv" style="font-weight:800"><span>${extra ? 'Extra given' : 'Left to give'}</span>${money(Math.abs(m.left), 'maaser')}</div>
      </div>
      ${m.months < 12 ? html`<p class="muted small" style="margin:10px 4px">Budget Up has been tracking this budget for ${m.months === 1 ? 'one month' : `${m.months} months`}, so only that time is counted. Once there's a full year it uses a rolling 12 months.</p>` : ''}
      <div class="section-title">Given so far</div>
      ${data.gives.length ? html`<div>${data.gives.map((g) => html`<div class="tx" style="border-left-color:var(--maaser)">
        <div class="date"><b>${dayParts(g.date).day}</b><span>${dayParts(g.date).mon}</span></div>
        <div class="body"><div class="title">${g.comment ? ut(g.comment) : html`Gave ${HE_MAASER}`}</div><div class="meta">${g.created_by_name ? ut(g.created_by_name) : ''}</div></div>
        ${money(g.amount, 'maaser')}
        <button class="dots" data-act="del-give" data-id="${g.id}" aria-label="Delete">🗑</button></div>`)}</div>`
        : html`<div class="card empty"><span class="em">🤲</span>Nothing recorded yet. Tap “Give” when you give.</div>`}
    `);
  };
  let data;
  try { data = await get(`/api/ledgers/${S.ledgerId}/maaser`); } catch (e) { toast(e.message, true); return; }
  draw(data);

  el.onclick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'give') {
      openSheet({
        title: html`Give ${HE_MAASER}`,
        body: html`<form novalidate><div class="form-error hidden"></div>
          <label class="field"><span>Amount given (₪)</span><div class="amount-field"><span class="cur">₪</span><input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" required></div></label>
          <label class="field"><span>Comment (optional)</span><input type="text" name="comment" dir="auto" maxlength="200" placeholder="Who / what for"></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}" required></label>
          <p class="muted small" style="margin-top:-4px">If you give more than you owe, the extra is remembered and reduces what you owe later.</p>
          <button class="btn maaser block" type="submit">Save</button></form>`,
        mount(sheetEl, close) {
          const form = sheetEl.querySelector('form'); const err = sheetEl.querySelector('.form-error');
          setTimeout(() => form.amount.focus(), 60);
          form.onsubmit = (ev) => {
            ev.preventDefault();
            withBusy(form.querySelector('[type=submit]'), async () => {
              data = await post(`/api/ledgers/${S.ledgerId}/maaser/gives`, { amount: form.amount.value, comment: form.comment.value, date: form.date.value });
              close(); draw(data); toast('Saved');
            }, err);
          };
        },
      });
    }
    if (a.dataset.act === 'del-give') {
      if (!(await confirmSheet({ title: 'Remove this?', message: 'It will be added back to what is left to give.' }))) return;
      try { data = await del(`/api/maaser/gives/${a.dataset.id}`); draw(data); toast('Removed'); } catch (e2) { toast(e2.message, true); }
    }
  };
}
