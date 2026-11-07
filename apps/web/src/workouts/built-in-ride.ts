// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Riding a tailored built-in without saving it — #2306, under the library
 * epic #2295 (the owner's ruling 3: *ride it without saving*).
 *
 * ## The address carries the choices, not the workout
 *
 * *Ride it* on the tailor pane is a link to the Ride screen with the
 * template's id and the rider's choices in its query —
 * `#/ride?workout=built-in%3Asweet-spot-3x12&length=45&intensity=-5`. The Ride
 * screen makes the workout again from them with `tailorWorkout`, through the
 * same `tailor.ts` the pane used, so the workout ridden is the one previewed,
 * a reload or Back keeps it, and nothing is held in memory between two
 * screens or written anywhere.
 *
 * ## One start path
 *
 * What comes out is an ordinary `WorkoutRecord`, held in memory and never
 * written to the workouts store, which the Ride screen's `WorkoutPanel`
 * offers beside the saved ones. Its *Ride* goes to `RideController
 * .startWorkout` exactly as a saved workout's does: the same threshold guard,
 * the same heart-rate hold context, the same re-plan choices. Nothing here
 * reaches the trainer.
 *
 * ## Its identity
 *
 * {@link BUILT_IN_RIDE_PREFIX} and the template's id: never a saved workout's
 * (those are `workout-` and a UUID). Nothing after the ride looks a workout up
 * by id — a ride's page lists the blocks the recording kept
 * (`@onyourleft/store` §`RecordedWorkoutBlock`), each with its own target — so
 * an id with no stored row loses nothing.
 */

import { BUILT_IN_WORKOUTS, unixSeconds, type WorkoutTemplate } from '@onyourleft/domain';
import { workoutId, type AthleteId, type WorkoutRecord } from '@onyourleft/store';

import { hrefFor, routeById } from '../shell/routes';
import { BUILT_IN_ID_PREFIX } from './built-in';
import {
  EMPTY_TAILOR_DRAFT,
  initialTailorDraft,
  rideName,
  tailorFromDraft,
  tailorOffer,
  type TailorDraft,
} from './tailor';

/** The id a ridden built-in carries: `built-in:sweet-spot-3x12`. */
export const BUILT_IN_RIDE_PREFIX = BUILT_IN_ID_PREFIX;

/** The query keys, in the Ride screen's address. */
const KEYS = {
  workout: 'workout',
  length: 'length',
  intensity: 'intensity',
  repeats: 'repeats',
  recovery: 'recovery',
} as const;

/**
 * *Ride it*'s address: the Ride screen, with the template and every choice
 * that is not the template's own. Only valid choices are put here — the
 * pane's last valid ones — but the Ride screen tailors them again anyway.
 */
export function hrefForRidingBuiltIn(template: WorkoutTemplate, draft: TailorDraft): string {
  const params = new URLSearchParams();
  params.set(KEYS.workout, `${BUILT_IN_RIDE_PREFIX}${template.id}`);
  // The pane opens with the template's repeats and recovery in their boxes
  // (#2305, the ruling of 2026-11-07): those are the template's own, too.
  const own = initialTailorDraft(tailorOffer(template));
  for (const key of ['length', 'intensity', 'repeats', 'recovery'] as const) {
    const value = draft[key].trim();
    if (value !== '' && value !== EMPTY_TAILOR_DRAFT[key] && value !== own[key]) {
      params.set(KEYS[key], value);
    }
  }
  return `${hrefFor(routeById('ride'))}?${params.toString()}`;
}

/** A built-in and the choices an address made of it. */
export interface BuiltInRide {
  readonly template: WorkoutTemplate;
  readonly draft: TailorDraft;
}

/**
 * The built-in and choices in the Ride screen's query, or `undefined` for
 * none. Total: an id that names no built-in is no workout, never an error.
 */
export function builtInRideFromQuery(query: string | undefined): BuiltInRide | undefined {
  if (query === undefined || query === '') return undefined;
  const params = new URLSearchParams(query);
  const id = params.get(KEYS.workout);
  if (id === null || !id.startsWith(BUILT_IN_RIDE_PREFIX)) return undefined;
  const template = BUILT_IN_WORKOUTS.find((each) => `${BUILT_IN_RIDE_PREFIX}${each.id}` === id);
  if (template === undefined) return undefined;
  const choice = (key: keyof typeof KEYS): string | undefined => params.get(KEYS[key]) ?? undefined;
  return {
    template,
    draft: {
      length: choice('length') ?? EMPTY_TAILOR_DRAFT.length,
      intensity: choice('intensity') ?? EMPTY_TAILOR_DRAFT.intensity,
      repeats: choice('repeats') ?? EMPTY_TAILOR_DRAFT.repeats,
      recovery: choice('recovery') ?? EMPTY_TAILOR_DRAFT.recovery,
    },
  };
}

export type OfferedWorkout =
  | { readonly status: 'offered'; readonly record: WorkoutRecord }
  | { readonly status: 'refused'; readonly name: string; readonly message: string };

/**
 * The workout the address asks for, as the in-memory record the Ride screen
 * offers, or the domain's refusal of the choices in it (an address typed by
 * hand can hold any).
 *
 * @param thresholdHeartRate the rider's own, which turns a heart-rate zone
 * hold into a range in beats per minute, as on the tailor pane.
 */
export function offeredWorkout(
  ride: BuiltInRide,
  owner: AthleteId,
  thresholdHeartRate: number | undefined,
  now: number,
): OfferedWorkout {
  const outcome = tailorFromDraft(ride.template, ride.draft, thresholdHeartRate);
  if (outcome.status === 'refused') {
    return { status: 'refused', name: ride.template.name, message: outcome.message };
  }
  // Without its length: the Ride screen says that beside the name (the ruling of 2026-11-07 (a)).
  const name = rideName(ride.template, ride.draft);
  const at = unixSeconds(Math.floor(now));
  return {
    status: 'offered',
    record: {
      id: workoutId(`${BUILT_IN_RIDE_PREFIX}${ride.template.id}`),
      createdBy: owner,
      name,
      workout: { ...outcome.workout, name },
      createdAt: at,
      updatedAt: at,
    },
  };
}
