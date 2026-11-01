// Turn a raw description into a category using rules of { pattern, category }.
//
// Patterns match whole words, so FEE does not fire on COFFEE. A trailing * matches a
// word prefix (NANDO* matches NANDOS). When several rules match, the longest pattern
// wins, so UBER EATS beats UBER. Rows you set by hand are never overwritten.

import { BANK_TYPE_CATEGORY, CATEGORY_WORDS, KNOWN_MERCHANTS } from './merchants.js';

let compiledKnown = null;
let compiledWords = null;

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

// Words too common to tell two merchants apart, so they are never used to learn from.
const COMMON = new Set(['THE', 'AND', 'LTD', 'LIMITED', 'PLC', 'LLP', 'UK', 'GB', 'LONDON', 'STORE', 'SHOP', 'ONLINE', 'PAYMENT', 'CARD', 'COM', 'WWW', 'SERVICES', 'GROUP']);
const SMALL_UNKNOWN_PENCE = 3000;       // £30: too little to interrupt you about
const SMALL_UNKNOWN_TOTAL_PENCE = 10000; // unless the same merchant has reached £100
const REGULAR_INCOME_PENCE = 50000;     // £500 in, from the same payer, in two or more months

const wordsOf = (name) => name.toUpperCase().split(/[^A-Z0-9&]+/).filter((w) => w.length >= 4 && !COMMON.has(w) && !/\d/.test(w));

// Facts gathered once per run: the patterns, and what your own decisions teach about words.
function buildContext(state) {
  const context = {
    rules: compileRules(state.rules),
    known: compiledKnown ??= compileRules(KNOWN_MERCHANTS),
    words: compiledWords ??= compileRules(CATEGORY_WORDS),
    learned: new Map(),
    byMerchant: new Map(),
  };
  const teach = (name, category) => {
    for (const w of wordsOf(name)) {
      if (!context.learned.has(w)) context.learned.set(w, new Map());
      const seen = context.learned.get(w);
      seen.set(category, (seen.get(category) ?? 0) + 1);
    }
  };
  for (const r of state.rules) if (r.userSet) teach(r.pattern.replace(/\*$/, ''), r.category);
  for (const t of Object.values(state.transactions)) {
    const name = merchant(t.description);
    if (t.catSource === 'manual') teach(name, t.category);
    const m = context.byMerchant.get(name) ?? { months: new Set(), totalOut: 0, amounts: new Set() };
    m.months.add(t.date.slice(0, 7));
    if (t.amountPence < 0) m.totalOut -= t.amountPence;
    m.amounts.add(t.amountPence);
    context.byMerchant.set(name, m);
  }
  return context;
}

// A word counts only if your decisions about it all point the same way.
function learnedCategory(name, context) {
  for (const w of wordsOf(name)) {
    const seen = context.learned.get(w);
    if (seen?.size === 1) return { category: [...seen.keys()][0], word: w };
  }
  return null;
}

// Decides one payment. Stronger evidence goes first, and every answer says why. A result with
// no category means the app is unsure and will ask, offering a suggestion if it has one.
function decide(t, state, context) {
  const fileAs = (category, source, confidence, reason) => ({ category, catSource: source, confidence, reason, suggestion: null });
  const ask = (reason, suggestion = null) => ({ category: null, catSource: null, confidence: 'low', reason, suggestion });

  const ruled = matchCategory(t.description, context.rules);
  if (ruled) return fileAs(ruled, 'rule', 'high', 'Matched a rule.');
  const known = matchCategory(t.description, context.known);
  if (known) return fileAs(known, 'auto', 'high', 'A merchant the app recognises.');

  const name = merchant(t.description);
  const learned = learnedCategory(name, context);
  // Learning must fit the direction of the money: a payment out is never income because it
  // shares a word with your employer.
  const fits = learned && (state.categories[learned.category].kind === 'income') === (t.amountPence > 0);
  if (fits) return fileAs(learned.category, 'auto', 'medium', `Similar to a choice you made (${learned.word}).`);

  const byType = t.bankType && Object.hasOwn(BANK_TYPE_CATEGORY, t.bankType) ? BANK_TYPE_CATEGORY[t.bankType] : null;
  if (byType) return fileAs(byType, 'auto', 'medium', `The bank marked this as ${t.bankType}.`);
  const word = matchCategory(t.description, context.words);
  if (word) return fileAs(word, 'auto', 'medium', 'Its name suggests this category.');

  const isCard = state.accounts[t.account].class === 'credit';
  const m = context.byMerchant.get(name);

  if (t.amountPence > 0) {
    // Money coming back to a card is a refund, which should reduce spending, not count as income.
    if (isCard) return fileAs('Other spend', 'auto', 'medium', 'Money back on a card, treated as a refund.');
    if (t.amountPence >= REGULAR_INCOME_PENCE && m.months.size >= 2) {
      return fileAs('Salary', 'auto', 'medium', 'A large payment in, arriving every month.');
    }
    return ask('Money in from a source the app does not recognise.', 'Other income');
  }

  const out = -t.amountPence;
  const isCardPurchase = isCard || t.bankType === 'DEB';
  if (isCardPurchase && out < SMALL_UNKNOWN_PENCE && m.totalOut < SMALL_UNKNOWN_TOTAL_PENCE) {
    return fileAs('Other spend', 'auto', 'low', 'A small purchase at an unfamiliar merchant.');
  }
  if (t.bankType === 'DD' || t.bankType === 'SO') {
    return ask(t.bankType === 'DD' ? 'A Direct Debit from an unfamiliar company.' : 'A standing order the app cannot place.', 'Bills & phone');
  }
  if (m.months.size >= 2 && m.amounts.size === 1) return ask('The same amount, repeating, to an unfamiliar payee.', 'Subscriptions');
  if (t.bankType === 'FPO') return ask('A bank transfer, possibly to a person.', 'Family & household');
  return ask('An unfamiliar merchant.', isCardPurchase ? 'Other spend' : null);
}

// (Re)categorise every transaction not set by hand. Returns how many changed category.
export function applyRules(state, now = Date.now()) {
  const context = buildContext(state);
  let changed = 0;
  for (const tx of Object.values(state.transactions)) {
    if (tx.catSource === 'manual' || tx.catSource === 'paired') continue;
    const d = decide(tx, state, context);
    if (d.category !== tx.category) {
      changed++;
      tx.updatedAt = now;
      tx.reviewed = false;
    }
    Object.assign(tx, d);
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
      Object.assign(match, { category: 'Card repayment', catSource: 'paired', confidence: 'high', reason: 'Same amount as a payment received on your card.', suggestion: null, updatedAt: now });
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
  tx.confidence = 'high';
  tx.reason = 'You chose this.';
  tx.suggestion = null;
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
