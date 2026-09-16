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
 * ⚠️ **This file used to say it did not prove tiles render, and that is no
 * longer true of the whole of it** — a reviewer who remembers the paragraph
 * *"there is no published archive, so the archive request 404s… the routing,
 * not the picture"* is reading the old file. It still describes the first
 * `describe` block exactly: those tests drive `/basemap.pmtiles`, which does
 * 404, and the 404 is asserted rather than tolerated so that the day #53
 * publishes an archive the gate goes red and somebody comes back.
 *
 * The **second** block is what changed. `pmtiles-fixture.ts` builds a PMTiles
 * v3 archive from arithmetic, `vite.browser.config.ts` emits it into the
 * harness build at a **different** path, and the gate renders from it — so
 * "a tile decoded and reached the drawing buffer" is now checked, and the
 * client's share of a cold load is measured. What is still not checked is
 * anything about a *hosted* archive: see that block's own note, and #53.
 */

import { expect, test } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import type { HarnessResult, MapLoadResult } from './harness';
import { FIXTURE_ARCHIVE_FILE } from './pmtiles-fixture';

/** Where the harness asks for its archive. Same origin as the page. */
const ARCHIVE_PATH = '/basemap.pmtiles';

/**
 * The archive `vite.browser.config.ts` emits, on the same origin as the page.
 *
 * ⚠️ A **different path** from {@link ARCHIVE_PATH}, deliberately, and this is
 * the decision most worth reading before changing anything below. The tests
 * above assert that `/basemap.pmtiles` **404s**, because #53 has not published
 * one, and they exist so the day it does the gate goes red and somebody comes
 * back. Serving the fixture at that path would discharge that tripwire by
 * making it permanently green against a file of our own — which is the same
 * shape as a test that cannot fail. So the fixture is additive: it proves what
 * a real engine does with a real archive, and it leaves the "there is still no
 * published basemap" assertion exactly as it was.
 */
const FIXTURE_PATH = `/${FIXTURE_ARCHIVE_FILE}`;
const FIXTURE_URL = `${HARNESS_ORIGIN}${FIXTURE_PATH}`;

/**
 * How long the control page waits before reporting that nothing painted.
 *
 * A negative assertion needs a time box, and this one is not picked by feel:
 * the fixture test below requires its own first paint to land inside **half**
 * of it. So a machine slow enough to make this box too short fails the positive
 * test first, with a number in the message, rather than turning the control
 * into a quiet false pass.
 */
const CONTROL_DEADLINE_MS = 3000;

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
 * What the page saw reach the drawing buffer, once it has stopped watching.
 *
 * Published either on the frame a tile painted or at the page's own deadline,
 * so waiting on it is waiting on an event in both directions — including the
 * one where the answer is "nothing".
 */
async function mapLoad(page: import('@playwright/test').Page): Promise<MapLoadResult> {
  await page.waitForFunction(() => window.__oylMapLoad !== undefined);
  const result = await page.evaluate(() => window.__oylMapLoad);
  if (result === undefined) {
    throw new Error('the harness published no map-load result');
  }
  return result;
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

/**
 * What a real engine does with a real archive — and what it costs.
 *
 * Everything above this line was written against an archive that does not
 * exist, and says so. Two of #63's criteria could not be reached from there:
 *
 * - **Criterion 1**, whose first half is *"a recorded activity with GPS renders
 *   its trace over the basemap"*. The trace is asserted in three places already;
 *   *over the basemap* had no basemap to be over.
 * - **Criterion 8**, *"Cold-load behaviour is measured and recorded in the PR:
 *   time to first painted tile on a cold cache"* — which needs a tile to paint.
 *
 * `pmtiles-fixture.ts` supplies one: a PMTiles v3 archive built from arithmetic,
 * emitted into the harness build, carrying no OpenStreetMap data. It is served
 * from the harness origin, so it is **localhost latency**, and that is the whole
 * of what separates this from the measurement #63 actually asks for.
 *
 * ⚠️ **What this measurement is NOT.** ADR 0010 D-1 and #53 both quote
 * Protomaps' own warning that R2 is *"known to have higher latency (500 ms or
 * higher)"*, and criterion 8's last sentence points straight at it. A loopback
 * server removes that term by construction. What is left is the **floor** — the
 * part of the number that would remain if the host were infinitely fast — and a
 * decomposition: the archive's own range requests are reported beside the total,
 * so the hosted figure, when there is a host, can be read as latency rather than
 * as an unexplained sum. Criterion 8 is therefore **partly** discharged and the
 * remainder still belongs to #53.
 *
 * ⚠️ And it is a headless Chromium on a software rasteriser in CI, against an
 * **uncompressed** 98-byte tile. A real basemap tile is gzipped and thousands of
 * times larger. Nothing here says what a phone on mobile data will see.
 */
test.describe('a real archive, rendered and timed', () => {
  test('paints the archive’s own tiles under the ride trace — criterion 1, and 7', async ({
    page,
  }) => {
    // The archive is named in the URL rather than in the code, which is
    // criterion 7 — *"the basemap URL is configuration, and a test proves the
    // map renders against a second archive URL without a code change"* —
    // executed by a real engine rather than by a style comparison. Nothing in
    // `apps/web/src` mentions this file.
    const seen = watch(page);
    await page.goto(`/?archive=${encodeURIComponent(FIXTURE_URL)}`);
    const load = await mapLoad(page);

    expect(
      load.painted,
      `no basemap colour reached the drawing buffer. Looked for ${load.basemapColours.join(', ')}; ` +
        `read ${load.samples.join(', ')} over ${String(load.frames)} frames`,
    ).toBe(true);
    // The probe ran on real frames rather than reporting a paint from a single
    // lucky read. Nought frames with `painted` true would mean the mechanism is
    // reporting something other than what it claims.
    expect(load.frames).toBeGreaterThan(0);

    // The colours found are the style's own, not "something other than the
    // background". A fill that drew in the wrong colour is a tile that decoded
    // into the wrong layer, and that is worth telling apart from no tile.
    const basemapSamples = load.samples.filter((sample) => load.basemapColours.includes(sample));
    expect(basemapSamples.length).toBeGreaterThan(0);

    // It came off the wire, from the configured archive, through the protocol
    // handler — and nowhere else. Criterion 3 again, this time on a page where
    // tiles actually flowed rather than one where the source 404d.
    expect(load.archiveRequests.length).toBeGreaterThan(0);
    expect(seen.requests.filter((url) => url.startsWith(FIXTURE_URL)).length).toBeGreaterThan(0);
    const foreign = seen.requests.filter(
      (url) =>
        !url.startsWith('blob:') &&
        !url.startsWith('data:') &&
        new URL(url).origin !== HARNESS_ORIGIN,
    );
    expect(foreign, `requests left the configured origin: ${foreign.join(', ')}`).toEqual([]);

    // And the box the control case below rests on. @see CONTROL_DEADLINE_MS
    expect(load.firstPaintMs).toBeDefined();
    expect(load.firstPaintMs ?? Number.POSITIVE_INFINITY).toBeLessThan(CONTROL_DEADLINE_MS / 2);
  });

  test('paints no tile colour at all when the archive is missing — the control', async ({
    page,
  }) => {
    // ⚠️ **The half that makes the test above mean something.** Without it, a
    // probe reading a cleared buffer, a canvas that never existed, a palette
    // derived from the wrong layers and a genuinely working map would all be
    // indistinguishable from each other — three of those four would report
    // "painted" as false, and nobody would be looking. Here the archive 404s,
    // so the ONLY thing that may be on screen is the style's background and the
    // ride's own trace, and the assertion is that the tile colours are absent
    // rather than that anything in particular is present.
    await page.goto(`/?paintDeadline=${String(CONTROL_DEADLINE_MS)}`);
    const load = await mapLoad(page);

    expect(load.painted).toBe(false);
    expect(load.firstPaintMs).toBeUndefined();
    // The probe did run: a page that rendered no frames would report no paint
    // for a reason that has nothing to do with the archive.
    expect(load.frames).toBeGreaterThan(0);
    // Something was on screen, and it was the background the style declares.
    // Without this the "no tile colour" assertion is satisfied by a blank
    // canvas, an unloaded stylesheet, or a readback of all zeros.
    expect(load.samples).toContain(load.backgroundColour);
    for (const sample of load.samples) {
      expect(
        load.basemapColours,
        `a tile colour appeared with no archive: ${sample}`,
      ).not.toContain(sample);
    }
  });

  test('records what a cold load costs the client — criterion 8, as far as it goes', async ({
    page,
  }, testInfo) => {
    // A fresh Playwright context per test means an empty HTTP cache, which is
    // what "cold" means here. `transferredBytes` is reported for each request
    // so that a run where the browser served the archive from cache after all
    // is visible in the number rather than hidden inside it.
    await page.goto(`/?archive=${encodeURIComponent(FIXTURE_URL)}`);
    const load = await mapLoad(page);

    expect(load.painted).toBe(true);
    const clientMs = load.firstPaintMs ?? Number.NaN;
    const pageMs = load.firstPaintSinceNavigationMs ?? Number.NaN;
    expect(Number.isFinite(clientMs)).toBe(true);
    expect(Number.isFinite(pageMs)).toBe(true);
    expect(clientMs).toBeGreaterThan(0);
    // The page cannot have painted before it started loading, and the client's
    // share cannot exceed the whole. Two sanity bounds rather than a budget:
    // ⚠️ **no wall-clock threshold is asserted and one must not be added.** An
    // absolute millisecond gate on a shared runner is flaky, a flaky gate gets
    // disabled, and a disabled gate is how a performance claim survives with
    // nobody re-running it — the same reasoning `game.browser.spec.ts` records
    // for the shading cost.
    expect(pageMs).toBeGreaterThanOrEqual(clientMs);

    // ⚠️ **More than two, and the reason is worth knowing before anybody reads
    // the hosted number.** The header and the root directory arrive together in
    // one prefetch of the first 16 KB — which is *why* the PMTiles spec requires
    // the root directory to live there — and both are cached for the life of the
    // page. The **tiles** are not: `SharedPromiseCache` caches headers and
    // directories only, so every visible tile is its own range request even when
    // several of them resolve, as they do here, to the same bytes. A first draft
    // of this comment asserted "two round trips, no more"; the run reported
    // three, because three tiles covered the viewport. On a high-latency store
    // that multiplier is the cold-load cost, and it belongs in #53's reading of
    // whatever number it measures.
    expect(load.archiveRequests.length).toBeGreaterThanOrEqual(1);
    const wire = load.archiveRequests.reduce((total, request) => total + request.durationMs, 0);

    const measured =
      `first painted tile ${clientMs.toFixed(1)} ms after the map was created, ` +
      `${pageMs.toFixed(1)} ms after navigation started; ` +
      `${String(load.archiveRequests.length)} archive range request(s) costing ` +
      `${wire.toFixed(1)} ms in total; ` +
      `${String(load.frames)} frames probed; ` +
      'served from the loopback interface, so this is the client-side floor and ' +
      'carries none of the hosting latency #53 owns';
    testInfo.annotations.push({
      type: 'cold load — time to first painted tile',
      description: measured,
    });
    // Printed as well as annotated: an annotation reaches the JSON and HTML
    // reports and not the log, and the log is the only artefact anybody reads on
    // a green run. #63's criterion 8 says "recorded in the PR", and a number
    // nobody can see is not recorded.
    console.log(`cold load — ${measured}`);
  });
});
