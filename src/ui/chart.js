// A line chart for net worth, drawn as SVG with one axis. The readout above it names the
// point under your finger or pointer, and a plain table holds the same numbers.
import { formatPence } from '../core/money.js';
import { fullDate, h, svg } from './dom.js';

const H = 170;
const PAD = { left: 8, right: 8, top: 10, bottom: 20 };

const compact = (pence) => {
  const pounds = pence / 100;
  return Math.abs(pounds) >= 1000 ? `£${(pounds / 1000).toFixed(pounds >= 100000 ? 0 : 1)}k` : `£${Math.round(pounds)}`;
};

export function lineChart(points, label) {
  // Drawn wider on wide screens, rather than scaled up, so the text stays a normal size.
  const W = window.innerWidth >= 900 ? 860 : 340;
  const times = points.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const values = points.map((p) => p.pence);
  const low = Math.min(...values), high = Math.max(...values);
  const margin = Math.max((high - low) * 0.15, 1); // a flat line still gets some height
  const x0 = times[0], x1 = times[times.length - 1];
  const x = (t) => PAD.left + ((t - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (v - (low - margin)) / (high - low + 2 * margin)) * (H - PAD.top - PAD.bottom);

  const coords = points.map((p, i) => ({ x: x(times[i]), y: y(values[i]), ...p }));
  const last = coords[coords.length - 1];
  const readout = h('div', { className: 'chart-readout', 'aria-live': 'off' });
  const show = (c) => { readout.textContent = `${fullDate(c.date)}: ${formatPence(c.pence)}`; };
  show(last);

  const cross = svg('line', { className: 'cross', x1: last.x, x2: last.x, y1: PAD.top, y2: H - PAD.bottom });
  const dot = svg('circle', { className: 'point', cx: last.x, cy: last.y, r: 5 });
  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const c = coords.reduce((best, p) => (Math.abs(p.x - px) < Math.abs(best.x - px) ? p : best));
    cross.setAttribute('x1', c.x);
    cross.setAttribute('x2', c.x);
    dot.setAttribute('cx', c.x);
    dot.setAttribute('cy', c.y);
    show(c);
  };

  return h('div', null,
    readout,
    svg('svg', {
      className: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label,
      onPointerMove: move, onPointerDown: move,
    },
    [high, low].map((v) => [
      svg('line', { className: 'grid', x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v) }),
      svg('text', { x: PAD.left, y: y(v) - 4 }, compact(v)),
    ]),
    svg('path', { className: 'area', d: `${coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')} L${last.x.toFixed(1)} ${H - PAD.bottom} L${coords[0].x.toFixed(1)} ${H - PAD.bottom} Z` }),
    svg('path', { className: 'line', d: coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ') }),
    cross, dot,
    svg('text', { x: PAD.left, y: H - 5 }, fullDate(points[0].date)),
    svg('text', { x: W - PAD.right, y: H - 5, 'text-anchor': 'end' }, fullDate(last.date))),
    h('details', { className: 'more' },
      h('summary', null, h('span', null, 'Show as a table')),
      h('table', { className: 'data' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Net worth'))),
        h('tbody', null, [...points].reverse().map((p) => h('tr', null, h('td', null, fullDate(p.date)), h('td', null, formatPence(p.pence))))))));
}
