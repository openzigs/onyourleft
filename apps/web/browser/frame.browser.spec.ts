// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The real encoder's pictures pass the allowlist** — #1063's review, round 2.
 *
 * `src/camera/frame.ts` §`jpegMetadataSegmentsIn` admits only what a canvas
 * JPEG encoder writes, and an allowlist that refused the encoder's own output
 * would refuse every live side-camera picture (#530) and every captured frame.
 * So this asks the pinned Chromium's `canvas.toBlob('image/jpeg')` for
 * pictures — both colour spaces a 2D canvas offers, the sizes the side camera
 * and the room camera use, and the quality the client asks for — and holds
 * every one to the same check the link, the snapshot and `capturedFrame` use.
 * The check runs HERE, in Node, over the bytes the page hands back: there is
 * no harness page, because nothing of the client needs to run in the browser
 * for this.
 *
 * Its control: the same real picture with an Exif segment written in after
 * its JFIF must be refused, so a check that admitted everything fails here.
 *
 * ⚠️ Desktop Chromium only. The Android WebView is the same Skia encoder and
 * has NOT been measured (#733 owes it, with `apps/mobile/tools/webview-probe.mjs`).
 */

import { expect, test } from '@playwright/test';

import { carriesNoMetadata, FRAME_QUALITY, jpegMetadataSegmentsIn } from '../src/camera/frame';

const SIZES: readonly (readonly [number, number])[] = [
  [256, 144],
  [640, 480],
  [1280, 720],
];

async function encoded(
  page: import('@playwright/test').Page,
  colourSpace: 'srgb' | 'display-p3',
  width: number,
  height: number,
): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    async ([space, w, h, quality]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d', { colorSpace: space });
      if (context === null) {
        throw new Error('no 2D context');
      }
      for (let index = 0; index < 60; index += 1) {
        context.fillStyle = `hsl(${String(index * 11)}, 70%, 50%)`;
        context.fillRect((index * 37) % w, (index * 23) % h, 50, 40);
      }
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      });
      if (blob === null) {
        throw new Error('the canvas encoded nothing');
      }
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    [colourSpace, width, height, FRAME_QUALITY] as const,
  );
  return new Uint8Array(bytes);
}

test.describe('the canvas encoder and the JPEG allowlist — #1063', () => {
  for (const colourSpace of ['srgb', 'display-p3'] as const) {
    test(`admits every ${colourSpace} picture the pinned Chromium encodes`, async ({ page }) => {
      await page.setContent('<!doctype html><title>encoder</title>');
      for (const [width, height] of SIZES) {
        const bytes = await encoded(page, colourSpace, width, height);
        expect(jpegMetadataSegmentsIn(bytes), `${String(width)}×${String(height)}`).toStrictEqual(
          [],
        );
        expect(carriesNoMetadata(bytes)).toBe(true);
      }
    });
  }

  test('refuses the same real picture with an Exif segment written in — the control', async ({
    page,
  }) => {
    await page.setContent('<!doctype html><title>encoder</title>');
    const bytes = await encoded(page, 'srgb', 256, 144);
    // SOI and the 18-byte JFIF segment, then an APP1 Exif, then the rest.
    const exif = [
      0xff, 0xe1, 0x00, 0x0e, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0, 0x2a, 0, 0,
    ];
    const tampered = new Uint8Array([...bytes.subarray(0, 20), ...exif, ...bytes.subarray(20)]);
    expect(jpegMetadataSegmentsIn(tampered)).toStrictEqual(['APP1']);
    expect(carriesNoMetadata(tampered)).toBe(false);
  });
});
