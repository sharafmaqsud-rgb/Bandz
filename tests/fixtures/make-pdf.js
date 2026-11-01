// Writes a tiny real PDF containing text at exact positions, so tests can run the same
// path as a bank statement: PDF bytes, through pdf.js, into the parsers. It uses Helvetica
// because pdf.js splits fixed-width fonts at every space. The width here is only an
// average, used to right-align columns, which is close enough for the parsers' tolerances.

const CHAR_WIDTH = 0.52;
export const FONT_SIZE = 7;
export const textWidth = (s) => s.length * CHAR_WIDTH * FONT_SIZE;

const escapePdf = (s) => s.replace(/[\\()]/g, '\\$&');

// pages: [[{ x, y, s }, ...], ...]. Returns the file as a Uint8Array.
export function makePdf(pages) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // the page tree, filled in once the page numbers are known
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = pages.map((items) => {
    const stream = items
      .map((c) => `BT /F1 ${FONT_SIZE} Tf ${c.x} ${c.y} Td (${escapePdf(c.s)}) Tj ET`)
      .join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R `
      + `/Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0)); // one byte per character keeps the £ intact
}
