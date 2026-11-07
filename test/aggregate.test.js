import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, buildTree, computeMaaser, fmtAmount, monthSpan } from '../public/js/aggregate.js';

test('addMonths crosses year boundaries', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-11', -11), '2025-12');
  assert.equal(monthSpan('2025-12', '2026-11'), 12);
});

test('fmtAmount', () => {
  assert.equal(fmtAmount(123456), '1,234.56');
  assert.equal(fmtAmount(500000), '5,000');
  assert.equal(fmtAmount(-250), '-2.50');
});

const cats = [
  { id: 'food', name: 'Food', parent_id: null, sort: 1 },
  { id: 'shop', name: 'Shopping', parent_id: 'food', sort: 1 },
  { id: 'snk', name: 'Snacks', parent_id: 'food', sort: 2 },
  { id: 'rent', name: 'Rent', parent_id: null, sort: 0 },
];

test('buildTree groups subcategories under their main category', () => {
  const tx = [
    { type: 'expense', category_id: 'shop', amount: 80000 },
    { type: 'expense', category_id: 'snk', amount: 20000 },
    { type: 'expense', category_id: 'rent', amount: 400000 },
  ];
  const tree = buildTree(cats, tx);
  assert.deepEqual(tree.map((t) => [t.name, t.total]), [['Rent', 400000], ['Food', 100000]]);
  assert.deepEqual(tree[1].children.map((c) => [c.name, c.total]), [['Shopping', 80000], ['Snacks', 20000]]);
});

test('spending booked directly on a group shows as General', () => {
  const tx = [{ type: 'expense', category_id: 'food', amount: 5000 }, { type: 'expense', category_id: 'shop', amount: 1000 }];
  const food = buildTree(cats, tx).find((t) => t.id === 'food');
  assert.equal(food.total, 6000);
  assert.equal(food.children[0].general, true);
});

test('archived categories only appear when they still have spending', () => {
  const c = [...cats, { id: 'old', name: 'Old', parent_id: null, sort: 9, archived: 1 }];
  assert.ok(!buildTree(c, []).some((t) => t.id === 'old'));
  assert.ok(buildTree(c, [{ type: 'expense', category_id: 'old', amount: 1 }]).some((t) => t.id === 'old'));
});

test('maaser: 10% of income, only counting months since the ledger started', () => {
  const m = computeMaaser({
    incomes: [{ date: '2026-10-05', amount: 1000000 }, { date: '2026-11-05', amount: 1000000 }],
    gives: [], today: '2026-11-07', ledgerMonth: '2026-10',
  });
  assert.equal(m.months, 2);
  assert.equal(m.owed, 200000);
  assert.equal(m.left, 200000);
});

test('maaser: giving reduces what is left, and extra goes negative', () => {
  const base = { incomes: [{ date: '2026-11-01', amount: 1000000 }], today: '2026-11-07', ledgerMonth: '2026-11' };
  assert.equal(computeMaaser({ ...base, gives: [{ date: '2026-11-02', amount: 60000 }] }).left, 40000);
  assert.equal(computeMaaser({ ...base, gives: [{ date: '2026-11-02', amount: 150000 }] }).left, -50000);
});

test('maaser: window is 12 months; old surplus is remembered, old debt is not', () => {
  const m = computeMaaser({
    incomes: [{ date: '2024-01-10', amount: 1000000 }, { date: '2026-11-01', amount: 1000000 }],
    gives: [{ date: '2024-02-01', amount: 300000 }],
    today: '2026-11-07', ledgerMonth: '2024-01',
  });
  assert.equal(m.start, '2025-12');
  assert.equal(m.months, 12);
  assert.equal(m.owed, 100000);
  assert.equal(m.credit, 200000); // gave 3000, only owed 1000 back then
  assert.equal(m.left, 100000 - 200000);

  const noCredit = computeMaaser({
    incomes: [{ date: '2024-01-10', amount: 1000000 }, { date: '2026-11-01', amount: 1000000 }],
    gives: [], today: '2026-11-07', ledgerMonth: '2024-01',
  });
  assert.equal(noCredit.left, 100000); // 2024 debt expired from the window
});
