// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A group ride on the HUD — #3305 (epic #3296,
 * [ADR 0101](../../../../../docs/adr/0101-the-ai-group-ride.md) D-2.7, D-3.6
 * and D-5): the **role strip**, the **cue line** and the cue's sentence for
 * the announcer. `hud/lap-race-hud.ts` is the pattern.
 *
 * `fields.ts` reads {@link groupRideReadings} into the HUD's fields and
 * `HudCore.tsx` classes them; `GameView` supplies `HudInput.groupRide` on a
 * ride with a group (`group-ride/ride-group.ts` §`groupRideStrip`), so every
 * other ride's HUD is unchanged.
 *
 * ## The role strip: two fields
 *
 * *In line* — the rider's place in the line and the line's size, and under
 * it **the pull's countdown while the rider is on the front and at no other
 * time** (D-3.6), or else the gap to the wheel ahead. *Group* — the group's
 * speed now, and under it the average the rider chose for the ride (D-2.7:
 * two speeds, because the group rides faster than the average on the flat
 * and slower on a climb). Two fields, in a lap race's two places and under
 * its class, because a phone's secondary tier has height for two rows and a
 * race's two were measured to fit there (`theme.css` §"A LAP RACE ON THE
 * HUD"); a ride runs one mode, so the two never meet. On a phone the ghost's
 * gap and the wind give way to them, as they do to a race's.
 *
 * ⚠️ **With no power reading both values are a dash, never a zero** (the
 * epic's safety rule 11, ADR 0101 D-6.11): the cues have stopped and the line
 * is waiting, so a place, a gap or a speed here would be a figure about a
 * rider the ride cannot read. The average under *Group* stays: it is the
 * rider's own choice, not a reading.
 *
 * ⚠️ **The countdown is on the strip only.** The HUD's fields are not a live
 * region, no reading here is in `announce.ts` §`ANNOUNCEABLE_READINGS`, and
 * {@link groupRideCueEvent} is handed a cue and nothing else, so a second
 * ticking down never reaches a screen reader (D-5.3).
 *
 * ## The cue line: one sentence per kind
 *
 * {@link GROUP_RIDE_CUE_TEXT} has exactly one sentence for every kind
 * `@onyourleft/domain` §`CUE_KINDS` can select: the record's type makes a
 * kind without one a type error, and `group-ride-hud.test.ts` walks the list.
 * The line is shown for {@link GROUP_RIDE_CUE_SHOWN_SECONDS} of the group's
 * own clock and then gone; a newer cue replaces it at once. It is drawn as
 * the AI pacer's line is (ADR 0072 D-4, `theme.css` §`.oyl-hud__pacer-say`):
 * a labelled notice, larger than the others.
 *
 * ⚠️ **Every sentence is the build's draft, for the owner's approval** (ADR
 * 0101 D-5.2, Q16). They are the ADR's drafts word for word. None urges more
 * effort, none carries a number, none names a place, and none makes a claim
 * about the rider's body; `group-ride-hud.test.ts` screens every one.
 *
 * ## The announcer
 *
 * A cue is offered to `announce.ts` **once**, on the frame it is selected,
 * as `group-ride-cue`: one rank, below every safety and workout sentence.
 * Not owed: a cue a higher sentence took the window from is dropped, never
 * queued (D-5.5), and it is still on the HUD line.
 *
 * Pure: no clock, no state.
 */

import { metresPerSecond, type CueKind } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatSmallDistance, formatSpeed } from '../../units/format';

import type { AnnouncementEvent } from './announce';
import { NO_READING, type HudReading } from './fields';

/**
 * The one sentence each cue kind shows and says. ⚠️ For the owner's approval:
 * ADR 0101 D-5.2's drafts, unchanged.
 */
export const GROUP_RIDE_CUE_TEXT: Readonly<Record<CueKind, string>> = {
  'next-up': 'You are next on the front.',
  'your-pull': "Your pull. Hold the group's speed, no faster.",
  'pull-off': 'Pull off now.',
  ease: 'Ease a little and let the line pass.',
  'last-wheel': 'The last wheel is coming. Slot in behind it.',
  'back-in-line': 'Back in the line. Recover.',
  climb: 'Climb ahead. The group holds a steady effort and the speed will drop.',
  regroup: 'The group is easing until you are back.',
  'close-gap': 'A gap has opened. Close it smoothly.',
  surging: "You are above the group's speed. Ease back to it.",
  'past-front': 'You are past the front. Ease and drop back into the line.',
  'eased-too-much': 'You have drifted past the last wheel. Come back to it smoothly.',
  'shorter-pull': 'Next time, try a shorter pull.',
};

/** The cue line's label, as the pacer's line has *Your pacer*. ⚠️ For the owner's approval. */
export const GROUP_RIDE_CUE_LABEL = 'Group ride';

/**
 * How long a cue stays on the HUD line, seconds of the group's clock: **8**,
 * the AI pacer's line's time (`@onyourleft/domain` §`MODEL_PACER_SAY_SHOWN_S`).
 * A feel parameter for the owner's ride.
 */
export const GROUP_RIDE_CUE_SHOWN_SECONDS = 8;

/** The strip's words. ⚠️ For the owner's approval. */
export const GROUP_RIDE_TEXT = {
  line: 'In line',
  group: 'Group',
  pull: (seconds: number): string => `Pull ${String(seconds)} s`,
  gap: (distance: string): string => `Gap ${distance}`,
  target: (speed: string): string => `Target average ${speed}`,
} as const;

/** The key of the strip's place field. */
export const GROUP_RIDE_LINE_KEY = 'group-ride-line';

/** The key of the strip's speed field. */
export const GROUP_RIDE_SPEED_KEY = 'group-ride-speed';

/** Whether a reading is one of a group ride's. */
export function isGroupRideReading(reading: HudReading): boolean {
  return reading.key.startsWith('group-ride-');
}

/**
 * A group ride as the HUD reads it. Numbers and nothing else: **nothing here
 * could carry a coordinate or a place** (ADR 0004 D), as `LapRaceHud` cannot.
 */
export interface GroupRideHud {
  /** The rider's place in the line, 1 on the front; the back while they drift back to it. */
  readonly place: number;
  /** How many are in the line, the rider included. */
  readonly of: number;
  /** Odometer metres to the wheel ahead; `undefined` on the front, or level with or past that wheel. */
  readonly gapMetres: number | undefined;
  /** Whole seconds left of the rider's pull; `undefined` unless they are on the front. */
  readonly pullLeftSeconds: number | undefined;
  /** The group's speed now, m/s. */
  readonly groupSpeed: number;
  /** The average the rider chose for the ride, m/s. */
  readonly targetSpeed: number;
  /** Whether the rider's power reading is live. Without one the strip's values are dashes. */
  readonly live: boolean;
}

/** The gap to the wheel ahead: tenths of a metre, or whole feet. */
function gapText(gapMetres: number, units: UnitSystem): string {
  if (units === 'metric') return `${gapMetres.toFixed(1)} m`;
  const feet = formatSmallDistance(gapMetres, units);
  return `${feet.value} ${feet.unit}`;
}

/** The strip's two fields, after every other; none on a ride with no group. @see the module note */
export function groupRideReadings(
  hud: GroupRideHud | undefined,
  units: UnitSystem,
): readonly HudReading[] {
  if (hud === undefined) return [];
  const under =
    hud.pullLeftSeconds !== undefined
      ? GROUP_RIDE_TEXT.pull(hud.pullLeftSeconds)
      : hud.gapMetres !== undefined && hud.gapMetres > 0
        ? GROUP_RIDE_TEXT.gap(gapText(hud.gapMetres, units))
        : undefined;
  const speed = formatSpeed(metresPerSecond(Math.max(0, hud.groupSpeed)), units, 0);
  const target = formatSpeed(metresPerSecond(Math.max(0, hud.targetSpeed)), units, 0);
  return [
    {
      key: GROUP_RIDE_LINE_KEY,
      label: GROUP_RIDE_TEXT.line,
      value: hud.live ? String(hud.place) : NO_READING,
      unit: `of ${String(hud.of)}`,
      stale: !hud.live,
      ...(hud.live && under !== undefined ? { detail: under } : {}),
    },
    {
      key: GROUP_RIDE_SPEED_KEY,
      label: GROUP_RIDE_TEXT.group,
      value: hud.live ? speed.value : NO_READING,
      unit: speed.unit,
      stale: !hud.live,
      detail: GROUP_RIDE_TEXT.target(target.value),
    },
  ];
}

/**
 * The cue last selected: its kind and when, on the group's clock. Each
 * selection is an object of its own, so a caller tells a new cue from the one
 * it has seen by identity, the same kind selected again included.
 */
export interface GroupRideCueShown {
  readonly kind: CueKind;
  /** When it was selected, seconds of the group's clock. */
  readonly atSeconds: number;
}

/**
 * The cue to keep after a window's answer: the one just selected, or
 * `previous` itself where the window selected none.
 */
export function groupRideCueSelected(
  previous: GroupRideCueShown | undefined,
  selected: { readonly kind: CueKind } | null,
  atSeconds: number,
): GroupRideCueShown | undefined {
  return selected === null ? previous : { kind: selected.kind, atSeconds };
}

/**
 * The sentence on the cue line at `nowSeconds` of the group's clock: the last
 * cue's, for {@link GROUP_RIDE_CUE_SHOWN_SECONDS} from when it was selected,
 * and `undefined` before any and after that.
 */
export function groupRideCueShowing(
  cue: GroupRideCueShown | undefined,
  nowSeconds: number,
): string | undefined {
  if (cue === undefined) return undefined;
  return nowSeconds - cue.atSeconds < GROUP_RIDE_CUE_SHOWN_SECONDS
    ? GROUP_RIDE_CUE_TEXT[cue.kind]
    : undefined;
}

/**
 * What to offer `announce.ts` for the cue: its sentence, **once**, on the
 * first call that sees it, and nothing on every call after. `offered` is the
 * cue last offered, `undefined` before any; the answer's is what the caller
 * keeps.
 */
export function groupRideCueEvent(
  cue: GroupRideCueShown | undefined,
  offered: GroupRideCueShown | undefined,
): {
  readonly event: AnnouncementEvent | undefined;
  readonly offered: GroupRideCueShown | undefined;
} {
  if (cue === undefined || cue === offered) return { event: undefined, offered };
  return { event: { kind: 'group-ride-cue', text: GROUP_RIDE_CUE_TEXT[cue.kind] }, offered: cue };
}
