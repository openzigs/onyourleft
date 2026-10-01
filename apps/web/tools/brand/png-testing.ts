// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A PNG reader for the brand gate's picture checks — #965. Test support only.
 *
 * Eight-bit RGB and RGBA, not interlaced: what Pillow writes for the outputs
 * `derive_brand.py` makes. Anything else is refused rather than misread, so a
 * pipeline that started writing a palette image would turn this red instead of
 * being read as noise.
 */

import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Always four channels a pixel; an RGB file reads with an alpha of 255. */
  readonly rgba: Uint8Array;
  /** Whether the file carries an alpha channel at all. */
  readonly hasAlpha: boolean;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (!SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('not a PNG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG: depth ${String(depth)}, colour type ${String(colour)}`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const unfiltered = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (unfiltered[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (unfiltered[(y - 1) * stride + x] ?? 0) : 0;
      const corner =
        x >= channels && y > 0 ? (unfiltered[(y - 1) * stride + x - channels] ?? 0) : 0;
      const value = line[x] ?? 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4:
          out = value + paeth(left, up, corner);
          break;
        default:
          throw new Error(`unknown PNG filter ${String(filter)}`);
      }
      unfiltered[y * stride + x] = out & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      rgba[pixel * 4 + channel] = unfiltered[pixel * channels + channel] ?? 0;
    }
    rgba[pixel * 4 + 3] = channels === 4 ? (unfiltered[pixel * channels + 3] ?? 0) : 255;
  }
  return { width, height, rgba, hasAlpha: channels === 4 };
}
