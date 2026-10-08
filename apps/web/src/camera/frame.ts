// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A frame, stripped, and the refusal that makes "stripped" a property of the
 * construction rather than a habit of the callers**
 * ([ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-9,
 * [#384](https://github.com/openzigs/onyourleft/issues/384)).
 *
 * > A frame is stripped of **all** metadata at the moment it is captured —
 * > re-encoded from raw pixels, not filtered — before it is analysed, kept,
 * > sent anywhere, or handed to any other module. There is exactly one place
 * > this happens and it is inside the capture port.
 *
 * ## Why this is not "strip the EXIF"
 *
 * There is no filter here and there must not be. `browser-camera.ts` draws the
 * video track onto a canvas and asks the canvas to encode it, which produces
 * an image built from **pixels** — the source file's markers were never in the
 * pipeline to be removed. A filter would be a list of markers somebody wrote
 * down, and the failure mode of a list is that it is complete on the day it is
 * written: a JPEG can carry a location in `APP1`/Exif, in `APP1`/XMP
 * (`<exif:GPSLatitude>`), in `APP13`/IPTC, and a PNG in `eXIf` or in a `tEXt`
 * chunk with any keyword at all.
 *
 * ## So what is this file for, if the re-encode already does it
 *
 * **It is the assertion that the re-encode happened.** The re-encode is one
 * line in one adapter, and the whole guarantee rests on it; a future adapter —
 * the Android one, a `MediaStreamTrackProcessor` fast path, a plugin somebody
 * adds in 2027 — could hand back the sensor's own JPEG, which is the file the
 * camera wrote, which carries every marker the device felt like writing.
 * Nothing above would notice, because a JPEG is a JPEG.
 *
 * {@link capturedFrame} is the only constructor of a {@link CapturedFrame}, and
 * it **refuses** bytes that carry a metadata marker. So an adapter that skips
 * the re-encode does not leak a location quietly; it throws, on the first
 * capture, before anything is stored, exported or looked at.
 *
 * ⚠️ **This is a tripwire, not a scrubber, and the difference matters when it
 * fires.** It does not remove anything and it cannot: a refusal is the only
 * safe answer, because a scrubber that missed one marker would be the "green
 * result indistinguishable from the correct one" this repository keeps finding,
 * and ADR 0029's own §"What would make this ADR wrong" already records that
 * a re-encode may not be sufficient for ever (a sensor-noise fingerprint
 * survives every one of these checks and is a real research area).
 *
 * ⚠️ **And `privacy/boundaries.ts` cannot do this job.** `coordinatesIn` walks
 * a JavaScript structure for objects carrying finite numeric `latitude` and
 * `longitude`. An Exif GPS IFD is bytes inside a `Uint8Array`, so the walk
 * reports a clean payload over an image that names the rider's front door to
 * six decimal places — **green for a reason unrelated to the frame**. That is
 * why D-9 puts the rule at capture, and why #384 adds a note saying so to
 * `boundaries.ts` itself.
 */

import { CameraCaptureError, type CapturedFrame } from './camera-port';
import { cameraProblemMessage } from './notice';

/**
 * What the canvas encoder is asked for, and therefore the only media type a
 * frame in this program has.
 *
 * JPEG rather than PNG because a 1080p PNG of a room is several megabytes and
 * a rider may keep one per ride; and rather than WebP because
 * `canvas.toBlob` falls back to PNG for a type a browser does not support,
 * silently, which would make the media type a thing to check rather than a
 * thing to know.
 */
export const FRAME_MEDIA_TYPE = 'image/jpeg';

/**
 * The encoder quality.
 *
 * 0.8 is the usual default and is not tuned here: nothing in this milestone
 * reads a frame back, so there is no measurement to tune against, and picking
 * a number because it looked better on one photograph would be exactly the
 * kind of unevidenced constant `packages/physics/README.md` §2 refuses.
 */
export const FRAME_QUALITY = 0.8;

/**
 * A metadata marker this program refuses to hold.
 *
 * ⚠️ **The list fails CLOSED in the direction that matters and OPEN in the
 * direction that does not**, which is the opposite way round from most lists
 * here and is deliberate. A marker nobody listed is a marker nobody catches —
 * but the *only* producer in this client is a canvas re-encode, which emits
 * none of them, so the list is not the guarantee: it is the check on the
 * guarantee. Its job is to notice an adapter handing over a camera's own file,
 * and a camera's own file carries `Exif` in the first few hundred bytes of
 * every case anybody has measured.
 */
interface MetadataMarker {
  readonly name: string;
  /** The bytes to look for, as a plain ASCII signature. */
  readonly signature: string;
  /**
   * How far in to look.
   *
   * A whole-buffer scan of a three-megabyte JPEG would find `Exif` inside the
   * compressed entropy data by chance — a four-byte string appears about once
   * in four billion bytes, which is rare per image and certain across a
   * library. Every marker this is looking for is a **header**: JPEG's APP
   * segments come before the scan, PNG's `eXIf` and `tEXt` chunks are
   * conventionally before `IDAT`. So the window is generous but bounded, and
   * the alternative — parsing the container — would be a second image decoder
   * in a client that has no reason to have one.
   */
  readonly withinBytes: number;
}

const METADATA_MARKERS: readonly MetadataMarker[] = [
  // JPEG APP1, both tenants: Exif (which holds the GPS IFD) and XMP (which
  // holds `exif:GPSLatitude` as text, and which a scrubber written against
  // Exif alone routinely leaves behind).
  { name: 'Exif', signature: 'Exif\0\0', withinBytes: 4096 },
  { name: 'XMP', signature: 'http://ns.adobe.com/xap/1.0/', withinBytes: 65_536 },
  // JPEG APP13: IPTC, which carries its own location fields.
  { name: 'IPTC', signature: 'Photoshop 3.0', withinBytes: 65_536 },
  // PNG, in case a future adapter encodes one: the Exif chunk and the two text
  // chunks, any of which can carry a place name or a device.
  { name: 'PNG eXIf', signature: 'eXIf', withinBytes: 4096 },
  { name: 'PNG tEXt', signature: 'tEXt', withinBytes: 4096 },
  { name: 'PNG iTXt', signature: 'iTXt', withinBytes: 4096 },
];

/**
 * Every metadata marker found in `bytes`, by name. Empty means clean.
 *
 * Exported because two very different callers need it: {@link capturedFrame},
 * which refuses; and `packages/store`'s round trip through `#384`'s record,
 * which asserts that what came off the disk is still clean — a store that
 * "helpfully" re-encoded on the way in is a fake worth catching.
 */
export function metadataMarkersIn(bytes: Uint8Array): readonly string[] {
  const found: string[] = [];
  for (const marker of METADATA_MARKERS) {
    const limit = Math.min(bytes.length, marker.withinBytes);
    if (indexOfSignature(bytes, marker.signature, limit) >= 0) {
      found.push(marker.name);
    }
  }
  return found;
}

/**
 * The ICC profile segment's identifier, which is the one `APPn` segment a
 * picture this client stores may carry besides JFIF's `APP0`.
 *
 * ⚠️ **Measured, not assumed** (#1063's review, 2026-10-08): the pinned
 * Chromium's `canvas.toBlob('image/jpeg')` writes `APP0` and then `APP2`
 * `ICC_PROFILE` — the canvas's colour space — in both `srgb` and
 * `display-p3`, and the Android WebView is the same Skia encoder. Refusing
 * every `APP1`–`APP15` would therefore refuse every picture the phone sends.
 * An ICC profile describes colour; it has no tag for a place, a time or a
 * device, which is why this one segment is admitted and nothing else is.
 */
const ICC_PROFILE_IDENTIFIER = 'ICC_PROFILE\0';

/**
 * Every metadata-bearing segment in a JPEG's header, found by WALKING its
 * segments from start-of-image to start-of-scan (#1063's review, B2), with
 * `malformed` for a header that cannot be walked. Empty means the header holds
 * JFIF, an ICC profile, and the tables and frame a decoder needs, and nothing
 * else.
 *
 * ## Why a walk, when {@link metadataMarkersIn} is a scan
 *
 * A signature scan has a window, and a window is a place to stand outside: an
 * `APP2` of five thousand bytes put the Exif block past {@link metadataMarkersIn}'s
 * 4 096, and the picture passed. A walk has no window — it visits every
 * segment before the scan, however long each is — and it refuses by MARKER
 * rather than by contents, so an `APP1` is refused whatever it says inside.
 *
 * - `APP0` (`FFE0`, JFIF) is admitted; `APP2` only with the ICC identifier.
 * - Every other `APP1`–`APP15` (`FFE1`–`FFEF`) is refused, by name.
 * - `COM` (`FFFE`) is refused: a comment is free text.
 * - A segment whose length runs past the buffer, a length under two, a byte
 *   that is not a marker where one must be, a second start-of-image or an
 *   end-of-image before the scan, and a header that never reaches the scan are
 *   each `malformed` — refused, because a header this cannot walk is a header
 *   it cannot vouch for.
 *
 * Used where a picture from the PHONE is held: the link's arrival check
 * (`side-link-pictures.ts` §`sidePictureFrom`) and the snapshot's save
 * (`snapshot-keeper.ts` §`snapshotProblem`). Names no offset (D-8).
 */
export function jpegMetadataSegmentsIn(bytes: Uint8Array): readonly string[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return ['malformed'];
  }
  const found: string[] = [];
  let at = 2;
  for (;;) {
    if (at + 1 >= bytes.length || bytes[at] !== 0xff) {
      return [...found, 'malformed'];
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      // A fill byte before the marker.
      at += 1;
      continue;
    }
    if (marker === 0xda) {
      return found;
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) {
      return [...found, 'malformed'];
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Standalone markers carry no length.
      at += 2;
      continue;
    }
    if (at + 3 >= bytes.length) {
      return [...found, 'malformed'];
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const next = at + 2 + length;
    if (length < 2 || next > bytes.length) {
      return [...found, 'malformed'];
    }
    if (marker === 0xfe) {
      found.push('COM');
    } else if (marker >= 0xe1 && marker <= 0xef) {
      const iccProfile =
        marker === 0xe2 &&
        indexOfSignature(
          bytes.subarray(at + 4, next),
          ICC_PROFILE_IDENTIFIER,
          ICC_PROFILE_IDENTIFIER.length,
        ) === 0;
      if (!iccProfile) {
        found.push(`APP${String(marker - 0xe0)}`);
      }
    }
    at = next;
  }
}

/**
 * Whether a picture from the phone may be held: neither the segment walk
 * ({@link jpegMetadataSegmentsIn}) nor the signature scan
 * ({@link metadataMarkersIn}) finds anything. Both, because the scan also
 * looks inside the segments the walk admits.
 */
export function carriesNoMetadata(bytes: Uint8Array): boolean {
  return jpegMetadataSegmentsIn(bytes).length === 0 && metadataMarkersIn(bytes).length === 0;
}

/**
 * Where `signature` starts within the first `limit` bytes, or `-1`.
 *
 * Written out rather than going through a `TextDecoder` over the buffer: a
 * decoder would have to be told an encoding, would rewrite invalid sequences as
 * U+FFFD, and would allocate a string as long as the window for every capture.
 * A byte comparison has none of those questions.
 */
function indexOfSignature(bytes: Uint8Array, signature: string, limit: number): number {
  const needle = Array.from(signature, (character) => character.charCodeAt(0));
  const last = limit - needle.length;
  for (let start = 0; start <= last; start += 1) {
    let matched = true;
    for (const [offset, code] of needle.entries()) {
      if (bytes[start + offset] !== code) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return start;
    }
  }
  return -1;
}

/**
 * A frame, if these bytes carry no metadata.
 *
 * @throws {CameraCaptureError} of kind `unavailable` when they do. The message
 * is the fixed one from `notice.ts` and names **no marker offset, no byte and
 * no locator** — D-8 applies to this refusal exactly as it applies to every
 * other message here, and "the picture contained Exif at offset 2" would be a
 * diagnostic about the frame written into a log about the frame.
 *
 * ⚠️ **The marker names are NOT carried anywhere**, and this paragraph used to
 * say they were — on a `markers` field that no type here declares and nothing
 * ever returned. `metadataMarkersIn` is exported and `frame.test.ts` reads it
 * directly, which is where a name is wanted; a `CapturedFrame` carrying a list
 * of what was found in it would be a diagnostic about the frame travelling with
 * the frame, which is the shape D-8 exists to refuse.
 *
 * ⚠️ **The media type is CHECKED rather than passed through**, and it used to
 * be passed through. Every layer downstream assumes JPEG — `keep.ts` stores the
 * bytes untouched, and the account export names the file `.jpg` and labels it
 * `image/jpeg` — so a grabber that quietly answered with something else would
 * hand a rider a file whose name and content disagree, and this program would
 * be the one that made it. There is exactly one encoder here
 * ({@link FRAME_MEDIA_TYPE}, and `canvasFrameGrabber` asks `toBlob` for it by
 * name), so anything else is a fault rather than a format to support.
 */
export function capturedFrame(input: {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly width: number;
  readonly height: number;
}): CapturedFrame {
  if (input.bytes.length === 0) {
    throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
  }
  if (input.mediaType !== FRAME_MEDIA_TYPE) {
    throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
  }
  const markers = metadataMarkersIn(input.bytes);
  if (markers.length > 0) {
    throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
  }
  return {
    bytes: input.bytes,
    mediaType: input.mediaType,
    width: input.width,
    height: input.height,
  };
}
