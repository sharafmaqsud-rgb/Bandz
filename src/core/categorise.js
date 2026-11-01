// Turn a raw description into a category using rules of { pattern, category }.
//
// Patterns match whole words, so FEE does not fire on COFFEE. A trailing * matches a
// word prefix (NANDO* matches NANDOS). When several rules match, the longest pattern
// wins, so UBER EATS beats UBER. Rows you set by hand are never overwritten.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

export function compileRules(rules) {
  return rules.map(({ pattern, category }) => {
    const pat = pattern.trim().toUpperCase();
    const prefix = pat.endsWith('*');
    const body = escapeRegex(prefix ? pat.slice(0, -1) : pat);
    // "Word" here means letters and digits, so '.' and '*' count as boundaries.
    const rx = new RegExp(`(?<![A-Z0-9])${body}${prefix ? '' : '(?![A-Z0-9])'}`);
    return { length: pat.length, rx, category };
  });
}

export function matchCategory(description, compiled) {
  const d = description.toUpperCase();
  let best = null;
  for (const rule of compiled) {
    // Strictly longer, so on a tie the earlier rule stays, as in v1.
    if (rule.rx.test(d) && (!best || rule.length > best.length)) best = rule;
  }
  return best ? best.category : null;
}

// (Re)categorise every transaction not set by hand. Returns how many changed.
export function applyRules(state, now = Date.now()) {
  const compiled = compileRules(state.rules);
  let changed = 0;
  for (const tx of Object.values(state.transactions)) {
    if (tx.catSource === 'manual' || tx.catSource === 'paired') continue;
    const category = matchCategory(tx.description, compiled);
    if (category !== tx.category) {
      tx.category = category;
      tx.catSource = category ? 'rule' : null;
      tx.updatedAt = now;
      changed++;
    }
  }
  return changed;
}

const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
const PAIR_WINDOW_DAYS = 10;

// Paying a card appears twice: money out of the current account and a payment received on
// the card. Only the original purchases are spend, so the current-account side must be a
// transfer, whatever wording the bank used for it. So each card payment is matched to a
// current-account payment of exactly the same amount within 10 days. Only uncategorised
// rows can be claimed, so a shop purchase of the same amount is never reclassified.
// Returns the card payments still without a match.
export function pairCardRepayments(state, now = Date.now()) {
  const txs = Object.values(state.transactions);
  const classOf = (t) => state.accounts[t.account].class;
  const used = new Set();
  const unpaired = [];
  const payments = txs.filter((t) => classOf(t) === 'credit' && t.amountPence > 0 && t.category === 'Card repayment');
  for (const pay of payments) {
    const candidates = txs
      .filter((t) => classOf(t) === 'cash' && t.amountPence === -pay.amountPence && !used.has(t.key)
        && (t.category === null || t.category === 'Card repayment')
        && Math.abs(dayNumber(t.date) - dayNumber(pay.date)) <= PAIR_WINDOW_DAYS)
      // Prefer a row already known to be a repayment, then the closest date.
      .sort((a, b) => (b.category !== null) - (a.category !== null)
        || Math.abs(dayNumber(a.date) - dayNumber(pay.date)) - Math.abs(dayNumber(b.date) - dayNumber(pay.date)));
    const match = candidates[0];
    if (!match) { unpaired.push(pay); continue; }
    used.add(match.key);
    if (match.category === null) {
      Object.assign(match, { category: 'Card repayment', catSource: 'paired', updatedAt: now });
    }
  }
  return unpaired;
}

export function setManualCategory(state, key, category, now = Date.now()) {
  const tx = Object.hasOwn(state.transactions, key) ? state.transactions[key] : null;
  if (!tx) throw new Error(`No transaction with key '${key}'`);
  if (!Object.hasOwn(state.categories, category)) throw new Error(`Unknown category '${category}'`);
  tx.category = category;
  tx.catSource = 'manual';
  tx.updatedAt = now;
}

// A stable short name for grouping: leading words up to the first token containing
// a digit or '*', since those are usually reference numbers. At most three words.
export function merchant(description) {
  const words = description.toUpperCase().split(/\s+/).filter(Boolean);
  const keep = [];
  for (const tok of words) {
    if (tok.includes('*')) {
      const head = tok.split('*')[0]; // AMAZON.CO.UK*2K9XD -> the part before the reference
      if (head) keep.push(head);
      break;
    }
    if (/\d/.test(tok)) break;
    keep.push(tok);
    if (keep.length === 3) break;
  }
  return (keep.length ? keep : words.slice(0, 1)).join(' ') || 'UNKNOWN';
}
