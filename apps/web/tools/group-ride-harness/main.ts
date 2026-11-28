// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The AI group ride's harness** — #3309, epic #3296, ADR 0101: scripted
 * riders ridden with the group over fixture courses and scored, so the feel
 * parameters (pull length, ease share, bands, rate limits) are tuned on
 * numbers before the owner's ride.
 *
 * Run by hand from `apps/web`, **before any change to the group ride's rules
 * and again before the owner's tablet ride** (`docs/agents/game.md`):
 *
 *     pnpm run group-ride:harness
 *     pnpm run group-ride:harness -- --rider steady,weak --course hilly
 *     pnpm run group-ride:harness -- --results <directory>
 *
 * - Every scripted rider of `riders.ts` rides every course of `courses.ts`
 *   through the shipped session (`ride.ts`), on the harness's one seed.
 *   `--rider` and `--course` ride only those named; the marks of the rides
 *   left out are not asked.
 * - It prints a score table, numbers only, then each pass mark of
 *   `marks.ts` with its score and **its reason beside it**, and writes the
 *   results, numbers and seeds only (`results.ts`), under the tool's
 *   `results/`, or under `--results <directory>`.
 * - It **exits 1 below a pass mark**, 0 at or above every one, and 2 for a
 *   command it cannot read.
 *
 * It needs no model and no network, so it is deterministic: two runs write
 * the same bytes. The marks are held in `pnpm run test` too, by
 * `marks.*.test.ts`, which ride the same rides.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { GROUP_RIDE_CODE_VERSION } from '@onyourleft/domain';

import { HARNESS_COURSES, type HarnessCourse } from './courses';
import { markRide, PASS_MARKS, type MarkResult } from './marks';
import { resultFileName, resultFileText, type HarnessResult, type RideResult } from './results';
import {
  HARNESS_SEED,
  HARNESS_TARGET_KMH,
  rideScripted,
  type RideAsked,
  type RideRecord,
} from './ride';
import { SCRIPTED_RIDERS, type ScriptedRider } from './riders';
import { scoreRide, type RideScore } from './score';

/** Where results are written unless `--results` names a directory. */
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), 'results');

const USAGE =
  'usage: run.mjs [--rider <name>[,<name>]] [--course <name>[,<name>]] [--results <directory>]\n';

/** What a caller may set for a run: where lines are printed, how a ride is ridden, and how a file is written. */
export interface HarnessOptions {
  readonly print?: (line: string) => void;
  readonly ride?: (asked: RideAsked) => RideRecord;
  readonly write?: (file: string, text: string) => Promise<void>;
}

/** The score table's columns: a heading and the score it reads. */
const COLUMNS: readonly (readonly [string, (score: RideScore) => number | boolean | null])[] = [
  ['cohesion', (s) => s.cohesion],
  ['rotations', (s) => s.rotations],
  ['pulls', (s) => s.riderPulls],
  ['longest-pull-s', (s) => s.riderLongestPullSeconds],
  ['presses', (s) => s.presses],
  ['cues-min', (s) => s.cuesPerMinute],
  ['corrections', (s) => s.correctionsAll],
  ['surging', (s) => s.corrections.surging],
  ['close-gap', (s) => s.corrections['close-gap']],
  ['past-front-min', (s) => s.pastFrontPerMinute],
  ['beyond-reach-s', (s) => s.beyondReachSeconds],
  ['avg-kmh', (s) => s.groupAverageKmh],
  ['avg-off-pct', (s) => s.averageOffPercent],
  ['finish-behind-m', (s) => s.finishBehindM],
  ['rejoins', (s) => s.rejoins],
  ['rejoin-behind-m', (s) => s.afterRejoinMostBehindM],
  ['rejoin-gapped-s', (s) => s.afterRejoinGappedSeconds],
  ['crawl-s', (s) => s.crawlSeconds],
  ['crawl-cohesion', (s) => s.crawlCohesion],
  ['speed-least-kmh', (s) => s.groupSpeedLeastKmh],
  ['speed-most-kmh', (s) => s.groupSpeedMostKmh],
];

const cell = (value: number | boolean | null): string =>
  value === null ? '-' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);

/** The score table: a heading row, then a row a ride. */
export function scoreTable(rides: readonly RideResult[]): readonly string[] {
  const head = ['rider', 'course', ...COLUMNS.map(([name]) => name)];
  const rows = rides.map((ride) => [
    ride.rider,
    ride.course,
    ...COLUMNS.map(([, read]) => cell(read(ride.score))),
  ]);
  const widths = head.map((name, at) =>
    Math.max(name.length, ...rows.map((row) => (row[at] as string).length)),
  );
  return [head, ...rows].map((row) =>
    row.map((each, at) => each.padStart(widths[at] as number)).join(' '),
  );
}

/** One mark's line: whether it held, the score and its bound, and the reason beside it. */
export function markLine(result: MarkResult): string {
  const reason = PASS_MARKS.find(
    (each) => each.mark === result.mark && each.rider === result.rider,
  )?.reason;
  const bound = [
    result.least === null ? null : `least ${String(result.least)}`,
    result.most === null ? null : `most ${String(result.most)}`,
  ]
    .filter((each) => each !== null)
    .join(', ');
  return `${result.passed ? 'pass ' : 'BELOW'} ${result.rider} ${result.course} ${result.mark}: ${cell(result.scored)} (${bound}) -- ${reason ?? ''}`;
}

/** The names in `value`, a comma-separated list, if every one is in `known`. */
function namesIn<T extends string>(value: string, known: readonly T[]): readonly T[] | undefined {
  const names = value.split(',');
  return names.every((name) => (known as readonly string[]).includes(name))
    ? (names as T[])
    : undefined;
}

/** What a command line asks: the riders, the courses and where results go, or `undefined` for one it cannot read. */
export function readCommand(args: readonly string[]):
  | {
      readonly riders: readonly ScriptedRider[];
      readonly courses: readonly HarnessCourse[];
      readonly results: string;
    }
  | undefined {
  let riders: readonly ScriptedRider[] = SCRIPTED_RIDERS;
  let courses: readonly HarnessCourse[] = HARNESS_COURSES;
  let results = RESULTS;
  for (let at = 0; at < args.length; at += 2) {
    const name = args[at];
    const value = args[at + 1];
    if (value === undefined || value.startsWith('-')) return undefined;
    if (name === '--rider') {
      const named = namesIn(value, SCRIPTED_RIDERS);
      if (named === undefined) return undefined;
      riders = named;
    } else if (name === '--course') {
      const named = namesIn(
        value,
        HARNESS_COURSES.map((each) => each.name),
      );
      if (named === undefined) return undefined;
      courses = HARNESS_COURSES.filter((each) => named.includes(each.name));
    } else if (name === '--results') {
      results = value;
    } else {
      return undefined;
    }
  }
  return { riders, courses, results };
}

/** Ride, score and mark every ride asked. */
export function runHarness(
  riders: readonly ScriptedRider[],
  courses: readonly HarnessCourse[],
  ride: (asked: RideAsked) => RideRecord = rideScripted,
): HarnessResult {
  const rides: RideResult[] = [];
  for (const course of courses) {
    for (const rider of riders) {
      const record = ride({ rider, course });
      const score = scoreRide(record);
      const marks = markRide(rider, course.name, score);
      rides.push({
        rider,
        course: course.name,
        seed: record.seed,
        passed: marks.every((each) => each.passed),
        score,
        marks,
      });
    }
  }
  return {
    rulesVersion: GROUP_RIDE_CODE_VERSION,
    seed: HARNESS_SEED,
    targetKmh: HARNESS_TARGET_KMH,
    passed: rides.every((each) => each.passed),
    rides,
  };
}

/**
 * Run the harness. Returns the exit code: 0 at or above every pass mark, 1
 * below one, 2 for a command it cannot read.
 */
export async function main(args: readonly string[], options: HarnessOptions = {}): Promise<number> {
  const print =
    options.print ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const command = readCommand(args);
  if (command === undefined) {
    process.stderr.write(USAGE);
    return 2;
  }
  const result = runHarness(command.riders, command.courses, options.ride);
  for (const line of scoreTable(result.rides)) print(line);
  print('');
  const marks = result.rides.flatMap((each) => each.marks);
  for (const each of marks) print(markLine(each));
  const below = marks.filter((each) => !each.passed).length;
  print(
    below === 0
      ? `pass: ${String(marks.length)} of ${String(marks.length)} marks held`
      : `BELOW THE PASS MARK: ${String(below)} of ${String(marks.length)} marks`,
  );
  const text = resultFileText(result);
  const file = join(command.results, resultFileName(result));
  const write =
    options.write ??
    (async (path: string, body: string): Promise<void> => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    });
  await write(file, text);
  print(`scores written to ${file}`);
  return result.passed ? 0 : 1;
}
