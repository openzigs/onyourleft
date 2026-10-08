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
import { chromiumDisplayP3Jpeg, chromiumSrgbJpeg } from './chromium-jpeg-testing';
import {
  capturedFrame,
  carriesNoMetadata,
  colourProfileProblem,
  jpegMetadataSegmentsIn,
  MAXIMUM_ICC_PROFILE_BYTES,
  metadataMarkersIn,
} from './frame';
import { cleanFrameBytes } from './testing';

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
  const clean = { bytes: cleanFrameBytes(512), mediaType: 'image/jpeg', width: 1280, height: 720 };

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

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const JFIF = segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const TABLE = segment(0xdb, [0x00, ...new Array<number>(64).fill(1)]);
/** One DC table with a single one-bit code. */
const HUFFMAN = segment(0xc4, [0x00, 1, ...new Array<number>(15).fill(0), 0x00]);
const FRAME = segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
const SCAN = segment(0xda, [1, 1, 0x00, 0, 63, 0]);
/**
 * Entropy data the size of a picture — past the signature scan's 4 096-byte
 * window, so the scan cannot be what refuses any probe below — with a stuffed
 * `FF00` and a restart in it, which a walk must step over.
 */
const ENTROPY = [
  ...new Array<number>(3000).fill(0x12),
  0xff,
  0x00,
  0xff,
  0xd3,
  ...new Array<number>(3000).fill(0x34),
];
const EXIF = segment(0xe1, [
  ...ascii('Exif\0\0'),
  ...ascii('MM'),
  0x00,
  0x2a,
  0,
  0,
  0,
  8,
  ...ascii('GPSLatitude 51.5074 N'),
]);
const FILL = new Array<number>(5000).fill(0x20);

/** SOI, `head`, a frame, one scan and its data, and EOI: a whole JPEG. */
function picture(...head: readonly (readonly number[])[]): number[] {
  return [...SOI, ...head.flat(), ...FRAME, ...SCAN, ...ENTROPY, ...EOI];
}

function bytesOf(...parts: readonly (readonly number[])[]): Uint8Array {
  return new Uint8Array(parts.flat());
}

/** An ICC segment's contents: the identifier, chunk `sequence` of `count`, and `profile`. */
function iccSegment(profile: readonly number[], sequence = 1, count = 1): number[] {
  return segment(0xe2, [...ascii('ICC_PROFILE\0'), sequence, count, ...profile]);
}

/** A colour profile built from `tags`, each laid end to end after the table, as Skia lays them. */
function colourProfile(
  tags: readonly (readonly [string, readonly number[]])[],
  patch: (profile: number[]) => void = () => undefined,
): number[] {
  const tableEnd = 132 + 12 * tags.length;
  const data: number[] = [];
  const table: number[] = [];
  for (const [signature, contents] of tags) {
    const offset = tableEnd + data.length;
    table.push(...ascii(signature), ...uint32(offset), ...uint32(contents.length));
    data.push(...contents);
    while (data.length % 4 !== 0) {
      data.push(0);
    }
  }
  const header = new Array<number>(128).fill(0);
  header.splice(36, 4, ...ascii('acsp'));
  const profile = [...header, ...uint32(tags.length), ...table, ...data];
  profile.splice(0, 4, ...uint32(profile.length));
  patch(profile);
  return profile;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

const XYZ = [...ascii('XYZ '), 0, 0, 0, 0, 0, 0, 0x6f, 0xa2, 0, 0, 0x38, 0xf5, 0, 0, 3, 0x90];
const DESCRIPTION = [...ascii('mluc'), 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 12, ...ascii('enUS')];
const COLOUR_TAGS: readonly (readonly [string, readonly number[]])[] = [
  ['desc', DESCRIPTION],
  ['rXYZ', XYZ],
  ['wtpt', XYZ],
];

/** Where the ICC profile starts in the captured Chromium pictures: SOI, APP0, APP2's head. */
const CHROMIUM_PROFILE_AT = 2 + 18 + 4 + 12 + 2;

describe('the real encoder’s pictures are admitted — #1063’s review, round 2', () => {
  it('admits the pinned Chromium’s sRGB and Display P3 canvas JPEGs whole', () => {
    // An allowlist that refused these would refuse every live side-camera
    // picture (#530). `browser/frame.browser.spec.ts` asks the encoder again.
    for (const bytes of [chromiumSrgbJpeg(), chromiumDisplayP3Jpeg()]) {
      expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual([]);
      expect(carriesNoMetadata(bytes)).toBe(true);
    }
  });

  it('admits a built profile of colour tags, so the rules below each refuse ONE thing', () => {
    expect(colourProfileProblem(new Uint8Array(colourProfile(COLOUR_TAGS)))).toBeUndefined();
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF, iccSegment(colourProfile(COLOUR_TAGS))))),
    ).toStrictEqual([]);
  });

  it('admits a progressive file: tables and a second scan after the first', () => {
    const bytes = bytesOf(picture(JFIF, TABLE, HUFFMAN).slice(0, -2), HUFFMAN, SCAN, ENTROPY, EOI);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual([]);
    const progressive = bytesOf(
      SOI,
      JFIF,
      TABLE,
      segment(0xc2, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]),
      SCAN,
      ENTROPY,
      segment(0xdd, [0, 4]),
      SCAN,
      ENTROPY,
      EOI,
    );
    expect(jpegMetadataSegmentsIn(progressive)).toStrictEqual([]);
  });
});

describe('the review’s probes, each refused — #1063’s review, B2 round 2', () => {
  it('refuses an ICC APP2 carrying 5 000 bytes and then an Exif GPS block', () => {
    const bytes = bytesOf(picture(JFIF, iccSegment([...FILL, ...EXIF])));
    expect(metadataMarkersIn(bytes)).toStrictEqual([]);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['APP2']);
    expect(carriesNoMetadata(bytes)).toBe(false);
  });

  it('refuses an ICC APP2 carrying plain GPS and device text', () => {
    const bytes = bytesOf(picture(JFIF, iccSegment(ascii('lat=51.5074 lon=-0.1278 Pixel 8 Pro'))));
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['APP2']);
  });

  it('refuses a profile split into two chunks, and a second profile', () => {
    const profile = colourProfile(COLOUR_TAGS);
    const half = profile.length >> 1;
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(
          picture(
            JFIF,
            iccSegment(profile.slice(0, half), 1, 2),
            iccSegment(profile.slice(half), 2, 2),
          ),
        ),
      ),
    ).toStrictEqual(['APP2', 'APP2']);
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF, iccSegment(profile), iccSegment(profile)))),
    ).toStrictEqual(['APP2']);
    // A whole, valid profile that says it is the first of two chunks.
    expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF, iccSegment(profile, 1, 2))))).toStrictEqual(
      ['APP2'],
    );
  });

  it('refuses a JPEG with Exif embedded in an ICC segment past 4 KiB', () => {
    const embedded = [...SOI, ...JFIF, ...EXIF, ...EOI];
    const bytes = bytesOf(picture(JFIF, iccSegment([...FILL, ...embedded])));
    expect(metadataMarkersIn(bytes)).toStrictEqual([]);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['APP2']);
  });

  it('refuses Exif after the end of the image', () => {
    const bytes = bytesOf(picture(JFIF), EXIF, EOI);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['trailing']);
    expect(carriesNoMetadata(bytes)).toBe(false);
  });

  it('refuses a whole second JPEG, carrying Exif, after the end of the image', () => {
    const bytes = bytesOf(picture(JFIF), picture(JFIF, EXIF));
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['trailing']);
  });

  it('refuses anything at all after the end, a single byte included', () => {
    expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF), [0x00]))).toStrictEqual(['trailing']);
  });

  it('refuses Exif between two scans', () => {
    const bytes = bytesOf(
      picture(JFIF).slice(0, -2),
      segment(0xe1, [...EXIF.slice(4), ...FILL]),
      SCAN,
      ENTROPY,
      EOI,
    );
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['APP1']);
  });

  it('refuses a comment between two scans', () => {
    const bytes = bytesOf(
      picture(JFIF).slice(0, -2),
      segment(0xfe, ascii('home')),
      SCAN,
      ENTROPY,
      EOI,
    );
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['COM']);
  });

  it('refuses an APP0 that is not exactly JFIF with no thumbnail', () => {
    // Exif past 4 KiB inside an APP0 that says JFIF.
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(picture(segment(0xe0, [...ascii('JFIF\0'), ...FILL, ...EXIF.slice(4)]))),
      ),
    ).toStrictEqual(['APP0']);
    // JFXX, the thumbnail extension, carrying a JPEG with Exif.
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(picture(JFIF, segment(0xe0, [...ascii('JFXX\0'), 0x10, ...SOI, ...EXIF, ...EOI]))),
      ),
    ).toStrictEqual(['APP0']);
    // A JFIF thumbnail of 1 × 1.
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(picture(segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0]))),
      ),
    ).toStrictEqual(['APP0']);
  });

  it('refuses a JPG0 segment carrying GPS text', () => {
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF, segment(0xf0, ascii('GPS 51.5074,-0.1278'))))),
    ).toStrictEqual(['JPG0']);
  });

  it('refuses a table, a frame, a scan header or a restart interval padded with text', () => {
    const text = ascii('GPS 51.5,-0.12');
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF, segment(0xdb, [...TABLE.slice(4), ...text])))),
    ).toStrictEqual(['DQT']);
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF, segment(0xc4, [...HUFFMAN.slice(4), ...text])))),
    ).toStrictEqual(['DHT']);
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(SOI, JFIF, segment(0xc0, [...FRAME.slice(4), ...text]), SCAN, ENTROPY, EOI),
      ),
    ).toStrictEqual(['SOF0']);
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(SOI, JFIF, FRAME, segment(0xda, [...SCAN.slice(4), ...text]), ENTROPY, EOI),
      ),
    ).toStrictEqual(['SOS']);
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF, segment(0xdd, [0, 4, ...text])))),
    ).toStrictEqual(['DRI']);
  });

  it('refuses every APPn but a JFIF APP0 and one ICC APP2, by marker whatever it holds', () => {
    for (let marker = 0xe1; marker <= 0xef; marker += 1) {
      const bytes = bytesOf(picture(JFIF, segment(marker, [1, 2, 3])));
      expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual([`APP${String(marker - 0xe0)}`]);
    }
  });

  it('refuses a fill byte or a standalone marker between segments, which the encoder never writes', () => {
    expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF, [0xff])))).toStrictEqual(['FFFF']);
    expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF, [0xff, 0x01])))).toStrictEqual(['FF01']);
    expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF, [0xff, 0xd0])))).toStrictEqual(['RST0']);
  });

  it('refuses a second frame header, and one after a scan', () => {
    expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF, FRAME)))).toStrictEqual(['SOF0']);
    expect(
      jpegMetadataSegmentsIn(bytesOf(picture(JFIF).slice(0, -2), FRAME, SCAN, ENTROPY, EOI)),
    ).toStrictEqual(['SOF0']);
  });

  it('refuses a JFIF or an ICC segment after the frame', () => {
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, FRAME, JFIF, SCAN, ENTROPY, EOI))).toStrictEqual([
      'APP0',
    ]);
    expect(
      jpegMetadataSegmentsIn(
        bytesOf(SOI, FRAME, iccSegment(colourProfile(COLOUR_TAGS)), SCAN, ENTROPY, EOI),
      ),
    ).toStrictEqual(['APP2']);
  });
});

describe('what a colour profile may say — #1063’s review, round 2', () => {
  /** The captured sRGB picture's profile, with `patch` applied at `at` within it. */
  function patchedChromium(at: number, bytes: readonly number[]): Uint8Array {
    const picture = chromiumSrgbJpeg();
    picture.set(bytes, CHROMIUM_PROFILE_AT + at);
    return picture;
  }

  it('reads the captured profile where the patches below assume it is', () => {
    const picture = chromiumSrgbJpeg();
    expect(
      String.fromCharCode(...picture.subarray(CHROMIUM_PROFILE_AT + 36, CHROMIUM_PROFILE_AT + 40)),
    ).toBe('acsp');
  });

  it('refuses a device maker or model in the header', () => {
    expect(jpegMetadataSegmentsIn(patchedChromium(48, ascii('GOOG')))).toStrictEqual(['APP2']);
    expect(jpegMetadataSegmentsIn(patchedChromium(52, ascii('PX8P')))).toStrictEqual(['APP2']);
  });

  it('refuses bytes in the header’s reserved space', () => {
    expect(jpegMetadataSegmentsIn(patchedChromium(110, [0x51]))).toStrictEqual(['APP2']);
  });

  it('refuses a size field that disagrees with the profile, and no acsp', () => {
    expect(jpegMetadataSegmentsIn(patchedChromium(3, [0x00]))).toStrictEqual(['APP2']);
    expect(jpegMetadataSegmentsIn(patchedChromium(36, ascii('xxxx')))).toStrictEqual(['APP2']);
  });

  it('refuses the device tags, a dictionary, and any tag it does not know', () => {
    for (const tag of ['dmnd', 'dmdd', 'meta', 'targ', 'zzzz']) {
      const profile = colourProfile([...COLOUR_TAGS, [tag, ascii('Pixel 8 Pro, 51.5074 N')]]);
      expect(colourProfileProblem(new Uint8Array(profile))).toBe('tag');
      expect(jpegMetadataSegmentsIn(bytesOf(picture(JFIF, iccSegment(profile))))).toStrictEqual([
        'APP2',
      ]);
    }
  });

  it('refuses a description longer than 512 bytes', () => {
    const long: readonly [string, readonly number[]] = [
      'desc',
      [...DESCRIPTION, ...new Array<number>(500).fill(0x41)],
    ];
    expect(colourProfileProblem(new Uint8Array(colourProfile([long])))).toBe('text');
  });

  it('refuses bytes no tag declares: between two tags and after the last', () => {
    const between = colourProfile(COLOUR_TAGS, (profile) => {
      // Move the second tag four bytes on, and write a word in the gap.
      const entry = 132 + 12;
      const offset =
        ((profile[entry + 4] ?? 0) << 24) |
        ((profile[entry + 5] ?? 0) << 16) |
        ((profile[entry + 6] ?? 0) << 8) |
        (profile[entry + 7] ?? 0);
      profile.splice(offset, 0, ...ascii('home'));
      profile.splice(entry + 4, 4, ...uint32(offset + 4));
      const third = entry + 12;
      const thirdOffset =
        ((profile[third + 4] ?? 0) << 24) |
        ((profile[third + 5] ?? 0) << 16) |
        ((profile[third + 6] ?? 0) << 8) |
        (profile[third + 7] ?? 0);
      profile.splice(third + 4, 4, ...uint32(thirdOffset + 4));
      profile.splice(0, 4, ...uint32(profile.length));
    });
    expect(colourProfileProblem(new Uint8Array(between))).toBe('uncovered');
    const after = colourProfile(COLOUR_TAGS, (profile) => {
      profile.push(...ascii('lat=51.5074'));
      profile.splice(0, 4, ...uint32(profile.length));
    });
    expect(colourProfileProblem(new Uint8Array(after))).toBe('uncovered');
  });

  it('refuses a tag that runs outside the profile, or into the tag table', () => {
    const outside = colourProfile(COLOUR_TAGS, (profile) => {
      profile.splice(132 + 8, 4, ...uint32(4096));
    });
    expect(colourProfileProblem(new Uint8Array(outside))).toBe('tag range');
    const intoTable = colourProfile(COLOUR_TAGS, (profile) => {
      profile.splice(132 + 4, 4, ...uint32(100));
    });
    expect(colourProfileProblem(new Uint8Array(intoTable))).toBe('tag range');
  });

  it('refuses a profile larger than 16 KiB, whatever it holds', () => {
    const big = colourProfile([
      [
        'rTRC',
        [...ascii('curv'), 0, 0, 0, 0, ...uint32(8200), ...new Array<number>(16_400).fill(0)],
      ],
    ]);
    expect(big.length).toBeGreaterThan(MAXIMUM_ICC_PROFILE_BYTES);
    expect(colourProfileProblem(new Uint8Array(big))).toBe('size');
  });
});

describe('the rest of the walk', () => {
  it('refuses a segment whose length runs past the buffer', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x40, 0x00, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9,
    ]);
    expect(jpegMetadataSegmentsIn(bytes)).toStrictEqual(['malformed']);
  });

  it('refuses a length under two, a stray byte, an early end, and a file with no frame or no scan', () => {
    expect(
      jpegMetadataSegmentsIn(bytesOf(SOI, [0xff, 0xe0, 0x00, 0x01], FRAME, SCAN, EOI)),
    ).toStrictEqual(['malformed']);
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, [0x00, 0xe0, 0x00, 0x02], EOI))).toStrictEqual([
      'malformed',
    ]);
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, EOI))).toStrictEqual(['malformed']);
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, JFIF, FRAME, EOI))).toStrictEqual(['malformed']);
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, JFIF, SCAN, ENTROPY, EOI))).toStrictEqual([
      'SOS',
      'malformed',
    ]);
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, JFIF, FRAME, SCAN, ENTROPY))).toStrictEqual([
      'malformed',
    ]);
    expect(jpegMetadataSegmentsIn(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toStrictEqual([
      'malformed',
    ]);
  });

  it('refuses a zero marker and a second start-of-image', () => {
    for (const marker of [0x00, 0xd8]) {
      expect(
        jpegMetadataSegmentsIn(bytesOf(picture(JFIF, [0xff, marker, 0x00, 0x02]))),
      ).toStrictEqual(['malformed']);
    }
  });

  it('keeps what it found before a malformed tail', () => {
    expect(jpegMetadataSegmentsIn(bytesOf(SOI, EXIF, [0xff, 0xe0, 0x40, 0x00]))).toStrictEqual([
      'APP1',
      'malformed',
    ]);
  });
});

describe('a captured frame is held to the same walk — #1063’s review, round 2', () => {
  it('refuses a frame carrying Exif after its end, which the signature scan alone admitted', () => {
    const bytes = bytesOf(picture(JFIF), EXIF, EOI);
    expect(metadataMarkersIn(bytes)).toStrictEqual([]);
    expect(() => capturedFrame({ bytes, mediaType: 'image/jpeg', width: 16, height: 16 })).toThrow(
      CameraCaptureError,
    );
  });

  it('accepts the real encoder’s output', () => {
    expect(
      capturedFrame({
        bytes: chromiumDisplayP3Jpeg(),
        mediaType: 'image/jpeg',
        width: 16,
        height: 16,
      }).bytes.length,
    ).toBe(879);
  });
});
