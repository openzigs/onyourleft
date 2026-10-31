// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A whole-tile Mapbox Vector Tile reader for the basemap build's comparison
 * (#1557). Unlike `@onyourleft/map-features`' decoder, which reads five layers
 * and a handful of keys on purpose, this reads every layer, every key and the
 * geometry's raw bytes, because its job is to say whether two archives differ.
 * It runs on the build machine against archives this project built, and its
 * output is counts, never a tag's value.
 */

export type MvtValue = string | number | boolean;

export interface MvtFeature {
  readonly id: number | null;
  readonly type: number;
  readonly tags: ReadonlyMap<string, MvtValue>;
  /** The packed geometry varints, byte for byte. */
  readonly geometry: Uint8Array;
}

export interface MvtLayer {
  readonly name: string;
  readonly extent: number;
  readonly features: readonly MvtFeature[];
}

class Reader {
  pos = 0;
  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.bytes.length) throw new RangeError('mvt: truncated varint');
      const byte = this.bytes[this.pos++]!;
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
    throw new RangeError('mvt: varint longer than ten bytes');
  }

  bytesField(): Uint8Array {
    const length = this.varint();
    const end = this.pos + length;
    if (end > this.bytes.length) throw new RangeError('mvt: field runs past its message');
    const out = this.bytes.subarray(this.pos, end);
    this.pos = end;
    return out;
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.advance(8);
    else if (wire === 2) this.bytesField();
    else if (wire === 5) this.advance(4);
    else throw new RangeError('mvt: unknown wire type');
  }

  fixed(size: 4 | 8): DataView {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, size);
    this.advance(size);
    return view;
  }

  private advance(size: number): void {
    if (this.pos + size > this.bytes.length)
      throw new RangeError('mvt: fixed field runs past its message');
    this.pos += size;
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function zigzag(value: number): number {
  return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
}

function readValue(bytes: Uint8Array): MvtValue {
  const r = new Reader(bytes);
  let value: MvtValue = '';
  while (!r.done) {
    const key = r.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) value = utf8.decode(r.bytesField());
    else if (field === 2 && wire === 5) value = r.fixed(4).getFloat32(0, true);
    else if (field === 3 && wire === 1) value = r.fixed(8).getFloat64(0, true);
    else if ((field === 4 || field === 5) && wire === 0) value = r.varint();
    else if (field === 6 && wire === 0) value = zigzag(r.varint());
    else if (field === 7 && wire === 0) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

function readPackedVarints(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  const out: number[] = [];
  while (!r.done) out.push(r.varint());
  return out;
}

function readLayer(bytes: Uint8Array): MvtLayer {
  const r = new Reader(bytes);
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: MvtValue[] = [];
  const raw: { id: number | null; type: number; tags: number[]; geometry: Uint8Array }[] = [];
  while (!r.done) {
    const key = r.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 2) name = utf8.decode(r.bytesField());
    else if (field === 2 && wire === 2) raw.push(readFeature(r.bytesField()));
    else if (field === 3 && wire === 2) keys.push(utf8.decode(r.bytesField()));
    else if (field === 4 && wire === 2) values.push(readValue(r.bytesField()));
    else if (field === 5 && wire === 0) extent = r.varint();
    else r.skip(wire);
  }
  const features = raw.map((feature): MvtFeature => {
    if (feature.tags.length % 2 !== 0) throw new RangeError('mvt: odd tag list');
    const tags = new Map<string, MvtValue>();
    for (let i = 0; i < feature.tags.length; i += 2) {
      const k = keys[feature.tags[i]!];
      const v = values[feature.tags[i + 1]!];
      if (k === undefined || v === undefined) throw new RangeError('mvt: tag index out of range');
      tags.set(k, v);
    }
    return { id: feature.id, type: feature.type, tags, geometry: feature.geometry };
  });
  return { name, extent, features };
}

function readFeature(bytes: Uint8Array): {
  id: number | null;
  type: number;
  tags: number[];
  geometry: Uint8Array;
} {
  const r = new Reader(bytes);
  let id: number | null = null;
  let type = 0;
  let tags: number[] = [];
  let geometry: Uint8Array = new Uint8Array(0);
  while (!r.done) {
    const key = r.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1 && wire === 0) id = r.varint();
    else if (field === 2 && wire === 2) tags = readPackedVarints(r.bytesField());
    else if (field === 3 && wire === 0) type = r.varint();
    else if (field === 4 && wire === 2) geometry = r.bytesField();
    else r.skip(wire);
  }
  return { id, type, tags, geometry };
}

/** Every layer of one uncompressed tile, in the tile's order. Throws a `RangeError` on a malformed tile. */
export function readTile(bytes: Uint8Array): MvtLayer[] {
  const r = new Reader(bytes);
  const layers: MvtLayer[] = [];
  while (!r.done) {
    const key = r.varint();
    if (Math.floor(key / 8) === 3 && key % 8 === 2) layers.push(readLayer(r.bytesField()));
    else r.skip(key % 8);
  }
  return layers;
}
