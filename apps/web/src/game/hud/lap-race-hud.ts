// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race on the HUD — #1904 (epic #1894, ADR 0060 D-1 and D-12): where the
 * rider is in the field, which lap of how many, the item they hold, a warning
 * of a hit coming, and the field's standings.
 *
 * `fields.ts` reads {@link lapRaceReadings} into the HUD's fields, and
 * `HudCore.tsx` classes them; `GameView` supplies `HudInput.lapRace` on a
 * ride running a race (#1906), so an ordinary ride's HUD is unchanged.
 *
 * ## What it is handed, and nothing more
 *
 * The race as `@onyourleft/domain` §`stepRace` returns it, the rider's id in
 * it, each other racer's name and W/kg, and the rider's speed. **Nothing on
 * {@link LapRaceHud} could carry a coordinate or a place**: a race is a course
 * length and distances along it (`RaceCourse`), and the names are the bots'
 * own ({@link botName}). `lap-race-no-place.test.tsx` holds that against the
 * whole rendered HUD and every sentence a race says.
 *
 * ## The two fields
 *
 * *Place* — the rider's place and the field's size, with the lap under it
 * (`lap-text.ts` §`lapOfLaps`), and *Finished* under it once the rider is
 * over the line. *Item* — what the rider holds, or *None*, with a warning
 * under it when a hit is coming ({@link incomingHit}) and *Cape on* while a
 * rain cape is. Two fields, because a phone's secondary tier has height for
 * two rows, and a Delivery round's two fields were measured to fit there
 * (`theme.css` §"A ROOM RIDE ON A PHONE"). With items off there is no item,
 * so there is no *Item* field.
 *
 * ## Not by colour alone (SC 1.4.1)
 *
 * The item is its name and the warning is its words, and a field with a
 * warning on it is drawn with a thick dashed outline (`theme.css` §"A LAP
 * RACE ON THE HUD", {@link HudReading.alert}): a shape, which survives a
 * monochrome screen and a colour-blind eye. No state here is a tint.
 *
 * ## The standings, as a room's (ADR 0051, ADR 0060 D-12.2)
 *
 * The same panel a room's race uses (`RaceStandings.tsx`), windowed the same
 * way (`room-ride.ts` §`windowedStandings`) but for one line: the leader is
 * always the first (#1967, the owner's ruling of 2026-10-31), so a rider at
 * the back of eight still sees who is winning. A solo race reads like a
 * room's: a place, a name, a time gap **to the rider**, and **W/kg, never
 * watts**. Not a live region: ADR 0051 D-7. The time gap is this file's,
 * because there is no room to compute it: the drawn distance between the two
 * over the rider's own speed, the arithmetic `@onyourleft/domain`
 * §`pacerGap` states for a pacer, done here because a drawn distance can be
 * below nought at the start (an offset of −B on the line), which `Metres`
 * cannot hold. A rider at a standstill sees a dash, never a division by
 * nought. Two finished racers are apart by their finish instants.
 *
 * ## The words are this project's own (ADR 0060 D-1), for the owner's approval
 *
 * {@link ITEM_TEXT}, {@link BOT_TIER_TEXT}, the warnings and the field labels
 * are new rider-facing words, proposed in #1904's pull request. No item is
 * named after any game's (D-1.3, D-1.4), and no name here names another game.
 *
 * Pure: no clock, no state.
 */

import {
  GUST_REACH_METRES,
  racePosition,
  standings,
  type BotTier,
  type ItemKind,
  type ItemRaceState,
  type LapRacer,
} from '@onyourleft/domain';

import {
  STANDINGS_TEXT,
  gapText,
  windowedStandings,
  type RaceStandingsView,
  type StandingsLine,
} from '../room-ride';

import { NO_READING, type HudReading } from './fields';
import { lapOfLaps } from './lap-text';

/**
 * What an item is called on the HUD, and how a sentence says it. ⚠️ For the
 * owner's approval.
 *
 * ⚠️ **The HUD's name is ONE word.** *Crosswind gust* was the first cut, and
 * on the CI runner's fonts *Crosswind* alone ran past the *Item* field's
 * value box at every corners layout (PR #1957's first run), where on a Mac it
 * fitted by a pixel (92 px in 93). The widest name now, *Tailwind*, measures
 * 70 px there, under the ghost's *Finished* (73 px), which
 * `hud.browser.spec.ts` lays out at the same word size. A sentence has no
 * width, so it says the item in full. `lap-race-hud.browser.spec.ts` holds
 * every name on the stage, one stage each.
 */
export const ITEM_TEXT: Readonly<
  Record<ItemKind, { readonly name: string; readonly said: string }>
> = {
  tailwind: { name: 'Tailwind', said: 'a tailwind' },
  tow: { name: 'Tow', said: 'a tow' },
  puddle: { name: 'Puddle', said: 'a puddle' },
  'crosswind-gust': { name: 'Gust', said: 'a crosswind gust' },
  'rain-cape': { name: 'Cape', said: 'a rain cape' },
};

/**
 * What a bot tier is called. ⚠️ For the owner's approval.
 */
export const BOT_TIER_TEXT: Readonly<Record<BotTier, string>> = {
  steady: 'Steady',
  brisk: 'Brisk',
  hard: 'Hard',
  fierce: 'Fierce',
};

/**
 * A bot's name in the standings: its tier and its number in the field, `Brisk bot 2`.
 * `lap-race/ride-race.ts` names the field's bots with it when a race starts (#1906).
 */
export function botName(tier: BotTier, number: number): string {
  return `${BOT_TIER_TEXT[tier]} bot ${String(number)}`;
}

/** The HUD's words for a lap race. ⚠️ Draft wording for the owner's approval. */
export const LAP_RACE_TEXT = {
  place: 'Place',
  item: 'Item',
  noItem: 'None',
  finished: 'Finished',
  capeOn: 'Cape on',
  /** {@link IncomingHit}, as the phrase under the item. */
  warning: {
    gust: 'Gust behind you',
    puddle: 'Puddle ahead',
  },
} as const;

/**
 * How far ahead, in the rider's lane, another racer's puddle is warned of:
 * 50 m, about five seconds at a race pace of 36 km/h — time to read it and
 * change lane. Chosen, not measured.
 */
export const PUDDLE_WARNING_METRES = 50;

/** Another racer in the field, as the standings name it. */
export interface LapRaceEntrant {
  /** A bot's name ({@link botName}). Never a place, never a real person's. */
  readonly name: string;
  /** Their live W/kg (a bot's at its fixed mass), or `undefined` for a dash. Never watts. */
  readonly wattsPerKilogram: number | undefined;
}

/** A lap race, as the HUD needs it. */
export interface LapRaceHud {
  /** The race as `stepRace` last returned it. */
  readonly race: ItemRaceState;
  /** The rider's own id in {@link race}. */
  readonly riderId: string;
  /** Every other racer, by id. A racer left out is named {@link STANDINGS_TEXT}'s `unnamed`. */
  readonly entrants: Readonly<Record<string, LapRaceEntrant>>;
  /** The rider's own W/kg, or `undefined` for a dash on their own line. */
  readonly riderWattsPerKilogram: number | undefined;
  /** The rider's speed, in metres per second: what a time gap is expressed at. */
  readonly speedMetresPerSecond: number;
}

/** A hit the rider can still get out of the way of. */
export type IncomingHit = 'gust' | 'puddle';

/** The rider's entry in the race. @throws {Error} when the rider is not in it. */
export function riderEntry(race: ItemRaceState, riderId: string): LapRacer {
  const entry = race.racers.find((each) => each.racer.id === riderId);
  if (entry === undefined) {
    throw new Error('the rider is not in the lap race');
  }
  return entry;
}

/**
 * A hit coming at the rider, from the race as it stands: a racer behind in
 * the rider's lane, within the gust's reach (`items.ts` §`GUST_REACH_METRES`),
 * holding a crosswind gust — **gust** first, because it can land on the next
 * tick; else another racer's puddle lying ahead in the rider's lane, not yet
 * dried and not yet ridden through by the rider, within
 * {@link PUDDLE_WARNING_METRES} — **puddle**. Both are what the bots
 * themselves steer by (`bots.ts` §"The lane rule"), so the rider is told what
 * a bot already knows. `undefined` once the rider has finished: no item
 * reaches a finished racer.
 */
export function incomingHit(race: ItemRaceState, riderId: string): IncomingHit | undefined {
  if (!race.itemsOn) return undefined;
  const me = riderEntry(race, riderId);
  if (me.racer.finishedAtMs !== null) return undefined;
  const at = racePosition(me.racer);
  const gust = race.racers.some((other) => {
    const behind = at - racePosition(other.racer);
    return (
      other.racer.id !== riderId &&
      other.racer.finishedAtMs === null &&
      other.held === 'crosswind-gust' &&
      other.lane === me.lane &&
      behind > 0 &&
      behind <= GUST_REACH_METRES
    );
  });
  if (gust) return 'gust';
  const puddle = race.hazards.some(
    (hazard) =>
      hazard.ownerId !== riderId &&
      hazard.untilMs > race.atMs &&
      hazard.lane === me.lane &&
      !hazard.hitIds.includes(riderId) &&
      hazard.position > at &&
      hazard.position - at <= PUDDLE_WARNING_METRES,
  );
  return puddle ? 'puddle' : undefined;
}

/** The rider's place in the field, 1 for the leader, and the field's size. */
export function racePlace(
  race: ItemRaceState,
  riderId: string,
): { readonly place: number; readonly of: number } {
  const order = standings(race.racers.map((entry) => entry.racer));
  const index = order.indexOf(riderId);
  if (index === -1) {
    throw new Error('the rider is not in the lap race');
  }
  return { place: index + 1, of: order.length };
}

/** The key of the lap race's place field — #1904. */
export const LAP_RACE_PLACE_KEY = 'lap-race-place';

/** The key of the lap race's item field — #1904. */
export const LAP_RACE_ITEM_KEY = 'lap-race-item';

/** Whether a reading is one of a lap race's — #1904. */
export function isLapRaceReading(reading: HudReading): boolean {
  return reading.key.startsWith('lap-race-');
}

/** The lap race's fields, after every other: *Place*, and *Item* with items on. @see the module note */
export function lapRaceReadings(hud: LapRaceHud | undefined): readonly HudReading[] {
  if (hud === undefined) return [];
  const { race, riderId } = hud;
  const me = riderEntry(race, riderId);
  const { place, of } = racePlace(race, riderId);
  const finished = me.racer.finishedAtMs !== null;
  const placeReading: HudReading = {
    key: LAP_RACE_PLACE_KEY,
    label: LAP_RACE_TEXT.place,
    value: String(place),
    unit: `of ${String(of)}`,
    stale: false,
    detail: finished ? LAP_RACE_TEXT.finished : lapOfLaps(me.racer.lapsDone, race.course.laps),
  };
  if (!race.itemsOn) return [placeReading];
  const warning = incomingHit(race, riderId);
  const caped = me.capeUntilMs !== null && me.capeUntilMs > race.atMs;
  const detail =
    warning !== undefined
      ? LAP_RACE_TEXT.warning[warning]
      : caped
        ? LAP_RACE_TEXT.capeOn
        : undefined;
  return [
    placeReading,
    {
      key: LAP_RACE_ITEM_KEY,
      label: LAP_RACE_TEXT.item,
      value: me.held === null ? LAP_RACE_TEXT.noItem : ITEM_TEXT[me.held].name,
      unit: '',
      stale: false,
      word: true,
      ...(detail === undefined ? {} : { detail }),
      ...(warning === undefined ? {} : { alert: true }),
    },
  ];
}

/** The distance a racer is at for a gap: the line for a finished one, its drawn distance otherwise. */
function gapDistance(entry: LapRacer, line: number): number {
  return entry.racer.finishedAtMs === null ? racePosition(entry.racer) : line;
}

/** An entrant's own record, never one inherited from `Object.prototype`. */
function entrant(hud: LapRaceHud, id: string): LapRaceEntrant | undefined {
  return Object.hasOwn(hud.entrants, id) ? hud.entrants[id] : undefined;
}

/** A W/kg as the standings write it, or a dash. */
function powerToWeight(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? NO_READING : `${value.toFixed(1)} W/kg`;
}

/**
 * The field's standings, as a room's panel shows them — every racer in
 * `standings` order, the rider's own line marked, windowed around it with
 * the leader always on the first line (#1967).
 * @see the module note §"The standings"
 */
export function lapRaceStandings(hud: LapRaceHud): RaceStandingsView {
  const { race, riderId } = hud;
  const me = riderEntry(race, riderId);
  const line = race.course.lapLengthMetres * race.course.laps;
  const order = standings(race.racers.map((entry) => entry.racer));
  const index = new Map(race.racers.map((entry, at) => [entry.racer.id, at]));
  const lines = order.map((id, at): StandingsLine => {
    const entry = race.racers[index.get(id) ?? -1] as LapRacer;
    const you = id === riderId;
    const finished = entry.racer.finishedAtMs !== null;
    let gap = '';
    if (!you) {
      const theirs = entry.racer.finishedAtMs;
      const mine = me.racer.finishedAtMs;
      const speed = hud.speedMetresPerSecond;
      const seconds =
        theirs !== null && mine !== null
          ? (theirs - mine) / 1_000
          : speed > 0 && Number.isFinite(speed)
            ? (gapDistance(me, line) - gapDistance(entry, line)) / speed
            : undefined;
      gap = seconds === undefined ? NO_READING : gapText(seconds);
    }
    return {
      riderId: index.get(id) ?? at,
      place: at + 1,
      who: you ? STANDINGS_TEXT.you : (entrant(hud, id)?.name ?? STANDINGS_TEXT.unnamed),
      gap,
      figure: finished
        ? STANDINGS_TEXT.finished
        : powerToWeight(you ? hud.riderWattsPerKilogram : entrant(hud, id)?.wattsPerKilogram),
      flagged: false,
      you,
    };
  });
  return windowedStandings(lines, { keepLeader: true });
}
