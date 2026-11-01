// The PDF report: a designed summary of a period, with headline tiles, charts and the story in
// sentences. The exact statements are in the Excel workbook. Created on this device with no
// library, using fonts every PDF reader already has.
import { buildHighlights, pounds, topMerchants } from './highlights.js';
import { NEUTRAL, SERIES, toSlices } from './palette.js';
import { incomeStatement } from './statements.js';

const W = 595, H = 842, LEFT = 40, RIGHT = 555, BOTTOM = 62;
const INK = '#1B1B1A', MUTED = '#5C5B57', LINE = '#E6E5E0', BAND = '#3F6EA8';
const GOOD_BG = '#E7F4EF', WATCH_BG = '#FBF3E0', NEXT_BG = '#E9EFF7', TILE_BG = '#F5F4F1';

const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

// Helvetica's published character widths for codes 32 to 126, per 1000 units of font size, so
// text wraps and lines up exactly. Bold runs a little wider, which the margin below allows for.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const widthOf = (text, size) => [...text].reduce((t, c) => t + (HELVETICA[c.charCodeAt(0) - 32] ?? 556), 0) * size / 1000;

// PDF's built-in fonts only hold Western characters, so anything else becomes a plain stand-in.
const safe = (text) => String(text)
  .replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[^\x20-\x7E£]/g, '?');
const escapePdf = (s) => s.replace(/[\\()]/g, '\\$&');

function wrap(text, width, size) {
  const lines = [];
  let current = '';
  for (const word of safe(text).split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (widthOf(next, size) > width && current) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

class Doc {
  constructor(title, subtitle) {
    this.title = title;
    this.subtitle = subtitle;
    this.pages = [];
    this.newPage(true);
  }

  newPage(first = false) {
    this.ops = [];
    this.pages.push(this.ops);
    if (first) {
      this.rect(0, H - 104, W, 104, BAND);
      this.text(LEFT, H - 58, this.title, 26, 'F2', '#FFFFFF');
      this.text(LEFT, H - 82, this.subtitle, 13, 'F1', '#FFFFFF');
      this.y = H - 128;
    } else {
      this.text(LEFT, H - 44, this.title, 9, 'F1', MUTED);
      this.rightText(RIGHT, H - 44, this.subtitle, 9, 'F1', MUTED);
      this.y = H - 66;
    }
  }

  rect(x, y, w, h, colour) {
    this.ops.push(`${rgb(colour)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  text(x, y, s, size, font, colour) {
    this.ops.push(`BT /${font} ${size} Tf ${rgb(colour)} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(safe(s))}) Tj ET`);
  }

  rightText(edge, y, s, size, font, colour) {
    this.text(edge - widthOf(safe(s), size), y, s, size, font, colour);
  }

  ensure(space) {
    if (this.y - space < BOTTOM) this.newPage();
  }

  heading(s) {
    this.ensure(50);
    this.text(LEFT, this.y - 12, s, 14, 'F2', INK);
    this.y -= 26;
  }

  paragraph(s, size = 11, colour = INK) {
    for (const line of wrap(s, RIGHT - LEFT, size)) {
      this.ensure(size + 6);
      this.text(LEFT, this.y - size, line, size, 'F1', colour);
      this.y -= size + 4.5;
    }
    this.y -= 6;
  }

  tiles(items) {
    this.ensure(70);
    const gap = 10, w = (RIGHT - LEFT - gap * (items.length - 1)) / items.length, h = 58;
    items.forEach(([label, value], i) => {
      const x = LEFT + i * (w + gap);
      this.rect(x, this.y - h, w, h, TILE_BG);
      this.text(x + 10, this.y - 20, label, 9, 'F1', MUTED);
      this.text(x + 10, this.y - 42, value, 16, 'F2', INK);
    });
    this.y -= h + 18;
  }

  // Thick lines drawn in short steps make a ring, without needing any image.
  arc(cx, cy, r, from, to, colour, thickness) {
    const steps = Math.max(2, Math.ceil((to - from) * 60));
    const point = (a) => `${(cx + r * Math.sin(a * 2 * Math.PI)).toFixed(2)} ${(cy + r * Math.cos(a * 2 * Math.PI)).toFixed(2)}`;
    const path = [`${point(from)} m`];
    for (let i = 1; i <= steps; i++) path.push(`${point(from + ((to - from) * i) / steps)} l`);
    this.ops.push(`${rgb(colour)} RG ${thickness} w ${path.join(' ')} S`);
  }

  donut(lines, total) {
    const slices = toSlices(lines);
    const sum = slices.reduce((t, s) => t + s.pence, 0);
    if (!sum) { this.paragraph('No spending in this period.', 10, MUTED); return; }
    const size = 150;
    this.ensure(Math.max(size, slices.length * 19) + 10);
    const cx = LEFT + size / 2, cy = this.y - size / 2;
    let at = 0;
    slices.forEach((s) => {
      const share = s.pence / sum;
      this.arc(cx, cy, 58, at + 0.003, at + share - 0.003, s.hue < 0 ? NEUTRAL : SERIES[s.hue], 20);
      at += share;
    });
    const label = pounds(total);
    this.text(cx - widthOf(label, 15) / 2, cy - 5, label, 15, 'F2', INK);
    const lx = LEFT + size + 28;
    let ly = this.y - 14;
    for (const s of slices) {
      this.rect(lx, ly - 1, 9, 9, s.hue < 0 ? NEUTRAL : SERIES[s.hue]);
      this.text(lx + 16, ly, s.name, 10, 'F1', INK);
      this.rightText(RIGHT, ly, `${pounds(s.pence)}   ${Math.round((s.pence / sum) * 100)}%`, 10, 'F1', INK);
      ly -= 19;
    }
    this.y -= Math.max(size, slices.length * 19) + 16;
  }

  monthBars(series) {
    if (!series.length) return;
    const h = 120;
    this.ensure(h + 44);
    const keys = [['income', 'Income', 0], ['spend', 'Spent', 1], ['saved', 'Saved', 2]];
    let lx = LEFT;
    for (const [, name, hue] of keys) {
      this.rect(lx, this.y - 10, 9, 9, SERIES[hue]);
      this.text(lx + 13, this.y - 9, name, 9, 'F1', MUTED);
      lx += widthOf(name, 9) + 34;
    }
    this.y -= 18;
    const base = this.y - h;
    const max = Math.max(1, ...series.flatMap((m) => keys.map(([k]) => m[k])));
    const groupW = (RIGHT - LEFT) / series.length;
    const barW = Math.min(20, (groupW - 16) / 3);
    this.rect(LEFT, base - 0.5, RIGHT - LEFT, 0.7, LINE);
    series.forEach((m, i) => {
      const cx = LEFT + groupW * i + groupW / 2;
      keys.forEach(([k, , hue], j) => {
        const bh = (m[k] / max) * (h - 14);
        if (bh > 0) this.rect(cx - (3 * barW + 4) / 2 + j * (barW + 2), base, barW, bh, SERIES[hue]);
      });
      const label = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m.month}-01T00:00:00Z`));
      this.text(cx - widthOf(label, 9) / 2, base - 13, label, 9, 'F1', MUTED);
    });
    this.y = base - 28;
  }

  storyBlock(title, background, items) {
    if (!items.length) return;
    const size = 10.5, lead = 15;
    const prepared = items.map((i) => wrap(`${i.text}${i.label === 'estimate' ? ' (estimate)' : ''}`, RIGHT - LEFT - 36, size));
    const height = 34 + prepared.reduce((t, l) => t + l.length * lead + 5, 0);
    this.ensure(height + 10);
    this.rect(LEFT, this.y - height, RIGHT - LEFT, height, background);
    this.text(LEFT + 12, this.y - 22, title, 12, 'F2', INK);
    let y = this.y - 42;
    for (const lines of prepared) {
      this.text(LEFT + 14, y, '-', size, 'F1', MUTED);
      for (const line of lines) {
        this.text(LEFT + 24, y, line, size, 'F1', INK);
        y -= lead;
      }
      y -= 5;
    }
    this.y -= height + 12;
  }

  rankList(items) {
    if (!items.length) return;
    const max = Math.max(1, ...items.map((i) => i.pence));
    for (const i of items) {
      this.ensure(30);
      this.text(LEFT, this.y - 10, i.name, 10, 'F1', INK);
      this.rightText(RIGHT, this.y - 10, pounds(i.pence), 10, 'F1', INK);
      this.rect(LEFT, this.y - 20, RIGHT - LEFT, 5, TILE_BG);
      this.rect(LEFT, this.y - 20, Math.max(2, (i.pence / max) * (RIGHT - LEFT)), 5, SERIES[0]);
      this.y -= 29;
    }
    this.y -= 6;
  }

  bytes() {
    const total = this.pages.length;
    this.pages.forEach((ops, i) => {
      const label = `Page ${i + 1} of ${total}`;
      ops.push(`BT /F1 9 Tf ${rgb(MUTED)} rg ${(RIGHT - widthOf(label, 9)).toFixed(2)} 34 Td (${label}) Tj ET`);
      ops.push(`BT /F1 9 Tf ${rgb(MUTED)} rg ${LEFT} 34 Td (Calculated from your own statements, on your device) Tj ET`);
    });
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = this.pages.map((ops) => {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${content} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`);
    });
    objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets = objects.map((body, i) => {
      const at = out.length;
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
      return at;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(out, (c) => c.charCodeAt(0)); // one byte per character keeps the £ intact
  }
}

export function buildReportPdf(state, period) {
  const doc = new Doc('Your money', period.label);
  const story = buildHighlights(state, period);
  const k = story.kpis;
  const income = incomeStatement(state, period);

  doc.paragraph(story.headline, 12.5);
  doc.tiles([
    ['Spent', pounds(k.spend)],
    ['Saved and invested', pounds(k.saved)],
    ['Savings rate', k.savingsRate === null ? 'n/a' : `${Math.round(k.savingsRate * 100)}%`],
    ['Net worth', pounds(k.netWorth)],
  ]);
  doc.heading('Where it went');
  doc.donut([...income.essential, ...income.other], k.spend);
  doc.heading('The last six months');
  doc.monthBars(story.series);

  doc.newPage();
  doc.heading('The story');
  doc.storyBlock('Going well', GOOD_BG, story.wins);
  doc.storyBlock('Worth watching', WATCH_BG, story.watch);
  doc.storyBlock('What to do next', NEXT_BG, story.next);
  const merchants = topMerchants(state, period);
  if (merchants.length) {
    doc.heading('Biggest merchants');
    doc.rankList(merchants);
  }
  doc.paragraph('The exact figures are in the Excel workbook. Figures marked (estimate) assume something continues, and everything else is calculated.', 9, MUTED);
  return doc.bytes();
}
