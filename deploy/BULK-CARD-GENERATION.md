# Bulk card generation + opaque card URLs

What changed, how to deploy it, and how to roll it back.

There is **no database migration in this change.** Nothing has to be run against
MySQL. Deploy = pull, build the frontend, restart the API.

---

## 1. What changed

### Opaque public card URLs

A newly generated card used to be stored as the invitation's id:

```
/uploads/cards/45/2200.png        ← anyone could walk 2201, 2202, 2203 …
```

It is now stored under a random token:

```
/uploads/cards/45/a8f31c72-91e4-4d2a-8f61-0b1c2d3e4f50.png
```

The token is `crypto.randomUUID()` — a cryptographically secure v4 UUID, 122
random bits. It is **not authentication**: a card is meant to be publicly
viewable, and anyone holding the link can open it. It only removes the ability
to enumerate every guest's card by counting.

No new database column. The path already lives in `invitations.image_url`, which
is the single record of where a card is; a second column would only be a copy of
it that could drift.

**Cards created before this change keep working.** Nothing is renamed or moved.
`/uploads/cards/45/2200.png` still resolves, still downloads, still deletes.

### Bulk card generation

A second workflow inside the Import module:

```
Select event → upload spreadsheet → validate → position the layout once
            → generate every card → live progress → summary
```

The existing "Guest List Only" import, and the existing single-card generator,
are unchanged and still reachable.

---

## 2. Deploy

```bash
cd /var/www/card-generator && git pull origin main

# frontend (the Import page and the new workflow)
npm ci && npm run build

# backend — no new dependencies were added, so npm install is only needed
# if server/package.json changed
pm2 restart <APP> --update-env && pm2 logs <APP> --lines 20 --nostream
```

Nothing else is required. The storage directory and `invitations.cloudinary_url`
already exist from the Cloudinary migration.

### Check nginx while you are there

The `/uploads/cards/` block in `deploy/nginx/card-uploads.location.conf` was
**corrected** in this change. The earlier version nested a regex `location`
inside a prefix `location` and gave the inner one a plain `alias`; in nginx an
`alias` inside a regex location must be built from that regex's captures, or the
rest of the URI is not appended.

See what is actually installed:

```bash
sudo nginx -T | grep -n -A 12 'uploads/cards'
```

If it does not match the file in this repo, replace it with that file's blocks:

```bash
sudo nano /etc/nginx/sites-available/card.clixworks.co.tz
sudo nginx -t          # MUST say: syntax is ok / test is successful
sudo systemctl reload nginx
```

If `nginx -t` fails, **stop** and do not reload.

Token file names need no nginx change on their own — any rule that matches on
the image extension already serves them.

---

## 3. The spreadsheet

Three columns, any capitalisation, any order:

```
name              phone          type
John Doe          0712345678     Double
Mary John         0755555555     Single
```

* `type` accepts `Single`/`single`/`SINGLE`/`Double`/`double`/`DOUBLE`.
  Anything else is a row error: `Row 17: invalid type "Family"`.
* **Do not put CN numbers in the file.** They are issued by the existing
  `getNextCode()` sequence. A `cn` or `code` column is ignored.
* **Do not put QR data in the file.** Each guest's QR is generated from their CN
  by the existing generator.
* `.xlsx` and `.csv` are read. The old binary `.xls` is refused with a message
  telling the user to re-save it.
* Headings may sit under a title row. `Guest Name` / `Phone Number` /
  `Card Type`, and Swahili `Jina` / `Simu` / `Aina`, are all recognised.

A phone typed into a *numeric* Excel cell loses its leading zero; `712345678`
is restored to `0712345678`. A phone Excel mangled into `7.12346E+08` is
**rejected**, not guessed — the row error tells the user to format that column
as Text.

Limits: 1000 guests per file, 5 MB spreadsheet, 10 MB card design.

---

## 4. How a run behaves

**Validation first.** Nothing is created until the whole file is clean. If any
row is invalid the request is refused with the row numbers and reasons, and zero
invitations exist afterwards.

**Then two phases:**

1. Every valid guest is INSERTed — CN, UUID, name, phone, type, event — in
   transactions of 100.
2. Cards are rendered and stored one at a time, writing `image_url` per
   invitation as each finishes.

A rendering failure therefore leaves a real invitation with a real CN and no
image. **Retry re-renders that invitation** rather than creating a second one,
which is what makes retrying duplicate-free.

Re-uploading the same file is refused: a guest who already has an invitation on
that event is reported as `already has an invitation for this event`. The match
is on name plus the last nine digits of the phone, so `0712345678` and
`+255712345678` are recognised as the same person.

### Speed and load

Measured on an 8-core box, 1200×1700 card:

| | |
|---|---|
| per card | ~750 ms |
| 400 cards | ~5 minutes |
| worst event-loop stall | ~490 ms (median ~395 ms) |

Cards are rendered **one at a time** on purpose. About 620 ms of each card is
resvg rasterising text *synchronously*, which cannot overlap — running cards in
parallel does not finish the batch sooner, it only makes the API stall longer in
one go:

```
concurrency 1 → 770 ms/card,  worst stall  581 ms
concurrency 3 → 801 ms/card,  worst stall 1263 ms
```

Override only on a box doing nothing else:

```bash
BULK_CARD_CONCURRENCY=2     # cards in flight   (default 1)
BULK_CARD_PAUSE_MS=20       # breather between cards (default 20)
```

> **Known, not changed here:** ~195 ms of every 232 ms rasterise is resvg
> enumerating system fonts, and it happens three times per card — so roughly
> 600 ms of each card is spent re-reading the font list. This affects the
> existing single-card generator too. Passing explicit `fontFiles` instead of
> `loadSystemFonts: true` in `server/utils/imageProcessor.js` would cut card
> generation to about a quarter of its current time. It is not done here because
> that file renders every live card, and on Linux it would change which font is
> picked — a visible change to card output that should be made deliberately and
> checked against a real card design.

---

## 5. Rollback

The change is code-only. There is nothing to undo in the database.

```bash
cd /var/www/card-generator && git revert --no-edit <commit>
npm ci && npm run build
pm2 restart <APP>
```

Cards generated while the change was live keep working after a revert: their
token paths are already in `invitations.image_url`, and the old code reads
`image_url` exactly the same way. The only thing lost is the bulk workflow.

---

## 6. New endpoints

All require a manager role (`super_admin`, `admin`, `event_manager`); verifiers
are refused. The event is also checked against the caller's scope, so an admin
cannot generate cards onto somebody else's event.

| | |
|---|---|
| `POST /api/import/validate` | read the sheet, report what would be generated. Writes nothing. |
| `POST /api/import/bulk-generate/:event_id` | sheet + card design → creates invitations, returns `job_id` |
| `GET /api/import/bulk-generate/progress/:job_id` | real counters: completed / generated / failed / current guest |
| `POST /api/import/bulk-generate/retry/:job_id` | re-render the failed cards for the same invitations |

The sheet is uploaded again at generation time and re-read server-side, so the
rows that get generated are exactly the rows the file describes — the browser
cannot add, rename or retype a guest between the preview and the run.

Jobs are held in memory for an hour. If the API restarts mid-run, the
invitations already created remain (with their CNs); open the event to see which
ones have no card yet.
