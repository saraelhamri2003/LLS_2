// Reads an uploaded file and returns what the app understood from it.
// CSV and Excel are calculated by code (no AI): rows, columns, and for each
// numeric column the first and last value, min, max, average and the change.
// PDF, Word and images are stored; reading them with Gemini comes later.
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';

export const ALLOWED = {
  '.csv': 'csv', '.txt': 'csv',
  '.xlsx': 'excel', '.xlsm': 'excel',
  '.pdf': 'pdf',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image',
  '.docx': 'doc'
};

export const fileKind = (name) => ALLOWED[path.extname(name || '').toLowerCase()] || null;

// "3,2" (French decimal), "3.2%", " 1 250 " -> number; anything else -> null
const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value.result !== undefined) return toNumber(value.result); // Excel formula
  let text = String(value).trim().replace(/\s| /g, '').replace(/%$/, '');
  if (!text) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.'); // 1.250,5
  else if (/^-?\d+,\d+$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  return /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text) ? Number(text) : null;
};

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.richText) return value.richText.map((r) => r.text).join('');
  }
  return String(value);
};

const round = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

function summarizeTable(header, rows) {
  const columns = header.map((h, i) => String(h || '').trim() || `Column ${i + 1}`);
  const numeric = [];
  columns.forEach((name, i) => {
    const values = rows.map((r) => toNumber(r[i])).filter((v) => v !== null);
    const filled = rows.filter((r) => cellText(r[i]).trim() !== '').length;
    if (values.length < 2 || values.length < filled * 0.8) return; // mostly text -> not a measure
    const first = values[0];
    const last = values[values.length - 1];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    numeric.push({
      name,
      n: values.length,
      first: round(first),
      last: round(last),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
      mean: round(mean),
      changePct: first !== 0 ? round(((last - first) / Math.abs(first)) * 100) : null
    });
  });
  // the first text column is usually the period (week, month, date)
  const labelIdx = columns.findIndex((_, i) => !numeric.some((c) => c.name === columns[i]));
  const period = labelIdx >= 0 && rows.length
    ? { column: columns[labelIdx], from: cellText(rows[0][labelIdx]), to: cellText(rows[rows.length - 1][labelIdx]) }
    : null;
  return {
    rows: rows.length,
    columns,
    numeric,
    period,
    preview: rows.slice(0, 5).map((r) => columns.map((_, i) => cellText(r[i])))
  };
}

async function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
  const parsed = Papa.parse(text, { skipEmptyLines: true });
  const [header = [], ...rows] = parsed.data;
  return summarizeTable(header, rows);
}

async function readExcel(filePath) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(filePath);
  const sheet = book.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) return { rows: 0, columns: [], numeric: [], period: null, preview: [] };
  const all = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1); // exceljs rows start at index 1
    all.push(values.map((v) => (v && typeof v === 'object' && !(v instanceof Date) && v.result !== undefined ? v.result : v)));
  });
  const [header = [], ...rows] = all;
  const summary = summarizeTable(header.map(cellText), rows);
  return { ...summary, sheet: sheet.name, sheets: book.worksheets.length };
}

export async function readFile(filePath, kind) {
  try {
    if (kind === 'csv') return { status: 'read', ...(await readCsv(filePath)) };
    if (kind === 'excel') return { status: 'read', ...(await readExcel(filePath)) };
    return { status: 'stored' }; // PDF, Word, images: kept as proof, read later with Gemini
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}
