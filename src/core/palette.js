// The matte palette for charts, checked for colour-blind separation and contrast with the
// data visualisation validator. Six hues is the most that stay clearly distinct, so smaller
// categories fold into a neutral Other. Colours are chosen by category, not by rank, so
// Groceries stays the same colour from month to month whenever it can.
export const SERIES = ['#3F6EA8', '#CC6A3C', '#2A9A7C', '#D09A1F', '#7858B8', '#DB7EA0'];
export const NEUTRAL = '#A9A8A2';
const MAX_SLICES = 6;

const PREFERRED = {
  'Groceries': 2, 'Transport': 0, 'Bills & phone': 4, 'Family & household': 5,
  'Eating out & takeaway': 1, 'Travel & holidays': 3, 'Subscriptions': 5, 'Shopping': 0,
  'Health & fitness': 2, 'Entertainment': 4, 'Gifts & charity': 1, 'Fees & interest': 3,
};

// lines: [{ name, pence }]. Returns up to six slices plus Other, biggest first, each with a
// colour index, or -1 for neutral. If two share a preferred colour, the smaller takes the next
// free one.
export function toSlices(lines) {
  const positive = lines.filter((l) => l.pence > 0).sort((a, b) => b.pence - a.pence);
  const main = positive.filter((l) => !['Other spend', 'Uncategorised'].includes(l.name)).slice(0, MAX_SLICES);
  const used = new Set();
  const slices = main.map((l) => {
    let hue = PREFERRED[l.name] ?? 0;
    while (used.has(hue)) hue = (hue + 1) % SERIES.length;
    used.add(hue);
    return { ...l, hue };
  });
  const rest = positive.filter((l) => !main.includes(l)).reduce((t, l) => t + l.pence, 0);
  if (rest > 0) slices.push({ name: 'Everything else', pence: rest, hue: -1 });
  return slices;
}
