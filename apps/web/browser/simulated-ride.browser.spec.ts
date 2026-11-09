// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2379: a simulated ride, on the PRODUCTION build, draws its scene.
 *
 * `#/game?simulate=<watts>` rides the rider's own route with no trainer. On the
 * tablet it drew nothing: `GameView.tsx` §`useSimulatedRide` gave the ride
 * effect a new `frameNow` function on every render, so the effect was torn down
 * and run again on every render, each run calling the renderer's loader (every
 * scenery model and the colour atlas again, about 65 and 924 fetches in 8 s)
 * and being cancelled before `renderer.create(canvas)`. The canvas stayed at
 * the 300×150 default. Every unit test injects `now` and `frameNow`, so none
 * had seen it; this one injects nothing — it is the shipped app, a route
 * imported through its own form, and the address switch.
 *
 * What is read back is the engine's: the canvas's drawing buffer, which the
 * renderer sets only once it has made a view, and the requests the page made
 * for each scenery model and the atlas.
 */

import { expect, test } from '@playwright/test';

import { PRODUCT_ORIGIN } from '../playwright.config';

/** Three kilometres due north from 0° 0°, climbing 1 %, a point every ten metres. */
function gpx(): string {
  const points: string[] = [];
  for (let index = 0; index <= 300; index += 1) {
    const latitude = ((index * 10) / 111_320).toFixed(7);
    points.push(
      `<trkpt lat="${latitude}" lon="0.0000000"><ele>${(index * 0.1).toFixed(1)}</ele></trkpt>`,
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="spec" xmlns="http://www.topografix.com/GPX/1/1">',
    '<trk><name>Straight north</name><trkseg>',
    ...points,
    '</trkseg></trk></gpx>',
  ].join('');
}

/** The browser's default canvas buffer, which a canvas nothing was drawn on keeps. */
const DEFAULT_CANVAS_WIDTH = 300;

test.describe('a simulated ride on the production build — #2379', () => {
  test('draws its scene, and fetches each scenery asset at most once', async ({ page }) => {
    const fetched = new Map<string, number>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/\.(glb|png)$/.test(url.pathname)) {
        fetched.set(url.pathname, (fetched.get(url.pathname) ?? 0) + 1);
      }
    });

    await page.goto(`${PRODUCT_ORIGIN}/#/routes`);
    await page.locator('main #route-file').setInputFiles({
      name: 'north.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from(gpx()),
    });
    await page.getByRole('button', { name: 'Import route' }).click();
    await expect(page.locator('main [role=status]').first()).toBeVisible();

    await page.goto(`${PRODUCT_ORIGIN}/#/game?simulate=250`);
    await page.getByRole('button', { name: /^Ride /u }).click();

    const canvas = page.locator('canvas.oyl-game__world');
    await expect(canvas).toBeVisible();
    // The renderer resizes the buffer when it has made its view, and not before.
    await expect
      .poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width), {
        message: 'the canvas kept its 300×150 default: no view was ever made',
        timeout: 20_000,
      })
      .toBeGreaterThan(DEFAULT_CANVAS_WIDTH);

    // Let the ride run on, so that renders happen after the view exists.
    await page.waitForTimeout(3_000);
    const models = [...fetched].filter(([path]) => path.endsWith('.glb'));
    expect(models.length, 'the scenery models were fetched at all').toBeGreaterThan(0);
    for (const [path, count] of models) {
      expect(count, `${path} was requested ${String(count)} times`).toBe(1);
    }
    // The colour atlas is read through each building model that names it, so
    // once per building — not once per render, which was 924 requests in 8 s.
    const buildings = models.filter(([path]) => path.includes('building-')).length;
    const atlas = [...fetched].filter(([path]) => path.includes('colormap'));
    expect(atlas.length, 'the colour atlas was fetched at all').toBeGreaterThan(0);
    for (const [path, count] of atlas) {
      expect(count, `${path} was requested ${String(count)} times`).toBeLessThanOrEqual(buildings);
    }
  });
});
