// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A side-camera picture as it arrives at the instance, checked before
 * anything looks at it** — #1106.
 *
 * The device strips a picture at capture (ADR 0029 D-9: re-encoded from raw
 * pixels, `apps/web/src/camera/frame.ts`) and refuses to send one that
 * carries a metadata marker. This is the check made again on arrival,
 * because a request is untrusted input and the next hop may be a company: a
 * picture that names where it was taken, or the device that took it, is
 * refused here and goes no further. Since #2175 it walks every segment of the
 * file rather than scanning a window of it ({@link pictureFrom}), so it is
 * stricter than the device's own check, which still scans a window.
 *
 * ⚠️ **Bytes in memory, and nowhere else.** Nothing in this module, or in
 * `side-pose.ts` that calls it, writes: no store, no file, no log
 * (`side-pose.test.ts` §"never stored" reads the database and every log line
 * after a picture has been through).
 *
 * ⚠️ **A refusal names the field and the rule, never a byte**
 * ({@link PictureProblem}): no offset, no marker name, no length the picture
 * had (ADR 0029 D-8).
 */

/**
 * The largest picture taken: 64 KiB, which is the largest the side camera's
 * link carries (`apps/web/src/camera/side-link-pictures.ts`
 * §`MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES`, less its nine-byte header). A picture
 * the tablet could not have received from the phone is not one to send on.
 */
export const MAXIMUM_PICTURE_BYTES = 64 * 1024;

/** Why a picture is refused. Each is a fixed sentence. */
export type PictureProblem =
  | 'must be a JPEG picture, base64-encoded'
  | 'must be at most 64 KiB'
  | 'must carry no location or device metadata';

/**
 * The JPEG segments a picture may carry (#2175): the ones a canvas re-encode
 * writes, and no others. `APP0` (JFIF), `APP2` (an ICC profile), the
 * quantisation and Huffman tables, a frame header (`SOF0`..`SOF15`, less the
 * three that are not frame headers), the restart interval, and the scan
 * header. Any other segment is refused, wherever in the file it is: `APP1`
 * (Exif with its GPS IFD and the camera's make and model, and XMP), `APP11`
 * (JUMBF/C2PA, which can carry an Exif assertion), `APP12`, `APP13` (IPTC) and
 * `COM` (free text) among them. An allowlist, not a list of the known bad
 * ones, because a re-encode from pixels writes none of those (ADR 0029 D-9),
 * so a picture carrying one was not made by the app.
 */
const ALLOWED_SEGMENTS: ReadonlySet<number> = new Set([
  0xe0,
  0xe2,
  0xdb,
  0xc4,
  0xdd,
  0xda,
  ...[0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf],
]);

/** Markers that stand alone, with no length after them: `TEM` and the restarts. */
const standsAlone = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/**
 * Where the entropy-coded data that starts at `from`, after a scan header, ends: the
 * next `0xff` that is neither a stuffed zero nor a restart, which is the next
 * segment's marker.
 */
function endOfScan(bytes: Uint8Array, from: number): number {
  let at = from;
  while (at < bytes.length) {
    if (bytes[at] === 0xff) {
      const next = bytes[at + 1];
      if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
        at += 2;
        continue;
      }
      if (next === 0xff) {
        // A fill byte before the next marker.
        at += 1;
        continue;
      }
      return at;
    }
    at += 1;
  }
  return at;
}

/**
 * Every segment of the picture, from start of image to end of image, walked
 * (#2175): `metadata` when any is not one of {@link ALLOWED_SEGMENTS},
 * `malformed` when the segments do not parse — a length past the end, a
 * second start of image, no end of image, or any byte after it — and `clean`
 * otherwise. Before #2175 this scanned a window of the file for each
 * signature, so an Exif block that started after the first 4096 bytes passed.
 *
 * ⚠️ **Nothing after end of image is taken.** Bytes there are a place to
 * carry anything at all, and an encoder that re-encodes from pixels writes
 * none.
 */
function segmentsOf(bytes: Uint8Array): 'clean' | 'metadata' | 'malformed' {
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return 'malformed';
    while (bytes[at] === 0xff) at += 1;
    const marker = bytes[at];
    if (marker === undefined) return 'malformed';
    at += 1;
    if (marker === 0xd9) return at === bytes.length ? 'clean' : 'malformed';
    if (marker === 0x00 || marker === 0xd8) return 'malformed';
    if (standsAlone(marker)) continue;
    const high = bytes[at];
    const low = bytes[at + 1];
    if (high === undefined || low === undefined) return 'malformed';
    const length = (high << 8) | low;
    if (length < 2 || at + length > bytes.length) return 'malformed';
    if (!ALLOWED_SEGMENTS.has(marker)) return 'metadata';
    at += length;
    // A scan header is followed by its entropy-coded data, which has no length.
    if (marker === 0xda) at = endOfScan(bytes, at);
  }
  return 'malformed';
}

/** Standard base64, padded or not, and nothing else: no data URL, no whitespace. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The picture a request carries, as bytes, or why it is refused.
 *
 * The text's length is checked before it is decoded, so an oversized picture
 * is never held twice.
 */
export function pictureFrom(
  value: unknown,
):
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly problem: PictureProblem } {
  const refused = (problem: PictureProblem) => ({ ok: false, problem }) as const;
  if (typeof value !== 'string' || value === '') {
    return refused('must be a JPEG picture, base64-encoded');
  }
  if (value.length > Math.ceil(MAXIMUM_PICTURE_BYTES / 3) * 4) {
    return refused('must be at most 64 KiB');
  }
  if (!BASE64.test(value)) return refused('must be a JPEG picture, base64-encoded');
  let bytes: Uint8Array;
  try {
    // `atob`, not `Buffer`: the handler's core names no Node module (ADR 0037 D-2).
    bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return refused('must be a JPEG picture, base64-encoded');
  }
  if (bytes.length > MAXIMUM_PICTURE_BYTES) return refused('must be at most 64 KiB');
  // A JPEG opens with its start-of-image marker and the marker of a segment.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return refused('must be a JPEG picture, base64-encoded');
  }
  const segments = segmentsOf(bytes);
  if (segments === 'malformed') return refused('must be a JPEG picture, base64-encoded');
  if (segments === 'metadata') return refused('must carry no location or device metadata');
  return { ok: true, bytes };
}
