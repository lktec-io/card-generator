#!/usr/bin/env node
'use strict';

/**
 * Read-only health check for migrated cards. Changes nothing.
 *
 *   node server/scripts/verify-card-storage.js --event-date=2026-10-10
 *   node server/scripts/verify-card-storage.js --event-id=12
 *   node server/scripts/verify-card-storage.js            (whole database summary)
 *
 * For every card it reports where the image lives and, for VPS-hosted ones, whether the
 * file is actually on disk and non-empty.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const pool = require('../config/db');
const { pathFromUrl, STORAGE_ROOT } = require('../services/cardStorage');

const argv = process.argv.slice(2);
const arg  = (n) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : null; };
const EVENT_ID = arg('event-id');
const EVENT_DATE = arg('event-date');

(async () => {
  const [[{ db }]] = await pool.execute('SELECT DATABASE() AS db');
  console.log(`\ndatabase : ${db}`);
  console.log(`storage  : ${STORAGE_ROOT}\n`);

  let where = '';
  const params = [];
  if (EVENT_ID)        { where = 'AND i.event_id = ?';   params.push(Number(EVENT_ID)); }
  else if (EVENT_DATE) { where = 'AND e.event_date = ?'; params.push(EVENT_DATE); }

  const [rows] = await pool.execute(
    `SELECT i.id, i.code, i.event_id, i.image_url,
            ${await hasCloudinaryCol() ? 'i.cloudinary_url' : 'NULL AS cloudinary_url'},
            e.event_name, e.event_date
       FROM invitations i LEFT JOIN events e ON e.id = i.event_id
      WHERE 1=1 ${where}
      ORDER BY i.id ASC`,
    params
  );

  const stat = { vps_ok: 0, vps_missing: [], cloudinary: 0, legacy_generated: 0, no_image: 0,
                 token_named: 0, id_named: 0, unreadable: [] };

  for (const r of rows) {
    const url = r.image_url || '';
    if (/^\/uploads\/cards\//.test(url)) {
      // token-named (new, unguessable) vs <invitationId>.png (written before tokens)
      const name = url.split('/').pop().replace(/\.[^.]+$/, '');
      if (/^\d+$/.test(name)) stat.id_named++; else stat.token_named++;

      const file = pathFromUrl(url);
      // a URL this server would refuse to resolve means the row was altered by
      // something other than this application — worth seeing
      if (!file) { stat.unreadable.push(`${r.code} → ${url}`); continue; }
      let ok = false;
      try { ok = fs.statSync(file).size > 0; } catch { ok = false; }
      if (ok) stat.vps_ok++;
      else stat.vps_missing.push(`${r.code} → ${url}`);
    } else if (/cloudinary\.com/i.test(url)) stat.cloudinary++;
    else if (/^\/generated\//.test(url))     stat.legacy_generated++;
    else                                     stat.no_image++;
  }

  if (rows.length && rows[0].event_name) {
    console.log(`event    : ${rows[0].event_name} — ${String(rows[0].event_date).slice(0, 10)}\n`);
  }
  console.log(`  cards total          : ${rows.length}`);
  console.log(`  on VPS, file present : ${stat.vps_ok}`);
  console.log(`    token-named (new)  : ${stat.token_named}`);
  console.log(`    id-named (older)   : ${stat.id_named}`);
  console.log(`  on VPS, FILE MISSING : ${stat.vps_missing.length}`);
  console.log(`  still on Cloudinary  : ${stat.cloudinary}`);
  console.log(`  legacy /generated/   : ${stat.legacy_generated}`);
  console.log(`  no image at all      : ${stat.no_image}`);
  const withBackup = rows.filter((r) => r.cloudinary_url).length;
  console.log(`  rollback URL kept    : ${withBackup}`);

  if (stat.vps_missing.length) {
    console.log('\n  MISSING FILES (database points at VPS but nothing is on disk):');
    for (const m of stat.vps_missing.slice(0, 20)) console.log(`    ${m}`);
    if (stat.vps_missing.length > 20) console.log(`    … and ${stat.vps_missing.length - 20} more`);
  }
  if (stat.unreadable.length) {
    console.log('\n  MALFORMED image_url (this application would never write these):');
    for (const m of stat.unreadable.slice(0, 20)) console.log(`    ${m}`);
  }
  console.log('');

  await pool.end();
  process.exit(stat.vps_missing.length || stat.unreadable.length ? 1 : 0);
})().catch(async (e) => { console.error(e.message); try { await pool.end(); } catch {} process.exit(2); });

async function hasCloudinaryCol() {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invitations' AND COLUMN_NAME = 'cloudinary_url'`
  );
  return Number(row.n) > 0;
}
