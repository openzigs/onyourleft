// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The re-plan agent's tools** — #1243, ADR 0048 D-11: `ride_so_far`,
 * `goals` and `saved_workouts`. Each is read-only, scoped to the JOB's
 * athlete and bounded, exactly as `tools.ts` says of the write-up's tools;
 * no schema has an athlete, an id or a path for a model to set.
 *
 * ## Which of the write-up's tools a re-plan does NOT have, and why
 *
 * **No `recent_rides` and no `history_search`** — spike 0022's option H,
 * which that spike left to this issue. A re-plan reads the ride being ridden,
 * the rider's goals and their saved workouts, and nothing of their earlier
 * rides: it costs the re-plan the rider's history, and it removes the one
 * limb of US11270598's claims 1 and 19 the design otherwise met (*"based on
 * historical workouts of the user"*). `ride_sections` reads a finished ride's
 * input, which a re-plan does not have. A change here is a decision to
 * record, not a list to extend.
 *
 * ## Bounds
 *
 * A re-plan has 6 000 tokens for the whole run (`replan-agent.ts`), so each
 * answer here is far smaller than the write-up's: twelve summaries, and
 * {@link REPLAN_GOALS_CHARACTERS} and {@link SAVED_WORKOUTS_CHARACTERS}.
 *
 * ⚠️ **`saved_workouts` returns a workout's sync key**, which no write-up
 * tool does (`tools.ts`): a swap must name the workout, and the key is the id
 * the rider's device knows it by. It returns no name and no description, so
 * a saved workout is not a place a sentence can reach the model from.
 */

import {
  decodeWorkoutFile,
  MAXIMUM_WORKOUT_ID_CHARACTERS,
  workoutBlockText,
  type Workout,
} from '@onyourleft/domain';

import { holdsDataUrl } from '../../history/passages.ts';
import type { ReplanInput } from '../replan-input.ts';
import { bounded, GOALS, integers, textOf, type AgentTool, type ReadContext } from './tools.ts';

/** What a re-plan tool runs against: the job's athlete, its input and the one read. */
export interface ReplanToolContext extends ReadContext {
  readonly input: ReplanInput;
}

type NoArguments = Readonly<Record<string, number | undefined>>;
const NO_ARGUMENTS = { type: 'object', properties: {}, additionalProperties: false };

/** The most blocks `ride_so_far` returns: the last twelve ridden (#1243). */
export const RIDE_SO_FAR_BLOCKS = 12;

/** `ride_so_far`: the newest summaries of the ride being ridden, from the device-built input only. */
export const RIDE_SO_FAR: AgentTool<NoArguments, ReplanToolContext> = {
  spec: {
    name: 'ride_so_far',
    description: `The summaries of the blocks ridden so far in this ride, oldest first, at most the last ${String(RIDE_SO_FAR_BLOCKS)}.`,
    parameters: NO_ARGUMENTS,
  },
  validate: (input) => integers(input, {}),
  run: (context) =>
    Promise.resolve(JSON.stringify(context.input.summaries.slice(-RIDE_SO_FAR_BLOCKS))),
};

/** The most `goals` returns to a re-plan, all goals together. */
export const REPLAN_GOALS_CHARACTERS = 1_000;

/** `goals`: the write-up's tool (#836's free text, which never sets a bound), cut to a re-plan's size. */
export const REPLAN_GOALS: AgentTool<NoArguments, ReplanToolContext> = {
  spec: GOALS.spec,
  validate: (input) => GOALS.validate(input),
  run: async (context, args) => bounded(await GOALS.run(context, args), REPLAN_GOALS_CHARACTERS),
};

/** The most workouts `saved_workouts` returns. */
export const SAVED_WORKOUTS_LIMIT = 5;

/** The most `saved_workouts` returns, all workouts together. */
export const SAVED_WORKOUTS_CHARACTERS = 1_200;

/** How many workout items are read, at most, to fill {@link SAVED_WORKOUTS_LIMIT}. */
const WORKOUT_ITEMS = 20;

/**
 * A key a model can name back exactly: nothing the data fence rewrites, and
 * no longer than a proposal's `workoutId` may be.
 */
const NAMEABLE_KEY = /^[A-Za-z0-9._:-]+$/;

/**
 * `saved_workouts`: the athlete's saved workouts as a swap may name them —
 * each one's id, and its blocks numbered from 0 as shares of threshold power.
 * A row that is not a workout this program would ride is skipped
 * (`tools.ts` §`workoutLine`), and so is a workout that does not fit whole:
 * a cut line would offer a block index that is not there.
 */
export const SAVED_WORKOUTS: AgentTool<NoArguments, ReplanToolContext> = {
  spec: {
    name: 'saved_workouts',
    description:
      'The cyclist’s own saved workouts, for swap-next-block: each one’s id and its blocks, numbered from 0, with targets as a percentage of threshold power.',
    parameters: NO_ARGUMENTS,
  },
  validate: (input) => integers(input, {}),
  run: async (context) => {
    const items = await context.reads.listLiveSyncItems(
      context.athleteId,
      'workout',
      WORKOUT_ITEMS,
    );
    const lines: string[] = [];
    let used = 0;
    for (const item of items) {
      if (lines.length === SAVED_WORKOUTS_LIMIT) break;
      if (item.key.length > MAXIMUM_WORKOUT_ID_CHARACTERS || !NAMEABLE_KEY.test(item.key)) continue;
      const text = textOf(item);
      if (text === undefined || holdsDataUrl(text)) continue;
      let workout: Workout;
      try {
        workout = decodeWorkoutFile(text);
      } catch {
        continue;
      }
      const blocks = workout.blocks
        .map((block, index) => `block ${String(index)}: ${workoutBlockText(block)}`)
        .join('; ');
      const line = `Workout id "${item.key}" — ${blocks}`;
      // The line, and the line break before it.
      if (used + line.length + 1 > SAVED_WORKOUTS_CHARACTERS) continue;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.length === 0 ? 'The cyclist has no saved workouts synced.' : lines.join('\n');
  },
};

/** A re-plan tool of any argument shape. */
export type AnyReplanTool = AgentTool<Readonly<Record<string, unknown>>, ReplanToolContext>;

/** Every tool the re-plan agent has, and no other. */
export const REPLAN_TOOLS: readonly AnyReplanTool[] = [RIDE_SO_FAR, REPLAN_GOALS, SAVED_WORKOUTS];
