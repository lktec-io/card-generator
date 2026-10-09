'use strict';

/**
 * Startup configuration report.
 *
 * Prints what the running process actually picked up — which .env file, which
 * address it listens on, and whether the URLs other services depend on are
 * well-formed — so a misconfiguration shows up in the first lines of the log
 * instead of as a mystery days later.
 *
 * Never prints a secret, a credential or a phone number: only file paths, URL
 * shapes, and yes/no facts.
 */

const fs   = require('fs');
const path = require('path');

/**
 * A URL other systems will use: absolute, https, no port glued onto the host.
 * "https://wedding.nardio.online8003" is exactly the shape this catches — a
 * missing ':' turns the port into part of the hostname.
 * @returns {string|null} the problem, or null when it looks right
 */
function urlProblem(name, value, { requireHttps = true } = {}) {
  if (!value) return null;
  let u;
  try { u = new URL(value); } catch { return `${name} is not a valid URL`; }
  if (requireHttps && u.protocol !== 'https:') return `${name} must use https:// (got ${u.protocol}//)`;
  // No real top-level domain contains a digit; an IPv4 address's last part is
  // all digits. Letters followed by digits ("online8003") means a port was glued
  // onto the hostname.
  const tld = u.hostname.split('.').pop() || '';
  if (/\d/.test(tld) && !/^\d+$/.test(tld)) {
    return `${name} host "${u.hostname}" looks like a port was appended without ':'`;
  }
  return null;
}

/**
 * @param {{ port: number|string, envResult?: { parsed?: object, error?: Error } }} opts
 */
function startupReport({ port, envResult } = {}) {
  const lines = [];
  const warn  = [];

  // Which .env this process read. dotenv resolves it from the working directory,
  // so a process started from a different folder silently reads a different file.
  const cwdEnv    = path.resolve(process.cwd(), '.env');
  const serverEnv = path.resolve(__dirname, '..', '.env');
  const loaded    = envResult && !envResult.error ? cwdEnv : null;
  lines.push(`env file   : ${loaded || 'NONE FOUND'} (working directory ${process.cwd()})`);
  if (loaded && path.normalize(loaded) !== path.normalize(serverEnv) && fs.existsSync(serverEnv)) {
    warn.push(`Loaded ${loaded}, but ${serverEnv} also exists. Settings kept only in the server/.env file are NOT active — start the API from the server/ folder, or keep one .env.`);
  }

  // Express listens on plain HTTP; TLS is terminated by nginx in front of it.
  lines.push(`listening  : http://0.0.0.0:${port}  (behind the reverse proxy)`);

  const site = String(process.env.PUBLIC_SITE_URL || '').trim();
  lines.push(`public URL : ${site || 'not set — derived per request from the proxy headers'}`);
  const siteIssue = urlProblem('PUBLIC_SITE_URL', site);
  if (siteIssue) warn.push(`${siteIssue}. Card images sent to WhatsApp and invitation links are built from it.`);

  const corsOrigin = String(process.env.CLIENT_URL || '').trim();
  if (corsOrigin) {
    const issue = urlProblem('CLIENT_URL', corsOrigin);
    if (issue) warn.push(issue);
  }

  // WhatsApp: facts only.
  try {
    const { publicStatus } = require('./whatsapp');
    const wa = publicStatus();
    lines.push(`whatsapp   : ${wa.configured ? 'configured' : `not configured (missing ${wa.missing.join(', ')})`}`);
    const cb = String(process.env.BEEM_WHATSAPP_CALLBACK_URL || '').trim();
    const cbIssue = urlProblem('BEEM_WHATSAPP_CALLBACK_URL', cb);
    if (cbIssue) warn.push(cbIssue);
    for (const w of wa.warnings || []) warn.push(w);
  } catch (err) {
    warn.push(`WhatsApp configuration could not be read: ${err.message}`);
  }

  console.log(`\n💍 Cardhub API\n   ${lines.join('\n   ')}`);
  for (const w of warn) console.warn(`   ⚠ ${w}`);
  console.log('');
  return { lines, warnings: warn };
}

module.exports = { startupReport, urlProblem };
