// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every per-rider figure a race publishes to other riders, built in ONE
 * function** — #785, and ADR 0028's 2026-09-22 amendment.
 *
 * ## The rule this function exists to hold
 *
 * *"For any one rider over any one window, a room publishes the power OR the
 * power-to-weight, never both"* — because `mass = watts ÷ (watts per
 * kilogram)` is one division, so the two side by side ARE the declared mass
 * ADR 0028 Q4 refused to show. Q5 (and ruling Q17) made **W/kg** the published
 * one. So this function has no watts to publish: its input carries none
 * ({@link ResultForPublication} has no field for power), and its output has no
 * field that could hold one.
 *
 * ⚠️ **A flag counts on the same side.** A flag says a rider's best mean over
 * a duration exceeded `ceiling × declared mass`, which bounds the mass for
 * anybody who can also see that rider's power. A flag here is published as the
 * DURATION and the ceiling in **W/kg** — the W/kg side — and never as a power.
 * `publication.test.ts` walks every output, for every rider and every flag, for
 * a power and for a watts figure, and finds neither.
 *
 * ## What else is, and is not, published — ADR 0028 D-6.5
 *
 * A rider's display name (their public projection, `auth/public-athlete.ts`),
 * their place, their time and their W/kg. Never their mass, their location or
 * their other rides. A rider the viewer may not see — they blocked each other,
 * or a moderator suspended them (#83's choke point, `moderation.ts`
 * §`canSee`) — is shown as **"a rider"** with no name, and so is a place
 * whose rider has erased their account (#785, ruling Q2): their row is gone,
 * and the gap it left is all that is shown.
 *
 * ## Who reads it
 *
 * Only the race's participants — an athlete with a result in it (`rooms.ts`
 * §`results`). There is no ranked list anywhere else: not on a profile, not
 * across races, not while a race runs (ADR 0028 D-7.5, D-7.7; ruling Q8).
 */

import { DEFAULT_PLAUSIBILITY_LIMITS } from '@onyourleft/physics';

/** One stored result, as much of it as a publication may read. */
export interface ResultForPublication {
  readonly athleteId: string;
  readonly place: number | null;
  readonly finishMs: number | null;
  readonly wattsPerKilogram: number | null;
  readonly flaggedDurationsSeconds: readonly number[];
}

/** A plausibility flag, as every rider in the race sees it: on the W/kg side, never watts. */
export interface PublishedFlag {
  /** The window it was raised over, in seconds — 5, 60, 1200 or 3600. */
  readonly durationSeconds: number;
  /** The ceiling that window's best mean went over, in W/kg of declared mass. */
  readonly overWattsPerKilogram: number;
}

/** One row of a race's published result. */
export interface PublishedRow {
  /** 1 first; `null` for a rider who did not finish. */
  readonly place: number | null;
  /**
   * The rider's display name, or `null` for "a rider": one who erased their
   * account, or one the viewer may not see.
   */
  readonly displayName: string | null;
  /** Whether this row is the viewer's own. */
  readonly you: boolean;
  /** Milliseconds from the start to the line, or `null`. */
  readonly finishMs: number | null;
  /** Mean power-to-weight over the race, to one decimal — the ONE figure published (Q17). */
  readonly wattsPerKilogram: number | null;
  readonly flags: readonly PublishedFlag[];
}

/** What a race publishes to one of its riders. */
export interface PublishedResult {
  /** Finishers by place — a gap an erased rider left filled with "a rider" — then everyone who did not finish. */
  readonly rows: readonly PublishedRow[];
}

/** What {@link publishRace} is told about the other riders. */
export interface Viewing {
  readonly viewerAthleteId: string;
  /** The display name the viewer may see for an athlete, or `undefined` for none. */
  readonly nameFor: (athleteId: string) => string | undefined;
}

const CEILINGS = new Map(
  DEFAULT_PLAUSIBILITY_LIMITS.ceilings.map((ceiling) => [
    ceiling.durationSeconds,
    ceiling.wattsPerKilogram,
  ]),
);

function oneDecimal(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

function flagsOf(durations: readonly number[]): PublishedFlag[] {
  return durations.flatMap((durationSeconds) => {
    const ceiling = CEILINGS.get(durationSeconds);
    return ceiling === undefined ? [] : [{ durationSeconds, overWattsPerKilogram: ceiling }];
  });
}

/**
 * THE publication: every per-rider figure other riders are shown about a race.
 * Named fields only — a stored row is never spread into what is published.
 *
 * @param finishers how many riders crossed the line (`room_course.finishers`),
 * so an erased rider who finished LAST is still a place, as "a rider".
 */
export function publishRace(
  results: readonly ResultForPublication[],
  viewing: Viewing,
  finishers = 0,
): PublishedResult {
  const row = (result: ResultForPublication): PublishedRow => {
    const you = result.athleteId === viewing.viewerAthleteId;
    return {
      place: result.place,
      displayName: viewing.nameFor(result.athleteId) ?? null,
      you,
      finishMs: result.finishMs,
      wattsPerKilogram: oneDecimal(result.wattsPerKilogram),
      flags: flagsOf(result.flaggedDurationsSeconds),
    };
  };
  const placed = results
    .filter((result) => result.place !== null)
    .sort((a, b) => (a.place as number) - (b.place as number));
  const rows: PublishedRow[] = [];
  let expected = 1;
  // A place with nobody in it: its rider erased their account (ruling Q2).
  // Shown as "a rider" — the place, and nothing that was theirs.
  const nobodyUpTo = (last: number): void => {
    for (; expected <= last; expected += 1) {
      rows.push({
        place: expected,
        displayName: null,
        you: false,
        finishMs: null,
        wattsPerKilogram: null,
        flags: [],
      });
    }
  };
  for (const finisher of placed) {
    const place = finisher.place as number;
    nobodyUpTo(place - 1);
    rows.push(row(finisher));
    expected = place + 1;
  }
  // And after the last place still held, up to how many crossed the line.
  nobodyUpTo(finishers);
  for (const other of results.filter((result) => result.place === null)) rows.push(row(other));
  return { rows };
}
