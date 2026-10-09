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
 * it **refuses** bytes that are anything but what a canvas encoder writes
 * ({@link jpegMetadataSegmentsIn}) or that carry a metadata marker. So an adapter that skips
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
 * The identifier an `APP2` segment carrying an ICC colour profile opens with.
 */
const ICC_PROFILE_IDENTIFIER = 'ICC_PROFILE\0';

/**
 * The largest ICC profile a picture may carry: 16 KiB.
 *
 * ## Provenance
 *
 * Measured (#1063's review, round 2, 2026-10-08): the pinned Chromium's
 * `canvas.toBlob('image/jpeg')` writes a **456-byte** profile for an `srgb`
 * canvas and a **520-byte** one for `display-p3` — Skia's own, with
 * parametric curves. The Android WebView is the same Skia encoder and has NOT
 * been measured (#733 owes it), so the bound is not set at the measured size:
 * a matrix profile whose three curves are 1 024-entry tables, the largest
 * shape a colour-only RGB writer commonly emits, is about 6.3 KiB, and 16 KiB
 * is that with room. It sits well inside one `APP2` chunk (65 519 bytes) and a
 * quarter of a side-camera picture message
 * (`side-link-pictures.ts` §`MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES`), so what it
 * bounds is how much a profile may say, not whether one fits.
 */
export const MAXIMUM_ICC_PROFILE_BYTES = 16 * 1024;

/**
 * The largest a profile's free-text tag (`desc`, `cprt`) may be: 512 bytes.
 * Skia writes 36 and 100 for the description and 60 for the copyright.
 */
const MAXIMUM_ICC_TEXT_TAG_BYTES = 512;

/**
 * The tags a colour profile may carry: colour, and the two names a profile
 * gives itself. ⚠️ An ALLOWLIST — `dmnd` and `dmdd` (the device's maker and
 * model), `meta` (a free dictionary) and any tag this list does not name are
 * refused.
 */
const ICC_COLOUR_TAGS: ReadonlySet<string> = new Set([
  'desc',
  'cprt',
  'wtpt',
  'bkpt',
  'rXYZ',
  'gXYZ',
  'bXYZ',
  'rTRC',
  'gTRC',
  'bTRC',
  'kTRC',
  'chad',
  'chrm',
  'cicp',
  'A2B0',
  'A2B1',
  'A2B2',
  'B2A0',
  'B2A1',
  'B2A2',
]);

/** The two free-text tags, held to {@link MAXIMUM_ICC_TEXT_TAG_BYTES}. */
const ICC_TEXT_TAGS: ReadonlySet<string> = new Set(['desc', 'cprt']);

/** An ICC profile's header and tag count, before the tag table. */
const ICC_TAG_TABLE_START = 132;

/**
 * Everything in a JPEG this program will not hold, found by walking the WHOLE
 * file against an ALLOWLIST of what a canvas JPEG encoder writes (#1063's
 * review, B2 and its round 2). Empty means the file is that and nothing else.
 *
 * ## What is admitted, and nothing else is
 *
 * | Marker | Admitted when |
 * |---|---|
 * | `SOI` | the first two bytes, and nowhere else |
 * | `APP0` | once, before the frame, in exactly the JFIF form: identifier `JFIF\0`, length 16, version 1, no thumbnail |
 * | `APP2` | once, before the frame: ONE ICC profile in one chunk (sequence 1 of 1) that passes {@link colourProfileProblem} |
 * | `DQT`, `DHT` | anywhere before `EOI`, with a length equal to the tables they declare |
 * | `DRI` | with length 4 |
 * | `SOF0`, `SOF1`, `SOF2` | once, before the first scan, 8-bit, with a length equal to its components |
 * | `SOS` | after the frame, with a length equal to its components — and its entropy data is stepped over (`FF00` stuffing, `RST0`–`RST7`, fill bytes) to the next marker |
 * | `EOI` | as exactly the last two bytes, after at least one scan |
 *
 * Every other marker — `APP1`–`APP15` but that one `APP2`, `COM`, `JPG0`–`JPG13`,
 * `DNL`, `TEM`, a stray `RSTn`, a second `SOI` — is refused by name, wherever
 * it is: in the header, between two scans, or after the end. Anything after
 * `EOI` is `trailing`; a length past the buffer, a byte that is not a marker
 * where one must be, or a file with no frame or no scan is `malformed`.
 *
 * ## Why an allowlist, and the whole file
 *
 * Round 1's walk stopped at the first scan and refused a denylist of `APPn`
 * and `COM`. The review's probes walked straight past it: Exif in an `APP1`
 * between two scans, or after `EOI`, or in a whole second JPEG after `EOI`; a
 * non-JFIF `APP0`, a `JPG0`, or a `DQT` padded with text; and an ICC
 * `APP2` carrying a GPS block. A denylist is complete on the day it is written;
 * a list of what the one encoder here writes is complete by construction, and
 * a segment whose length must equal its declared contents has no room for a
 * sentence.
 *
 * ⚠️ **What it cannot see** is anything in the PIXELS — a picture of a street
 * sign is a picture of a street sign — and the residue a colour profile is
 * allowed (§{@link colourProfileProblem}). It is a check that the bytes are a
 * re-encode, not a proof that they say nothing.
 *
 * Used wherever a picture is held: {@link capturedFrame}, the side link's
 * arrival check (`side-link-pictures.ts` §`sidePictureFrom`) and the
 * snapshot's save (`snapshot-keeper.ts` §`snapshotProblem`). Names no offset
 * (D-8).
 */
export function jpegMetadataSegmentsIn(bytes: Uint8Array): readonly string[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return ['malformed'];
  }
  const found: string[] = [];
  let at = 2;
  let jfif = false;
  let profile = false;
  let frame = false;
  let scans = 0;
  for (;;) {
    if (at + 1 >= bytes.length || bytes[at] !== 0xff) {
      return [...found, 'malformed'];
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xd9) {
      if (!frame || scans === 0) {
        return [...found, 'malformed'];
      }
      return at + 2 === bytes.length ? found : [...found, 'trailing'];
    }
    if (!carriesLength(marker)) {
      // A fill byte, `TEM`, a stray `RSTn`, a second `SOI` or a zero: none of
      // them is something the encoder writes between segments.
      return [...found, marker === 0xd8 || marker === 0x00 ? 'malformed' : markerName(marker)];
    }
    if (at + 3 >= bytes.length) {
      return [...found, 'malformed'];
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const next = at + 2 + length;
    if (length < 2 || next > bytes.length) {
      return [...found, 'malformed'];
    }
    const contents = bytes.subarray(at + 4, next);
    const beforeFrame = !frame && scans === 0;
    if (marker === 0xe0) {
      if (jfif || !beforeFrame || !plainJfif(contents)) {
        found.push('APP0');
      }
      jfif = true;
    } else if (marker === 0xe2) {
      if (profile || !beforeFrame || iccSegmentProblem(contents) !== undefined) {
        found.push('APP2');
      }
      profile = true;
    } else if (marker === 0xdb) {
      if (!quantisationTablesFit(contents)) {
        found.push('DQT');
      }
    } else if (marker === 0xc4) {
      if (!huffmanTablesFit(contents)) {
        found.push('DHT');
      }
    } else if (marker === 0xdd) {
      if (contents.length !== 2) {
        found.push('DRI');
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (!beforeFrame || !frameHeaderFits(contents)) {
        found.push(markerName(marker));
      }
      frame = true;
    } else if (marker === 0xda) {
      if (!frame || !scanHeaderFits(contents)) {
        found.push('SOS');
      }
      scans += 1;
      at = endOfEntropyData(bytes, next);
      continue;
    } else {
      found.push(markerName(marker));
    }
    at = next;
  }
}

/** Whether `marker` is followed by a two-byte length. */
function carriesLength(marker: number): boolean {
  return !(
    marker === 0x00 ||
    marker === 0x01 ||
    marker === 0xff ||
    (marker >= 0xd0 && marker <= 0xd8)
  );
}

/** A marker's name, for a refusal: `APP1`, `COM`, `JPG0`, or its two bytes. */
function markerName(marker: number): string {
  if (marker >= 0xe0 && marker <= 0xef) {
    return `APP${String(marker - 0xe0)}`;
  }
  if (marker === 0xfe) {
    return 'COM';
  }
  if (marker >= 0xf0 && marker <= 0xfd) {
    return `JPG${String(marker - 0xf0)}`;
  }
  if (marker >= 0xd0 && marker <= 0xd7) {
    return `RST${String(marker - 0xd0)}`;
  }
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
    return `SOF${String(marker - 0xc0)}`;
  }
  return `FF${marker.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Where the marker after a scan's entropy data starts. Inside it, `FF00` is a
 * stuffed byte, `FFD0`–`FFD7` a restart and a run of `FF` fill; any other
 * `FFxx` is the next marker. The buffer's length when there is none, which the
 * walk then calls `malformed`.
 */
function endOfEntropyData(bytes: Uint8Array, from: number): number {
  let at = from;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const after = bytes[at + 1];
    if (after === undefined) {
      return at;
    }
    if (after === 0x00 || (after >= 0xd0 && after <= 0xd7)) {
      at += 2;
    } else if (after === 0xff) {
      at += 1;
    } else {
      return at;
    }
  }
  return at;
}

/**
 * `APP0` exactly as JFIF writes it with no thumbnail: `JFIF\0`, version 1.x,
 * a density unit of 0–2, a non-zero density, and a thumbnail of 0 × 0 — so
 * its fourteen bytes are all accounted for.
 */
function plainJfif(contents: Uint8Array): boolean {
  return (
    contents.length === 14 &&
    indexOfSignature(contents, 'JFIF\0', 5) === 0 &&
    contents[5] === 1 &&
    (contents[7] ?? 3) <= 2 &&
    ((contents[8] ?? 0) | (contents[9] ?? 0)) !== 0 &&
    ((contents[10] ?? 0) | (contents[11] ?? 0)) !== 0 &&
    contents[12] === 0 &&
    contents[13] === 0
  );
}

/** `DQT`: one or more 8- or 16-bit tables, filling the segment exactly. */
function quantisationTablesFit(contents: Uint8Array): boolean {
  let at = 0;
  while (at < contents.length) {
    const precision = (contents[at] ?? 0) >> 4;
    const table = (contents[at] ?? 0) & 0x0f;
    if (precision > 1 || table > 3) {
      return false;
    }
    at += 1 + (precision === 0 ? 64 : 128);
  }
  return contents.length > 0 && at === contents.length;
}

/** `DHT`: one or more tables, each sixteen counts and their values, filling the segment exactly. */
function huffmanTablesFit(contents: Uint8Array): boolean {
  let at = 0;
  while (at < contents.length) {
    const kind = (contents[at] ?? 0) >> 4;
    const table = (contents[at] ?? 0) & 0x0f;
    if (kind > 1 || table > 3 || at + 17 > contents.length) {
      return false;
    }
    let values = 0;
    for (let index = 1; index <= 16; index += 1) {
      values += contents[at + index] ?? 0;
    }
    if (values > 256) {
      return false;
    }
    at += 17 + values;
  }
  return contents.length > 0 && at === contents.length;
}

/** `SOFn`: 8-bit, a width, one to four components and nothing else. */
function frameHeaderFits(contents: Uint8Array): boolean {
  const components = contents[5] ?? 0;
  return (
    contents[0] === 8 &&
    ((contents[3] ?? 0) | (contents[4] ?? 0)) !== 0 &&
    components >= 1 &&
    components <= 4 &&
    contents.length === 6 + 3 * components
  );
}

/** `SOS`: one to four components, the spectral selection and nothing else. */
function scanHeaderFits(contents: Uint8Array): boolean {
  const components = contents[0] ?? 0;
  return components >= 1 && components <= 4 && contents.length === 4 + 2 * components;
}

/** Why an `APP2`'s contents are not one admissible ICC profile, or `undefined`. */
function iccSegmentProblem(contents: Uint8Array): string | undefined {
  const identifier = ICC_PROFILE_IDENTIFIER.length;
  if (
    contents.length < identifier + 2 ||
    indexOfSignature(contents, ICC_PROFILE_IDENTIFIER, identifier) !== 0
  ) {
    return 'not an ICC profile';
  }
  if (contents[identifier] !== 1 || contents[identifier + 1] !== 1) {
    return 'more than one chunk';
  }
  return colourProfileProblem(contents.subarray(identifier + 2));
}

/**
 * Why `profile` is not a profile that says only colour, or `undefined`.
 *
 * ⚠️ **An ICC profile is NOT metadata-free**, and round 1's comment here said
 * it was ("no tag for a place, a time or a device") — wrong on all three. Its
 * header has a creation date and time (bytes 24–35), the device's maker and
 * model (48–55), a creator (80–83), and its tag table can hold the device's
 * maker and model as text (`dmnd`, `dmdd`), a free dictionary (`meta`) and
 * any private tag at all. So a profile is admitted only when:
 *
 * - its size field equals its length, and that is at most
 *   {@link MAXIMUM_ICC_PROFILE_BYTES};
 * - `acsp` is at 36;
 * - the device's maker and model (48–55) and the reserved bytes (100–127) are zero;
 * - every tag is a colour tag ({@link ICC_COLOUR_TAGS}), lies inside the
 *   profile, and a free-text one is at most {@link MAXIMUM_ICC_TEXT_TAG_BYTES};
 * - and the tags' data covers everything after the tag table, with at most
 *   three zero bytes of alignment between them — so there is nowhere to put a
 *   byte no tag declares.
 *
 * ⚠️ **What is NOT checked, deliberately**: the profile's bytes. The Android
 * WebView's encoder has not been measured on a device (#733 owes it), and a
 * pin to the bytes Chromium writes on a desktop could refuse every live
 * side-camera picture — #530, which has shipped. So the creation date, the
 * creator and the CMM are not read (Skia writes 2016-01-01 and zeroes,
 * measured), and the description and copyright are free text up to 512 bytes
 * each. That residue is the price of not pinning, and it is stated rather
 * than hidden.
 */
export function colourProfileProblem(profile: Uint8Array): string | undefined {
  const length = profile.length;
  if (length < ICC_TAG_TABLE_START || length > MAXIMUM_ICC_PROFILE_BYTES) {
    return 'size';
  }
  if (readUint32(profile, 0) !== length) {
    return 'size';
  }
  if (indexOfSignature(profile.subarray(36), 'acsp', 4) !== 0) {
    return 'signature';
  }
  if (!zeroes(profile, 48, 56) || !zeroes(profile, 100, ICC_TAG_TABLE_START - 4)) {
    return 'device';
  }
  const count = readUint32(profile, 128);
  const tableEnd = ICC_TAG_TABLE_START + 12 * count;
  if (tableEnd > length) {
    return 'tag table';
  }
  const ranges = new Map<string, readonly [number, number]>();
  for (let index = 0; index < count; index += 1) {
    const entry = ICC_TAG_TABLE_START + 12 * index;
    const signature = String.fromCharCode(...profile.subarray(entry, entry + 4));
    const offset = readUint32(profile, entry + 4);
    const size = readUint32(profile, entry + 8);
    if (!ICC_COLOUR_TAGS.has(signature)) {
      return 'tag';
    }
    if (offset < tableEnd || size === 0 || offset + size > length) {
      return 'tag range';
    }
    if (ICC_TEXT_TAGS.has(signature) && size > MAXIMUM_ICC_TEXT_TAG_BYTES) {
      return 'text';
    }
    // Two tags may share one block of data (Skia's three curves do).
    ranges.set(`${String(offset)}+${String(size)}`, [offset, size]);
  }
  let covered = tableEnd;
  for (const [offset, size] of [...ranges.values()].sort((a, b) => a[0] - b[0])) {
    if (offset < covered || offset - covered > 3 || !zeroes(profile, covered, offset)) {
      return 'uncovered';
    }
    covered = offset + size;
  }
  if (length - covered > 3 || !zeroes(profile, covered, length)) {
    return 'uncovered';
  }
  return undefined;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) >>> 0) +
    ((bytes[at + 1] ?? 0) << 16) +
    ((bytes[at + 2] ?? 0) << 8) +
    (bytes[at + 3] ?? 0)
  );
}

function zeroes(bytes: Uint8Array, from: number, to: number): boolean {
  for (let at = from; at < to; at += 1) {
    if (bytes[at] !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a picture may be held: neither the whole-file walk
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
  // The same whole-file allowlist the link and the snapshot hold a picture
  // to (#1063's review, round 2), not the signature scan alone: every
  // producer here is a canvas re-encode, which the allowlist is written from,
  // and `frame.browser.spec.ts` holds it to the pinned Chromium's real output.
  if (!carriesNoMetadata(input.bytes)) {
    throw new CameraCaptureError('unavailable', cameraProblemMessage('unavailable'));
  }
  return {
    bytes: input.bytes,
    mediaType: input.mediaType,
    width: input.width,
    height: input.height,
  };
}
