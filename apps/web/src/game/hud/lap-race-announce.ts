// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A solo lap race, through the HUD's one live region — #1904 (epic #1894,
 * ADR 0060), on `hud/delivery-announce.ts`'s pattern.
 *
 * Since #1906 `lap-race/ride-race.ts` owes each tick's changes here, and
 * `GameView` offers {@link lapRaceEvents} to the region on every frame.
 *
 * ## What it decides
 *
 * The five things a race says — the rider's **finish**, a **hit** taken, a
 * **lap** done, an **item** gained and a **change of place** — and which of
 * them is still **owed**. `announce.ts` ranks them (rank 5h) and drops a
 * lower event behind a higher one in the same window, so, on #647's "owed"
 * rule, the caller offers {@link lapRaceEvents} on every call and hands back
 * what the core said through {@link lapRaceSpoken}: a sentence is owed until
 * it is said. Each tick of the race goes through {@link oweRaceTick}, which
 * reads what changed for the rider between two states of the race.
 *
 * ## Owed is never a queue
 *
 * At most ONE sentence per kind is owed, and each says the race as it stands
 * when it is said: the latest lap done, the latest hit, the item held now (an
 * item used before it was said is not said at all, because it is gone), and
 * the place now. So what is owed is bounded by five sentences however fast a
 * race goes. **The finish supersedes everything owed before it** and is the
 * race's last word: it carries the place and the time, and after it nothing
 * more is owed.
 *
 * ## The place, rate-limited
 *
 * A close race changes places every second. A change of place is said at
 * most once every {@link PLACE_ANNOUNCE_SECONDS}, on top of the core's own
 * one sentence per window, and only when the place differs from the last one
 * said: a rider passed and passing back inside the interval hears nothing,
 * because nothing changed. A lap's sentence says the place too, so it counts
 * as one. `lap-race-hud.a11y.test.tsx` overtakes five times in two seconds
 * and reads the live region back.
 *
 * ## No place in words
 *
 * A place here is a place in the field — "2 of 4" — never a place on a map.
 * Nothing this module is handed carries a coordinate or a place name
 * (`lap-race-hud.ts` §"What it is handed").
 *
 * ## The words are this project's own (ADR 0060 D-1), for the owner's approval
 *
 * Every sentence below is new rider-facing wording, proposed in #1904's pull
 * request. The place is said as a room's standings say it
 * (`room-ride.ts` §`STANDINGS_TEXT`), and the time as a lap's is
 * (`lap-text.ts` §`spokenDuration`).
 *
 * Pure: no clock (`now` is the caller's, in seconds), no state of its own.
 */

import { ITEM_RULES, type ItemKind, type ItemRaceState, type LapRacer } from '@onyourleft/domain';

import { STANDINGS_TEXT } from '../room-ride';

import type { AnnouncementEvent, AnnouncementKind } from './announce';
import { ITEM_TEXT, racePlace, riderEntry } from './lap-race-hud';
import { spokenDuration } from './lap-text';

/**
 * A change of place is said at most once in this many seconds: 10. A
 * judgement — long enough that a pack swapping places is not a stream of
 * sentences, short enough that a place held is heard within a lap's minute or
 * so — stated as one.
 */
export const PLACE_ANNOUNCE_SECONDS = 10;

/** A hit the rider took: by a gust, through a puddle, or kept off by a rain cape. */
export type LapRaceHit = 'crosswind-gust' | 'puddle' | 'caped';

/** What is still to be said about the race. One sentence per kind at most. */
export interface LapRaceOwed {
  /** The instant the race started, on the race's clock: what the finish time is counted from. */
  readonly startMs: number;
  /** How many laps the race is. */
  readonly laps: number;
  /** The latest lap done, until it is said. */
  readonly lap: number | undefined;
  /** The latest hit, until it is said. */
  readonly hit: LapRaceHit | undefined;
  /** The item gained and still held, until it is said. */
  readonly item: ItemKind | undefined;
  /** The finish's sentence, once the rider is over the line and until it is said. */
  readonly finish: string | undefined;
  /** The rider's place now, and the field's size. */
  readonly place: number;
  readonly of: number;
  /** The place last said, and when on the caller's clock (seconds); `undefined` before any. */
  readonly saidPlace: number;
  readonly placeSaidAt: number | undefined;
}

/** Nothing owed: a race on the line, with the place it starts in taken as said. */
export function lapRaceOwedAtStart(race: ItemRaceState, riderId: string): LapRaceOwed {
  const { place, of } = racePlace(race, riderId);
  return {
    startMs: race.atMs,
    laps: race.course.laps,
    lap: undefined,
    hit: undefined,
    item: undefined,
    finish: undefined,
    place,
    of,
    saidPlace: place,
    placeSaidAt: undefined,
  };
}

/** Effects that began at `atMs` and take offset away: hits. */
function hitsAt(entry: LapRacer, atMs: number): readonly number[] {
  return entry.effects
    .filter((effect) => effect.fromMs === atMs && effect.rateMetresPerSecond < 0)
    .map((effect) => effect.rateMetresPerSecond);
}

/** The hit the rider took in the tick from `before` to `after`, if any. */
function hitTaken(before: LapRacer, after: LapRacer, atMs: number): LapRaceHit | undefined {
  const fresh = hitsAt(after, atMs).length - hitsAt(before, atMs).length;
  if (fresh > 0) {
    // A gust and a puddle in one tick is said as the gust, the harder of the two.
    return hitsAt(after, atMs).includes(ITEM_RULES['crosswind-gust'].rateMetresPerSecond)
      ? 'crosswind-gust'
      : 'puddle';
  }
  // A cape that was still on at this instant and is gone took a hit (`items.ts` §`hit`).
  const caped =
    before.capeUntilMs !== null && before.capeUntilMs > atMs && after.capeUntilMs === null;
  return caped ? 'caped' : undefined;
}

/** `You are 2 of 4.`, as a room's standings say a place. */
function placeSentence(owed: LapRaceOwed): string {
  return STANDINGS_TEXT.summary(owed.place, owed.of);
}

/**
 * Owe whatever changed for the rider in one tick of the race, from `before`
 * to `after`. `used` is whether the rider asked to use their item this tick,
 * so an item used and another drawn in the same tick is still said. After the
 * finish nothing more is owed.
 */
export function oweRaceTick(
  owed: LapRaceOwed,
  before: ItemRaceState,
  after: ItemRaceState,
  riderId: string,
  used: boolean,
): LapRaceOwed {
  const was = riderEntry(before, riderId);
  if (owed.finish !== undefined || was.racer.finishedAtMs !== null) return owed;
  const now = riderEntry(after, riderId);
  const { place, of } = racePlace(after, riderId);
  if (was.racer.finishedAtMs === null && now.racer.finishedAtMs !== null) {
    const time = spokenDuration((now.racer.finishedAtMs - owed.startMs) / 1_000);
    return {
      ...owed,
      lap: undefined,
      hit: undefined,
      item: undefined,
      place,
      of,
      // The finish says the place, and is the last word: no place is owed after it.
      saidPlace: place,
      finish: `Finished, ${String(place)} of ${String(of)}, in ${time}.`,
    };
  }
  const gained =
    now.held !== null && now.pickUpsPassed > was.pickUpsPassed && (was.held === null || used);
  const item = gained ? now.held : owed.item === now.held ? owed.item : undefined;
  return {
    ...owed,
    lap: now.racer.lapsDone > was.racer.lapsDone ? now.racer.lapsDone : owed.lap,
    hit: hitTaken(was, now, after.atMs) ?? owed.hit,
    item: item ?? undefined,
    place,
    of,
  };
}

/** What to offer `announce.ts` at `now` (seconds): one event per kind owed. */
export function lapRaceEvents(owed: LapRaceOwed, now: number): readonly AnnouncementEvent[] {
  const events: AnnouncementEvent[] = [];
  if (owed.finish !== undefined) {
    events.push({ kind: 'lap-race-finish', text: owed.finish });
    return events;
  }
  if (owed.hit !== undefined) {
    events.push({
      kind: 'lap-race-hit',
      text:
        owed.hit === 'caped'
          ? 'Your rain cape kept off a hit.'
          : owed.hit === 'puddle'
            ? 'Rode through a puddle.'
            : 'Hit by a crosswind gust.',
    });
  }
  if (owed.lap !== undefined) {
    const last = owed.lap === owed.laps - 1 ? ' Last lap.' : '';
    events.push({
      kind: 'lap-race-lap',
      text: `Lap ${String(owed.lap)} of ${String(owed.laps)} done.${last} ${placeSentence(owed)}`,
    });
  }
  if (owed.item !== undefined) {
    events.push({ kind: 'lap-race-item', text: `You have ${ITEM_TEXT[owed.item].said}.` });
  }
  const due = owed.placeSaidAt === undefined || now - owed.placeSaidAt >= PLACE_ANNOUNCE_SECONDS;
  if (owed.place !== owed.saidPlace && due) {
    events.push({ kind: 'lap-race-place', text: placeSentence(owed) });
  }
  return events;
}

/**
 * What is still owed once the core has said `kind` at `now` — the `kind` its
 * `Announcement` came back with, `undefined` when it said nothing. Only the
 * kind said is settled; a lap's sentence, which says the place, settles the
 * place too.
 */
export function lapRaceSpoken(
  owed: LapRaceOwed,
  kind: AnnouncementKind | undefined,
  now: number,
): LapRaceOwed {
  switch (kind) {
    case 'lap-race-finish':
      return { ...owed, finish: undefined };
    case 'lap-race-hit':
      return { ...owed, hit: undefined };
    case 'lap-race-lap':
      return { ...owed, lap: undefined, saidPlace: owed.place, placeSaidAt: now };
    case 'lap-race-item':
      return { ...owed, item: undefined };
    case 'lap-race-place':
      return { ...owed, saidPlace: owed.place, placeSaidAt: now };
    default:
      return owed;
  }
}
