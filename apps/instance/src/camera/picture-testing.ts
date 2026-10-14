// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pictures for the side camera's tests (#1106). Never shipped. Nobody is in
 * any of them: each is a JPEG's opening segments around bytes a test chose.
 */

/** A string no real table, log or request holds, to search a database and a log for. */
export const PICTURE_MARKER = 'SIDEPICTUREMARKER8K2W';

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

/**
 * A JPEG as a canvas re-encode opens: start of image, a JFIF `APP0` segment
 * and nothing else before `payload` — which carries {@link PICTURE_MARKER},
 * so a copy of the picture anywhere is found by a substring search.
 */
export function testPicture(payload: readonly number[] = [], bytes = 0): Uint8Array {
  const body = [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...ascii('JFIF\0'),
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    ...payload,
    ...ascii(PICTURE_MARKER),
  ];
  // Filler up to `bytes`, so a test can make a picture of a size it names.
  while (body.length < bytes - 2) body.push(0x55);
  return Uint8Array.from([...body, 0xff, 0xd9]);
}

/** A picture carrying an Exif segment, as a camera's own file does. */
export function pictureWithExif(): Uint8Array {
  return testPicture([0xff, 0xe1, 0x00, 0x10, ...ascii('Exif\0\0'), 0, 0, 0, 0, 0, 0, 0, 0]);
}

/** Standard base64, as the app sends a picture. */
export function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
