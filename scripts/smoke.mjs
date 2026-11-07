// End-to-end API smoke test. Usage: node scripts/smoke.mjs [baseUrl]   (needs a running `wrangler dev`)
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const sfx = Math.random().toString(36).slice(2, 7);

class Client {
  constructor() { this.cookie = ''; }
  async call(method, path, body, { raw = false } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const data = await res.json().catch(() => ({}));
    if (raw) return { status: res.status, data };
    assert.ok(res.ok, `${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
}
const log = (m) => console.log('  ok  ' + m);

const eli = new Client(), partner = new Client(), stranger = new Client();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const month = today.slice(0, 7);
const last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);

// signup / session
let r = await eli.call('POST', '/api/signup', { username: 'eli_' + sfx, password: 'password123', display_name: 'Eli', email: 'eli@example.com' });
assert.equal(r.ledgers.length, 1); log('signup creates personal budget');
const L = r.ledgers[0].id;
assert.equal((await eli.call('GET', '/api/me')).user.display_name, 'Eli'); log('session cookie keeps you signed in');
assert.equal((await new Client().call('GET', '/api/me')).user, null); log('anonymous gets no user');
assert.equal((await new Client().call('GET', `/api/ledgers/${L}/categories`, undefined, { raw: true })).status, 401); log('anonymous is rejected from data');
assert.equal((await eli.call('POST', '/api/signup', { username: 'eli_' + sfx, password: 'password123' }, { raw: true })).status, 409); log('duplicate username rejected');
assert.equal((await new Client().call('POST', '/api/login', { username: 'eli_' + sfx, password: 'wrongwrong' }, { raw: true })).status, 401); log('bad password rejected');

// categories
let { categories } = await eli.call('GET', `/api/ledgers/${L}/categories`);
const byName = (n) => categories.find((c) => c.name === n);
assert.ok(byName('Rent') && byName('Shopping') && byName('Toiletries')); log('seeded categories');
assert.equal(byName('Shopping').parent_id, byName('Food').id); log('subcategories under Food');

// transactions
const tx = async (body) => (await eli.call('POST', `/api/ledgers/${L}/transactions`, body)).transaction;
const shop = await tx({ type: 'expense', amount: 800, category_id: byName('Shopping').id, comment: 'weekly', date: today });
await tx({ type: 'expense', amount: '200.50', category_id: byName('Snacks').id, date: today });
await tx({ type: 'income', amount: 10000, comment: 'salary', date: today });
assert.equal(shop.amount, 80000); log('expense stored in agorot');
assert.equal((await eli.call('POST', `/api/ledgers/${L}/transactions`, { type: 'expense', amount: 5, date: today }, { raw: true })).status, 400); log('expense needs a category');
assert.equal((await eli.call('POST', `/api/ledgers/${L}/transactions`, { type: 'income', amount: -5, date: today }, { raw: true })).status, 400); log('negative amount rejected');
let list = (await eli.call('GET', `/api/ledgers/${L}/transactions?from=${month}-01&to=${last}`)).transactions;
assert.equal(list.length, 3); log('list month');
await eli.call('PATCH', `/api/transactions/${shop.id}`, { amount: 900, comment: 'fixed typo' });
list = (await eli.call('GET', `/api/ledgers/${L}/transactions?from=${month}-01&to=${last}`)).transactions;
assert.equal(list.find((t) => t.id === shop.id).amount, 90000); log('edit entry');

// sharing
assert.equal((await stranger.call('POST', '/api/signup', { username: 'str_' + sfx, password: 'password123' })).ledgers.length, 1);
assert.equal((await stranger.call('GET', `/api/ledgers/${L}/transactions?from=${month}-01&to=${last}`, undefined, { raw: true })).status, 404); log('non-members cannot read a budget');
const inv = await eli.call('POST', `/api/ledgers/${L}/invites`, {});
const info = await new Client().call('GET', `/api/invites/${inv.token}`);
assert.equal(info.inviter, 'Eli'); log('invite link previews the budget');
const p = await partner.call('POST', '/api/signup', { username: 'par_' + sfx, password: 'password123', display_name: 'Partner', invite: inv.token });
assert.equal(p.ledgers.length, 1); assert.equal(p.ledgers[0].id, L); log('signing up through an invite joins the budget');
const plist = (await partner.call('GET', `/api/ledgers/${L}/transactions?from=${month}-01&to=${last}`)).transactions;
assert.equal(plist.length, 3); log('partner sees the shared entries');
const ptx = (await partner.call('POST', `/api/ledgers/${L}/transactions`, { type: 'expense', amount: 50, category_id: byName('Rent').id, date: today })).transaction;
assert.equal(ptx.created_by_name, 'Partner'); log('partner can add; entry shows who added it');
const s2 = await stranger.call('POST', `/api/invites/${inv.token}/accept`, {});
assert.equal(s2.ledgers.length, 2); log('existing account accepts an invite');
await stranger.call('DELETE', `/api/ledgers/${L}/members/${p.user.id}`, undefined, { raw: true });
assert.equal((await eli.call('DELETE', `/api/ledgers/${L}/members/${p.user.id}`, {}, { raw: true })).status, 200); log('owner can remove a member');
assert.equal((await partner.call('GET', `/api/ledgers/${L}/categories`, undefined, { raw: true })).status, 404); log('removed member loses access');

// categories editing
categories = (await eli.call('POST', `/api/ledgers/${L}/categories`, { name: 'Pets' })).categories;
const pets = categories.find((c) => c.name === 'Pets');
categories = (await eli.call('POST', `/api/ledgers/${L}/categories`, { name: 'Vet', parent_id: pets.id })).categories;
assert.equal(categories.find((c) => c.name === 'Vet').parent_id, pets.id); log('add main + sub category');
categories = (await eli.call('PATCH', `/api/categories/${byName('Household').id}`, { parent_id: pets.id })).categories;
assert.equal(categories.find((c) => c.name === 'Household').parent_id, pets.id); log('move a main category under another');
assert.equal((await eli.call('PATCH', `/api/categories/${byName('Food').id}`, { parent_id: pets.id }, { raw: true })).status, 400); log('cannot nest a category that has subcategories');
categories = (await eli.call('DELETE', `/api/categories/${pets.id}`, {})).categories;
assert.ok(categories.filter((c) => ['Pets', 'Vet'].includes(c.name)).every((c) => c.archived)); log('delete archives category + subs');

// defaults
const rentId = byName('Rent').id;
await eli.call('POST', `/api/ledgers/${L}/defaults`, { type: 'expense', category_id: rentId, amount: 4500, comment: 'monthly rent' });
await eli.call('POST', `/api/ledgers/${L}/defaults`, { type: 'income', amount: 12000, comment: 'salary' });
list = (await eli.call('GET', `/api/ledgers/${L}/transactions?from=${month}-01&to=${last}`)).transactions;
assert.equal(list.filter((t) => t.default_id).length, 2); log('default items are added automatically');
list = (await eli.call('GET', `/api/ledgers/${L}/transactions?from=${month}-01&to=${last}`)).transactions;
assert.equal(list.filter((t) => t.default_id).length, 2); log('...and only once');

// maaser
let m = await eli.call('GET', `/api/ledgers/${L}/maaser`);
assert.equal(m.maaser.windowIncome, 2200000); assert.equal(m.maaser.owed, 220000); log('maaser = 10% of income');
m = await eli.call('POST', `/api/ledgers/${L}/maaser/gives`, { amount: 100, date: today, comment: 'tzedakah' });
assert.equal(m.maaser.left, 210000); log('giving reduces what is left');
m = await eli.call('POST', `/api/ledgers/${L}/maaser/gives`, { amount: 3000, date: today });
assert.equal(m.maaser.left, -90000); log('extra giving goes negative (remembered)');

// account
assert.equal((await eli.call('PATCH', '/api/me', { email: 'nope' }, { raw: true })).status, 400); log('bad email rejected');
await eli.call('POST', '/api/me/password', { current: 'password123', next: 'newpassword456' });
await new Client().call('POST', '/api/login', { username: 'eli_' + sfx, password: 'newpassword456' }); log('password change');
await eli.call('POST', '/api/logout', {});
assert.equal((await eli.call('GET', '/api/me')).user, null); log('logout');

console.log('\nAll API checks passed.');



