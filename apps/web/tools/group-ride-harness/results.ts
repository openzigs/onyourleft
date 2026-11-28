// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **the results a run writes**, one file a run.
 *
 * **Numbers and seeds only.** The file holds the rules' version, the seed,
 * the average asked, and for each ride its scores and its marks. Names are
 * words from the harness's closed lists (a rider, a course, a mark, a cue
 * kind). It never holds a place, a coordinate, a sentence or anything from a
 * real ride: the courses are synthetic, and {@link assertNumbersOnly}
 * refuses, before anything is written, any text that is not one short word,
 * and any number that is not finite. No timestamp either, so two runs write
 * the same bytes.
 */

import type { MarkResult } from './marks';
import type { RideScore } from './score';

/** One ride's part of a result. */
export interface RideResult {
  readonly rider: string;
  readonly course: string;
  readonly seed: number;
  readonly passed: boolean;
  readonly score: RideScore;
  readonly marks: readonly MarkResult[];
}

/** What a run of the harness came to. */
export interface HarnessResult {
  /** `GROUP_RIDE_CODE_VERSION`: the rules the rides were ridden under. */
  readonly rulesVersion: number;
  readonly seed: number;
  readonly targetKmh: number;
  readonly passed: boolean;
  readonly rides: readonly RideResult[];
}

/** The most characters a word in a results file has. */
const MOST_WORD_CHARACTERS = 32;

/** A single word: lower-case letters, digits and the hyphen, as every closed-list name here is. */
const WORD = /^[a-z0-9][a-z0-9-]*$/u;

/** A key: one word, in camel case or hyphenated, as a score's or a cue kind's name is. */
const KEY = /^[a-zA-Z][a-zA-Z0-9-]*$/u;

/**
 * Hold `value` to finite numbers, booleans, `null`, and text that is one
 * short word.
 *
 * @throws {Error} naming where the value is, and never the value.
 */
export function assertNumbersOnly(value: unknown, at = 'result'): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${at} is not a finite number`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MOST_WORD_CHARACTERS || !WORD.test(value)) {
      throw new Error(
        `${at} is text that is not one short word: a results file holds numbers only`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((each, index) => {
      assertNumbersOnly(each, `${at}[${String(index)}]`);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [key, each] of Object.entries(value)) {
      if (!KEY.test(key)) {
        throw new Error(`${at} has a key that is not one word`);
      }
      assertNumbersOnly(each, `${at}.${key}`);
    }
    return;
  }
  throw new Error(`${at} is not a number, a boolean or a word`);
}

/** The file's text for `result`, refused unless it is numbers and words only. */
export function resultFileText(result: HarnessResult): string {
  assertNumbersOnly(result);
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** The file's name for `result`: the rules' version and the seed, so a run on other rules does not overwrite it. */
export function resultFileName(result: Pick<HarnessResult, 'rulesVersion' | 'seed'>): string {
  return `group-ride-v${String(result.rulesVersion)}-seed-${String(result.seed)}.json`;
}
