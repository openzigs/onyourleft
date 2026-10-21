# `@onyourleft/map-features`

Turns **one z15 Protomaps Basemap v4 vector tile** — MVT bytes, already decompressed — into
**bounded, typed features** in the corridor's local metres, and supplies the pure geometry the rest
of [ADR 0054](../../docs/adr/0054-towns-from-real-map-data.md)'s phase B needs
([#1544](https://github.com/openzigs/onyourleft/issues/1544)).

Apache-2.0, like everything under `packages/`. **It fetches nothing, decompresses nothing, holds no
map data and names no rendering library.** The archive read is #1539's one module outside
`apps/web/src/game/`, and the drawing is `game/`'s.

| Module | What it is |
|---|---|
| `src/decode.ts` | `decodeTile`: the four layers ADR 0054 D-2.2 reads, and of each only `kind`, `kind_detail`, `height`, `min_height` and the geometry. A refusal, never a throw |
| `src/limits.ts` | The five bounds, with what each sits above on the published archive |
| `src/schema.ts` | What is read: the layers, the keys, the geometry types each layer carries, the footway set (#1551) |
| `src/protobuf.ts` | A bounded protobuf reader: every read is inside its message or a refusal |
| `src/refusal.ts` | `describeRefusal`: the layer and the limit, never a coordinate or the tile's `x`/`y` (ADR 0004 D) |
| `src/projection.ts` | The game's projection, restated (see below) |
| `src/cover.ts` | `corridorTileCover`: the z15 tiles a route's corridor touches, in route order, capped |
| `src/geometry.ts` | `simplifyRing`, `clipToBox`, `triangulate` (earcut), `rasterise` |
| `src/testing/mvt-encoder.ts`, `src/fixtures/` | A deterministic MVT encoder and the synthetic fixtures, from arithmetic only. `@onyourleft/map-features/testing`, never the barrel |

## The frame

Every coordinate is **local metres in the corridor frame**: `x` metres **WEST** of the origin (east is
`−x`, #583) and `z` metres north, equirectangular about the route's first point —
`apps/web/src/game/terrain.ts` §`localGroundPosition`. A package may not import from `apps/`
(CLAUDE.md §3), so `projection.ts` writes the formula out again, and
`apps/web/src/game/map-features-projection.test.ts` holds the two equal over 100 points from 70° S to
70° N. A ring is a `Float32Array` of `x, z` pairs, closed implicitly; a polygon is
`[outer, ...holes]`.

## A tile is untrusted input

A tile comes from a configurable URL (ADR 0054 D-2.1), so anybody who serves the archive, or sits on
the path to it, can hand back anything. So:

- **The size is checked first**, before a byte is read.
- **The layers are framed and their features counted by skipping**, for all four read layers, before
  any feature is decoded; a layer over its feature limit allocates nothing.
- **Vertices are counted before any geometry is decoded**: a counting pass checks each command's
  count against the feature's and the tile's limits before skipping its parameters. A tile over
  either limit is refused with nothing projected or stored, and the output can never exceed
  `maxVerticesPerTile` vertices.
- **Every coordinate is checked against the layer's extent**, with one extent of buffer either side,
  so nothing downstream sees a NaN or an infinity. An extent outside `[1, 65536]` is malformed.
- **Only the keys `kind`, `kind_detail`, `height` and `min_height` are looked up**, by comparing
  bytes; no other value — a `name`, a `pmap:*` field, an address — is ever decoded into a string,
  and the feature id is skipped unread (ADR 0012 D-3's trap). A `kind` must be `[a-z0-9_]{1,64}`, or
  the feature is dropped. A height outside `[0, 1000]` m is `null`.
- **A refused tile's message names the layer and the limit, and nothing else.** The layer is always
  one of the four this package reads, never a name the tile supplied.

The decoder is our own over a bounded reader of our own (`protobuf.ts`), rather than
`@mapbox/vector-tile` over `pbf`: `pbf`'s reader does not bounds-check, and `@mapbox/vector-tile`
materialises a feature's whole geometry before anything could count it. #1544 admits either.

## What it may not depend on

- **Any platform API at all**, as `packages/domain`: `tsconfig.platform-free.json` (`lib:
  ["ES2024"]`, `types: []`) is the closure, over everything but the tests, and `eslint.config.js` is
  the fast duplicate.
- **`three`, `maplibre-gl`, `pmtiles`** (a renderer, a map library and a fetching tile source) and
  **`@onyourleft/store`**, by `eslint.config.js` §`MAP_FEATURES_IMPORT_PATTERNS`.

Its production dependencies are `@onyourleft/domain` and **`earcut` 3.2.4 (ISC)**, which was already
in the lockfile through `maplibre-gl`.

## Fixtures

`src/fixtures/` holds a residential block with three footprints, a wood with a hole, a lake, a
sidewalk, a `building_part` with a `min_height`, a tile at each limit and one over each, and the
hostile tiles of `hostile.ts`. **No OpenStreetMap data of any kind**: rectangles, regular polygons
and evenly spaced points, for the reason `apps/web/browser/pmtiles-fixture.ts` gives. They are code
rather than committed binaries, and `fixtures.test.ts` pins the named ones by SHA-256.
