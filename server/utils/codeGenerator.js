/**
 * codeGenerator.js
 * Generate the next unique invitation code: CN-001, CN-002, …
 *
 * IMPORTANT: Must be called inside an active DB transaction and receives
 * the transaction connection so the FOR UPDATE lock prevents race conditions
 * under concurrent requests.
 *
 * @param {import('mysql2/promise').PoolConnection} connection
 * @returns {Promise<string>}  e.g. "CN-001"
 */
async function getNextCode(connection) {
  // Lock the last row so concurrent calls can't get the same number
  const [rows] = await connection.execute(
    'SELECT code FROM invitations ORDER BY id DESC LIMIT 1 FOR UPDATE'
  );

  if (rows.length === 0) return 'CN-001';

  const lastCode = rows[0].code;
  const num = parseInt(lastCode.split('-')[1], 10);

  // Fallback if code format is somehow corrupted
  if (isNaN(num)) return 'CN-001';

  return `CN-${String(num + 1).padStart(3, '0')}`;
}

module.exports = { getNextCode };
