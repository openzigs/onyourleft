// SPDX-License-Identifier: AGPL-3.0-or-later

/** A picture as it arrives, checked before anything looks at it (#1106). */

import { describe, expect, it } from 'vitest';

import { MAXIMUM_PICTURE_BYTES, pictureFrom } from './picture.ts';
import { base64Of, pictureWithExif, testPicture } from './picture-testing.ts';

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

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
    ['XMP', testPicture([0xff, 0xe1, 0x00, 0x30, ...ascii('http://ns.adobe.com/xap/1.0/\0<x/>')])],
    ['IPTC', testPicture([0xff, 0xed, 0x00, 0x20, ...ascii('Photoshop 3.0\x008BIM')])],
  ])(
    'is refused when it carries %s, naming the rule and nothing of the picture',
    (_name, bytes) => {
      expect(pictureFrom(base64Of(bytes))).toStrictEqual({
        ok: false,
        problem: 'must carry no location or device metadata',
      });
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
    expect(pictureFrom(value)).toStrictEqual({
      ok: false,
      problem: 'must be a JPEG picture, base64-encoded',
    });
  });
});
