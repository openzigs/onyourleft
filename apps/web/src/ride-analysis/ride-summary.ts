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

import type { ActivityId, AthleteId } from '@onyourleft/store';

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
 * The summary body of ride `activityId`, read from `store` — or `undefined`
 * when the ride cannot be read. What `instance/sync.ts` pushes beside the ride.
 */
export function rideSummaryOf(
  store: RideInputStore,
  owner: AthleteId,
): (activityId: ActivityId) => Promise<string | undefined> {
  return async (activityId) => {
    const input = await readRideInput(store, owner, activityId, {
      templateVersion: SUMMARY_INPUT_VERSION,
      cameraConsented: false,
    });
    return input === undefined ? undefined : rideSummaryBody(input);
  };
}
