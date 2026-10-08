// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tripwire under ADR 0029 D-9, and the fixtures that prove it can fire.
 *
 * ⚠️ **What is under test is a REFUSAL, not a scrubber.** `frame.ts` says why
 * at length: the stripping is done by the canvas re-encode, which cannot carry
 * a marker; this is the check that the re-encode happened. So every case here
 * is either "clean bytes are accepted" or "a camera's own file is refused", and
 * there is deliberately no case asserting that anything was removed — nothing
 * here removes anything.
 */

import { describe, expect, it } from 'vitest';

import { CameraCaptureError } from './camera-port';
import {
  capturedFrame,
  carriesNoMetadata,
  jpegMetadataSegmentsIn,
  metadataMarkersIn,
} from './frame';

/** The first bytes of a JPEG: SOI, then APP0/JFIF. Carries no metadata. */
function cleanJpeg(length = 512): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00], 0);
  // Something that is not all zeroes, so a length check cannot be what passes.
  for (let index = 32; index < length; index += 1) {
    bytes[index] = (index * 37) % 251;
  }
  return bytes;
}

/** The same file with `signature` written into its header, as a camera would. */
function withMarker(signature: string, at = 6): Uint8Array {
  const bytes = cleanJpeg();
  // APP1 in place of APP0, which is where a camera writes Exif.
  bytes[3] = 0xe1;
  for (const [offset, character] of Array.from(signature).entries()) {
    bytes[at + offset] = character.charCodeAt(0);
  }
  return bytes;
}

describe('what counts as metadata', () => {
  it('finds nothing in a re-encoded file', () => {
    expect(metadataMarkersIn(cleanJpeg())).toStrictEqual([]);
  });

  it('finds the Exif segment a camera writes', () => {
    // The one that actually carries the GPS IFD, which is the whole reason
    // ADR 0029 D-9 exists.
    expect(metadataMarkersIn(withMarker('Exif\0\0'))).toStrictEqual(['Exif']);
  });

  it('finds XMP, which a scrubber written against Exif alone leaves behind', () => {
    // `exif:GPSLatitude` travels in XMP as text. A "strip the EXIF" filter
    // removes the binary IFD and leaves this, which is the failure mode
    // `frame.ts` argues a filter cannot be trusted to avoid.
    expect(metadataMarkersIn(withMarker('http://ns.adobe.com/xap/1.0/'))).toStrictEqual(['XMP']);
  });

  it('finds IPTC', () => {
    expect(metadataMarkersIn(withMarker('Photoshop 3.0'))).toStrictEqual(['IPTC']);
  });

  it('finds a PNG’s metadata chunks', () => {
    expect(metadataMarkersIn(withMarker('eXIf'))).toStrictEqual(['PNG eXIf']);
    expect(metadataMarkersIn(withMarker('tEXt'))).toStrictEqual(['PNG tEXt']);
    expect(metadataMarkersIn(withMarker('iTXt'))).toStrictEqual(['PNG iTXt']);
  });

  it('does not scan the whole file for a header marker', () => {
    // A four-byte string appears about once in four billion bytes of
    // compressed image data — rare per image and certain across a library.
    // `Exif` deep inside the entropy-coded data is a coincidence and refusing
    // on it would be a gate that fires on good pictures, which gets deleted.
    const bytes = new Uint8Array(9000);
    bytes.set([0xff, 0xd8], 0);
    bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 8000);
    expect(metadataMarkersIn(bytes)).toStrictEqual([]);
  });

  it('finds a marker that straddles nothing and is simply at the end of the window', () => {
    // The loop's boundary: a signature whose last byte is the last byte of the
    // window must still be found, and an off-by-one in `last` would miss it.
    const bytes = new Uint8Array(4096);
    bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4096 - 6);
    expect(metadataMarkersIn(bytes)).toStrictEqual(['Exif']);
  });
});

describe('constructing a frame', () => {
  const clean = { bytes: cleanJpeg(), mediaType: 'image/jpeg', width: 1280, height: 720 };

  it('accepts a re-encoded picture and keeps its size', () => {
    const frame = capturedFrame(clean);
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(720);
    expect(frame.bytes.length).toBe(512);
  });

  it('refuses a picture that came straight off a camera', () => {
    expect(() => capturedFrame({ ...clean, bytes: withMarker('Exif\0\0') })).toThrow(
      CameraCaptureError,
    );
  });

  it('refuses empty bytes rather than holding a zero-length picture', () => {
    expect(() => capturedFrame({ ...clean, bytes: new Uint8Array(0) })).toThrow(CameraCaptureError);
  });

  it('refuses a media type other than the one encoder here', () => {
    // ⚠️ Every layer downstream assumes JPEG — `keep.ts` stores the bytes
    // untouched and the account export names the file `.jpg` and labels it
    // `image/jpeg` — so a grabber that quietly answered with something else
    // would hand a rider a file whose name and its content disagree, and this
    // program would be the one that made it.
    expect(() => capturedFrame({ ...clean, mediaType: 'image/png' })).toThrow(CameraCaptureError);
    expect(() => capturedFrame({ ...clean, mediaType: 'image/webp' })).toThrow(CameraCaptureError);
    // A near miss is a miss: the comparison is the whole string.
    expect(() => capturedFrame({ ...clean, mediaType: 'image/jpg' })).toThrow(CameraCaptureError);
    expect(() => capturedFrame({ ...clean, mediaType: '' })).toThrow(CameraCaptureError);
  });

  it('carries no part of the refused media type in what it says', () => {
    // ADR 0029 D-8 binds a message ABOUT a frame, and the media type a grabber
    // answered with is a fact about that frame.
    try {
      capturedFrame({ ...clean, mediaType: 'image/png' });
      expect.unreachable('the refusal did not fire');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toMatch(/png|image\//i);
    }
  });

  it('says nothing about the marker, the offset or the file in its message', () => {
    // ADR 0029 D-8. "Exif at offset 6" is a diagnostic about the frame written
    // into a log about the frame, and the rule has no exception for a message
    // that is only about the metadata.
    try {
      capturedFrame({ ...clean, bytes: withMarker('Exif\0\0') });
      expect.unreachable('the refusal did not fire');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('Exif');
      expect(message).not.toMatch(/offset|byte 6|blob:|data:/i);
    }
  });
});

/** A segment: its marker byte and its payload, the length written for it. */
function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

/** SOI, `segments`, a scan header, some entropy data and EOI. */
function walkedJpeg(...segments: readonly (readonly number[])[]): Uint8Array {
  const head = [0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x02];
  return new Uint8Array([...head, 0x12, 0x34, 0x56, 0xff, 0xd9]);
}

const JFIF = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const ICC = segment(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, ...new Array<number>(64).fill(7)]);
const TABLE = segment(0xdb, new Array<number>(65).fill(1));
const FRAME = segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
const EXIF = segment(0xe1, [...ascii('Exif\0\0'), 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);

describe('walking a JPEG header — #1063’s review, B2', () => {
  it('admits what the canvas encoder writes: JFIF, an ICC profile, tables and a frame', () => {
    const bytes = walkedJpeg(JFIF, ICC, TABLE, FRAME);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual([]);
    expect(carriesNoMetadata(bytes)).toBe(true);
  });

  it('finds Exif placed after a segment longer than the signature scan’s window', () => {
    // The review's probe: a 5 000-byte APP2, then APP1 Exif. The scan misses
    // it — which is the bypass — and the walk does not.
    const padding = segment(0xe2, new Array<number>(5000).fill(0x20));
    const bytes = walkedJpeg(JFIF, padding, EXIF, FRAME);
    expect(metadataMarkersIn(bytes)).toStrictEqual([]);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['APP2', 'APP1']);
    expect(carriesNoMetadata(bytes)).toBe(false);
  });

  it('finds Exif after a long ICC profile, which is itself admitted', () => {
    const longIcc = segment(0xe2, [...ascii('ICC_PROFILE\0'), ...new Array<number>(6000).fill(3)]);
    expect(jpegMetadataSegmentsIn(walkedJpeg(JFIF, longIcc, EXIF, FRAME))).toStrictEqual(['APP1']);
  });

  it('refuses every APPn but APP0 and an ICC APP2, by marker whatever it holds', () => {
    for (let marker = 0xe1; marker <= 0xef; marker += 1) {
      const bytes = walkedJpeg(JFIF, segment(marker, [1, 2, 3]));
      expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual([`APP${String(marker - 0xe0)}`]);
    }
  });

  it('refuses a comment segment', () => {
    const bytes = walkedJpeg(JFIF, segment(0xfe, ascii('taken at home')), FRAME);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['COM']);
    expect(carriesNoMetadata(bytes)).toBe(false);
  });

  it('refuses a segment whose length runs past the buffer', () => {
    // An APP0 claiming 0x4000 bytes in a buffer of a few dozen.
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x40, 0x00, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
    ]);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['malformed']);
  });

  it('refuses a length under two, a stray byte, an early end and a header with no scan', () => {
    expect(
      jpegMetadataSegmentsIn(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xda, 0, 2, 0xff, 0xd9]),
      ),
    ).toStrictEqual(['malformed']);
    expect(
      jpegMetadataSegmentsIn(new Uint8Array([0xff, 0xd8, 0x00, 0xe0, 0x00, 0x02, 0xff, 0xd9])),
    ).toStrictEqual(['malformed']);
    expect(
      // EOI, then bytes that would read as a two-byte length and a scan: an
      // end before the scan is the end, not a segment.
      jpegMetadataSegmentsIn(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x02, 0xff, 0xda])),
    ).toStrictEqual(['malformed']);
    expect(jpegMetadataSegmentsIn(new Uint8Array([0xff, 0xd8, ...JFIF]))).toStrictEqual([
      'malformed',
    ]);
    expect(jpegMetadataSegmentsIn(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toStrictEqual([
      'malformed',
    ]);
  });

  it('refuses a zero marker and a second start-of-image, however walkable what follows', () => {
    for (const marker of [0x00, 0xd8]) {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, marker, 0x00, 0x02, 0xff, 0xda, 0x00, 0x02]);
      expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['malformed']);
    }
  });

  it('keeps what it found before a malformed tail', () => {
    const bytes = new Uint8Array([0xff, 0xd8, ...EXIF, 0xff, 0xe0, 0x40, 0x00]);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['APP1', 'malformed']);
  });

  it('steps over fill bytes and standalone markers before the scan', () => {
    const bytes = walkedJpeg(JFIF, [0xff], [0xff, 0x01], FRAME);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual([]);
  });
});
