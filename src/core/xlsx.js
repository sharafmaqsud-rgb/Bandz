// Writes a real .xlsx file on this device, with no library. An Excel file is a zip of XML
// files, and files may be stored in a zip uncompressed, which keeps this short.
//
// A cell is a string, a number, null, or { v, f, style }, where f is a formula and v the value
// it was last calculated as. Text is always stored as text and never as a formula, so a
// merchant name such as "=SUM(A1)" cannot run when the file is opened.

const STYLE = { plain: 0, bold: 1, money: 2, moneyBold: 3, date: 4, title: 5, percent: 6, moneyTotal: 7, section: 8, note: 9 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;£&quot;#,##0.00;[Red]\\-&quot;£&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="dd\\ mmm\\ yyyy"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF3F4E5C"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B6A66"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF566878"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

const escapeXml = (s) => String(s)
  // Control characters are not allowed in XML at all, so a stray one must not corrupt the file.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const columnName = (i) => {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

function cellXml(cell, ref) {
  if (cell === null || cell === undefined || cell === '') return '';
  const obj = typeof cell === 'object' ? cell : { v: cell };
  const s = STYLE[obj.style ?? 'plain'];
  const styleAttr = s ? ` s="${s}"` : '';
  if (obj.f) {
    const isText = typeof obj.v === 'string';
    return `<c r="${ref}"${styleAttr}${isText ? ' t="str"' : ''}><f>${escapeXml(obj.f)}</f><v>${escapeXml(obj.v ?? 0)}</v></c>`;
  }
  if (typeof obj.v === 'number') return `<c r="${ref}"${styleAttr}><v>${obj.v}</v></c>`;
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(obj.v)}</t></is></c>`;
}

function sheetXml({ rows, widths = [], frozenRows = 0 }) {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const views = frozenRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${frozenRows}" topLeftCell="A${frozenRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const body = rows.map((row, r) => {
    const cells = (row ?? []).map((c, i) => cellXml(c, `${columnName(i)}${r + 1}`)).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${views}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

// ---------- A minimal zip file ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  // A fixed timestamp, so the same data always gives an identical file.
  const header = (sig, name, data, crc, extra = []) => {
    const size = data.length;
    return [new Uint8Array([sig & 255, (sig >> 8) & 255, (sig >> 16) & 255, (sig >>> 24) & 255]),
      ...extra, u16(20), u16(0x0800), u16(0), u16(0), u16(0x5821), u32(crc), u32(size), u32(size), u16(name.length), u16(0)];
  };
  function u16(n) { return new Uint8Array([n & 255, (n >> 8) & 255]); }
  function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  for (const { name, content } of files) {
    const nameBytes = enc.encode(name), data = enc.encode(content), crc = crc32(data);
    const local = [...header(0x04034b50, nameBytes, data, crc), nameBytes, data];
    const centralEntry = [...header(0x02014b50, nameBytes, data, crc, [u16(20)]), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes];
    chunks.push(...local);
    central.push(...centralEntry);
    offset += local.reduce((t, p) => t + p.length, 0);
  }
  const centralSize = central.reduce((t, p) => t + p.length, 0);
  const end = [new Uint8Array([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0)];
  const all = [...chunks, ...central, ...end];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// sheets: [{ name, rows, widths, frozenRows }]. Returns the .xlsx file as bytes.
export function buildXlsx(sheets) {
  const overrides = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) })),
  ];
  return zipStored(files);
}
