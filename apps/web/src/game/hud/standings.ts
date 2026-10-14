// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A race's live standings, as the HUD words them** — #1347,
 * [ADR 0051](../../../../../docs/adr/0051-live-race-standings.md).
 *
 * The owner's ruling of 2026-10-14: *"for racing it should show a list of
 * people that are racing. It should include how far back each person is in
 * time and show real time w/kg"*. So every rider in the room's newest frame,
 * in order along the route, each with their public name, the room's time gap
 * to YOU and their live W/kg. This file is pure: numbers in, words out.
 * `HudPanel.tsx` §`RaceStandings` is the component.
 *
 * ## Decisions this file carries (ADR 0051 D-2 to D-5)
 *
 * - **The gap is to you**, never to the rider in front of each row: a rider
 *   reads one number per row and it is always about the same person — how far
 *   back (or up the road) each rider is from where you are now. Your own row
 *   says *You*. The room measures it (`apps/instance` §`room.ts`
 *   `gapDeciseconds`); nothing here derives one from distances.
 * - **W/kg, never watts** (ADR 0028's 2026-09-22 rule, ruling Q17). A rider
 *   the room is coasting — their reports stopped or were refused, which is
 *   what a dropped rider looks like — shows **No power** rather than 0.0 W/kg,
 *   because 0.0 says they stopped pedalling and the room cannot know that.
 * - **A plausibility flag stays visible**: *Flagged* on their row, as the
 *   result page flags them after the race.
 * - **Everybody is in the list; a window of it is drawn.** {@link STANDINGS_DRAWN}
 *   rows around yours are drawn, each with its place, so a sighted rider sees
 *   where they are in the whole field; every other row stays in the document,
 *   visually hidden by clip, so a screen reader reads the whole field when it
 *   goes to the list. The list is **not** a live region: it is read on
 *   request, never announced every second (#1347 criterion 6).
 */

import { FLAG_COASTING, FLAG_PLAUSIBILITY, MAXIMUM_GAP_DECISECONDS } from '@onyourleft/protocol';

import type { RoomStanding } from '../../net/room-session';

/** How many rows of the standings are drawn: yours and two either side. */
export const STANDINGS_DRAWN = 5;

/**
 * How many of those a PHONE draws: yours and one either side. `theme.css`
 * §"THE RACE'S STANDINGS ON A PHONE" clips the other two drawn rows on a
 * phone, where five rows were measured running onto the actions panel
 * (`ride.browser.spec.ts` §"#1347").
 */
export const STANDINGS_DRAWN_ON_A_PHONE = 3;

/** The list's accessible name. ⚠️ Draft wording awaiting the owner's approval (#1347). */
export const STANDINGS_LABEL = 'Race standings';

/** What the gap cell says on your own row. */
export const OWN_GAP_TEXT = 'You';

/** What the W/kg cell says for a rider the room is coasting. */
export const NO_POWER_TEXT = 'No power';

/** What a flagged rider's row adds. */
export const FLAGGED_TEXT = 'Flagged';

/** One row, worded. */
export interface StandingLine {
  readonly riderId: number;
  /** 1 for the rider furthest along. */
  readonly place: number;
  readonly name: string;
  /** Short, as drawn: `+12 s`, `−1:05`, `You`. */
  readonly gap: string;
  /** The same, in words, for a screen reader: `12 seconds behind you`. */
  readonly gapSpoken: string;
  /** `3.2 W/kg`, or {@link NO_POWER_TEXT}. */
  readonly wattsPerKilogram: string;
  readonly flagged: boolean;
  readonly own: boolean;
  /** Whether the row is in the drawn window; the rest are visually hidden. */
  readonly drawn: boolean;
  /** Whether the row is in the phone's smaller window, {@link STANDINGS_DRAWN_ON_A_PHONE}. */
  readonly near: boolean;
}

const MINUS = '−';

/** `12 s`, `1:05`, or `1 h or more` at the bound. Whole seconds. */
function magnitude(seconds: number): string {
  if (seconds * 10 >= MAXIMUM_GAP_DECISECONDS) return '1 h or more';
  const whole = Math.round(seconds);
  if (whole < 60) return `${String(whole)} s`;
  const minutes = Math.floor(whole / 60);
  return `${String(minutes)}:${String(whole % 60).padStart(2, '0')}`;
}

function spokenMagnitude(seconds: number): string {
  if (seconds * 10 >= MAXIMUM_GAP_DECISECONDS) return 'an hour or more';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const part = (count: number, unit: string): string =>
    `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
  if (minutes === 0) return part(rest, 'second');
  return rest === 0
    ? part(minutes, 'minute')
    : `${part(minutes, 'minute')} ${part(rest, 'second')}`;
}

/** The gap as drawn: positive (behind you) is `+`, ahead is `−`, level is `0 s`. */
export function gapText(seconds: number): string {
  const whole = Math.round(Math.abs(seconds));
  if (whole === 0) return '0 s';
  return `${seconds > 0 ? '+' : MINUS}${magnitude(Math.abs(seconds))}`;
}

/** The gap in words. */
export function gapSpokenText(seconds: number): string {
  if (Math.round(Math.abs(seconds)) === 0) return 'level with you';
  return `${spokenMagnitude(Math.abs(seconds))} ${seconds > 0 ? 'behind you' : 'ahead of you'}`;
}

/** W/kg to one decimal, or {@link NO_POWER_TEXT} for a coasted rider. */
export function wattsPerKilogramText(standing: RoomStanding): string {
  if ((standing.flags & FLAG_COASTING) !== 0) return NO_POWER_TEXT;
  return `${standing.wattsPerKilogram.toFixed(1)} W/kg`;
}

/**
 * The window of {@link STANDINGS_DRAWN} rows to draw: centred on your own
 * row, slid to stay inside the list. With no own row (a frame that did not
 * carry you), the top of the list.
 */
function drawnWindow(
  count: number,
  ownIndex: number,
  rows: number,
): { start: number; end: number } {
  const size = Math.min(rows, count);
  const centre = ownIndex < 0 ? 0 : ownIndex;
  const start = Math.max(0, Math.min(centre - Math.floor(rows / 2), count - size));
  return { start, end: start + size };
}

/** Every row of the standings, worded, in the order the room's frame put them. */
export function standingLines(standings: readonly RoomStanding[]): readonly StandingLine[] {
  const ownIndex = standings.findIndex((standing) => standing.own);
  const { start, end } = drawnWindow(standings.length, ownIndex, STANDINGS_DRAWN);
  const phone = drawnWindow(standings.length, ownIndex, STANDINGS_DRAWN_ON_A_PHONE);
  return standings.map((standing, index) => ({
    riderId: standing.riderId,
    place: index + 1,
    name: standing.name,
    gap: standing.own ? OWN_GAP_TEXT : gapText(standing.gapSeconds),
    gapSpoken: standing.own ? 'you' : gapSpokenText(standing.gapSeconds),
    wattsPerKilogram: wattsPerKilogramText(standing),
    flagged: (standing.flags & FLAG_PLAUSIBILITY) !== 0,
    own: standing.own,
    drawn: index >= start && index < end,
    near: index >= phone.start && index < phone.end,
  }));
}
