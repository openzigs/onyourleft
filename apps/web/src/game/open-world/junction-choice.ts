// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Junction choice in an open-world ride — #2897, under ADR 0088.
 *
 * The bike follows the road by itself. Before each junction the rider may pick
 * a way on with a **discrete press** (D-1.3): left, straight or right, never a
 * continuous or scaled amount. At a junction with three ways on or fewer a
 * press chooses its way **directly**, whatever was chosen before (the owner's
 * ruling of 2026-11-20 on D-1.3's first sentence); with more than three, left
 * and right step the choice one way round the junction. Straight is always the
 * way most nearly dead ahead by bearing (owner ruling 2026-11-20), and at three
 * ways, when that way is an end, the press for that end steps inward. Nothing
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
 * `GameView` constructs one when an open-world ride starts, over the rolling
 * route its road follows, and hands the HUD its prompt and its press (#3013).
 * The HUD's junction prompt (`hud/JunctionChoicePrompt.tsx`, #2898) draws
 * {@link JunctionChoice.prompt} and labels its ways with
 * {@link pressesOfWays}. `junction-wiring.test.tsx` rides it through the
 * real game screen; the behavioural rides in `junction-choice.test.ts` and
 * `hud/JunctionChoicePrompt.test.tsx` drive it as `GameView` does.
 */

import { JUNCTION_LOCK_METRES, type RollingRoute, type RollingWay } from '@onyourleft/domain';

/**
 * The prompt for a junction appears when the rider is this far before it:
 * **250 m** (ADR 0088 D-1.2, answered by the owner in D-9 Q2). With two
 * junctions closer than this, the second's prompt appears as the first is
 * passed, because only the next junction is ever prompted.
 * `junction-choice.test.ts` holds the prompt to appearing at exactly this
 * distance; {@link createJunctionChoice} reads it here.
 */
export const JUNCTION_PROMPT_METRES = 250;

/** A discrete press: left, straight or right (ADR 0088 D-1.3), or a U-turn (D-1.6). */
export const TURN_PRESSES = ['left', 'straight', 'right', 'u-turn'] as const;

export type TurnPress = (typeof TURN_PRESSES)[number];

/** A press that chooses a way at a junction: every press but the U-turn. */
export type WayPress = Exclude<TurnPress, 'u-turn'>;

/** The presses that choose a way, in the order the prompt names them. */
export const WAY_PRESSES: readonly WayPress[] = ['left', 'straight', 'right'];

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

/**
 * The most ways on at which a press chooses its way directly rather than
 * stepping round the junction (ADR 0088 D-1.3, owner ruling 2026-11-20).
 */
const DIRECT_CHOICE_MAX_WAYS = 3;

/**
 * The edge id a press asks for at the junction `shown` prompts.
 *
 * - **Straight, at any junction, is the way most nearly dead ahead by
 *   bearing**: the smallest absolute turn from the rider's heading (the
 *   owner's ruling of 2026-11-20), never the middle way by position. That is
 *   D-1.4's default, which the rolling route computes from each way's
 *   `turnDegrees` (`waysOn`), so a straight press and no press always agree.
 *   Ties are D-1.4's: turns are compared in whole degrees, then the higher
 *   road class wins, then the right-hand way.
 * - **Left and right, with three ways on or fewer: directly**, whatever was
 *   chosen before. Left is the furthest-left way and right the furthest-right,
 *   except that with three ways, when straight is that end, the press steps
 *   inward to the middle way, so every way shown has a press of its own (owner
 *   ruling 2026-11-20). With two ways each already has one, and left and right
 *   keep their ends.
 * - **Left and right, with more than three: a step** one way round the
 *   junction, stopping at its ends.
 */
function wayForPress(press: WayPress, shown: JunctionPrompt): string {
  const { ways, chosen, defaultWay } = shown;
  if (press === 'straight') return defaultWay;
  // A prompted junction has at least two ways on (`junctionsAfter`), so each
  // index below names a way.
  if (ways.length <= DIRECT_CHOICE_MAX_WAYS) {
    const end = press === 'left' ? 0 : ways.length - 1;
    const endId = (ways[end] as RollingWay).edge.id;
    if (ways.length === 2 || endId !== defaultWay) return endId;
    return (ways[1] as RollingWay).edge.id;
  }
  const at = ways.findIndex((way) => way.edge.id === chosen);
  // Clamped to the junction's ends.
  const step = ways[Math.min(ways.length - 1, Math.max(0, at + (press === 'left' ? -1 : 1)))];
  return (step as RollingWay).edge.id;
}

/**
 * Which presses take each way of the junction `shown` prompts, as they stand
 * now: for each way's edge id, every press that would choose it, in
 * {@link WAY_PRESSES}'s order, and none for a way no single press reaches
 * (with more than three ways on, one further round than a step).
 *
 * Built from {@link wayForPress} itself, never a copy of its rule (#2898,
 * from the review of #2964): since the owner's inward-step ruling, which
 * press takes which way is not positional, so the prompt labels each way it
 * draws, and sends each tap, from this.
 */
export function pressesOfWays(shown: JunctionPrompt): ReadonlyMap<string, readonly WayPress[]> {
  const presses = new Map<string, WayPress[]>(shown.ways.map((way) => [way.edge.id, []]));
  for (const press of WAY_PRESSES) presses.get(wayForPress(press, shown))?.push(press);
  return presses;
}

/** An open-world ride's junction choice: `GameView` holds one for the ride (#3013). */
export interface JunctionChoice {
  /** The prompt for the next junction, or `undefined` while none is within {@link JUNCTION_PROMPT_METRES}. */
  prompt(rider: number): JunctionPrompt | undefined;
  /** One press, from any input, with the rider at ride distance `rider`. */
  press(press: TurnPress, rider: number): void;
}

/**
 * The junction choice for an open-world ride on `route`: `GameView`
 * constructs it when the ride starts, on its road's rolling route (#3013).
 */
export function createJunctionChoice(route: RollingRoute): JunctionChoice {
  const prompt = (rider: number): JunctionPrompt | undefined => {
    // Only the next junction is ever prompted, and this runs every frame:
    // `nextJunctionAfter` builds that one and none of the others ahead (#2898).
    const next = route.nextJunctionAfter(rider);
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
      const wanted = wayForPress(press, shown);
      // `choose` refuses a choice inside the lock itself, so a press can never
      // move the grade under the rider, whatever this module decides.
      route.choose(shown.distance, wanted, rider);
    },
  };
}
