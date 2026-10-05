#!/usr/bin/env node
'use strict';

/**
 * Delete Cloudinary card assets that have already been migrated AND verified on this
 * server. DRY RUN BY DEFAULT — deleting requires BOTH --apply and --i-understand.
 *
 *   node server/scripts/cleanup-migrated-cloudinary-cards.js --event-date=2026-10-10
 *   node server/scripts/cleanup-migrated-cloudinary-cards.js --event-date=2026-10-10 --apply --i-understand
 *
 * A card is only ever considered when all three are true:
 *   1. invitations.image_url points at /uploads/cards/...
 *   2. invitations.cloudinary_url still holds the old URL
 *   3. the file exists on disk and is non-empty
 *
 * Do not run this until the migrated cards have been verified in production.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const pool = require('../config/db');
const { pathFromUrl } = require('../services/cardStorage');
const { cloudinary }  = require('../config/cloudinary');

const argv = process.argv.slice(2);
const arg  = (n) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : null; };
const APPLY   = argv.includes('--apply') && argv.includes('--i-understand');
const ASKED   = argv.includes('--apply');
const EVENT_ID = arg('event-id');
const EVENT_DATE = arg('event-date');

/** .../upload/v123/folder/name.png → folder/name */
function publicIdFromUrl(url) {
  const m = String(url).match(/cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
  return m ? m[1] : null;
}

(async () => {
  if (ASKED && !APPLY) {
    console.error('\n--apply also requires --i-understand. Nothing was deleted.\n');
    process.exit(2);
  }

  let where = '';
  const params = [];
  if (EVENT_ID)        { where = 'AND i.event_id = ?';   params.push(Number(EVENT_ID)); }
  else if (EVENT_DATE) { where = 'AND e.event_date = ?'; params.push(EVENT_DATE); }

  const [rows] = await pool.execute(
    `SELECT i.id, i.code, i.image_url, i.cloudinary_url
       FROM invitations i LEFT JOIN events e ON e.id = i.event_id
      WHERE i.image_url LIKE '/uploads/cards/%'
        AND i.cloudinary_url IS NOT NULL ${where}
      ORDER BY i.id ASC`,
    params
  );

  const eligible = [];
  const skipped  = [];
  for (const r of rows) {
    const file = pathFromUrl(r.image_url);
    let ok = false;
    try { ok = !!file && fs.statSync(file).size > 0; } catch { ok = false; }
    const publicId = publicIdFromUrl(r.cloudinary_url);
    if (ok && publicId) eligible.push({ ...r, publicId });
    else skipped.push({ code: r.code, reason: !ok ? 'VPS file missing' : 'cannot read Cloudinary public_id' });
  }

  console.log(`\n${APPLY ? 'DELETING from Cloudinary' : 'DRY RUN — nothing will be deleted'}`);
  console.log(`eligible : ${eligible.length}`);
  console.log(`skipped  : ${skipped.length}\n`);
  for (const e of eligible.slice(0, 15)) console.log(`  ${e.code.padEnd(8)} ${e.publicId}`);
  if (eligible.length > 15) console.log(`  … and ${eligible.length - 15} more`);
  for (const s of skipped.slice(0, 10)) console.log(`  SKIP ${s.code} — ${s.reason}`);

  if (!APPLY) {
    console.log('\nNothing was deleted. Add --apply --i-understand to delete these Cloudinary assets.\n');
    await pool.end();
    return;
  }

  let deleted = 0;
  for (const e of eligible) {
    try {
      await cloudinary.uploader.destroy(e.publicId, { resource_type: 'image', invalidate: true });
      deleted++;
      console.log(`  deleted ${e.code} (${e.publicId})`);
    } catch (err) {
      console.error(`  FAILED  ${e.code}: ${err.message}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${eligible.length}. The database was not modified — `
    + 'cloudinary_url is kept as a record of what used to exist.\n');

  await pool.end();
})().catch(async (e) => { console.error(e.message); try { await pool.end(); } catch {} process.exit(2); });
