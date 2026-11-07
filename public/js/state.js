// Shared app state.
export const S = {
  user: null,
  ledgers: [],
  ledgerId: null,
  categories: [],
  cache: new Map(),   // 'ledger|from|to' -> transactions
  view: null,         // View page state (kept while you navigate)
  invite: null,       // pending invite token from /join/:token
};

export const ledger = () => S.ledgers.find((l) => l.id === S.ledgerId) || null;
export const clearCache = () => S.cache.clear();

export function setLedger(id) {
  S.ledgerId = id;
  try { localStorage.setItem('bu_ledger', id); } catch { /* storage unavailable */ }
  S.categories = [];
  S.view = null;
  clearCache();
}

export function pickInitialLedger(preferred) {
  let saved = null;
  try { saved = localStorage.getItem('bu_ledger'); } catch { /* ignore */ }
  const id = [preferred, saved].find((x) => x && S.ledgers.some((l) => l.id === x)) || (S.ledgers[0] && S.ledgers[0].id) || null;
  S.ledgerId = id;
  if (id) try { localStorage.setItem('bu_ledger', id); } catch { /* ignore */ }
}
