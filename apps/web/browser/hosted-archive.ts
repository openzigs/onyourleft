// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hosted archive the browser gate can be pointed at, and what follows.
 *
 * ## What is left of #63, and why this is the shape of it
 *
 * #63's eighth acceptance criterion is *"Cold-load behaviour is measured and
 * recorded in the PR: time to first painted tile on a cold cache"*, and its
 * last sentence points straight at hosting: *"Protomaps' own deployment docs
 * warn that R2 latency is '500 ms or higher'; if the chosen host is R2 this is
 * where it becomes visible."* Every previous attempt at that number was taken
 * against something on the loopback interface, which removes the term being
 * asked about by construction — `pmtiles-fixture.ts` says so at length and is
 * right to.
 *
 * #53 has now published one: a continental-US extract of a pinned Protomaps
 * daily build, on object storage behind a CDN, with no tile server in the path.
 * So the measurement is takeable, and this module is what the gate needs in
 * order to take it.
 *
 * ## ⚠️ It is opt-in, and that is a deliberate trade with a cost
 *
 * `OYL_HOSTED_BASEMAP_URL` unset means the hosted block is **skipped**, and CI
 * sets nothing. That is chosen rather than defaulted into, for the reason
 * `scripts/check-doc-links.sh` refuses to resolve an `https:` target: a gate
 * that needs the network is a gate that fails on an aeroplane, in a container
 * behind an egress proxy, and on the morning somebody else's CDN has a bad
 * hour. CLAUDE.md §4a's bare-clone posture is the same posture.
 *
 * **The cost is the shape this repository distrusts most**: a block that is
 * skipped by default is a block that can rot without anybody noticing, and a
 * skipped test reads green. Three things are done about it rather than none:
 *
 * 1. Everything in here that can be decided without a network is decided here,
 *    as pure functions with their own Vitest suite, which `pnpm run test` runs
 *    on every save. The part that genuinely needs a host is the part that is
 *    skipped, and it is small.
 * 2. A **malformed** value throws rather than skipping. "Nothing configured" and
 *    "configured wrongly" are different states and only the first is a reason to
 *    measure nothing; a typo'd host that quietly skipped would be a run somebody
 *    believed they had taken.
 * 3. The measurement is written down with a date, in `docs/spikes/`, because a
 *    number nobody re-runs ages — and a spike write-up is CLAUDE.md's own name
 *    for a dated measurement that decides nothing.
 */

import type { MapPosition, TrackGeometry } from '../src/map/track';

/**
 * The environment name that turns the hosted block on.
 *
 * ⚠️ Deliberately **not** `VITE_BASEMAP_PMTILES_URL`, and this is the decision
 * in this file most likely to be read as duplication. That variable is the
 * product's configuration: anybody who has a basemap configured for their own
 * development build has it set, and reusing it here would silently put a
 * network dependency into `pnpm run test:browser` for exactly those people —
 * without them choosing it, and with the failure arriving as a timeout in a
 * gate they did not think they had changed. Turning the hosted block on is an
 * explicit act with its own name.
 *
 * Rule `ENV001` (`scripts/check-env-example.sh`) requires it in `.env.example`
 * either way, so it is documented configuration rather than folklore. As in
 * `src/map/basemap.ts`, this constant is documentation and **not** the read:
 * the checker greps for a literal `process.env.<NAME>`, so the caller spells the
 * name out and the two are kept in step by the checker rather than by care.
 */
export const HOSTED_ARCHIVE_VARIABLE = 'OYL_HOSTED_BASEMAP_URL';

/** What {@link readHostedArchive} reads. A parameter, so a test needs no process. */
export interface HostedArchiveEnvironment {
  readonly OYL_HOSTED_BASEMAP_URL?: string | undefined;
}

/** A hosted PMTiles archive, and the one origin it is permitted to be on. */
export interface HostedArchive {
  /** The archive, as an ordinary `https:` URL — no `pmtiles://` selector. */
  readonly archiveUrl: string;
  /** Its origin, which is what every request during the render is checked against. */
  readonly origin: string;
}

/**
 * The hosted archive to measure against, or `undefined` for "do not measure".
 *
 * ⚠️ **Three inputs, three outcomes, and the middle one is the point.** Unset,
 * empty or whitespace is `undefined`: nothing is configured, so nothing is
 * measured, which is the ordinary state on a bare clone and in CI. Anything
 * that is set but is not an `https:` URL **throws**, because a value somebody
 * typed is a value somebody intends, and skipping it would report a measurement
 * that never happened as a clean run.
 *
 * `https:` and not `http:` for the reason `readBasemapConfig` refuses the same
 * thing: a plain-HTTP archive is blocked as mixed content on any real
 * deployment, so a number measured against one would describe a configuration
 * that cannot ship.
 */
export function readHostedArchive(
  environment: HostedArchiveEnvironment,
): HostedArchive | undefined {
  const raw = environment.OYL_HOSTED_BASEMAP_URL?.trim() ?? '';
  if (raw === '') {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${HOSTED_ARCHIVE_VARIABLE} is set but is not a URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${HOSTED_ARCHIVE_VARIABLE} is set but is not an https: URL`);
  }
  return { archiveUrl: parsed.toString(), origin: parsed.origin };
}

/**
 * Every origin the hosted render is allowed to touch.
 *
 * Two, and exactly two: the page itself, and the archive. Written as a function
 * of both rather than as a literal so that the archive's origin arrives from the
 * configuration the run actually used — a hard-coded `tiles.openzigs.com` here
 * would make #63's third criterion true of one bucket rather than of whatever
 * is configured, which is the thing its seventh criterion forbids.
 */
export function permittedOrigins(harnessOrigin: string, hosted: HostedArchive): readonly string[] {
  return [...new Set([harnessOrigin, hosted.origin])];
}

/**
 * The requests that left the permitted set.
 *
 * `blob:` and `data:` are excluded because they never leave the page — a worker
 * built from a blob is not a host. Anything this cannot parse as a URL is
 * **reported** rather than skipped: an unparseable request URL is not evidence
 * of good behaviour, and swallowing it is how this check would go quiet.
 */
export function foreignRequests(
  urls: readonly string[],
  permitted: readonly string[],
): readonly string[] {
  return urls.filter((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      return false;
    }
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return true;
    }
    return !permitted.includes(origin);
  });
}

/** The corner coordinates an archive declares in its own header. */
export interface ArchiveBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * The same bounds, having been checked to describe somewhere.
 *
 * ⚠️ **A PMTiles header may declare an empty box**, and an empty box centres the
 * ride at 0°, 0° — the Gulf of Guinea, where almost every archive holds no tile.
 * The gate would then report *"the hosted basemap did not paint"*, which is true
 * and blames the wrong thing entirely: the engine, the protocol handler, the
 * style and the machine are all equally consistent with it. Refused here, by
 * name, so the failure says what is actually wrong.
 *
 * Separate from {@link centreTrack} because a degenerate box is a fact about the
 * **archive**, where `centreTrack`'s own refusals are about its arguments — and
 * a one-tile archive with a legitimately thin box is a thing that could exist
 * and should still get a ride.
 */
export function requireCoverage(bounds: ArchiveBounds): ArchiveBounds {
  if (bounds.west === bounds.east && bounds.south === bounds.north) {
    throw new Error('the archive header declares no coverage to place a ride inside');
  }
  return bounds;
}

/**
 * How long the synthetic ride laid over the hosted basemap is, in metres.
 *
 * Long enough that fitting the camera to it lands in the zoom band a basemap
 * archive actually stores — a hundred-metre line fits at a zoom far past the
 * archive's maximum, where MapLibre overzooms one tile and the number measured
 * is the cost of fetching one tile rather than of drawing a view. Short enough
 * that the view is a handful of tiles rather than a continent.
 */
export const HOSTED_TRACK_METRES = 1200;

/** Metres per degree of latitude. The equatorial figure; see {@link centreTrack}. */
const METRES_PER_DEGREE = 111_320;

/**
 * A short east–west ride at the centre of whatever the archive covers.
 *
 * ⚠️ **Derived from the archive's own header, never written down**, and that is
 * the whole reason this function exists rather than a constant pair of
 * coordinates. The archive #53 published is a **continental-US extract**, so the
 * London track the rest of the harness uses lies outside it: pointed there, the
 * engine asks for tiles the archive does not hold, nothing paints, and the gate
 * reports "no basemap reached the screen" about an archive that is working
 * perfectly. A hard-coded Denver would fix that for one archive and reintroduce
 * it for the next — and #63's seventh criterion is precisely that the archive is
 * configuration.
 *
 * The centre is used rather than a corner because a bounding box's corner is
 * routinely outside the data (the corners of that extract are in the Pacific and
 * in Canada), where the centre of a coverage box is by construction inside it.
 *
 * The longitude span is widened by `1 / cos(latitude)` because a degree of
 * longitude shortens toward the poles. That correction matters here only to the
 * extent that it keeps the line near its intended length, which is what keeps the
 * fitted zoom in the band described above; nothing downstream is a distance.
 */
export function centreTrack(bounds: ArchiveBounds, metres: number): TrackGeometry {
  // The field and the constraint, never the value — ADR 0004 decision D, which
  // binds every layer that formats a coordinate into a string.
  if (!(bounds.west <= bounds.east)) {
    throw new Error('archive bounds: west must not be east of east');
  }
  if (!(bounds.south <= bounds.north)) {
    throw new Error('archive bounds: south must not be north of north');
  }
  if (!(metres > 0)) {
    throw new Error('track length must be a positive number of metres');
  }
  const latitude = (bounds.south + bounds.north) / 2;
  const longitude = (bounds.west + bounds.east) / 2;
  const shrink = Math.cos((latitude * Math.PI) / 180);
  // A pole-adjacent archive would divide by nearly nothing. Clamped rather than
  // refused: the resulting line is shorter than asked for, which costs a zoom
  // level, where a thrown error would cost the measurement entirely.
  const degrees = metres / (METRES_PER_DEGREE * Math.max(shrink, 0.01));
  const half = degrees / 2;
  return {
    type: 'MultiLineString',
    coordinates: [
      [
        [longitude - half, latitude],
        [longitude + half, latitude],
      ],
    ],
  };
}

/** Runs are separated by this; positions within a run by {@link POSITION_SEPARATOR}. */
const RUN_SEPARATOR = '|';
const POSITION_SEPARATOR = ';';

/**
 * A track, as the harness page's `?track=` parameter.
 *
 * `longitude,latitude` in GeoJSON order, the order `track.ts` warns about. The
 * round trip with {@link parseTrackParameter} is what a test asserts, so a
 * transposition here is a red test rather than a ride drawn in Kenya.
 */
export function trackParameter(track: TrackGeometry): string {
  return track.coordinates
    .map((run) =>
      run.map(([longitude, latitude]) => `${longitude},${latitude}`).join(POSITION_SEPARATOR),
    )
    .join(RUN_SEPARATOR);
}

/**
 * The inverse, as the harness page reads it.
 *
 * ⚠️ **It throws on anything it does not understand, and does not fall back.**
 * A silently ignored `?track=` is the worst available outcome for this gate: the
 * page would render the built-in London track against a United States archive,
 * paint nothing, and the hosted measurement would report a failure whose cause
 * is a typo in a query string. Refusing loudly makes that a page that does not
 * load, which is unmistakable.
 */
export function parseTrackParameter(raw: string): TrackGeometry {
  const runs = raw.split(RUN_SEPARATOR).map((run) => {
    const positions = run.split(POSITION_SEPARATOR).map((position): MapPosition => {
      const parts = position.split(',');
      if (parts.length !== 2) {
        throw new Error('track parameter: each position must be longitude,latitude');
      }
      const longitude = Number(parts[0]);
      const latitude = Number(parts[1]);
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        throw new Error('track parameter: longitude must be a finite number within ±180');
      }
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
        throw new Error('track parameter: latitude must be a finite number within ±90');
      }
      return [longitude, latitude];
    });
    if (positions.length < 2) {
      throw new Error('track parameter: each run must carry at least two positions');
    }
    return positions;
  });
  return { type: 'MultiLineString', coordinates: runs };
}

/** What one archive response told us about where it came from. */
export interface ArchiveResponseFact {
  /** HTTP status. A 206 is the range request working; a 200 is the whole object. */
  readonly status: number;
  /** The CDN's own verdict, `cf-cache-status` where there is one. */
  readonly cacheStatus: string | undefined;
}

/** Everything the report below is built from. Assembled by the spec, formatted here. */
export interface ColdLoadFacts {
  readonly archiveUrl: string;
  readonly firstPaintMs: number;
  readonly firstPaintSinceNavigationMs: number;
  readonly requestCount: number;
  readonly wireMs: number;
  /** True when the browser would not tell us the wire timings. @see timingNote */
  readonly timingOpaque: boolean;
  readonly frames: number;
  readonly responses: readonly ArchiveResponseFact[];
}

/**
 * ⚠️ Why a cross-origin number is not the same number.
 *
 * `PerformanceResourceTiming` zeroes `responseStart`, `transferSize` and every
 * intermediate phase for a cross-origin resource **unless the server sends
 * `Timing-Allow-Origin`** — and the archive's host does not send one. It was
 * checked rather than assumed: the response carries
 * `access-control-expose-headers: etag,content-range,content-length,accept-ranges`
 * and no `Timing-Allow-Origin` at all.
 *
 * That is not a defect in the host; it is the web's default. It **is** a defect
 * in reading the number naively, and the shape of it is one this repository
 * keeps finding: the loopback measurement reports `transferredBytes: 0` to mean
 * *"served from cache"*, and a cross-origin one reports exactly the same 0 to
 * mean *"you are not allowed to know"*. A reader comparing the two would
 * conclude the CDN served everything from cache. So the report says which it is,
 * and the end-to-end figure — first paint, which is measured on our own clock in
 * our own page — is the one that carries the answer.
 */
function timingNote(opaque: boolean): string {
  return opaque
    ? 'the wire timings are opaque (no Timing-Allow-Origin on a cross-origin archive), ' +
        'so the per-request figures are floors and the byte counts read as zero'
    : 'the wire timings are visible, so the per-request figures are real';
}

/** How the CDN answered, summarised — so a warm edge is never read as a cold one. */
function cacheNote(responses: readonly ArchiveResponseFact[]): string {
  if (responses.length === 0) {
    return 'no archive response was observed';
  }
  const statuses = responses.map((response) => response.cacheStatus ?? 'none');
  const counted = [...new Set(statuses)]
    .map((status) => `${status}×${String(statuses.filter((each) => each === status).length)}`)
    .join(', ');
  return `CDN cache status ${counted}`;
}

/**
 * The measurement, in one line, for the PR and for the run log.
 *
 * #63's criterion 8 says *"measured and recorded in the PR"*, so the text is
 * part of the deliverable rather than decoration — which is why it is a pure
 * function with a test rather than a template literal inside an assertion.
 */
export function coldLoadReport(facts: ColdLoadFacts): string {
  const host = new URL(facts.archiveUrl).host;
  return (
    `hosted cold load — first painted tile ${facts.firstPaintMs.toFixed(1)} ms after the map ` +
    `was created, ${facts.firstPaintSinceNavigationMs.toFixed(1)} ms after navigation started; ` +
    `${String(facts.requestCount)} archive range request(s) against ${host} costing ` +
    `${facts.wireMs.toFixed(1)} ms in total; ${String(facts.frames)} frames probed; ` +
    `${cacheNote(facts.responses)}; ${timingNote(facts.timingOpaque)}`
  );
}
