// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A ride, as passages of the rider's history** — #835, ADR 0040 D-2.
 *
 * The rider's instance indexes a summary of each synced ride so a later
 * write-up can look back at it. The instance interprets no text (D-2, *Where
 * the screen and the summary builder run*), so the DEVICE builds the summary,
 * here, from #809's input builder — the same figures a model is sent about a
 * ride, and so under the same exclusions word for word: no coordinate, no
 * absolute altitude, no calendar date or time of day, no ride, route or
 * athlete name, and no identifier (`input.test.ts` §"what never leaves"
 * holds a summary built here to them too). A route or a climb is its length,
 * gradient and climb; how long ago a ride was is said by the instance when it
 * returns a passage, and never here.
 *
 * ⚠️ **Never the pose summary** (D-2 item 1): the input is read without camera
 * consent, so the side-camera report is not even read (`read-input.ts`).
 *
 * One passage for the whole ride and one per section, each far under the
 * instance's 900 characters. Words are this project's own: no registered
 * load-metric name (CLAUDE.md §6).
 */

import type { ActivityId, AthleteId, StoredActivityRecord } from '@onyourleft/store';

import type { ChannelSummary, MetricSummary, RideAnalysisInput, SectionSummary } from './input';
import { readRideInput, type RideInputStore } from './read-input';

/** The body's own name and version, which the instance's `history/passages.ts` reads. */
export const RIDE_SUMMARY_FORMAT = 'onyourleft.ride-summary';
export const RIDE_SUMMARY_VERSION = 1;

/**
 * What the input is read as. It names the summary's own version, not a
 * template's: this is not a prompt, and the version is not sent anywhere.
 */
const SUMMARY_INPUT_VERSION = `ride-summary-${String(RIDE_SUMMARY_VERSION)}`;

function percent(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}

/** One channel, in words — or nothing when the ride never recorded it. */
function channel(name: string, unit: string, summary: ChannelSummary | undefined): string[] {
  if (summary === undefined) {
    return [];
  }
  if (summary.mean === undefined || summary.max === undefined) {
    return [`${name} was reported for only ${percent(summary.coverage)} of the time.`];
  }
  return [
    `${name} averaged ${String(summary.mean)} ${unit}, up to ${String(summary.max)} ${unit}, reported for ${percent(summary.coverage)} of the time.`,
  ];
}

function metrics(summary: MetricSummary): string[] {
  const perKilogram = summary.wattsPerKilogram;
  return [
    ...channel('Power', 'watts', summary.power),
    ...channel('Heart rate', 'beats a minute', summary.heartRate),
    ...channel('Cadence', 'revolutions a minute', summary.cadence),
    ...(perKilogram === undefined
      ? []
      : [
          `Power per kilogram averaged ${String(perKilogram.mean)}, up to ${String(perKilogram.max)}.`,
        ]),
  ];
}

const KIND_WORDS: Readonly<Record<SectionSummary['kind'], string>> = {
  climb: 'a climb',
  flat: 'a flat stretch',
  descent: 'a descent',
  lap: 'a lap',
  time: 'a stretch of time',
};

function section(each: SectionSummary, of: number): string {
  const shape = [
    `${String(each.minutes)} minutes`,
    ...(each.distanceKilometres === undefined
      ? []
      : [`${String(each.distanceKilometres)} kilometres`]),
    ...(each.meanGradientPercent === undefined
      ? []
      : [`at ${String(each.meanGradientPercent)}% average gradient`]),
    ...(each.elevationGainMetres === undefined
      ? []
      : [`climbing ${String(each.elevationGainMetres)} metres`]),
  ].join(', ');
  const laps =
    each.laps === undefined
      ? ''
      : each.laps.first === each.laps.last
        ? ` (lap ${String(each.laps.first)})`
        : ` (laps ${String(each.laps.first)} to ${String(each.laps.last)})`;
  return [
    `Section ${String(each.index)} of ${String(of)}, ${KIND_WORDS[each.kind]}${laps}: ${shape}.`,
    ...metrics(each.metrics),
  ].join(' ');
}

/** A ride's summary passages: the whole ride, then each section in the order ridden. */
export function rideSummaryPassages(input: RideAnalysisInput): readonly string[] {
  const whole = [
    `A ride of ${String(input.ride.movingMinutes)} minutes of riding over ${String(input.ride.distanceKilometres)} kilometres.`,
    ...metrics(input.whole),
    input.sections.length === 0
      ? 'It has no sections.'
      : `It is cut into ${String(input.sections.length)} ${input.sections.length === 1 ? 'section' : 'sections'}.`,
  ].join(' ');
  return [whole, ...input.sections.map((each) => section(each, input.sections.length))];
}

/** A ride's summary as the device syncs it: the body of a `ride-summary` item. */
export function rideSummaryBody(input: RideAnalysisInput): string {
  return JSON.stringify({
    format: RIDE_SUMMARY_FORMAT,
    version: RIDE_SUMMARY_VERSION,
    passages: rideSummaryPassages(input),
  });
}

/**
 * What {@link rideSummaryOf} reads beyond the input: the ride's signed
 * record, whose content hash its cache is keyed on.
 */
export interface RideSummaryStore extends RideInputStore {
  getActivityRecord(owner: AthleteId, id: ActivityId): Promise<StoredActivityRecord | undefined>;
}

/**
 * The most summaries one binding of {@link rideSummaryOf} keeps: **2 000**, a
 * few kilobytes each. The oldest is dropped past it. Chosen.
 */
export const SUMMARY_CACHE_ENTRIES = 2_000;

/**
 * What a summary is built from, as a key — or `undefined` when the ride has
 * no signed record, whose content hash is what says its file has not changed.
 *
 * The ride's content hash (its streams, laps and figures, as the record
 * vouches for them), and the three things read beside it that a summary can
 * change with: the athlete's mass (power per kilogram), their threshold, and
 * the saved route's profile, by its id and when it was last edited.
 */
async function summaryKey(
  store: RideSummaryStore,
  owner: AthleteId,
  activityId: ActivityId,
): Promise<string | undefined> {
  try {
    const [signed, ride, athlete] = await Promise.all([
      store.getActivityRecord(owner, activityId),
      store.getActivity(owner, activityId),
      store.getAthlete(owner),
    ]);
    if (signed === undefined || ride === undefined) return undefined;
    const route =
      ride.routeId === undefined ? undefined : await store.getRoute(owner, ride.routeId);
    return JSON.stringify([
      activityId,
      signed.record.contentHash,
      athlete?.mass ?? null,
      athlete?.thresholdPower ?? null,
      ride.routeId ?? null,
      route?.updatedAt ?? null,
    ]);
  } catch {
    return undefined;
  }
}

/**
 * The summary body of ride `activityId`, read from `store` — or `undefined`
 * when the ride cannot be read. What `instance/sync.ts` pushes beside the ride.
 *
 * ⚠️ **Cached by the ride's content hash** (#918 item 4), for as long as this
 * binding lives: a sync asks for every signed ride's summary, and building
 * one reads and decodes the ride's whole stream set. A ride whose file,
 * athlete mass, threshold and route are unchanged is not read again
 * ({@link summaryKey}); a ride with no signed record is read every time.
 */
export function rideSummaryOf(
  store: RideSummaryStore,
  owner: AthleteId,
): (activityId: ActivityId) => Promise<string | undefined> {
  const cache = new Map<string, string>();
  return async (activityId) => {
    const key = await summaryKey(store, owner, activityId);
    const kept = key === undefined ? undefined : cache.get(key);
    if (kept !== undefined) return kept;
    const input = await readRideInput(store, owner, activityId, {
      templateVersion: SUMMARY_INPUT_VERSION,
      cameraConsented: false,
    });
    if (input === undefined) return undefined;
    const body = rideSummaryBody(input);
    if (key !== undefined) {
      cache.set(key, body);
      const oldest = cache.keys().next();
      if (cache.size > SUMMARY_CACHE_ENTRIES && oldest.done !== true) cache.delete(oldest.value);
    }
    return body;
  };
}
