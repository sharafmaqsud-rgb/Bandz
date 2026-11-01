// The numbers. Only the monthly summary is here so far, because importing needs it for
// reconciliation; the rest of v1's analysis arrives with the Goals and insights screens.

// Uncategorised money out counts as spend and money in as income, and both are counted
// separately so they cannot hide.
export function classify(tx, categories) {
  const c = categories[tx.category];
  if (c) return { kind: c.kind, name: tx.category };
  return tx.amountPence < 0
    ? { kind: 'spend', name: 'Uncategorised' }
    : { kind: 'income', name: 'Uncategorised income' };
}

// GBP transactions in a month ('2026-10'), newest categories included as they appear.
export const inMonth = (state, ym) => Object.values(state.transactions)
  .filter((t) => t.currency === 'GBP' && t.date.startsWith(`${ym}-`));

export function summarise(rows, categories) {
  const s = {
    income: 0, spend: 0, saved: 0, essentialSpend: 0,
    spendByCat: {}, incomeByCat: {}, savedByCat: {},
    uncatCount: 0, uncatPence: 0, count: rows.length,
  };
  const addTo = (bucket, name, pence) => { bucket[name] = (bucket[name] ?? 0) + pence; };
  for (const tx of rows) {
    const { kind, name } = classify(tx, categories);
    const a = tx.amountPence;
    // A refund is money in against a spend category, so it reduces spend rather than
    // counting as income. Transfers fall through all of these, so nothing double counts.
    if (kind === 'income') { s.income += a; addTo(s.incomeByCat, name, a); }
    else if (kind === 'spend') {
      s.spend -= a;
      addTo(s.spendByCat, name, -a);
      if (categories[name]?.essential) s.essentialSpend -= a;
    } else if (kind === 'saving') { s.saved -= a; addTo(s.savedByCat, name, -a); }
    if (name.startsWith('Uncategorised')) { s.uncatCount++; s.uncatPence += Math.abs(a); }
  }
  return s;
}
