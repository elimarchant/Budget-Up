// Pure logic shared by the browser app and the Worker (monthly email). No DOM, no I/O.
// All money values are integer agorot.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export const GENERAL = '__general__'; // pseudo-subcategory: spending booked directly on a group

/** 'YYYY-MM' + n months -> 'YYYY-MM' */
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Number of months between two 'YYYY-MM' (inclusive count). */
export function monthSpan(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Build the category tree with totals.
 * categories: [{id,name,parent_id,sort,archived}]
 * transactions: expense transactions [{category_id, amount}]
 * Archived categories only show up if they still have spending.
 * Returns [{id,name,total,count,children:[{id,name,total,count,general?}]}] ordered by sort.
 */
export function buildTree(categories, transactions) {
  const totals = new Map();
  for (const t of transactions) {
    if (t.type && t.type !== 'expense') continue;
    const cur = totals.get(t.category_id) || { total: 0, count: 0 };
    cur.total += t.amount;
    cur.count += 1;
    totals.set(t.category_id, cur);
  }
  const byParent = new Map();
  for (const c of categories) {
    const key = c.parent_id || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  }
  const sortFn = (a, b) => a.sort - b.sort || a.name.localeCompare(b.name);
  const own = (id) => totals.get(id) || { total: 0, count: 0 };
  const tree = [];
  for (const top of (byParent.get('') || []).sort(sortFn)) {
    const kids = (byParent.get(top.id) || []).sort(sortFn);
    const children = [];
    for (const k of kids) {
      const o = own(k.id);
      if (k.archived && !o.count) continue;
      children.push({ id: k.id, name: k.name, total: o.total, count: o.count, archived: !!k.archived });
    }
    const direct = own(top.id);
    if (children.length && direct.count) {
      children.unshift({ id: top.id, name: 'General', total: direct.total, count: direct.count, general: true });
    }
    const total = direct.total + children.filter((c) => !c.general).reduce((s, c) => s + c.total, 0);
    const count = direct.count + children.filter((c) => !c.general).reduce((s, c) => s + c.count, 0);
    if (top.archived && !count) continue;
    tree.push({ id: top.id, name: top.name, total, count, children, archived: !!top.archived });
  }
  return tree;
}

export function sumBy(transactions, type) {
  return transactions.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
}

/**
 * Maaser (charity) = 10% of income over the trailing 12 months.
 *
 *  - The window is the last 12 months, but never starts before the ledger's first month of activity,
 *    so a ledger that is only 2 months old shows just those 2 months.
 *  - left = 10% of window income - gifts given in the window - credit carried in.
 *  - Credit carried in = surplus from before the window (gave more than 10% of income back then),
 *    so overpaying is remembered. Old *unpaid* amounts fall out of the window; old *surplus* does not.
 *  - `left` can be negative: that means extra has been given.
 *
 * incomes / gives: [{date:'YYYY-MM-DD', amount}]. today: 'YYYY-MM-DD'.
 * ledgerMonth: 'YYYY-MM' the ledger was created.
 */
export function computeMaaser({ incomes, gives, today, ledgerMonth }) {
  const current = today.slice(0, 7);
  let first = ledgerMonth || current;
  for (const x of [...incomes, ...gives]) if (x.date.slice(0, 7) < first) first = x.date.slice(0, 7);
  const floor = addMonths(current, -11);
  const start = first > floor ? first : floor;
  const inWindow = (d) => d.slice(0, 7) >= start && d.slice(0, 7) <= current;
  const before = (d) => d.slice(0, 7) < start;

  const windowIncome = incomes.filter((i) => inWindow(i.date)).reduce((s, i) => s + i.amount, 0);
  const givenInWindow = gives.filter((g) => inWindow(g.date)).reduce((s, g) => s + g.amount, 0);
  const incomeBefore = incomes.filter((i) => before(i.date)).reduce((s, i) => s + i.amount, 0);
  const givenBefore = gives.filter((g) => before(g.date)).reduce((s, g) => s + g.amount, 0);

  const owed = Math.round(windowIncome / 10);
  const credit = Math.max(0, givenBefore - Math.round(incomeBefore / 10));
  const left = owed - givenInWindow - credit;
  return {
    start, end: current, months: monthSpan(start, current),
    windowIncome, owed, givenInWindow, credit, left,
  };
}

/**
 * Should the monthly email go out today? `emailDay` (1-31) is the user's chosen day; in months with
 * fewer days it is sent on the month's last day. `today` is 'YYYY-MM-DD'.
 */
export function isSummaryDay(emailDay, today) {
  const [y, m, d] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === Math.min(emailDay, last);
}

/** Format agorot -> '1,234.50' (drops .00). */
export function fmtAmount(agorot) {
  const neg = agorot < 0;
  const abs = Math.abs(agorot);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${w}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
}
