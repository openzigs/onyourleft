// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The capture page, in a real browser.
 *
 * ⚠️ **This spec cannot check that a capture is correct, and does not claim
 * to.** A CI runner has no Bluetooth adapter, no trainer and no rider, so
 * everything about a real device is #137's and #134's to establish with
 * hardware. Saying that plainly is the point of this header — a green browser
 * gate here is not evidence that anything was captured.
 *
 * What it does check is the one failure this gate is capable of preventing, and
 * it is the expensive one: **the page being broken on the single afternoon
 * somebody has the hardware in front of them.** A validation session is a
 * borrowed trainer, a booked hour and a person on a bike; discovering there that
 * `capture.html` throws on load, or that `recordingBluetooth` deforms the real
 * `navigator.bluetooth` into something the transport refuses, would cost the
 * whole session and cannot be recovered by fixing it afterwards.
 *
 * Three claims, and each is one jsdom cannot make:
 *
 * 1. **The page loads and reaches the end of its start-up**, with the real
 *    transport, the real four ride profiles and the real trainer client
 *    constructed. jsdom cannot: it has no `navigator.bluetooth` at all, so the
 *    Vitest suite only ever drives the fake stack.
 * 2. **The wrapper does not deform the port.** The page reads availability
 *    twice — once through the raw `navigator.bluetooth` and once through
 *    `recordingBluetooth`'s wrapper — and the two answers must agree. A wrapper
 *    that dropped `getAvailability`, or returned a device object missing a
 *    member, shows up here rather than in a garage.
 * 3. **Nothing threw on the way through.** The harness collects its own errors
 *    rather than letting them reach the console, so an empty list is a real
 *    assertion rather than the absence of one.
 */

import { expect, test } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

/** What `capture-harness.ts` publishes. Mirrored, not imported — as game's is. */
interface CaptureHarnessResult {
  readonly ready: boolean;
  readonly availability: string;
  readonly availabilityUnwrapped: string;
  readonly wrapped: boolean;
  readonly events: number;
  readonly errors: readonly string[];
}

async function harness(page: import('@playwright/test').Page): Promise<CaptureHarnessResult> {
  await page.goto(`${HARNESS_ORIGIN}/capture.html`);
  await page.waitForFunction(() => window.__oylCaptureHarness?.ready === true);
  return page.evaluate(() => window.__oylCaptureHarness as CaptureHarnessResult);
}

test.describe('the capture page', () => {
  test('starts up without throwing, with the real transport built', async ({ page }) => {
    const result = await harness(page);

    expect(result.errors).toEqual([]);
    expect(result.ready).toBe(true);
    // Nothing has been paired, so nothing has crossed the platform boundary.
    // A non-zero count here would mean the recorder is inventing events.
    expect(result.events).toBe(0);
  });

  test('gives the same availability answer wrapped as unwrapped', async ({ page }) => {
    const result = await harness(page);

    // ⚠️ Deliberately not `toBe('unavailable')`. What this runner's Chromium
    // answers depends on whether it has a Bluetooth stack at all, and pinning
    // that would make the gate a fact about the runner image. What must hold on
    // every machine is that the wrapper changes nothing.
    expect(result.availability).toBe(result.availabilityUnwrapped);
    // And it is one of the answers `readAvailability` can give, not `unknown` —
    // which is the harness's own initial value and would mean the probe never
    // ran.
    expect(['available', 'unsupported', 'adapter-unavailable', 'not-permitted']).toContain(
      result.availability,
    );
  });

  test('tells the rider what the browser can do, in the page itself', async ({ page }) => {
    // The status line is the whole of the page's answer to "why can I not pair
    // anything", and a rider reads it rather than the console.
    const result = await harness(page);
    const status = await page.textContent('#availability');

    expect(status ?? '').not.toBe('');
    expect(status ?? '').not.toContain('Checking whether');
    // The only reason not to wrap is that there is no `navigator.bluetooth` to
    // wrap. The converse does not hold — a browser that exposes the object and
    // throws from `getAvailability` is wrapped and still reports `unsupported`,
    // which is #40's own feature detect and not a fault here.
    expect(result.wrapped || result.availability === 'unsupported').toBe(true);
  });
});
