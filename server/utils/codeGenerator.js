/**
 * codeGenerator.js
 * Allocate a unique, unpredictable invitation code: CN-2895, CN-8971, …
 *
 * Previously codes were sequential (last row's number + 1). That made every
 * guest's code guessable from any other, and it REUSED a code whenever the
 * newest invitation was deleted (the "last row" moved back).
 *
 * Now:
 *   - each code is drawn with crypto.randomInt — 4 digits, 1000–9999 (no
 *     leading zero, so "CN-" + what staff type at the gate is unambiguous)
 *   - it must not belong to any invitation, and it is CLAIMED in issued_codes
 *     (primary key) inside the caller's transaction. A claim is permanent once
 *     the caller commits, so a code is never issued twice — not even after its
 *     invitation is deleted. A rolled-back caller releases its claim, which is
 *     correct: that code was never given to anyone.
 *   - a collision just draws again. Four digits allow only 9,000 codes for the
 *     life of the system, so when that space gets crowded the draw widens to 5
 *     and then 6 random digits instead of failing card creation. Verification
 *     accepts CN- followed by 3 or more digits, so every width — and every old
 *     sequential code — keeps working.
 *
 * Must be called inside an active DB transaction, with that transaction's
 * connection.
 *
 * @param {import('mysql2/promise').PoolConnection} connection
 * @returns {Promise<string>}  e.g. "CN-2895"
 */
const crypto = require('crypto');

const WIDTHS = [4, 5, 6];
const ATTEMPTS_PER_WIDTH = 40;
let warnedNoRegistry = false;

/** A random code of the given digit count, never starting with 0. */
function randomCode(digits) {
  return `CN-${crypto.randomInt(10 ** (digits - 1), 10 ** digits)}`;
}

async function inUse(connection, code) {
  const [rows] = await connection.execute('SELECT 1 FROM invitations WHERE code = ? LIMIT 1', [code]);
  return rows.length > 0;
}

/**
 * Claim the code in issued_codes. false = someone already holds it (now or in
 * the past). If the registry table is missing (schema guard has not run), fall
 * back to the invitations check alone — invitations.code is UNIQUE, so a code
 * can still never be given to two live guests — and say so once.
 */
async function claim(connection, code) {
  try {
    await connection.execute('INSERT INTO issued_codes (code) VALUES (?)', [code]);
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return false;
    if (err.code === 'ER_NO_SUCH_TABLE') {
      if (!warnedNoRegistry) {
        warnedNoRegistry = true;
        console.warn('[codeGenerator] issued_codes table missing — codes are unique among current invitations, but a deleted invitation\'s code could be reissued until the schema guard creates it.');
      }
      return true;
    }
    throw err;
  }
}

async function getNextCode(connection, { random = randomCode } = {}) {
  for (const digits of WIDTHS) {
    for (let i = 0; i < ATTEMPTS_PER_WIDTH; i++) {
      const code = random(digits);
      if (await inUse(connection, code)) continue;
      if (await claim(connection, code)) return code;
    }
  }
  throw new Error('Could not allocate a unique invitation code. Please try again.');
}

module.exports = { getNextCode, randomCode, WIDTHS, ATTEMPTS_PER_WIDTH };
