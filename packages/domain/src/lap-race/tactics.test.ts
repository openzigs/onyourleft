// SPDX-License-Identifier: Apache-2.0

/**
 * #2462: a lap-race bot's race-aware tactics, on hand-built race views
 * (ADR 0067 D-0, D-1, D-6.3, D-7). Wiring them into the race is #2463.
 */

import { describe, expect, it } from 'vitest';

import {
  BOT_ARCHETYPE_ATTACK_PROPENSITY,
  BOT_ARCHETYPE_SPRINT_FACTOR,
  BOT_ARCHETYPES,
  BOT_TACTICS_WINDOW_MS,
} from './archetype';
import { LapRaceError } from './errors';
import { botRacePlan } from './plan';
import { raceCourse } from './race';
import { BOT_SKILLS, type BotSkill } from './strategy';
import {
  BOT_TACTIC_ATTACK_MS,
  BOT_TACTIC_COMMITMENT,
  BOT_TACTIC_DWELL_MS,
  BOT_TACTIC_FOLLOW_SURGE,
  BOT_TACTIC_RECOVER_CP_SHARE,
  BOT_TACTIC_LAUNCH_METRES,
  BOT_TACTIC_UTILITY,
  BOT_TACTIC_WBAL_FLOOR,
  BOT_TACTIC_WHEEL_CLOSING_GAIN,
  BOT_TACTIC_WHEEL_EASE,
  BOT_TACTIC_WHEEL_FLOOR_WATTS,
  BOT_TACTIC_WHEEL_FURTHEST_METRES,
  BOT_TACTIC_WHEEL_GAP_GAIN,
  BOT_TACTIC_WHEEL_GAP_METRES,
  BOT_TACTIC_WHEEL_LOST_METRES,
  BOT_TACTIC_WHEEL_METRES,
  BOT_TACTIC_WHEEL_NEAREST_METRES,
  BOT_TACTIC_WHEEL_PACE_SHARE,
  BOT_TACTIC_WHEEL_SURGE,
  BOT_TACTICS,
  botLaunchMetres,
  decideTactic,
  TACTIC_MEMORY_AT_START,
  type BotTactic,
  type RaceView,
  type TacticDecision,
  type TacticMemory,
} from './tactics';
import tacticsSource from './tactics.ts?raw';
import { spendableWatts, type BotCapacity, type BotEnergy } from './wbal';

const COURSE = raceCourse(2_000, 10);

/** A brisk bot's capacity, frozen so a write to it throws. */
function capacityOf(style: 'sprinter' | 'climber' | 'even' | 'fast-start'): BotCapacity {
  return Object.freeze({ ...botRacePlan('brisk', COURSE, 1, { style, ability: 1 }).capacity });
}

const SPRINTER = capacityOf('sprinter');

/** A share of a capacity's W′ as a balance. */
function energyAt(capacity: BotCapacity, share: number, exhausted = false): BotEnergy {
  return { wbalJoules: capacity.wPrimeJoules * share, exhausted };
}

/** A bot in the bunch, mid-race, on the flat, full of W′: change what a test reads. */
function view(changes: Partial<RaceView> = {}): RaceView {
  const capacity = changes.capacity ?? SPRINTER;
  return {
    atMs: 0,
    botIndex: 3,
    rank: 4,
    fieldSize: 8,
    gapAheadMetres: 3,
    gapBehindMetres: 2,
    aheadInMove: false,
    riderGapMetres: -20,
    riderWattsPerKilogram: 3,
    lapsLeft: 8,
    metresToLine: 15_000,
    gradeAheadPercent: 0,
    // #2542: on a wheel 3 m back, as fast as it, which costs it 0.7 of its CP
    // in the draft, the racer ahead riding at its CP.
    wheelGapMetres: changes.gapAheadMetres === undefined ? 3 : changes.gapAheadMetres,
    closingMetresPerSecond: 0,
    holdWatts: capacity.cpWatts * 0.7,
    wheelPaceWatts: capacity.cpWatts,
    draftFactor: 0.65,
    energy: energyAt(capacity, 1),
    capacity,
    ...changes,
  };
}

/** The tactic a fresh bot picks from one view. */
function pick(
  at: RaceView,
  archetype: (typeof BOT_ARCHETYPES)[number] = 'sprinter',
  skill: BotSkill = 'crafty',
): BotTactic {
  return decideTactic(at, archetype, skill, TACTIC_MEMORY_AT_START, 7).tactic;
}

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof LapRaceError ? error.code : 'not a LapRaceError';
  }
  return undefined;
}

describe('the racecraft each state encodes, on hand-built views (#2462)', () => {
  it('kicks a sprinter 4th with one lap left at its launch distance, and not a metre before', () => {
    const launch = botLaunchMetres('sprinter');
    expect(launch).toBe(BOT_TACTIC_LAUNCH_METRES * BOT_ARCHETYPE_SPRINT_FACTOR.sprinter);
    const lastLap = (metresToLine: number): RaceView =>
      view({ lapsLeft: 1, rank: 4, metresToLine });
    expect(pick(lastLap(launch))).toBe('kick');
    expect(pick(lastLap(launch / 2))).toBe('kick');
    expect(pick(lastLap(launch + 1))).not.toBe('kick');
    for (let metres = launch + 1; metres <= 2_000; metres += 37) {
      expect(pick(lastLap(metres)), String(metres)).not.toBe('kick');
    }
    // The kick rides the peak: the most the capacity allows, never more.
    const kicked = decideTactic(lastLap(launch), 'sprinter', 'crafty', TACTIC_MEMORY_AT_START, 7);
    expect(kicked.targetWatts).toBe(SPRINTER.peakWatts);
  });

  it('sits in as a sprinter in the bunch with eight laps left, under its CP on the wheel', () => {
    for (const skill of BOT_SKILLS) {
      const decided = decideTactic(view(), 'sprinter', skill, TACTIC_MEMORY_AT_START, 7);
      expect(decided.tactic, skill).toBe('sit-in');
      expect(decided.targetWatts, skill).toBeLessThan(SPRINTER.cpWatts);
    }
  });

  it('never attacks or chases with its W′ under the floor, whatever it reads and whoever it is', () => {
    let opened = 0;
    for (const archetype of BOT_ARCHETYPES) {
      for (const skill of BOT_SKILLS) {
        for (let seat = 0; seat < 8; seat += 1) {
          for (const gap of [40, 90, 150, null]) {
            for (const [grade, lapsLeft] of [
              [0, 6],
              [6, 6],
              [0, 3],
              [6, 2],
            ] as const) {
              const common = {
                botIndex: seat,
                gapAheadMetres: gap,
                gradeAheadPercent: grade,
                lapsLeft,
              };
              // Just under the floor: neither attack nor chase.
              const low = view({
                ...common,
                energy: energyAt(SPRINTER, BOT_TACTIC_WBAL_FLOOR * 0.99),
              });
              expect(['attack', 'chase']).not.toContain(pick(low, archetype, skill));
              // The same view over it opens them, so the floor is what shut them.
              const high = view({ ...common, energy: energyAt(SPRINTER, 1) });
              if (['attack', 'chase'].includes(pick(high, archetype, skill))) opened += 1;
            }
          }
        }
      }
    }
    expect(opened).toBeGreaterThan(100);
  });

  it('follows a move by the racer ahead, and chases one out of the draft within bridging range', () => {
    const fresh = { lapsLeft: 4, energy: energyAt(SPRINTER, 1) };
    expect(pick(view({ ...fresh, aheadInMove: true, gapAheadMetres: 20 }), 'rouleur')).toBe(
      'follow',
    );
    expect(pick(view({ ...fresh, gapAheadMetres: 60 }), 'rouleur')).toBe('chase');
    // Out of bridging range, a bot does not chase alone.
    expect(pick(view({ ...fresh, gapAheadMetres: 400 }), 'rouleur')).not.toBe('chase');
    // The rider in a move just ahead is a move too.
    expect(
      pick(
        view({ ...fresh, gapAheadMetres: null, riderGapMetres: 15, riderWattsPerKilogram: 6 }),
        'rouleur',
      ),
    ).toBe('follow');
  });

  it('attacks on a climb as a climber, recovers when it reads its W′ low, and goes on a flyer late as an attacker', () => {
    const climber = capacityOf('climber');
    expect(
      pick(
        view({
          capacity: climber,
          energy: energyAt(climber, 1),
          lapsLeft: 4,
          gradeAheadPercent: 6,
          gapAheadMetres: null,
        }),
        'climber',
      ),
    ).toBe('attack');
    expect(pick(view({ energy: energyAt(SPRINTER, 0.05), gapAheadMetres: null }))).toBe('recover');
    expect(pick(view({ energy: energyAt(SPRINTER, 0.4, true) }))).toBe('recover');
    const attacker = capacityOf('fast-start');
    expect(
      pick(
        view({
          capacity: attacker,
          energy: energyAt(attacker, 1),
          lapsLeft: 2,
          metresToLine: 3_000,
          gapAheadMetres: null,
        }),
        'attacker',
      ),
    ).toBe('flyer');
  });
});

describe('the last bot reads a view with nobody behind it (#2463)', () => {
  it('takes a `null` gap behind, as the leader takes a `null` gap ahead', () => {
    // #2463 found a race's last bot refused: its view's `null` gap behind was
    // held to a finite number, so the wired race threw on its first tick.
    const last = view({ rank: 8, gapBehindMetres: null });
    expect(() => pick(last)).not.toThrow();
    expect(pick(last)).toBe(pick(view({ rank: 8, gapBehindMetres: 2 })));
    expect(() =>
      pick(view({ rank: 1, gapAheadMetres: null, gapBehindMetres: null })),
    ).not.toThrow();
  });
});

describe('an attack lasts its named time (#2462)', () => {
  it('holds an attack up a climb until BOT_TACTIC_ATTACK_MS, and no longer', () => {
    const climber = capacityOf('climber');
    const attacking: TacticMemory = { tactic: 'attack', sinceMs: 0, window: null };
    const climbing = (atMs: number): RaceView =>
      view({
        atMs,
        capacity: climber,
        energy: energyAt(climber, 1),
        lapsLeft: 4,
        gradeAheadPercent: 6,
        gapAheadMetres: null,
      });
    const at = (atMs: number): BotTactic =>
      decideTactic(climbing(atMs), 'climber', 'crafty', attacking, 7).tactic;
    expect(at(BOT_TACTIC_ATTACK_MS - 1_000)).toBe('attack');
    expect(at(BOT_TACTIC_ATTACK_MS)).not.toBe('attack');
  });
});

describe('a state is held for a dwell, and a close score does not flip it (#2462)', () => {
  /** The tactic at every 1 s tick of `seconds`, from a view of the tick. */
  function trace(
    seconds: number,
    at: (tick: number) => RaceView,
    archetype: (typeof BOT_ARCHETYPES)[number],
    start: TacticMemory = TACTIC_MEMORY_AT_START,
  ): { readonly tactics: readonly BotTactic[]; readonly changes: readonly number[] } {
    let memory = start;
    const tactics: BotTactic[] = [];
    const changes: number[] = [];
    for (let tick = 0; tick < seconds; tick += 1) {
      const decided = decideTactic(
        { ...at(tick), atMs: tick * 1_000 },
        archetype,
        'crafty',
        memory,
        7,
      );
      if (decided.tactic !== memory.tactic) changes.push(tick * 1_000);
      tactics.push(decided.tactic);
      memory = decided.memory;
    }
    return { tactics, changes };
  }

  it('keeps its state when the inputs alternate every tick and the scores stay within the commitment bonus', () => {
    // An attacker sat in, early, off any wheel: reading 80 % of its W′, an
    // attack scores 0.05 over sitting in; reading 66 %, 0.055 under it.
    const attacker = capacityOf('fast-start');
    const sat: TacticMemory = { tactic: 'sit-in', sinceMs: -10_000, window: null };
    const close = trace(
      60,
      (tick) =>
        view({
          capacity: attacker,
          lapsLeft: 5,
          gapAheadMetres: null,
          energy: energyAt(attacker, tick % 2 === 0 ? 0.8 : 0.66),
        }),
      'attacker',
      sat,
    );
    expect(close.changes).toEqual([]);
    expect(new Set(close.tactics)).toEqual(new Set(['sit-in']));
    // The two scores, from the named weights: each read within the bonus of the other.
    const sitIn = BOT_TACTIC_UTILITY.sitIn + BOT_TACTIC_UTILITY.sitInEarly;
    for (const share of [0.8, 0.66]) {
      const attack =
        BOT_TACTIC_UTILITY.attack * BOT_ARCHETYPE_ATTACK_PROPENSITY.attacker.early * share;
      expect(Math.abs(attack - sitIn)).toBeLessThan(BOT_TACTIC_COMMITMENT);
    }
  });

  it('changes state at most once a dwell when the inputs alternate every tick by more than the bonus', () => {
    const wide = trace(
      60,
      (tick) =>
        view({
          lapsLeft: 3,
          gapAheadMetres: null,
          energy: energyAt(SPRINTER, tick % 2 === 0 ? 0.1 : 1),
        }),
      'sprinter',
    );
    expect(wide.changes.length).toBeGreaterThan(3);
    // A dwell is several decision windows long, so it is the dwell that spaces them, not the window.
    expect(BOT_TACTIC_DWELL_MS).toBeGreaterThanOrEqual(2 * BOT_TACTICS_WINDOW_MS);
    expect(wide.changes.length).toBeLessThanOrEqual(60_000 / BOT_TACTIC_DWELL_MS + 1);
    for (let index = 1; index < wide.changes.length; index += 1) {
      expect((wide.changes[index] ?? 0) - (wide.changes[index - 1] ?? 0)).toBeGreaterThanOrEqual(
        BOT_TACTIC_DWELL_MS,
      );
    }
  });

  it('cuts a dwell short only for the launch and a W′ that shuts it out of what it is doing', () => {
    // Attacking, then under the floor a second later: out of the attack at once.
    const attacking: TacticMemory = { tactic: 'attack', sinceMs: 0, window: 0 };
    const empty = decideTactic(
      view({ atMs: 1_000, energy: energyAt(SPRINTER, 0.1) }),
      'sprinter',
      'crafty',
      attacking,
      7,
    );
    expect(empty.tactic).not.toBe('attack');
    // Sitting in a moment, then at the launch: the kick, at once.
    const sitting: TacticMemory = { tactic: 'sit-in', sinceMs: 0, window: 0 };
    const launch = decideTactic(
      view({ atMs: 1_000, lapsLeft: 1, metresToLine: 100 }),
      'sprinter',
      'crafty',
      sitting,
      7,
    );
    expect(launch.tactic).toBe('kick');
  });

  it('ends a chase, and a flyer that has run out, at once, not after the dwell', () => {
    const chasing: TacticMemory = { tactic: 'chase', sinceMs: 0, window: 0 };
    const spent = decideTactic(
      view({ atMs: 1_000, gapAheadMetres: 60, energy: energyAt(SPRINTER, 0.1) }),
      'sprinter',
      'crafty',
      chasing,
      7,
    );
    expect(spent.tactic).not.toBe('chase');
    const flying: TacticMemory = { tactic: 'flyer', sinceMs: 0, window: 0 };
    const empty = decideTactic(
      view({ atMs: 1_000, lapsLeft: 2, energy: energyAt(SPRINTER, 0.5, true) }),
      'sprinter',
      'crafty',
      flying,
      7,
    );
    expect(empty.tactic).not.toBe('flyer');
  });

  it('holds the wheel when following on it, surges off it, and asks 0.85 of CP when recovering', () => {
    const cp = SPRINTER.cpWatts;
    const target = (tactic: BotTactic, changes: Partial<RaceView>): number =>
      decideTactic(
        view({ atMs: 500, ...changes }),
        'sprinter',
        'crafty',
        { tactic, sinceMs: 0, window: 0 },
        7,
      ).targetWatts;
    // #2542: on the wheel, at the gap and its speed, the hold and nothing more.
    expect(
      target('follow', { gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, holdWatts: 0.7 * cp }),
    ).toBeCloseTo(0.7 * cp, 6);
    expect(target('follow', { gapAheadMetres: 80 })).toBeCloseTo(
      cp * (1 + BOT_TACTIC_FOLLOW_SURGE),
      6,
    );
    expect(target('recover', { gapAheadMetres: null })).toBeCloseTo(
      cp * BOT_TACTIC_RECOVER_CP_SHARE,
      6,
    );
  });
});

describe('sit-in and follow hold a wheel 0.3–1 m back (#2542)', () => {
  const cp = SPRINTER.cpWatts;
  const hold = 0.7 * cp;
  /** The target of a bot already in `tactic`, mid-window, on a wheel. */
  const target = (changes: Partial<RaceView>, tactic: BotTactic = 'sit-in'): TacticDecision =>
    decideTactic(
      view({ atMs: 500, holdWatts: hold, ...changes }),
      'sprinter',
      'crafty',
      { tactic, sinceMs: 0, window: 0 },
      7,
    );

  it('names a band of 0.3 to 1 m and steers for its middle', () => {
    expect(BOT_TACTIC_WHEEL_NEAREST_METRES).toBe(0.3);
    expect(BOT_TACTIC_WHEEL_FURTHEST_METRES).toBe(1);
    expect(BOT_TACTIC_WHEEL_GAP_METRES).toBeCloseTo(0.65, 12);
  });

  it('rides the hold at the gap and the wheel’s speed, more behind it, less inside it or closing', () => {
    for (const tactic of ['sit-in', 'follow'] as const) {
      const at = (changes: Partial<RaceView>): number => target(changes, tactic).targetWatts;
      expect(at({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES }), tactic).toBeCloseTo(hold, 9);
      expect(target({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES }, tactic).wheel).toBe(true);
      // Behind the gap: the gap gain of CP more for every metre.
      expect(at({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES + 0.25 }), tactic).toBeCloseTo(
        hold + cp * BOT_TACTIC_WHEEL_GAP_GAIN * 0.25,
        9,
      );
      // Inside it, less; closing on it, less again, so it slows before it gets there.
      expect(at({ gapAheadMetres: 0.35 }), tactic).toBeCloseTo(
        hold - cp * BOT_TACTIC_WHEEL_GAP_GAIN * 0.3,
        9,
      );
      expect(
        at({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, closingMetresPerSecond: 0.2 }),
        tactic,
      ).toBeCloseTo(hold - cp * BOT_TACTIC_WHEEL_CLOSING_GAIN * 0.2, 9);
      // Opening, more.
      expect(
        at({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, closingMetresPerSecond: -0.05 }),
        tactic,
      ).toBeCloseTo(hold + cp * BOT_TACTIC_WHEEL_CLOSING_GAIN * 0.05, 9);
      // The correction is bounded: 30 m back is a sitting-in effort, never a sprint.
      expect(at({ gapAheadMetres: BOT_TACTIC_WHEEL_METRES }), tactic).toBeCloseTo(
        hold + cp * BOT_TACTIC_WHEEL_SURGE,
        9,
      );
      expect(
        at({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, closingMetresPerSecond: 10 }),
        tactic,
      ).toBeCloseTo(hold - cp * BOT_TACTIC_WHEEL_EASE, 9);
    }
  });

  it('follows the hold: a faster wheel asks more, a slower one less, at the one gap', () => {
    const gap = { gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES };
    expect(target({ ...gap, holdWatts: 0.6 * cp }).targetWatts).toBeCloseTo(0.6 * cp, 9);
    expect(target({ ...gap, holdWatts: 0.9 * cp }).targetWatts).toBeCloseTo(0.9 * cp, 9);
  });

  it('holds no wheel past 30 m, nor a wheel too slow to be worth it, nor with nobody ahead', () => {
    const past = target({ gapAheadMetres: BOT_TACTIC_WHEEL_METRES + 1 });
    expect(past.wheel).toBe(false);
    expect(past.targetWatts).toBeCloseTo(cp, 9);
    const slow = target({
      gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES,
      wheelPaceWatts: cp * BOT_TACTIC_WHEEL_PACE_SHARE - 1,
    });
    expect(slow.wheel).toBe(false);
    expect(slow.targetWatts).toBeCloseTo(cp, 9);
    expect(
      target({
        gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES,
        wheelPaceWatts: cp * BOT_TACTIC_WHEEL_PACE_SHARE,
      }).wheel,
    ).toBe(true);
    // A wheel nobody worked the hold out for is none.
    expect(target({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, holdWatts: null }).wheel).toBe(
      false,
    );
    // The rider with no live power: a wheel all the same.
    expect(
      target({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, wheelPaceWatts: null }).wheel,
    ).toBe(true);
    const leading = target({ gapAheadMetres: null, holdWatts: null, wheelPaceWatts: null });
    expect(leading.wheel).toBe(false);
    expect(leading.targetWatts).toBeCloseTo(cp, 9);
    // Following off the wheel still surges.
    expect(target({ gapAheadMetres: 40 }, 'follow').targetWatts).toBeCloseTo(
      cp * (1 + BOT_TACTIC_FOLLOW_SURGE),
      9,
    );
  });

  it('holds no wheel in any other state', () => {
    for (const tactic of ['attack', 'chase', 'flyer', 'kick'] as const) {
      expect(target({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES }, tactic).wheel, tactic).toBe(
        false,
      );
    }
  });

  it('drops the floor on a wheel in a draft, and keeps it on one in the open (ADR 0067 D-1.3, R-10)', () => {
    const tooClose = { gapAheadMetres: 0.1, holdWatts: 0.5 * cp, closingMetresPerSecond: 0.5 };
    const drafted = target({ ...tooClose, draftFactor: 0.65 });
    expect(drafted.targetWatts).toBeLessThan(SPRINTER.floorWatts);
    expect(drafted.targetWatts).toBeGreaterThanOrEqual(BOT_TACTIC_WHEEL_FLOOR_WATTS);
    expect(target({ ...tooClose, draftFactor: 1 }).targetWatts).toBe(SPRINTER.floorWatts);
  });

  it('lets the wheel go when its W′ will not pay: held to CP exhausted, whatever the hold asks', () => {
    const dear = { gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, holdWatts: 1.2 * cp };
    for (const tactic of ['sit-in', 'follow'] as const) {
      expect(target(dear, tactic).targetWatts, tactic).toBeCloseTo(1.2 * cp, 9);
      expect(
        target({ ...dear, energy: energyAt(SPRINTER, 0, true) }, tactic).targetWatts,
        tactic,
      ).toBe(cp);
    }
  });
});

describe('faders slip back, and the wheel can be the one in front (#2543)', () => {
  const cp = SPRINTER.cpWatts;
  const hold = 0.7 * cp;
  const at = (changes: Partial<RaceView>, tactic: BotTactic = 'sit-in'): TacticDecision =>
    decideTactic(
      view({ atMs: 500, holdWatts: hold, ...changes }),
      'sprinter',
      'crafty',
      { tactic, sinceMs: 0, window: 0 },
      7,
    );

  it('recovering, holds a wheel no harder than its recovering target', () => {
    const recover = (holdWatts: number): TacticDecision =>
      at({ gapAheadMetres: BOT_TACTIC_WHEEL_GAP_METRES, holdWatts }, 'recover');
    expect(recover(0.6 * cp).wheel).toBe(true);
    expect(recover(0.6 * cp).targetWatts).toBeCloseTo(0.6 * cp, 9);
    // A wheel that asks more: it slips back.
    expect(recover(1.1 * cp).targetWatts).toBeCloseTo(cp * BOT_TACTIC_RECOVER_CP_SHARE, 9);
    // With no wheel, its target as before.
    expect(
      at({ gapAheadMetres: null, wheelGapMetres: null, holdWatts: null }, 'recover').targetWatts,
    ).toBeCloseTo(cp * BOT_TACTIC_RECOVER_CP_SHARE, 9);
  });

  it('steers on the gap to the wheel it holds, which may be the one in front of the racer ahead', () => {
    // The racer ahead 1 m back has lost its wheel: the bot holds the one 4 m up.
    const round = at({ gapAheadMetres: 1, wheelGapMetres: 4 });
    expect(round.targetWatts).toBeCloseTo(hold + cp * BOT_TACTIC_WHEEL_SURGE, 9);
    expect(
      at({ gapAheadMetres: 4, wheelGapMetres: BOT_TACTIC_WHEEL_GAP_METRES }).targetWatts,
    ).toBeCloseTo(hold, 9);
    // A wheel past the reach is none, whatever the racer ahead.
    expect(at({ gapAheadMetres: 1, wheelGapMetres: BOT_TACTIC_WHEEL_METRES + 1 }).wheel).toBe(
      false,
    );
    expect(BOT_TACTIC_WHEEL_LOST_METRES).toBe(2 * BOT_TACTIC_WHEEL_FURTHEST_METRES);
  });
});

describe('decided once per window, so the tick rate changes nothing (#2462, ADR 0067 D-6.3)', () => {
  /** A race view that changes through every second: the same function of time for both tick rates. */
  function racing(atMs: number, capacity: BotCapacity): RaceView {
    const seconds = atMs / 1_000;
    const share = 0.15 + (0.85 * ((seconds * 7) % 100)) / 100;
    return view({
      atMs,
      capacity,
      energy: energyAt(capacity, share),
      gapAheadMetres: 5 + ((seconds * 13) % 240),
      gradeAheadPercent: ((seconds * 3) % 14) - 4,
      aheadInMove: Math.floor(seconds / 7) % 3 === 0,
      lapsLeft: Math.max(1, 6 - Math.floor(seconds / 40)),
      metresToLine: Math.max(0, 12_000 - seconds * 50),
    });
  }

  it('reads the same states at 0.05 s and at 1 s ticks, for every archetype and skill', () => {
    let changed = 0;
    for (const archetype of BOT_ARCHETYPES) {
      for (const skill of BOT_SKILLS) {
        const capacity = SPRINTER;
        const run = (stepMs: number): readonly BotTactic[] => {
          let memory: TacticMemory = TACTIC_MEMORY_AT_START;
          const whole: BotTactic[] = [];
          for (let atMs = 0; atMs < 240_000; atMs += stepMs) {
            const decided = decideTactic(racing(atMs, capacity), archetype, skill, memory, 11);
            memory = decided.memory;
            if (atMs % BOT_TACTICS_WINDOW_MS === 0) whole.push(decided.tactic);
          }
          return whole;
        };
        const coarse = run(1_000);
        expect(run(50), `${archetype} ${skill}`).toEqual(coarse);
        changed += new Set(coarse).size;
      }
    }
    // Not vacuous: the race moves the bots through several states.
    expect(changed).toBeGreaterThan(BOT_ARCHETYPES.length * BOT_SKILLS.length * 2);
  });

  it('holds the state chosen at a window’s start through the window, whatever the view does in it', () => {
    const start = decideTactic(
      view({ atMs: 5_000 }),
      'sprinter',
      'crafty',
      TACTIC_MEMORY_AT_START,
      7,
    );
    expect(start.tactic).toBe('sit-in');
    const later = decideTactic(
      view({ atMs: 5_950, lapsLeft: 1, metresToLine: 10 }),
      'sprinter',
      'crafty',
      start.memory,
      7,
    );
    expect(later.tactic).toBe('sit-in');
    expect(later.memory).toBe(start.memory);
  });
});

describe('no tactic raises a capacity (#2462, ADR 0067 D-1.2)', () => {
  it('leaves the capacity as it was after 1000 decisions in every rank, and never targets over what it may spend', () => {
    for (const archetype of BOT_ARCHETYPES) {
      const capacity = capacityOf(
        archetype === 'rouleur' ? 'even' : archetype === 'attacker' ? 'fast-start' : archetype,
      );
      const before = JSON.stringify(capacity);
      for (let rank = 1; rank <= 8; rank += 1) {
        let memory: TacticMemory = TACTIC_MEMORY_AT_START;
        for (let tick = 0; tick < 1_000; tick += 1) {
          const exhausted = tick % 97 < 10;
          const at = view({
            atMs: tick * 500,
            rank,
            capacity,
            energy: energyAt(capacity, exhausted ? 0.05 : (tick % 10) / 10, exhausted),
            gapAheadMetres: rank === 1 ? null : (tick * 7) % 260,
            gradeAheadPercent: (tick % 11) - 3,
            lapsLeft: Math.max(1, 10 - Math.floor(tick / 100)),
            metresToLine: Math.max(0, 20_000 - tick * 20),
            aheadInMove: tick % 13 === 0,
          });
          const decided = decideTactic(at, archetype, 'naive', memory, rank);
          memory = decided.memory;
          // Never over what the capacity lets it ride now: its peak, or its CP while exhausted.
          expect(decided.targetWatts).toBeLessThanOrEqual(
            spendableWatts(capacity, at.energy, Number.MAX_VALUE, 0),
          );
          // Never under its floor, but on a wheel in a draft (ADR 0067 D-1.3, R-10, #2542).
          expect(decided.targetWatts).toBeGreaterThanOrEqual(
            decided.wheel ? BOT_TACTIC_WHEEL_FLOOR_WATTS : capacity.floorWatts,
          );
        }
        expect(JSON.stringify(capacity), `${archetype} ${String(rank)}`).toBe(before);
      }
    }
  });
});

describe('it refuses a view that is not a race’s, and reaches nothing it should not', () => {
  it('names the field and the constraint', () => {
    for (const bad of [
      { atMs: Number.NaN },
      { atMs: -1 },
      { metresToLine: Number.POSITIVE_INFINITY },
      { gradeAheadPercent: Number.NaN },
      { lapsLeft: 1.5 },
      { rank: 0 },
      { rank: 9 },
      { fieldSize: 2.5 },
      { gapAheadMetres: Number.NaN },
      { gapBehindMetres: Number.NaN },
      { gapBehindMetres: Number.POSITIVE_INFINITY },
      { riderWattsPerKilogram: Number.NaN },
      { closingMetresPerSecond: Number.NaN },
      { holdWatts: Number.POSITIVE_INFINITY },
      { wheelPaceWatts: Number.NaN },
      { draftFactor: 0 },
      { wheelGapMetres: Number.NaN },
      { draftFactor: 1.01 },
    ]) {
      expect(
        codeOf(() => pick(view(bad))),
        JSON.stringify(bad),
      ).toBe('view-out-of-range');
    }
    expect(
      codeOf(() => decideTactic(view(), 'sprinter', 'naive', TACTIC_MEMORY_AT_START, 0.5)),
    ).toBe('seed-not-integer');
  });

  it('imports nothing from apps/, nothing platform-bound and nothing of the trainer', () => {
    const specifiers = [...tacticsSource.matchAll(/\b(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^\.\.?\//);
      expect(specifier).not.toMatch(/apps\/|trainer|sensors|ftms|ble|ghost|recording/i);
    }
    const code = tacticsSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(
      /Math\.(exp|pow|random)|\*\*|\bDate\b|performance\.|\bwindow\.|\bdocument\.|navigator|setTimeout/,
    );
    // Every state is one of the seven, in the order a tie goes.
    expect(BOT_TACTICS).toEqual([
      'kick',
      'recover',
      'sit-in',
      'follow',
      'chase',
      'attack',
      'flyer',
    ]);
  });
});
