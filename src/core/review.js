// What the app needs you to look at. Everything else it files by itself, so this list is
// deliberately short: payments it could not place, and ones it placed that look unusual.
import { merchant } from './categorise.js';
import { monthsWithData } from './analysis.js';
import { largePurchases } from './insights.js';

const LARGE_AUTO_PENCE = 25000; // £250 is too much to file on a guess without you seeing it
const RECENT_MONTHS = 3;

export function reviewQueue(state) {
  const groups = new Map();
  for (const t of Object.values(state.transactions)) {
    if (t.category) continue;
    const name = merchant(t.description);
    const g = groups.get(name) ?? { merchant: name, count: 0, pence: 0, suggestion: null, moneyIn: t.amountPence > 0, reason: t.reason ?? null };
    g.count++;
    g.pence += Math.abs(t.amountPence);
    g.suggestion ??= t.suggestion ?? null;
    groups.set(name, g);
  }

  const months = monthsWithData(state).slice(-RECENT_MONTHS);
  const unusual = new Map();
  const add = (t, why) => {
    if (t && !t.reviewed && !unusual.has(t.key)) unusual.set(t.key, { tx: t, why });
  };
  for (const ym of months) {
    for (const a of largePurchases(state, ym)) {
      add(state.transactions[a.key], `Much larger than your usual ${a.category} purchase.`);
    }
  }
  for (const t of Object.values(state.transactions)) {
    if (t.catSource === 'auto' && Math.abs(t.amountPence) >= LARGE_AUTO_PENCE && months.includes(t.date.slice(0, 7))) {
      add(t, `A large payment filed automatically. ${t.reason ?? ''}`.trim());
    }
  }

  // Small unknown purchases are filed under Other spend so they never interrupt you. They are
  // listed here, optionally, so that a catch-all cannot quietly grow.
  const tidy = new Map();
  for (const t of Object.values(state.transactions)) {
    if (t.catSource !== 'auto' || t.confidence !== 'low') continue;
    const name = merchant(t.description);
    const g = tidy.get(name) ?? { merchant: name, count: 0, pence: 0 };
    g.count++;
    g.pence += Math.abs(t.amountPence);
    tidy.set(name, g);
  }

  return {
    tidy: [...tidy.values()].sort((a, b) => b.pence - a.pence),
    merchants: [...groups.values()].sort((a, b) => b.pence - a.pence),
    unusual: [...unusual.values()].sort((a, b) => Math.abs(b.tx.amountPence) - Math.abs(a.tx.amountPence)),
  };
}

export const reviewCount = (queue) => queue.merchants.length + queue.unusual.length;

// You have seen this one and it is fine, so it should not be asked about again.
export function markReviewed(state, key, now = Date.now()) {
  if (!Object.hasOwn(state.transactions, key)) throw new Error(`No transaction with key '${key}'`);
  Object.assign(state.transactions[key], { reviewed: true, updatedAt: now });
}
