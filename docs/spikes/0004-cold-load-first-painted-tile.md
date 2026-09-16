# Spike 0004 — Time to first painted tile, against the archive #53 published

**Measured 2026-09-16.** A dated measurement, not a decision — see
[`CLAUDE.md`](../../CLAUDE.md) §7 on what a spike write-up is and is not. Nothing here changes
[ADR 0010](../adr/0010-map-tiles-and-routing.md); one sentence of it is now measurable and an
amendment appended to that ADR says so.

Owner: [#63](https://github.com/openzigs/onyourleft/issues/63), whose eighth acceptance criterion is
*"Cold-load behaviour is measured and recorded in the PR: time to first painted tile on a cold
cache. Protomaps' own deployment docs warn that R2 latency is '500 ms or higher'; if the chosen host
is R2 this is where it becomes visible."*

---

## 1. What was measured, and with what

Two configurations of **the same page**, the same adapter (`apps/web/src/map/maplibre.ts`), the same
style builder (`apps/web/src/map/basemap.ts`) and the same browser. Only the archive URL differs,
which is #63's seventh criterion — *"the basemap URL is configuration"* — being exercised rather
than asserted.

| | Loopback | Hosted |
|---|---|---|
| Archive | `apps/web/browser/pmtiles-fixture.ts`, 520 bytes, one uncompressed 98-byte MVT | `https://tiles.openzigs.com/basemap-us-20260914.pmtiles`, 19,155,814,749 bytes, z0–15, gzipped MVT |
| Served by | `vite preview` on `127.0.0.1:4319` | Cloudflare R2 (ENAM) behind `tiles.openzigs.com` |
| Ride drawn | a 130 m line in London | a 1200 m line at the centre of the archive's own declared bounds |
| Command | `pnpm run test:browser` | `OYL_HOSTED_BASEMAP_URL=… pnpm run test:browser` |

**How "first painted tile" is decided.** The harness reads the WebGL drawing buffer on its own
animation-frame loop and reports the first frame on which a colour that **only a tile can produce**
is present — the `fill-color` and `line-color` of the layers bound to the basemap source, read out
of the style rather than written down. The style's `background-color` is excluded and reported
separately, because a background needs no network and its presence says nothing about tiles.
`apps/web/browser/harness.ts` sets out the mechanism, including the one that did not work.

**Machine and browser.** macOS 26.6.2 on Apple silicon, Chromium 1243 (the revision
`@playwright/test` 1.63.0 pins), headless, SwiftShader. ICMP round trip to the CDN edge
23.4–35.6 ms, mean 27.4 ms, over five packets.

**Runs.** Seven consecutive runs of each, one worker, a fresh browser context per run — so an empty
HTTP cache each time. Reported as median and range rather than a mean: seven samples is not enough
for a mean to mean anything.

---

## 2. The numbers

| | Loopback | Hosted | Difference |
|---|---|---|---|
| First painted tile, from `renderer.create` | **206.0 ms** (205.3 – 208.8) | **525.6 ms** (488.4 – 561.6) | **+319.6 ms** |
| First painted tile, from navigation start | **246.1 ms** (240.9 – 248.6) | **564.6 ms** (530.1 – 602.5) | +318.5 ms |
| Archive range requests visible at paint | 3 | 4 – 6 | |
| Archive responses over the whole load | 3 | 6 | |
| `cf-cache-status` | n/a | **`DYNAMIC` on every response, every run** | |
| HTTP status | 206 on every response | 206 on every response | |

One further figure, from the first run of the session rather than the seven: **616.3 ms**, against a
median of 525.6 ms for the runs that followed. Nothing in the client is warmed between runs — the
browser context is new each time — so that is most plausibly the operating system's own DNS and TLS
state, and it is recorded rather than discarded because it is what a rider's **first ever** map load
looks like.

Alongside, and not from the browser: three `curl` range requests at offsets never previously
requested returned 206 with time-to-first-byte of 0.277 s, 0.241 s and 0.478 s. That matches what
#53 measured on the same host (median ~0.25 s, range 0.207 – 0.512 s) and is the floor the figures
above cannot beat.

### What the difference is made of

The hosted configuration adds **one origin round trip's worth of latency, not several**. PMTiles
needs the 16 KB prefetch (header plus root directory) before it can ask for a tile, so the tiles are
at least one round trip behind — and 320 ms against a ~250 ms per-request TTFB says the tile
requests themselves are overlapping each other and partly overlapping the engine's own start-up,
rather than being serialised. **The multiplier #314 warned about is real but is not paid serially**:
`SharedPromiseCache` caches headers and directories and not tiles, so every visible tile is its own
range request, and here six of them cost about the same wall-clock as one.

⚠️ **`cf-cache-status: DYNAMIC` on every response is the finding for #53**, and it means these
numbers are the *worst* case rather than the typical one. Nothing is being cached at the edge:
every range request reaches R2 itself. A Cloudflare cache rule on that hostname would put the
common ranges — the header, the root directory, the tiles over a popular city — on the edge, where
the 27 ms round trip above is what a rider would pay instead of the 250 ms one. That is a
configuration change on #53's side, it costs nothing, and it is the single largest available
improvement to this number.

---

## 3. Against what ADR 0010 predicted

[ADR 0010](../adr/0010-map-tiles-and-routing.md) D-1 quotes Protomaps' own warning that *"Cloudflare
R2 is known to have higher latency (500ms or higher)"*, and states the trade as **"this saves about
$35/month and costs up to ~300 ms on a cold request"**.

**Measured: 320 ms at the median, 280 – 356 ms across the seven runs** — so the estimate was close
and slightly optimistic, and the *warning* it was hedging against did not materialise: no single
request came near 500 ms in the browser, though one `curl` probe at 478 ms came close. The decision
is unaffected, which is the property D-1 was structured to have, and an amendment recording the
figure is appended to that ADR under [ADR 0013](../adr/0013-adr-amendments.md).

⚠️ **Two reasons not to read this as the answer for a rider.** This is a desktop machine on a fixed
connection, geographically near the ENAM bucket; a phone on mobile data has a worse first hop before
any of this starts. And it is a headless Chromium on a software rasteriser: the *drawing* half of
the number is pessimistic in a way a real GPU would improve and the *network* half is not.

---

## 4. A defect this found, in how the number is read

`PerformanceResourceTiming` zeroes `transferSize` and every intermediate phase for a **cross-origin**
resource unless the server sends `Timing-Allow-Origin`. The archive's host does not send one —
checked, not assumed: the response carries
`access-control-expose-headers: etag,content-range,content-length,accept-ranges` and no
`Timing-Allow-Origin` at all.

That matters because the loopback measurement reports `transferredBytes: 0` to mean *"the browser
served this from cache"*, and a cross-origin one reports **exactly the same 0** to mean *"you are
not allowed to know"*. A reader comparing the two would conclude the CDN had served everything from
cache, which is the opposite of what `cf-cache-status: DYNAMIC` says. `ArchiveRequestTiming` now
carries `timingOpaque` for that reason, the report says which case it is in, and both halves are
asserted: the loopback requests must be transparent and the hosted ones must be opaque.

⚠️ The second of those is a **tripwire on somebody else's configuration**. If the host starts
sending `Timing-Allow-Origin` it goes red, and the right repair is to rewrite the note rather than
relax the assertion.

---

## 5. What this does not settle

- **Anything about a warm edge.** Every response here was `DYNAMIC`. The number a rider sees once a
  cache rule exists is a different measurement, and #53 owns it.
- **Anything about a phone.** See above. [`docs/validation/0002-android-shell-and-game.md`](../validation/0002-android-shell-and-game.md)
  is where a device measurement would go.
- **Whether the map looks right.** [ADR 0009](../adr/0009-clean-room-posture.md) forbids deriving a
  reference image from another product; what is asserted is that colours *this* style declares
  reached the drawing buffer.
- **Labels.** `basemapStyle` emits no `glyphs` and no `sprite`, because both would be third-party
  origins today. The map drawn in this measurement has no text on it at all, which is #53's
  outstanding half and is recorded in `apps/web/src/map/basemap.ts`.
