// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Junction choice in an open-world ride — #2897, under ADR 0088.
 *
 * The bike follows the road by itself. Before each junction the rider may pick
 * a way on with a **discrete press** (D-1.3): left, straight or right, each
 * moving the choice one step, never a continuous or scaled amount. Nothing
 * pressed rides ADR 0088 D-1.4's default (the smallest change of bearing). The
 * choice is final {@link JUNCTION_LOCK_METRES} before the junction (D-1.5,
 * ADR 0087 D-6.2), and after that a press for it does nothing. A U-turn press
 * turns the rider round at any time (D-1.6); a dead end turns them round by
 * itself (D-1.7), which the rolling route does on its own.
 *
 * ## The pending choice is the rolling route's tail
 *
 * There is no second copy of it here. A press swaps the tail of the rolling
 * route past the next junction (`RollingRoute.choose`), and the prompt reads
 * which way the route takes back from the route (`junctionsAfter`), so what
 * the prompt shows and what the ride rides cannot disagree. That is also all a
 * press does (D-5.1): it changes which branch the rolling route appends.
 *
 * ## Nothing here can reach the trainer
 *
 * It imports the rolling route's types and nothing else. A press is not an
 * input to `gradient.ts` and names no trainer command; the grade comes from
 * the road ridden. `open-world-cannot-reach-trainer.test.ts` holds it.
 *
 * @unwired the open-world ride session (#2896) constructs this when it starts
 * a ride, and the junction prompt (#2898) draws {@link JunctionChoice.prompt};
 * neither exists yet. The behavioural ride in `junction-choice.test.ts` drives
 * it as they will.
 */

import { JUNCTION_LOCK_METRES, type RollingRoute, type RollingWay } from '@onyourleft/domain';

/**
 * The prompt for a junction appears when the rider is this far before it:
 * **250 m** (ADR 0088 D-1.2, answered by the owner in D-9 Q2). With two
 * junctions closer than this, the second's prompt appears as the first is
 * passed, because only the next junction is ever prompted.
 */
export const JUNCTION_PROMPT_METRES = 250;

/** A discrete press: one step of the choice, or a U-turn (ADR 0088 D-1.3, D-1.6). */
export const TURN_PRESSES = ['left', 'straight', 'right', 'u-turn'] as const;

export type TurnPress = (typeof TURN_PRESSES)[number];

/** What the prompt shows for the next junction (#2898 draws it). */
export interface JunctionPrompt {
  /** The ride distance of the junction. */
  readonly distance: number;
  /** Every way on, from the furthest left to the furthest right. */
  readonly ways: readonly RollingWay[];
  /** The edge id the ride will take: the rider's choice, or the default. */
  readonly chosen: string;
  /** The edge id of ADR 0088 D-1.4's default. */
  readonly defaultWay: string;
  /** Whether the choice is final (D-1.5). */
  readonly locked: boolean;
  /** Metres until the choice is final; 0 once it is. */
  readonly toLock: number;
}

export interface JunctionChoice {
  /** The prompt for the next junction, or `undefined` while none is within {@link JUNCTION_PROMPT_METRES}. */
  prompt(rider: number): JunctionPrompt | undefined;
  /** One press, from any input, with the rider at ride distance `rider`. */
  press(press: TurnPress, rider: number): void;
}

/** The junction choice for an open-world ride on `route`. */
export function createJunctionChoice(route: RollingRoute): JunctionChoice {
  const prompt = (rider: number): JunctionPrompt | undefined => {
    const next = route.junctionsAfter(rider)[0];
    if (next === undefined || next.distance - rider > JUNCTION_PROMPT_METRES) return undefined;
    const toLock = Math.max(0, next.distance - rider - JUNCTION_LOCK_METRES);
    return {
      distance: next.distance,
      ways: next.ways,
      chosen: next.taken,
      defaultWay: next.defaultWay,
      locked: toLock === 0,
      toLock,
    };
  };

  return {
    prompt,
    press(press, rider) {
      if (press === 'u-turn') {
        route.uTurn(rider);
        return;
      }
      const shown = prompt(rider);
      if (shown === undefined) return;
      const at = shown.ways.findIndex((way) => way.edge.id === shown.chosen);
      const step =
        press === 'straight'
          ? undefined
          : shown.ways[
              Math.min(shown.ways.length - 1, Math.max(0, at + (press === 'left' ? -1 : 1)))
            ];
      const wanted = step === undefined ? shown.defaultWay : step.edge.id;
      // `choose` refuses a choice inside the lock itself, so a press can never
      // move the grade under the rider, whatever this module decides.
      route.choose(shown.distance, wanted, rider);
    },
  };
}
