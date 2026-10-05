# Cloudinary → VPS card storage

Runbook for moving generated invitation cards off Cloudinary onto the Contabo server.
Run the steps in order. Nothing here deletes a Cloudinary asset.

| | |
|---|---|
| Storage root | `/var/www/card-generator/storage/cards/<eventId>/<invitationId>.png` |
| Public URL | `/uploads/cards/<eventId>/<invitationId>.png` |
| Stored in MySQL | `invitations.image_url` — the relative path only, never the image |
| Rollback copy | `invitations.cloudinary_url` — the previous Cloudinary URL |

---

## 1. Backup the database (do this first)

```bash
mysqldump -u <DB_USER> -p --single-transaction --quick <DB_NAME> \
  > ~/backup-before-card-migration-$(date +%F-%H%M).sql && ls -lh ~/backup-before-card-migration-*.sql
```

## 2. Deploy the code and create the storage directory

```bash
cd /var/www/card-generator && git pull origin main
cd server && npm install --omit=dev          # only if server/package.json changed

sudo mkdir -p /var/www/card-generator/storage/cards
sudo chown -R $(ps -o user= -p $(pgrep -f 'node server.js' | head -1)):www-data /var/www/card-generator/storage
sudo chmod -R 750 /var/www/card-generator/storage
```

The API adds `invitations.cloudinary_url` itself on startup (`ensureSchema`). To apply it
by hand instead:

```bash
mysql -u <DB_USER> -p <DB_NAME> < server/database/migration_card_storage.sql
```

## 3. Nginx

Add the blocks from `deploy/nginx/card-uploads.location.conf` **inside** the existing
`server { … card.clixworks.co.tz … }` block, above `location / {`.

```bash
sudo nano /etc/nginx/sites-available/card.clixworks.co.tz   # paste the two location blocks
sudo nginx -t                                               # MUST say: syntax is ok / test is successful
sudo systemctl reload nginx
```

If `nginx -t` fails, **stop** and do not reload.

## 4. Restart the API

```bash
pm2 restart <APP> --update-env && pm2 logs <APP> --lines 30 --nostream
```

Expect: `[schema] added invitations.cloudinary_url …` on the first restart.

## 5. Check what is there (read-only)

```bash
mysql -u <DB_USER> -p <DB_NAME> -e "
SELECT e.id, e.event_name, e.event_date, COUNT(i.id) cards,
       SUM(i.image_url LIKE '%cloudinary%') on_cloudinary
FROM events e LEFT JOIN invitations i ON i.event_id = e.id
WHERE e.event_date = '2026-10-10' GROUP BY e.id;"

cd /var/www/card-generator && node server/scripts/verify-card-storage.js --event-date=2026-10-10
```

## 6. Dry run (changes nothing)

```bash
node server/scripts/migrate-cloudinary-cards-to-vps.js --event-date=2026-10-10
```

Read the output: event name, card count, destination paths. Nothing is downloaded or written.

## 7. Migrate the October 10 event

```bash
node server/scripts/migrate-cloudinary-cards-to-vps.js --event-date=2026-10-10 --apply
```

Per card: download → save → verify on disk → keep the Cloudinary URL → point `image_url` at
the VPS. A card that fails is logged and left on Cloudinary; re-running retries only those.

## 8. Verify

```bash
node server/scripts/verify-card-storage.js --event-date=2026-10-10
curl -I https://card.clixworks.co.tz/uploads/cards/<eventId>/<invitationId>.png   # expect 200, image/png
```

Then in the browser: open the event, check thumbnails, Download, Share, and scan one
migrated card at the gate (QR and CN are untouched by this migration).

---

## Rollback

**One event back to Cloudinary** (instant, no file changes):

```bash
mysql -u <DB_USER> -p <DB_NAME> -e "
UPDATE invitations i JOIN events e ON e.id = i.event_id
SET i.image_url = i.cloudinary_url
WHERE e.event_date = '2026-10-10' AND i.cloudinary_url IS NOT NULL;"
```

**Everything back to Cloudinary:**

```bash
mysql -u <DB_USER> -p <DB_NAME> -e "
UPDATE invitations SET image_url = cloudinary_url WHERE cloudinary_url IS NOT NULL;"
```

**New cards back to Cloudinary** — revert the code and restart:

```bash
cd /var/www/card-generator && git revert --no-edit <commit> && pm2 restart <APP>
```

**Full restore** (last resort):

```bash
mysql -u <DB_USER> -p <DB_NAME> < ~/backup-before-card-migration-<stamp>.sql
pm2 restart <APP>
```

The VPS files are left in place by every rollback above, so a re-migration is just a re-run.

---

## Cloudinary cleanup — later, and only when you decide

Not part of this migration. When the migrated cards have been verified in production:

```bash
node server/scripts/cleanup-migrated-cloudinary-cards.js --event-date=2026-10-10
# deletion requires BOTH flags:
node server/scripts/cleanup-migrated-cloudinary-cards.js --event-date=2026-10-10 --apply --i-understand
```

It only ever considers a card whose VPS file exists and is non-empty, and whose
`cloudinary_url` is still recorded.

**Cloudinary stays in use for voice messages and contribution-template backgrounds — do not
remove the package or the credentials.**
