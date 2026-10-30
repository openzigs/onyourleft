# Embedding the demo on a website

The demo (epic [#1643](https://github.com/openzigs/onyourleft/issues/1643)) is a static page: scripted
riders on a preset route in the game's world, under the ride HUD. A website shows it in an `<iframe>`
and serves its files itself. There is **no server of ours** behind it, and the page makes no request
outside its own files. This page lists what the site has to serve, the snippet, the headers, the URL
parameters, the sizes, and what the site must leave visible
([#1654](https://github.com/openzigs/onyourleft/issues/1654)).

## Build it

```sh
pnpm install --frozen-lockfile
pnpm --filter @onyourleft/web run demo:bake -- --route upstate-climb   # optional: a preset route's map data
pnpm --filter @onyourleft/web run build:demo
```

The output is `apps/web/demo/dist/`, which is ignored and never committed. `build:demo` keeps the
routes `demo:bake` wrote into `dist/routes/` and fails if a route's ODbL notice is missing
([#1651](https://github.com/openzigs/onyourleft/issues/1651)). Without `demo:bake` there is no
`routes/` directory, and the demo rides only its synthetic road.

> ⚠️ **`demo:bake` does not start on Node 26**, the repository's Node line since 2026-10-29: its
> script passes `--experimental-transform-types`, which Node 26 refuses (`node: bad option`). The
> bake for this page was run on Node 24.22.1, directly:
> `node --experimental-transform-types --import ./tools/ts-extensionless-resolve.mjs tools/demo/bake-route.ts --route upstate-climb`
> from `apps/web`. It printed `6 of 6 tiles` and `19625 bytes (68476 uncompressed)`, and the digest
> matched the one recorded in `demo/routes/upstate-climb.bake.json`. `build:demo` itself runs on
> Node 26.

## The files

Serve the whole of `apps/web/demo/dist/` **unchanged**, as one directory, at any path. The page loads
everything relative to itself (`base: './'`), so `https://example.org/demo/` and
`https://demo.example.org/` both work.

| Path               | What it is                                                                                                                                                |                              Measured |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------: |
| `index.html`       | the page, with its own `<meta>` Content-Security-Policy                                                                                                   |                               3 139 B |
| `assets/`          | the page's script (1 file, 1 445 072 B; 433 624 B gzipped), stylesheet (94 940 B; 14 905 B gzipped), the stylised world's 11 models, 2 images and 2 fonts |                 17 files, 1 957 260 B |
| `realistic/`       | the realistic world: 61 `.ktx2` textures, 37 `.glb` models, 1 `.hdr` sky                                                                                  |                99 files, 46 996 135 B |
| `realistic/basis/` | the KTX2 transcoder, `basis_transcoder.js` and `basis_transcoder.wasm`                                                                                    |                    2 files, 584 862 B |
| `glyphs/`          | the map's label glyphs (`.pbf`) and their licence                                                                                                         |                    7 files, 599 871 B |
| `licences/`        | the third-party notices and the licence texts the page links to                                                                                           |                    3 files, 210 194 B |
| `routes/`          | only after `demo:bake`: each route's map data (`<id>.<digest>.bin`), `routes.json` and `LICENCE-ODbL.txt`                                                 | 3 files, 21 408 B for `upstate-climb` |
| **All**            |                                                                                                                                                           |           **132 files, 50 372 869 B** |

Measured on 2026-10-30 from this repository's `build:demo` with `upstate-climb` baked, summing each
file's size. `du -sk apps/web/demo/dist/*` printed `1948 assets`, `592 glyphs`, `4 index.html`,
`212 licences`, `46656 realistic` and `28 routes` (KiB on disk, so a little over the bytes above).

**What a visitor downloads.** The realistic world's set, 47 580 997 B with the transcoder (about
47.6 MB, `realistic-budget.ts`), loads **from the start**, behind a _Loading the realistic world…_
line under the stage: the owner's ruling of 2026-10-24 on #1643. The stylised world is drawn while
it arrives, and stays if it cannot (the page says so). The page itself, its script and the stylised
world are about 2 MB. A route's map data is about 20 KB.

## The snippet

<!-- embed-snippet: browser/shell-demo.browser.spec.ts loads exactly this block, with the URL changed -->

```html
<div style="aspect-ratio: 16 / 9; width: 100%">
  <iframe
    src="https://demo.example.org/on-your-left/?preset=climb"
    title="On Your Left: a demo ride by scripted riders"
    loading="lazy"
    allow="fullscreen"
    style="border: 0; display: block; width: 100%; height: 100%"
  ></iframe>
</div>
```

Change `src` to where the site serves `index.html`. The wrapper keeps the frame 16 : 9 at whatever
width the site's column gives it. `title` names the frame for a screen reader. `allow` grants
`fullscreen` and nothing else; Web Bluetooth is not granted, and is off in a cross-origin frame by
default anyway (the `bluetooth` permission's allowlist defaults to `self`).

## The headers

| Header                    | On                                  | Value                                                                        | Why                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | `index.html` (any file is harmless) | `frame-ancestors https://www.example.org` — the site's own origin or origins | Says which pages may frame the demo. It **cannot** be set from `<meta>`; the page's own `<meta>` policy covers everything else (`connect-src 'self' blob:` and the rest). Send only this directive: a second full policy from the host would be enforced as well as the page's. Leave out `X-Frame-Options`, which `frame-ancestors` replaces |
| `Content-Type`            | `.html`                             | `text/html; charset=utf-8`                                                   |                                                                                                                                                                                                                                                                                                                                               |
|                           | `.js`                               | `text/javascript`                                                            | A module script with another type is refused                                                                                                                                                                                                                                                                                                  |
|                           | `.css`                              | `text/css`                                                                   |                                                                                                                                                                                                                                                                                                                                               |
|                           | `.wasm`                             | `application/wasm`                                                           | The KTX2 transcoder                                                                                                                                                                                                                                                                                                                           |
|                           | `.ktx2`                             | `image/ktx2`                                                                 |                                                                                                                                                                                                                                                                                                                                               |
|                           | `.glb`                              | `model/gltf-binary`                                                          |                                                                                                                                                                                                                                                                                                                                               |
|                           | `.hdr`, `.bin`, `.pbf`              | `application/octet-stream`                                                   | Read as bytes                                                                                                                                                                                                                                                                                                                                 |
|                           | `.json`                             | `application/json`                                                           |                                                                                                                                                                                                                                                                                                                                               |
|                           | `.txt`                              | `text/plain; charset=utf-8`                                                  |                                                                                                                                                                                                                                                                                                                                               |
|                           | `.png`, `.woff2`                    | `image/png`, `font/woff2`                                                    |                                                                                                                                                                                                                                                                                                                                               |
| `X-Content-Type-Options`  | every file                          | `nosniff`                                                                    |                                                                                                                                                                                                                                                                                                                                               |
| `Cache-Control`           | `assets/*`, `routes/*.bin`          | `public, max-age=31536000, immutable`                                        | Their names carry a content hash                                                                                                                                                                                                                                                                                                              |
|                           | everything else                     | `no-cache`                                                                   | Same name across builds: revalidate                                                                                                                                                                                                                                                                                                           |

**Not needed: COOP and COEP.** Nothing in the demo uses `SharedArrayBuffer`, and the demo's browser
gate plays it inside a cross-origin frame with `crossOriginIsolated` false. The host needs neither
`Cross-Origin-Opener-Policy` nor `Cross-Origin-Embedder-Policy`.

## Start, sizing and stopping

- **Start.** The demo plays on load. It starts on a still frame with a _Play_ button instead when
  the visitor's system asks for reduced motion (`prefers-reduced-motion: reduce`) or the URL says
  `autoplay=0`. It is a WebGL canvas with no `<video>` and no sound, so a browser's media autoplay
  policy does not apply to it.
- **Stopping.** While the page is hidden or the frame is scrolled out of view, the demo requests no
  frames and rides none of the time (#1647). The HUD's _Pause_ and _Stop_ pause and stop it, as
  WCAG 2.2 SC 2.2.2 asks of anything that moves for longer than five seconds.
- **Sizing.** The page is the frame's whole box and never scrolls, at any size from 320 × 180 to
  3840 × 2160 CSS pixels. The HUD takes the product's own layout for the frame's size:
  - **736 × 360 and over** (`46rem` × `22.5rem`), the readings sit in the stage's corners over the
    world, as on a tablet or a phone on its side. The browser gate measures 768 × 432 and
    1920 × 1080 with every element inside the frame and every HUD panel inside the stage.
  - **Under that**, the HUD stacks under the world, as on an upright phone, and the stage scrolls
    within itself to reach it; the page around it does not. The browser gate measures 320 × 180.
    For readings over the world, give the frame at least 736 × 360.

## The URL parameters

Each is optional. An unknown parameter, or a value not listed, is refused with a sentence on the
page rather than ignored, so a mistyped link shows itself.

| Parameter  | Values                                                    | Default                  | What                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preset`   | `climb`, `sprint`, `group`                                | `climb`                  | Which scripted ride: a climb, a sprint, or four riders in a group                                                                                                                                                                                                                 |
| `route`    | the id of a route `demo:bake` wrote, e.g. `upstate-climb` | none: the synthetic road | Rides the preset on that route's real roads, with its map data and credit                                                                                                                                                                                                         |
| `showcase` | present, with no value                                    | absent                   | The feature tour (#1653), ridden by the `group` preset; `preset`, if given, must be `group`                                                                                                                                                                                       |
| `autoplay` | `1`, `0`                                                  | `1`                      | `0` starts on a still frame with a _Play_ button                                                                                                                                                                                                                                  |
| `controls` | `1`, `0`                                                  | `1`                      | `0` hides the HUD's _Pause_ and _Stop_ while the demo moves by itself. A demo that starts still shows them anyway, or nothing could start it. A site that hides them owes the visitor another way to stop the movement (WCAG 2.2 SC 2.2.2), such as a button that hides the frame |
| `units`    | `metric`, `imperial`                                      | `metric`                 | The HUD's units                                                                                                                                                                                                                                                                   |

For example, `?preset=group&showcase&units=imperial`, or `?preset=sprint&autoplay=0`.

## What this demo never does

Each line is held by a check, not only stated.

- **No network.** No request leaves the demo's own files: the page's policy refuses every other
  origin (`connect-src 'self' blob:`), and the browser gate records every request and aborts any to
  another origin (`demo-csp.browser.spec.ts`, `shell-demo.browser.spec.ts`).
- **No storage.** Nothing is written to cookies, `localStorage`, `sessionStorage`, IndexedDB, Cache
  Storage or a service worker; the browser gate reads each one back empty. The build refuses a
  service worker or a manifest in its output (`tools/demo/demo-output.ts`).
- **No Bluetooth.** No module that can reach Bluetooth is in the bundle (`tools/demo/forbidden-modules.ts`
  fails the build), and the browser gate records any call to `navigator.bluetooth`.
- **No trainer.** No module of the trainer-command seam is in the bundle (the same check): nothing
  in the demo can set a resistance or a power target.
- **No real person's ride.** Every rider is a script written by hand (ADR 0007 D4), and the page says
  so: _Demo: scripted riders, not a real ride_.

## What the site must leave visible

The demo is free software with obligations attached, and the site that serves it takes them on. Do
not crop, cover or restyle away any of these.

- **The source offer.** The line under the stage links the source code, the licence
  (AGPL-3.0-or-later) and the third-party notices. The demo's code is conveyed to every visitor's
  browser, so AGPL-3.0 §6 applies as it does to the app (ADR 0025). Serve `licences/` with the rest.
- **The label.** _Demo: scripted riders, not a real ride_, above the stage.
- **The map credit, with `route`.** A preset ridden on a baked route shows **© OpenStreetMap
  contributors** in the HUD, and a _Map data_ disclosure beside the stage with the ODbL notice, the
  licence, and a link to the route's data file itself (ADR 0056 D-3, D-8). The site serving the
  demo publicly conveys that data, so **serve the output unchanged**: the route's `.bin` file and
  `routes/LICENCE-ODbL.txt` with it. Serving the demo's routes without their notice file is not
  allowed (ADR 0056 D-4.4).
