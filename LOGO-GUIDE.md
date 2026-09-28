# Logo guidelines — sign-in screen

Drop your file at **`public/logo.png`**. It appears automatically in the round container at
the top of the sign-in card. Until the file exists, a gold "C" monogram shows instead, so
nothing looks broken while you prepare the artwork.

## Dimensions

| | Value |
|---|---|
| **Recommended export** | **512 × 512 px** (PNG, transparent background) |
| Minimum | 256 × 256 px |
| Displayed size | 88 × 88 px desktop · 74 × 74 px phones |
| Safe area | Keep artwork inside the **middle 70 %** (~358 px of 512) |
| File size | Under 150 KB |
| Format | PNG-24 with alpha. SVG also works — see below |

The container is a circle 88 px across with 16 px of inner padding, so your artwork is drawn
into roughly a **56 px circle** on screen. At 2× and 3× screen densities that is up to
168 px, which is why a 512 px export stays crisp.

## Guidelines

1. **Square canvas.** The image is centred with `object-fit: contain`, so a square file is
   never cropped or stretched. A wide/rectangular logo will letterbox and look small — export
   a square mark (monogram, crest or icon) rather than a full horizontal wordmark.
2. **Transparent background.** The circle already has a cream gradient behind it. A white or
   checkerboard background will show as a visible square inside the circle.
3. **Trim the whitespace,** then let the 16 px padding do the spacing. Artwork exported with
   large built-in margins will look shrunken.
4. **Go dark, not light.** The container is near-white. Deep gold (`#b08d4f`), charcoal
   (`#2c2620`) or black read beautifully; pale gold or white will disappear.
5. **Keep it simple.** At 56 px, thin hairlines and small text vanish. A monogram or single
   emblem works far better than a detailed crest.
6. **One flat version.** Skip drop shadows and outer glows — the container supplies its own
   soft shadow and inner ring.

## Using SVG instead

Put the file at `public/logo.svg` and change one line in `src/pages/SignInPage.jsx`:

```jsx
<img src="/logo.svg" alt="Cardhub" className="logo-image" ... />
```

SVG stays sharp at any density and is usually the smallest file.

## Caching note

Files in `public/` are served with the name you give them, so browsers can hold an old copy
after you replace it. When you update the logo, either rename it (`logo-v2.png`) or hard
refresh. If you prefer automatic cache-busting, move the file to `src/assets/logo.png` and
import it instead — Vite will fingerprint the filename at build time:

```jsx
import logo from '../assets/logo.png';
// ...
<img src={logo} alt="Cardhub" className="logo-image" />
```

## Making the circle bigger or square

In `src/styles/sign-in.css`:

```css
.logo-container { width: 104px; height: 104px; }   /* size */
.logo-container { border-radius: 8px; }            /* rounded square instead of a circle */
.logo-image     { padding: 12px; }                 /* tighter crop */
```
