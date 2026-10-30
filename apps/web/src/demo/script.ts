// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A demo rider's script — #1646.
 *
 * A demo rider is driven by a **hand-authored** list of segments: a target
 * intensity, a cadence and a heart rate, each eased towards over a stated
 * number of seconds. `runner.ts` turns the power into a speed through the same
 * `advance` the rider's own ride uses; this file only answers *what is the
 * rider doing at this ride time*.
 *
 * ## ⚠️ Authored, never recorded — ADR 0007 D4
 *
 * A bot is outside the cited patent claims "by construction" because "there is
 * no recorded ride behind it". A demo script has to be the same: written by
 * hand, never derived from a recorded ride, the owner's or anyone else's.
 * `packages/domain/src/pacer/pacing.ts` §`SyntheticInput` constrains the pacer
 * plan to scalars at compile time; {@link SyntheticScript} does the same here.
 * A field that could carry a recording — a sample array, a nested object, an
 * activity id or an athlete id — makes {@link RiderScriptIsSynthetic} fail with
 * `TS2344`, and `script.test.ts` holds the `@ts-expect-error` cases that go red
 * if the constraint is ever loosened. The same test walks every shipped preset
 * at run time against a named allowlist of keys.
 *
 * ## Nothing here reads a clock
 *
 * {@link scriptedSample} is a closed-form function of the script and the ride
 * time it is handed. There is no state, so the same `(script, seconds)` gives
 * the same answer every time — the property the video export (#1655) and the
 * browser gate (#1648) are built on. `eslint.config.js` refuses `Date` and
 * `Math.random` under `src/demo/`.
 */

import type { Seconds, Watts } from '@onyourleft/domain';
import { BOT_MASS_KILOGRAMS, watts } from '@onyourleft/domain';

/**
 * The kit colours a demo rider may wear.
 *
 * Written out rather than imported: `@onyourleft/store` owns `KitColour`, and
 * `src/demo/` imports nothing from the store (#1646's "no recorded data"
 * criterion). `script.test.ts` assigns each to `game/bicycle.ts`'s palette key
 * type, so a colour the renderer has no entry for fails `typecheck`.
 */
export type DemoKit = 'house' | 'green' | 'lime' | 'purple' | 'magenta';

/** Which preset this is. */
export type DemoPresetId = 'climb' | 'sprint' | 'group';

/** One segment of a script: scalars only, authored by hand. */
export interface ScriptSegment {
  /** The segment ends at this ride time, in seconds. The last one is held past its end. */
  readonly untilSeconds: number;
  /** Target intensity, as `BotPacerPlan`'s, at `BOT_MASS_KILOGRAMS`. */
  readonly wattsPerKilogram: number;
  readonly cadenceRpm: number;
  /** The scripted heart rate the segment eases towards. A scripted number, not a reading. */
  readonly heartRateBpm: number;
  /** How long power, cadence and heart rate take to reach this segment's targets. */
  readonly easeSeconds: number;
}

/** One demo rider. */
export interface RiderScript {
  /** "Rider A", never a person's name. */
  readonly label: string;
  readonly kit: DemoKit;
  /**
   * Where on the route the rider starts. A group is spread out along the road
   * so that no two markers are drawn on top of each other.
   */
  readonly startMetres: number;
  readonly segments: readonly ScriptSegment[];
}

/** One stretch of a preset's road, at a constant nominal gradient. */
export interface RouteSection {
  readonly lengthMetres: number;
  readonly gradePercent: number;
}

/** A preset: its road and its riders. The first rider is the lead, whose numbers fill the HUD. */
export interface DemoPreset {
  readonly id: DemoPresetId;
  readonly route: readonly RouteSection[];
  readonly riders: readonly RiderScript[];
}

/**
 * The value a field of a script may hold: a number or a boolean anywhere, and a
 * string only under the three keys that name a label, a kit or a preset.
 *
 * ⚠️ A string anywhere else maps to `never`. An activity id and an athlete id
 * are both strings in this program, so "scalars only" — `pacing.ts`'s rule —
 * would let `activityId: string` through; this does not.
 *
 * ⚠️ `label` has to be **plain** `string` (`string extends V`), so a branded id
 * type cannot be smuggled in under it either.
 */
type SyntheticField<K, V> = V extends number | boolean
  ? V
  : K extends 'label'
    ? string extends V
      ? V
      : never
    : K extends 'kit'
      ? V extends DemoKit
        ? V
        : never
      : K extends 'id'
        ? V extends DemoPresetId
          ? V
          : never
        : never;

/** Every field of `T` is a {@link SyntheticField}: no array and no nested object. */
export type SyntheticInput<T> = { readonly [K in keyof T]: SyntheticField<K, T[K]> };

/**
 * A list whose every element is a {@link SyntheticInput}; anything else is
 * `never`. The check runs in the constraint's direction
 * (`S extends SyntheticInput<S>`), for the reason `pacing.ts`
 * §`AssertSynthetic` gives: the other direction is always true, because a
 * rejected field becomes `never` and `never` is assignable to everything.
 */
type SyntheticList<V> = V extends readonly (infer S)[]
  ? [S] extends [SyntheticInput<S>]
    ? V
    : never
  : never;

/**
 * A rider script: {@link SyntheticInput} fields, plus one list — `segments` —
 * whose elements are themselves synthetic.
 */
export type SyntheticScript<T> = {
  readonly [K in keyof T]: K extends 'segments' ? SyntheticList<T[K]> : SyntheticField<K, T[K]>;
};

/** A preset: synthetic fields plus two lists, `route` and `riders`, each checked in turn. */
export type SyntheticPreset<T> = {
  readonly [K in keyof T]: K extends 'route'
    ? SyntheticList<T[K]>
    : K extends 'riders'
      ? T[K] extends readonly (infer R)[]
        ? [R] extends [SyntheticScript<R>]
          ? T[K]
          : never
        : never
      : SyntheticField<K, T[K]>;
};

/** Applies {@link SyntheticScript} as a constraint, which is what makes a breach an error. */
export type AssertSyntheticScript<T extends SyntheticScript<T>> = T;

/** Applies {@link SyntheticPreset} as a constraint. */
export type AssertSyntheticPreset<T extends SyntheticPreset<T>> = T;

/** Fails to compile with `TS2344` if {@link RiderScript} gains a field that could carry a recording. */
export type RiderScriptIsSynthetic = AssertSyntheticScript<RiderScript>;

/** The same for a whole {@link DemoPreset}, its road included. */
export type DemoPresetIsSynthetic = AssertSyntheticPreset<DemoPreset>;

/** What a script says a rider is doing at one ride time. */
export interface ScriptedSample {
  readonly watts: Watts;
  readonly cadence: number;
  readonly heartRate: number;
}

/** Linear ease from `from` to `to`, `elapsed` seconds into an ease of `over` seconds. */
function eased(from: number, to: number, elapsed: number, over: number): number {
  if (over <= 0 || elapsed >= over) return to;
  return from + ((to - from) * elapsed) / over;
}

/**
 * What the script says at this ride time.
 *
 * The segment that contains `rideSeconds` is the first whose `untilSeconds` is
 * after it; past the last, the last is held. Each value moves in a straight
 * line from the previous segment's target to this one's over `easeSeconds`,
 * starting where the previous segment ended. The first segment starts from its
 * own targets, so a script opens at its first numbers rather than easing in
 * from zero.
 *
 * Pure and closed-form: no state, no clock.
 *
 * @throws {RangeError} for a script with no segments.
 */
export function scriptedSample(script: RiderScript, rideSeconds: Seconds): ScriptedSample {
  const { segments } = script;
  let index = segments.findIndex((segment) => rideSeconds < segment.untilSeconds);
  if (index === -1) index = segments.length - 1;
  const segment = segments[index];
  if (segment === undefined) {
    throw new RangeError(`a demo rider's script must have at least one segment`);
  }
  const previous = segments[index - 1] ?? segment;
  const startedAt = index === 0 ? 0 : previous.untilSeconds;
  const elapsed = rideSeconds - startedAt;
  const ease = (pick: (each: ScriptSegment) => number): number =>
    eased(pick(previous), pick(segment), elapsed, segment.easeSeconds);
  return {
    watts: watts(ease((each) => each.wattsPerKilogram) * BOT_MASS_KILOGRAMS),
    cadence: ease((each) => each.cadenceRpm),
    heartRate: ease((each) => each.heartRateBpm),
  };
}
