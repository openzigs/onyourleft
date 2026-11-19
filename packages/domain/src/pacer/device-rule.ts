// SPDX-License-Identifier: Apache-2.0

/**
 * **The device decides what the AI pacer does** — #2835, ADR 0083: one rule,
 * read from the gap and the road, with no model in it.
 *
 * The owner's tablet ride of 2026-11-18: *"saying it is slowing down when
 * behind me. Also at the start it takes off to aggressive"*, and, of the
 * model, *"I think the agent needs a bit more logic"*. Until then a model
 * picked the intent and two device rules corrected it afterwards (ADR 0078's
 * floor, ADR 0082's terrain rule), so a slow, void or missing answer left the
 * pacer riding a decision that was seconds old or none at all. Now the
 * device picks the intent each time it asks, and the model is told what the
 * pacer is doing and writes the line. **A failed, late or void answer costs
 * a line, never the pacing.**
 *
 * ## The rule, in the order it is read
 *
 * 1. **The rider is at a standstill** (no time gap can be said): behind the
 *    pacer, it eases by {@link PACER_WAIT_MOST} (`rider-stopped`); level or
 *    ahead, it holds.
 * 2. **The terrain, with the rider on the wheel** (ADR 0082, unchanged): the
 *    rider `level` or in the draft, and never `ahead` — `ease` in the last
 *    300 m before a climb, `lift` on a descent and for 200 m over a climb's
 *    top, at ADR 0072's fixed shares (`PACER_EASE`, `PACER_LIFT`).
 * 3. **The gap** ({@link pacerGapResponse}): inside `PACER_LEVEL_S` either
 *    way, `hold`. Behind, `ease`, to wait; ahead, `lift`, to chase. **The
 *    response grows with the gap**, in a straight line from nothing at
 *    `PACER_LEVEL_S` (2 s) to the whole of #92's envelope at
 *    {@link PACER_GAP_FULL_S} (10 s): 20 % for a wait, 10 % for a chase.
 *
 * ## What the rule cannot do
 *
 * - **Ease with the rider ahead.** Ahead, the only answers are `lift` and
 *   `hold`, from the first ask: ADR 0078's floor, which waited 10 s, is this
 *   rule's shape rather than a correction to it.
 * - **Leave #92's envelope.** It answers an intent and a share; the share is
 *   capped here and the product is clamped again where it is ridden
 *   (`directedPacingFactor`).
 * - **Name a power, or reach a trainer.** Its answer moves the pacer and
 *   nothing else (ADR 0072 D-6).
 * - **Pick a plan.** The plan is `rolling`, #92's own rule, on every
 *   decision: the model no longer chooses one, and the saved ride of
 *   2026-11-18 was `rolling` throughout anyway.
 *
 * Pure, and platform-free: every input is a number, a boolean or a word.
 */

import {
  PACER_CHASE_MOST,
  PACER_LEVEL_S,
  PACER_WAIT_MOST,
  riderPlaceOf,
  type PacerDirection,
  type PacerIntent,
  type PacerReason,
  type RiderPlace,
} from './model-pacer';
import { pacerTerrainApplies, pacerTerrainIntent, type PacerTerrain } from './terrain-rule';

/**
 * The time gap at which the pacer's response is whole, seconds: **10**, about
 * 100 m at 36 km/h. A feel parameter, the author's choice (ADR 0083 D-1).
 */
export const PACER_GAP_FULL_S = 10;

/** What the device reads when it decides: where the rider and the pacer are. */
export interface PacerRuleGround {
  /** Metres the rider is ahead of the pacer; below 0, behind it. */
  readonly riderGapM: number;
  /** The rider's speed, m/s: the time gap is said at it. */
  readonly riderSpeed: number;
  /** Whether the rider is in the pacer's draft. */
  readonly riderInDraft: boolean;
  /** Where the pacer is on the road (`pacerTerrainAt`). */
  readonly terrain: PacerTerrain;
}

/** What the device decided, why, and where the rider was. */
export interface PacerRuleDecision {
  readonly direction: PacerDirection;
  readonly reason: PacerReason;
  /** `riderPlaceOf`; `undefined` at a standstill. */
  readonly place: RiderPlace | undefined;
  /** The time gap, seconds to a tenth, above 0 with the rider ahead; `undefined` at a standstill. */
  readonly gapS: number | undefined;
}

const hundredths = (value: number): number => Math.round(value * 100) / 100;

/**
 * **The gap curve** (ADR 0083 D-1.3): what the pacer does about a rider
 * `gapS` seconds ahead of it (below 0, behind), and by how much.
 *
 * `share = clamp((|gapS| − 2) / (10 − 2), 0, 1)`, and the pacer eases by
 * `share × 20 %` for a rider behind, or lifts by `share × 10 %` for one
 * ahead, in whole percent. A share that rounds to nothing is `hold`.
 */
export function pacerGapResponse(gapS: number): {
  readonly intent: PacerIntent;
  readonly by?: number;
} {
  if (!Number.isFinite(gapS)) return { intent: 'hold' };
  const beyond = Math.abs(gapS) - PACER_LEVEL_S;
  if (!(beyond > 0)) return { intent: 'hold' };
  const share = Math.min(1, beyond / (PACER_GAP_FULL_S - PACER_LEVEL_S));
  const by = hundredths(share * (gapS < 0 ? PACER_WAIT_MOST : PACER_CHASE_MOST));
  if (by === 0) return { intent: 'hold' };
  return { intent: gapS < 0 ? 'ease' : 'lift', by };
}

/** The largest time gap a decision says, seconds: a day, the most a pacer state or a log record may hold. */
const MOST_GAP_S = 86_400;

/** The one plan a device decision rides: #92's own rule. */
const PLAN = 'rolling';

/** The device's decision for `ground`. @see the module note */
export function pacerRuleDecision(ground: PacerRuleGround): PacerRuleDecision {
  const place = riderPlaceOf(ground.riderGapM, ground.riderSpeed);
  if (place === undefined) {
    // 1. At a standstill there is no time gap: wait for a rider who is behind.
    const waiting = ground.riderGapM < 0;
    return {
      direction: waiting
        ? { plan: PLAN, intent: 'ease', by: PACER_WAIT_MOST }
        : { plan: PLAN, intent: 'hold' },
      reason: waiting ? 'rider-stopped' : 'rider-level',
      place,
      gapS: undefined,
    };
  }
  // To a tenth, and inside a day: a rider barely moving is hours behind by this sum.
  const gapS =
    Math.round(
      Math.min(MOST_GAP_S, Math.max(-MOST_GAP_S, ground.riderGapM / ground.riderSpeed)) * 10,
    ) / 10;
  // 2. The terrain, with the rider on the wheel and never ahead (ADR 0082).
  const terrained = pacerTerrainApplies(place, ground.riderInDraft)
    ? pacerTerrainIntent(ground.terrain)
    : undefined;
  if (terrained !== undefined && ground.terrain !== 'none') {
    return {
      direction: { plan: PLAN, intent: terrained },
      reason: ground.terrain,
      place,
      gapS,
    };
  }
  // 3. The gap: wait for a rider behind, chase one ahead, more the further they are.
  const response = pacerGapResponse(ground.riderGapM / ground.riderSpeed);
  return {
    direction: { plan: PLAN, ...response },
    reason:
      response.intent === 'ease'
        ? 'rider-behind'
        : response.intent === 'lift'
          ? 'rider-ahead'
          : 'rider-level',
    place,
    gapS,
  };
}
