// Turn the date formats banks use into ISO yyyy-mm-dd. Dates stay plain strings
// from here on: ISO strings sort correctly and avoid time-zone shifts from Date.
import { FormatError } from './money.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

function monthFromName(name) {
  const n = name.toLowerCase();
  const i = MONTHS.findIndex((m) => m === n || m.slice(0, 3) === n);
  return i + 1; // 0 when not found, which then fails the calendar check
}

// Two-digit years: 00-68 are 20xx and 69-99 are 19xx (the rule v1 inherited from strptime).
const fullYear = (yy) => (yy <= 68 ? 2000 + yy : 1900 + yy);

const FORMATS = [
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
  [/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/, (m) => [+m[3], monthFromName(m[2]), +m[1]]],
  [/^(\d{4})-(\d{1,2})-(\d{1,2}) \d{1,2}:\d{1,2}:\d{1,2}$/, (m) => [+m[1], +m[2], +m[3]]],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, (m) => [fullYear(+m[3]), +m[2], +m[1]]],
  [/^(\d{1,2}) ([A-Za-z]+) (\d{2})$/, (m) => [fullYear(+m[3]), monthFromName(m[2]), +m[1]]],
];

function isRealDate(y, m, d) {
  // Date.UTC rolls 31 Feb over into March, so a round trip exposes impossible dates.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return m >= 1 && m <= 12 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseDate(text) {
  const t = String(text ?? '').trim();
  for (const [rx, parts] of FORMATS) {
    const m = rx.exec(t);
    if (!m) continue;
    const [y, mo, d] = parts(m);
    if (isRealDate(y, mo, d)) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  throw new FormatError(`Unrecognised date '${text}'`);
}
