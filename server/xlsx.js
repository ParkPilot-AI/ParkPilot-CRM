'use strict';
// Minimal, dependency-free .xlsx reader: enough to read the first visible sheet of an export.
const zlib = require('node:zlib');

function unzip(buf) {
  // Locate the End Of Central Directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (zip directory missing).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt .xlsx (bad central directory).');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    files[name.replace(/^\//, '')] = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

// Text of all <t> elements inside a fragment (handles rich text runs and namespace prefixes).
function textOf(fragment) {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m; while ((m = re.exec(fragment))) out += decode(m[1]);
  return out;
}

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolveTarget(target) {
  let t = target.replace(/^\//, '');
  if (!t.startsWith('xl/')) t = 'xl/' + t;
  return t;
}

function readFirstSheet(buf) {
  const files = unzip(buf);
  const str = name => files[name] ? files[name].toString('utf8') : '';
  const wb = str('xl/workbook.xml');
  const rels = str('xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1]), target = /\bTarget="([^"]+)"/.exec(m[1]);
    if (id && target) relMap[id[1]] = resolveTarget(target[1]);
  }
  let sheetPath = null, sheetName = '';
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    if (/state="(hidden|veryHidden)"/.test(attrs)) continue;
    const rid = /r:id="([^"]+)"/.exec(attrs);
    sheetName = (/name="([^"]+)"/.exec(attrs) || [])[1] || '';
    if (rid && relMap[rid[1]]) { sheetPath = relMap[rid[1]]; break; }
  }
  if (!sheetPath) sheetPath = Object.keys(files).find(f => /^xl\/worksheets\/[^/]+\.xml$/.test(f));
  if (!sheetPath || !files[sheetPath]) throw new Error('Could not find a worksheet in this file.');

  const shared = [];
  const ss = str('xl/sharedStrings.xml');
  for (const m of ss.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(textOf(m[1]));

  const xml = files[sheetPath].toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
      const idx = ref ? colIndex(ref) : row.length;
      let v = null;
      const vm = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
      if (t === 'inlineStr') v = textOf(body);
      else if (t === 's') v = vm ? shared[+vm[1]] ?? '' : '';
      else if (t === 'str' || t === 'e') v = vm ? decode(vm[1]) : '';
      else if (t === 'b') v = vm ? vm[1] === '1' : null;
      else if (vm) v = Number(vm[1]);
      row[idx] = v;
    }
    rows.push(row);
  }
  return { sheetName, rows };
}

// Excel serial date -> 'YYYY-MM-DDTHH:MM' (no time-zone shift: the export is already local time).
function serialToLocal(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const ms = Math.round((serial - 25569) * 864e5);
  return new Date(ms).toISOString().slice(0, 16);
}

// Small CSV parser (RFC 4180 quotes) so CSV exports can be imported too.
function readCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { sheetName: 'CSV', rows: rows.filter(r => r.some(c => c !== '')) };
}

module.exports = { readFirstSheet, serialToLocal, readCsv };
