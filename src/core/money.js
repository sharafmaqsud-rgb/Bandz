// Money is always a whole number of pence, never a float, so sums are exact.
// Sign convention everywhere: negative = money out, positive = money in.

export class FormatError extends Error {}

const NUMBER = /^([+-]?)(\d*)(?:\.(\d*))?$/;

// '£1,234.50' -> 123450. Blank or '-' -> null. Works on the text digits rather
// than parseFloat, because 0.1 and friends cannot be held exactly in a float.
export function parseMoney(text) {
  const t = String(text ?? '').trim().replace(/[£,\s]/g, '');
  if (t === '' || t === '-') return null;
  const m = NUMBER.exec(t);
  if (!m || (m[2] === '' && !m[3])) throw new FormatError(`Unrecognised amount '${text}'`);
  const [, sign, whole, frac = ''] = m;
  let pence = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  // Beyond two decimals, round half to even: the same rule v1 got from Decimal.
  const rest = frac.slice(2);
  if (rest) {
    const half = '5'.padEnd(rest.length, '0');
    if (rest > half || (rest === half && pence % 2 === 1)) pence += 1;
  }
  if (!Number.isSafeInteger(pence)) throw new FormatError(`Amount too large '${text}'`);
  return sign === '-' && pence !== 0 ? -pence : pence;
}

// 123450 -> '£1,234.50', -500 -> '-£5.00'.
export function formatPence(pence) {
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+$)/g, ',');
  return `${pence < 0 ? '-' : ''}£${pounds}.${String(abs % 100).padStart(2, '0')}`;
}
