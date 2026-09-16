// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A PMTiles v3 archive, built from nothing, so the browser gate has a basemap.
 *
 * ## Why this exists
 *
 * #63's eighth acceptance criterion is *"Cold-load behaviour is measured and
 * recorded in the PR: time to first painted tile on a cold cache."* Two of that
 * sentence's words could not be reached before this file: there was **no
 * archive**, so no tile was ever painted and there was nothing to time.
 * `map.browser.spec.ts` said so in its own words — the archive request 404s, so
 * the gate asserts the routing rather than the picture, and *"the day #53 lands,
 * that test goes red — which is the right moment for somebody to come back and
 * replace it with one that asserts tiles actually drew."*
 *
 * This is that moment arriving from the other direction. #53 publishes a
 * **real** archive of the whole planet to a **real** host, and it is blocked on
 * #52, which is Phase 3. What #53 does *not* own is the client's own cost:
 * fetching a 127-byte header, a root directory and a tile over a range request,
 * decoding an MVT, and handing it to a GL pipeline. That half is ours, it is
 * measurable today, and measuring it is what lets the hosted number — when it
 * exists — be read as *latency* rather than as an unexplained total.
 *
 * ⚠️ **So this does NOT discharge criterion 8, and must not be reported as
 * doing so.** Serving from the loopback interface removes the one term the
 * criterion is pointed at: ADR 0010 D-1 and #53 both quote Protomaps' warning
 * that R2 is *"known to have higher latency (500 ms or higher)"*, and a
 * localhost measurement is silent about that by construction. What it gives is
 * the **floor** — the part of the number that would remain if the host were
 * infinitely fast — and a harness that is already in place to take the hosted
 * measurement the day there is a host.
 *
 * ## Why an encoder rather than a committed binary
 *
 * `packages/fit`'s corpus is the precedent in this repository, and it is
 * committed **and** generated from a deterministic generator, so that "the
 * fixture" and "what the generator writes" cannot drift. Here the archive is
 * not committed at all: it is emitted into `browser/dist` at build time by
 * `vite.browser.config.ts`, which is gitignored and pruned by
 * `scripts/check-repo-rules.sh` already. A binary in the tree would need an
 * `.spdx-exempt` entry it does not qualify for (§3a: the one reason is
 * third-party generator output) and would be a file nobody can read in review.
 *
 * ## What is in the archive, and what is deliberately not
 *
 * **One tile.** Every tile id from zoom 0 to {@link FIXTURE_MAX_ZOOM} resolves
 * to the same bytes, through a single directory entry whose run length spans
 * the lot — which is PMTiles' own deduplication doing exactly what it is for.
 * That is what makes the fixture independent of where the map happens to be
 * looking: `fitBounds` on the harness track picks a zoom, MapLibre asks for
 * whichever tiles cover the viewport, and every one of them exists.
 *
 * **No OpenStreetMap data of any kind.** Three rectangles and a line, drawn
 * from arithmetic in this file. That matters beyond tidiness: ODbL attribution
 * attaches to a Produced Work derived from OSM, and a fixture that carried a
 * scrap of real coastline would quietly make this repository's build output a
 * derivative. It carries none, so no attribution obligation attaches to the
 * archive. (The **product's** attribution is a separate criterion, asserted in
 * `MapPanel.test.tsx` and `map.a11y.test.tsx`, and nothing here touches it.)
 *
 * **No compression.** `Compression.None` for both the internal directories and
 * the tile bodies, which the spec admits and the decoder takes as a pass-through
 * — so this file needs no gzip implementation and the gate needs no
 * `DecompressionStream`. ⚠️ It also means the measurement below is of an
 * **uncompressed** tile. A real basemap tile is gzipped, so the hosted number
 * will carry a decompression term this one does not; said out loud because a
 * reader comparing the two otherwise has no way to know.
 *
 * ## Provenance
 *
 * Every field offset, enum value and varint column below comes from the PMTiles
 * v3 specification (`protomaps/PMTiles:spec/v3/spec.md`), which is **public
 * domain / CC0** — #63's own context table records that, and it is the reason
 * this can be written from the document rather than from anyone's source. The
 * vector-tile encoding comes from the Mapbox Vector Tile specification 2.1,
 * which is CC-BY-3.0 for the prose and whose wire format is a protobuf schema.
 * Nothing was copied from an implementation; §6's rule about prior art applies
 * here as everywhere.
 */

/** The file the harness build emits, and the path the gate asks for. */
export const FIXTURE_ARCHIVE_FILE = 'basemap-fixture.pmtiles';

/**
 * The deepest zoom the archive claims to hold.
 *
 * It claims *every* tile to this depth and holds one, so the number's only job
 * is to be at least as deep as any view the gate opens. MapLibre clamps a
 * request to a source's `maxzoom` and overzooms beyond it, so a view zoomed
 * further in than this still draws — it draws a stretched copy of the same
 * tile, which is the correct behaviour for a source that has run out of detail
 * and is exactly what a real archive does past z15.
 */
export const FIXTURE_MAX_ZOOM = 14;

/**
 * The source layers the fixture fills.
 *
 * ⚠️ **Asserted against the real style, in `pmtiles-fixture.test.ts`, rather
 * than kept in step by hand.** A `source-layer` in `basemapStyle` that this
 * archive does not carry is a layer the browser gate can never see paint — the
 * map would render, the assertion would pass on some *other* layer's pixels,
 * and the new one would be covered by nothing. The test requires the two sets
 * to be equal, so adding a layer to the style fails here until the fixture
 * carries it.
 *
 * Written here rather than imported from `basemap.ts` because this module is
 * bundled into `vite.browser.config.ts`, which Vite loads in Node — and
 * `basemap.ts` names `import.meta.env`. Keeping this file dependency-free is
 * what lets one module serve the build, the unit suite and the gate.
 */
export const FIXTURE_SOURCE_LAYERS = ['earth', 'water', 'roads'] as const;

/**
 * The MVT coordinate extent, in tile units.
 *
 * 4096 is the value every published basemap uses and the one MapLibre assumes
 * when a layer omits the field. It is written into the tile regardless: a
 * default that is relied upon rather than stated is a defect waiting for the
 * default to change.
 */
const EXTENT = 4096;

/**
 * How far each polygon is drawn past the tile edge, in tile units.
 *
 * ⚠️ **Not decoration.** A fill that stops exactly on the tile boundary meets
 * its neighbour's fill on a shared edge, and the rasteriser antialiases both
 * sides of it — which leaves a one-pixel seam of whatever is underneath, at
 * every tile join, on a page whose whole assertion is "what colour is this
 * pixel". Drawing past the edge makes the two overlap. Real vector tiles carry
 * a buffer for the same reason.
 */
const EDGE_BUFFER = 64;

/**
 * MVT geometry types, from the Mapbox Vector Tile specification 2.1 §4.3.4.
 *
 * `POINT` is 1 and is absent here because the fixture has no point feature to
 * declare it for — an unused constant is a compile error under `noUnusedLocals`,
 * and a name that documents a format this file does not write is a worse thing
 * to keep than a gap in a numbering.
 */
const GEOMETRY_LINESTRING = 2;
const GEOMETRY_POLYGON = 3;

/** PMTiles v3 header, §"Header". Fixed size, so every offset below is absolute. */
const HEADER_BYTES = 127;

/** `Compression.None`, PMTiles v3 §"Compression". */
const COMPRESSION_NONE = 1;

/** `TileType.Mvt`, PMTiles v3 §"Tile Type". */
const TILE_TYPE_MVT = 1;

/** Coordinates are stored as signed 32-bit integers scaled by 1e7. */
const COORDINATE_SCALE = 10_000_000;

/**
 * The latitude Web Mercator stops at.
 *
 * `atan(sinh(π))` in degrees. Written to the precision the header's `int32`
 * can carry rather than rounded to 85.05, so the archive's declared bounds are
 * the projection's own rather than an approximation of them — MapLibre reads
 * these into the source's `bounds` and clips against them.
 */
const MERCATOR_LATITUDE_LIMIT = 85.0511287;

/** A point in a tile's own coordinate space. */
interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** One feature, already reduced to its command/parameter integers. */
interface EncodedFeature {
  readonly type: number;
  readonly geometry: readonly number[];
}

/**
 * Zigzag encoding, MVT 2.1 §4.3.2.
 *
 * `(n << 1) ^ (n >> 31)` — the arithmetic shift is what maps a negative to an
 * odd positive, so a parameter integer is always a plain varint.
 */
function zigzag(value: number): number {
  return (value << 1) ^ (value >> 31);
}

/**
 * A base-128 varint.
 *
 * ⚠️ Arithmetic rather than bitwise, deliberately. JavaScript's bitwise
 * operators coerce to **signed 32 bits**, and the run length this file writes
 * for a full zoom-14 pyramid is 357,913,941 — which fits, today, and would stop
 * fitting the moment {@link FIXTURE_MAX_ZOOM} reached 16. A varint writer that
 * is correct only for the values it currently sees is the kind of latent defect
 * that surfaces as a corrupt archive rather than as an error.
 */
function writeVarint(out: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`a varint must be a non-negative safe integer, not ${String(value)}`);
  }
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining % 0x80) + 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  out.push(remaining);
}

/** A protobuf field key: the field number and the wire type, as one varint. */
function writeKey(out: number[], field: number, wireType: number): void {
  writeVarint(out, field * 8 + wireType);
}

/** A length-delimited field — wire type 2 — carrying already-encoded bytes. */
function writeBytesField(out: number[], field: number, bytes: readonly number[]): void {
  writeKey(out, field, 2);
  writeVarint(out, bytes.length);
  // A loop rather than `push(...bytes)`: spreading a large array into a call
  // is how a fixture generator meets the argument-count limit, and a tile that
  // grows is the least interesting way to discover it.
  for (const byte of bytes) {
    out.push(byte);
  }
}

/** A varint field — wire type 0. */
function writeVarintField(out: number[], field: number, value: number): void {
  writeKey(out, field, 0);
  writeVarint(out, value);
}

/**
 * A run of varints, as bytes — MVT's packed `geometry` column.
 *
 * ⚠️ **The one conversion it is easy to leave out, and leaving it out is
 * silent.** A command integer is a *number*, not a byte: `LineTo` for three
 * vertices is 26, but the parameter beside it is 8,448. Handing the command
 * list straight to {@link writeBytesField} stores each one modulo 256 — 8,448
 * becomes 0 and 8,447 becomes 255 — and the result is still a well-formed
 * protobuf, still a well-formed PMTiles archive, and still parses into the
 * right *number* of vertices. It is the winding assertion in
 * `pmtiles-fixture.test.ts` that catches it, because the vertices are all at
 * the wrong place and the ring's area collapses to zero. This function existing
 * separately is what makes that mistake unavailable rather than merely tested
 * for.
 */
function packVarints(values: readonly number[]): readonly number[] {
  const packed: number[] = [];
  for (const value of values) {
    writeVarint(packed, value);
  }
  return packed;
}

/** A UTF-8 string field. ASCII only here, which every layer name below is. */
function writeStringField(out: number[], field: number, value: string): void {
  const bytes: number[] = [];
  for (const unit of new TextEncoder().encode(value)) {
    bytes.push(unit);
  }
  writeBytesField(out, field, bytes);
}

/**
 * A closed ring, as MVT command and parameter integers.
 *
 * MVT 2.1 §4.3.3.3: a ring is `MoveTo(1)` to its first vertex, `LineTo(n-1)`
 * for the rest, then `ClosePath` — and the closing vertex is **not** repeated,
 * because `ClosePath` supplies it. The winding decides the ring's role: the
 * surveyor's formula over the vertices below is positive, which the
 * specification defines as an **exterior** ring. Reverse it and MapLibre reads
 * a hole, draws nothing, and the gate reports "no tile painted" for a tile that
 * arrived perfectly.
 */
function ring(points: readonly TilePoint[]): readonly number[] {
  const commands: number[] = [];
  let cursorX = 0;
  let cursorY = 0;
  const first = points[0];
  if (first === undefined) {
    throw new RangeError('a ring needs at least one vertex');
  }
  // MoveTo, one vertex. `(1 & 0x7) | (1 << 3)`.
  commands.push(9, zigzag(first.x - cursorX), zigzag(first.y - cursorY));
  cursorX = first.x;
  cursorY = first.y;
  const rest = points.slice(1);
  // LineTo, the remaining vertices. `(2 & 0x7) | (count << 3)`.
  commands.push(2 + rest.length * 8);
  for (const point of rest) {
    commands.push(zigzag(point.x - cursorX), zigzag(point.y - cursorY));
    cursorX = point.x;
    cursorY = point.y;
  }
  // ClosePath, one. `(7 & 0x7) | (1 << 3)`.
  commands.push(15);
  return commands;
}

/** An axis-aligned rectangle as an exterior ring, in tile units. */
function rectangle(west: number, north: number, east: number, south: number): readonly number[] {
  return ring([
    { x: west, y: north },
    { x: east, y: north },
    { x: east, y: south },
    { x: west, y: south },
  ]);
}

/** An open line, as MVT command and parameter integers. */
function line(points: readonly TilePoint[]): readonly number[] {
  const commands: number[] = [];
  const first = points[0];
  if (first === undefined) {
    throw new RangeError('a line needs at least one vertex');
  }
  commands.push(9, zigzag(first.x), zigzag(first.y));
  let cursorX = first.x;
  let cursorY = first.y;
  const rest = points.slice(1);
  commands.push(2 + rest.length * 8);
  for (const point of rest) {
    commands.push(zigzag(point.x - cursorX), zigzag(point.y - cursorY));
    cursorX = point.x;
    cursorY = point.y;
  }
  return commands;
}

/**
 * One MVT layer.
 *
 * No `keys` and no `values`: the style has no filter and no data-driven paint,
 * so a feature in this fixture has no properties to carry. A tag column that
 * nothing reads would be bytes in a measurement that is partly about bytes.
 */
function encodeLayer(name: string, features: readonly EncodedFeature[]): readonly number[] {
  const layer: number[] = [];
  writeStringField(layer, 1, name);
  for (const feature of features) {
    const body: number[] = [];
    writeVarintField(body, 3, feature.type);
    writeBytesField(body, 4, packVarints(feature.geometry));
    writeBytesField(layer, 2, body);
  }
  writeVarintField(layer, 5, EXTENT);
  // Field 15. Stated rather than defaulted — see {@link EXTENT}.
  writeVarintField(layer, 15, 2);
  return layer;
}

/**
 * The one tile every id in the archive resolves to.
 *
 * Three layers, matching {@link FIXTURE_SOURCE_LAYERS} and therefore the three
 * the style reads:
 *
 * - **`earth`** — the whole tile, so *some* basemap colour is on screen at any
 *   zoom, at any crop, however the harness track happens to have framed itself.
 *   A fixture whose visible colour depended on where the viewport landed would
 *   be a gate that goes red for a reason no one can act on.
 * - **`water`** — the middle quarter, drawn over the earth. It exists so that
 *   "a tile drew" is not one colour's word: two layers from the same tile,
 *   painted in the style's own order, is a much harder thing to produce by
 *   accident than one flat fill.
 * - **`roads`** — a line across the middle, which is the only feature here that
 *   is not a polygon. It is what stops the encoder being proved by rectangles
 *   alone.
 */
export function fixtureTile(): Uint8Array {
  const outer = EXTENT + EDGE_BUFFER;
  const inner = EXTENT / 4;
  const layers: Record<string, readonly EncodedFeature[]> = {
    earth: [
      {
        type: GEOMETRY_POLYGON,
        geometry: rectangle(-EDGE_BUFFER, -EDGE_BUFFER, outer, outer),
      },
    ],
    water: [
      {
        type: GEOMETRY_POLYGON,
        geometry: rectangle(inner, inner, EXTENT - inner, EXTENT - inner),
      },
    ],
    roads: [
      {
        type: GEOMETRY_LINESTRING,
        geometry: line([
          { x: -EDGE_BUFFER, y: EXTENT / 2 },
          { x: outer, y: EXTENT / 2 },
        ]),
      },
    ],
  };

  const tile: number[] = [];
  for (const name of FIXTURE_SOURCE_LAYERS) {
    const features = layers[name];
    if (features === undefined) {
      throw new RangeError(`no geometry was built for the declared source layer ${name}`);
    }
    writeBytesField(tile, 3, encodeLayer(name, features));
  }
  return Uint8Array.from(tile);
}

/**
 * How many tiles a full pyramid holds from zoom 0 to `maxZoom` inclusive.
 *
 * `(4^(z+1) - 1) / 3`. This is the run length of the archive's single entry —
 * PMTiles orders tile ids by zoom and then along a Hilbert curve, so ids
 * `0 … count-1` are precisely every tile at every zoom up to `maxZoom`, and one
 * entry covering all of them is one tile serving all of them.
 */
export function pyramidTileCount(maxZoom: number): number {
  return (4 ** (maxZoom + 1) - 1) / 3;
}

/**
 * The root directory: one entry, four varint columns.
 *
 * PMTiles v3 §"Directory": the entries are written column-wise — ids as deltas
 * from the previous id, then run lengths, then lengths, then offsets. ⚠️ The
 * offset column stores **offset + 1**, because a stored `0` means "immediately
 * after the previous entry" for every entry but the first. Storing a literal
 * zero here reads back as offset `-1`, which is a range request for a byte
 * before the file and an archive that fails with no clue why.
 */
function rootDirectory(tileLength: number, runLength: number): readonly number[] {
  const directory: number[] = [];
  writeVarint(directory, 1);
  // Tile id column: the first entry's delta from zero.
  writeVarint(directory, 0);
  writeVarint(directory, runLength);
  writeVarint(directory, tileLength);
  writeVarint(directory, 1);
  return directory;
}

/**
 * The archive's JSON metadata.
 *
 * ⚠️ **MapLibre never reads this on the path the client uses.** `maplibre.ts`
 * builds `new Protocol()` with no options, whose `metadata` flag is therefore
 * off, so the TileJSON it synthesises comes from the header alone and this
 * section is never fetched. It is written because the format has a section for
 * it and an archive without one is malformed — and because
 * `pmtiles-fixture.test.ts` reads it back, which is the only assertion that
 * would notice the offset or length being wrong.
 *
 * It carries **no attribution field**, deliberately: there is no OSM data in
 * this archive to attribute, and a fixture that claimed otherwise would put a
 * false licence notice into a build artefact.
 */
function metadataJson(): string {
  return JSON.stringify({
    name: 'on-your-left browser-gate fixture',
    description: 'Synthetic geometry. Contains no OpenStreetMap data.',
    vector_layers: FIXTURE_SOURCE_LAYERS.map((id) => ({
      id,
      fields: {},
      minzoom: 0,
      maxzoom: FIXTURE_MAX_ZOOM,
    })),
  });
}

/** A signed coordinate, scaled and rounded the way the header stores it. */
function scaled(degrees: number): number {
  return Math.round(degrees * COORDINATE_SCALE);
}

/**
 * The whole archive, as bytes.
 *
 * The layout is header → root directory → JSON metadata → tile data, with no
 * leaf directories: one entry fits in the root many times over, and the spec's
 * requirement that the root lie inside the first 16,384 bytes — so a client can
 * prefetch header and directory in one range request — is met by a very wide
 * margin. That prefetch is the reason the cold-load number below is two round
 * trips rather than three.
 */
export function buildFixtureArchive(): Uint8Array {
  const tile = fixtureTile();
  const metadata = new TextEncoder().encode(metadataJson());
  const runLength = pyramidTileCount(FIXTURE_MAX_ZOOM);
  const directory = rootDirectory(tile.length, runLength);

  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + directory.length;
  const tileDataOffset = metadataOffset + metadata.length;
  const total = tileDataOffset + tile.length;

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  // Magic. PMTiles v3 §"Header": the seven ASCII bytes `PMTiles`, then the
  // spec version. The decoder checks only the first two of them, which is why
  // the other five are worth getting right from the document rather than from
  // what a reader happens to accept.
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);

  const setUint64 = (offset: number, value: number): void => {
    // Little-endian, split rather than `setBigUint64`, so nothing in this file
    // needs a `BigInt` for numbers that are all comfortably safe integers.
    view.setUint32(offset, value % 0x1_0000_0000, true);
    view.setUint32(offset + 4, Math.floor(value / 0x1_0000_0000), true);
  };

  setUint64(8, rootOffset);
  setUint64(16, directory.length);
  setUint64(24, metadataOffset);
  setUint64(32, metadata.length);
  // No leaf directories. The offset still points somewhere sane rather than at
  // zero: a client that range-requests a zero-length region at the start of the
  // file is asking for the header back.
  setUint64(40, tileDataOffset);
  setUint64(48, 0);
  setUint64(56, tileDataOffset);
  setUint64(64, tile.length);
  // Addressed tiles: every id the archive answers for. Entries and contents:
  // one each, which is the deduplication ratio written down.
  setUint64(72, runLength);
  setUint64(80, 1);
  setUint64(88, 1);

  view.setUint8(96, 1);
  view.setUint8(97, COMPRESSION_NONE);
  view.setUint8(98, COMPRESSION_NONE);
  view.setUint8(99, TILE_TYPE_MVT);
  view.setUint8(100, 0);
  view.setUint8(101, FIXTURE_MAX_ZOOM);
  view.setInt32(102, scaled(-180), true);
  view.setInt32(106, scaled(-MERCATOR_LATITUDE_LIMIT), true);
  view.setInt32(110, scaled(180), true);
  view.setInt32(114, scaled(MERCATOR_LATITUDE_LIMIT), true);
  view.setUint8(118, 0);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);

  bytes.set(Uint8Array.from(directory), rootOffset);
  bytes.set(metadata, metadataOffset);
  bytes.set(tile, tileDataOffset);
  return bytes;
}
