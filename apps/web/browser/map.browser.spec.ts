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
 * 404 **on the harness server**, and the 404 is asserted rather than tolerated.
 * ⚠️ An earlier draft added *"so the day #53 publishes an archive the gate goes
 * red"*, and that was simply wrong: #53 has published one and this block stayed
 * green, because the path it asks for is served by `vite preview` and by nobody
 * else. The correction is kept rather than the claim deleted.
 *
 * The **second** block is what changed. `pmtiles-fixture.ts` builds a PMTiles
 * v3 archive from arithmetic, `vite.browser.config.ts` emits it into the
 * harness build at a **different** path, and the gate renders from it — so
 * "a tile decoded and reached the drawing buffer" is now checked, and the
 * client's share of a cold load is measured.
 *
 * ⚠️ **The sentence that used to end this comment — *"what is still not checked
 * is anything about a hosted archive"* — is no longer true**, and a reviewer who
 * remembers it is reading the old file. #53 published one, and the **third**
 * block renders this same page against it over the real internet and takes
 * #63's eighth measurement there. It is **opt-in**: `OYL_HOSTED_BASEMAP_URL`,
 * which CI does not set, so `pnpm run test:browser` on a bare clone runs exactly
 * what it ran before. `hosted-archive.ts` argues that trade and says what is
 * done about the skip.
 */

import { expect, test } from '@playwright/test';
import { PMTiles } from 'pmtiles';

import { HARNESS_ORIGIN } from '../playwright.config';
import { MAP_COLOURS } from '../src/map/basemap';
import type { HarnessResult, LabelLoadResult, MapLoadResult, MapProbe } from './harness';
import {
  centreTrack,
  coldLoadReport,
  foreignRequests,
  HOSTED_ARCHIVE_VARIABLE,
  HOSTED_TRACK_METRES,
  permittedOrigins,
  readHostedArchive,
  requireCoverage,
  trackParameter,
  type ArchiveBounds,
  type ArchiveResponseFact,
} from './hosted-archive';
import {
  FIXTURE_ARCHIVE_FILE,
  FIXTURE_BOUNDED_ARCHIVE_FILE,
  FIXTURE_PLACE_NAME,
} from './pmtiles-fixture';

/** Where the harness asks for its archive. Same origin as the page. */
const ARCHIVE_PATH = '/basemap.pmtiles';

/**
 * The archive `vite.browser.config.ts` emits, on the same origin as the page.
 *
 * ⚠️ A **different path** from {@link ARCHIVE_PATH}, deliberately, and this is
 * the decision most worth reading before changing anything below. The tests
 * above assert that `/basemap.pmtiles` **404s** on the harness server, which is
 * what proves `appType: 'mpa'` is still in force — Vite's default would answer
 * with 200 and a page of HTML, and a decoder handed that is a different failure
 * from a decoder handed nothing. Serving the fixture at that path would make
 * that assertion permanently green against a file of our own, which is the same
 * shape as a test that cannot fail. So the fixture is additive and leaves it
 * exactly as it was.
 */
const FIXTURE_PATH = `/${FIXTURE_ARCHIVE_FILE}`;
const FIXTURE_URL = `${HARNESS_ORIGIN}${FIXTURE_PATH}`;

/**
 * The same tiles, declaring only the published archive's coverage (#534).
 * `pmtiles-fixture.ts` §`FIXTURE_BOUNDED_ARCHIVE_FILE` says why it still holds
 * every tile.
 */
const BOUNDED_FIXTURE_URL = `${HARNESS_ORIGIN}/${FIXTURE_BOUNDED_ARCHIVE_FILE}`;

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

/** What the page saw of the labels, once it has stopped watching (#578). */
async function labelLoad(page: import('@playwright/test').Page): Promise<LabelLoadResult> {
  await page.waitForFunction(() => window.__oylLabels !== undefined);
  const result = await page.evaluate(() => window.__oylLabels);
  if (result === undefined) {
    throw new Error('the harness published no label result');
  }
  return result;
}

/**
 * Every warning MapLibre prints when it could not load a glyph range and drew
 * the text in the device's own font instead (#578).
 *
 * MapLibre 6.10's wording, `glyph_manager.ts` §`_warnOnMissingGlyphRange`, and
 * 6.11.2's, character for character (#756). The
 * control below is what says this spelling is still the one it prints: if a
 * MapLibre bump rewords it, the 404 control goes red rather than the positive
 * case going quietly green over a fallback.
 */
function glyphFallbacks(page: import('@playwright/test').Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Unable to load glyph range')) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

/**
 * The glyph ranges {@link FIXTURE_PLACE_NAME} needs, by `{range}` token.
 * Computed from the name, so a new fixture name is checked with no edit here.
 */
const PLACE_NAME_RANGES = [
  ...new Set(
    [...FIXTURE_PLACE_NAME].map((character) => {
      const start = Math.floor((character.codePointAt(0) ?? 0) / 256) * 256;
      return `${String(start)}-${String(start + 255)}`;
    }),
  ),
].sort();

/**
 * Wait until the archive has actually been asked for.
 *
 * ⚠️ **Not `waitForLoadState('networkidle')`, and the reason is NOT the one
 * this comment used to give.** It said the harness's 404 made MapLibre *retry*
 * the failed source so the network never went idle, and that the first
 * version of this file burned sixty seconds a test on it. #535's review
 * measured MapLibre **6.10.0** and found no such loop: an archive answering
 * 404 is asked for **once**, raises two `console.error`s and is not asked for
 * again over ten seconds; a connection dropped mid-request is asked for
 * **twice** and then left alone. Whatever the first version met was an older
 * MapLibre, or something else, and the retry claim is withdrawn rather than
 * kept as folklore. #756 re-measured 6.11.2 against 6.10.0: a 404 is still asked
 * for once, and a connection dropped by #535's own method
 * (`route.abort('internetdisconnected')`) was asked for once on BOTH versions,
 * so the "twice" does not reproduce on either (CLAUDE.md §4f).
 *
 * The advice still holds, for a reason that does not depend on MapLibre's
 * retry policy: `networkidle` resolves just as happily over a page that asked
 * for **nothing**, which is exactly what a broken protocol registration looks
 * like. Waiting on the request we mean fails at once when it is never made,
 * and does not wait out an idle window when it is.
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

  test('fails to load the archive, because this server serves none', async ({ page }) => {
    // ⚠️ **This comment used to predict that #53 publishing an archive would
    // turn this test red, and that was wrong.** #53 has published one, and this
    // stayed green — correctly. `PERMITTED_ORIGIN` is `HARNESS_ORIGIN`, so what
    // is asserted here is that the **harness server** serves nothing at this
    // path, which a bucket somewhere else cannot change. The test is right; the
    // prediction was not, and the correction is recorded rather than the
    // sentence quietly deleted.
    //
    // What it is still worth: `appType: 'mpa'` in `vite.browser.config.ts` is
    // what makes a missing archive a 404 rather than 200 with a page of HTML,
    // and that behaviour is the only thing standing between "there is no
    // archive" and "the archive decoded to nonsense". The hosted block below is
    // where a real archive is asserted against.
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
    // ⚠️ **Half of a pair, whose other half is in the hosted block.** These
    // requests are same-origin, so the browser reports their phases and their
    // byte counts in full — which is what makes `transferredBytes: 0` mean
    // "served from cache" *here*. It means something else entirely on a
    // cross-origin archive, and without this assertion nothing in the gate would
    // notice the difference. @see ArchiveRequestTiming.timingOpaque
    expect(load.archiveRequests.map((request) => request.timingOpaque)).not.toContain(true);
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

/**
 * The archive #53 published, over the real internet — #63's criterion 8.
 *
 * Everything above this line is served from the loopback interface, and says so
 * repeatedly, because criterion 8's last sentence is about **hosting**:
 * *"Protomaps' own deployment docs warn that R2 latency is '500 ms or higher';
 * if the chosen host is R2 this is where it becomes visible."* A localhost
 * server removes that term by construction.
 *
 * This block puts it back. It drives the **same** harness page, through the
 * **same** adapter and the **same** style builder, at a `https:` archive on
 * object storage behind a CDN — which is exactly what #63's seventh criterion
 * asks for in its own words, *"a test proves the map renders against a second
 * archive URL without a code change"*, executed against a second archive that is
 * not ours to control.
 *
 * ⚠️ **Skipped unless `OYL_HOSTED_BASEMAP_URL` is set, and CI sets nothing.**
 * `hosted-archive.ts` argues that trade at length — the short form is that a
 * gate needing somebody else's CDN is a gate that fails on an aeroplane, and
 * that the parts of this which can be decided without a network are decided in
 * `hosted-archive.test.ts`, inside `pnpm run test`.
 *
 * ⚠️ **What it does not prove.** Not that the map looks right: ADR 0009 forbids
 * deriving a reference image from another product, and the assertion here is
 * that colours the style itself declares reached the drawing buffer. Not what a
 * phone on mobile data sees — this is a desktop machine, on whatever connection
 * it has, against whichever CDN edge answered it, and the run's own
 * `cf-cache-status` is reported for that reason rather than assumed. And not
 * that the archive is correct cartography: its contents are #53's.
 */

/**
 * The archive to measure against, read once.
 *
 * ⚠️ Deliberately at module scope, so a **malformed** value fails the whole file
 * at collection rather than inside one test. The variable is spelled out here
 * rather than read through {@link HOSTED_ARCHIVE_VARIABLE} because rule `ENV001`
 * greps for exactly this form — the same reason, recorded in the same words, as
 * `src/map/basemap.ts`'s `browserBasemapConfig`.
 */
const hosted = readHostedArchive({
  OYL_HOSTED_BASEMAP_URL: process.env.OYL_HOSTED_BASEMAP_URL,
});

/**
 * How long a hosted page waits before reporting that nothing painted.
 *
 * ⚠️ **A time box for the negative assertion, not a performance budget**, the
 * same distinction the fixture block records: the positive test requires its
 * paint inside half of this, so a machine or a link slow enough to make the box
 * too short fails the positive test first, with a number in the message, rather
 * than turning the control into a quiet false pass. It is generous because the
 * thing on the other end is a CDN somebody else operates; **no wall-clock
 * threshold is asserted and one must not be added**, for the reason
 * `game.browser.spec.ts` gives about a flaky gate becoming a deleted one.
 */
const HOSTED_DEADLINE_MS = 20_000;

/** The coverage the archive declares in its own header. */
async function archiveBounds(archiveUrl: string): Promise<ArchiveBounds> {
  const header = await new PMTiles(archiveUrl).getHeader();
  return requireCoverage({
    west: header.minLon,
    south: header.minLat,
    east: header.maxLon,
    north: header.maxLat,
  });
}

/** Archive responses, with the CDN's own verdict on each. */
function watchArchiveResponses(
  page: import('@playwright/test').Page,
  archiveUrl: string,
): ArchiveResponseFact[] {
  const facts: ArchiveResponseFact[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(archiveUrl)) {
      facts.push({ status: response.status(), cacheStatus: response.headers()['cf-cache-status'] });
    }
  });
  return facts;
}

/**
 * **A ride outside the archive's coverage — #534.**
 *
 * The archive every build now draws by default covers the contiguous United
 * States, and a rider anywhere else opens a ride over it. #534 asks that this
 * *"fails quietly: no error loop and no stuck spinner"*, and to record what the
 * rider sees. The harness's default track is in London; the bounded fixture
 * declares the published archive's box.
 *
 * ⚠️ **The fixture holds every tile everywhere**, so a tile colour on this page
 * would mean MapLibre ignored the header's bounds and fetched London anyway.
 * `paints the archive’s own tiles` above is this case's positive control: the
 * same page, the same track and the same tiles, with world bounds, paints.
 *
 * What a rider sees, recorded: the style's background colour, their own line,
 * and the OpenStreetMap credit beneath (`map.a11y.test.tsx`) — no tiles, no
 * message, no loading state, because the panel has none to get stuck in.
 */
test.describe('a ride outside the archive’s coverage — #534', () => {
  test('draws the line on a plain background, reads the header once, and raises nothing', async ({
    page,
  }) => {
    const seen = watch(page);
    const problems: string[] = [];
    page.on('pageerror', (error) => {
      problems.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      // MapLibre reports an unhandled map `error` event through console.error,
      // so an error loop is visible here even though no listener is attached.
      if (message.type() === 'error') {
        problems.push(`console.error: ${message.text()}`);
      }
    });
    await page.goto(
      `/?archive=${encodeURIComponent(BOUNDED_FIXTURE_URL)}&paintDeadline=${String(CONTROL_DEADLINE_MS)}`,
    );
    const load = await mapLoad(page);

    // The map rendered real frames, and what was on them was the background.
    expect(load.frames).toBeGreaterThan(0);
    expect(load.samples).toContain(load.backgroundColour);
    // …and the rider's own line, which this title promises. Until #535's review
    // nothing here looked, and the line was being dropped with tiles ON too.
    expect(load.trackPainted, 'the ride’s line was not drawn with tiles on').toBe(true);
    expect(
      load.painted,
      `a tile colour reached the screen outside the archive's declared bounds: ${load.samples.join(', ')}`,
    ).toBe(false);

    // One read of the header and root directory, then nothing: a request per
    // tile would be MapLibre asking outside the bounds, and a count still
    // rising after the paint deadline would be a retry loop.
    //
    // ⚠️ No extra sleep, and there used to be a fixed second here. `mapLoad`
    // resolves only at the page's own paint deadline — nothing paints outside
    // the bounds — so this count is already taken `CONTROL_DEADLINE_MS` after
    // the map was created. That window is a BOUND, not a proof: a retry later
    // than it would not be seen. #535's review measured MapLibre 6.10.0 making
    // no retry over ten seconds even for a 404, and #756 measured 6.11.2 the
    // same, which is what makes three
    // seconds a reasonable bound rather than a hopeful one.
    const archiveReads = (): number =>
      seen.requests.filter((url) => url.startsWith(BOUNDED_FIXTURE_URL)).length;
    expect(archiveReads(), 'the archive was asked for more than once in the window').toBe(1);

    expect(seen.failures).toEqual([]);
    expect(problems).toEqual([]);
  });
});

/**
 * **With map tiles turned off — the owner's decision of 2026-09-25.**
 *
 * A Settings switch, on by default (`map/tiles-preference.ts`). Off, the
 * shipped style names no source at all, and the claim is that the tile host
 * is then contacted by **nothing** — asserted here from the network, the same
 * interception #63's criterion 3 uses, because a style with no URL in it says
 * what is declared and only a real engine says what is requested.
 *
 * The page is pointed at the fixture archive the positive case above paints
 * from, so that case is this one's control: the same URL, tiles on, is asked
 * for and paints. A `?tiles=off` the style ignored would be asked for here too.
 */
test.describe('with map tiles turned off — the owner’s choice of 2026-09-25', () => {
  test('asks the archive for nothing, and still draws the ride’s line on the background', async ({
    page,
  }) => {
    const seen = watch(page);
    await page.goto(
      `/?archive=${encodeURIComponent(FIXTURE_URL)}&tiles=off&paintDeadline=${String(CONTROL_DEADLINE_MS)}`,
    );
    // Published at the paint deadline, because no tile can paint: every
    // request below is counted over that whole window.
    const load = await mapLoad(page);

    expect(load.frames).toBeGreaterThan(0);
    expect(load.samples).toContain(load.backgroundColour);
    expect(
      load.trackPainted,
      `the ride's line was not at the frame's centre: read ${load.centreColours.join(', ')}`,
    ).toBe(true);

    expect(seen.requests.filter((url) => url.startsWith(FIXTURE_URL))).toEqual([]);
    expect(load.archiveRequests).toEqual([]);
    // #578: nothing to label, so no glyph range and no label ink. This is also
    // what says the label probe can report "nothing" at all.
    const labels = await labelLoad(page);
    expect(labels.glyphs).toBeUndefined();
    expect(labels.glyphRequests).toEqual([]);
    expect(labels.painted, `${String(labels.inkPixels)} ink pixels with no tiles`).toBe(false);
    const foreign = seen.requests.filter(
      (url) =>
        !url.startsWith('blob:') &&
        !url.startsWith('data:') &&
        new URL(url).origin !== HARNESS_ORIGIN,
    );
    expect(foreign, `requests left the page's origin: ${foreign.join(', ')}`).toEqual([]);
  });
});

/** What the drawing buffer shows now, and what the map's style paints with (#672). */
async function probeNow(page: import('@playwright/test').Page): Promise<MapProbe> {
  const probe = await page.evaluate(() => window.__oylMapProbe?.());
  if (probe === undefined) {
    throw new Error('the harness published no map probe');
  }
  return probe;
}

/**
 * #672 part b: the map in the dark palette, and following the page.
 *
 * The page's palette comes from the device through the theme script
 * `tools/theme/theme-selection-plugin.ts` writes into every harness page, so
 * `emulateMedia({ colorScheme })` is the device, and the map is built through
 * `map/themed-map.ts`, the function `MapPanel.tsx` uses.
 *
 * ⚠️ **A background read proves little on its own**, and the control is what
 * makes this one mean something: the SAME page, under the SAME dark device,
 * handed the light style (`?style=light`), must fail it. A probe reading a
 * cleared buffer, or a style the builder quietly ignored the palette of, is
 * what that control would otherwise not rule out.
 */
/**
 * How long the two background reads below wait before the page publishes.
 *
 * Shorter than {@link CONTROL_DEADLINE_MS} because neither is a negative
 * assertion about tiles: each requires a colour to BE on the buffer, and the
 * background paints on the first frame after the style loads (under 300 ms
 * here). Too short a box turns these red, never green.
 */
const THEME_READ_DEADLINE_MS = 1500;

test.describe('the dark map — #672', () => {
  test('paints the dark background under a dark page, with no archive to paint over it', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/?tiles=off&paintDeadline=${String(THEME_READ_DEADLINE_MS)}`);
    const load = await mapLoad(page);

    expect(load.theme).toBe('dark');
    expect(load.backgroundColour).toBe(MAP_COLOURS.dark.background);
    expect(load.frames).toBeGreaterThan(0);
    expect(
      load.samples,
      `the dark background did not reach the drawing buffer: read ${load.samples.join(', ')}`,
    ).toContain(MAP_COLOURS.dark.background);
    expect(load.samples).not.toContain(MAP_COLOURS.light.background);
    // The ride's line, in the dark palette's colour, on top of it.
    expect(load.trackPainted, `centre read ${load.centreColours.join(', ')}`).toBe(true);
  });

  test('fails that read with the light style under the same dark page — the control', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/?tiles=off&style=light&paintDeadline=${String(THEME_READ_DEADLINE_MS)}`);
    const load = await mapLoad(page);

    // The page IS dark; only the style is not.
    expect((await probeNow(page)).pageTheme).toBe('dark');
    expect(load.theme).toBe('light');
    expect(load.frames).toBeGreaterThan(0);
    expect(load.samples).toContain(MAP_COLOURS.light.background);
    expect(load.samples).not.toContain(MAP_COLOURS.dark.background);
  });

  test('follows the device from dark to light without a reload, keeping its tiles and its line', async ({
    page,
  }) => {
    const seen = watch(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/?archive=${encodeURIComponent(FIXTURE_URL)}`);
    const load = await mapLoad(page);
    expect(load.theme).toBe('dark');
    expect(load.painted, `read ${load.samples.join(', ')}`).toBe(true);
    // Tiles painted in the DARK palette's own colours.
    const darkTiles = [MAP_COLOURS.dark.earth, MAP_COLOURS.dark.water, MAP_COLOURS.dark.road];
    expect(load.samples.some((sample) => darkTiles.includes(sample))).toBe(true);
    const navigations = seen.requests.filter((url) => new URL(url).pathname === '/').length;
    // "Keeping its tiles": a paint-only diff keeps the vector source, so the
    // flip fetches nothing from the archive. A map rebuilt to change colour
    // (`setStyle(…, { diff: false })`) asks for it again — measured 3 → 5.
    const fromTheArchive = (): number =>
      seen.requests.filter((url) => url.startsWith(FIXTURE_URL)).length;
    const archiveBefore = fromTheArchive();
    expect(archiveBefore).toBeGreaterThan(0);

    // The device turns light. Nothing else is touched: the inline script
    // hears it, sets `data-theme`, and the map's one watch repaints it.
    await page.emulateMedia({ colorScheme: 'light' });
    const lightTiles = [MAP_COLOURS.light.earth, MAP_COLOURS.light.water, MAP_COLOURS.light.road];
    await expect
      .poll(async () => {
        const now = await probeNow(page);
        return (
          now.pageTheme === 'light' &&
          now.styleTheme === 'light' &&
          now.samples.some((sample) => lightTiles.includes(sample)) &&
          !now.samples.some((sample) => darkTiles.includes(sample)) &&
          now.centreColours.includes(MAP_COLOURS.light.track)
        );
      })
      .toBe(true);

    const after = await probeNow(page);
    // The same page, not a reloaded one, and the protocol registered once.
    expect(seen.requests.filter((url) => new URL(url).pathname === '/').length).toBe(navigations);
    expect(after.registrations).toBe(1);
    expect(after.centreColours).not.toContain(MAP_COLOURS.dark.track);
    // Not one archive request across the flip.
    expect(fromTheArchive()).toBe(archiveBefore);
  });
});

/**
 * #578: place names, drawn from glyphs the app ships.
 *
 * ⚠️ **"A label painted" cannot, on its own, tell the app's glyphs from the
 * device's font — and that is a finding, not a caveat.** MapLibre 6.10 (and
 * 6.11) draws a glyph itself, with TinySDF and whatever font the browser has,
 * whenever the style has no `glyphs` URL or the URL cannot serve a range
 * (`glyph_manager.ts` §`_getAndCacheGlyphsPromise`). So a style with no glyphs
 * at all **still labels the map**, and the positive case's ink assertion would
 * be green over a regression that deleted every range file. The issue's
 * premise — that a control without `glyphs` would fail to paint — is false for
 * this engine, and both controls below measure it.
 *
 * What does distinguish the two is the network and the console: the positive
 * case requires every range the name needs to have been fetched **from the
 * page's own origin** with a 200, and MapLibre to have printed no fallback
 * warning. The two controls prove each half can fail — with no `glyphs`, no
 * range is asked for; with a `glyphs` path that is not there, every range is
 * refused and the warning is printed.
 *
 * ⚠️ **Framed at a ride's zoom, not the harness's default.** The default track
 * is 140 m long and fits at about zoom 18, where the viewport is a twentieth of
 * one overzoomed z14 tile and no fixture place is in it — the first run of this
 * block found exactly that, zero ink and zero glyph requests, because MapLibre
 * lays out no symbol whose point is off screen. {@link LABEL_TRACK} is 5 km,
 * which is a short ride, and frames at about zoom 12, where the fixture's grid
 * of places is every 128 px.
 */
const LABEL_TRACK = trackParameter(
  centreTrack({ west: -0.2, south: 51.45, east: 0, north: 51.55 }, 5000),
);

test.describe('place names, from glyphs the app ships — #578', () => {
  test('paints the fixture’s place name from the app’s own glyph ranges, and nothing else', async ({
    page,
  }) => {
    const seen = watch(page);
    const fallbacks = glyphFallbacks(page);
    await page.goto(
      `/?archive=${encodeURIComponent(FIXTURE_URL)}&track=${encodeURIComponent(LABEL_TRACK)}`,
    );
    const labels = await labelLoad(page);

    expect(
      labels.painted,
      `no label ink (${labels.ink}) reached the drawing buffer: ${String(labels.inkPixels)} pixels over ${String(labels.frames)} frames`,
    ).toBe(true);
    expect(labels.glyphs).toBe('./glyphs/{fontstack}/{range}.pbf');

    // Every range Kāneʻohe needs — three of them — from the page's own origin.
    const fetched = labels.glyphRequests.map((request) => new URL(request.url));
    const ranges = fetched
      .filter((url) => url.pathname.startsWith('/glyphs/Roboto-Regular/'))
      .map((url) => url.pathname.replace('/glyphs/Roboto-Regular/', '').replace('.pbf', ''));
    for (const range of PLACE_NAME_RANGES) {
      expect(ranges, `range ${range} was not fetched from the app`).toContain(range);
    }
    for (const request of labels.glyphRequests) {
      expect(new URL(request.url).origin, request.url).toBe(HARNESS_ORIGIN);
      expect(request.status, request.url).toBe(200);
    }
    // And MapLibre drew none of it from the device's font.
    expect(fallbacks, fallbacks.join('\n')).toEqual([]);

    const foreign = seen.requests.filter(
      (url) =>
        !url.startsWith('blob:') &&
        !url.startsWith('data:') &&
        new URL(url).origin !== HARNESS_ORIGIN,
    );
    expect(foreign, `requests left the page's origin: ${foreign.join(', ')}`).toEqual([]);
  });

  test('asks for no glyph range at all when the style names none — the first control', async ({
    page,
  }) => {
    const fallbacks = glyphFallbacks(page);
    await page.goto(
      `/?archive=${encodeURIComponent(FIXTURE_URL)}&track=${encodeURIComponent(LABEL_TRACK)}&glyphs=off&paintDeadline=${String(CONTROL_DEADLINE_MS)}`,
    );
    const labels = await labelLoad(page);

    expect(labels.glyphs).toBeUndefined();
    expect(labels.glyphRequests).toEqual([]);
    // No URL, so no range to miss and no warning — MapLibre goes straight to
    // the device's font.
    expect(fallbacks).toEqual([]);
    // ⚠️ And it STILL paints: the finding in this block's header, measured.
    // Were this ever false, the positive case's ink would be evidence of the
    // app's glyphs on its own; while it is true, the requests are.
    expect(labels.painted, `${String(labels.inkPixels)} ink pixels`).toBe(true);
  });

  test('warns and falls back when the glyphs are not there — the second control', async ({
    page,
  }) => {
    const fallbacks = glyphFallbacks(page);
    await page.goto(
      `/?archive=${encodeURIComponent(FIXTURE_URL)}&track=${encodeURIComponent(LABEL_TRACK)}&glyphs=${encodeURIComponent('./missing-glyphs/{fontstack}/{range}.pbf')}&paintDeadline=${String(CONTROL_DEADLINE_MS)}`,
    );
    const labels = await labelLoad(page);

    // Asked for, from our own origin, and refused.
    expect(labels.glyphRequests.length).toBeGreaterThan(0);
    for (const request of labels.glyphRequests) {
      expect(request.url).toContain('/missing-glyphs/');
      expect(request.status, request.url).toBe(404);
    }
    // The warning the positive case requires to be absent, present.
    expect(fallbacks.length).toBeGreaterThan(0);
  });
});

test.describe('a hosted archive, rendered and timed over the internet', () => {
  test.skip(
    hosted === undefined,
    `set ${HOSTED_ARCHIVE_VARIABLE} to an https: PMTiles archive to run this block; ` +
      'CI sets nothing on purpose — see hosted-archive.ts',
  );

  // Empty until `beforeAll` runs, which only happens when the block is not
  // skipped. Read through {@link requireArchive} so a mistake here is an error
  // naming the cause rather than a request for `undefined`.
  let archiveUrl = '';
  let track = '';

  function requireArchive(): string {
    if (archiveUrl === '') {
      throw new Error('the hosted archive was not read; this block should have been skipped');
    }
    return archiveUrl;
  }

  test.beforeAll(async () => {
    archiveUrl = hosted?.archiveUrl ?? '';
    // ⚠️ Read over the network **before** any browser is involved, and that
    // ordering is the useful half: if the archive is unreachable or its header
    // is not a PMTiles header, this fails here, naming the archive — rather
    // than as a blank map twenty seconds later, where the cause could equally
    // be the engine, the protocol handler, the style or the machine.
    const bounds = await archiveBounds(requireArchive());
    track = trackParameter(centreTrack(bounds, HOSTED_TRACK_METRES));
  });

  test('paints the hosted basemap under the ride trace — criterion 1, and 7', async ({ page }) => {
    const seen = watch(page);
    await page.goto(
      `/?archive=${encodeURIComponent(requireArchive())}&track=${encodeURIComponent(track)}` +
        `&paintDeadline=${String(HOSTED_DEADLINE_MS)}`,
    );
    const load = await mapLoad(page);

    expect(
      load.painted,
      `no basemap colour reached the drawing buffer. Looked for ${load.basemapColours.join(', ')}; ` +
        `read ${load.samples.join(', ')} over ${String(load.frames)} frames`,
    ).toBe(true);
    expect(load.frames).toBeGreaterThan(0);
    // The colours are the style's own, so this is our cartography drawn from
    // somebody else's geometry rather than anything that merely differs from the
    // background.
    expect(
      load.samples.filter((sample) => load.basemapColours.includes(sample)).length,
    ).toBeGreaterThan(0);
    // It came over the wire from the configured archive.
    expect(load.archiveRequests.length).toBeGreaterThan(0);
    expect(seen.requests.filter((url) => url.startsWith(requireArchive())).length).toBeGreaterThan(
      0,
    );
    // @see HOSTED_DEADLINE_MS — the box the control below rests on.
    expect(load.firstPaintMs ?? Number.POSITIVE_INFINITY).toBeLessThan(HOSTED_DEADLINE_MS / 2);
  });

  test('contacts the page and the archive, and nothing else — criterion 3', async ({ page }) => {
    // ⚠️ **The strongest form of criterion 3 available anywhere in this
    // repository**, and the first time it has been executed against a host that
    // is not the loopback interface. Everything above asserts "one origin, and
    // it is ours"; a render that never leaves the machine cannot distinguish
    // "contacts nothing else" from "cannot reach anything". Here the engine has
    // a real CDN to talk to, and the assertion is that it talks to that one and
    // to no other — no telemetry, no font fallback, no tile API arriving in a
    // dependency default, which is the sentence the criterion is written around.
    const seen = watch(page);
    await page.goto(
      `/?archive=${encodeURIComponent(requireArchive())}&track=${encodeURIComponent(track)}` +
        `&paintDeadline=${String(HOSTED_DEADLINE_MS)}`,
    );
    await mapLoad(page);

    expect(seen.requests.length).toBeGreaterThan(0);
    const permitted = permittedOrigins(HARNESS_ORIGIN, {
      archiveUrl: requireArchive(),
      origin: new URL(requireArchive()).origin,
    });
    const foreign = foreignRequests(seen.requests, permitted);
    expect(foreign, `requests left the permitted origins: ${foreign.join(', ')}`).toEqual([]);
  });

  test('paints no tile colour when the hosted object is not there — the control', async ({
    page,
  }) => {
    // The half that makes the two above mean something. Same host, same
    // protocol handler, same style, same track — and an object key the bucket
    // does not hold. If this painted, the probe would be reading something that
    // is not a tile, and every green above would be worth nothing.
    const missing = new URL('/oyl-no-such-archive.pmtiles', requireArchive()).toString();
    await page.goto(
      `/?archive=${encodeURIComponent(missing)}&track=${encodeURIComponent(track)}` +
        `&paintDeadline=${String(HOSTED_DEADLINE_MS / 4)}`,
    );
    const load = await mapLoad(page);

    expect(load.painted).toBe(false);
    expect(load.firstPaintMs).toBeUndefined();
    // The probe did run, and what it read was the style's own background —
    // without which "no tile colour" is satisfied by a blank canvas.
    expect(load.frames).toBeGreaterThan(0);
    expect(load.samples).toContain(load.backgroundColour);
  });

  test('records what a cold load costs against the hosted archive — criterion 8', async ({
    page,
  }, testInfo) => {
    // A fresh Playwright context per test is an empty **browser** cache, which
    // is what "cold" can mean from here. The CDN's own edge cache is not ours to
    // clear, so it is *reported* rather than assumed: `cf-cache-status` for
    // every archive response goes into the line below, and a run that was served
    // entirely from a warm edge is visible as such instead of being quoted as a
    // cold number.
    const responses = watchArchiveResponses(page, requireArchive());
    await page.goto(
      `/?archive=${encodeURIComponent(requireArchive())}&track=${encodeURIComponent(track)}` +
        `&paintDeadline=${String(HOSTED_DEADLINE_MS)}`,
    );
    const load = await mapLoad(page);

    expect(load.painted).toBe(true);
    const clientMs = load.firstPaintMs ?? Number.NaN;
    const pageMs = load.firstPaintSinceNavigationMs ?? Number.NaN;
    expect(Number.isFinite(clientMs)).toBe(true);
    expect(clientMs).toBeGreaterThan(0);
    // Sanity bounds, not a budget: the page cannot have painted before it began
    // loading, and the client's share cannot exceed the whole.
    expect(pageMs).toBeGreaterThanOrEqual(clientMs);
    // Every archive response is a range request that succeeded. A 200 here would
    // mean the whole 19 GB object was being asked for, which is the failure mode
    // that makes PMTiles-on-object-storage untenable and is worth catching
    // rather than timing.
    for (const response of responses) {
      expect(response.status).toBe(206);
    }
    // ⚠️ **The other half of the pair, and a tripwire rather than a fact about
    // us.** The archive's host sends no `Timing-Allow-Origin` — checked, not
    // assumed — so the browser withholds every per-request phase and byte count
    // for these. If this ever goes red, the host has started sending one: the
    // per-request figures below became real, and the note on
    // `ArchiveRequestTiming.transferredBytes` needs rewriting rather than this
    // assertion relaxing.
    expect(
      load.archiveRequests.map((request) => request.timingOpaque),
      'the archive host now sends Timing-Allow-Origin — see ArchiveRequestTiming',
    ).not.toContain(false);

    const measured = coldLoadReport({
      archiveUrl: requireArchive(),
      firstPaintMs: clientMs,
      firstPaintSinceNavigationMs: pageMs,
      requestCount: load.archiveRequests.length,
      wireMs: load.archiveRequests.reduce((total, request) => total + request.durationMs, 0),
      timingOpaque: load.archiveRequests.some((request) => request.timingOpaque),
      frames: load.frames,
      responses,
    });
    testInfo.annotations.push({
      type: 'cold load — time to first painted tile, hosted',
      description: measured,
    });
    // Printed as well as annotated, for the reason the fixture block gives: an
    // annotation reaches the JSON and HTML reports and not the log, and the log
    // is the only artefact anybody reads on a green run. Criterion 8 says
    // "recorded in the PR", and a number nobody can see is not recorded.
    console.log(measured);
  });
});
