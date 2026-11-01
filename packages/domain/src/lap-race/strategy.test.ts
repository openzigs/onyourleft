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
  RAIN_CAPE_DURATION_MS,
  STARTING_LANE,
  type ItemKind,
  type ItemRaceState,
  type LapRacer,
  type OffsetEffect,
} from './items';
import { RACE_OFFSET_BOUND_METRES, raceCourse, racePosition, type RaceCourse } from './race';
import {
  BOT_FINISH_WINDOW_METRES,
  BOT_LANE_DWELL_MS,
  BOT_MEMORY_AT_START,
  BOT_PERSONALITIES,
  BOT_PUDDLE_REACH_METRES,
  BOT_RELINE_MS,
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
  linedUp: [],
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
    // A puddle it will ride into whichever lane it takes: it puts the cape on.
    const soaked = {
      ...field([{ id: 'bot', at: 300, lane: 0, held: 'rain-cape' }]),
      hazards: [puddle(310, 0), puddle(310, 1)],
    };
    expect(decide(soaked, 'defensive')).toMatchObject({ use: true, lane: 0 });
    // One it can ride round, it rides round, and keeps the cape.
    const wet = {
      ...field([{ id: 'bot', at: 300, held: 'rain-cape' }]),
      hazards: [puddle(310, 1)],
    };
    expect(decide(wet, 'defensive')).toMatchObject({ use: false, lane: 0 });
    // One already on is not put on again.
    const worn = field([
      { id: 'bot', at: 300, held: 'rain-cape', capeUntilMs: 9_000 },
      { id: 'x', at: 290 },
    ]);
    expect(decide(worn, 'defensive').use).toBe(false);
  });

  it('puts a defensive cape on for a rival lining up behind it, and not for one already sat there', () => {
    const race = field([
      { id: 'bot', at: 300, held: 'rain-cape' },
      { id: 'x', at: 280 },
    ]);
    // x newly within gust reach behind in its lane: a hit is coming.
    expect(decide(race, 'defensive').use).toBe(true);
    // x was there last tick too, and may hold nothing: a defensive bot keeps its cape.
    const satFor = (ms: number): BotMemory => ({
      laneSinceMs: null,
      itemSince: 1,
      linedUp: [{ id: 'x', sinceMs: race.atMs - ms }],
    });
    const sat = satFor(1_000);
    expect(decide(race, 'defensive', { memory: sat }).use).toBe(false);
    expect(decide(race, 'defensive', { memory: satFor(BOT_RELINE_MS - 1) }).use).toBe(false);
    // Sat there for BOT_RELINE_MS, x counts as lining up again (#1986).
    expect(decide(race, 'defensive', { memory: satFor(BOT_RELINE_MS) }).use).toBe(true);
    // Another rival's long sit is not x's: x has sat a second.
    const others: BotMemory = {
      ...sat,
      linedUp: [
        { id: 'y', sinceMs: 0 },
        { id: 'x', sinceMs: race.atMs - 1_000 },
      ],
    };
    expect(decide(race, 'defensive', { memory: others }).use).toBe(false);
    // An aggressive bot puts it on for either.
    expect(decide(race, 'aggressive', { memory: sat }).use).toBe(true);
  });

  it.each([1_000, 250, 50])(
    'answers a rival who sat behind it from the start, BOT_RELINE_MS after they lined up, on %s ms ticks (#1986)',
    (tickMs) => {
      // Wearing one cape, until 3 s, and holding another: a cape drawn while the
      // first was on. x sits 10 m behind in its lane from the first tick, and
      // is still sat there when the first cape has run out.
      let race = field(
        [
          { id: 'bot', at: 300, held: 'rain-cape', capeUntilMs: 3_000 },
          { id: 'x', at: 290 },
        ],
        0,
      );
      let memory = BOT_MEMORY_AT_START;
      let putOnAtMs: number | null = null;
      for (let atMs = 0; atMs <= 10_000 && putOnAtMs === null; atMs += tickMs) {
        const decision = strategicBotDecision(
          race,
          'bot',
          SEED,
          (8 * tickMs) / 1_000,
          strategy('defensive'),
          memory,
        );
        memory = decision.memory;
        // It keeps the lane, and so x stays lined up behind it, remembered from the first tick.
        expect(decision.lane).toBe(1);
        expect(memory.linedUp).toEqual([{ id: 'x', sinceMs: 0 }]);
        if (decision.use) putOnAtMs = atMs;
        const next = atMs + tickMs;
        race = stepRace(race, {
          atMs: next,
          effortDistances: { bot: 300 + (8 * next) / 1_000, x: 290 + (8 * next) / 1_000 },
          lanes: { bot: decision.lane, x: 1 },
          uses: decision.use ? ['bot'] : [],
        });
      }
      // Not while the first cape is on, nor in the seconds after, as before; then, at
      // BOT_RELINE_MS of race time behind it, whatever the tick.
      expect(putOnAtMs).toBe(BOT_RELINE_MS);
      const bot = race.racers.find((entry) => entry.racer.id === 'bot') as LapRacer;
      expect(bot.capeUntilMs).toBe(BOT_RELINE_MS + tickMs + RAIN_CAPE_DURATION_MS);
    },
  );

  it('holding a cape, does not move into the line of a rival behind, where the cape would go at once', () => {
    const ahead = (rival: Spec[]): ItemRaceState => ({
      ...field([{ id: 'bot', at: 300, lane: 0, held: 'rain-cape' }, ...rival]),
      hazards: [puddle(350, 0)],
    });
    // A puddle 50 m ahead in its lane, and a rival 10 m behind in the lane beside it.
    expect(decide(ahead([{ id: 'x', at: 290, lane: 1 }]), 'defensive')).toMatchObject({
      use: false,
      lane: 0,
    });
    // With nobody behind, it rides round the puddle and keeps the cape.
    expect(decide(ahead([]), 'defensive')).toMatchObject({ use: false, lane: 1 });
  });

  it('puts its cape on for a rival lined up behind it as it moves out of their lane, since they can follow', () => {
    // A puddle 50 m ahead in its lane sends it across, out of the line of x behind it.
    const race = {
      ...field([
        { id: 'bot', at: 300, held: 'rain-cape' },
        { id: 'x', at: 290 },
      ]),
      hazards: [puddle(350, 1)],
    };
    expect(decide(race, 'defensive')).toMatchObject({ use: true, lane: 0 });
  });

  it('looks a tick of travel ahead for a puddle its cape must absorb, beyond the fixed look-ahead (#1900)', () => {
    // Puddles 20 m ahead in both lanes it could take: beyond the fixed 15 m, within a 25 m tick.
    const soaked = {
      ...field([{ id: 'bot', at: 100, lane: 0, held: 'rain-cape' }]),
      hazards: [puddle(120, 0), puddle(120, 1)],
    };
    expect(decide(soaked, 'defensive', { travel: 25 })).toMatchObject({ use: true, lane: 0 });
    expect(decide(soaked, 'defensive', { travel: 0 })).toMatchObject({ use: false, lane: 0 });
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

  it('weighs the fresh draw by its own band: at the back, the back’s richer draw beats a gust it holds', () => {
    const gust = (x: number, z: number): ItemRaceState =>
      field([
        { id: 'bot', at: 240, held: 'crosswind-gust' },
        { id: 'x', at: x, lane: 0 },
        { id: 'z', at: z, lane: 2 },
      ]);
    // 10 m short of the point, at the back of three: the back's mean (7.1 m) beats a defensive hold of 5 m.
    expect(decide(gust(300, 310), 'defensive').use).toBe(true);
    // At the front, the front's mean (4.5 m) does not.
    expect(decide(gust(180, 170), 'defensive').use).toBe(false);
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

  it('on the last lap, spends an item worth nothing just short of a pick-up point to draw again', () => {
    const alone = (at: number): ItemRaceState => field([{ id: 'bot', at, held: 'tow' }]);
    // 10 m short of the point at 2,250 m: a fresh draw is worth the front's mean.
    expect(decide(alone(2_240), 'defensive').use).toBe(true);
    // Away from a point, an item worth nothing is kept.
    expect(decide(alone(2_100), 'defensive').use).toBe(false);
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
      // Used, so its judgement of that item is forgotten; the racer lined up behind is remembered.
      memory: { laneSinceMs: null, itemSince: null, linedUp: [{ id: 'x', sinceMs: 5_000 }] },
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

  it('a naive bot counts puddles a tick of travel ahead when it picks a lane, beyond the fixed look-ahead (#1900)', () => {
    const road = (hazards: ItemRaceState['hazards']): ItemRaceState => ({
      ...field([{ id: 'bot', at: 100 }]),
      hazards,
    });
    const naive = (race: ItemRaceState, travel: number): number =>
      decide(race, 'defensive', { skill: 'naive', travel }).lane;
    // Three puddles 16 m to 20 m ahead in its lane: beyond the fixed 15 m.
    const wet = road([puddle(116, 1), puddle(118, 1), puddle(120, 1)]);
    // On a dry road, this seed's misjudgement keeps it in its lane...
    expect(naive(road([]), 0)).toBe(1);
    // ...and with no travel to speak of, it does not see those puddles.
    expect(naive(wet, 0)).toBe(1);
    // A 25 m tick reaches them, and it leaves the lane.
    expect(naive(wet, 25)).not.toBe(1);
  });

  it('cuts the dwell short for a puddle in its lane within its look-ahead, and for nothing further', () => {
    const wet = (at: number): ItemRaceState => ({
      ...field([{ id: 'bot', at: 300 }]),
      hazards: [puddle(at, 1)],
    });
    const near = wet(310);
    expect(decide(near, 'defensive', { memory: JUST_MOVED(near) }).lane).toBe(0);
    // 30 m ahead, beyond the look-ahead: the dwell holds, where a bot free to move would go.
    const far = wet(330);
    expect(decide(far, 'defensive', { memory: JUST_MOVED(far) }).lane).toBe(1);
    expect(decide(far, 'defensive').lane).toBe(0);
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

  /** The scripted scenario with the defensive leader deciding at `skill`. */
  function strategicRun(seed: number, skill: BotSkill): ReturnType<typeof scripted> {
    let memory = BOT_MEMORY_AT_START;
    return scripted(seed, (race) => {
      const decision = strategicBotDecision(
        race,
        'bot',
        seed,
        8,
        strategy('defensive', skill),
        memory,
      );
      memory = decision.memory;
      return decision;
    });
  }

  it('over twenty seeds', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const strategic = strategicRun(seed, 'crafty');
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

  it('at canny, the solo race’s skill, in at least 80 of seeds 1 to 100', () => {
    const held = (skill: BotSkill): number =>
      Array.from({ length: 100 }, (_, at) => strategicRun(at + 1, skill)).filter(
        (run) => run.absorbed && !run.wasted && !run.hit,
      ).length;
    // Measured: 87 of 100 at canny, 8 at naive (10 at canny before #1982's fix round), and
    // the same with #1986's re-lining, whose rival moves into the lane two ticks before the gust.
    expect(held('canny')).toBeGreaterThanOrEqual(80);
    // Skill still degrades it.
    expect(held('naive')).toBeLessThanOrEqual(40);
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
    // The races are seeded, so these means are the same on every run: a margin below is
    // slack against a retune of the weights, not against run-to-run variation, of which
    // there is none. Measured with #1986's re-lining (aggressive / defensive / opportunist):
    // mean holds 2.80 / 3.29 / 3.44 s, capes 2.74 / 4.26 / 2.88 s, racers a gust 1.01 /
    // 1.12 / 1.21; so about 85 ms left on aggressive against defensive held, 135 ms on
    // defensive against opportunist capes. Before it: 2.83 / 3.35 / 3.46 s and 2.86 / 4.68 / 3.00 s.
    // Aggressive fires early: the shortest holds.
    expect(aggressive.held).toBeLessThan(defensive.held - 400);
    expect(aggressive.held).toBeLessThan(opportunist.held - 400);
    // Defensive keeps its cape: the longest-held capes.
    expect(defensive.cape).toBeGreaterThan(aggressive.cape + 1_250);
    expect(defensive.cape).toBeGreaterThan(opportunist.cape + 1_250);
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
    // Comparisons where the cape rule reads a sat rival: the bot holds a cape, none on,
    // with a rival in gust reach behind it in its lane.
    let capeRuleRead = 0;
    for (const raced of run.states.slice(0, 120)) {
      for (const id of ['b0', 'b1', 'b2']) {
        // As raced, and holding a cape as it is drawn, so the cape rule is asked.
        const owns: readonly ItemRaceState[] = [
          raced,
          {
            ...raced,
            racers: raced.racers.map((entry) =>
              entry.racer.id === id ? { ...entry, held: 'rain-cape', capeUntilMs: null } : entry,
            ),
          },
        ];
        for (const state of owns) {
          const blind: ItemRaceState = {
            ...state,
            racers: state.racers.map((entry) =>
              entry.racer.id === id
                ? entry
                : { ...entry, held: 'crosswind-gust', capeUntilMs: 1e9 },
            ),
          };
          const at = Number(id.slice(1));
          // An empty memory, and one with every rival lined up behind it: half of them
          // a second ago, half for BOT_RELINE_MS, so both of the cape rule's readings
          // of a sat rival are held blind too (#1986).
          const populated: BotMemory = {
            laneSinceMs: null,
            itemSince: null,
            linedUp: state.racers
              .filter((entry) => entry.racer.id !== id)
              .map((entry, place) => ({
                id: entry.racer.id,
                sinceMs: state.atMs - (place % 2 === 0 ? 1_000 : BOT_RELINE_MS),
              })),
          };
          const me = state.racers.find((entry) => entry.racer.id === id) as LapRacer;
          if (
            me.held === 'rain-cape' &&
            me.capeUntilMs === null &&
            state.racers.some((entry) => {
              const gap = racePosition(me.racer) - racePosition(entry.racer);
              return entry.lane === me.lane && gap > 0 && gap <= GUST_REACH_METRES;
            })
          ) {
            capeRuleRead += 1;
          }
          for (const memory of [BOT_MEMORY_AT_START, populated]) {
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
                memory,
              );
            expect(pick(blind)).toEqual(pick(state));
            compared += 1;
          }
        }
      }
    }
    // Measured: 90 of 720 states.
    expect(capeRuleRead).toBeGreaterThan(50);
    expect(compared).toBeGreaterThan(1_200);
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
    expect(moved.memory).toEqual({
      laneSinceMs: race.atMs,
      itemSince: pickUpsPassed(COURSE, 100),
      // It moved out of x's line, so nobody is lined up behind it in the lane it rides.
      linedUp: [],
    });
    const used = decide(field([{ id: 'bot', at: 100, held: 'tailwind' }]), 'defensive');
    expect(used).toEqual({
      use: true,
      lane: 1,
      memory: { laneSinceMs: null, itemSince: null, linedUp: [] },
    });
  });

  it('keeps its judgement of an item it holds through a pick-up point, drawn once for that item', () => {
    // A cape at 240 m, before the point at 250 m, worth nothing to a lone defensive bot.
    const first = decide(field([{ id: 'bot', at: 240, held: 'rain-cape' }]), 'defensive');
    expect(first.use).toBe(false);
    expect(first.memory.itemSince).toBe(0);
    // Through the point, still holding it: the key it was judged by is the one it first saw it at.
    const later = field([{ id: 'bot', at: 260, held: 'rain-cape' }]);
    expect(later.racers[0]?.pickUpsPassed).toBe(1);
    expect(decide(later, 'defensive', { memory: first.memory }).memory.itemSince).toBe(0);
    // With no memory of it, it is a new item to the bot.
    expect(decide(later, 'defensive').memory.itemSince).toBe(1);
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
    const memory: BotMemory = { laneSinceMs: 3, itemSince: 0, linedUp: [] };
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
