// Budget Up - app shell: boot, auth, routing, top bar and sidebar.
import { S, ledger, setLedger, pickInitialLedger, clearCache } from './state.js';
import { api, get, post, setUnauthorizedHandler } from './api.js';
import { html, render, ut, HE_MAASER, toast, withBusy, closeAllSheets } from './ui.js';
import { viewHome, viewView, viewHistory, viewMaaser } from './views.js';
import { viewSettings, openLedgerSwitcher } from './settings.js';

const app = document.getElementById('app');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------------------------------------------------------------- routing
const NAV = [
  { href: '#/', key: 'home', ico: '🏠', label: html`Home` },
  { href: '#/view', key: 'view', ico: '📊', label: html`View` },
  { href: '#/history', key: 'history', ico: '✏️', label: html`Edit entries` },
  { href: '#/maaser', key: 'maaser', ico: '🤲', label: html`<span class="he-label">${HE_MAASER} <small>Maaser</small></span>` },
  { href: '#/settings', key: 'settings', ico: '⚙️', label: html`Settings` },
];

function route() {
  const [, page = '', sub = ''] = (location.hash || '#/').split('/');
  return { page: page || 'home', sub };
}

let renderToken = 0;
async function renderPage() {
  if (!S.user) return;
  updateChrome();
  const main = document.getElementById('main');
  if (!main) return;
  closeAllSheets();
  const { page, sub } = route();
  const token = ++renderToken;
  main.onclick = main.onchange = main.oninput = null;
  try {
    if (page === 'view') await viewView(main);
    else if (page === 'history') await viewHistory(main);
    else if (page === 'maaser') await viewMaaser(main);
    else if (page === 'settings') await viewSettings(main, sub);
    else await viewHome(main);
  } catch (e) {
    if (token !== renderToken) return;
    render(main, html`<div class="card empty"><span class="em">😕</span>${e.message}<br><br><button class="btn primary" id="retry">Try again</button></div>`);
    main.querySelector('#retry').onclick = renderPage;
  }
  if (token === renderToken) window.scrollTo(0, 0);
}
S.rerender = renderPage;
window.addEventListener('hashchange', () => { closeDrawer(); renderPage(); });

// ---------------------------------------------------------------- shell
function openDrawer() { document.getElementById('drawer').classList.add('open'); document.getElementById('scrim').classList.add('open'); }
function closeDrawer() { const d = document.getElementById('drawer'); if (d) { d.classList.remove('open'); document.getElementById('scrim').classList.remove('open'); } }

function renderShell() {
  render(app, html`
    <header class="topbar">
      <button class="icon-btn" id="menu-btn" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      <a class="brand" href="#/"><img src="/icons/duck.svg" alt="" width="34" height="34"><span>Budget Up</span></a>
      <button class="who" id="who" aria-label="Switch budget"><span class="hey" id="hey"></span><span class="led" id="led"></span></button>
    </header>
    <div class="shell">
      <aside class="drawer" id="drawer" aria-label="Menu">
        <a class="brand" href="#/"><img src="/icons/duck.svg" alt="" width="34" height="34"><span>Budget Up</span></a>
        <nav class="nav" id="nav"></nav>
        <div class="drawer-foot"><div class="muted small" id="signed"></div><button class="btn small ghost" id="logout">Log out</button></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <main id="main"></main>
    </div>`);
  document.getElementById('menu-btn').onclick = openDrawer;
  document.getElementById('scrim').onclick = closeDrawer;
  document.getElementById('who').onclick = openLedgerSwitcher;
  document.getElementById('logout').onclick = logout;
  document.getElementById('nav').onclick = (e) => { if (e.target.closest('a')) closeDrawer(); };
}

function updateChrome() {
  if (!document.getElementById('who')) renderShell();
  const l = ledger();
  document.getElementById('hey').textContent = `Hey ${S.user.display_name}`;
  document.getElementById('hey').setAttribute('dir', 'auto');
  const led = document.getElementById('led');
  render(led, html`${l ? ut(l.name) : 'No budget'} ▾`);
  document.getElementById('signed').textContent = `Signed in as @${S.user.username}`;
  const { page } = route();
  render(document.getElementById('nav'), html`${NAV.map((n) => html`<a href="${n.href}" class="${n.key === page ? 'active' : ''}"><span class="ico">${n.ico}</span><span>${n.label}</span></a>`)}`);
}

async function logout() {
  try { await post('/api/logout'); } catch { /* already signed out */ }
  S.user = null; S.ledgers = []; S.ledgerId = null; S.categories = []; clearCache();
  try { localStorage.removeItem('bu_ledger'); } catch { /* ignore */ }
  location.hash = '#/';
  showAuth();
}

// ---------------------------------------------------------------- auth + invites
function showAuth(mode = 'login', notice = '') {
  render(app, html`<div class="auth">
    <div class="logo"><img src="/icons/duck.svg" alt="" width="96" height="96"><h1>Budget Up</h1><p>Your shared budget, in shekels.</p></div>
    ${S.inviteInfo ? html`<div class="invite-banner">${ut(S.inviteInfo.inviter)} invited you to join <b>${ut(S.inviteInfo.ledger_name)}</b>.<br>${mode === 'signup' ? 'Create an account to join.' : 'Log in to join.'}</div>` : ''}
    ${notice ? html`<div class="invite-banner">${notice}</div>` : ''}
    <div class="seg" style="margin-bottom:14px">
      <button data-mode="login" class="${mode === 'login' ? 'on' : ''}">Log in</button>
      <button data-mode="signup" class="${mode === 'signup' ? 'on' : ''}">Create account</button></div>
    <form class="card pad" novalidate>
      <div class="form-error hidden"></div>
      ${mode === 'signup' ? html`<label class="field"><span>Your name</span><input type="text" name="display_name" dir="auto" maxlength="40" autocomplete="given-name" placeholder="e.g. Eli"></label>` : ''}
      <label class="field"><span>Username</span><input type="text" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="30"></label>
      <label class="field"><span>Password${mode === 'signup' ? ' (8+ characters)' : ''}</span><input type="password" name="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>
      ${mode === 'signup' ? html`<label class="field"><span>Email (optional — for your monthly summary)</span><input type="email" name="email" autocomplete="email" placeholder="you@example.com"></label>` : ''}
      <button class="btn primary block" type="submit">${mode === 'signup' ? 'Create account' : 'Log in'}</button>
    </form>
    <p class="muted small" style="text-align:center;margin-top:14px">You’ll stay signed in on this device.</p></div>`);
  app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => showAuth(b.dataset.mode); });
  const form = app.querySelector('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = { username: form.username.value, password: form.password.value };
    if (mode === 'signup') { body.display_name = form.display_name.value; body.email = form.email.value; }
    if (S.invite) body.invite = S.invite;
    withBusy(form.querySelector('[type=submit]'), async () => {
      const r = await api('POST', mode === 'signup' ? '/api/signup' : '/api/login', body);
      S.user = r.user; S.ledgers = r.ledgers;
      pickInitialLedger(r.joined_ledger);
      if (S.invite) { S.invite = null; S.inviteInfo = null; history.replaceState(null, '', '/'); toast('You joined the budget 🎉'); }
      location.hash = '#/';
      startApp();
    }, form.querySelector('.form-error'));
  };
}

function showJoinConfirm() {
  const info = S.inviteInfo;
  render(app, html`<div class="auth">
    <div class="logo"><img src="/icons/duck.svg" alt="" width="96" height="96"><h1>Budget Up</h1></div>
    <div class="card pad" style="text-align:center">
      <p style="margin-top:0"><b>${ut(info.inviter)}</b> invited you to join<br><span style="font-size:1.3rem;font-weight:800">${ut(info.ledger_name)}</span></p>
      <p class="muted small">You’re signed in as <b>${ut(S.user.display_name)}</b>. You’ll be able to see and add income and expenses together.</p>
      <button class="btn primary block" id="join">Join this budget</button>
      <button class="btn ghost block" id="skip" style="margin-top:8px">Not now</button></div></div>`);
  const finish = () => { S.invite = null; S.inviteInfo = null; history.replaceState(null, '', '/'); startApp(); };
  app.querySelector('#skip').onclick = finish;
  app.querySelector('#join').onclick = (e) => withBusy(e.currentTarget, async () => {
    const r = await post(`/api/invites/${S.invite}/accept`);
    S.ledgers = r.ledgers; setLedger(r.ledger_id); toast('You joined the budget 🎉'); finish();
  });
}

// ---------------------------------------------------------------- boot
function startApp() {
  if (!S.ledgerId) pickInitialLedger();
  renderShell();
  renderPage();
}

async function boot() {
  setUnauthorizedHandler(() => { if (S.user) { S.user = null; showAuth('login', 'Please log in again.'); } });
  const m = location.pathname.match(/^\/join\/([\w-]+)/);
  if (m) {
    S.invite = m[1];
    try { S.inviteInfo = await get(`/api/invites/${S.invite}`); } catch (e) {
      S.invite = null; history.replaceState(null, '', '/');
      toast(e.message, true);
    }
  }
  try {
    const me = await get('/api/me');
    if (!me.user) { showAuth(S.invite ? 'signup' : 'login'); return; }
    S.user = me.user; S.ledgers = me.ledgers;
    pickInitialLedger();
    if (S.invite && S.inviteInfo) showJoinConfirm(); else startApp();
  } catch (e) {
    render(app, html`<div class="auth"><div class="card empty"><span class="em">📡</span>${e.message}<br><br><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`);
  }
}

boot();
