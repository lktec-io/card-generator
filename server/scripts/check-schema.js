#!/usr/bin/env node
'use strict';

/**
 * Read-only schema check. Run it on the server, from the project root:
 *
 *   node server/scripts/check-schema.js
 *
 * It uses the SAME connection settings as the API (server/.env), so it reports what the
 * running backend actually sees — which is the quickest way to tell whether a migration
 * landed in the wrong database. It only reads information_schema; it changes nothing.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/db');

// column → the migration that adds it
const REQUIRED = [
  ['invitations',       'card_type',           'migration_card_type.sql',          'Single/Double card type + analytics'],
  ['verification_logs', 'verified_by_user_id', 'migration_verifier_history.sql',   'Per-verifier scan history'],
  ['sms_logs',          'sms_kind',            'migration_thank_you_sms.sql',      'Marks thank-you messages in sms_logs'],
  ['events',            'thank_you_template',  'migration_thank_you_template.sql', 'Saved thank-you message per event'],
];

(async () => {
  try {
    const [[{ db }]]   = await pool.execute('SELECT DATABASE() AS db');
    const [[{ host }]] = await pool.execute('SELECT @@hostname AS host');
    console.log(`\nConnected as the API does → database "${db}" on ${host}\n`);

    let missing = 0;
    for (const [table, column, migration, purpose] of REQUIRED) {
      const [[{ n }]] = await pool.execute(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      const ok = Number(n) > 0;
      if (!ok) missing++;
      console.log(`  ${ok ? 'OK     ' : 'MISSING'}  ${`${table}.${column}`.padEnd(38)} ${ok ? purpose : `run ${migration}`}`);
    }

    if (missing) {
      console.log(`\n${missing} column(s) missing. Apply the named file(s) to database "${db}":`);
      console.log(`  mysql -u <user> -p ${db} < server/database/<migration>.sql\n`);
    } else {
      console.log('\nAll expected columns are present in this database.\n');
    }
    process.exit(missing ? 1 : 0);
  } catch (err) {
    console.error('\nSchema check failed:', err.message);
    console.error('Check server/.env (DB_HOST, DB_USER, DB_PASS, DB_NAME).\n');
    process.exit(2);
  }
})();
