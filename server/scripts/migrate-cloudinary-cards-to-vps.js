#!/usr/bin/env node
'use strict';

/**
 * Copy Cloudinary-hosted invitation cards onto this server's filesystem.
 *
 *   DRY RUN (default — touches nothing):
 *     node server/scripts/migrate-cloudinary-cards-to-vps.js --event-date=2026-10-10
 *
 *   REAL RUN (writes files + updates invitations.image_url):
 *     node server/scripts/migrate-cloudinary-cards-to-vps.js --event-date=2026-10-10 --apply
 *
 *   Other selectors:  --event-id=12        --all        --limit=25
 *
 * Per card:  download → save to VPS → verify on disk → only then update the database.
 * The previous Cloudinary URL is copied into invitations.cloudinary_url first, so a
 * rollback is one UPDATE. A card that fails is logged, left completely untouched, and
 * the run continues. Cloudinary assets are never deleted by this script.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const pool = require('../config/db');
const { saveCardImage, getCardImagePath, STORAGE_ROOT } = require('../services/cardStorage');

// ── arguments ───────────────────────────────────────────────────────────────
const argv  = process.argv.slice(2);
const arg   = (name) => { const hit = argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.split('=').slice(1).join('=') : null; };
const flag  = (name) => argv.includes(`--${name}`);

const APPLY      = flag('apply');
const ALL        = flag('all');
const EVENT_ID   = arg('event-id');
const EVENT_DATE = arg('event-date');
const LIMIT      = Number(arg('limit')) || 0;

// Must be an http(s) URL that mentions cloudinary.com. The SQL already filters on
// image_url LIKE 'http%cloudinary%'; this is the belt-and-braces check before download.
const isCloudinary = (u) => /^https?:\/\//i.test(String(u || '')) && /cloudinary\.com/i.test(String(u || ''));

function usage(msg) {
  console.error(`\n${msg}\n
Usage:
  node server/scripts/migrate-cloudinary-cards-to-vps.js --event-date=YYYY-MM-DD [--apply]
  node server/scripts/migrate-cloudinary-cards-to-vps.js --event-id=<id>        [--apply]
  node server/scripts/migrate-cloudinary-cards-to-vps.js --all                  [--apply]
  optional: --limit=<n>

Without --apply nothing is written: it is a dry run.\n`);
  process.exit(2);
}

// ── download, with redirects and a hard timeout ─────────────────────────────
function download(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? require('https') : require('http');
    const req = lib.get(url, { timeout: 30_000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('download timed out after 30s')));
    req.on('error', reject);
  });
}

// PNG / JPEG / WebP magic bytes — proves we stored a real image, not an error page
function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

async function hasColumn(table, column) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.n) > 0;
}

(async () => {
  if (!ALL && !EVENT_ID && !EVENT_DATE) usage('Choose a target: --event-date=, --event-id= or --all');

  const [[{ db }]] = await pool.execute('SELECT DATABASE() AS db');
  console.log(`\n${APPLY ? 'MIGRATION (writing)' : 'DRY RUN (no changes will be made)'}`);
  console.log(`database : ${db}`);
  console.log(`storage  : ${STORAGE_ROOT}`);

  // rollback column must exist before any real run
  const canRollback = await hasColumn('invitations', 'cloudinary_url');
  if (!canRollback) {
    const msg = 'invitations.cloudinary_url is missing — run server/database/migration_card_storage.sql first (or restart the API, which applies it automatically).';
    if (APPLY) { console.error(`\nREFUSING TO RUN: ${msg}\n`); process.exit(1); }
    console.log(`warning  : ${msg}`);
  }

  // ── select the target cards ───────────────────────────────────────────────
  let where = '';
  const params = [];
  if (EVENT_ID)        { where = 'AND i.event_id = ?';   params.push(Number(EVENT_ID)); }
  else if (EVENT_DATE) { where = 'AND e.event_date = ?'; params.push(EVENT_DATE); }

  const [rows] = await pool.execute(
    `SELECT i.id, i.code, i.event_id, i.image_url, e.event_name, e.event_date
       FROM invitations i
       LEFT JOIN events e ON e.id = i.event_id
      WHERE i.image_url LIKE 'http%cloudinary%' ${where}
      ORDER BY i.id ASC
      ${LIMIT ? `LIMIT ${Number(LIMIT)}` : ''}`,
    params
  );

  if (rows.length === 0) {
    console.log('\nNothing to migrate for that selection.\n');
    await pool.end();
    return;
  }

  const ev = rows[0];
  console.log(`event    : ${ev.event_name || '(none)'} — ${ev.event_date ? String(ev.event_date).slice(0, 10) : 'no date'} (id ${ev.event_id})`);
  console.log(`found    : ${rows.length} Cloudinary-backed card(s)\n`);

  if (!APPLY) {
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.code.padEnd(8)} ${String(r.image_url).slice(0, 58)}…`);
      console.log(`           → ${getCardImagePath(r.event_id, r.id, 'png')}`);
    }
    if (rows.length > 10) console.log(`  … and ${rows.length - 10} more`);
    console.log(`\nDry run only — nothing was downloaded, written or changed.`);
    console.log(`Re-run with --apply to perform the migration.\n`);
    await pool.end();
    return;
  }

  // ── migrate ───────────────────────────────────────────────────────────────
  const failed = [];
  let migrated = 0;

  for (const [i, row] of rows.entries()) {
    const label = `${row.code} (${i + 1}/${rows.length})`;
    try {
      if (!isCloudinary(row.image_url)) throw new Error('not a Cloudinary URL');

      const buf = await download(row.image_url);
      if (!buf.length) throw new Error('downloaded 0 bytes');
      const kind = imageKind(buf);
      if (!kind) throw new Error('downloaded data is not a PNG/JPEG/WebP image');

      const stored = saveCardImage(row.event_id, row.id, buf, kind);

      // verify on disk before the database is touched
      const stat = fs.statSync(stored.file);
      if (stat.size !== buf.length) throw new Error(`size mismatch on disk (${stat.size} vs ${buf.length})`);
      const back = fs.readFileSync(stored.file);
      if (!back.equals(buf)) throw new Error('file on disk does not match what was downloaded');

      // keep the Cloudinary URL first, then switch image_url — in that order
      await pool.execute(
        'UPDATE invitations SET cloudinary_url = COALESCE(cloudinary_url, image_url) WHERE id = ?',
        [row.id]
      );
      await pool.execute('UPDATE invitations SET image_url = ? WHERE id = ?', [stored.url, row.id]);

      migrated++;
      console.log(`  ok    ${label} → ${stored.url} (${stat.size} bytes)`);
    } catch (err) {
      failed.push({ code: row.code, id: row.id, reason: err.message });
      console.error(`  FAIL  ${label}: ${err.message} — left on Cloudinary, untouched`);
    }
  }

  console.log(`\n${ev.event_name || 'Selection'} migration`);
  console.log(`Found:    ${rows.length}`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Failed:   ${failed.length}`);
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  ${f.code} — ${f.reason}`);
    console.log('\nThese rows still point at Cloudinary and can be retried by re-running the same command.');
  }
  console.log('\nCloudinary assets were NOT deleted.\n');

  await pool.end();
  process.exit(failed.length ? 1 : 0);
})().catch(async (err) => {
  console.error('\nMigration aborted:', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(2);
});
