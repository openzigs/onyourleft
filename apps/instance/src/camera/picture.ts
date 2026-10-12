// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A side-camera picture as it arrives at the instance, checked before
 * anything looks at it** — #1106.
 *
 * The device strips a picture at capture (ADR 0029 D-9: re-encoded from raw
 * pixels, `apps/web/src/camera/frame.ts`) and refuses to send one that
 * carries a metadata marker. This is the same check made again on arrival,
 * because a request is untrusted input and the next hop may be a company: a
 * picture that names where it was taken, or the device that took it, is
 * refused here and goes no further.
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

/** The JPEG metadata this refuses: the signatures `frame.ts` §`METADATA_MARKERS` looks for. */
const METADATA_SIGNATURES: readonly { readonly signature: string; readonly within: number }[] = [
  // APP1/Exif, which holds the GPS IFD and the camera's make and model.
  { signature: 'Exif\0\0', within: 4096 },
  // APP1/XMP, which holds the same as text.
  { signature: 'http://ns.adobe.com/xap/1.0/', within: 65_536 },
  // APP13/IPTC, which carries its own location fields.
  { signature: 'Photoshop 3.0', within: 65_536 },
];

function holds(bytes: Uint8Array, signature: string, within: number): boolean {
  const needle = Array.from(signature, (character) => character.charCodeAt(0));
  const last = Math.min(bytes.length, within) - needle.length;
  for (let start = 0; start <= last; start += 1) {
    if (needle.every((code, offset) => bytes[start + offset] === code)) return true;
  }
  return false;
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
  if (METADATA_SIGNATURES.some((each) => holds(bytes, each.signature, each.within))) {
    return refused('must carry no location or device metadata');
  }
  return { ok: true, bytes };
}
