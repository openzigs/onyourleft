// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera's pose model in the pinned Chromium — #530. Read
 * `pose-harness.ts`' header first: what it proves, and the three things it
 * does not.
 */

import { expect, test } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

import type { PoseMeasurement } from './pose-harness';

let measurement: PoseMeasurement;
/** Every URL the page and its workers asked for, in order. */
const requested: string[] = [];
const origin = HARNESS_ORIGIN;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('request', (request) => {
    requested.push(request.url());
  });
  // Nothing leaves the machine even if the fence has gone: a request off this
  // origin is recorded above and then refused here, so a regression is a red
  // assertion rather than a log posted to a third party from CI.
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  const response = await page.goto('/pose.html');
  expect(
    response?.status(),
    'pose.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylPose !== undefined, undefined, {
    timeout: 90_000,
  });
  const published = await page.evaluate(() => window.__oylPose);
  if (published === undefined) {
    throw new Error('the pose harness published nothing');
  }
  measurement = published;
  await context.close();
});

test.describe('the pose model, in a real engine', () => {
  test('looks at the pictures with nothing reported wrong on the way', () => {
    expect(measurement.errors).toEqual([]);
    const paced = [...measurement.pacedMilliseconds].sort((a, b) => a - b);
    // Printed, not bounded: this runner is not the tablet (spike 0010 §5 is).
    console.log(
      `pose model: first picture ${String(Math.round(measurement.firstMilliseconds ?? -1))} ms ` +
        `(loading included), then p50 ${String(Math.round(paced[5] ?? -1))} ms over ten`,
    );
  });

  test('finds the rider in a photograph of one, side-on, with the near side’s landmarks', () => {
    const rider = measurement.rider;
    expect(rider?.kind).toBe('pose');
    if (rider?.kind !== 'pose') {
      return;
    }
    // The hip, knee and ankle are what a sagittal leg is made of; a pose
    // without them is not one the report could use.
    const names = rider.pose.landmarks.map((mark) => mark.name);
    expect(names).toEqual(expect.arrayContaining(['hip', 'knee', 'ankle']));
    for (const mark of rider.pose.landmarks) {
      expect(mark.x).toBeGreaterThanOrEqual(0);
      expect(mark.x).toBeLessThanOrEqual(1);
      expect(mark.visibility).toBeGreaterThanOrEqual(0.5);
    }
    // The photograph is 500 × 314.
    expect(rider.pose.aspect).toBeCloseTo(500 / 314, 2);
  });

  test('finds nobody in a blank picture — the control for the one above', () => {
    expect(measurement.blank).toEqual({ kind: 'no-rider' });
  });

  test('answers unreadable for bytes that are not a picture, and goes on working', () => {
    expect(measurement.noise).toEqual({ kind: 'unreadable' });
  });

  test('loads the model and its runtime from this origin, and reaches no other — even when MediaPipe flushes its usage log', () => {
    expect(measurement.closed).toBe(true);
    // The control: the worker's own requests ARE visible here, so an empty
    // list of strangers is not an empty list of requests.
    expect(requested.some((url) => url.endsWith('/pose/pose_landmarker_lite.task'))).toBe(true);
    expect(requested.some((url) => url.endsWith('/pose/vision_wasm_module_internal.wasm'))).toBe(
      true,
    );
    const elsewhere = requested.filter((url) => new URL(url).origin !== origin);
    expect(elsewhere).toEqual([]);
  });
});
