// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A picture on the side-camera link, and the refusal of every other
 * message** — #530, ADR 0033 D-3 and D-4.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES,
  SIDE_PICTURE_HEADER_BYTES,
  SIDE_PICTURE_VERSION,
  sidePictureFrom,
  sidePictureMessage,
  type SidePicture,
} from './side-link-pictures';
import { cleanFrameBytes } from './testing';

const PICTURE: SidePicture = { sequence: 7, milliseconds: 1400, bytes: cleanFrameBytes(2048) };

function message(picture: SidePicture = PICTURE): ArrayBuffer {
  const made = sidePictureMessage(picture);
  if (made === undefined) {
    throw new Error('no message');
  }
  return made;
}

/** `bytes` as a message with a header, however wrong the bytes are. */
function raw(bytes: Uint8Array, version = SIDE_PICTURE_VERSION): ArrayBuffer {
  const out = new ArrayBuffer(SIDE_PICTURE_HEADER_BYTES + bytes.length);
  new DataView(out).setUint8(0, version);
  new Uint8Array(out, SIDE_PICTURE_HEADER_BYTES).set(bytes);
  return out;
}

describe('a picture, across and back', () => {
  it('carries the sequence number, the milliseconds and the JPEG, and nothing else', () => {
    const sent = message();
    expect(sent.byteLength).toBe(SIDE_PICTURE_HEADER_BYTES + PICTURE.bytes.length);
    const read = sidePictureFrom(sent);
    expect(read).toEqual(PICTURE);
    // Exactly three fields: no arrival time, no wall clock, no id (D-3).
    expect(Object.keys(read ?? {}).sort()).toEqual(['bytes', 'milliseconds', 'sequence']);
  });

  it('reads the header big-endian, so a number above 255 survives', () => {
    const read = sidePictureFrom(
      message({ ...PICTURE, sequence: 70_000, milliseconds: 3_600_000 }),
    );
    expect(read?.sequence).toBe(70_000);
    expect(read?.milliseconds).toBe(3_600_000);
  });

  it('holds only the picture’s own bytes, not the header’s', () => {
    const read = sidePictureFrom(message());
    expect(read?.bytes.byteLength).toBe(PICTURE.bytes.length);
    expect(read?.bytes.buffer.byteLength).toBe(PICTURE.bytes.length);
  });
});

describe('what is not sent', () => {
  it('a picture that would not fit the room the connection has', () => {
    expect(sidePictureMessage(PICTURE, SIDE_PICTURE_HEADER_BYTES + 2047)).toBeUndefined();
    expect(sidePictureMessage(PICTURE, SIDE_PICTURE_HEADER_BYTES + 2048)).toBeDefined();
  });

  it('a picture larger than this build ever sends, however much room the connection claims', () => {
    const big = { ...PICTURE, bytes: cleanFrameBytes(MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES) };
    expect(sidePictureMessage(big, 262_144)).toBeUndefined();
  });

  it('a number the header cannot hold', () => {
    expect(sidePictureMessage({ ...PICTURE, sequence: -1 })).toBeUndefined();
    expect(sidePictureMessage({ ...PICTURE, sequence: 2 ** 32 })).toBeUndefined();
    expect(sidePictureMessage({ ...PICTURE, milliseconds: 1.5 })).toBeUndefined();
  });
});

describe('what is refused on arrival (D-4)', () => {
  it('a string, a view and nothing', () => {
    expect(sidePictureFrom('{"t":"ping"}')).toBeUndefined();
    expect(sidePictureFrom(new Uint8Array(message()))).toBeUndefined();
    expect(sidePictureFrom(undefined)).toBeUndefined();
  });

  it('a header with no picture', () => {
    expect(sidePictureFrom(new ArrayBuffer(SIDE_PICTURE_HEADER_BYTES))).toBeUndefined();
  });

  it('a message longer than this build reads', () => {
    expect(
      sidePictureFrom(raw(cleanFrameBytes(MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES))),
    ).toBeUndefined();
  });

  it('a version this build does not know', () => {
    expect(sidePictureFrom(raw(PICTURE.bytes, SIDE_PICTURE_VERSION + 1))).toBeUndefined();
    expect(sidePictureFrom(raw(PICTURE.bytes))).toBeDefined();
  });

  it('bytes that are not a whole JPEG', () => {
    const truncated = PICTURE.bytes.slice(0, 1000);
    expect(sidePictureFrom(raw(truncated))).toBeUndefined();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd9]);
    expect(sidePictureFrom(raw(png))).toBeUndefined();
  });

  it('a picture carrying metadata, which an honest phone never sends', () => {
    const exif = PICTURE.bytes.slice();
    exif.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 40);
    expect(sidePictureFrom(raw(exif))).toBeUndefined();
  });
});
