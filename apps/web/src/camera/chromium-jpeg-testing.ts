// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Two pictures the real encoder wrote** — `canvas.toBlob('image/jpeg', 0.8)`
 * of a 16 × 16 canvas in the pinned Playwright Chromium (153.0.8010.12, revision
 * 1243), one with `colorSpace: 'srgb'` and one with `'display-p3'`, captured on
 * 2026-10-08 for #1063's review, round 2.
 *
 * What they are for: `frame.ts` §`jpegMetadataSegmentsIn` is an ALLOWLIST
 * written from what a canvas encoder emits, and an allowlist that refused the
 * encoder's own output would refuse every live side-camera picture (#530). So
 * `frame.test.ts` holds the allowlist to these bytes in the fast suite, and
 * `browser/frame.browser.spec.ts` holds it to whatever the pinned Chromium
 * writes on the day, so a Chromium bump that changes the encoder is seen.
 *
 * Each is: SOI, `APP0` JFIF with no thumbnail, `APP2` with Skia's ICC profile
 * (456 bytes for sRGB, 520 for Display P3; tags `desc`, `rXYZ`, `gXYZ`,
 * `bXYZ`, `wtpt`, `rTRC`/`gTRC`/`bTRC` sharing one `para` curve, `cprt`), two
 * `DQT`, `SOF0`, four `DHT`, one `SOS` and its scan, and `EOI`.
 *
 * ⚠️ Not the Android WebView's output, which nobody has measured yet (#733).
 * Test support; never shipped.
 */

function decoded(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** The sRGB canvas's picture: 808 bytes. */
export function chromiumSrgbJpeg(): Uint8Array {
  return decoded(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAA' +
      'AABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAA' +
      'ABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAA' +
      'AAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAA' +
      'AAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAA' +
      'AABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYF' +
      'BAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMK' +
      'ChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEB' +
      'AxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAYEAACAwAAAAAAAAAAAAAAAAACEQASIf/EABUBAQEAAAAAAAAAAAAAAAAA' +
      'AAQG/8QAJBEAAAELBQAAAAAAAAAAAAAAABETFSMlMTJRUmJkgYKRkvD/2gAMAwEAAhEDEQA/AJzOqxuAOzxKDCy1KACr1uCX' +
      'HrNJcvE0yERlbqusPij/2Q==',
  );
}

/** The Display P3 canvas's picture: 879 bytes. */
export function chromiumDisplayP3Jpeg(): Uint8Array {
  return decoded(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/4gIYSUNDX1BST0ZJTEUAAQEAAAIIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAA' +
      'AABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAAGRyWFlaAAABVAAAABRnWFlaAAABaAAAABRiWFlaAAABfAAA' +
      'ABR3dHB0AAABkAAAABRyVFJDAAABpAAAAChnVFJDAAABpAAAAChiVFJDAAABpAAAAChjcHJ0AAABzAAAADxtbHVjAAAAAAAA' +
      'AAEAAAAMZW5VUwAAAEYAAAAcAEQAaQBzAHAAbABhAHkAIABQADMAIABHAGEAbQB1AHQAIAB3AGkAdABoACAAcwBSAEcAQgAg' +
      'AFQAcgBhAG4AcwBmAGUAcgAAWFlaIAAAAAAAAIPeAAA9vv///7tYWVogAAAAAAAASr4AALE2AAAKuVhZWiAAAAAAAAAoOwAA' +
      'EQwAAMjNWFlaIAAAAAAAAPbWAAEAAAAA0y1wYXJhAAAAAAAEAAAAAmZmAADypwAADVkAABPQAAAKWwAAAAAAAAAAbWx1YwAA' +
      'AAAAAAABAAAADGVuVVMAAAAgAAAAHABHAG8AbwBnAGwAZQAgAEkAbgBjAC4AIAAyADAAMQA2/9sAQwAGBAUGBQQGBgUGBwcG' +
      'CAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigo' +
      'KCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgAEAAQAwEiAAIRAQMRAf/EABUA' +
      'AQEAAAAAAAAAAAAAAAAAAAAD/8QAGxAAAQQDAAAAAAAAAAAAAAAAEQADBBITIkH/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/8QA' +
      'IBEAAAILAAAAAAAAAAAAAAAAABETFSMlMlJiY4KS8P/aAAwDAQACEQMRAD8AtJfw11sT0JGfzW1qB0pJYzV2qDwpGYw22sRw' +
      'I9okpBjuV1/KbWHjH//Z',
  );
}
