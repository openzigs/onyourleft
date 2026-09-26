// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One picture on the side-camera link's `frames` channel, and the refusal
 * of everything that is not one** — #530,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3 and D-4.
 *
 * D-3's phone → tablet column: *"Single frames, **not a clip**, at about **5
 * per second** and about **256 px** […] Each carries a sequence number and
 * milliseconds since the session started, and **nothing else**."* So a
 * message is nine bytes of header and a JPEG:
 *
 * | Bytes | What |
 * |---|---|
 * | 0 | {@link SIDE_PICTURE_VERSION} |
 * | 1–4 | the sequence number, unsigned, big-endian |
 * | 5–8 | milliseconds since the phone started filming, unsigned, big-endian |
 * | 9– | the picture: a JPEG the phone re-encoded from pixels (`frame.ts`) |
 *
 * ⚠️ **No wall-clock time, no arrival time, and no field for one.** D-3's
 * *"the camera stands alone"* is held on the tablet by never storing a pose
 * with anything but these two numbers (`side-analysis.ts`), and on the wire by
 * the phone having nothing else to send.
 *
 * ## Untrusted input (D-4)
 *
 * {@link sidePictureFrom} returns `undefined` for anything that is not exactly
 * one picture — a string, a message too short or too long, a version this
 * build does not know, bytes that are not a whole JPEG — and `side-link.ts`
 * ends the pairing on `undefined`, as it does for an unknown control message.
 *
 * ⚠️ **It also refuses a picture carrying a metadata marker**, with
 * `frame.ts` §`metadataMarkersIn`. D-9's strip point is on the phone and an
 * honest phone never sends one, so a picture with an Exif block in it is a
 * phone running something that is not this client, and the tablet will not
 * hold it even for the length of one inference.
 */

import { metadataMarkersIn } from './frame';

/** The first byte of every picture this build sends and the only one it reads. */
export const SIDE_PICTURE_VERSION = 1;

/** Header bytes before the picture itself. */
export const SIDE_PICTURE_HEADER_BYTES = 9;

/**
 * The largest picture message this build sends or reads: 64 KiB.
 *
 * ## Provenance
 *
 * D-3: *"A picture must fit the connection's `sctp.maxMessageSize` or be split
 * into chunks. #530 checks the size rather than assuming it."* 65 536 bytes is
 * the size RFC 8841 §6 tells an endpoint to assume when the other end states
 * no `max-message-size`, so it is the one size every engine must accept; the
 * phone ALSO reads the connection's own figure (`side-link.ts`
 * §`pictureRoom`) and uses the smaller. Chromium states 262 144, which the
 * fake peers in `testing.ts` copy.
 *
 * A 256-pixel JPEG at `frame.ts` §`FRAME_QUALITY` is a few tens of kilobytes
 * (spike 0010 §2's input was 26 KB), so a picture never needs splitting and
 * this build never splits one: a picture too big to send is not sent, and is
 * counted, rather than chunked into a reassembly buffer on an unordered,
 * unreliable channel where a lost chunk would strand the rest.
 */
export const MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES = 64 * 1024;

/** The largest sequence number or millisecond count the header can hold. */
const MAXIMUM_HEADER_NUMBER = 0xffff_ffff;

/** One picture from the side camera, as it crosses and as the tablet holds it. */
export interface SidePicture {
  /** How many pictures the phone sent before this one in this session. */
  readonly sequence: number;
  /** Milliseconds from the phone starting to film to this picture, on the phone's clock. */
  readonly milliseconds: number;
  /** The JPEG. */
  readonly bytes: Uint8Array;
}

/**
 * The message for `picture`, or `undefined` when it cannot be one: a number
 * the header cannot hold, or a picture that would make the message longer
 * than `room`.
 */
export function sidePictureMessage(
  picture: SidePicture,
  room: number = MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES,
): ArrayBuffer | undefined {
  const length = SIDE_PICTURE_HEADER_BYTES + picture.bytes.length;
  if (
    !headerNumber(picture.sequence) ||
    !headerNumber(picture.milliseconds) ||
    length > Math.min(room, MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES)
  ) {
    return undefined;
  }
  const message = new ArrayBuffer(length);
  const view = new DataView(message);
  view.setUint8(0, SIDE_PICTURE_VERSION);
  view.setUint32(1, picture.sequence);
  view.setUint32(5, picture.milliseconds);
  new Uint8Array(message, SIDE_PICTURE_HEADER_BYTES).set(picture.bytes);
  return message;
}

/**
 * The picture in `data`, or `undefined` for anything that is not exactly one —
 * and then the pairing ends (D-4).
 */
export function sidePictureFrom(data: unknown): SidePicture | undefined {
  if (!(data instanceof ArrayBuffer)) {
    return undefined;
  }
  if (
    data.byteLength <= SIDE_PICTURE_HEADER_BYTES ||
    data.byteLength > MAXIMUM_SIDE_PICTURE_MESSAGE_BYTES
  ) {
    return undefined;
  }
  const view = new DataView(data);
  if (view.getUint8(0) !== SIDE_PICTURE_VERSION) {
    return undefined;
  }
  // A copy, so the picture holds only its own bytes and not the header's.
  const bytes = new Uint8Array(data.slice(SIDE_PICTURE_HEADER_BYTES));
  if (!wholeJpeg(bytes) || metadataMarkersIn(bytes).length > 0) {
    return undefined;
  }
  return { sequence: view.getUint32(1), milliseconds: view.getUint32(5), bytes };
}

function headerNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAXIMUM_HEADER_NUMBER;
}

/**
 * Whether `bytes` opens with a JPEG's start-of-image marker and closes with
 * its end-of-image marker. Not a decoder — the model's own decode is that —
 * but it refuses a truncated picture, a PNG and a message of noise before any
 * of them reaches one.
 */
function wholeJpeg(bytes: Uint8Array): boolean {
  const last = bytes.length - 1;
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[last - 1] === 0xff &&
    bytes[last] === 0xd9
  );
}
