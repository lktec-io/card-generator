'use strict';

/**
 * Card image storage on the VPS filesystem.
 *
 * Layout:   <STORAGE_ROOT>/cards/<eventId>/<name>.<ext>
 * Default:  /var/www/card-generator/storage/cards/45/a8f31c72-91e4-4d2a-8f61-….png
 * Public:   /uploads/cards/45/a8f31c72-91e4-4d2a-8f61-….png   (nginx, see deploy/nginx)
 *
 * Only the relative public path is stored in MySQL — never the image bytes.
 *
 * File naming
 * -----------
 * New cards are named with a random token (saveCardImageWithToken), so a public card
 * URL no longer reveals a sequential invitation id and cannot be walked by guessing
 * numbers. The token is NOT a secret and is NOT authentication: a card is public by
 * design, and anyone holding the link can open it. It only removes easy enumeration.
 *
 * Cards written before that change are named <invitationId>.<ext> and are still
 * served, deleted and verified exactly as before — nothing is renamed or moved.
 * That is why both naming schemes exist here.
 *
 * Safety rules:
 *   - the directory is built from a NUMERIC event id only; nothing a client sends
 *     ever reaches the filesystem
 *   - a file name is either a numeric id (legacy) or a token this server generated;
 *     when a name comes back from the database it must pass a strict pattern first
 *   - every resolved path is re-checked to be inside the storage root before any write
 *     or delete, so traversal (../) cannot escape even if a value were tampered with
 *   - the extension is restricted to a small allow-list
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

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

/**
 * A card file name we are willing to touch, or null.
 * Accepts a token (UUID / hex) or a legacy numeric id. Must start with an
 * alphanumeric, so "." and ".." can never be a name, and contains no separator.
 */
function safeName(value) {
  const name = String(value || '');
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(name) ? name : null;
}

/**
 * A fresh, unguessable file name. crypto.randomUUID() is a CSPRNG v4 UUID —
 * 122 random bits, so the whole storage tree cannot be enumerated.
 */
function newCardToken() {
  return crypto.randomUUID();
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

/**
 * Write a NEW card under a random token name — the path used by every card
 * generated from now on, single or bulk.
 *
 * The invitation id is deliberately not part of the path, so the public URL
 * carries no sequential identifier. invitations.image_url remains the single
 * record of where a card lives; no extra column is needed to find it again.
 *
 * @returns {{ url: string, file: string, bytes: number, token: string }}
 */
function saveCardImageWithToken(eventId, buffer, ext = 'png') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Refusing to store an empty card image');
  }
  const dirName  = eventDirName(eventId);
  const safeExtn = safeExt(ext);
  const dir      = resolveInsideRoot(dirName);
  fs.mkdirSync(dir, { recursive: true });

  // A UUID collision is not a realistic event; this only means we never
  // silently overwrite a card that already exists.
  let token, file;
  for (let attempt = 0; attempt < 5; attempt++) {
    token = newCardToken();
    file  = resolveInsideRoot(dirName, `${token}.${safeExtn}`);
    if (!fs.existsSync(file)) break;
    file = null;
  }
  if (!file) throw new Error('Could not allocate a card file name');

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);

  return { url: `${PUBLIC_PREFIX}/${dirName}/${token}.${safeExtn}`, file, bytes: buffer.length, token };
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

/**
 * Public path → absolute file path. Returns null when the URL is not one of ours.
 *
 * This is the only route from stored data back to the filesystem, so it is strict:
 * the event folder must be digits, the file name must pass safeName() (no dots, no
 * separators, cannot begin with "."), and the extension must be allow-listed.
 * resolveInsideRoot() then confirms the result really is under the storage root.
 */
function pathFromUrl(url) {
  const m = String(url || '').match(/^\/uploads\/cards\/(\d+)\/([^/]+)\.([A-Za-z0-9]+)$/);
  if (!m) return null;
  const name = safeName(m[2]);
  const ext  = String(m[3]).toLowerCase();
  if (!name || !ALLOWED_EXT.has(ext)) return null;
  try {
    return resolveInsideRoot(m[1], `${name}.${ext}`);
  } catch {
    return null;
  }
}

/**
 * Delete the file an invitations.image_url points at — the delete path for every
 * card, token-named or legacy id-named, whatever its extension. Never throws.
 */
function deleteCardImageByUrl(url) {
  const file = pathFromUrl(url);
  if (!file) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[cardStorage] delete failed:', err.message);
    return false;
  }
}

/** True when the file an image_url points at exists and is non-empty. */
function cardImageExistsByUrl(url) {
  const file = pathFromUrl(url);
  if (!file) return false;
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

const isVpsCardUrl = (url) => /^\/uploads\/cards\//.test(String(url || ''));

module.exports = {
  STORAGE_ROOT,
  PUBLIC_PREFIX,
  // new cards
  saveCardImageWithToken,
  newCardToken,
  // reading / deleting by what the database actually stores
  pathFromUrl,
  deleteCardImageByUrl,
  cardImageExistsByUrl,
  deleteEventCardImages,
  isVpsCardUrl,
  // legacy <invitationId>.<ext> naming — still used by the Cloudinary migration
  // and verification scripts, and by cards written before tokens existed
  saveCardImage,
  getCardImageUrl,
  getCardImagePath,
  cardImageExists,
  deleteCardImage,
};
