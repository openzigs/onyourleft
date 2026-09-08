// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The renderer, in a real browser with a real GL context.
 *
 * The second spec in the browser gate, and it exists for the same reason as the
 * first: **jsdom implements no WebGL**, so `game/three-renderer.ts` cannot be
 * constructed in the Vitest suite at all. Everything about the game that *is*
 * arithmetic — the fixed-tick simulation, the corridor geometry, the quality
 * ladder, the marker placement, the whole HUD — is asserted in jsdom, and what
 * is left here is only what genuinely needs a context.
 *
 * ⚠️ **This is the only automated check that #91's renderer works at all.**
 * ADR 0008 D-2's spike — 30 fps sustained for 20 minutes on floor hardware in a
 * Capacitor WebView with live BLE — is not this, cannot be run in CI, and was
 * **waived rather than passed** for this branch (see the 2026-09-08 amendment on
 * ADR 0008). What this spec establishes is much narrower and is worth stating
 * exactly: the renderer constructs, the geometry is one a driver accepts, and a
 * frame reaches the drawing buffer. It says nothing about frame *rate*, nothing
 * about thermal behaviour, and nothing about how any of it behaves on a phone.
 */

import { expect, test } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

/** What `game-harness.ts` publishes. Mirrored rather than imported — see below. */
interface GameHarnessResult {
  readonly created: boolean;
  readonly hasContext: boolean;
  readonly framesDrawn: number;
  readonly drewPixels: boolean;
  readonly quadCount: number;
  readonly vertexCount: number;
  readonly markerKinds: readonly string[];
  readonly errors: readonly string[];
}

async function harness(page: import('@playwright/test').Page): Promise<GameHarnessResult> {
  await page.goto(`${HARNESS_ORIGIN}/game.html`);
  // The harness publishes synchronously at the end of `run()`, so waiting on the
  // property existing is waiting on the module having executed — not on a timer.
  await page.waitForFunction(() => window.__oylGameHarness !== undefined);
  return page.evaluate(() => window.__oylGameHarness as GameHarnessResult);
}

test.describe('the game renderer in a real browser', () => {
  test('constructs against a live WebGL context', async ({ page }) => {
    const result = await harness(page);

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(true);
    // The claim jsdom cannot make. If SwiftShader ever stops giving the runner a
    // context this goes red, which is the right outcome: a renderer nobody can
    // construct is not a renderer that works.
    expect(result.hasContext).toBe(true);
  });

  test('accepts the geometry terrain.ts builds', async ({ page }) => {
    const result = await harness(page);

    // A vertex buffer whose length disagrees with its index buffer is a
    // type-correct object that a driver rejects at draw time, which is why this
    // is asserted here rather than only in `terrain.test.ts`.
    expect(result.quadCount).toBeGreaterThan(0);
    expect(result.vertexCount).toBe((result.quadCount + 1) * 6);
  });

  test('draws a frame, rather than merely returning from render()', async ({ page }) => {
    const result = await harness(page);

    expect(result.framesDrawn).toBe(3);
    // Read back from the drawing buffer. `render` not throwing is a weaker claim
    // and is the one a harness gets for free.
    expect(result.drewPixels).toBe(true);
  });

  test('survives its buffers being reused across frames', async ({ page }) => {
    // Three frames, because the renderer reuses and only grows its vertex
    // buffer. A single-frame harness cannot see a reuse bug at all.
    const result = await harness(page);

    expect(result.framesDrawn).toBe(3);
    expect(result.errors).toEqual([]);
  });

  test('places the rider and the bot on the road', async ({ page }) => {
    const result = await harness(page);

    expect(result.markerKinds).toContain('rider');
    expect(result.markerKinds).toContain('bot');
  });
});
