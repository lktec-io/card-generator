# Landing page assets

Files you add here appear on the public landing page (`/`) automatically after
the next `npm run build`. Nothing needs to change in the code. Any file that is
missing shows a clean placeholder instead, so you can add them one at a time.

## Invitation cards — `cards/`

| File | Where it shows |
|---|---|
| `cards/card-1.webp` | front card (the main one) |
| `cards/card-2.webp` | back, left |
| `cards/card-3.webp` | back, right |

- `.webp`, `.jpg`, `.jpeg` or `.png` all work — keep the names `card-1`, `card-2`, `card-3`.
- Portrait, **5 : 7** (for example 1000 × 1400 px). Other ratios are cropped to fit.
- Keep each under ~300 KB (WebP or JPG at ~80 % quality).
- Use **sample or approved designs only** — no real guest names, phone numbers,
  or working QR codes (a real card's QR would check that guest in).

## Demo video

| File | Purpose |
|---|---|
| `cardhub-demo.mp4` | the video (H.264, required) |
| `cardhub-demo.webm` | optional, smaller alternative for browsers that prefer it |
| `cardhub-demo-poster.jpg` | optional still shown before the video starts (`.webp` / `.png` also work) |

- It plays **muted, looped, inline**, with no controls, only while it is on screen.
  Visitors who ask for reduced motion see the still with a play control instead.
- Landscape (16 : 9) or portrait (9 : 16) both work — the frame takes the
  video's own shape, so nothing is cropped.
- Keep it short (≈ 10–20 s) and small (under ~5 MB): it is bundled with the site.
- Blur or avoid faces and names of real guests unless they agreed to appear.
