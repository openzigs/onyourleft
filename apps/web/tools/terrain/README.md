# The terrain archive (#2013)

A drawn route's heights are read in the app from a terrain archive on the
project's own storage, with no instance and no routing engine
(`src/terrain/`). This directory records how that archive is made, uploaded
and checked, and holds the tool that does the checking.

| Path | What |
| --- | --- |
| `archive-check.ts`, `run-check.mjs` | `pnpm --filter @onyourleft/web terrain:check -- plan <archive>` and `… -- verify <local.pmtiles> <https url>`. Its suite is `archive-check.test.ts`, against a fixture archive. |

**Nothing here uploads.** The upload is done by hand, with the owner's
credentials, as the basemap's and the routing graph's were. On 2026-11-24 the
maintainer's session extracted, uploaded and verified the archive (steps 2 to
4 below, with what each printed), and
`https://tiles.openzigs.com/terrain-us-mapterhorn-20260911.pmtiles` is the
object the app reads.

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
| A z12 tile | `RIFF`/`WEBP`/`VP8L`, 512 × 512; the largest inside the box is 195,108 bytes (291,560 was a lower zoom's, counted on 2026-11-23) |
| Zoom 13 and above | not in this file: separate per-area files upstream, about 4.2 TB for the US, and not hosted |

The extract is the box `-125,24,-66,50` (the contiguous United States, the
basemap's first box) at **zoom 12 only**, by the owner's ruling of
2026-11-24: the app reads zoom 12 only (ADR 0087 D-2.1), where a pixel covers
12.3 m of ground at 50° N and 17.5 m at 24° N, and an extract of zoom 12
alone keeps the credited sources exact (§"Data, licences and credit").
Upstream's lower zooms are not hosted.

**Which builds read it.** A build with the published basemap reads this
archive unless `VITE_TERRAIN_PMTILES_URL` says otherwise. A build whose
basemap is anything else reads **no heights** unless that variable is set,
by the owner's ruling of 2026-11-24: a self-hoster's build reaches only the
tile host its operator chose (`src/terrain/config.ts`, `.env.example`).

## The steps

### 1. Plan it (run on 2026-11-24)

```bash
pnpm --filter @onyourleft/web terrain:check -- plan https://download.mapterhorn.com/planet.pmtiles
```

It reads directories only (about 21 MB) and counts zoom 12 only. It printed:

```text
box -125,24,-66,50, zoom 12
tiles: 231203 (182950 distinct contents)
tile bytes: 14438171098 (14.44 GB)
largest tile: 195108 bytes
z12: 231203 tiles, 14438171098 bytes
```

(The run of 2026-11-23 counted zoom 0 to 12: 308,994 tiles, 19,250,356,936
bytes. That plan was replaced by the ruling of 2026-11-24.)

### 2. Extract it (run on 2026-11-24 by the maintainer's session)

With the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles/releases)
(go-pmtiles, BSD-3-Clause), which is how Mapterhorn's own page says to take an
extract:

```bash
pmtiles extract https://download.mapterhorn.com/planet.pmtiles \
  terrain-us-mapterhorn-20260911.pmtiles \
  --bbox=-125,24,-66,50 --minzoom=12 --maxzoom=12
```

`--dry-run` prints the size first. The CLI was Homebrew `pmtiles` 1.31.2
(its `pmtiles version` prints `dev`). The run printed, among its progress
lines:

```text
Region tiles 254394, result tile entries 184714
Extract transferred 15 GB (overfetch 0.05) for an archive size of 14 GB
```

`pmtiles show` of the extract:

| Field | Value |
| --- | --- |
| spec version | 3 |
| tile type | webp |
| bounds | -125,24 to -66,50 |
| min zoom, max zoom | 12, 12 |
| addressed tiles | 231203 |
| tile entries | 184714 |
| tile contents | 182950 |
| internal compression | gzip |
| tile compression | none |
| attribution | `© Mapterhorn` |
| size | 14,438,629,218 bytes (`S_terrain` in `docs/cost-model.md`) |

The 231,203 addressed tiles are step 1's zoom-12 count. Then check the
extract holds what upstream has in the box; the two `plan` outputs must
agree on tiles and tile bytes, and on 2026-11-24 they did, line for line:

```bash
pnpm --filter @onyourleft/web terrain:check -- plan terrain-us-mapterhorn-20260911.pmtiles
```

```text
box -125,24,-66,50, zoom 12
tiles: 231203 (182950 distinct contents)
tile bytes: 14438171098 (14.44 GB)
largest tile: 195108 bytes
z12: 231203 tiles, 14438171098 bytes
```

### 3. Upload it (run on 2026-11-24 by the maintainer's session)

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
it. On 2026-11-24 the object was uploaded this way, with
`--content-type application/octet-stream`, to the R2 bucket behind
`tiles.openzigs.com`.

### 4. Verify it (run on 2026-11-24 by the maintainer's session)

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

On 2026-11-24 `verify`, against the local extract, printed:

```text
length: 14438629218 bytes, both
range 0+65536: sha256 b0744260eab91346… matches
range 2062651954+65536: sha256 6abbc3631eaf3621… matches
range 4125303909+65536: sha256 4dd14b8b483c9394… matches
range 6187955863+65536: sha256 f7622914ee06fc91… matches
range 8250607818+65536: sha256 c33fdcb2e2a792e3… matches
range 10313259772+65536: sha256 960c93e7a6412f85… matches
range 12375911727+65536: sha256 4ed2bd64cfd238dd… matches
range 14438563682+65536: sha256 2b1aced0e064fd37… matches
verified: the uploaded object is the local file
```

and the `curl` answered `206` with `content-range: bytes 0-126/14438629218`,
`accept-ranges: bytes`, `access-control-allow-origin: *` and
`access-control-expose-headers: etag,content-range,content-length,accept-ranges,last-modified`.

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

⚠️ **One thing this does not establish.** Mapterhorn publishes no per-tile
record of which source a tile was built from that this change could find, so
the three families above are the ones the list places in North America, not a
proof that no other has a pixel in the box.

## Refresh

When Mapterhorn publishes a new `planet.pmtiles`: plan, extract, upload under
a new dated name, verify, move `PUBLISHED_TERRAIN_URL`, and update `S_terrain`
in `docs/cost-model.md` (`pnpm run check:cost-model`). Read `attribution.json`
again for sources added in North America.
