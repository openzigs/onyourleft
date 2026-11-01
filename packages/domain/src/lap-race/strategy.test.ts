// SPDX-License-Identifier: Apache-2.0

/**
 * #1959: the bots' strategy. Decisions read back through the race they feed
 * (`stepRace`), as a solo race feeds them; races on the one physics, where the
 * skill and the power traces are compared, are
 * `packages/physics/src/lap-race-bot.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';

import { botDecision } from './bots';
import { createItemRace, stepRace } from './item-race';
import {
  GUST_REACH_METRES,
  pickUpsPassed,
  STARTING_LANE,
  type ItemKind,
  type ItemRaceState,
  type LapRacer,
  type OffsetEffect,
} from './items';
import { RACE_OFFSET_BOUND_METRES, raceCourse, type RaceCourse } from './race';
import {
  BOT_FINISH_WINDOW_METRES,
  BOT_LANE_DWELL_MS,
  BOT_MEMORY_AT_START,
  BOT_PERSONALITIES,
  BOT_PUDDLE_REACH_METRES,
  botFieldPersonalities,
  strategicBotDecision,
  type BotMemory,
  type BotPersonality,
  type BotSkill,
  type BotStrategy,
} from './strategy';
import { simulateRace, type Policy, type RaceRun, type Use } from './strategy-testing';

/** Three laps of 1 km: pick-up points at 250, 500 and 750 m into each lap; the last lap from 2 km. */
const COURSE = raceCourse(1_000, 3);

const SEED = 1959;

interface Spec {
  readonly id: string;
  readonly at: number;
  readonly lane?: number;
  readonly held?: ItemKind | null;
  readonly offset?: number;
  readonly capeUntilMs?: number | null;
  readonly effects?: readonly OffsetEffect[];
}

/** A field built by hand at `atMs`, as `bots.test.ts` builds one. */
function field(specs: readonly Spec[], atMs = 5_000, course: RaceCourse = COURSE): ItemRaceState {
  const state = createItemRace({
    course,
    seed: SEED,
    itemsOn: true,
    racerIds: specs.map((spec) => spec.id),
    startMs: atMs,
  });
  return {
    ...state,
    racers: state.racers.map((entry) => {
      const spec = specs.find((candidate) => candidate.id === entry.racer.id) as Spec;
      const offset = spec.offset ?? 0;
      return {
        ...entry,
        racer: { ...entry.racer, effortDistance: spec.at - offset, raceOffset: offset },
        lane: spec.lane ?? STARTING_LANE,
        held: spec.held ?? null,
        capeUntilMs: spec.capeUntilMs ?? null,
        effects: spec.effects ?? [],
        pickUpsPassed: pickUpsPassed(course, spec.at),
      };
    }),
  };
}

/** A rival's puddle on the road. */
function puddle(position: number, lane: number): ItemRaceState['hazards'][number] {
  return { position, lane, ownerId: 'x', untilMs: 1e9, hitIds: [] };
}

function strategy(personality: BotPersonality, skill: BotSkill = 'crafty'): BotStrategy {
  return { personality, skill };
}

/** The bot's decision this tick. */
function decide(
  race: ItemRaceState,
  personality: BotPersonality,
  options: { skill?: BotSkill; memory?: BotMemory; travel?: number; id?: string } = {},
): { readonly use: boolean; readonly lane: number; readonly memory: BotMemory } {
  return strategicBotDecision(
    race,
    options.id ?? 'bot',
    SEED,
    options.travel ?? 0,
    strategy(personality, options.skill),
    options.memory ?? BOT_MEMORY_AT_START,
  );
}

/** A memory that changed lane half a second ago: the dwell keeps the bot where it is. */
const JUST_MOVED = (race: ItemRaceState): BotMemory => ({
  laneSinceMs: race.atMs - 500,
  itemSince: null,
});

describe('item timing: what a use is worth, against what the item is held for', () => {
  it('rides a tailwind only while there is room for it below +B, counting the effects already running', () => {
    const tailwind = (offset: number, effects: readonly OffsetEffect[] = []): boolean =>
      decide(field([{ id: 'bot', at: 100, held: 'tailwind', offset, effects }]), 'aggressive').use;
    expect(tailwind(0)).toBe(true);
    expect(tailwind(9.5)).toBe(false);
    // 3 m now and 6 m still to come from a tailwind running: 1 m of room, not worth it.
    const running: OffsetEffect = { rateMetresPerSecond: 1.5, fromMs: 5_000, untilMs: 9_000 };
    expect(tailwind(3, [running])).toBe(false);
    expect(tailwind(3)).toBe(true);
  });

  it('uses a tow only with a racer within its reach ahead', () => {
    const tow = (gap: number): boolean =>
      decide(
        field([
          { id: 'bot', at: 100, held: 'tow' },
          { id: 'x', at: 100 + gap, lane: 0 },
        ]),
        'defensive',
      ).use;
    expect(tow(10)).toBe(true);
    expect(tow(25)).toBe(false);
  });

  it('holds an opportunist’s gust for two racers in reach in one lane, where an aggressive bot fires at one', () => {
    const one = field([
      { id: 'bot', at: 100, held: 'crosswind-gust' },
      { id: 'x', at: 110 },
    ]);
    const two = field([
      { id: 'bot', at: 100, held: 'crosswind-gust' },
      { id: 'x', at: 110 },
      { id: 'z', at: 100 + GUST_REACH_METRES },
    ]);
    expect(decide(one, 'opportunist').use).toBe(false);
    expect(decide(two, 'opportunist').use).toBe(true);
    expect(decide(one, 'aggressive').use).toBe(true);
    // Two in reach but in two lanes is not a bunch.
    const split = field([
      { id: 'bot', at: 100, held: 'crosswind-gust' },
      { id: 'x', at: 110 },
      { id: 'z', at: 115, lane: 2 },
    ]);
    expect(decide(split, 'opportunist')).toMatchObject({ use: false, lane: 1 });
  });

  it('places a puddle when a rival in its lane is about to reach the next pick-up point, and not just ahead', () => {
    const rival = (at: number, lane = 1): ItemRaceState =>
      field([
        { id: 'bot', at: 200, held: 'puddle' },
        { id: 'x', at, lane },
      ]);
    // The next point is 250 m. Between the bot and it, or close behind the bot: it lies in their way.
    expect(decide(rival(220), 'aggressive').use).toBe(true);
    expect(decide(rival(250 - BOT_PUDDLE_REACH_METRES), 'aggressive').use).toBe(true);
    // Past the point already, or too far short of it to reach it soon.
    expect(decide(rival(260), 'aggressive').use).toBe(false);
    expect(decide(rival(250 - BOT_PUDDLE_REACH_METRES - 1), 'aggressive').use).toBe(false);
    // In another lane, with the dwell keeping the bot in its own: the puddle would miss.
    const other = rival(220, 0);
    expect(decide(other, 'aggressive', { memory: JUST_MOVED(other) }).use).toBe(false);
    // An opportunist waits for two.
    expect(decide(rival(220), 'opportunist').use).toBe(false);
    const two = field([
      { id: 'bot', at: 200, held: 'puddle' },
      { id: 'x', at: 220 },
      { id: 'z', at: 195 },
    ]);
    expect(decide(two, 'opportunist').use).toBe(true);
  });

  it('keeps a defensive leader’s cape until a hit is coming, where an aggressive bot puts it on at the first racer close behind', () => {
    const behind = (gap: number, lane: number): ItemRaceState =>
      field([
        { id: 'bot', at: 300, held: 'rain-cape' },
        { id: 'x', at: 300 - gap, lane },
      ]);
    expect(decide(field([{ id: 'bot', at: 300, held: 'rain-cape' }]), 'defensive').use).toBe(false);
    // In its lane, within a gust's reach: the hit is coming.
    expect(decide(behind(25, 1), 'defensive').use).toBe(true);
    // Close behind in another lane.
    expect(decide(behind(10, 0), 'defensive').use).toBe(false);
    expect(decide(behind(10, 0), 'aggressive').use).toBe(true);
    expect(decide(behind(30, 0), 'aggressive').use).toBe(false);
    // A puddle it will ride into, with the dwell keeping it in the lane.
    const wet = {
      ...field([{ id: 'bot', at: 300, held: 'rain-cape' }]),
      hazards: [puddle(310, 1)],
    };
    expect(decide(wet, 'defensive', { memory: JUST_MOVED(wet) })).toMatchObject({
      use: true,
      lane: 1,
    });
    // Free to move, it rides round it instead, and keeps the cape.
    expect(decide(wet, 'defensive')).toMatchObject({ use: false, lane: 0 });
    // One already on is not put on again.
    const worn = field([
      { id: 'bot', at: 300, held: 'rain-cape', capeUntilMs: 9_000 },
      { id: 'x', at: 290 },
    ]);
    expect(decide(worn, 'defensive').use).toBe(false);
  });

  it('near a pick-up point spends an item a fresh draw beats, and a leader keeps its cape there', () => {
    // At the back of three, 10 m short of the point: a defensive bot's tow, worth nothing now.
    const back = (at: number): ItemRaceState =>
      field([
        { id: 'bot', at, held: 'tow' },
        { id: 'x', at: at + 60, lane: 0 },
        { id: 'z', at: at + 70, lane: 2 },
      ]);
    expect(decide(back(240), 'defensive').use).toBe(true);
    expect(decide(back(200), 'defensive').use).toBe(false);
    // The front's band draws the least, and a leader's cape is its shield.
    const leader = field([
      { id: 'bot', at: 240, held: 'rain-cape' },
      { id: 'x', at: 180, lane: 0 },
      { id: 'z', at: 170, lane: 2 },
    ]);
    expect(decide(leader, 'defensive').use).toBe(false);
  });
});

describe('the last lap and the last call', () => {
  it('lowers every hold to nothing on the last lap, so an opportunist fires at one racer there', () => {
    const one = (at: number): ItemRaceState =>
      field([
        { id: 'bot', at, held: 'crosswind-gust' },
        { id: 'x', at: at + 10 },
      ]);
    expect(decide(one(1_100), 'opportunist').use).toBe(false);
    expect(decide(one(2_100), 'opportunist').use).toBe(true);
  });

  it('spends whatever is held at the last call, worth something or not, and the call grows with the travel', () => {
    const alone = (at: number): ItemRaceState => field([{ id: 'bot', at, held: 'tow' }]);
    expect(decide(alone(2_900), 'defensive').use).toBe(false);
    expect(decide(alone(2_996), 'defensive').use).toBe(true);
    expect(decide(alone(2_900), 'defensive', { travel: 50 }).use).toBe(true);
  });

  it('keeps a crafty bot’s tailwind for the line: the window alone, the last call with a racer to answer it', () => {
    const tailwind = (at: number, rival?: number): boolean =>
      decide(
        field([
          { id: 'bot', at, held: 'tailwind' },
          ...(rival === undefined ? [] : [{ id: 'x', at: rival, lane: 0 }]),
        ]),
        'aggressive',
      ).use;
    expect(tailwind(2_800)).toBe(false);
    expect(tailwind(3_000 - BOT_FINISH_WINDOW_METRES + 5)).toBe(true);
    // Level with it, or within a tow's reach behind: kept for the last call.
    expect(tailwind(2_965, 2_965)).toBe(false);
    expect(tailwind(2_965, 2_950)).toBe(false);
    expect(tailwind(2_965, 2_940)).toBe(true);
    expect(tailwind(2_996, 2_996)).toBe(true);
    // Before the last lap a tailwind goes as soon as there is room for it.
    expect(tailwind(1_100)).toBe(true);
  });
});

describe('lanes: a score per lane, and a dwell', () => {
  it('moves out of the lane of a racer close behind, and stays put holding a cape, which it puts on', () => {
    const chased = (held: ItemKind | null): ItemRaceState =>
      field([
        { id: 'bot', at: 100, held },
        { id: 'x', at: 92 },
      ]);
    expect(decide(chased(null), 'defensive').lane).not.toBe(1);
    expect(decide(chased('rain-cape'), 'defensive')).toEqual({
      use: true,
      lane: 1,
      // Used, so its judgement of that item is forgotten.
      memory: { laneSinceMs: null, itemSince: null },
    });
  });

  it('picks the lane with fewer puddles over the next spacing, as far ahead as a crafty bot sees', () => {
    const wet = (hazards: ItemRaceState['hazards']): ItemRaceState => ({
      ...field([{ id: 'bot', at: 100 }]),
      hazards,
    });
    // 100 m ahead: beyond the #1900 bot's 15 m, inside a crafty bot's quarter lap.
    expect(decide(wet([puddle(200, 1)]), 'defensive').lane).not.toBe(1);
    // Beyond the quarter lap, it rides on.
    expect(decide(wet([puddle(400, 1)]), 'defensive').lane).toBe(1);
    // Two in its lane, two in lane 0, one in lane 2: lane 2.
    expect(
      decide(
        wet([puddle(150, 1), puddle(160, 1), puddle(170, 0), puddle(180, 0), puddle(190, 2)]),
        'defensive',
      ).lane,
    ).toBe(2);
    // Its own puddle is no hazard to it.
    const own = wet([{ ...puddle(200, 1), ownerId: 'bot' }]);
    expect(decide(own, 'defensive').lane).toBe(1);
  });

  it('holding a puddle, sits in the lane of the racer behind who is about to reach the point', () => {
    const race = field([
      { id: 'bot', at: 200, held: 'puddle' },
      { id: 'x', at: 190, lane: 0 },
    ]);
    // The lane change lands before the items resolve, so the puddle lies in lane 0.
    expect(decide(race, 'aggressive')).toMatchObject({ use: true, lane: 0 });
    const next = stepRace(race, {
      atMs: race.atMs + 1_000,
      effortDistances: { bot: 201, x: 191 },
      lanes: { bot: 0 },
      uses: ['bot'],
    });
    expect(next.hazards).toEqual([
      { position: 250, lane: 0, ownerId: 'bot', untilMs: race.atMs + 31_000, hitIds: [] },
    ]);
    // A defensive bot minds the gust that racer could send up its lane more.
    expect(decide(race, 'defensive').lane).toBe(1);
  });

  it('holding a gust, steers to the bunch, and into the lane of a racer level with it', () => {
    const race = field([
      { id: 'bot', at: 100, held: 'crosswind-gust' },
      { id: 'x', at: 110, lane: 0 },
      { id: 'y', at: 112, lane: 2 },
      { id: 'z', at: 115, lane: 2 },
    ]);
    expect(decide(race, 'opportunist')).toMatchObject({ use: true, lane: 2 });
    const level = field([
      { id: 'bot', at: 100, held: 'crosswind-gust' },
      { id: 'x', at: 100, lane: 2 },
    ]);
    // A target the moment it edges ahead; not one yet.
    expect(decide(level, 'aggressive')).toMatchObject({ use: false, lane: 2 });
  });

  it.each([1_000, 250, 50])(
    'changes lane at most once per dwell with a racer weaving behind it, on %s ms ticks',
    (tickMs) => {
      let race = createItemRace({
        course: COURSE,
        seed: SEED,
        itemsOn: false,
        racerIds: ['bot', 'x'],
        startMs: 0,
      });
      let memory = BOT_MEMORY_AT_START;
      const changes: number[] = [];
      for (let tick = 1; tick * tickMs <= 60_000; tick += 1) {
        const decision = strategicBotDecision(
          race,
          'bot',
          SEED,
          (8 * tickMs) / 1_000,
          strategy('defensive'),
          memory,
        );
        memory = decision.memory;
        const bot = race.racers.find((entry) => entry.racer.id === 'bot') as LapRacer;
        const atMs = tick * tickMs;
        // The weaver rides 8 m behind and moves into the bot's lane every tick.
        race = stepRace(race, {
          atMs,
          effortDistances: { bot: (8 * atMs) / 1_000 + 8, x: (8 * atMs) / 1_000 },
          lanes: { bot: decision.lane, x: bot.lane },
        });
        if (decision.lane !== bot.lane) changes.push(atMs);
      }
      // It does move, again and again...
      expect(changes.length).toBeGreaterThan(5);
      // ...and never twice within one dwell.
      const gaps = changes.slice(1).map((at, index) => at - (changes[index] as number));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(BOT_LANE_DWELL_MS);
    },
  );

  it('misjudges lanes below crafty, once a dwell of race time, however often it is asked', () => {
    /** The instants a lone bot changes lane on an empty road, over two minutes. */
    const wanders = (skill: BotSkill, tickMs: number): number[] => {
      let race = createItemRace({
        course: COURSE,
        seed: SEED,
        itemsOn: false,
        racerIds: ['bot'],
        startMs: 0,
      });
      let memory = BOT_MEMORY_AT_START;
      const changes: number[] = [];
      for (let atMs = tickMs; atMs <= 120_000; atMs += tickMs) {
        const decision = strategicBotDecision(
          race,
          'bot',
          SEED,
          1,
          strategy('opportunist', skill),
          memory,
        );
        memory = decision.memory;
        if (decision.lane !== race.racers[0]?.lane) changes.push(race.atMs);
        race = stepRace(race, {
          atMs,
          effortDistances: { bot: (8 * atMs) / 1_000 },
          lanes: { bot: decision.lane },
        });
      }
      return changes;
    };
    expect(wanders('crafty', 1_000)).toEqual([]);
    const naive = wanders('naive', 1_000);
    expect(naive.length).toBeGreaterThan(5);
    // Drawn per span of race time, not per tick: four times the ticks, the same wandering.
    expect(wanders('naive', 250)).toEqual(naive);
  });
});

describe('holding: a defensive leader’s cape absorbs the hit the #1900 bot wastes its cape before', () => {
  /**
   * A defensive leader with a cape at 270 m, and a rival with a gust 10 m
   * behind in the next lane. The rival sits there for 20 s, moves into the
   * leader's lane, and sends its gust two ticks later.
   */
  function scripted(
    seed: number,
    decideFor: (race: ItemRaceState) => { use: boolean; lane: number },
  ): {
    readonly absorbed: boolean;
    readonly wasted: boolean;
    readonly hit: boolean;
  } {
    let race = createItemRace({
      course: COURSE,
      seed,
      itemsOn: true,
      racerIds: ['bot', 'x'],
      startMs: 0,
    });
    race = {
      ...race,
      racers: race.racers.map((entry) =>
        entry.racer.id === 'bot'
          ? {
              ...entry,
              racer: { ...entry.racer, effortDistance: 270 },
              held: 'rain-cape',
              pickUpsPassed: 1,
            }
          : {
              ...entry,
              racer: { ...entry.racer, effortDistance: 260 },
              lane: 0,
              held: 'crosswind-gust',
              pickUpsPassed: 1,
            },
      ),
    };
    let absorbed = false;
    let wasted = false;
    let hit = false;
    for (let second = 1; second <= 25; second += 1) {
      const decision = decideFor(race);
      const before = race.racers.find((entry) => entry.racer.id === 'bot') as LapRacer;
      race = stepRace(race, {
        atMs: second * 1_000,
        effortDistances: { bot: 270 + 8 * second, x: 260 + 8 * second },
        lanes: { bot: decision.lane, x: second >= 20 ? before.lane : 0 },
        uses: [...(decision.use ? ['bot'] : []), ...(second === 22 ? ['x'] : [])],
      });
      const after = race.racers.find((entry) => entry.racer.id === 'bot') as LapRacer;
      if (before.capeUntilMs !== null && after.capeUntilMs === null) {
        if (before.capeUntilMs > second * 1_000) absorbed = true;
        else wasted = true;
      }
      if (after.effects.some((effect) => effect.rateMetresPerSecond === -2)) hit = true;
    }
    return { absorbed, wasted, hit };
  }

  it('over twenty seeds', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      let memory = BOT_MEMORY_AT_START;
      const strategic = scripted(seed, (race) => {
        const decision = strategicBotDecision(race, 'bot', seed, 8, strategy('defensive'), memory);
        memory = decision.memory;
        return decision;
      });
      expect(strategic, `seed ${String(seed)}`).toEqual({
        absorbed: true,
        wasted: false,
        hit: false,
      });
      const reactive = scripted(seed, (race) => botDecision(race, 'bot', seed, 8));
      expect(reactive.absorbed, `seed ${String(seed)}`).toBe(false);
      expect(reactive.wasted, `seed ${String(seed)}`).toBe(true);
    }
  });
});

/** Racers deciding by `policies` over `count` seeded races, memoised: they are the slow part. */
const runs = new Map<string, readonly RaceRun[]>();
function races(
  key: string,
  count: number,
  policies: (seed: number) => readonly Policy[],
): readonly RaceRun[] {
  const known = runs.get(key);
  if (known !== undefined) return known;
  const made = Array.from({ length: count }, (_, at) => simulateRace(at + 1, policies(at + 1)));
  runs.set(key, made);
  return made;
}

/** The six-bot mixed field every profile is read from: two of each personality, at the solo race's skill. */
function mixedPersonality(seed: number, index: number): BotPersonality {
  return BOT_PERSONALITIES[(index + seed) % BOT_PERSONALITIES.length] as BotPersonality;
}
const mixed = (): readonly RaceRun[] =>
  races('mixed', 1_000, (seed) =>
    Array.from({ length: 6 }, (_, index) => strategy(mixedPersonality(seed, index), 'canny')),
  );
const reactiveField = (): readonly RaceRun[] =>
  races('reactive', 1_000, () => Array.from({ length: 6 }, (): Policy => 'reactive'));

/** The uses a filter keeps, over many races. */
function usesOf(all: readonly RaceRun[], keep: (id: string, seed: number) => boolean): Use[] {
  return all.flatMap((run, at) => run.uses.filter((use) => keep(use.id, at + 1)));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The mean racers hit per gust used. */
function gustHits(uses: readonly Use[]): number {
  return mean(uses.filter((use) => use.kind === 'crosswind-gust').map((use) => use.hits));
}

describe('over a thousand seeded races', { timeout: 60_000 }, () => {
  it('bunching: an opportunist’s gust hits more racers a use than the #1900 bot’s', () => {
    const opportunist = races('opportunist-among-reactive', 1_000, () => [
      strategy('opportunist', 'canny'),
      ...Array.from({ length: 5 }, (): Policy => 'reactive'),
    ]);
    const theirs = gustHits(usesOf(reactiveField(), (id) => id === 'b0'));
    const ours = gustHits(usesOf(opportunist, (id) => id === 'b0'));
    expect(ours).toBeGreaterThan(theirs + 0.1);
  });

  it('last lap: no bot crosses the line holding an item it could have used, where the #1900 bots do', () => {
    expect(mixed().flatMap((run) => run.finishedHolding)).toEqual([]);
    // The check can see one: the reactive rules carry items over the line all the time.
    expect(reactiveField().flatMap((run) => run.finishedHolding).length).toBeGreaterThan(1_000);
    // Every race did finish.
    for (const run of mixed()) {
      const last = run.states[run.states.length - 1] as ItemRaceState;
      expect(last.racers.every((entry) => entry.racer.finishedAtMs !== null)).toBe(true);
    }
  });

  it('personalities: measurably different item-use profiles, every one within ±B', () => {
    const profile = (personality: BotPersonality): { held: number; cape: number; gust: number } => {
      const uses = usesOf(
        mixed(),
        (id, seed) => mixedPersonality(seed, Number(id.slice(1))) === personality,
      );
      return {
        held: mean(uses.map((use) => use.heldMs)),
        cape: mean(uses.filter((use) => use.kind === 'rain-cape').map((use) => use.heldMs)),
        gust: gustHits(uses),
      };
    };
    const aggressive = profile('aggressive');
    const defensive = profile('defensive');
    const opportunist = profile('opportunist');
    // Aggressive fires early: the shortest holds.
    expect(aggressive.held).toBeLessThan(defensive.held - 1_000);
    expect(aggressive.held).toBeLessThan(opportunist.held - 1_000);
    // Defensive keeps its cape: the longest-held capes.
    expect(defensive.cape).toBeGreaterThan(aggressive.cape + 2_000);
    expect(defensive.cape).toBeGreaterThan(opportunist.cape + 2_000);
    // Opportunist waits for bunches: the most racers a gust.
    expect(opportunist.gust).toBeGreaterThan(aggressive.gust + 0.1);
    // D-4's bound, at every tick of every race.
    expect(Math.max(...mixed().map((run) => run.widestOffset))).toBeLessThanOrEqual(
      RACE_OFFSET_BOUND_METRES,
    );
  });
});

describe('what a decision reads, and what it does not', () => {
  it('is the same whatever item or cape another racer holds, which a rider cannot see', () => {
    const run = simulateRace(7, [
      strategy('aggressive', 'canny'),
      strategy('defensive', 'crafty'),
      strategy('opportunist', 'naive'),
      'reactive',
    ]);
    let compared = 0;
    for (const state of run.states.slice(0, 120)) {
      for (const id of ['b0', 'b1', 'b2']) {
        const blind: ItemRaceState = {
          ...state,
          racers: state.racers.map((entry) =>
            entry.racer.id === id ? entry : { ...entry, held: 'crosswind-gust', capeUntilMs: 1e9 },
          ),
        };
        const at = Number(id.slice(1));
        const pick = (race: ItemRaceState): unknown =>
          strategicBotDecision(
            race,
            id,
            7,
            8,
            [
              strategy('aggressive', 'canny'),
              strategy('defensive', 'crafty'),
              strategy('opportunist', 'naive'),
            ][at] as BotStrategy,
            BOT_MEMORY_AT_START,
          );
        expect(pick(blind)).toEqual(pick(state));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(300);
  });

  it('is a pure function of its inputs, draws nothing from the race, and the seed matters', () => {
    const policies: Policy[] = BOT_PERSONALITIES.map((personality) =>
      strategy(personality, 'naive'),
    );
    expect(JSON.stringify(simulateRace(3, policies))).toBe(
      JSON.stringify(simulateRace(3, policies)),
    );
    const race = field([
      { id: 'bot', at: 100, held: 'tailwind' },
      { id: 'x', at: 108 },
    ]);
    const before = JSON.stringify(race);
    decide(race, 'aggressive', { skill: 'naive' });
    expect(JSON.stringify(race)).toBe(before);
    // A naive bot's misjudgements are keyed by the seed: over a race, another seed decides otherwise.
    const decisions = (seed: number): string =>
      JSON.stringify(
        simulateRace(3, policies).states.map((state) =>
          strategicBotDecision(
            state,
            'b0',
            seed,
            8,
            strategy('aggressive', 'naive'),
            BOT_MEMORY_AT_START,
          ),
        ),
      );
    expect(decisions(3)).not.toBe(decisions(4));
  });

  it('remembers when it moved and what it holds, and forgets the item once used', () => {
    const race = field([
      { id: 'bot', at: 100, held: 'puddle' },
      { id: 'x', at: 92 },
    ]);
    const moved = decide(race, 'defensive');
    expect(moved.lane).not.toBe(1);
    expect(moved.memory).toEqual({ laneSinceMs: race.atMs, itemSince: pickUpsPassed(COURSE, 100) });
    const used = decide(field([{ id: 'bot', at: 100, held: 'tailwind' }]), 'defensive');
    expect(used).toEqual({ use: true, lane: 1, memory: { laneSinceMs: null, itemSince: null } });
  });

  it('does nothing once finished, and nothing for an id not in the race, and keeps its memory', () => {
    const race = field([{ id: 'bot', at: 100, lane: 2, held: 'tailwind' }]);
    const finished: ItemRaceState = {
      ...race,
      racers: race.racers.map((entry) => ({
        ...entry,
        racer: { ...entry.racer, finishedAtMs: 1, lineMetres: 3_000 },
      })),
    };
    const memory: BotMemory = { laneSinceMs: 3, itemSince: 0 };
    expect(decide(finished, 'aggressive', { memory })).toEqual({ use: false, lane: 2, memory });
    expect(decide(race, 'aggressive', { id: 'nobody', memory })).toEqual({
      use: false,
      lane: 0,
      memory,
    });
  });

  it('refuses a seed that is not a safe whole number, and a travel that is not metres', () => {
    const race = field([{ id: 'bot', at: 100, held: 'tailwind' }]);
    for (const seed of [Number.NaN, 1.5, 2 ** 53]) {
      expect(() =>
        strategicBotDecision(race, 'bot', seed, 0, strategy('aggressive'), BOT_MEMORY_AT_START),
      ).toThrow(/^seed must be a whole number$/);
    }
    for (const travel of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() => decide(race, 'aggressive', { travel })).toThrow(
        /^travelMetres must be a finite number of metres of at least zero$/,
      );
    }
  });
});

describe('a solo race’s mixed field', () => {
  it('deals the three personalities in turn from a start the seed picks', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const dealt = botFieldPersonalities(seed, 7);
      expect(dealt).toEqual(botFieldPersonalities(seed, 7));
      for (let at = 0; at + 2 < dealt.length; at += 1) {
        expect(new Set(dealt.slice(at, at + 3)).size).toBe(3);
      }
    }
    const firsts = new Set(
      Array.from({ length: 30 }, (_, seed) => botFieldPersonalities(seed, 1)[0]),
    );
    expect(firsts).toEqual(new Set(BOT_PERSONALITIES));
    expect(botFieldPersonalities(5, 0)).toEqual([]);
  });

  it('refuses a seed or a count that is not a whole number', () => {
    expect(() => botFieldPersonalities(1.5, 3)).toThrow(/^seed must be a whole number$/);
    for (const count of [-1, 2.5, Number.NaN]) {
      expect(() => botFieldPersonalities(1, count)).toThrow(
        /^count must be a whole number of at least zero$/,
      );
    }
  });
});
