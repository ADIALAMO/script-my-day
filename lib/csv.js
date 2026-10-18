/**
 * Minimal CSV writer for admin exports (RFC 4180 quoting, CRLF lines, UTF-8 BOM so Excel opens Hebrew correctly).
 * Formula injection: a text cell that a spreadsheet could evaluate (starts with = + - @, TAB or CR — also after leading whitespace) gets a single quote in front.
 */
export const CSV_BOM = '﻿';
const FORMULA_START = /^(?:[=+\-@\t\r]|\s+[=+\-@])/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: string[] (header = keys); rows: objects. Returns BOM + header + rows, every line ended by CRLF. */
export function toCsv(columns, rows) {
  const lines = [columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))];
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}
