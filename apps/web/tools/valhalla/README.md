# In-browser Valhalla: the routing graph and the measurement page (#2320)

Spike 0035 measured in-browser Valhalla (`valhalla-browser`, MIT) on a desktop
only, with a graph, server and harness it threw away. This directory makes the
same graph again, reproducibly, and the page the owner runs on the tablet for
[#2009](https://github.com/openzigs/onyourleft/issues/2009). **Nothing here is
product code**: snapping a drawn route ships later, as its own change, if the
tablet's numbers hold.

⚠️ **The state is never named** in public text, code or commits (owner ruling,
2026-11-06). It is chosen by giving the build a local extract; it is never an
argument, and nothing the build publishes says which state it is, except the
box the tiles cover. No fixture here holds a real coordinate.

| Path                   | What                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build-graph.sh`       | The build: `valhalla_build_config`, `_admins`, `_tiles` and `_extract` in `ghcr.io/valhalla/valhalla:3.8.3`, pinned by digest, with `loki.use_connectivity` off. Then `make-release.ts`. Its suite is `build-graph.test.sh` (a fake `docker`). |
| `make-release.ts`      | Checks `graph.tar` the way the SDK will (index first, one entry per tile, each tile's own GraphId) and writes the release directory below, and a local build record nobody uploads.                                                            |
| `upload.sh`            | Uploads one release to R2 and checks the public URL before the manifest goes up. **A dry run unless told otherwise.** Its suite is `upload.test.sh` (a fake `aws` and `curl`).                                                                 |
| `release-objects.ts`   | What `upload.sh` uploads and checks, manifest last.                                                                                                                                                                                            |
| `measure/`             | The dev-only page, built by `vite.valhalla.config.ts`, never by the product's `vite.config.ts`. `stays-out.test.ts` holds that line.                                                                                                           |
| `graph-tar-testing.ts` | A `graph.tar` of Valhalla's shape with three filler tiles, for the tests.                                                                                                                                                                      |

## 1. Build the graph

Any `.osm.pbf` extract on disk. The basemap build already keeps Geofabrik's
dated extracts, MD5-checked, under `~/.cache/onyourleft/basemap/data/extracts/`
(`../basemap/build.sh`); a state's file there is the input spike 0035 used.

```bash
OYL_ROUTING_PBF=/path/to/<area>-YYMMDD.osm.pbf pnpm --filter @onyourleft/web valhalla:graph
# or: apps/web/tools/valhalla/build-graph.sh --pbf /path/to/extract.osm.pbf [--threads 8]
```

It needs Docker and Node 26, downloads only the pinned image, and writes to
`~/.cache/onyourleft/valhalla/releases/` (`--out`):

```text
<release>/manifest.json    SDK manifest schema 1: SHA-256 and the expected ETag of every object
<release>/config.json      the runtime configuration: loki.use_connectivity false, no local paths
<release>/graph.tar        Valhalla's own archive, index.bin first: the whole derived database
<release>/tiles/…/*.gph    the same tiles, one file each, for the individual-tiles transport
<release>/NOTICE.txt       the ODbL notice (docs/odbl.md)
<release>.build.json       local only: the extract's path and SHA-256, the image, sizes
```

`<release>` is `oyl-bicycle-<extract date>-<12 hex>`, the hex a hash of the
archive, configuration and coverage. The tiles of two builds of one extract
are the same bytes; `graph.tar` is not (Valhalla's tar records each tile's
build time), so each build is a new release. That is what an immutable
directory wants anyway.

A synthetic road grid (off Null Island, no real place) built in 36 s on the
development Mac on 2026-11-06, and the page routed 5, 40 and 150 km pairs on
it in headless Chromium against a local server sending R2's headers. That is
the check the script works end to end. It is not a measurement.

## 2. Upload it (the owner's OK first)

```bash
pnpm --filter @onyourleft/web valhalla:upload -- ~/.cache/onyourleft/valhalla/releases/<release>             # the plan
OYL_R2_BUCKET=… OYL_R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
  pnpm --filter @onyourleft/web valhalla:upload -- ~/.cache/onyourleft/valhalla/releases/<release> --upload   # the upload
```

The AWS CLI finds the existing R2 credentials itself (`AWS_PROFILE` or its own
environment variables); the script never reads or prints one. Each object is
one PUT under `routing/<release>/` with `Cache-Control: public,
max-age=31536000, immutable`, and no `Content-Encoding`: the SDK refuses an
encoded graph. Then every graph object is fetched (asking for gzip, deflate and br, as a browser does) from
`https://tiles.openzigs.com/routing/<release>/` with the page's `Origin`, and
`manifest.json` goes up last, only if each one answered with:

- `200`, its size and **the ETag in the manifest** (`"<MD5>"`, which R2 gives
  an object put in one part);
- no `Content-Encoding`, and the immutable `Cache-Control`;
- `Access-Control-Allow-Origin` for the page, and `Access-Control-Expose-Headers`
  naming `ETag`, `Content-Length`, `Content-Range` and `Last-Modified`;
- and, for `graph.tar`, `206` with the exact `Content-Range` for one byte range.

If a put fails part-way, `--upload` refuses the prefix from then on (a release
is immutable) and `--finish` uploads only the manifest, so delete everything
under `routing/<release>/` in the bucket by hand and run `--upload` again.

⚠️ **CORS is the bucket's, not this script's**, and the same bucket serves the
basemap. If the check says CORS is wrong, the rule upstream's guide gives is
below; changing it is the owner's call. Then `upload.sh <release> --finish`
checks again and uploads only the manifest.

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "If-None-Match", "If-Modified-Since"],
    "ExposeHeaders": [
      "Content-Range",
      "Content-Length",
      "Content-Encoding",
      "ETag",
      "Last-Modified",
      "Accept-Ranges",
      "Cache-Control"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

Optional: a `Timing-Allow-Origin: *` response header (a Cloudflare transform
rule) lets the page tell a tile from the network from one in the HTTP cache;
without it that column reads `unknown`.

## 3. Measure on the tablet

```bash
pnpm --filter @onyourleft/web valhalla:measure:build && pnpm --filter @onyourleft/web valhalla:measure:preview
adb reverse tcp:5180 tcp:5180   # the tablet's localhost:5180 is the Mac's
```

Open, in Chrome on the tablet:

```text
http://localhost:5180/?manifest=https://tiles.openzigs.com/routing/<release>/manifest.json
  &pair=5:LAT,LON,LAT,LON&pair=40:LAT,LON,LAT,LON&pair=150:LAT,LON,LAT,LON
  [&runs=3] [&budgetMiB=128] [&timeoutS=120] [&dragM=250]
```

`localhost` matters: the SDK checks every tile with Web Crypto, which a page
on the Mac's LAN address over plain http does not have. Pick each pair's end
points on roads (the SDK snaps within 30 m) about the class's length apart by
road; the record flags a routed length more than 15 % off its class. Clear the
site's data first for a cold HTTP cache.

Per pair and run the page opens a new router session (a new worker, an empty
decoded-tile cache), with `individual-tiles` and a 128 MiB decoded-tile
budget, and records: initialisation, cold, warm and dragged-waypoint route
times; bytes and tiles fetched; WebAssembly memory high water and the decoded
cache. The drag moves the destination `dragM` back along the route it drew,
so it is on a road. That point lies on the cold route, so the drag fetches
no new tile and is close to a warm route by construction: read it as a lower
bound on a real drag. The session's per-fetch deadline is the SDK's longest
(60 s), so a large tile on a slow link is measured as a slow cold route, not
a transport error. A route or an initialisation that runs past `timeoutS` is
cancelled. A route that runs past `timeoutS` is abandoned as
`TIMEOUT` (spike 0035's 32 MiB budget never finished). The record holds no
coordinate and no error message, only codes, so _Copy the record_ can be
pasted into #2009 as it is.

**Not measured by this page:** the Capacitor WebView (the page is not in the
APK), process memory (`ps` on the tablet, or Chrome's task manager, beside
it), and any route the 128 MiB budget cannot hold.

## Licences

- **valhalla-browser** is MIT, and its WebAssembly compiles in Valhalla (MIT),
  Boost (BSL-1.0), Protobuf (BSD-3-Clause), zlib and the rest: fifteen texts in
  its `dist/licenses/`, none copyleft (spike 0035). It is a devDependency of
  `apps/web` and in no product build, so it is not in
  `public/licences/third-party.txt`. The page redistributes the runtime, so it
  serves `licences/valhalla-browser.txt`: the package's `LICENSE`, `NOTICE.md`
  and every `dist/licenses/` text, verbatim (`measure/notices-plugin.ts`).
- **The graph is ODbL-1.0**, derived from OpenStreetMap: `docs/odbl.md`
  §"The routing graph for the in-browser measurement" says what is published
  and why share-alike is met.
- **The Valhalla image** is a build tool only and is never distributed.
