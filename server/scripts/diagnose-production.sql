-- ---------------------------------------------------------------------------
-- Production database diagnostics — READ-ONLY.
--
-- Every statement here only reads (SELECT / SHOW). Nothing is created, changed
-- or deleted. Output contains counts and settings only — no guest names, phone
-- numbers, codes or credentials.
--
--   mysql -u <user> -p <database> < server/scripts/diagnose-production.sql
-- ---------------------------------------------------------------------------

-- 1. Connection capacity: each Node process opens up to 10 + DB_VERIFY_POOL_SIZE (3).
SHOW VARIABLES LIKE 'max_connections';
SHOW GLOBAL STATUS WHERE Variable_name IN
  ('Threads_connected', 'Max_used_connections', 'Aborted_connects', 'Connection_errors_max_connections');

-- 2. Memory: if the buffer pool is much smaller than the data, every page load reads disk.
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
SELECT TABLE_NAME, TABLE_ROWS,
       ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS size_mb
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE()
 ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC;

-- 3. Indexes on the columns every event page, dashboard and WhatsApp/SMS view
--    filters by. The repository never creates indexes on invitations.event_id or
--    rsvp_responses.event_id / invitation_id — this shows whether production has them.
SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_in_index, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('invitations', 'rsvp_responses', 'events', 'verification_logs', 'sms_logs', 'whatsapp_logs')
 GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
 ORDER BY TABLE_NAME, INDEX_NAME;

-- 4. Is anything slow or waiting on a lock RIGHT NOW? (Run while the problem is happening.)
SELECT ID, USER, COMMAND, TIME AS seconds, STATE, LEFT(INFO, 120) AS statement_start
  FROM information_schema.PROCESSLIST
 WHERE COMMAND <> 'Sleep'
 ORDER BY TIME DESC;

SELECT r.trx_id AS waiting_trx, r.trx_started AS waiting_since,
       b.trx_id AS blocking_trx, b.trx_started AS blocking_since
  FROM performance_schema.data_lock_waits w
  JOIN information_schema.INNODB_TRX r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
  JOIN information_schema.INNODB_TRX b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;

-- Long-open transactions (a transaction held open blocks check-in UPDATEs on the same rows).
SELECT trx_id, trx_state, trx_started, TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS open_seconds, trx_rows_locked
  FROM information_schema.INNODB_TRX
 ORDER BY trx_started;

-- 5. Slowest statement shapes since MySQL started (performance_schema is on by default in 8.0).
SELECT LEFT(DIGEST_TEXT, 160) AS statement_shape, COUNT_STAR AS calls,
       ROUND(AVG_TIMER_WAIT / 1e9, 1)  AS avg_ms,
       ROUND(MAX_TIMER_WAIT / 1e9, 1)  AS max_ms,
       SUM_ROWS_EXAMINED AS rows_examined
  FROM performance_schema.events_statements_summary_by_digest
 WHERE SCHEMA_NAME = DATABASE()
 ORDER BY SUM_TIMER_WAIT DESC
 LIMIT 15;

-- 6. Size of the largest event (what the event page and campaigns work on).
SELECT event_id, COUNT(*) AS invitations, SUM(status = 'used') AS checked_in
  FROM invitations GROUP BY event_id ORDER BY invitations DESC LIMIT 5;
