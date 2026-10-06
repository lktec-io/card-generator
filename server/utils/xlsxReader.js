'use strict';

/**
 * Minimal, read-only .xlsx reader — no third-party dependency.
 *
 * An .xlsx file is a ZIP archive of XML parts. We only need three of them:
 *   xl/workbook.xml          which sheets exist, and in what order
 *   xl/_rels/workbook.xml.rels   where each sheet's XML actually lives
 *   xl/sharedStrings.xml     the string table most text cells point into
 *
 * Why hand-rolled instead of a library: this runs on a live production API.
 * The popular npm spreadsheet readers are large, carry open advisories, or pull
 * dozens of transitive packages. Reading a guest list needs none of that — the
 * subset below is small enough to audit in one sitting and has no dependencies.
 *
 * Deliberately NOT supported (and reported as a clear error, never guessed):
 *   - ZIP64 archives, encrypted/password-protected workbooks
 *   - the legacy binary .xls format
 *
 * Hardened against hostile uploads: a per-entry uncompressed size ceiling (zip
 * bombs), a row ceiling, and a column ceiling. Every limit raises an Error with
 * a message safe to show a user.
 */

const zlib = require('zlib');

// ── limits ──────────────────────────────────────────────────────────────────
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;  // uncompressed, per ZIP entry
const MAX_ROWS        = 5000;              // rows read from a sheet
const MAX_COLS        = 64;                // columns read per row
const MAX_CELL_CHARS  = 500;               // a single cell's text

// ── ZIP ─────────────────────────────────────────────────────────────────────

const SIG_EOCD = 0x06054b50;
const SIG_CD   = 0x02014b50;

/**
 * Index a ZIP archive's central directory.
 * The central directory is authoritative: writers that stream their output
 * leave the sizes in the local headers set to zero, so those cannot be trusted.
 *
 * @returns {Map<string, {method:number, csize:number, usize:number, offset:number}>}
 */
function readZipIndex(buf) {
  // The end-of-central-directory record sits at the very end, after an optional
  // comment, so scan backwards for its signature.
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 66 * 1024);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (no ZIP end record found).');

  const count  = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff  = buf.readUInt32LE(eocd + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    throw new Error('This .xlsx uses the ZIP64 format, which is not supported. Re-save it as a normal .xlsx or .csv file.');
  }

  const entries = new Map();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) {
      throw new Error('This .xlsx file appears to be damaged. Re-save it and try again.');
    }
    const method  = buf.readUInt16LE(p + 10);
    const csize   = buf.readUInt32LE(p + 20);
    const usize   = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extLen  = buf.readUInt16LE(p + 30);
    const cmtLen  = buf.readUInt16LE(p + 32);
    const offset  = buf.readUInt32LE(p + 42);
    const name    = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    entries.set(name, { method, csize, usize, offset });
    p += 46 + nameLen + extLen + cmtLen;
  }
  return entries;
}

/** Inflate one ZIP entry to a string. Returns null when the part is absent. */
function readZipEntry(buf, entries, name) {
  const e = entries.get(name);
  if (!e) return null;

  if (e.usize > MAX_ENTRY_BYTES) {
    throw new Error('This spreadsheet is too large to process. Keep it under 5000 rows.');
  }
  // The local header's extra field can differ in length from the central one,
  // so the data offset has to be computed from the local header itself.
  const lh = e.offset;
  if (lh + 30 > buf.length) throw new Error('This .xlsx file appears to be damaged.');
  const nameLen = buf.readUInt16LE(lh + 26);
  const extLen  = buf.readUInt16LE(lh + 28);
  const start   = lh + 30 + nameLen + extLen;
  const data    = buf.slice(start, start + e.csize);

  if (e.method === 0) return data.toString('utf8');
  if (e.method === 8) {
    const out = zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    return out.toString('utf8');
  }
  throw new Error('This .xlsx uses an unsupported compression method. Re-save it as .xlsx or .csv.');
}

// ── XML ─────────────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  if (!s || s.indexOf('&') === -1) return s || '';
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X'
        ? parseInt(g.slice(2), 16)
        : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g] ?? m;
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
}

/** "BC" → 54 (0-based column index). */
function colIndex(ref) {
  const letters = String(ref || '').match(/^([A-Z]+)/i);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The shared string table. Each <si> may be one <t>, or several <r><t> runs
 * (Excel splits a cell whenever part of its text is formatted differently) —
 * the runs are concatenated so "John Doe" does not come back as "John".
 */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1] || '';
    let text = '';
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let t;
    while ((t = tRe.exec(inner)) !== null) text += decodeXml(t[1] || '');
    out.push(text.slice(0, MAX_CELL_CHARS));
  }
  return out;
}

/** First sheet's part name, following the workbook → rels indirection. */
function firstSheetPath(workbookXml, relsXml) {
  const sheet = workbookXml && workbookXml.match(/<sheet(\s[^>]*)\/?>/);
  const rid   = sheet ? attr(sheet[1], 'r:id') : null;

  if (rid && relsXml) {
    const re = /<Relationship(\s[^>]*)\/?>/g;
    let m;
    while ((m = re.exec(relsXml)) !== null) {
      if (attr(m[1], 'Id') === rid) {
        const target = attr(m[1], 'Target');
        if (target) {
          const clean = target.replace(/^\/?xl\//, '').replace(/^\//, '');
          return `xl/${clean}`;
        }
      }
    }
  }
  return 'xl/worksheets/sheet1.xml';   // overwhelmingly the real answer anyway
}

/**
 * Sheet XML → array of row arrays of strings.
 * Cells are placed by their own r="B7" reference, so blank cells in the middle
 * of a row keep the remaining values in the right columns.
 */
function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rm;

  while ((rm = rowRe.exec(xml)) !== null) {
    if (rows.length >= MAX_ROWS) {
      throw new Error(`This spreadsheet has more than ${MAX_ROWS} rows. Split it into smaller files.`);
    }
    const row = [];
    const cellRe = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let auto = 0;

    while ((cm = cellRe.exec(rm[1])) !== null) {
      const tag   = cm[1] || '';
      const inner = cm[2] || '';
      const ref   = attr(tag, 'r');
      const type  = attr(tag, 't') || 'n';

      let at = ref ? colIndex(ref) : -1;
      if (at < 0) at = auto;
      auto = at + 1;
      if (at >= MAX_COLS) continue;

      let value = '';
      if (type === 's') {
        const vm = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        const idx = vm ? parseInt(decodeXml(vm[1]), 10) : NaN;
        value = Number.isInteger(idx) && shared[idx] != null ? shared[idx] : '';
      } else if (type === 'inlineStr') {
        const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(inner)) !== null) value += decodeXml(t[1] || '');
      } else if (type === 'b') {
        const vm = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        value = vm && vm[1].trim() === '1' ? 'TRUE' : 'FALSE';
      } else if (type === 'e') {
        value = '';                      // #N/A and friends → treat as empty
      } else {
        // numbers, dates and cached formula results all arrive in <v>
        const vm = inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        value = vm ? decodeXml(vm[1]).trim() : '';
      }

      row[at] = String(value).slice(0, MAX_CELL_CHARS);
    }

    for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
    rows.push(row);
  }
  return rows;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Read the first worksheet of an .xlsx buffer.
 * @param {Buffer} buf
 * @returns {string[][]} rows of trimmed cell text, blank trailing rows removed
 */
function readXlsx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) {
    throw new Error('The uploaded file is empty.');
  }
  // "PK\x03\x04" — every .xlsx starts with it; .xls (old binary) does not
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    throw new Error('This is not an .xlsx file. The old .xls format is not supported — re-save it as .xlsx or .csv.');
  }

  const entries = readZipIndex(buf);
  if (entries.has('EncryptedPackage')) {
    throw new Error('This workbook is password-protected. Remove the password and upload it again.');
  }

  const shared = parseSharedStrings(readZipEntry(buf, entries, 'xl/sharedStrings.xml'));
  const path   = firstSheetPath(
    readZipEntry(buf, entries, 'xl/workbook.xml'),
    readZipEntry(buf, entries, 'xl/_rels/workbook.xml.rels')
  );

  const sheetXml = readZipEntry(buf, entries, path)
                || readZipEntry(buf, entries, 'xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('No worksheet found in this .xlsx file.');

  const rows = parseSheet(sheetXml, shared).map((r) => r.map((c) => String(c).trim()));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

// ── CSV (same shape out, so callers treat both the same) ────────────────────

/** RFC-4180-ish: quoted fields, "" escapes, comma or semicolon separated. */
function readCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  // Excel in a European locale writes semicolons; pick whichever the header uses
  const head = src.slice(0, src.search(/\r?\n/) + 1 || src.length);
  const sep  = (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [], cell = '', quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(cell); cell = '';
      rows.push(row); row = [];
      if (rows.length > MAX_ROWS) throw new Error(`This file has more than ${MAX_ROWS} rows. Split it into smaller files.`);
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const out = rows.map((r) => r.slice(0, MAX_COLS).map((c) => String(c).trim().slice(0, MAX_CELL_CHARS)));
  while (out.length && out[out.length - 1].every((c) => !c)) out.pop();
  return out;
}

/** Dispatch on the bytes, not on the file name. */
function readSpreadsheet(buf, filename = '') {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('The uploaded file is empty.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);

  // Old binary .xls starts with the OLE2 magic — rejected with a clear message
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new Error('The old .xls format is not supported. Open it in Excel and save as .xlsx or .csv.');
  }
  if (/\.xlsx?$/i.test(filename) && buf[0] !== 0x50) {
    throw new Error('This file is named like a spreadsheet but is not one. Re-save it as .xlsx or .csv.');
  }
  return readCsv(buf.toString('utf8'));
}

module.exports = { readSpreadsheet, readXlsx, readCsv, MAX_ROWS };
