// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pictures for the side camera's tests (#1106). Never shipped. Nobody is in
 * any of them: each is a JPEG's segments around bytes a test chose.
 */

/** A string no real table, log or request holds, to search a database and a log for. */
export const PICTURE_MARKER = 'SIDEPICTUREMARKER8K2W';

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

/** One JPEG segment: its marker, its length and `content` (#2175). */
export function segment(marker: number, content: readonly number[]): number[] {
  const length = content.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...content];
}

/** A scan header for one component: the segment after which entropy-coded data runs. */
export const SCAN_HEADER: readonly number[] = segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);

/**
 * A JPEG as a canvas re-encode is laid out: start of image, a JFIF `APP0`
 * segment, any `segments` a test adds, a scan, and end of image. The scan's
 * data carries {@link PICTURE_MARKER}, so a copy of the picture anywhere is
 * found by a substring search, and filler up to `bytes`.
 *
 * Since #2175 the instance walks every segment, so a test picture is one
 * whose segments parse.
 */
export function testPicture(segments: readonly number[] = [], bytes = 0): Uint8Array {
  const body = [
    0xff,
    0xd8,
    ...segment(0xe0, [...ascii('JFIF\0'), 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    ...segments,
    ...SCAN_HEADER,
    ...ascii(PICTURE_MARKER),
  ];
  // Filler up to `bytes`, so a test can make a picture of a size it names. Never 0xff.
  while (body.length < bytes - 2) body.push(0x55);
  return Uint8Array.from([...body, 0xff, 0xd9]);
}

/** A picture carrying an Exif segment, as a camera's own file does. */
export function pictureWithExif(): Uint8Array {
  return testPicture(segment(0xe1, [...ascii('Exif\0\0'), 0, 0, 0, 0, 0, 0, 0, 0]));
}

/** Standard base64, as the app sends a picture. */
export function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
