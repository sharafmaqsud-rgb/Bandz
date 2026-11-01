// A small CSV reader. Handles what bank exports really contain: a byte-order mark,
// Windows line endings, quoted fields with commas or newlines, and "" inside quotes.
import { FormatError } from './money.js';

function parseRecords(text) {
  const records = [];
  let record = [], field = '', inQuotes = false;
  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(record); record = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') endField();
    else if (c === '\n') endRecord();
    else if (c !== '\r') field += c;
  }
  if (inQuotes) throw new FormatError('This CSV has an unclosed quote, so it may be cut off.');
  if (field !== '' || record.length) endRecord();
  return records;
}

// Returns { headers, rows }, where each row is an object keyed by trimmed header.
// Short rows get '' for missing columns; extra columns are ignored; blank lines are skipped.
export function parseCsv(text) {
  const records = parseRecords(String(text).replace(/^﻿/, ''))
    .filter((r) => r.some((f) => f.trim() !== ''));
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { headers, rows };
}
