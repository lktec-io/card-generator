'use strict';

/**
 * Card image storage on the VPS filesystem.
 *
 * Layout:   <STORAGE_ROOT>/cards/<eventId>/<invitationId>.<ext>
 * Default:  /var/www/card-generator/storage/cards/123/456.png
 * Public:   /uploads/cards/123/456.png        (served by nginx, see deploy/nginx)
 *
 * Only the relative public path is stored in MySQL — never the image bytes.
 *
 * Safety rules:
 *   - directory and file names are built from NUMERIC ids only; nothing a client sends
 *     ever reaches the filesystem
 *   - every resolved path is re-checked to be inside the storage root before any write
 *     or delete, so traversal (../) cannot escape even if ids were tampered with
 *   - the extension is restricted to a small allow-list
 */

const fs   = require('fs');
const path = require('path');

// On the VPS the project lives at /var/www/card-generator, so this resolves to
// /var/www/card-generator/storage/cards — outside dist/, survives frontend builds.
const STORAGE_ROOT = process.env.CARD_STORAGE_DIR
  ? path.resolve(process.env.CARD_STORAGE_DIR)
  : path.resolve(__dirname, '..', '..', 'storage', 'cards');

const PUBLIC_PREFIX = '/uploads/cards';
const ALLOWED_EXT   = new Set(['png', 'jpg', 'jpeg', 'webp']);
const NO_EVENT_DIR  = '0';          // cards generated without an event

/** A positive integer id, or null. Anything else is rejected. */
function safeId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? String(n) : null;
}

function safeExt(ext) {
  const clean = String(ext || 'png').replace(/^\./, '').toLowerCase();
  return ALLOWED_EXT.has(clean) ? clean : 'png';
}

/** Resolve a path inside the storage root, or throw. Guards against traversal. */
function resolveInsideRoot(...segments) {
  const target = path.resolve(STORAGE_ROOT, ...segments);
  const root   = STORAGE_ROOT.endsWith(path.sep) ? STORAGE_ROOT : STORAGE_ROOT + path.sep;
  if (target !== STORAGE_ROOT && !target.startsWith(root)) {
    throw new Error('Refusing to touch a path outside the card storage root');
  }
  return target;
}

function eventDirName(eventId) {
  return safeId(eventId) || NO_EVENT_DIR;
}

/** Public URL stored in invitations.image_url, e.g. /uploads/cards/123/456.png */
function getCardImageUrl(eventId, invitationId, ext = 'png') {
  const id = safeId(invitationId);
  if (!id) throw new Error('Invalid invitation id for card storage');
  return `${PUBLIC_PREFIX}/${eventDirName(eventId)}/${id}.${safeExt(ext)}`;
}

/** Absolute path on disk for a card. */
function getCardImagePath(eventId, invitationId, ext = 'png') {
  const id = safeId(invitationId);
  if (!id) throw new Error('Invalid invitation id for card storage');
  return resolveInsideRoot(eventDirName(eventId), `${id}.${safeExt(ext)}`);
}

/**
 * Write a card image and return its public path.
 * Written to a temporary file first, then renamed — a reader can never see a half file.
 *
 * @returns {{ url: string, file: string, bytes: number }}
 */
function saveCardImage(eventId, invitationId, buffer, ext = 'png') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Refusing to store an empty card image');
  }
  const file = getCardImagePath(eventId, invitationId, ext);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);

  return { url: getCardImageUrl(eventId, invitationId, ext), file, bytes: buffer.length };
}

/** True when the file exists and is non-empty. */
function cardImageExists(eventId, invitationId, ext = 'png') {
  try {
    return fs.statSync(getCardImagePath(eventId, invitationId, ext)).size > 0;
  } catch {
    return false;
  }
}

/** Delete one card image. Never throws for a missing file. */
function deleteCardImage(eventId, invitationId, ext = 'png') {
  try {
    fs.unlinkSync(getCardImagePath(eventId, invitationId, ext));
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[cardStorage] delete failed:', err.message);
    return false;
  }
}

/**
 * Delete a whole event's card directory — used when an event is permanently deleted.
 * The directory is derived from the trusted numeric event id, never from client input.
 */
function deleteEventCardImages(eventId) {
  const id = safeId(eventId);
  if (!id) return { removed: false, reason: 'invalid event id' };
  try {
    const dir = resolveInsideRoot(id);
    if (!fs.existsSync(dir)) return { removed: false, reason: 'no directory' };
    const files = fs.readdirSync(dir).length;
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[cardStorage] removed card directory for event ${id} (${files} file(s))`);
    return { removed: true, files };
  } catch (err) {
    console.error('[cardStorage] directory delete failed:', err.message);
    return { removed: false, reason: err.message };
  }
}

/** Public path → absolute file path, for verification tooling. Returns null if not ours. */
function pathFromUrl(url) {
  const m = String(url || '').match(/^\/uploads\/cards\/(\d+)\/(\d+)\.([a-z]+)$/i);
  if (!m) return null;
  try {
    return resolveInsideRoot(m[1], `${m[2]}.${safeExt(m[3])}`);
  } catch {
    return null;
  }
}

const isVpsCardUrl = (url) => /^\/uploads\/cards\//.test(String(url || ''));

module.exports = {
  STORAGE_ROOT,
  PUBLIC_PREFIX,
  saveCardImage,
  getCardImageUrl,
  getCardImagePath,
  cardImageExists,
  deleteCardImage,
  deleteEventCardImages,
  pathFromUrl,
  isVpsCardUrl,
};
