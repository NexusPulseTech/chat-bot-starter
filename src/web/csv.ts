/**
 * CSV export that opens correctly in Excel and Google Sheets.
 *
 * - A UTF-8 byte order mark makes Excel read Vietnamese accents correctly.
 * - Fields with commas, quotes or line breaks are quoted.
 * - Fields starting with =, +, - or @ are prefixed with a quote, because a
 *   spreadsheet would otherwise run them as formulas. Customer input goes into
 *   these files, and "=HYPERLINK(...)" in a name is a known attack.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: string | number): string {
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
