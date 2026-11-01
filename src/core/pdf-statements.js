// Read Club Lloyds, Lloyds Ultra and Amex Gold PDF statements into transactions.
//
// A PDF has no rows or columns, only pieces of text at positions on a page, so each
// parser rebuilds the table from those positions, using the table's own header row to
// find the columns. Page layouts can change and text can be misread, so every statement
// is also checked against the totals the bank printed on it. See reconciled below.
import { addTransactions } from './model.js';
import { applyRules, pairCardRepayments } from './categorise.js';
import { parseDate } from './dates.js';
import { parseMoney, FormatError } from './money.js';

const MONEY = /^-?£?[\d,]+\.\d{2}$/;
const near = (a, b, tolerance = 4) => Math.abs(a - b) <= tolerance;
const cleanDesc = (parts) => parts.join(' ').replace(/\s+/g, ' ').trim();
const right = (cell) => cell.x + cell.w;

// Lloyds PDFs carry invisible zero-width labels for screen readers. Those would be
// mistaken for table cells, so everything without a visible width is dropped.
const visible = (page) => page.items.filter((it) => it.w > 0.5);

// Group a page's text into lines, top to bottom, each sorted left to right.
function toLines(items, tolerance = 1.5) {
  const lines = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const line = lines[lines.length - 1];
    if (line && line.y - it.y <= tolerance) line.cells.push(it);
    else lines.push({ y: it.y, cells: [it] });
  }
  for (const l of lines) {
    l.cells.sort((a, b) => a.x - b.x);
    l.text = l.cells.map((c) => c.s).join(' ');
  }
  return lines;
}

// Card statements print '12.34' for a charge and '12.34 CR' for money coming back.
// The CR can be part of the same text or a separate piece. Returns signed pence owed.
function owed(text) {
  const m = /^£?\s*([\d,]+\.\d{2})\s*(CR)?$/.exec(String(text).trim());
  if (!m) throw new FormatError(`Unrecognised card amount '${text}'`);
  return m[2] ? -parseMoney(m[1]) : parseMoney(m[1]);
}

// Card statements print no year on each row, so take it from the statement date. A month
// later than the statement's month must be last year: December on a January statement.
function dateFromStatement(day, monthName, statementDate) {
  const month = Number(parseDate(`1 ${monthName} 2000`).slice(5, 7));
  const [sy, sm] = statementDate.split('-').map(Number);
  return parseDate(`${day} ${monthName} ${month > sm ? sy - 1 : sy}`);
}

const check = (name, expected, actual) => ({ name, ok: expected === actual, expected, actual });
const allDated = (rows, latest) => ({
  name: 'No transaction is dated after the statement',
  ok: rows.every((r) => r.date <= latest),
});

// ---------- Club Lloyds ----------

const CLUB_ROW_DATE = /^\d{1,2} [A-Z][a-z]{2} \d{2}$/;

function parseClub(pages) {
  const rows = [];
  let opening = null, closing = null, moneyIn = null, moneyOut = null, periodEnd = null;

  for (const page of pages) {
    const lines = toLines(visible(page));
    for (const l of lines) {
      const m = /^Money (In|Out) £?([\d,.]+) Balance .*?(\d{1,2} [A-Z][a-z]+ \d{4}) (-?)£?([\d,.]+)$/.exec(l.text);
      if (!m) continue;
      const balance = parseMoney(m[4] + m[5]);
      if (m[1] === 'In') { moneyIn = parseMoney(m[2]); opening = balance; }
      else { moneyOut = parseMoney(m[2]); closing = balance; periodEnd = parseDate(m[3]); }
    }

    const headerAt = lines.findIndex((l) => /^Date Description Type Money In/.test(l.text));
    if (headerAt < 0) continue;
    const [dateCol, descCol, typeCol, inCol, outCol, balCol] = lines[headerAt].cells;
    let last = null;

    for (const l of lines.slice(headerAt + 1)) {
      const first = l.cells[0];
      if (CLUB_ROW_DATE.test(first.s) && near(first.x, dateCol.x)) {
        const desc = l.cells.filter((c) => c.x >= descCol.x - 4 && c.x < typeCol.x - 4).map((c) => c.s);
        const amounts = l.cells.filter((c) => c.x >= typeCol.x && MONEY.test(c.s));
        const typeCell = l.cells.find((c) => near(c.x, typeCol.x));
        const inCell = amounts.find((c) => near(right(c), right(inCol), 6));
        const outCell = amounts.find((c) => near(right(c), right(outCol), 6));
        const balCell = amounts.find((c) => near(right(c), right(balCol), 6));
        if (!!inCell === !!outCell) throw new FormatError(`Club Lloyds row needs one amount: '${l.text}'`);
        last = {
          date: parseDate(first.s),
          description: cleanDesc(desc),
          amountPence: inCell ? parseMoney(inCell.s) : -parseMoney(outCell.s),
          balancePence: balCell ? parseMoney(balCell.s) : null,
          bankType: typeCell ? typeCell.s.toUpperCase() : null,
          y: l.y,
        };
        rows.push(last);
      } else if (last && last.y - l.y < 14 && l.cells.every((c) => near(c.x, descCol.x))) {
        // A description wrapped onto a second line. Rows are 25 points apart, so this
        // cannot be a footer or the next row.
        last.description = cleanDesc([last.description, l.text]);
        last.y = l.y;
      }
    }
  }
  if (closing === null) throw new FormatError('Could not find the Club Lloyds summary totals.');

  // Each row prints the balance after it, so a misread amount breaks the chain at that row.
  const runningOk = rows.every((r, i) => i === 0 || rows[i - 1].balancePence + r.amountPence === r.balancePence);
  const first = rows[0], lastRow = rows[rows.length - 1];
  // The summary's opening balance was seen to be the balance after the first row, not
  // before it, on a real statement. Either is accepted. The first row's amount is still
  // verified, because it is part of the money in and money out totals.
  const openingOk = !first || opening === first.balancePence || opening === first.balancePence - first.amountPence;
  const sum = (keep) => rows.filter(keep).reduce((t, r) => t + Math.abs(r.amountPence), 0);
  return {
    account: 'lloyds-club',
    rows,
    statement: { date: periodEnd, closingBalancePence: closing },
    checks: [
      check('Money in matches the statement total', moneyIn, sum((r) => r.amountPence > 0)),
      check('Money out matches the statement total', moneyOut, sum((r) => r.amountPence < 0)),
      { name: 'Running balance agrees on every row', ok: runningOk },
      { name: 'Opening balance agrees with the first row', ok: openingOk },
      check('Closing balance matches the last row', closing, lastRow?.balancePence),
      allDated(rows, periodEnd),
    ],
    warnings: [],
  };
}

// ---------- Lloyds Ultra ----------

const ULTRA_ROW_DATE = /^(\d{1,2}) ([A-Z]+)$/;

function parseUltra(pages) {
  const firstLines = toLines(visible(pages[0]));
  const titleAt = firstLines.findIndex((l) => l.text.includes('Your credit card statement'));
  const dateCell = firstLines.slice(titleAt + 1).flatMap((l) => l.cells)
    .find((c) => /^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(c.s) && near(c.x, firstLines[titleAt].cells.find((d) => d.s.includes('statement')).x));
  if (!dateCell) throw new FormatError('Could not find the Lloyds Ultra statement date.');
  const statementDate = parseDate(dateCell.s);

  const rows = [];
  let opening = null, closing = null;
  for (const page of pages) {
    const lines = toLines(visible(page));
    const headerAt = lines.findIndex((l) => l.text.includes('Date of transaction') && l.text.includes('Description'));
    if (headerAt < 0) continue;
    const header = lines[headerAt].cells;
    const dateCol = header.find((c) => c.s.startsWith('Date of transaction'));
    const descCol = header.find((c) => c.s === 'Description');
    const amountCol = header.find((c) => c.s.startsWith('Amount'));
    let last = null;

    for (const l of lines.slice(headerAt + 1)) {
      if (l.text.startsWith('BALANCE FROM PREVIOUS STATEMENT')) {
        opening = owed(l.text.replace('BALANCE FROM PREVIOUS STATEMENT', ''));
        continue;
      }
      if (l.cells[0].s === 'New balance') {
        closing = owed(l.text.replace('New balance', ''));
        break; // everything below this on the page is explanation, not transactions
      }
      const dateCell = l.cells.find((c) => near(c.x, dateCol.x) && ULTRA_ROW_DATE.test(c.s));
      if (dateCell) {
        const [, day, month] = ULTRA_ROW_DATE.exec(dateCell.s);
        const amountText = l.cells.filter((c) => c.x > amountCol.x - 40).map((c) => c.s).join(' ');
        const desc = l.cells.filter((c) => c.x >= descCol.x - 4 && c.x < amountCol.x - 40).map((c) => c.s);
        last = {
          date: dateFromStatement(day, month, statementDate),
          description: cleanDesc(desc),
          amountPence: -owed(amountText), // a charge raises what you owe, which is money out
          balancePence: null,
          y: l.y,
        };
        rows.push(last);
      } else if (last && last.y - l.y < 12 && l.cells.every((c) => near(c.x, descCol.x))) {
        // '5.00 USD @ 1.234' only restates a foreign charge. The row already holds its
        // sterling amount, so the line is left out to keep the description stable.
        if (!l.text.includes('@')) last.description = cleanDesc([last.description, l.text]);
        last.y = l.y;
      } else if (near(l.cells[0].x, dateCol.x) || l.cells[0].x < dateCol.x) {
        if (!dateCell) last = null;
      }
    }
  }
  if (opening === null || closing === null) throw new FormatError('Could not find the Lloyds Ultra balances.');

  const movement = rows.reduce((t, r) => t + r.amountPence, 0);
  return {
    account: 'lloyds-ultra',
    rows,
    statement: { date: statementDate, closingBalancePence: -closing },
    checks: [
      check('Previous balance plus transactions equals new balance', closing, opening - movement),
      allDated(rows, statementDate),
    ],
    warnings: [],
  };
}

// ---------- Amex Gold ----------

const AMEX_ROW_DATE = /^([A-Z][a-z]{2}) (\d{1,2})$/;
const AMEX_SUMMARY = /£\s*([\d,]+\.\d{2})(\s*CR)?\s*-\s*£\s*([\d,]+\.\d{2})\s*\+\s*£\s*([\d,]+\.\d{2})\s*=\s*£\s*([\d,]+\.\d{2})(\s*CR)?/;

function parseAmex(pages) {
  const firstItems = visible(pages[0]);
  const dateCell = firstItems.find((c) => /^\d{2}\/\d{2}\/\d{2}$/.test(c.s));
  if (!dateCell) throw new FormatError('Could not find the Amex statement date.');
  const statementDate = parseDate(dateCell.s);

  const summary = toLines(firstItems).map((l) => AMEX_SUMMARY.exec(l.text)).find(Boolean);
  if (!summary) throw new FormatError('Could not find the Amex account summary.');
  const opening = summary[2] ? -parseMoney(summary[1]) : parseMoney(summary[1]);
  const closing = summary[6] ? -parseMoney(summary[5]) : parseMoney(summary[5]);

  const rows = [];
  let printedTotal = null;
  for (const page of pages) {
    const items = visible(page);
    const header = items.find((c) => c.s === 'Transaction Details');
    if (!header) continue;
    const amountHead = items.find((c) => c.s.startsWith('Amount') && c.y <= header.y + 3);

    // Amex offsets a row's text vertically: the amount can sit a point lower and CR a whole
    // line lower. So a row is everything from its date down to the next row's date.
    const below = items.filter((c) => c.y < header.y - 3);
    const leftEdge = below.filter((c) => c.x < header.x - 6 && c.x < 40).sort((a, b) => b.y - a.y);
    const starts = [];
    let bottom = -Infinity;
    for (const c of leftEdge) {
      if (AMEX_ROW_DATE.test(c.s)) { starts.push(c); continue; }
      bottom = c.y; // the first left-edge text that is not a date ends the table
      const total = /^Total new/.test(c.s)
        ? below.find((a) => near(a.y, c.y, 2) && a.x > amountHead.x - 30 && MONEY.test(a.s)) : null;
      if (total) printedTotal = (printedTotal ?? 0) + parseMoney(total.s);
      break;
    }

    starts.forEach((start, i) => {
      const nextY = i + 1 < starts.length ? starts[i + 1].y : bottom;
      const cells = below.filter((c) => c.y <= start.y + 1.5 && c.y > nextY + 1.5);
      const amountCell = cells.find((c) => c.x > amountHead.x - 30 && MONEY.test(c.s));
      if (!amountCell) throw new FormatError('An Amex row has no amount.');
      const isCredit = cells.some((c) => c.s === 'CR' && c.x > amountHead.x - 30);
      // Text between the details and the amount is the foreign-spending column, which
      // restates a charge in another currency. The Amount column is always sterling.
      const desc = cells.filter((c) => c.x >= header.x - 4 && c.x < header.x + 270)
        .sort((a, b) => (Math.abs(a.y - b.y) <= 1.5 ? a.x - b.x : b.y - a.y)).map((c) => c.s);
      const [, month, day] = AMEX_ROW_DATE.exec(start.s);
      const pence = parseMoney(amountCell.s);
      rows.push({
        date: dateFromStatement(day, month, statementDate),
        description: cleanDesc(desc),
        amountPence: isCredit ? pence : -pence,
        balancePence: null,
      });
    });
  }

  const movement = rows.reduce((t, r) => t + r.amountPence, 0);
  const charges = rows.filter((r) => r.amountPence < 0).reduce((t, r) => t - r.amountPence, 0);
  const warnings = [];
  // A refund can be netted into Amex's own total, so this one only warns.
  if (printedTotal !== null && printedTotal !== charges) {
    warnings.push("Charges differ from Amex's printed total. A refund is the usual reason.");
  }
  return {
    account: 'amex-gold',
    rows,
    statement: { date: statementDate, closingBalancePence: -closing },
    checks: [
      check('Previous balance plus transactions equals closing balance', closing, opening - movement),
      allDated(rows, statementDate),
    ],
    warnings,
  };
}

// ---------- Entry points ----------

function detect(pages) {
  const text = pages.map((p) => p.items.map((i) => i.s).join(' ')).join(' ');
  if (text.includes('American Express') && text.includes('Statement of Account')) return parseAmex;
  if (text.includes('Lloyds Ultra') && text.includes('Date of transaction')) return parseUltra;
  if (text.includes('CLUB LLOYDS') && text.includes('Your Transactions')) return parseClub;
  throw new FormatError('This PDF is not a Club Lloyds, Lloyds Ultra or Amex Gold statement.');
}

// Returns { account, rows, statement, checks, warnings, reconciled }. The bank is
// recognised from the document, so a statement cannot be filed under the wrong account.
export function parseStatement(pages, sourceFile = null) {
  const parsed = detect(pages)(pages);
  parsed.rows = parsed.rows.map(({ y, ...r }) => ({ ...r, account: parsed.account, currency: 'GBP', sourceFile }));
  // No rows at all means the layout was not understood, even if the sums happen to agree.
  parsed.checks.unshift({ name: 'Transactions were found', ok: parsed.rows.length > 0 });
  parsed.reconciled = parsed.checks.every((c) => c.ok);
  return parsed;
}

// Add a parsed statement to the data. A statement that fails its checks is refused, so
// misread numbers cannot reach your totals. The closing balance is recorded too, unless
// you have already entered a balance for that account on that date.
export function importStatement(state, parsed, now = Date.now()) {
  if (!parsed.reconciled) {
    const failed = parsed.checks.filter((c) => !c.ok).map((c) => c.name).join('; ');
    throw new FormatError(`This statement did not add up, so nothing was imported. Failed: ${failed}`);
  }
  const counts = addTransactions(state, parsed.rows, now);
  applyRules(state, now);
  counts.unpairedCardPayments = pairCardRepayments(state, now).length;
  const { date, closingBalancePence } = parsed.statement;
  const key = `${date}|${parsed.account}`;
  if (!state.balances[key]) {
    state.balances[key] = { date, account: parsed.account, balancePence: closingBalancePence, updatedAt: now };
  }
  state.statements[`${parsed.account}|${date}`] = {
    account: parsed.account, date, rows: parsed.rows.length, sourceFile: parsed.rows[0]?.sourceFile ?? null, updatedAt: now,
  };
  return counts;
}
