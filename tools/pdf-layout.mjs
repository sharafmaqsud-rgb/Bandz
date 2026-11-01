// Prints a masked map of a PDF statement: where each piece of text sits on the page,
// with its contents hidden by mask.js. Used only to design importers.
//
//   node tools/pdf-layout.mjs statement.pdf
import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { maskText } from './mask.js';

const doc = await getDocument({
  data: new Uint8Array(readFileSync(process.argv[2])),
  isEvalSupported: false,
  verbosity: 0,
}).promise;

console.log(`pages: ${doc.numPages}`);
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const { width, height } = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  console.log(`\n--- page ${p} (${Math.round(width)}x${Math.round(height)}) ---`);
  const lines = new Map();
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({ x: Math.round(it.transform[4]), w: Math.round(it.width), s: maskText(it.str.trim()) });
  }
  for (const y of [...lines.keys()].sort((a, b) => b - a)) {
    const cells = lines.get(y).sort((a, b) => a.x - b.x).map((c) => `${c.x}+${c.w}:${c.s}`);
    console.log(`y${y} ${cells.join(' | ')}`);
  }
}
