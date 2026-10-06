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
Select event → upload spreadsheet → validate → preview & position the card once
            → generate every card → live progress → summary
```

The preview shows the real card: the event's own design with the **first guest
from the uploaded file**, their type, a QR, and a sample `CN-000`. Previewing
creates nothing — no invitation, no CN, no file — so the layout can be adjusted
freely before committing to 400 cards.

The downloadable template (`name`, `phone`, `type`, five Tanzanian sample
guests) is built by the API and kept in `storage/templates/`, beside
`storage/cards`. It is not assembled in the browser and does not come from
Cloudinary or any external URL.

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

### Check the upload limit — do this one first

Bulk generation posts the card design (up to 10 MB) together with the guest
list. nginx's default `client_max_body_size` is **1 MB**, and it refuses anything
larger with an HTML `413` **before the request reaches Node** — so nothing
appears in the API log at all, and the browser gets an error page rather than a
message from the application.

```bash
sudo nginx -T | grep -n client_max_body_size      # nothing printed = the 1 MB default
```

If it is missing or below 12M, add it inside the `server { }` block for
`card.clixworks.co.tz`:

```nginx
client_max_body_size 12M;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The UI now names this case explicitly instead of saying only that generation
could not start, so if it is the cause you will see it said plainly on screen.

### Check the card location while you are there

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

## 2b. If generation still will not start

The API now logs the whole attempt. Watch it while clicking **Generate All**:

```bash
pm2 logs <APP> --lines 0 | grep BULK
```

A healthy run prints:

```
[BULK] request received: event=45 user=7 role=admin sheet=guests.xlsx 1749B image=image/png 3464B fields=16
[BULK] event 45 "HARUSI YA KENNEDY & GLORIA"
[BULK] rows read=6 valid=5 invalid=0
[BULK] config received: positions=yes qr=true cn=true type=true canvas=1200x1700
[BULK] 5 invitations created (CN-001 … CN-005)
[BULK] generation job bg_45_… created for 5 cards — starting
```

If **nothing at all** is printed, the request never reached the application —
that is the proxy, almost always `client_max_body_size` above. If a line is
printed and then `[BULK ERROR]`, that line names the real cause.

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

**Then two phases, both in the background:**

1. `preparing` — every valid guest is INSERTed (CN, UUID, name, phone, type,
   event) in transactions of 100.
2. `rendering` — cards are rendered and stored one at a time, writing
   `image_url` per invitation as each finishes.

The HTTP request returns its job id **immediately** and the browser watches both
phases through the progress endpoint. That matters at 400 guests: creating the
invitations is 400 round trips to MySQL, and holding the request open for them
risked passing a reverse proxy's read timeout (nginx `proxy_read_timeout`
defaults to 60s) — whose error page carries no JSON, leaving the browser with
nothing useful to show. Measured with a deliberately slow database (25 ms per
insert, 120 guests = 3 s of database work), the reply now arrives in **37 ms**.

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
| `GET /api/import/template?format=xlsx\|csv` | the guest-list template, built and stored by the API itself |
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
