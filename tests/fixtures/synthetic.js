// INVENTED statements in the same page layouts as the real PDFs. Nothing here comes from
// a real statement. The transactions follow v1's samples/make_samples.py, with its
// personal details replaced and Revolut removed, and its seeded randomness kept so results
// are repeatable. Amounts are whole pence throughout.
import { FONT_SIZE, textWidth } from './make-pdf.js';

export { FONT_SIZE };

function makeRandom(seed) {
  let a = seed; // mulberry32: a small generator that gives the same numbers every run
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    pence: (lo, hi) => Math.round((lo + next() * (hi - lo)) * 100),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const byDate = (a, b) => a.date.localeCompare(b.date);

// Returns the raw lists for three months. in/out and charge are positive pence.
export function generate() {
  const rnd = makeRandom(7);
  const months = {};
  for (const m of [8, 9, 10]) {
    const y = 2026, club = [], ultra = [], amex = [];
    const out = (d, description, pence) => club.push({ date: iso(y, m, d), description, out: pence, in: 0 });
    const inn = (d, description, pence) => club.push({ date: iso(y, m, d), description, out: 0, in: pence });
    inn(28, 'EXAMPLE EMPLOYER SALARY', 265000);
    if (m === 10) inn(28, 'EXAMPLE EMPLOYER COMMISSION', 94500);
    out(29, 'VANGUARD ASSET MGMT ISA', 150000);
    out(3, 'VODAFONE LTD DD', 2200);
    out(5, 'EXAMPLE GYM CLUB', 4500);
    out(6, 'TRADING 212 FUNDING', 15000);
    out(12, 'REVOLUT TOP-UP', 5000);
    out(9, 'TRANSFER TO HOUSEHOLD', 20000);
    inn(30, 'INTEREST PAID', 45);
    for (const d of [2, 8, 15, 22]) out(d, `TESCO STORES ${rnd.int(1000, 9999)}`, rnd.pence(18, 46));
    for (const d of [4, 11, 18, 25]) out(d, 'TFL TRAVEL CH', rnd.pence(8, 21));
    for (const d of [3, 7, 10, 13, 17, 19, 21, 24, 26]) {
      out(d, rnd.pick(['GREGGS PLC', 'STARBUCKS 4412', 'COSTA COFFEE', 'PRET A MANGER']), rnd.pence(3, 8));
    }
    out(14, 'MKT FRESH PRODUCE', rnd.pence(10, 25));

    const charge = (list, d, description, pence, extra = {}) =>
      list.push({ date: iso(y, m, d), description, charge: pence, ...extra });
    for (const d of [5, 12, 20]) {
      charge(ultra, d, `AMAZON.CO.UK*${rnd.pick(['2K9XD', '7TT3A', '1BB2C'])}`, rnd.pence(12, 32));
    }
    if (m === 10) {
      charge(ultra, 16, 'AMAZON.CO.UK*9ZZ8Q', 18999);
      charge(ultra, 18, 'DELIVEROO 5521', 2450);
      charge(ultra, 18, 'DELIVEROO 5521', 2450); // a possible duplicate, and both must be kept
    } else charge(ultra, 18, 'DELIVEROO 5521', rnd.pence(18, 28));
    charge(ultra, 1, 'NETFLIX.COM', 1099);
    charge(ultra, 1, 'SPOTIFY P12A3B', 1199, { foreign: '14.00 USD @ 1.168' });
    charge(ultra, 2, 'EXAMPLE AI SUBSCRIPTION', 1800);
    charge(ultra, 2, 'EXAMPLE RING MEMBERSHIP', 599);
    charge(ultra, 27, 'NON-STERLING TRANSACTION FEE', 85);

    for (const d of [6, 13, 20]) {
      charge(amex, d, rnd.pick(['NANDOS EXAMPLETOWN', 'TRAINLINE LONDON', 'UBER *TRIP HELP.UBER.COM']), rnd.pence(14, 48));
    }
    charge(amex, 8, 'ZARA UK ONLINE', rnd.pence(30, 70), { wrap: 'LONDON GB' });
    if (m === 10) charge(amex, 21, 'EASYJET000 LUTON', 18240);

    const total = (list) => list.reduce((t, r) => t + r.charge, 0);
    const ultraTotal = total(ultra), amexTotal = total(amex);
    ultra.push({ date: iso(y, m, 30), description: 'PAYMENT RECEIVED - THANK YOU', credit: ultraTotal });
    amex.push({ date: iso(y, m, 30), description: 'PAYMENT RECEIVED - THANK YOU', credit: amexTotal });
    out(30, 'LLOYDS BANK CREDIT CARD', ultraTotal);
    out(30, 'AMEX PAYMENT', amexTotal);

    months[m] = { club: club.sort(byDate), ultra: ultra.sort(byDate), amex: amex.sort(byDate) };
  }
  return months;
}

// ---------- Page layouts ----------

const pounds = (p) => {
  const whole = Math.floor(Math.abs(p) / 100).toString().replace(/\B(?=(\d{3})+$)/g, ',');
  return `${p < 0 ? '-' : ''}${whole}.${String(Math.abs(p) % 100).padStart(2, '0')}`;
};
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (d) => MONTH[Number(d.slice(5, 7)) - 1];
const dayOf = (d) => String(Number(d.slice(8)));
const long = (d) => `${dayOf(d)} ${monthOf(d)} ${d.slice(0, 4)}`;

// A page is built as positioned cells. text() places by left edge, rightAt() by right edge.
const text = (x, y, s) => ({ x, y, s });
const rightAt = (edge, y, s) => ({ x: edge - textWidth(s), y, s });

export function clubPages(rows, { opening = 100000, start, end, openingAfterFirst = false }) {
  let balance = opening;
  const lines = rows.map((r) => { balance += r.in - r.out; return { ...r, balance }; });
  const moneyIn = rows.reduce((t, r) => t + r.in, 0), moneyOut = rows.reduce((t, r) => t + r.out, 0);
  const printedOpening = openingAfterFirst ? lines[0].balance : opening;
  const tableHeader = (y) => [
    text(57, y, 'Date'), text(122, y, 'Description'), text(271, y, 'Type'),
    rightAt(376, y, 'Money In (£)'), rightAt(453, y, 'Money Out (£)'), rightAt(538, y, 'Balance (£)'),
  ];
  const footer = [text(57, 73, 'Example footer text 0800 000 000'), text(57, 46, 'Lloyds Bank plc registered example')];

  const pages = [];
  let page = [
    text(57, 830, 'Statement, Lloyds Bank.'), text(490, 810, 'Page 1 of 2'),
    text(306, 722, 'Sort Code'), text(393, 722, '00-00-00'),
    text(57, 646, 'CLUB LLOYDS'), text(343, 646, `${long(start)} to ${long(end)}`),
    text(57, 606, 'Money In'), text(246, 606, `£${pounds(moneyIn)}`), text(304, 606, `Balance on ${long(start)}`), text(498, 606, `£${pounds(printedOpening)}`),
    text(57, 589, 'Money Out'), text(246, 589, `£${pounds(moneyOut)}`), text(304, 589, `Balance on ${long(end)}`), text(498, 589, `£${pounds(balance)}`),
    text(57, 551, 'Your Transactions'), ...tableHeader(518), ...footer,
  ];
  let y = 493;
  for (const r of lines) {
    if (y < 110) {
      page.push(text(57, 98, '(Continued on next page)'));
      pages.push(page);
      page = [text(57, 830, 'Statement, Lloyds Bank.'), text(57, 745, 'CLUB LLOYDS'), text(57, 709, 'Your Transactions'), ...tableHeader(676), ...footer];
      y = 651;
    }
    const yy = String(Number(r.date.slice(2, 4)));
    page.push(text(57, y, `${r.date.slice(8)} ${monthOf(r.date).slice(0, 3)} ${yy}`), text(122, y, r.description), text(271, y, r.in ? 'FPI' : 'DEB'));
    if (r.in) page.push(rightAt(376, y, pounds(r.in)));
    else page.push(rightAt(453, y, pounds(r.out)));
    page.push(rightAt(538, y, pounds(r.balance)));
    y -= 25;
  }
  // The key to transaction types sits below the table on the last page.
  page.push(text(57, 196, 'Transaction Types'), text(59, 168, 'BGC'), text(85, 168, 'Bank Giro Credit'), text(181, 168, 'FEE'), text(207, 168, 'Fixed Service'));
  pages.push(page);
  return pages;
}

export function ultraPages(rows, { opening = 0, statementDate }) {
  let owed = opening;
  for (const r of rows) owed += (r.charge ?? 0) - (r.credit ?? 0);
  const amt = (p) => (p < 0 ? `${pounds(-p)} CR` : pounds(p));
  const front = [
    text(318, 728, 'Lloyds Ultra'), text(318, 715, 'Credit Card'),
    text(318, 605, 'Previous balance'), text(516, 605, `£${amt(opening)}`),
    text(42, 576, 'Your credit card statement'), text(42, 564, long(statementDate)),
    text(318, 574, 'Your new balance'), text(516, 574, `£${amt(owed)}`),
    text(36, 257, 'Example footer'), text(497, 257, 'Page 1 of 3'),
  ];
  const head = (y) => [
    text(42, y, 'Card ending'), text(96, y, 'Date of transaction'), text(186, y, 'Date entered'),
    text(252, y, 'Description'), rightAt(547, y, 'Amount £'),
  ];
  const pages = [front, [text(26, 782, 'Example terms and conditions. Payments received 12 October.')]];
  let page = [text(318, 728, 'Lloyds Ultra'), ...head(652)];
  let y = 635;
  page.push(text(252, y, 'BALANCE FROM PREVIOUS STATEMENT'), rightAt(544, y, amt(opening)));
  y -= 9;
  for (const r of rows) {
    if (y < 80) {
      pages.push(page);
      page = [text(318, 728, 'Lloyds Ultra'), ...head(652)];
      y = 635;
    }
    const dt = `${r.date.slice(8)} ${monthOf(r.date).toUpperCase()}`;
    page.push(text(42, y, '123'), text(96, y, dt), text(186, y, dt));
    page.push(text(252, y, r.description));
    if (r.credit) page.push(rightAt(557, y, `${pounds(r.credit)} CR`));
    else page.push(rightAt(544, y, pounds(r.charge)));
    y -= 9;
    if (r.foreign) { page.push(text(252, y, r.foreign)); y -= 9; }
  }
  page.push(text(42, y - 9, 'New balance'), rightAt(546, y - 9, `£${amt(owed)}`));
  page.push(text(48, y - 27, 'Example note about how we allocate your payment to the balance.'));
  pages.push(page);
  return pages;
}

export function amexPages(rows, { opening = 0, statementDate }) {
  let owed = opening, payments = 0, charges = 0;
  for (const r of rows) {
    owed += (r.charge ?? 0) - (r.credit ?? 0);
    payments += r.credit ?? 0;
    charges += r.charge ?? 0;
  }
  const ddmmyy = `${statementDate.slice(8)}/${statementDate.slice(5, 7)}/${statementDate.slice(2, 4)}`;
  const banner = [text(72, 799, 'American Express'), text(14, 753, 'Statement of Account'), text(480, 751, 'Page 1 of 3'),
    text(14, 731, 'Prepared For'), text(520, 731, 'Date'), text(487, 720, ddmmyy)];
  const summary = [
    text(72, 799, 'American Express'), text(14, 717, 'Statement of Account'), text(520, 696, 'Date'), text(487, 685, ddmmyy),
    text(96, 624, `£${pounds(opening)}`), text(143, 624, '-'), text(195, 624, `£${pounds(payments)}`), text(237, 624, '+'),
    text(288, 624, `£${pounds(charges)}`), text(333, 624, '='), text(385, 624, '£'), text(391, 624, pounds(owed)),
    text(14, 546, 'Example note about the closing balance.'),
  ];
  const head = (y) => [
    text(14, y + 8, 'Transaction'), text(58, y + 8, 'Process'), text(14, y, 'Date'), text(58, y, 'Date'),
    text(101, y, 'Transaction Details'), text(377, y, 'Foreign Spending'), rightAt(533, y - 2, 'Amount £'),
  ];
  const pages = [summary];
  let page = [...banner, ...head(543)];
  let y = 524;
  for (const r of rows) {
    if (y < 150) {
      page.push(text(14, 130, 'Example note about your statement'), text(14, 110, 'More example notes'));
      pages.push(page);
      page = [...banner, ...head(690)];
      y = 672;
    }
    const dt = `${monthOf(r.date).slice(0, 3)} ${dayOf(r.date)}`;
    page.push(text(14, y, dt), text(58, y, dt), text(101, y, r.description));
    // Amex prints the amount a point below the description, and CR a whole line below it.
    page.push(rightAt(533, y - 1, pounds(r.charge ?? r.credit)));
    if (r.credit) page.push(text(519, y - 13, 'CR'));
    if (r.wrap) page.push(text(101, y - 9, r.wrap));
    if (r.foreign) page.push(text(377, y, r.foreign));
    y -= 20;
  }
  page.push(text(14, y - 10, 'Total new transactions for Example Person'), rightAt(532, y - 11, pounds(charges)));
  pages.push(page);
  return pages;
}

// What pdf.js would return for these cells, for tests that do not need a real PDF.
export const toItems = (pages) => pages.map((cells) => ({
  items: cells.map((c) => ({ ...c, w: textWidth(c.s) })),
}));
