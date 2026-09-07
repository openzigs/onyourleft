// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The browser gate: what a real engine does, which jsdom cannot answer.
 *
 * `map/port.ts` records why the rest of the map suite runs against a seam —
 * jsdom implements no WebGL, so MapLibre cannot be constructed there. That
 * leaves exactly three questions open, and this file is all three:
 *
 * 1. Does MapLibre **initialise** against the style we build?
 * 2. Does `addProtocol` take effect in a real engine, so a `pmtiles://` URL is
 *    actually routed through the handler?
 * 3. **Which hosts does the engine really contact?** #63's third criterion says
 *    *"a test intercepts all network traffic during a map render and fails if
 *    any request host is outside the configured basemap origin"*, and this is
 *    the only place that sentence can be executed literally. A request a
 *    dependency issues on its own — a worker script, a font fallback, a
 *    telemetry ping — is in no style at all and is invisible to `styleOrigins`.
 *
 * ⚠️ **Point 3 does not subsume `styleOrigins`, and an earlier draft of this
 * comment said it did.** The two catch different things and the difference was
 * found by mutation, not by reasoning: adding a third-party `glyphs` URL to
 * `basemapStyle` turns the jsdom check red and leaves **this whole file
 * green**. Glyphs are fetched lazily, only when a symbol layer needs to draw
 * text, and the minimal style has no symbol layers — so the browser never asks
 * for them and the interception has nothing to see.
 *
 * So: `styleOrigins` catches a third-party URL that is *declared*, even one
 * nothing fetches; this file catches a host that is *contacted* but declared
 * nowhere. Neither is the other's superset, both are load-bearing, and
 * deleting either leaves a real hole.
 *
 * ⚠️ **This does not prove tiles render.** There is no published archive (#53),
 * so the archive request 404s. What is asserted is that the request was made,
 * to the right host, through the protocol handler — the routing, not the
 * picture. The limit is named here rather than left for a reader to infer.
 */

import { expect, test } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import type { HarnessResult } from './harness';

/** Where the harness asks for its archive. Same origin as the page. */
const ARCHIVE_PATH = '/basemap.pmtiles';

/**
 * Hosts a request is permitted to reach.
 *
 * Exactly one. Not a list with an exception in it, because the moment this
 * grows a second entry the criterion it enforces has been renegotiated, and
 * that should be a visible diff rather than a quiet addition.
 */
const PERMITTED_ORIGIN = HARNESS_ORIGIN;

interface Seen {
  readonly requests: string[];
  readonly failures: string[];
}

/** Record every request the page makes, from the first byte of navigation. */
function watch(page: import('@playwright/test').Page): Seen {
  const requests: string[] = [];
  const failures: string[] = [];
  page.on('request', (request) => {
    requests.push(request.url());
  });
  page.on('requestfailed', (request) => {
    failures.push(request.url());
  });
  return { requests, failures };
}

async function harnessResult(
  page: import('@playwright/test').Page,
): Promise<HarnessResult | undefined> {
  await page.waitForFunction(() => window.__oylHarness !== undefined);
  return page.evaluate(() => window.__oylHarness);
}

/**
 * Wait until the archive has actually been asked for.
 *
 * ⚠️ **Not `waitForLoadState('networkidle')`, and the reason is worth keeping.**
 * There is no archive to serve (#53), so the request 404s — and MapLibre
 * *retries* a failed source. The network therefore never goes idle, and every
 * assertion behind `networkidle` waits out its timeout instead of running. The
 * first version of this file did exactly that: one test passed and four burned
 * sixty seconds each.
 *
 * Waiting on the event we actually care about is both faster and stricter: it
 * fails immediately if the request is never made, which is what a broken
 * protocol registration would look like.
 */
function archiveRequested(
  page: import('@playwright/test').Page,
): Promise<import('@playwright/test').Request> {
  return page.waitForRequest((request) => request.url().endsWith(ARCHIVE_PATH));
}

test.describe('the map engine in a real browser', () => {
  test('initialises MapLibre against the style we build, with a live WebGL context', async ({
    page,
  }) => {
    await page.goto('/');
    const result = await harnessResult(page);

    // Every one of these is unreachable from jsdom.
    expect(result?.errors).toEqual([]);
    expect(result?.created).toBe(true);
    expect(result?.canvas).toBe(true);
    // If this fails, read `playwright.config.ts` — the SwiftShader flags are
    // what make a GPU-less runner able to give MapLibre a context at all.
    expect(result?.webgl).toBe(true);
  });

  test('registers the pmtiles protocol exactly once in the shipping registry', async ({ page }) => {
    await page.goto('/');
    const result = await harnessResult(page);
    expect(result?.registrations).toBe(1);
  });

  test('requests the archive from the configured origin', async ({ page }) => {
    // ⚠️ On its own this does **not** prove the request went through the
    // pmtiles handler, and an earlier version of this test claimed it did. A
    // mutation dropping the `pmtiles://` prefix leaves the URL a plain vector
    // source, which MapLibre fetches as TileJSON from the same host — same
    // request, different code path, test still green. The test below is the
    // one that tells them apart.
    const seen = watch(page);
    const requested = archiveRequested(page);
    await page.goto('/');
    await requested;

    const archive = seen.requests.filter((url) => url.endsWith(ARCHIVE_PATH));
    expect(archive.length).toBeGreaterThan(0);
    expect(archive[0]).toBe(`${PERMITTED_ORIGIN}${ARCHIVE_PATH}`);
  });

  test('makes no archive request at all when the protocol is not registered', async ({ page }) => {
    // The discriminator. With `?protocol=off` the handler is never registered,
    // so `pmtiles://…` is a scheme MapLibre does not know and it asks for
    // nothing. That is only true while the URL actually carries the selector:
    // drop it and this page fetches the archive as ordinary TileJSON, the
    // request appears, and this test goes red. Which is what makes the pair
    // above and below a proof rather than a coincidence.
    const seen = watch(page);
    await page.goto('/?protocol=off');
    const result = await harnessResult(page);

    // Deterministic half: the registry itself says it registered nothing.
    expect(result?.registrations).toBe(0);

    // Bounded negative half. A "nothing happened" assertion needs a time box,
    // and this is the only place in the gate that waits on a duration rather
    // than an event — there is no event for a request that is never made. Kept
    // small because the positive case above fires in about 200 ms.
    await page.waitForTimeout(2000);
    expect(seen.requests.filter((url) => url.endsWith(ARCHIVE_PATH))).toEqual([]);
  });

  test('contacts no host but the configured origin — criterion 3, literally', async ({ page }) => {
    // The assertion `styleOrigins` cannot make. It reads every request the page
    // issued, including ones no style mentions: a web worker MapLibre spawns, a
    // font it falls back to, anything a dependency decided to fetch on its own.
    const seen = watch(page);
    const requested = archiveRequested(page);
    await page.goto('/');
    await requested;
    await harnessResult(page);

    expect(seen.requests.length).toBeGreaterThan(0);
    const foreign = seen.requests.filter((url) => {
      // `blob:` and `data:` never leave the page, so they are not a host.
      if (url.startsWith('blob:') || url.startsWith('data:')) {
        return false;
      }
      return new URL(url).origin !== PERMITTED_ORIGIN;
    });
    expect(foreign, `requests left the configured origin: ${foreign.join(', ')}`).toEqual([]);
  });

  test('fails to load the archive, because there is not one yet — #53', async ({ page }) => {
    // Asserted rather than tolerated. The day #53 publishes an archive this
    // test goes red, which is the correct moment for someone to come back here
    // and replace it with one that asserts tiles actually drew.
    const seen = watch(page);
    const requested = archiveRequested(page);
    await page.goto('/');
    await requested;

    const response = await page.request.get(`${PERMITTED_ORIGIN}${ARCHIVE_PATH}`);
    expect(response.status()).toBe(404);
    // And the failure stayed local: it did not send the engine looking anywhere
    // else for a fallback.
    for (const url of seen.failures) {
      expect(new URL(url).origin).toBe(PERMITTED_ORIGIN);
    }
  });
});
