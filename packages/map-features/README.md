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
| `src/decode.ts` | `decodeTile`: the four layers ADR 0054 D-2.2 reads, and of each only `kind`, `kind_detail`, `height`, `min_height` and the geometry; and since #1632 ([ADR 0055](../../docs/adr/0055-place-kinds-and-ranks-from-the-corridor-never-a-name.md)) `places`, of which only `kind`, `kind_detail`, `population_rank` and the point, never a name; and since #1789 (ADR 0054's entry of 2026-11-01) the twelve building fields #1557's archive writes on `buildings`, each whitelisted or clamped at read and `null` where it cannot be; and since #2892 (ADR 0091 D-2) a street's `oneway`, `access` and `is_link`, each its default where the tile's value is not recognised; and since #2975 (ADR 0054's entry of 2026-11-21, proposed) `pois`, of which only `kind` and the point, matched to a footprint (`poi-match.ts`) and kept only as that footprint's `poi` — a shop, a café or a fuel station — never a name, a brand or the point. A refusal, never a throw |
| `src/limits.ts` | The five bounds, with what each sits above on the published archive, and the counts of places (#1632) and of POIs (#2975) kept a tile, at which the decoder stops |
| `src/poi-match.ts` | `matchPoisToBuildings` (#2975): a POI is the footprint's that holds it, or the nearest within 3 m (a shop, a café) or 30 m (a fuel station's forecourt); never a `building_part`'s |
| `src/schema.ts` | What is read: the layers, the keys, the geometry types each layer carries, the footway set (#1551), the building fields' rules, `BUILDING_FIELD_RULES` (#1789), and the POI classes, `POI_CLASS_OF_KIND` (#2975) |
| `src/protobuf.ts` | A bounded protobuf reader: every read is inside its message or a refusal |
| `src/refusal.ts` | `describeRefusal`: the layer and the limit, never a coordinate or the tile's `x`/`y` (ADR 0004 D) |
| `src/projection.ts` | The game's projection, restated (see below) |
| `src/cover.ts` | `corridorTileCover`: the z15 tiles a route's corridor touches, in route order, capped |
| `src/geometry.ts` | `simplifyRing`, `clipToBox`, `triangulate` (earcut), `rasterise` |
| `src/street-graph.ts` | `StreetGraph` (#2894, ADR 0091): the open-world ride's street graph, built a tile at a time from decoded streets: clipped to each tile, snapped, crossed, T-snapped and stitched across seams, tiles added and removed without rebuilding the others, and bounded a tile and in total. It follows streets and plans no route (ADR 0091 D-6). `oneway` is kept on each edge and never removes a way on (D-5) |
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
- **The building fields (#1789) are looked up in `buildings` alone**, by the same byte comparison,
  and no tile string is kept: an enum value is compared byte for byte with its whitelist and kept as
  the list's own constant, a number is clamped (or, for a palette index, kept only inside the
  palette), and a string where a number belongs is `null` — never parsed. A field never refuses a
  tile or drops a footprint.
- **The road fields (#2892, ADR 0091 D-2, accepted on its pull request #2951) are looked up in
  `roads` alone** and kept on a street only, for the open-world street graph.
  Each is compared byte for byte with `schema.ts`' lists and kept as a constant of the decoder's
  own; no tile string is kept. A value the lists do not name — another string, a number where a
  string belongs, a string where a boolean belongs — is the field's default (`NO_ROAD_FIELDS`) and
  is counted in `DecodedTile.roadValuesDefaulted`; it never refuses the tile or drops the street.
  `name`, `ref`, `network*`, `shield_text*`, `service` and `min_zoom` stay unread.

  | Field on `DecodedStreetFeature` | Tile key | Values | Default |
  |---|---|---|---|
  | `oneway` | `oneway` | `'with-line'` for `yes` (along the line's vertex order), `'against-line'` for `-1`, `'no'` for `no` | `'no'` |
  | `access` | `access` | `'no'` and `'private'` as themselves; `yes`, `permissive`, `destination` and `customers` as `'open'` | `'open'` |
  | `isLink` | `is_link` | a boolean | `false` |

  `oneway` is a fact about the street and never removes a turn (ADR 0091 D-5). A corridor's packed
  streets keep the plain `StreetFeature`, without these fields.
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
sidewalk, a `building_part` with a `min_height`, footprints with every building field set (#1789), streets carrying each road field (#2892), a
tile at each limit and one over each, and the hostile tiles of `hostile.ts`, among them a hostile value
under each building field's key and each road field's, and the street graph's shapes
(`street-graph.ts`: a T-junction, a crossroads, a bridge and a tunnel, a junction on a seam, a
roundabout, a loop, a dead end, a one-way pair, the ways the graph leaves out, and many streets
through one point). **No OpenStreetMap data of any kind**: rectangles, regular polygons
and evenly spaced points, for the reason `apps/web/browser/pmtiles-fixture.ts` gives. They are code
rather than committed binaries, and `fixtures.test.ts` pins the named ones by SHA-256.
