// SPDX-License-Identifier: Apache-2.0

/**
 * A deterministic Mapbox Vector Tile encoder, for this package's fixtures
 * (#1544).
 *
 * It writes the bytes a Protomaps v4 tile would carry, from arithmetic only:
 * **no OpenStreetMap data of any kind**, for the reason
 * `apps/web/browser/pmtiles-fixture.ts` gives — a fixture holding a scrap of a
 * real map would make this repository's tests a derivative of it. The same
 * input gives the same bytes on every run: no clock, no randomness, keys and
 * values in first-use order.
 *
 * Written from the MVT specification 2.1 (its wire format is a protobuf
 * schema) and the protobuf encoding documentation. It can also write what a
 * valid encoder never would — raw geometry integers, raw geometry bytes, any
 * version or extent — because the hostile fixtures need exactly that.
 */

export type TagValue = string | number | boolean;

export interface FeatureSpec {
  /** Written as field 1 when present. The decoder must never read it. */
  readonly id?: number;
  /** 0 unknown, 1 point, 2 line, 3 polygon. */
  readonly type: number;
  readonly tags?: Readonly<Record<string, TagValue>>;
  /** Geometry as command integers, already encoded (see {@link polygon}, {@link line}). */
  readonly geometry?: readonly number[];
  /** Geometry as raw packed bytes, for a truncated varint. Wins over `geometry`. */
  readonly geometryBytes?: Uint8Array;
}

export interface LayerSpec {
  readonly name: string;
  readonly version?: number;
  readonly extent?: number;
  readonly features: readonly FeatureSpec[];
}

/** A growable byte buffer. */
class Writer {
  private buf = new Uint8Array(1024);
  length = 0;

  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buf[this.length++] = value;
  }

  varint(value: number): void {
    let v = value;
    while (v >= 0x80) {
      this.byte((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.byte(v);
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.length);
    this.length += data.length;
  }

  tag(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }

  message(field: number, body: Uint8Array): void {
    this.tag(field, 2);
    this.varint(body.length);
    this.bytes(body);
  }

  ascii(field: number, text: string): void {
    const data = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i) & 0x7f;
    this.message(field, data);
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

export function command(id: number, count: number): number {
  return (id & 7) + count * 8;
}

/** Packs unsigned integers as varints. */
export function packVarints(values: readonly number[]): Uint8Array {
  const w = new Writer();
  for (const v of values) w.varint(v);
  return w.done();
}

/**
 * Polygon geometry from rings of absolute tile pixels, closed implicitly.
 * Orientation is the caller's: an outer ring must be clockwise in tile
 * pixels (y down) and a hole anticlockwise — see {@link outerRing} and
 * {@link holeRing}.
 */
export function polygon(rings: readonly (readonly (readonly [number, number])[])[]): number[] {
  const out: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    const [first, ...rest] = ring;
    if (first === undefined) continue;
    out.push(command(1, 1), zigzag(first[0] - cx), zigzag(first[1] - cy));
    cx = first[0];
    cy = first[1];
    out.push(command(2, rest.length));
    for (const [x, y] of rest) {
      out.push(zigzag(x - cx), zigzag(y - cy));
      cx = x;
      cy = y;
    }
    out.push(command(7, 1));
  }
  return out;
}

/** Line geometry from lines of absolute tile pixels. */
export function line(lines: readonly (readonly (readonly [number, number])[])[]): number[] {
  const out: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const part of lines) {
    const [first, ...rest] = part;
    if (first === undefined) continue;
    out.push(command(1, 1), zigzag(first[0] - cx), zigzag(first[1] - cy));
    cx = first[0];
    cy = first[1];
    out.push(command(2, rest.length));
    for (const [x, y] of rest) {
      out.push(zigzag(x - cx), zigzag(y - cy));
      cx = x;
      cy = y;
    }
  }
  return out;
}

/** Point geometry. */
export function points(at: readonly (readonly [number, number])[]): number[] {
  const out: number[] = [command(1, at.length)];
  let cx = 0;
  let cy = 0;
  for (const [x, y] of at) {
    out.push(zigzag(x - cx), zigzag(y - cy));
    cx = x;
    cy = y;
  }
  return out;
}

/** The surveyor's area in tile pixels (y down); positive is an MVT outer ring. */
export function pixelArea(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i] as readonly [number, number];
    const [x2, y2] = ring[(i + 1) % ring.length] as readonly [number, number];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** The ring, wound as an outer ring. */
export function outerRing(
  ring: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  return pixelArea(ring) > 0 ? [...ring] : [...ring].reverse();
}

/** The ring, wound as a hole. */
export function holeRing(
  ring: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  return pixelArea(ring) < 0 ? [...ring] : [...ring].reverse();
}

/** An axis-aligned rectangle of tile pixels, as four corners. */
export function rectangle(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function encodeValue(value: TagValue): Uint8Array {
  const w = new Writer();
  if (typeof value === 'string') w.ascii(1, value);
  else if (typeof value === 'boolean') {
    w.tag(7, 0);
    w.varint(value ? 1 : 0);
  } else if (Number.isInteger(value) && value >= 0) {
    w.tag(5, 0);
    w.varint(value);
  } else if (Number.isInteger(value)) {
    w.tag(6, 0);
    w.varint(zigzag(value));
  } else {
    w.tag(3, 1);
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    w.bytes(bytes);
  }
  return w.done();
}

function encodeLayer(layer: LayerSpec): Uint8Array {
  const keys: string[] = [];
  const values: TagValue[] = [];
  const keyIndex = new Map<string, number>();
  const valueIndex = new Map<string, number>();
  const features: Uint8Array[] = [];
  for (const feature of layer.features) {
    const tagInts: number[] = [];
    for (const [key, value] of Object.entries(feature.tags ?? {})) {
      let k = keyIndex.get(key);
      if (k === undefined) {
        k = keys.length;
        keys.push(key);
        keyIndex.set(key, k);
      }
      const valueKey = `${typeof value}:${String(value)}`;
      let v = valueIndex.get(valueKey);
      if (v === undefined) {
        v = values.length;
        values.push(value);
        valueIndex.set(valueKey, v);
      }
      tagInts.push(k, v);
    }
    const w = new Writer();
    if (feature.id !== undefined) {
      w.tag(1, 0);
      w.varint(feature.id);
    }
    if (tagInts.length > 0) w.message(2, packVarints(tagInts));
    w.tag(3, 0);
    w.varint(feature.type);
    const geometry = feature.geometryBytes ?? packVarints(feature.geometry ?? []);
    w.message(4, geometry);
    features.push(w.done());
  }
  const w = new Writer();
  w.tag(15, 0);
  w.varint(layer.version ?? 2);
  w.ascii(1, layer.name);
  for (const feature of features) w.message(2, feature);
  for (const key of keys) w.ascii(3, key);
  for (const value of values) w.message(4, encodeValue(value));
  w.tag(5, 0);
  w.varint(layer.extent ?? 4096);
  return w.done();
}

/** A whole tile. Layers are written in the order given. */
export function encodeTile(layers: readonly LayerSpec[]): Uint8Array {
  const w = new Writer();
  for (const layer of layers) w.message(3, encodeLayer(layer));
  return w.done();
}

/**
 * The tile with an unknown top-level field (field 15, which the decoder skips
 * by its length) appended so that it is exactly `size` bytes.
 */
export function padTileTo(tile: Uint8Array, size: number): Uint8Array {
  // tag (1 byte) + length varint + body. Find the body length that fits.
  for (let lengthBytes = 1; lengthBytes <= 5; lengthBytes++) {
    const body = size - tile.length - 1 - lengthBytes;
    if (body < 0) break;
    if (packVarints([body]).length === lengthBytes) {
      const w = new Writer();
      w.bytes(tile);
      w.message(15, new Uint8Array(body));
      return w.done();
    }
  }
  throw new RangeError('padTileTo: no padding reaches that size');
}
