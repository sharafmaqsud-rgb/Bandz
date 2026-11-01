// Masks text so a statement's layout can be discussed without revealing its contents.
// Any word not on the list below becomes x, including its length. Numbers become 9s,
// and anything over two digits becomes 999, so amounts show their format but not their value.

// Only generic words printed by the bank belong here, never names or merchants.
const KEEP = new Set(`
  date dates transaction transactions description details type reference ref amount amounts
  money in out paid received balance balances debit credit opening closing previous new
  statement statements payment payments total totals fee fees interest page of from to the and
  account number sort code card charges purchases minimum limit available due by
  lloyds bank american express amex club ultra gold cr dr gbp sterling foreign exchange rate
  summary your activity continued brought forward carried posted
  jan feb mar apr may jun jul aug sep oct nov dec january february march april june july
  august september october november december
`.split(/\s+/).filter(Boolean));

export function maskText(text) {
  return String(text).replace(/\p{L}+|\p{N}+/gu, (tok) => {
    if (/^\p{N}+$/u.test(tok)) return tok.length <= 2 ? '9'.repeat(tok.length) : '999';
    return KEEP.has(tok.toLowerCase()) ? tok : 'x';
  });
}
