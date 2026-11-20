// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838's scoring harness: **the results file a run writes**, one per run,
 * under `results/scores/`.
 *
 * **Numbers only.** A file holds the prompt's version, the model's name, when
 * it was measured, the pass mark, and each race's or the ride's scores and
 * timings. It never holds a line the model wrote, a race state or a request:
 * {@link assertNumbersOnly} refuses, before anything is written, any text
 * that is not a single short word, which a version, a model tag, a race's
 * name and a timestamp all are and a sentence is not.
 */

import type { BotRaceScore, Shortfall } from './bot-score';
import type { PacerScore } from './pacer-score';

/** One race's part of a bots result. */
export interface BotRaceResult {
  readonly race: string;
  readonly seed: number;
  readonly passed: boolean;
  readonly shortfalls: readonly Shortfall[];
  readonly score: BotRaceScore;
}

/** What a run of the harness came to. */
export type HarnessResult = {
  readonly promptVersion: string;
  readonly model: string;
  /** When the run ended, UTC, ISO 8601. */
  readonly measuredAt: string;
  readonly passed: boolean;
  readonly passMark: Readonly<Record<string, number>>;
} & (
  | { readonly kind: 'bots'; readonly races: readonly BotRaceResult[] }
  | {
      readonly kind: 'pacer';
      readonly shortfalls: readonly Shortfall[];
      readonly score: PacerScore;
    }
);

/** The most characters a word in a results file has: a model tag or a timestamp fits, a line does not. */
const MOST_WORD_CHARACTERS = 48;

/** A single word: letters, digits and the marks a version, a model tag and a timestamp use. */
const WORD = /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/u;

/**
 * Hold `value` to numbers, booleans, `null`, and text that is one short word.
 *
 * @throws {Error} naming where the text is, and never the text.
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
        `${at} is text that is not a single short word: a results file holds numbers only`,
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
    for (const [key, each] of Object.entries(value)) assertNumbersOnly(each, `${at}.${key}`);
    return;
  }
  throw new Error(`${at} is not a number, a boolean or a word`);
}

/**
 * The file a result is written to: its kind, its prompt's version and when it
 * was measured.
 *
 * @throws {Error} through {@link assertNumbersOnly}, so that a version that is
 * not a single word is never part of a path.
 */
export function resultFileName(result: HarnessResult): string {
  assertNumbersOnly(result.promptVersion, 'result.promptVersion');
  const stamp = result.measuredAt.replace(/[-:]/gu, '').replace(/\.\d+/u, '');
  return `${result.kind}-${result.promptVersion}-${stamp}.json`;
}

/**
 * The text of a result's file.
 *
 * @throws {Error} through {@link assertNumbersOnly}.
 */
export function resultFileText(result: HarnessResult): string {
  assertNumbersOnly(result);
  return `${JSON.stringify(result, null, 2)}\n`;
}
