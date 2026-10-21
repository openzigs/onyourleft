// SPDX-License-Identifier: Apache-2.0

import { DEFAULT_DECODE_LIMITS, type DecodeLimits } from './limits';
import {
  longitudeAtColumn,
  latitudeAtRow,
  METRES_PER_DEGREE_LATITUDE,
  TILES_AT_Z15,
} from './projection';
import {
  bytesEqualAscii,
  Malformed,
  ProtoReader,
  WIRE_BYTES,
  WIRE_FIXED32,
  WIRE_FIXED64,
  WIRE_VARINT,
} from './protobuf';
import {
  BUILDING_KINDS,
  COORDINATE_BUFFER_EXTENTS,
  EARTH_LAYER,
  FOOTWAY_KIND,
  FOOTWAY_KIND_DETAILS,
  KEY_HEIGHT,
  KEY_KIND,
  KEY_KIND_DETAIL,
  KEY_MIN_HEIGHT,
  LAYER_GEOMETRY_TYPES,
  LAYER_KEPT_GEOMETRY,
  MAX_EXTENT,
  MAX_HEIGHT_METRES,
  MAX_KIND_LENGTH,
  MIN_EXTENT,
  MVT_VERSION,
  READ_LAYERS,
  GEOMETRY_LINE,
  type ReadLayer,
} from './schema';
import type {
  BuildingFeature,
  CorridorFrame,
  DecodedTile,
  DecodeRefusal,
  LandUseFeature,
  PathFeature,
  Ring,
  TileId,
} from './types';

/**
 * Decodes one z15 Protomaps v4 vector tile into bounded, typed features in the
 * corridor frame's local metres (#1544).
 *
 * `bytes` is the tile **already decompressed**: this package names no
 * decompressor, as it names no network. The result is either the features or
 * a {@link DecodeRefusal} — **never a throw** for anything the bytes contain.
 * A hostile tile is refused, inside the bounds of `limits`:
 *
 * - its size, before anything is read;
 * - every read layer's feature count, before any feature is decoded — the
 *   layers are framed first and their features counted by skipping;
 * - vertices, a feature and the tile, by a counting pass over every read
 *   layer's geometry before any of it is decoded: each command's count is
 *   checked **before** its parameters are skipped, so a feature claiming a
 *   million `LineTo`s costs one comparison and the output is never larger
 *   than `maxVerticesPerTile` vertices;
 * - rings a polygon, as each ring closes.
 *
 * Only the layers {@link READ_LAYERS} names are decoded; every other layer is
 * skipped by its length after its name is compared. Of those, only `kind`,
 * `kind_detail`, `height` and `min_height` are ever looked at (`schema.ts`).
 *
 * The frame is the game's (`projection.ts`), and the output is `Float32Array`:
 * a millimetre at 50 km from the origin, which is past the end of any corridor
 * read at once.
 */
export function decodeTile(
  bytes: Uint8Array,
  tile: TileId,
  origin: CorridorFrame,
  limits: DecodeLimits = DEFAULT_DECODE_LIMITS,
): DecodedTile | DecodeRefusal {
  if (
    tile.z !== 15 ||
    !Number.isInteger(tile.x) ||
    !Number.isInteger(tile.y) ||
    tile.x < 0 ||
    tile.y < 0 ||
    tile.x >= TILES_AT_Z15 ||
    tile.y >= TILES_AT_Z15
  ) {
    // A caller's error, not the tile's: the id comes from `corridorTileCover`.
    // The message names the constraint and never the values (ADR 0004 D).
    throw new RangeError('decodeTile: the tile id is not a z15 tile');
  }
  if (bytes.length > limits.maxBytes) {
    return { reason: 'too-large', bytes: bytes.length, limit: limits.maxBytes };
  }
  const state: DecodeState = { scratch: new Int32Array(256), layer: null, tileVertices: 0 };
  try {
    return decodeChecked(bytes, tile, origin, limits, state);
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    if (error instanceof Malformed) return { reason: 'malformed', layer: state.layer };
    throw error;
  }
}

/** A refusal raised from deep inside the walk, caught by {@link decodeTile}. */
class Refused extends Error {
  constructor(readonly refusal: DecodeRefusal) {
    super(refusal.reason);
  }
}

interface DecodeState {
  /** One scratch buffer for the part being read, shared by every feature; grown by doubling. */
  scratch: Int32Array;
  /** The read layer being decoded, for a `malformed` refusal. Only ever a {@link ReadLayer}. */
  layer: ReadLayer | null;
  tileVertices: number;
}

/** A read layer, framed: where its parts are, before any feature is decoded. */
interface FramedLayer {
  readonly name: ReadLayer;
  readonly extent: number;
  readonly features: Uint32Array; // start, end pairs
  readonly values: Uint32Array; // start, end pairs
  readonly keyCount: number;
  readonly keys: { kind: number; kindDetail: number; height: number; minHeight: number };
  /** Decoded values by index, filled as features ask for them. */
  readonly identifiers: Map<number, string | null>;
  readonly heights: Map<number, number | null>;
}

function decodeChecked(
  bytes: Uint8Array,
  tile: TileId,
  origin: CorridorFrame,
  limits: DecodeLimits,
  state: DecodeState,
): DecodedTile | DecodeRefusal {
  // 1. Frame the tile: the layers, by name, with no layer's body decoded.
  const reader = new ProtoReader(bytes, 0, bytes.length);
  const found = new Map<ReadLayer, { start: number; end: number }>();
  let sawEarth = false;
  while (!reader.atEnd()) {
    const tag = reader.uint32();
    if (tag >>> 3 === 3) {
      if ((tag & 7) !== WIRE_BYTES) throw new Malformed();
      const range = reader.bytes();
      const name = layerName(bytes, range.start, range.end);
      if (name === EARTH_LAYER) sawEarth = true;
      else if (name !== null) {
        if (found.has(name)) {
          state.layer = name;
          throw new Malformed();
        }
        found.set(name, range);
      }
    } else {
      reader.skip(tag & 7);
    }
  }
  if (!sawEarth && !found.has('water')) return { reason: 'wrong-schema' };

  // 2. Frame every read layer and count its features: the feature limit is
  // held for all four before any feature of any of them is decoded.
  const framed: FramedLayer[] = [];
  for (const name of READ_LAYERS) {
    const range = found.get(name);
    if (range === undefined) continue;
    state.layer = name;
    framed.push(frameLayer(bytes, name, range.start, range.end, limits));
  }

  // 3. Count every read layer's vertices, before any feature is decoded or
  // anything is allocated for one.
  for (const layer of framed) {
    state.layer = layer.name;
    countVertices(bytes, layer, limits, state);
  }

  // 4. Decode. Every count the walk meets has already been admitted.
  const landUse: LandUseFeature[] = [];
  const buildings: BuildingFeature[] = [];
  const paths: PathFeature[] = [];
  for (const layer of framed) {
    state.layer = layer.name;
    const project = new Projector(tile, origin, layer.extent);
    for (let f = 0; f < layer.features.length; f += 2) {
      decodeFeature(
        bytes,
        layer,
        layer.features[f] as number,
        layer.features[f + 1] as number,
        project,
        limits,
        state,
        { landUse, buildings, paths },
      );
    }
  }
  state.layer = null;
  return { tile, landUse, buildings, paths };
}

/** The layer's name if it is one this package reads or checks for, else `null`. Never decodes it. */
function layerName(bytes: Uint8Array, start: number, end: number): ReadLayer | 'earth' | null {
  const reader = new ProtoReader(bytes, start, end);
  let name: ReadLayer | 'earth' | null = null;
  let named = false;
  while (!reader.atEnd()) {
    const tag = reader.uint32();
    if (tag >>> 3 === 1) {
      if ((tag & 7) !== WIRE_BYTES || named) throw new Malformed();
      named = true;
      const range = reader.bytes();
      if (bytesEqualAscii(bytes, range.start, range.end, EARTH_LAYER)) name = 'earth';
      for (const candidate of READ_LAYERS) {
        if (bytesEqualAscii(bytes, range.start, range.end, candidate)) name = candidate;
      }
    } else {
      reader.skip(tag & 7);
    }
  }
  if (!named) throw new Malformed();
  return name;
}

function frameLayer(
  bytes: Uint8Array,
  name: ReadLayer,
  start: number,
  end: number,
  limits: DecodeLimits,
): FramedLayer {
  // First pass: count, so nothing is allocated for a layer over its limit.
  let featureCount = 0;
  let valueCount = 0;
  let version: number | null = null;
  let extent = 4096;
  const counter = new ProtoReader(bytes, start, end);
  while (!counter.atEnd()) {
    const tag = counter.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 2 || field === 3 || field === 4) {
      if (wire !== WIRE_BYTES) throw new Malformed();
      counter.bytes();
      if (field === 2) featureCount++;
      if (field === 4) valueCount++;
    } else if (field === 15 || field === 5) {
      if (wire !== WIRE_VARINT) throw new Malformed();
      const value = counter.uint32();
      if (field === 15) version = value;
      else extent = value;
    } else {
      counter.skip(wire);
    }
  }
  if (version !== MVT_VERSION) throw new Refused({ reason: 'wrong-schema' });
  if (extent < MIN_EXTENT || extent > MAX_EXTENT) throw new Malformed();
  if (featureCount > limits.maxFeaturesPerLayer) {
    throw new Refused({
      reason: 'too-many-features',
      layer: name,
      count: featureCount,
      limit: limits.maxFeaturesPerLayer,
    });
  }

  // Second pass: where each feature and value is, and which key index is which.
  const features = new Uint32Array(featureCount * 2);
  const values = new Uint32Array(valueCount * 2);
  const keys = { kind: -1, kindDetail: -1, height: -1, minHeight: -1 };
  let f = 0;
  let v = 0;
  let k = 0;
  const reader = new ProtoReader(bytes, start, end);
  while (!reader.atEnd()) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    if (field === 2 || field === 3 || field === 4) {
      const range = reader.bytes();
      if (field === 2) {
        features[f++] = range.start;
        features[f++] = range.end;
      } else if (field === 4) {
        values[v++] = range.start;
        values[v++] = range.end;
      } else {
        if (bytesEqualAscii(bytes, range.start, range.end, KEY_KIND)) keys.kind = k;
        else if (bytesEqualAscii(bytes, range.start, range.end, KEY_KIND_DETAIL))
          keys.kindDetail = k;
        else if (bytesEqualAscii(bytes, range.start, range.end, KEY_HEIGHT)) keys.height = k;
        else if (bytesEqualAscii(bytes, range.start, range.end, KEY_MIN_HEIGHT)) keys.minHeight = k;
        k++;
      }
    } else {
      reader.skip(tag & 7);
    }
  }
  return {
    name,
    extent,
    features,
    values,
    keyCount: k,
    keys,
    identifiers: new Map(),
    heights: new Map(),
  };
}

/**
 * Tile pixels to local metres, in the frame of `projection.ts`. `x` is linear
 * in the pixel column, so it is one multiply-add; `z` is Web Mercator in the
 * pixel row, so each row's value is computed once and cached: a tile has at
 * most three extents of rows, and its vertices share them.
 */
class Projector {
  private readonly xAtZero: number;
  private readonly xPerPixel: number;
  private readonly low: number;
  private readonly rows: Float64Array;

  constructor(
    private readonly tile: TileId,
    private readonly origin: CorridorFrame,
    private readonly extent: number,
  ) {
    const metresPerDegreeLongitude =
      METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
    const west = longitudeAtColumn(tile.x);
    const degreesPerTile = longitudeAtColumn(tile.x + 1) - west;
    this.xAtZero = (origin.longitude - west) * metresPerDegreeLongitude;
    this.xPerPixel = -(degreesPerTile / extent) * metresPerDegreeLongitude;
    this.low = -COORDINATE_BUFFER_EXTENTS * extent;
    this.rows = new Float64Array((2 * COORDINATE_BUFFER_EXTENTS + 1) * extent + 1).fill(Number.NaN);
  }

  /** Projects `part[0, length)` (tile pixels, `x, y` pairs) into a new ring of local metres. */
  project(part: Int32Array, length: number): Float32Array {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 2) {
      out[i] = this.xAtZero + (part[i] as number) * this.xPerPixel;
      const py = part[i + 1] as number;
      let z = this.rows[py - this.low] as number;
      if (Number.isNaN(z)) {
        const latitude = latitudeAtRow(this.tile.y + py / this.extent);
        z = (latitude - this.origin.latitude) * METRES_PER_DEGREE_LATITUDE;
        this.rows[py - this.low] = z;
      }
      out[i + 1] = z;
    }
    return out;
  }
}

interface Sinks {
  readonly landUse: LandUseFeature[];
  readonly buildings: BuildingFeature[];
  readonly paths: PathFeature[];
}

function decodeFeature(
  bytes: Uint8Array,
  layer: FramedLayer,
  start: number,
  end: number,
  project: Projector,
  limits: DecodeLimits,
  state: DecodeState,
  sinks: Sinks,
): void {
  const reader = new ProtoReader(bytes, start, end);
  let type = 0;
  let tags: { start: number; end: number } | null = null;
  let geometry: { start: number; end: number } | null = null;
  while (!reader.atEnd()) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 3) {
      if (wire !== WIRE_VARINT) throw new Malformed();
      type = reader.uint32();
    } else if (field === 2 || field === 4) {
      if (wire !== WIRE_BYTES) throw new Malformed();
      const range = reader.bytes();
      if (field === 2) tags = range;
      else geometry = range;
    } else {
      // Field 1 is the feature's id: skipped by its wire type and never read.
      reader.skip(wire);
    }
  }
  if (type === 0) return; // UNKNOWN: the spec lets a decoder ignore it.
  if (!LAYER_GEOMETRY_TYPES[layer.name].includes(type))
    throw new Refused({ reason: 'wrong-schema' });
  if (type !== LAYER_KEPT_GEOMETRY[layer.name]) return;

  const attributes = readTags(bytes, layer, tags);
  const kind = attributes.kind;
  if (kind === null && layer.name !== 'water') return;
  if (layer.name === 'buildings' && !(BUILDING_KINDS as readonly string[]).includes(kind ?? '')) {
    return;
  }
  const kindDetail = attributes.kindDetail ?? '';
  if (
    layer.name === 'roads' &&
    kind !== FOOTWAY_KIND &&
    !(FOOTWAY_KIND_DETAILS as readonly string[]).includes(kindDetail)
  ) {
    return;
  }
  if (geometry === null) throw new Malformed();
  const parts = decodeGeometry(bytes, geometry, type, layer, project, limits, state);
  switch (layer.name) {
    case 'landuse':
    case 'water':
      for (const rings of parts as Ring[][]) {
        sinks.landUse.push({ layer: layer.name, kind: kind ?? '', rings });
      }
      return;
    case 'buildings':
      for (const rings of parts as Ring[][]) {
        sinks.buildings.push({
          kind: kind as BuildingFeature['kind'],
          heightMetres: attributes.height,
          minHeightMetres: attributes.minHeight,
          rings,
        });
      }
      return;
    case 'roads':
      for (const line of parts as Float32Array[]) {
        sinks.paths.push({ kind: kind as string, kindDetail, line });
      }
      return;
  }
}

interface Attributes {
  kind: string | null;
  kindDetail: string | null;
  height: number | null;
  minHeight: number | null;
}

/** Reads the four keys' values. Every other key's value is skipped without being decoded. */
function readTags(
  bytes: Uint8Array,
  layer: FramedLayer,
  tags: { start: number; end: number } | null,
): Attributes {
  const out: Attributes = { kind: null, kindDetail: null, height: null, minHeight: null };
  if (tags === null) return out;
  const reader = new ProtoReader(bytes, tags.start, tags.end);
  const valueCount = layer.values.length / 2;
  while (!reader.atEnd()) {
    const key = reader.uint32();
    if (reader.atEnd()) throw new Malformed(); // an odd number of tag integers
    const value = reader.uint32();
    if (key >= layer.keyCount || value >= valueCount) throw new Malformed();
    if (key === layer.keys.kind) out.kind = cachedIdentifier(bytes, layer, value);
    else if (key === layer.keys.kindDetail) out.kindDetail = cachedIdentifier(bytes, layer, value);
    else if (key === layer.keys.height) out.height = cachedHeight(bytes, layer, value);
    else if (key === layer.keys.minHeight) out.minHeight = cachedHeight(bytes, layer, value);
  }
  return out;
}

/**
 * Values are shared between features — a downtown tile's 13,000 footprints
 * carry one `building` value — so each is decoded once a layer.
 */
function cachedIdentifier(bytes: Uint8Array, layer: FramedLayer, index: number): string | null {
  let value = layer.identifiers.get(index);
  if (value === undefined) {
    value = identifierValue(bytes, layer, index);
    layer.identifiers.set(index, value);
  }
  return value;
}

function cachedHeight(bytes: Uint8Array, layer: FramedLayer, index: number): number | null {
  let value = layer.heights.get(index);
  if (value === undefined) {
    value = heightValue(bytes, layer, index);
    layer.heights.set(index, value);
  }
  return value;
}

/** A string value that is a Protomaps identifier (`[a-z0-9_]{1,64}`), else `null`. */
function identifierValue(bytes: Uint8Array, layer: FramedLayer, index: number): string | null {
  const reader = new ProtoReader(
    bytes,
    layer.values[index * 2] as number,
    layer.values[index * 2 + 1] as number,
  );
  let result: string | null = null;
  while (!reader.atEnd()) {
    const tag = reader.uint32();
    if (tag >>> 3 === 1 && (tag & 7) === WIRE_BYTES) {
      const range = reader.bytes();
      result = asciiIdentifier(bytes, range.start, range.end);
    } else {
      reader.skip(tag & 7);
      result = null;
    }
  }
  return result;
}

function asciiIdentifier(bytes: Uint8Array, start: number, end: number): string | null {
  const length = end - start;
  if (length < 1 || length > MAX_KIND_LENGTH) return null;
  let text = '';
  for (let i = start; i < end; i++) {
    const byte = bytes[i] as number;
    const ok = (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte === 0x5f;
    if (!ok) return null;
    text += String.fromCharCode(byte);
  }
  return text;
}

/** A numeric value in `[0, MAX_HEIGHT_METRES]`, else `null`. */
function heightValue(bytes: Uint8Array, layer: FramedLayer, index: number): number | null {
  const reader = new ProtoReader(
    bytes,
    layer.values[index * 2] as number,
    layer.values[index * 2 + 1] as number,
  );
  let result: number | null = null;
  while (!reader.atEnd()) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 2 && wire === WIRE_FIXED32) result = reader.fixed32Float();
    else if (field === 3 && wire === WIRE_FIXED64) result = reader.fixed64Double();
    else if (field === 4 && wire === WIRE_VARINT) result = reader.int64();
    else if (field === 5 && wire === WIRE_VARINT) result = reader.uint64();
    else if (field === 6 && wire === WIRE_VARINT) result = reader.sint64();
    else {
      reader.skip(wire);
      result = null;
    }
  }
  if (result === null || !Number.isFinite(result) || result < 0 || result > MAX_HEIGHT_METRES) {
    return null;
  }
  return result;
}

/**
 * The vertex limits, held over every feature of the layer whatever its type,
 * kind or fate — the measured figures in `limits.ts` were taken the same way.
 * Each command's count is checked **before** its parameters are skipped, and
 * the parameters are skipped, not decoded, so a feature claiming a million
 * `LineTo`s costs one comparison, and a tile over the limit is refused before
 * a single vertex has been projected or stored.
 */
function countVertices(
  bytes: Uint8Array,
  layer: FramedLayer,
  limits: DecodeLimits,
  state: DecodeState,
): void {
  for (let f = 0; f < layer.features.length; f += 2) {
    const feature = new ProtoReader(
      bytes,
      layer.features[f] as number,
      layer.features[f + 1] as number,
    );
    let geometry: { start: number; end: number } | null = null;
    while (!feature.atEnd()) {
      const tag = feature.uint32();
      if (tag >>> 3 === 4 && (tag & 7) === WIRE_BYTES) geometry = feature.bytes();
      else feature.skip(tag & 7);
    }
    if (geometry === null) continue;
    const reader = new ProtoReader(bytes, geometry.start, geometry.end);
    let featureVertices = 0;
    while (!reader.atEnd()) {
      const command = reader.uint32();
      const id = command & 7;
      const count = command >>> 3;
      if (id !== MOVE_TO && id !== LINE_TO) continue;
      if (featureVertices + count > limits.maxVerticesPerFeature) {
        throw new Refused({
          reason: 'too-many-vertices',
          layer: layer.name,
          limit: limits.maxVerticesPerFeature,
        });
      }
      if (state.tileVertices + featureVertices + count > limits.maxVerticesPerTile) {
        throw new Refused({
          reason: 'too-many-vertices',
          layer: layer.name,
          limit: limits.maxVerticesPerTile,
        });
      }
      featureVertices += count;
      reader.skipVarints(count * 2);
    }
    state.tileVertices += featureVertices;
  }
}

const MOVE_TO = 1;
const LINE_TO = 2;
const CLOSE_PATH = 7;

/**
 * Walks one feature's geometry commands (MVT spec 2.1 §4.3) and returns its
 * polygons (`[outer, ...holes]` each) or its lines, projected.
 *
 * Every count is checked against the limits before its parameters are read,
 * and every coordinate against the layer's extent and buffer, so the walk is
 * bounded by the limits whatever the bytes claim.
 */
function decodeGeometry(
  bytes: Uint8Array,
  range: { start: number; end: number },
  type: number,
  layer: FramedLayer,
  project: Projector,
  limits: DecodeLimits,
  state: DecodeState,
): Ring[][] | Float32Array[] {
  const reader = new ProtoReader(bytes, range.start, range.end);
  const low = -COORDINATE_BUFFER_EXTENTS * layer.extent;
  const high = (1 + COORDINATE_BUFFER_EXTENTS) * layer.extent;
  const isLine = type === GEOMETRY_LINE;
  let cx = 0;
  let cy = 0;
  /**
   * The part being read, in tile pixels, as `part[0, used)`. `open` is false
   * before the first MoveTo and after a ClosePath. The buffer grows by
   * doubling, and only as far as `countVertices` has already admitted.
   */
  let part = state.scratch;
  let used = 0;
  let open = false;
  const lines: Float32Array[] = [];
  const polygons: Ring[][] = [];
  let polygon: Ring[] | null = null;

  const finishLine = (): void => {
    if (!open) return;
    if (used < 4) throw new Malformed();
    lines.push(project.project(part, used));
    open = false;
  };

  while (!reader.atEnd()) {
    const command = reader.uint32();
    const id = command & 7;
    const count = command >>> 3;
    if (count === 0) throw new Malformed();
    if (id === MOVE_TO || id === LINE_TO) {
      if (id === MOVE_TO) {
        if (count !== 1) throw new Malformed();
        if (isLine) finishLine();
        else if (open) throw new Malformed(); // a ring left open
        open = true;
        used = 0;
      } else if (!open) {
        throw new Malformed(); // a LineTo with no MoveTo before it
      }
      if (used + count * 2 > part.length) {
        let size = part.length * 2;
        while (size < used + count * 2) size *= 2;
        const grown = new Int32Array(size);
        grown.set(part.subarray(0, used));
        part = grown;
        state.scratch = grown;
      }
      for (let i = 0; i < count; i++) {
        cx += zigzag(reader.uint32());
        cy += zigzag(reader.uint32());
        if (cx < low || cx > high || cy < low || cy > high) throw new Malformed();
        part[used++] = cx;
        part[used++] = cy;
      }
    } else if (id === CLOSE_PATH) {
      if (isLine || count !== 1 || !open || used < 6) throw new Malformed();
      const area = signedArea(part, used);
      if (area > 0) {
        polygon = [project.project(part, used)];
        polygons.push(polygon);
      } else if (area < 0) {
        if (polygon === null) throw new Malformed(); // a hole before any outer ring
        if (polygon.length + 1 > limits.maxRingsPerPolygon) {
          throw new Refused({
            reason: 'too-many-rings',
            layer: layer.name,
            limit: limits.maxRingsPerPolygon,
          });
        }
        polygon.push(project.project(part, used));
      }
      // A ring of zero area is dropped: it has no inside to place or draw.
      open = false;
    } else {
      throw new Malformed();
    }
  }
  if (isLine) finishLine();
  else if (open) throw new Malformed(); // the last ring never closed
  return isLine ? lines : polygons;
}

function zigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/** The surveyor's formula in tile pixels (y down): positive is an outer ring (MVT spec 2.1 §4.3.4.4). */
function signedArea(part: Int32Array, used: number): number {
  let sum = 0;
  for (let i = 0; i < used; i += 2) {
    const j = (i + 2) % used;
    sum +=
      (part[i] as number) * (part[j + 1] as number) - (part[j] as number) * (part[i + 1] as number);
  }
  return sum / 2;
}
