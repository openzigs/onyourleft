# The terrain archive (#2013)

A drawn route's heights are read in the app from a terrain archive on the
project's own storage, with no instance and no routing engine
(`src/terrain/`). This directory records how that archive is made, uploaded
and checked, and holds the tool that does the checking.

| Path | What |
| --- | --- |
| `archive-check.ts`, `run-check.mjs` | `pnpm --filter @onyourleft/web terrain:check -- plan <archive>` and `… -- verify <local.pmtiles> <https url>`. Its suite is `archive-check.test.ts`, against a fixture archive. |

**Nothing here uploads, and nothing was uploaded by the change that added
it.** The upload is the owner's act, with the owner's credentials, as the
basemap's and the routing graph's were. On 2026-11-23
`https://tiles.openzigs.com/terrain-us-mapterhorn-20260911.pmtiles` answered
HTTP 404. Until the object is there, the planner says elevation is unavailable
and a drawn route saves flat.

## What the archive is

An extract of [Mapterhorn](https://mapterhorn.com/data-access)'s
`planet.pmtiles`: terrain RGB in Terrarium encoding
(`R × 256 + G + B / 256 − 32768` metres), 512 px **lossless** WebP tiles, in a
PMTiles v3 archive. Read first-hand on 2026-11-23 with this repository's
`pmtiles` 4.5.0:

| Fact | Value |
| --- | --- |
| Upstream file | `https://download.mapterhorn.com/planet.pmtiles`, 355,579,263,191 bytes, `Last-Modified` 2026-09-11, MD5 `4bf586b043f7619d9a9442b43c163f36` (`download_urls.json`, version 0.0.13) |
| Header | tile type WebP, tiles stored uncompressed, directories gzipped, zoom 0 to 12 |
| A z12 tile | `RIFF`/`WEBP`/`VP8L`, 512 × 512; the largest inside the box is 291,560 bytes |
| Zoom 13 and above | not in this file: separate per-area files upstream, about 4.2 TB for the US, and not hosted |

The extract is the box `-125,24,-66,50` (the contiguous United States, the
basemap's first box) at every zoom the file has, 0 to 12, by the owner's
ruling of 2026-11-02. The app reads zoom 12 only (ADR 0087 D-2.1), where a
pixel covers 12.3 m of ground at 50° N and 17.5 m at 24° N.

## The steps

### 1. Plan it (run on 2026-11-23)

```bash
pnpm --filter @onyourleft/web terrain:check -- plan https://download.mapterhorn.com/planet.pmtiles
```

It reads directories only (about 21 MB) and printed:

```text
box -125,24,-66,50, zoom 0 to 12
tiles: 308994 (245765 distinct contents)
tile bytes: 19250356936 (19.25 GB)
largest tile: 291560 bytes
…
z12: 231203 tiles, 14438170560 bytes
```

That is `S_terrain` in `docs/cost-model.md`.

### 2. Extract it (not run)

With the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases)
(go-pmtiles, BSD-3-Clause), which is how Mapterhorn's own page says to take an
extract:

```bash
pmtiles extract https://download.mapterhorn.com/planet.pmtiles \
  terrain-us-mapterhorn-20260911.pmtiles \
  --bbox=-125,24,-66,50 --maxzoom=12
```

`--dry-run` prints the size first. The extract downloads about 19.25 GB. Record
the CLI's `pmtiles version` beside the upload.

Then check the extract holds what upstream has in the box. The two `plan`
outputs must agree on tiles and tile bytes:

```bash
pnpm --filter @onyourleft/web terrain:check -- plan terrain-us-mapterhorn-20260911.pmtiles
```

⚠️ Not run by the change that wrote this: the CLI is not installed where it
was written. If the CLI's box rule differs from this tool's (every tile that
touches the box), the counts differ at the box's edge, and the extract's own
count is the one to record.

### 3. Upload it (the owner's, not run)

To the bucket behind `tiles.openzigs.com`, beside the basemap, under exactly
the name `src/terrain/config.ts` §`PUBLISHED_TERRAIN_URL` holds. With the AWS
CLI against R2's S3 API, as `tools/valhalla/upload.sh` does, the credentials
in the CLI's own places:

```bash
aws s3 cp terrain-us-mapterhorn-20260911.pmtiles \
  "s3://${OYL_R2_BUCKET}/terrain-us-mapterhorn-20260911.pmtiles" \
  --endpoint-url "${OYL_R2_ENDPOINT}" \
  --content-type application/octet-stream
```

The object needs what the basemap's has, because the app reads it from the
APK's origin and from a self-hosted web build. The published basemap answered
a range request on 2026-11-23 with `206`, `accept-ranges: bytes`,
`access-control-allow-origin: *` and
`access-control-expose-headers: etag,content-range,content-length,accept-ranges,last-modified`.
Those come from the bucket's CORS rule, which already covers a new object in
it.

### 4. Verify it (not run)

```bash
pnpm --filter @onyourleft/web terrain:check -- verify \
  terrain-us-mapterhorn-20260911.pmtiles \
  https://tiles.openzigs.com/terrain-us-mapterhorn-20260911.pmtiles
```

It refuses a local file that is not WebP tiles reaching zoom 12, then checks
the uploaded object's length against the file's and the SHA-256 of eight
64 KiB ranges spread from the first byte to the last. It prints one line a
check and exits 1 on any difference. Then, with `Origin` set as a browser
sets it, check the CORS headers above:

```bash
curl -sS -o /dev/null -D - -r 0-126 -H 'Origin: https://example.org' \
  https://tiles.openzigs.com/terrain-us-mapterhorn-20260911.pmtiles
```

### 5. Never delete or rename it

The URL, dated name and all, is baked into every web bundle and every APK
(`PUBLISHED_TERRAIN_URL`), and an installed APK does not update itself. A
newer extract is uploaded **beside** this one under a new dated name and the
constant moves to it; the old object goes only when no build still in use can
name it. The basemap's rule, for the basemap's reason.

## Data, licences and credit

Mapterhorn's **code** is BSD-3-Clause; none of it is copied here. Its
**data** has no licence of its own: the tiles are built from open elevation
sources, each under its own terms, listed at
`https://download.mapterhorn.com/attribution.json` (151 sources on
2026-11-23). The archive's own attribution string is `© Mapterhorn`, linked to
`https://mapterhorn.com/attribution`.

The sources in that list whose stated coverage is North America:

| Source | Producer | Licence, as the list states it | What it asks |
| --- | --- | --- | --- |
| `usgs3dep13` (1/3 arc-second) and 33 `us1*` entries (1 m) | U.S. Geological Survey, 3D Elevation Program | Public Domain (U.S. Government Work) | nothing; credited anyway |
| `glo30` | Copernicus GLO-30 (DLR, Airbus, under COPERNICUS by the European Union and ESA) | COPERNICUS full, free and open license | the *"produced using Copernicus WorldDEM-30 …"* notice where the data is adapted (ADR 0010 D-5 quotes it) |
| `cahrdem2` | Natural Resources Canada | Open Government Licence - Canada | *"Contains information licensed under the Open Government Licence – Canada."* |

The credits screen gives all three, with Mapterhorn's own line and a link to
its list (`src/views/CreditsView.tsx` §`data-credit="terrain"`, wording in
`src/terrain/config.ts`).

⚠️ **Two things this does not establish.** Mapterhorn publishes no per-tile
record of which source a tile was built from that this change could find, so
the three families above are the ones the list places in North America, not a
proof that no other has a pixel in the box. And the extract's low zooms cover
the whole world, as any extract's do: the zoom-0 tile holds every continent,
downsampled from every source. The app reads zoom 12 only.

## Refresh

When Mapterhorn publishes a new `planet.pmtiles`: plan, extract, upload under
a new dated name, verify, move `PUBLISHED_TERRAIN_URL`, and update `S_terrain`
in `docs/cost-model.md` (`pnpm run check:cost-model`). Read `attribution.json`
again for sources added in North America.
