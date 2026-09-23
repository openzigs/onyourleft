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
import { capturedFrame, metadataMarkersIn } from './frame';

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
