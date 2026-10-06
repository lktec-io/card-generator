'use strict';

/**
 * Guest-list validation for the bulk card import.
 *
 * One place decides what a valid row is, so the preview the user approves and the
 * rows that actually get generated can never disagree. The frontend only displays
 * what this module returns.
 *
 * Expected columns (any capitalisation, any order):  name | phone | type
 *
 * CN is NOT accepted from the file — codes come from the existing
 * utils/codeGenerator.js at insert time. A `cn`/`code` column is ignored on purpose.
 */

const MAX_GUESTS   = 1000;   // hard ceiling for one bulk generation run
const MAX_NAME_LEN = 100;    // invitations.guest_name

// Header synonyms. Matched against a squashed, lower-cased header cell.
const HEADERS = {
  name:  ['name', 'guestname', 'guest', 'fullname', 'jina', 'jinalamgeni', 'mgeni'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'tel', 'telephone', 'simu', 'namba', 'nambayasimu'],
  type:  ['type', 'cardtype', 'invitationtype', 'aina', 'ainayamualiko'],
};

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

/** Collapse runs of whitespace; leave the guest's own capitalisation alone. */
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Keep the number in the shape the rest of the system already stores
 * (BeemProvider converts 0754… → 255754… at send time, so no conversion here).
 * Only formatting characters are removed, plus one real-world Excel repair:
 * a phone typed into a *numeric* cell loses its leading zero, so 712345678
 * comes back as nine digits and is restored to 0712345678.
 */
function cleanPhone(raw) {
  let p = String(raw || '').trim();
  if (!p) return '';
  if (/e\+?\d+$/i.test(p)) return p;                       // 7.12346E+08 — unusable, caught below
  const plus = p.startsWith('+');
  p = p.replace(/[^\d]/g, '');
  if (!p) return '';
  if (!plus && p.length === 9 && p[0] !== '0') p = `0${p}`;  // Excel ate the leading zero
  return plus ? `+${p}` : p;
}

const digitsOf = (p) => String(p || '').replace(/\D/g, '');

/**
 * Canonical form used ONLY to compare two numbers (never stored).
 *
 * The same guest's phone is written several ways across the system —
 * 0712345678 in a spreadsheet, 255712345678 after a Beem send, +255712345678
 * when typed by hand — so comparing the raw strings would miss a guest who
 * already has an invitation and let a re-import duplicate them. The last nine
 * digits are the part that actually identifies a Tanzanian line.
 */
const phoneKey = (p) => {
  const d = digitsOf(p);
  return d.length > 9 ? d.slice(-9) : d;
};

/** 'Double' | 'double' | ' DOUBLE ' → 'double'; anything else → null. */
function normaliseType(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (t === 'single' || t === 'double') return t;
  return null;
}

/**
 * Locate the header row. Real files often have a title line above it (seen in
 * the wild: row 1 is a merged banner, row 2 holds the headers), so the first
 * rows are scanned rather than assuming row 1.
 *
 * @returns {{ index:number, cols:{name:number, phone:number, type:number} } | null}
 */
function findHeader(rows) {
  const limit = Math.min(rows.length, 10);
  for (let r = 0; r < limit; r++) {
    const cols = { name: -1, phone: -1, type: -1 };
    rows[r].forEach((cell, c) => {
      const key = squash(cell);
      if (!key) return;
      for (const field of ['name', 'phone', 'type']) {
        if (cols[field] === -1 && HEADERS[field].includes(key)) cols[field] = c;
      }
    });
    if (cols.name !== -1 && (cols.phone !== -1 || cols.type !== -1)) {
      return { index: r, cols };
    }
  }
  return null;
}

/**
 * Validate a parsed sheet.
 *
 * @param {string[][]} rows             as returned by xlsxReader
 * @param {{ existing?: {guest_name:string, phone_number:string}[] }} [opts]
 *        existing = invitations already in the target event, used to catch a
 *        file being imported twice
 * @returns {{
 *   ok: boolean, message?: string,
 *   total: number, valid: number, invalid: number,
 *   guests: {row:number, guest_name:string, phone_number:string, card_type:string}[],
 *   invalidRows: {row:number, guest_name:string, phone_number:string, type:string, errors:string[]}[],
 *   warnings: {row:number, message:string}[],
 *   counts: {single:number, double:number},
 *   columns: {name:string, phone:string, type:string}
 * }}
 */
function validateGuestRows(rows, opts = {}) {
  const empty = {
    ok: false, total: 0, valid: 0, invalid: 0,
    guests: [], invalidRows: [], warnings: [],
    counts: { single: 0, double: 0 }, columns: { name: '', phone: '', type: '' },
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ...empty, message: 'The file is empty.' };
  }

  const header = findHeader(rows);
  if (!header) {
    return { ...empty, message: 'Could not find the column headings. The first row must contain: name, phone, type.' };
  }

  const { cols } = header;
  const missing = ['name', 'phone', 'type'].filter((f) => cols[f] === -1);
  if (missing.length) {
    return { ...empty, message: `The file is missing the ${missing.join(' and ')} column${missing.length > 1 ? 's' : ''}. Required headings: name, phone, type.` };
  }

  const headerCells = rows[header.index];
  const columns = {
    name:  headerCells[cols.name]  || 'name',
    phone: headerCells[cols.phone] || 'phone',
    type:  headerCells[cols.type]  || 'type',
  };

  const body = rows.slice(header.index + 1);

  // ── pass 1: per-row shape ────────────────────────────────────────────────
  const guests = [];
  const invalidRows = [];
  const warnings = [];
  let total = 0;

  for (let i = 0; i < body.length; i++) {
    const raw    = body[i];
    const rowNum = header.index + i + 2;          // 1-based spreadsheet row

    const nameRaw  = raw[cols.name]  ?? '';
    const phoneRaw = raw[cols.phone] ?? '';
    const typeRaw  = raw[cols.type]  ?? '';

    // A blank line in the middle of a list is not an error — it is skipped.
    if (!String(nameRaw).trim() && !String(phoneRaw).trim() && !String(typeRaw).trim()) continue;

    total++;
    if (total > MAX_GUESTS) {
      return { ...empty, message: `This file has more than ${MAX_GUESTS} guests. Split it into smaller files.` };
    }

    const guest_name = cleanName(nameRaw);
    const phone      = cleanPhone(phoneRaw);
    const card_type  = normaliseType(typeRaw);
    const errors     = [];

    if (!guest_name)                         errors.push('name is missing');
    else if (guest_name.length > MAX_NAME_LEN) errors.push(`name is longer than ${MAX_NAME_LEN} characters`);

    if (!String(phoneRaw).trim())            errors.push('phone is missing');
    else if (/e\+?\d+$/i.test(String(phoneRaw).trim()))
      errors.push(`phone "${String(phoneRaw).trim()}" lost its digits in Excel — format the phone column as Text`);
    else if (digitsOf(phone).length < 9)     errors.push(`phone "${String(phoneRaw).trim()}" is too short`);
    else if (digitsOf(phone).length > 15)    errors.push(`phone "${String(phoneRaw).trim()}" is too long`);

    if (!String(typeRaw).trim())             errors.push('type is missing');
    else if (!card_type)                     errors.push(`invalid type "${String(typeRaw).trim()}" — use Single or Double`);

    if (errors.length) {
      invalidRows.push({
        row: rowNum,
        guest_name: String(nameRaw).trim(),
        phone_number: String(phoneRaw).trim(),
        type: String(typeRaw).trim(),
        errors,
      });
      continue;
    }

    guests.push({ row: rowNum, guest_name, phone_number: phone, card_type });
  }

  // ── pass 2: duplicates inside the file ───────────────────────────────────
  // Same person twice (name + phone) is an error. The same phone for two
  // different names is normal — one household, one handset — so it only warns.
  const seenPair  = new Map();
  const seenPhone = new Map();
  const kept = [];

  for (const g of guests) {
    const handset = phoneKey(g.phone_number);
    const pairKey = `${g.guest_name.toLowerCase()}|${handset}`;

    if (seenPair.has(pairKey)) {
      invalidRows.push({
        row: g.row, guest_name: g.guest_name, phone_number: g.phone_number, type: g.card_type,
        errors: [`duplicate of row ${seenPair.get(pairKey)} (same name and phone)`],
      });
      continue;
    }
    seenPair.set(pairKey, g.row);

    if (seenPhone.has(handset)) {
      warnings.push({ row: g.row, message: `shares a phone number with row ${seenPhone.get(handset)}` });
    } else {
      seenPhone.set(handset, g.row);
    }
    kept.push(g);
  }

  // ── pass 3: already in this event ────────────────────────────────────────
  // Stops the same file being generated twice, which is the realistic way
  // duplicate invitations would otherwise appear.
  const existing = new Set(
    (opts.existing || []).map((e) => `${cleanName(e.guest_name).toLowerCase()}|${phoneKey(e.phone_number)}`)
  );
  const finalGuests = [];
  for (const g of kept) {
    const key = `${g.guest_name.toLowerCase()}|${phoneKey(g.phone_number)}`;
    if (existing.has(key)) {
      invalidRows.push({
        row: g.row, guest_name: g.guest_name, phone_number: g.phone_number, type: g.card_type,
        errors: ['already has an invitation for this event'],
      });
      continue;
    }
    finalGuests.push(g);
  }

  invalidRows.sort((a, b) => a.row - b.row);

  const counts = {
    single: finalGuests.filter((g) => g.card_type === 'single').length,
    double: finalGuests.filter((g) => g.card_type === 'double').length,
  };

  return {
    ok: finalGuests.length > 0,
    total,
    valid: finalGuests.length,
    invalid: invalidRows.length,
    guests: finalGuests,
    invalidRows,
    warnings,
    counts,
    columns,
    message: finalGuests.length === 0 ? 'No valid guest rows were found in this file.' : undefined,
  };
}

module.exports = { validateGuestRows, cleanPhone, cleanName, normaliseType, phoneKey, findHeader, MAX_GUESTS, MAX_NAME_LEN };
