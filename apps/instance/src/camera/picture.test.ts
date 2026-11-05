// SPDX-License-Identifier: AGPL-3.0-or-later

/** A picture as it arrives, checked before anything looks at it (#1106). */

import { describe, expect, it } from 'vitest';

import { MAXIMUM_PICTURE_BYTES, pictureFrom } from './picture.ts';
import { base64Of, pictureWithExif, SCAN_HEADER, segment, testPicture } from './picture-testing.ts';

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

const EXIF = segment(0xe1, [...ascii('Exif\0\0'), 0, 0, 0, 0, 0, 0, 0, 0]);
const XMP = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x/>'));
const IPTC = segment(0xed, ascii('Photoshop 3.0\x008BIM'));
/** A segment the walk passes over: an ICC profile's, of `bytes` bytes of content. */
const padding = (bytes: number): number[] =>
  segment(0xe2, [...ascii('ICC_PROFILE\0'), ...new Array<number>(bytes - 12).fill(0x20)]);

/** `picture` with `bytes` put in just before its end of image, after its scan. */
const beforeTheEnd = (picture: Uint8Array, bytes: readonly number[]): Uint8Array =>
  Uint8Array.from([...picture.slice(0, -2), ...bytes, 0xff, 0xd9]);

const METADATA = { ok: false, problem: 'must carry no location or device metadata' } as const;
const NOT_A_JPEG = { ok: false, problem: 'must be a JPEG picture, base64-encoded' } as const;

describe('a side-camera picture, on arrival (#1106)', () => {
  it('is taken as the bytes that were sent', () => {
    const picture = testPicture();
    const read = pictureFrom(base64Of(picture));
    expect(read).toStrictEqual({ ok: true, bytes: picture });
  });

  it('is taken at exactly the largest size, and refused one byte over', () => {
    const largest = testPicture([], MAXIMUM_PICTURE_BYTES);
    expect(largest.length).toBe(MAXIMUM_PICTURE_BYTES);
    expect(pictureFrom(base64Of(largest)).ok).toBe(true);
    const over = testPicture([], MAXIMUM_PICTURE_BYTES + 1);
    expect(over.length).toBe(MAXIMUM_PICTURE_BYTES + 1);
    expect(pictureFrom(base64Of(over))).toStrictEqual({
      ok: false,
      problem: 'must be at most 64 KiB',
    });
  });

  it.each([
    ['Exif', pictureWithExif()],
    ['XMP', testPicture(XMP)],
    ['IPTC', testPicture(IPTC)],
  ])(
    'is refused when it carries %s, naming the rule and nothing of the picture',
    (_name, bytes) => {
      expect(pictureFrom(base64Of(bytes))).toStrictEqual(METADATA);
    },
  );

  it.each([
    ['not a string', 7],
    ['empty', ''],
    ['a data URL', `data:image/jpeg;base64,${base64Of(testPicture())}`],
    ['base64url', `${base64Of(testPicture()).slice(0, -4)}-_-_`],
    ['a PNG', base64Of(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
    ['three bytes', base64Of(Uint8Array.from([0xff, 0xd8, 0xff]))],
    ['text', base64Of(Uint8Array.from(ascii('a picture of a rider')))],
  ])('is refused when it is %s', (_name, value) => {
    expect(pictureFrom(value)).toStrictEqual(NOT_A_JPEG);
  });
});

describe('every segment of a picture is walked, not a window of it (#2175)', () => {
  it('refuses an Exif segment that starts after the first 4096 bytes', () => {
    const late = testPicture([...padding(5_000), ...EXIF]);
    expect(late.indexOf(0xe1)).toBeGreaterThan(4_096);
    expect(pictureFrom(base64Of(late))).toStrictEqual(METADATA);
  });

  it.each([
    ['Exif', EXIF],
    ['XMP', XMP],
    ['IPTC', IPTC],
  ])('refuses %s carried between two scans, after the first one’s data', (_name, bytes) => {
    const picture = beforeTheEnd(testPicture(), [...bytes, ...SCAN_HEADER, 0x11, 0x22]);
    expect(pictureFrom(base64Of(picture))).toStrictEqual(METADATA);
  });

  it('refuses every APP1 and APP13, whatever its signature says', () => {
    expect(pictureFrom(base64Of(testPicture(segment(0xe1, ascii('Exif-ish')))))).toStrictEqual(
      METADATA,
    );
    expect(pictureFrom(base64Of(testPicture(segment(0xed, ascii('Photoshop 2.5')))))).toStrictEqual(
      METADATA,
    );
  });

  it('takes the segments a re-encode writes, a second scan, restarts and stuffed bytes', () => {
    const picture = beforeTheEnd(
      testPicture([...padding(64), ...segment(0xdb, new Array<number>(65).fill(1))]),
      // Stuffed 0xff 0x00 and a restart inside the data, fill bytes before a marker, a second scan.
      [0xff, 0x00, 0x12, 0xff, 0xd0, 0x34, 0xff, 0xff, ...SCAN_HEADER, 0xff, 0x00],
    );
    expect(pictureFrom(base64Of(picture))).toStrictEqual({ ok: true, bytes: picture });
  });

  it('does not read a metadata signature inside a scan’s data as a segment', () => {
    // `Exif\0\0` as bytes of picture, with no marker before it: not a segment.
    const picture = beforeTheEnd(testPicture(), ascii('Exif\0\0http://ns.adobe.com/xap/1.0/'));
    expect(pictureFrom(base64Of(picture)).ok).toBe(true);
  });

  it.each([
    ['anything after its end of image', [...testPicture(), ...EXIF]],
    ['no end of image', [...testPicture().slice(0, -2)]],
    ['a segment longer than the picture', [0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 0x00, 0xff, 0xd9]],
    [
      'a segment shorter than its own length field',
      [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9],
    ],
    ['a length cut off by the end', [0xff, 0xd8, 0xff, 0xe0, 0x00]],
    ['a second start of image', [0xff, 0xd8, 0xff, 0xd8, 0xff, 0xd9]],
    ['a byte between segments that is not a marker', [0xff, 0xd8, 0x00, 0xff, 0xd9]],
    ['a marker of zero', [0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]],
    ['nothing but fill after its start', [0xff, 0xd8, 0xff, 0xff]],
  ])('is refused as no JPEG for %s', (_name, bytes) => {
    expect(pictureFrom(base64Of(Uint8Array.from(bytes)))).toStrictEqual(NOT_A_JPEG);
  });
});
