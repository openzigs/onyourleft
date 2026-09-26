// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side-camera link in the pinned Chromium — #529. Read
 * `sidelink-harness.ts`' header first: what it proves, and the two things it
 * does not.
 */

import { expect, test } from '@playwright/test';

import type { SideLinkMeasurement } from './sidelink-harness';

let measurement: SideLinkMeasurement;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const response = await page.goto('/sidelink.html');
  expect(
    response?.status(),
    'sidelink.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylSideLink !== undefined, undefined, {
    timeout: 45_000,
  });
  const published = await page.evaluate(() => window.__oylSideLink);
  if (published === undefined) {
    throw new Error('the side-link harness published nothing');
  }
  measurement = published;
  await page.close();
});

test.describe('the side-camera link, in a real engine', () => {
  test('pairs through both codes, with nothing reported wrong on the way', () => {
    expect(measurement.errors).toEqual([]);
    expect(measurement.connectMilliseconds).toBeDefined();
    // Printed, not bounded: one machine's loopback says nothing about a LAN.
    console.log(
      `side link: connected ${String(Math.round(measurement.connectMilliseconds ?? -1))} ms after the answer was accepted`,
    );
  });

  test('draws the offer and reads it back off a canvas', () => {
    expect(measurement.codeReadBack).toBe(true);
  });

  test('reads the synthetic camera through the real code sampler, at a bounded size', () => {
    const read = measurement.cameraRead;
    expect(read).toBeDefined();
    expect(Math.max(read?.width ?? 0, read?.height ?? 0)).toBeGreaterThan(0);
    expect(Math.max(read?.width ?? 0, read?.height ?? 0)).toBeLessThanOrEqual(640);
    expect(read?.whole).toBe(true);
    // A rolling colour pattern has no code in it.
    expect(read?.found).toBeUndefined();
  });

  test('carried only candidates on a private network, in both codes', () => {
    expect(measurement.offerAddresses.length).toBeGreaterThan(0);
    expect(measurement.answerAddresses.length).toBeGreaterThan(0);
    for (const address of [...measurement.offerAddresses, ...measurement.answerAddresses]) {
      // The decoder has already refused anything else; this is the measured
      // half — what a real engine offered, with no ICE server configured.
      expect(address).toMatch(
        /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|f[cd]|fe[89ab]|[0-9a-f-]+\.local$)/i,
      );
    }
  });

  test('shows the phone’s state on the tablet, and acknowledges a start and a stop', () => {
    expect(measurement.framing?.phone).toBe('framing');
    expect(measurement.afterStart?.command).toEqual({ kind: 'start', status: 'acknowledged' });
    expect(measurement.afterStop?.command).toEqual({ kind: 'stop', status: 'acknowledged' });
    expect(measurement.phoneHeard).toEqual(
      expect.arrayContaining([{ kind: 'start' }, { kind: 'stop' }]),
    );
  });

  test('sends pictures phone → tablet, small, whole and numbered — #530', () => {
    expect(measurement.picturesSent).toEqual(['sent', 'sent', 'sent']);
    for (const size of measurement.pictureSizes) {
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(256);
      expect(Math.max(size.width, size.height)).toBeGreaterThan(0);
    }
    expect(measurement.picturesArrived.map((each) => [each.sequence, each.milliseconds])).toEqual([
      [0, 0],
      [1, 200],
      [2, 400],
    ]);
    for (const each of measurement.picturesArrived) {
      expect(each.jpeg).toBe(true);
      expect(each.bytes).toBeGreaterThan(0);
    }
    console.log(
      `side link: pictures of ${measurement.picturesArrived.map((each) => String(each.bytes)).join(', ')} bytes`,
    );
  });

  test('ends at both ends when the tablet ends it', () => {
    expect(measurement.tabletEnded?.ended).toBe('ended-here');
    expect(measurement.phoneCondition).toBe('ended');
  });
});
