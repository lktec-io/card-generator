# Migrate Wedding Card Generator → card.clixworks.co.tz

Adds `card.clixworks.co.tz` **alongside** `wedding.nardio.online`. The old hostname keeps
working throughout. Nothing here restarts the backend, touches ports 8001/8004, changes the
database, edits another nginx site, or prints secrets.

Run on the production server. Every phase ends with a **STOP gate** — do not continue past a
failed gate.

| | |
|---|---|
| Frontend | `/var/www/card-generator/dist` |
| Backend  | `127.0.0.1:8003` — PM2, entry `server/server.js` |
| Cert     | `/etc/ssl/cloudflare/cert.pem` + `key.pem` (existing `*.clixworks.co.tz` origin cert) |

Recommended order: **1 audit → 2 frontend → 3 nginx → 4 verify on server → 5 DNS → 6 browser.**
DNS goes last so nobody reaches the new hostname before it is proven to work.

---

## Phase 1 — Read-only audit

```bash
# 1. Port 8003 is the Wedding app
sudo ss -ltnp 'sport = :8003'
curl -s http://127.0.0.1:8003/
#    expect: {"status":"ok","service":"Nardio Events API v2"}

# 2. PM2 — note the process name and cwd. Do NOT restart anything.
pm2 ls

# 3. Frontend is the Wedding build
grep -o '<title>[^<]*</title>' /var/www/card-generator/dist/index.html
#    expect: <title>Wedding Invitations – QR System</title>

# 4. Existing nginx site for the old hostname; no existing config for the new one
ls -l /etc/nginx/sites-enabled/
sudo grep -rln 'wedding\.nardio\.online' /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
sudo grep -rn  'card\.clixworks\.co\.tz'  /etc/nginx/ 2>/dev/null
#    expect: no output for card.clixworks.co.tz

# 5. The Cloudflare cert covers the new hostname and is not expired
sudo openssl x509 -in /etc/ssl/cloudflare/cert.pem -noout -subject -enddate -ext subjectAltName
#    expect: SAN includes *.clixworks.co.tz

# 6. Repo state, and whether a build-time API URL override exists (values never printed)
cd /var/www/card-generator && git status --short
for f in .env .env.local .env.production .env.production.local; do
  [ -f "$f" ] || continue
  grep -qE '^VITE_API_URL=' "$f" && echo "$f defines VITE_API_URL"
  grep -qE '^VITE_API_URL=.*wedding\.nardio\.online' "$f" && echo "  -> it points at the OLD domain"
done
```

**STOP if:** 8003 does not return the `Nardio Events API v2` fingerprint · the cert SAN lacks
`*.clixworks.co.tz` or it has expired · `card.clixworks.co.tz` already appears in nginx.

---

## Phase 2 — Frontend: relative API base (safe on the old domain)

The current bundle calls `https://wedding.nardio.online/api` from **every** hostname. On
`card.clixworks.co.tz` every API call would be cross-origin and blocked by CORS (the backend
allows only the old origin), so login and everything else would fail.

The fix makes the base `/api`, which each hostname's nginx already proxies. On
`wedding.nardio.online` the request URL is **identical to today**, so this is safe to deploy
before any nginx or DNS change.

`src/utils/api.js` — one line:

```diff
- export const API_BASE = import.meta.env.VITE_API_URL || 'https://wedding.nardio.online/api';
+ // Same-origin: nginx proxies /api/ on every hostname that serves this app
+ export const API_BASE = import.meta.env.VITE_API_URL || '/api';
```

If Phase 1 step 6 printed `-> it points at the OLD domain`, that variable overrides the
fallback at build time. Change **only that variable** to `VITE_API_URL=/api`.

Deploy it the way you normally deploy the frontend. If you build on the server:

```bash
cd /var/www/card-generator
cp -a dist "dist.bak-$(date +%F-%H%M)"      # instant rollback point
# apply the one-line change, then:
npm run build

# confirm the absolute old-domain API base is gone from the bundle
grep -l 'https://wedding.nardio.online/api' dist/assets/*.js || echo "OK: API base is relative"
```

Then on **https://wedding.nardio.online**: log in, open an event, verify one guest. In DevTools
→ Network, API calls must still go to `https://wedding.nardio.online/api/...`.

**STOP if** the old domain misbehaves, and roll back:
`mv dist dist.failed && mv dist.bak-<stamp> dist`

No PM2 restart — there are no backend code or backend `.env` changes.

---

## Phase 3 — nginx site for card.clixworks.co.tz

**Preferred:** derive it from the existing wedding site file so every extra production
directive it contains is kept. Set `OLD` to the file found in Phase 1 step 4.

```bash
OLD=/etc/nginx/sites-available/<wedding-site-file>
NEW=/etc/nginx/sites-available/card.clixworks.co.tz

if sudo test -e "$NEW"; then echo "STOP: $NEW already exists"; else sudo cp -a "$OLD" "$NEW"; fi

sudo sed -i 's/wedding\.nardio\.online/card.clixworks.co.tz/g' "$NEW"
sudo sed -i -E \
  -e 's#^([[:space:]]*ssl_certificate)[[:space:]]+[^;]+;#\1     /etc/ssl/cloudflare/cert.pem;#' \
  -e 's#^([[:space:]]*ssl_certificate_key)[[:space:]]+[^;]+;#\1 /etc/ssl/cloudflare/key.pem;#' \
  "$NEW"

sudo diff -u "$OLD" "$NEW"
```

Review the diff. **Only** the hostname strings and the two certificate lines may differ. Then check `$NEW`:

- `proxy_pass http://127.0.0.1:8003/;` is unchanged, **including the trailing slash**
  (the backend mounts routes at `/`; removing the slash breaks every API call)
- remove `default_server` from any `listen` line — the old site keeps it
- there is a `listen 80` block that redirects to `https://` — if not, add the HTTP block from
  `deploy/nginx/card.clixworks.co.tz.conf`

If the old file also serves other hostnames, or the diff shows anything unexpected, discard it
(`sudo rm "$NEW"`) and use `deploy/nginx/card.clixworks.co.tz.conf` instead, after copying in
any extra directives the old block has.

Enable and test. **Never reload on a failed test.**

```bash
sudo ln -s /etc/nginx/sites-available/card.clixworks.co.tz /etc/nginx/sites-enabled/card.clixworks.co.tz
sudo nginx -t
```

- `nginx -t` **fails** → STOP. nginx is still serving the old config. Take the new site out and fix it:
  `sudo rm /etc/nginx/sites-enabled/card.clixworks.co.tz`
- `nginx -t` **succeeds** →

  ```bash
  sudo systemctl reload nginx
  systemctl is-active nginx
  ```

Common `nginx -t` failures:

- `duplicate default server` → remove `default_server` from `$NEW`
- `shared memory zone "SSL" conflicts with already declared size` → make `ssl_session_cache`
  match the size the other sites use, or remove the line

Rollback at any time:
`sudo rm /etc/nginx/sites-enabled/card.clixworks.co.tz && sudo nginx -t && sudo systemctl reload nginx`

---

## Phase 4 — Verify on the server (works before DNS exists)

`--resolve` sends requests to this nginx as if DNS already pointed here.

```bash
R=(--resolve card.clixworks.co.tz:443:127.0.0.1 --resolve card.clixworks.co.tz:80:127.0.0.1)

curl -sk "${R[@]}" https://card.clixworks.co.tz/ | grep -o '<title>[^<]*</title>'
#   expect: Wedding Invitations – QR System   (not Contribution / Microfinance)

curl -sk "${R[@]}" https://card.clixworks.co.tz/api/
#   expect: {"status":"ok","service":"Nardio Events API v2"}   -> reached port 8003

curl -sI "${R[@]}" http://card.clixworks.co.tz/verify | grep -iE '^HTTP|^location'
#   expect: 301 and  location: https://card.clixworks.co.tz/verify

curl -skI "${R[@]}" https://card.clixworks.co.tz/verify | grep -i '^HTTP'
#   expect: 200   (React route opened directly)

# old hostname untouched
curl -skI --resolve wedding.nardio.online:443:127.0.0.1 https://wedding.nardio.online/ | grep -i '^HTTP'
#   expect: 200
```

**STOP if** any result differs — do not create the DNS record yet.

---

## Phase 5 — Cloudflare DNS (dashboard)

`card.clixworks.co.tz` does not exist in DNS yet (NXDOMAIN, checked against 1.1.1.1).

In the **clixworks.co.tz** zone (nameservers `armando` / `gwen`). Note that `nardio.online`
uses a different nameserver pair (`achiel` / `nelly`), so it may be a different Cloudflare account.

- Add record **`card`** pointing to the **same origin IP** as `wedding.nardio.online`.
  Copy the origin value from the nardio.online zone's `wedding` record, or read it on the
  server with `curl -s4 https://ifconfig.me`.
- **Proxied (orange cloud): ON** — the Cloudflare origin certificate only works behind the proxy.
- Do not change the SSL/TLS mode or any other record.

---

## Phase 6 — Verify in a browser on https://card.clixworks.co.tz

Keep DevTools → Network open. Every API request must go to
`https://card.clixworks.co.tz/api/...`, with no CORS errors and no requests to
`wedding.nardio.online`.

- [ ] `http://card.clixworks.co.tz` redirects to `https://`
- [ ] Log in
- [ ] Open `/verify` directly (deep link loads, not 404)
- [ ] Create a card: upload image → generate → download PNG
- [ ] QR scan · CN verification · Search by name → VALID GUEST popup
- [ ] Open a public invite link `/invite/<uuid>` · submit an RSVP
- [ ] Event page copy/share link shows `https://card.clixworks.co.tz/invite/...`

---

## Keep the old domain

Keep `wedding.nardio.online` enabled. Invite links that staff already copied or shared from
the old hostname contain `https://wedding.nardio.online/invite/<uuid>` — share links use the
hostname the staff member was on at the time. Deleting the old site would break every link
already sent to guests.

When you retire it, turn it into a permanent redirect rather than removing it:

```nginx
return 301 https://card.clixworks.co.tz$request_uri;
```
