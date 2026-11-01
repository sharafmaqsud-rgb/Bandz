// The building blocks of the dashboards. Everything is SVG drawn with no library. Colours come
// from CSS classes, because the content policy forbids inline styles. Animation is in CSS, and
// is switched off when your device asks for reduced motion.
import { pounds } from '../core/highlights.js';
import { formatPence } from '../core/money.js';
import { toSlices } from '../core/palette.js';
import { h, monthName, svg } from './dom.js';

const hueClass = (hue) => (hue < 0 ? 's-none' : `s${hue + 1}`);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const card = (title, ...kids) => h('section', { className: 'card' }, title && h('h2', null, title), kids);

// A money figure that counts up when a screen first appears, and always ends exactly right.
export function countUp(pence, app) {
  const el = h('span', { className: 'money' }, formatPence(pence));
  if (!app?.animating || reducedMotion()) return el;
  const started = performance.now(), length = 700;
  const step = (now) => {
    const t = Math.min(1, (now - started) / length);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = formatPence(t === 1 ? pence : Math.round(pence * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return el;
}

// A headline tile: a label, a large figure, and an optional line saying what changed.
export function kpi(label, value, note, tag) {
  return h('div', { className: 'kpi' },
    h('div', { className: 'kpi-label' }, label, tag),
    h('div', { className: 'kpi-value' }, value),
    note && h('div', { className: 'kpi-note' }, note));
}

// Up, down or level, in words and an arrow. Colour is never the only signal.
export function change(amount, { suffix = 'on last month', format = pounds } = {}) {
  if (amount === null || amount === undefined) return null;
  if (amount === 0) return `● Level ${suffix}`;
  return `${amount > 0 ? '▲' : '▼'} ${format(Math.abs(amount))} ${suffix}`;
}

// The share of a whole as a ring, for a single measure such as the ISA allowance.
export function ring(share, centre, label) {
  const shown = Math.max(0, Math.min(1, share)) * 100;
  return h('div', { className: 'ring-wrap' },
    svg('svg', { className: 'ring', viewBox: '0 0 42 42', role: 'img', 'aria-label': label },
      svg('circle', { className: 'ring-track', cx: 21, cy: 21, r: 16 }),
      svg('circle', { className: 'ring-fill s1', cx: 21, cy: 21, r: 16, pathLength: 100, 'stroke-dasharray': `${shown} 100`, transform: 'rotate(-90 21 21)' })),
    h('div', { className: 'ring-centre' }, centre));
}

// Where the money went: a ring of categories, with every name and amount written beside it.
export function donut(lines, total, centreLabel = 'Spent') {
  const slices = toSlices(lines);
  const sum = slices.reduce((t, s) => t + s.pence, 0);
  if (!sum) return h('p', { className: 'muted' }, 'No spending yet.');
  let start = 0;
  const GAP = 0.8; // a small gap keeps neighbouring colours apart
  const arcs = slices.map((s) => {
    const len = (s.pence / sum) * 100;
    const arc = svg('circle', {
      className: `donut-arc ${hueClass(s.hue)}`, cx: 21, cy: 21, r: 15.9, pathLength: 100,
      'stroke-dasharray': `${Math.max(len - GAP, 0.2)} 100`, 'stroke-dashoffset': -start, transform: 'rotate(-90 21 21)',
    }, svg('title', null, `${s.name}: ${formatPence(s.pence)}`));
    start += len;
    return arc;
  });
  return h('div', { className: 'donut-wrap' },
    h('div', { className: 'donut' },
      svg('svg', { viewBox: '0 0 42 42', role: 'img', 'aria-label': `${centreLabel} by category` }, arcs),
      h('div', { className: 'donut-centre' }, h('div', { className: 'muted' }, centreLabel), h('strong', null, pounds(total)))),
    h('ul', { className: 'legend' }, slices.map((s) => h('li', null,
      h('span', { className: `dot ${hueClass(s.hue)}`, 'aria-hidden': 'true' }),
      h('span', { className: 'legend-name' }, s.name),
      h('span', { className: 'legend-value' }, pounds(s.pence), h('span', { className: 'muted' }, ` ${Math.round((s.pence / sum) * 100)}%`))))));
}

// One bar split into parts, for what your net worth is made of.
export function stacked(parts) {
  const shown = parts.filter((p) => p.pence > 0);
  const total = shown.reduce((t, p) => t + p.pence, 0);
  if (!total) return null;
  let x = 0;
  return h('div', null,
    svg('svg', { className: 'stack', viewBox: '0 0 100 6', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      shown.map((p) => {
        const w = (p.pence / total) * 100;
        const rect = svg('rect', { className: `stack-part ${hueClass(p.hue)}`, x, y: 0, width: Math.max(w - 0.5, 0.3), height: 6 });
        x += w;
        return rect;
      })),
    h('ul', { className: 'legend' }, parts.map((p) => h('li', null,
      h('span', { className: `dot ${hueClass(p.hue)}`, 'aria-hidden': 'true' }),
      h('span', { className: 'legend-name' }, p.name),
      h('span', { className: 'legend-value' }, formatPence(p.pence))))));
}

// Income, spending and saving, side by side for each month.
export function monthBars(series) {
  if (!series.length) return null;
  const W = 340, H = 150, BASE = 128, TOP = 8;
  const keys = [['income', 'Income', 0], ['spend', 'Spent', 1], ['saved', 'Saved', 2]];
  const max = Math.max(1, ...series.flatMap((m) => keys.map(([k]) => m[k])));
  const groupW = W / series.length, barW = Math.min(14, (groupW - 12) / 3);
  const label = (m) => monthName(m).slice(0, 3);
  return h('div', null,
    h('ul', { className: 'legend legend-row' }, keys.map(([, name, hue]) => h('li', null,
      h('span', { className: `dot ${hueClass(hue)}`, 'aria-hidden': 'true' }), h('span', { className: 'legend-name' }, name)))),
    svg('svg', { className: 'chart-bars', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Income, spending and saving by month' },
      svg('line', { className: 'grid', x1: 0, x2: W, y1: BASE, y2: BASE }),
      series.map((m, i) => {
        const cx = groupW * i + groupW / 2;
        return [
          keys.map(([k, name, hue], j) => {
            const height = Math.max(0, ((m[k] / max) * (BASE - TOP)));
            return svg('rect', { className: `bar-v ${hueClass(hue)}`, x: cx - (3 * barW + 4) / 2 + j * (barW + 2), y: BASE - height, width: barW, height, rx: 2 },
              svg('title', null, `${label(m.month)} ${name}: ${formatPence(m[k])}`));
          }),
          svg('text', { className: 'axis', x: cx, y: H - 6, 'text-anchor': 'middle' }, label(m.month)),
        ];
      })),
    h('details', { className: 'more' },
      h('summary', null, h('span', null, 'Show as a table')),
      h('table', { className: 'data' },
        h('thead', null, h('tr', null, ['Month', 'Income', 'Spent', 'Saved'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, series.map((m) => h('tr', null, h('td', null, label(m.month)),
          h('td', null, pounds(m.income)), h('td', null, pounds(m.spend)), h('td', null, pounds(m.saved))))))));
}

// How spending built up through the month, against last month.
export function paceChart(pace) {
  if (!pace.current.length) return null;
  const W = 340, H = 140, BASE = 118, TOP = 8, LEFT = 4, RIGHT = 336;
  const max = Math.max(1, pace.projected ?? 0, ...pace.current, ...(pace.previous ?? []));
  const x = (d) => LEFT + (d / Math.max(1, pace.days - 1)) * (RIGHT - LEFT);
  const y = (v) => BASE - (v / max) * (BASE - TOP);
  const path = (values) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const lastI = pace.current.length - 1;
  return h('div', null,
    h('ul', { className: 'legend legend-row' },
      h('li', null, h('span', { className: 'dot s2', 'aria-hidden': 'true' }), h('span', { className: 'legend-name' }, 'This month')),
      pace.previous && h('li', null, h('span', { className: 'dot s-none', 'aria-hidden': 'true' }), h('span', { className: 'legend-name' }, 'Last month'))),
    svg('svg', { className: 'chart-bars', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Spending through the month' },
      svg('line', { className: 'grid', x1: 0, x2: W, y1: BASE, y2: BASE }),
      pace.previous && svg('path', { className: 'pace-prev', d: path(pace.previous) }),
      svg('path', { className: 'pace-now', d: path(pace.current), pathLength: 100 }),
      svg('circle', { className: 'pace-dot', cx: x(lastI), cy: y(pace.current[lastI]), r: 4.5 }),
      svg('text', { className: 'axis', x: LEFT, y: H - 6 }, '1st'),
      svg('text', { className: 'axis', x: RIGHT, y: H - 6, 'text-anchor': 'end' }, `${pace.days}th`)));
}

// A ranked list with bars, in one colour.
export function rankBars(items, hue = 0) {
  const max = Math.max(1, ...items.map((i) => i.pence));
  return h('ul', { className: 'rank' }, items.map((i) => h('li', null,
    h('div', { className: 'bar-head' }, h('span', null, i.name), h('span', { className: 'money' }, pounds(i.pence))),
    svg('svg', { className: 'bar-track', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      svg('rect', { className: `bar-h ${hueClass(hue)}`, width: Math.max((i.pence / max) * 100, 1), height: 8, rx: 1 })))));
}

// The story in sentences, grouped, with an icon and a word on each group.
export function highlightGroups(highlights, makeTag) {
  const group = (icon, title, className, items) => items.length > 0 && h('div', { className: `story ${className}` },
    h('h3', null, h('span', { 'aria-hidden': 'true' }, `${icon} `), title),
    h('ul', null, items.map((i) => h('li', null, i.text, i.label === 'estimate' && makeTag(i.label)))));
  return h('div', { className: 'stories' },
    group('✓', 'Going well', 'story-good', highlights.wins),
    group('⚠', 'Worth watching', 'story-watch', highlights.watch),
    group('→', 'What to do next', 'story-next', highlights.next),
    h('p', { className: 'muted story-note' }, 'Figures are calculated from your statements, unless marked estimate.'));
}
