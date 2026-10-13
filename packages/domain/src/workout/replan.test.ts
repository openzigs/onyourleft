// SPDX-License-Identifier: Apache-2.0

/**
 * The re-plan validator — #1242, ADR 0048 D-4 to D-6.
 *
 * A bug here is a bug on the path that applies resistance to a person, so
 * each P-rule has a test that names it, and the first describe block is the
 * issue's own safety criteria by name.
 */

import { describe, expect, it } from 'vitest';

import {
  beatsPerMinute,
  seconds,
  watts,
  type BeatsPerMinute,
  type Seconds,
  type Watts,
} from '../quantities';

import type { WorkoutGoals } from './goals';
import type { TrainerPowerRange } from './heart-rate-hold';
import {
  decodeProposal,
  loadPlan,
  PLAN_MOVE_KINDS,
  planNotApplied,
  planWorkout,
  readReplanRecord,
  REPLAN_NOT_APPLIED,
  PROPOSAL_KEYS,
  REASON_CODES,
  REPLAN_BLOCK_MINUTES,
  REPLAN_HOLD_RANGE_BPM,
  REPLAN_RULES,
  REPLAN_SCALE_PERCENTS,
  validateProposal,
  type Accepted,
  type OwnThresholds,
  type PlanMove,
  type PlanRevision,
  type PlanState,
  type Refused,
  type SavedWorkout,
} from './replan';
import { thresholdShare, validateWorkout, type Workout, type WorkoutBlock } from './workout';

const share = thresholdShare;

/** Seven blocks, 80 minutes: a warm-up, a main set of five, a cool-down. */
const LOADED: Workout = {
  name: 'Over-unders',
  blocks: [
    { kind: 'steady', seconds: seconds(600), target: share(0.5) },
    { kind: 'steady', seconds: seconds(600), target: share(0.7) },
    {
      kind: 'intervals',
      repeats: 4,
      hardSeconds: seconds(180),
      hardTarget: share(0.9),
      easySeconds: seconds(120),
      easyTarget: share(0.5),
    },
    {
      kind: 'heart-rate-hold',
      seconds: seconds(900),
      range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
      startShare: share(0.6),
      ceilingShare: share(0.75),
    },
    { kind: 'steady', seconds: seconds(600), target: share(0.8) },
    { kind: 'free-ride', seconds: seconds(300) },
    { kind: 'steady', seconds: seconds(600), target: share(0.45) },
  ],
};

const SAVED: Workout = {
  name: 'Saved',
  blocks: [
    { kind: 'steady', seconds: seconds(300), target: share(0.65), label: 'Tempo' },
    { kind: 'steady', seconds: seconds(300), target: share(1.2) },
    { kind: 'ramp', seconds: seconds(300), from: share(0.4), to: share(0.6) },
    { kind: 'steady', seconds: seconds(1800), target: share(0.6) },
    {
      kind: 'heart-rate-hold',
      seconds: seconds(600),
      range: { low: beatsPerMinute(140), high: beatsPerMinute(150) },
      startShare: share(0.6),
      ceilingShare: share(0.7),
    },
  ],
};

const LIBRARY: readonly SavedWorkout[] = [{ id: 'w-1', workout: SAVED }];

const ATHLETE: OwnThresholds = {
  thresholdPower: watts(250),
  thresholdHeartRate: beatsPerMinute(165),
  assumed: { power: false, heartRate: false },
};

const MACHINE: TrainerPowerRange = { minimum: watts(0), maximum: watts(1000) };

/** 100 s into the warm-up, with summary 7 sent 30 s before `NOW`. */
function stateOf(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: loadPlan(LOADED),
    position: seconds(100),
    summary: { seq: 7, sentAt: seconds(1000) },
    enabled: true,
    paused: false,
    rescue: false,
    control: true,
    heartRatePaired: true,
    library: LIBRARY,
    ...overrides,
  };
}

const NOW = seconds(1030);

function proposalOf(move: unknown, overrides: Record<string, unknown> = {}): unknown {
  return { revision: 0, summarySeq: 7, move, reason: 'on-plan', ...overrides };
}

interface Call {
  readonly state?: PlanState;
  readonly goals?: WorkoutGoals;
  readonly athlete?: OwnThresholds;
  readonly machine?: TrainerPowerRange;
  readonly now?: Seconds;
}

function decide(proposal: unknown, call: Call = {}): Accepted | Refused {
  return validateProposal(
    proposal,
    call.state ?? stateOf(),
    call.goals ?? {},
    call.athlete ?? ATHLETE,
    call.machine ?? MACHINE,
    call.now ?? NOW,
  );
}

function accepted(proposal: unknown, call: Call = {}): Accepted {
  const result = decide(proposal, call);
  if (!result.ok) {
    throw new Error(`expected an accepted move, refused by ${result.rule}`);
  }
  return result;
}

function ruleOf(proposal: unknown, call: Call = {}): string {
  const result = decide(proposal, call);
  return result.ok ? 'accepted' : result.rule;
}

/** A state some minutes later, on the plan an accepted move made. */
function after(plan: PlanRevision, at: number, overrides: Partial<PlanState> = {}): Call {
  return {
    state: stateOf({ plan, summary: { seq: 8, sentAt: seconds(at) }, ...overrides }),
    now: seconds(at),
  };
}

function later(move: unknown, plan: PlanRevision): unknown {
  return proposalOf(move, { revision: plan.revision, summarySeq: 8 });
}

const EVERY_VALID_MOVE: readonly PlanMove[] = [
  { kind: 'extend-block', block: 1, minutes: 2 },
  { kind: 'shorten-block', block: 1, minutes: 5 },
  { kind: 'scale-remaining-intervals', percent: -10 },
  { kind: 'move-hold-range', block: 3, bpm: -3 },
  { kind: 'swap-next-block', workoutId: 'w-1', blockIndex: 0 },
  { kind: 'end-main-set' },
];

function sharesOf(block: WorkoutBlock): number[] {
  switch (block.kind) {
    case 'steady':
      return [block.target];
    case 'ramp':
      return [block.from, block.to];
    case 'intervals':
      return [block.hardTarget, block.easyTarget];
    case 'heart-rate-hold':
      return [block.startShare, block.ceilingShare];
    case 'free-ride':
      return [];
  }
}

function lengthOf(block: WorkoutBlock): number {
  return block.kind === 'intervals'
    ? block.repeats * (block.hardSeconds + block.easySeconds)
    : block.seconds;
}

function totalOf(blocks: readonly WorkoutBlock[]): number {
  return blocks.reduce((total, block) => total + lengthOf(block), 0);
}

/**
 * Each share of a block beside the share of another block it is measured
 * against (#1300): a hold's start share, since its ceiling is a cap, and two
 * holds like with like. A free ride gives every share nothing to rise from.
 */
function comparedWith(block: WorkoutBlock, against: WorkoutBlock): [number, number][] {
  if (block.kind === 'heart-rate-hold' && against.kind === 'heart-rate-hold') {
    return [
      [block.startShare, against.startShare],
      [block.ceilingShare, against.ceilingShare],
    ];
  }
  const from =
    against.kind === 'heart-rate-hold'
      ? against.startShare
      : Math.max(Number.NEGATIVE_INFINITY, ...sharesOf(against));
  return sharesOf(block).map((value) => [value, from]);
}

function steadyAt(length: Seconds, target: number): WorkoutBlock {
  return { kind: 'steady', seconds: length, target: thresholdShare(target) };
}

/** A seeded generator, so a failure is a seed and not a mystery. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
  }
  return value;
}

describe('the safety criteria, by name — #1242', () => {
  it('no proposal raises a target above the envelope', () => {
    const EPSILON = 1e-9;
    const acceptedKinds = new Set<string>();
    let acceptedCount = 0;

    for (let seed = 1; seed <= 400; seed += 1) {
      const random = generator(seed);
      const whole = (low: number, high: number): number =>
        low + Math.floor(random() * (high - low + 1));
      const pick = <T>(list: readonly T[]): T => list[whole(0, list.length - 1)] as T;
      const aShare = (low: number, high: number) => share(whole(low * 100, high * 100) / 100);
      const aLength = () => seconds(whole(2, 40) * 30);

      const aBlock = (): WorkoutBlock => {
        switch (whole(0, 4)) {
          case 0:
            return { kind: 'steady', seconds: aLength(), target: aShare(0.2, 1.3) };
          case 1:
            return { kind: 'ramp', seconds: aLength(), from: aShare(0.2, 1), to: aShare(0.2, 1.2) };
          case 2:
            return {
              kind: 'intervals',
              repeats: whole(1, 6),
              hardSeconds: seconds(whole(1, 10) * 30),
              hardTarget: aShare(0.6, 1.5),
              easySeconds: seconds(whole(1, 10) * 30),
              easyTarget: aShare(0.2, 0.6),
            };
          case 3: {
            const low = whole(100, 150);
            const start = whole(40, 70) / 100;
            return {
              kind: 'heart-rate-hold',
              seconds: aLength(),
              range: { low: beatsPerMinute(low), high: beatsPerMinute(low + whole(6, 15)) },
              startShare: share(start),
              ceilingShare: share(Math.min(0.78, start + whole(0, 30) / 100)),
            };
          }
          default:
            return { kind: 'free-ride', seconds: aLength() };
        }
      };
      const aWorkout = (name: string): Workout => ({
        name,
        blocks: Array.from({ length: whole(3, 8) }, aBlock),
      });

      const drawn = aWorkout('loaded');
      // A hold with the highest ceiling a hold may have, so that P3 leaves room
      // for the holds below to rise toward it (#1304).
      const peakHold: WorkoutBlock[] = drawn.blocks.some(
        (block) => block.kind === 'heart-rate-hold',
      )
        ? [
            {
              kind: 'heart-rate-hold',
              seconds: aLength(),
              range: { low: beatsPerMinute(140), high: beatsPerMinute(150) },
              startShare: share(0.7),
              ceilingShare: share(0.85),
            },
          ]
        : [];
      const loaded: Workout = {
        name: 'loaded',
        blocks: [...drawn.blocks.slice(0, 1), ...peakHold, ...drawn.blocks.slice(1)],
      };
      // Two blocks for each block loaded, one 5 % above it (to a thousandth)
      // and one 5 % above that, so that a rise can follow a rise in the same
      // place: two random workouts almost never offer one (#1300).
      const near: WorkoutBlock[] = [];
      const nearOf = new Map<WorkoutBlock | undefined, number>();
      const above = (from: number): number => Math.floor(from * 1.05 * 1000) / 1000;
      for (const block of loaded.blocks) {
        const [, from] = comparedWith(block, block)[0] ?? [];
        if (block.kind === 'heart-rate-hold' && block.ceilingShare < 0.78) {
          // A hold for a hold, its ceiling up 3 % and then 5 % more: the +10 %
          // divides each ceiling rise by the START share, so it is the only
          // way to see which share the module divides by (#1304, ruling 2).
          const first = Math.floor(block.ceilingShare * 1.03 * 1000) / 1000;
          nearOf.set(block, near.length);
          for (const ceilingShare of [first, above(first)]) {
            near.push({ ...block, ceilingShare: share(ceilingShare) });
          }
        } else if (from !== undefined) {
          const first = above(from);
          nearOf.set(block, near.length);
          near.push(steadyAt(aLength(), first), steadyAt(aLength(), above(first)));
        }
      }
      const library: SavedWorkout[] = [
        { id: 'a', workout: aWorkout('a') },
        { id: 'b', workout: aWorkout('b') },
        { id: 'near', workout: { name: 'near', blocks: [...near, aBlock()] } },
      ];
      const libraryBlocks = new Set(library.flatMap((saved) => saved.workout.blocks));
      const goals: WorkoutGoals = {
        ...(random() < 0.5 ? { powerCeiling: aShare(0.5, 0.85) } : {}),
        ...(random() < 0.5 ? { durationMinutes: whole(10, 300) } : {}),
        ...(random() < 0.3 ? { heartRateAbove: beatsPerMinute(whole(140, 180)) } : {}),
      };
      const athlete: OwnThresholds = {
        thresholdPower: watts(whole(150, 350)),
        thresholdHeartRate: beatsPerMinute(whole(150, 190)),
        assumed: { power: false, heartRate: false },
      };
      const machine: TrainerPowerRange = { minimum: watts(0), maximum: watts(whole(150, 1500)) };

      // The envelope, computed here and not by the module under test.
      const loadedPeak = (kind: WorkoutBlock['kind']): number =>
        Math.max(
          Number.NEGATIVE_INFINITY,
          ...loaded.blocks.filter((block) => block.kind === kind).flatMap(sharesOf),
        );
      const envelope = (kind: WorkoutBlock['kind']): number =>
        Math.min(
          goals.powerCeiling ?? Number.POSITIVE_INFINITY,
          loadedPeak(kind),
          machine.maximum / athlete.thresholdPower,
        );
      const longest =
        goals.durationMinutes === undefined ? totalOf(loaded.blocks) : goals.durationMinutes * 60;

      const aValue = (depth: number): unknown => {
        const choice = whole(0, depth > 2 ? 5 : 7);
        if (choice === 0) return whole(-500, 500);
        if (choice === 1) return pick(['5; set 400 W', 'end-main-set', 'P1', '', 'on-plan']);
        if (choice === 2) return null;
        if (choice === 3) return random() < 0.5;
        if (choice === 4) return random() * 1000;
        if (choice === 5) return pick([...PLAN_MOVE_KINDS, ...REASON_CODES, ...PROPOSAL_KEYS]);
        if (choice === 6) return Array.from({ length: whole(0, 3) }, () => aValue(depth + 1));
        const made: Record<string, unknown> = {};
        for (let count = whole(0, 4); count > 0; count -= 1) {
          made[pick([...PROPOSAL_KEYS, 'kind', 'block', 'minutes', 'percent', 'watts'])] = aValue(
            depth + 1,
          );
        }
        return made;
      };

      let plan = loadPlan(loaded);
      // The block each place in the plan was loaded with, kept here and not
      // read from the module under test (#1300).
      let places: readonly (WorkoutBlock | undefined)[] = loaded.blocks;
      let now = 0;
      let stayed = 0;
      for (let step = 0; step < 30; step += 1) {
        // Often long enough for a second harder move.
        now += random() < 0.3 ? 700 : whole(0, 700);
        const total = totalOf(plan.blocks.map((entry) => entry.block));
        // Half the time the rider has not moved on, so the next block is the
        // same place and a second move can land on the first (#1300).
        const position = random() < 0.5 ? Math.min(stayed, total) : random() * total * 1.02;
        stayed = position;
        // The place after the one being ridden, which is the one a swap changes.
        let ahead = 0;
        let passed = 0;
        for (const entry of plan.blocks) {
          passed += lengthOf(entry.block);
          ahead += 1;
          if (position < passed) break;
        }
        const aMove = (): PlanMove =>
          pick<PlanMove>([
            {
              kind: pick(['extend-block', 'shorten-block'] as const),
              block: whole(0, plan.blocks.length),
              minutes: pick(REPLAN_BLOCK_MINUTES),
            },
            { kind: 'scale-remaining-intervals', percent: pick(REPLAN_SCALE_PERCENTS) },
            { kind: 'scale-remaining-intervals', percent: pick(REPLAN_SCALE_PERCENTS) },
            {
              kind: 'move-hold-range',
              block: whole(0, plan.blocks.length),
              bpm: pick(REPLAN_HOLD_RANGE_BPM),
            },
            { kind: 'swap-next-block', workoutId: pick(['a', 'b', 'c']), blockIndex: whole(0, 8) },
            { kind: 'swap-next-block', workoutId: pick(['a', 'b']), blockIndex: whole(0, 3) },
            {
              kind: 'swap-next-block',
              workoutId: 'near',
              blockIndex: (nearOf.get(places[ahead]) ?? near.length) + whole(0, 1),
            },
            {
              kind: 'swap-next-block',
              workoutId: 'near',
              blockIndex: (nearOf.get(places[ahead]) ?? near.length) + whole(0, 1),
            },
            { kind: 'end-main-set' },
          ]);
        const valid = random() < 0.75;
        const proposal: unknown = valid
          ? {
              revision: random() < 0.95 ? plan.revision : whole(0, 40),
              summarySeq: step,
              move: aMove(),
              reason: pick(REASON_CODES),
            }
          : aValue(0);
        const on = (): boolean => random() < 0.97;
        const state: PlanState = {
          plan,
          position: seconds(position),
          summary: { seq: step, sentAt: seconds(Math.max(0, now - whole(0, 65))) },
          enabled: on(),
          paused: !on(),
          rescue: !on(),
          control: on(),
          heartRatePaired: on(),
          library,
        };

        const result = validateProposal(proposal, state, goals, athlete, machine, seconds(now));
        if (!result.ok) {
          expect(REPLAN_RULES).toContain(result.rule);
          if (!valid) {
            expect(result).toStrictEqual({
              ok: false,
              rule: 'P1',
              record: { decision: 'refused', rule: 'P1', at: now },
            });
          }
          continue;
        }

        acceptedCount += 1;
        const decoded = decodeProposal(proposal);
        expect(decoded).toBeDefined();
        acceptedKinds.add(decoded?.move.kind ?? '');
        expect(state.enabled && state.control && state.heartRatePaired).toBe(true);
        expect(state.paused || state.rescue).toBe(false);

        // Where the rider is, worked out here.
        let current = 0;
        let end = 0;
        for (const [index, entry] of plan.blocks.entries()) {
          end += lengthOf(entry.block);
          current = index;
          if (position < end) break;
        }
        expect(end - position).toBeGreaterThanOrEqual(30);
        expect(result.fromBlock).toBe(current + 1);

        const before = plan.blocks;
        const next = result.plan.blocks;
        if (next.length !== before.length) {
          places = next.map((entry) => places[before.indexOf(entry)]);
        }
        // The block being ridden, everything before it, and so the warm-up.
        for (let index = 0; index <= current; index += 1) {
          expect(next[index]).toBe(before[index]);
        }
        // The cool-down.
        expect(next.at(-1)).toBe(before.at(-1));
        expect(current).toBeLessThan(before.length - 1);

        for (const [index, entry] of next.entries()) {
          const old = next.length === before.length ? before[index] : undefined;
          const ceiling = envelope(entry.block.kind);
          const swappedIn = libraryBlocks.has(entry.base) && old?.base !== entry.base;
          const oldShares =
            old !== undefined && old.block.kind === entry.block.kind && !swappedIn
              ? sharesOf(old.block)
              : undefined;
          if (next.length !== before.length) {
            // A shorter plan is the old one with blocks taken out, untouched.
            expect(before).toContain(entry);
          }
          for (const [at, value] of sharesOf(entry.block).entries()) {
            // Above the envelope only where it already was, and never higher.
            const allowed = Math.max(ceiling, oldShares?.[at] ?? Number.NEGATIVE_INFINITY);
            const untouched = next.length !== before.length;
            if (!untouched) {
              expect(value).toBeLessThanOrEqual(allowed + EPSILON);
            }
            // P4: never more than 10 % above the share it joined the plan with.
            expect(value).toBeLessThanOrEqual((sharesOf(entry.base)[at] ?? 0) * 1.1 + EPSILON);
          }
          if (swappedIn && old !== undefined) {
            // P4, #1296: a swap raises the highest share by 5 % at most; #1300:
            // over a hold's start share, and hold against hold like with like.
            for (const [value, from] of comparedWith(entry.block, old.block)) {
              expect(value).toBeLessThanOrEqual(from * 1.05 + EPSILON);
            }
          }
          // P4, #1300: whatever has been swapped in and scaled since, never more
          // than 10 % above the share this place was LOADED with. A rise that
          // compounds over the block replaced each time is seen here.
          const place = places[index];
          expect(place).toBeDefined();
          if (place !== undefined) {
            // A hold swapped for a hold: the +10 % divides each rise by the
            // place's loaded START share, so a ceiling's rise is measured in
            // that share and not in the ceiling's own (#1304, ruling 2).
            const loadedStart = place.kind === 'heart-rate-hold' ? place.startShare : undefined;
            for (const [value, from] of comparedWith(entry.block, place)) {
              expect(value).toBeLessThanOrEqual(from + (loadedStart ?? from) * 0.1 + EPSILON);
            }
          }
        }

        const totalAfter = totalOf(next.map((entry) => entry.block));
        expect(totalAfter).toBeLessThanOrEqual(Math.max(longest, total));
        expect(result.plan.revision).toBe(plan.revision + 1);
        expect(() => validateWorkout(result.workout)).not.toThrow();
        expect(result.workout.blocks).toStrictEqual(next.map((entry) => entry.block));
        plan = result.plan;
      }

      // A plan loaded inside the envelope is still inside it after every move.
      const inside = loaded.blocks.every((block) =>
        sharesOf(block).every((value) => value <= envelope(block.kind)),
      );
      if (inside) {
        for (const entry of plan.blocks) {
          if (!libraryBlocks.has(entry.base) || loaded.blocks.includes(entry.base)) {
            for (const value of sharesOf(entry.block)) {
              expect(value).toBeLessThanOrEqual(envelope(entry.block.kind) + EPSILON);
            }
          }
        }
      }
    }

    // Not vacuous: every kind of move was accepted somewhere in the run.
    expect([...acceptedKinds].sort()).toStrictEqual([...PLAN_MOVE_KINDS].sort());
    expect(acceptedCount).toBeGreaterThan(300);
  });

  it('rate limits hold', () => {
    const acceptedAt: number[] = [];
    let scales = 0;
    let plan = loadPlan(LOADED);
    for (let at = 0; at <= 7200; at += 15) {
      const move: PlanMove =
        (at / 15) % 2 === 0
          ? { kind: 'scale-remaining-intervals', percent: 5 }
          : { kind: 'extend-block', block: 1, minutes: 1 };
      const result = decide(
        { revision: plan.revision, summarySeq: at, move, reason: 'heart-rate-low' },
        {
          state: stateOf({ plan, summary: { seq: at, sentAt: seconds(at) } }),
          goals: { durationMinutes: 300 },
          now: seconds(at),
        },
      );
      if (result.ok) {
        acceptedAt.push(at);
        scales += move.kind === 'scale-remaining-intervals' ? 1 : 0;
        plan = result.plan;
      }
      // Cumulative: no share is ever more than 10 % above the loaded one.
      for (const [index, entry] of plan.blocks.entries()) {
        const loaded = sharesOf(LOADED.blocks[index] as WorkoutBlock);
        for (const [position, value] of sharesOf(entry.block).entries()) {
          expect(value).toBeLessThanOrEqual((loaded[position] ?? 0) * 1.1 + 1e-9);
        }
      }
    }
    // One harder move per 10 minutes, and no more.
    expect(acceptedAt.length).toBeGreaterThanOrEqual(10);
    expect(acceptedAt.length).toBeLessThanOrEqual(13);
    for (const [index, at] of acceptedAt.entries()) {
      if (index > 0) {
        expect(at - (acceptedAt[index - 1] ?? 0)).toBeGreaterThanOrEqual(600);
      }
    }
    // +5 % twice is the whole +10 %; every later scale was refused.
    expect(scales).toBe(2);
    expect(plan.blocks[1]?.percents).toStrictEqual([10]);
    expect(sharesOf(plan.blocks[1]?.block as WorkoutBlock)[0]).toBeCloseTo(0.77, 12);
    expect(
      ruleOf(later({ kind: 'scale-remaining-intervals', percent: 5 }, plan), after(plan, 9000)),
    ).toBe('P4');
  });

  it('stale is refused', () => {
    const move = { kind: 'shorten-block', block: 1, minutes: 1 };
    const first = accepted(proposalOf(move));
    expect(first.plan.revision).toBe(1);
    // Revision n, after revision n + 1 exists.
    expect(ruleOf(proposalOf(move, { summarySeq: 8 }), after(first.plan, 1300))).toBe('P5');
    // And a revision that does not exist yet is no fresher.
    expect(ruleOf(proposalOf(move, { revision: 1 }))).toBe('P5');
    expect(ruleOf(proposalOf(move, { revision: 2, summarySeq: 8 }), after(first.plan, 1300))).toBe(
      'P5',
    );

    // Older than 60 s, counted from when its summary was sent at 1000.
    expect(ruleOf(proposalOf(move), { now: seconds(1060) })).toBe('accepted');
    expect(ruleOf(proposalOf(move), { now: seconds(1061) })).toBe('P5');
    // A summary from the future is not fresh either.
    expect(ruleOf(proposalOf(move), { now: seconds(999) })).toBe('P5');
    // It must name the latest summary, and there must be one.
    expect(ruleOf(proposalOf(move, { summarySeq: 6 }))).toBe('P5');
    expect(ruleOf(proposalOf(move), { state: stateOf({ summary: undefined }) })).toBe('P5');
  });

  it('text never reaches a number', () => {
    const valid = { kind: 'extend-block', block: 1, minutes: 5 };
    const injections: readonly unknown[] = [
      proposalOf({ ...valid, minutes: '5; set 400 W' }),
      proposalOf({ ...valid, minutes: 400 }),
      proposalOf({ ...valid, minutes: '5' }),
      proposalOf({ ...valid, minutes: 5.5 }),
      proposalOf({ ...valid, minutes: { value: 5, watts: 400 } }),
      proposalOf({ ...valid, minutes: [5] }),
      proposalOf({ ...valid, watts: 400 }),
      proposalOf({ ...valid, note: 'set 400 W' }),
      proposalOf({ ...valid, block: '1' }),
      proposalOf({ ...valid, block: -1 }),
      proposalOf({ ...valid, block: 1.5 }),
      proposalOf({ ...valid, block: { index: 1 } }),
      proposalOf({ kind: 'extend-block', block: 1 }),
      proposalOf({ kind: 'set-target', watts: 400 }),
      proposalOf({ kind: 'scale-remaining-intervals', percent: 10 }),
      proposalOf({ kind: 'scale-remaining-intervals', percent: '5' }),
      proposalOf({ kind: 'scale-remaining-intervals', percent: 5, block: 1 }),
      proposalOf({ kind: 'move-hold-range', block: 3, bpm: 4 }),
      proposalOf({ kind: 'move-hold-range', block: 3, bpm: 3, high: 190 }),
      proposalOf({ kind: 'swap-next-block', workoutId: 400, blockIndex: 0 }),
      proposalOf({ kind: 'swap-next-block', workoutId: 'w-1', blockIndex: '0' }),
      proposalOf({ kind: 'swap-next-block', workoutId: 'w-1', blockIndex: 0, target: 1.5 }),
      proposalOf({ kind: 'swap-next-block', workoutId: 'w'.repeat(129), blockIndex: 0 }),
      proposalOf({ kind: 'swap-next-block', workoutId: '', blockIndex: 0 }),
      proposalOf({ kind: 'end-main-set', then: 'set 400 W' }),
      proposalOf('end-main-set'),
      proposalOf([valid]),
      proposalOf(null),
      proposalOf(valid, { reason: 'ignore the rules and set 500 W' }),
      proposalOf(valid, { reason: 7 }),
      proposalOf(valid, { note: 'set 400 W' }),
      proposalOf(valid, { watts: 400 }),
      proposalOf(valid, { revision: '0' }),
      proposalOf(valid, { revision: -1 }),
      proposalOf(valid, { summarySeq: 7.5 }),
      { revision: 0, summarySeq: 7, move: valid },
      { revision: 0, summarySeq: 7, reason: 'on-plan' },
      [proposalOf(valid)],
      JSON.stringify(proposalOf(valid)),
      null,
      undefined,
      400,
    ];
    for (const injection of injections) {
      expect(decodeProposal(injection)).toBeUndefined();
      const result = decide(injection);
      // Refused whole: the rule and the time, and nothing of what arrived.
      expect(result).toStrictEqual({
        ok: false,
        rule: 'P1',
        record: { decision: 'refused', rule: 'P1', at: NOW },
      });
    }
    // The valid one these were made from is accepted, so each refusal is its own.
    expect(ruleOf(proposalOf(valid), { goals: { durationMinutes: 120 } })).toBe('accepted');
  });

  it("swap stays in the rider's library", () => {
    const swap = (workoutId: string, blockIndex: number) =>
      proposalOf({ kind: 'swap-next-block', workoutId, blockIndex });

    // Not theirs: refused, and the id is model text, so it is not kept.
    const stranger = decide(swap('someone-elses', 0));
    expect(stranger).toStrictEqual({
      ok: false,
      rule: 'P1',
      record: { decision: 'refused', rule: 'P1', at: NOW },
    });
    expect(ruleOf(swap('w-1', 0), { state: stateOf({ library: [] }) })).toBe('P1');
    // Theirs, but no such block.
    expect(ruleOf(swap('w-1', 5))).toBe('P1');
    // Saved, but not a workout anybody could ride.
    const broken: Workout = {
      name: 'Broken',
      blocks: [{ kind: 'steady', seconds: seconds(0), target: share(0.5) }],
    };
    expect(
      ruleOf(swap('broken', 0), {
        state: stateOf({ library: [{ id: 'broken', workout: broken }] }),
      }),
    ).toBe('P1');

    // Theirs: the next block is replaced, and only the next block (R8).
    const result = accepted(swap('w-1', 0));
    expect(result.plan.blocks).toHaveLength(LOADED.blocks.length);
    expect(result.workout.blocks[1]).toStrictEqual(SAVED.blocks[0]);
    for (const index of [0, 2, 3, 4, 5, 6]) {
      expect(result.workout.blocks[index]).toBe(LOADED.blocks[index]);
    }

    // A swapped block is bounded like any other: by the loaded steady peak of 0.8…
    expect(ruleOf(swap('w-1', 1))).toBe('P3');
    // …by the goal's ceiling and by the machine…
    expect(ruleOf(swap('w-1', 0), { goals: { powerCeiling: share(0.6) } })).toBe('P3');
    expect(ruleOf(swap('w-1', 0), { machine: { minimum: watts(0), maximum: watts(160) } })).toBe(
      'P3',
    );
    // …by having a block of its kind in the loaded workout at all (no ramp is loaded)…
    expect(ruleOf(swap('w-1', 2))).toBe('P3');
    // …by the plan's length: 30 minutes for 10 is 20 more than the loaded 80…
    expect(ruleOf(swap('w-1', 3))).toBe('P3');
    expect(ruleOf(swap('w-1', 3), { goals: { durationMinutes: 100 } })).toBe('accepted');
    // …and a hold by the highest range loaded, 140 bpm.
    expect(ruleOf(swap('w-1', 4))).toBe('P3');

    // The next block is the cool-down: it is never replaced.
    expect(ruleOf(swap('w-1', 0), { state: stateOf({ position: seconds(4000) }) })).toBe('P3');
  });

  it('a swap on a plan already over its goal is accepted when it does not lengthen it', () => {
    // The goal is 60 minutes and the loaded workout 80: the plan is over before any move.
    const goals = { durationMinutes: 60 };
    const swap = (blockIndex: number) =>
      proposalOf({ kind: 'swap-next-block', workoutId: 'w-1', blockIndex });
    // 5 minutes for 10 shortens it.
    expect(ruleOf(swap(0), { goals })).toBe('accepted');
    // 30 minutes for 10 lengthens it.
    expect(ruleOf(swap(3), { goals })).toBe('P3');
  });

  it('a swap that makes a plan too long to ride is refused', () => {
    // 49 blocks of 100 repeats is 9 800 segments; one more such block is over the 10 000.
    // Its peak is the 0.7 of the block it replaces: the plan's length is what refuses it.
    const many: WorkoutBlock = {
      kind: 'intervals',
      repeats: 100,
      hardSeconds: seconds(1),
      hardTarget: share(0.7),
      easySeconds: seconds(1),
      easyTarget: share(0.5),
    };
    const steady = LOADED.blocks[1] as WorkoutBlock;
    const long: Workout = {
      name: 'Long',
      blocks: [steady, steady, ...Array.from({ length: 49 }, () => many), steady],
    };
    const state = stateOf({
      plan: loadPlan(long),
      library: [{ id: 'many', workout: { name: 'Many', blocks: [many, steady] } }],
    });
    const swap = (blockIndex: number) =>
      proposalOf({ kind: 'swap-next-block', workoutId: 'many', blockIndex });
    expect(ruleOf(swap(1), { state })).toBe('accepted');
    expect(ruleOf(swap(0), { state })).toBe('P3');
  });

  it('is deterministic, and changes nothing it was given', () => {
    for (const move of EVERY_VALID_MOVE) {
      const proposal = deepFreeze(proposalOf(move));
      const state = deepFreeze(stateOf());
      const goals = deepFreeze<WorkoutGoals>({ durationMinutes: 120 });
      const call: Call = {
        state,
        goals,
        athlete: deepFreeze(ATHLETE),
        machine: deepFreeze(MACHINE),
      };
      const first = decide(proposal, call);
      expect(first.ok).toBe(true);
      expect(decide(proposal, call)).toStrictEqual(first);
    }
  });
});

describe('decodeProposal — P1', () => {
  it.each(EVERY_VALID_MOVE)('reads $kind as a copy holding only the keys it knows', (move) => {
    const sent = proposalOf(move, { reason: 'heart-rate-high' }) as { move: object };
    const decoded = decodeProposal(sent);
    expect(decoded).toStrictEqual(sent);
    expect(decoded).not.toBe(sent);
    expect(decoded?.move).not.toBe(sent.move);
  });

  it('reads every value on each list, and every reason', () => {
    for (const minutes of REPLAN_BLOCK_MINUTES) {
      expect(
        decodeProposal(proposalOf({ kind: 'shorten-block', block: 2, minutes })),
      ).toBeDefined();
    }
    for (const percent of REPLAN_SCALE_PERCENTS) {
      expect(
        decodeProposal(proposalOf({ kind: 'scale-remaining-intervals', percent })),
      ).toBeDefined();
    }
    for (const bpm of REPLAN_HOLD_RANGE_BPM) {
      expect(decodeProposal(proposalOf({ kind: 'move-hold-range', block: 3, bpm }))).toBeDefined();
    }
    for (const reason of REASON_CODES) {
      expect(decodeProposal(proposalOf({ kind: 'end-main-set' }, { reason }))).toBeDefined();
    }
  });

  it('keeps its lists closed (spike 0022 R1, R4, R6, R10)', () => {
    // A new move or reason is a change to ADR 0048 D-4, so each list is pinned.
    expect(PLAN_MOVE_KINDS).toStrictEqual([
      'extend-block',
      'shorten-block',
      'scale-remaining-intervals',
      'move-hold-range',
      'swap-next-block',
      'end-main-set',
    ]);
    expect(REASON_CODES).toStrictEqual([
      'heart-rate-high',
      'heart-rate-low',
      'cadence-falling',
      'goal-time-in-range',
      'goal-duration',
      'effort-check-in',
      'on-plan',
    ]);
    expect(PROPOSAL_KEYS).toStrictEqual(['revision', 'summarySeq', 'move', 'reason']);
    expect(REPLAN_BLOCK_MINUTES).toStrictEqual([1, 2, 5]);
    expect(REPLAN_SCALE_PERCENTS).toStrictEqual([-10, -5, 5]);
    expect(REPLAN_HOLD_RANGE_BPM).toStrictEqual([-5, -3, 3, 5]);
    expect(REPLAN_RULES).toStrictEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);

    // The validator's input: no score, no environment, no calorie or weight.
    // `Required` makes a missing key a compile error, and an extra one is too.
    const everyKey: Required<PlanState> = stateOf();
    expect(Object.keys(everyKey).sort()).toStrictEqual([
      'control',
      'enabled',
      'heartRatePaired',
      'library',
      'paused',
      'plan',
      'position',
      'rescue',
      'summary',
    ]);
    const banned = /scor|rating|adheren|complian|calori|weight|temperature|humid|gradient|terrain/;
    for (const word of [
      ...PLAN_MOVE_KINDS,
      ...REASON_CODES,
      ...PROPOSAL_KEYS,
      ...Object.keys(everyKey),
    ]) {
      expect(word).not.toMatch(banned);
    }
  });
});

describe('validateProposal — the rules a refusal names', () => {
  // Block 4 is followed by a free ride, so shortening it is not a harder move (#1296).
  const shorten = { kind: 'shorten-block', block: 4, minutes: 1 };

  it('P7: off unless switched on for the ride', () => {
    expect(ruleOf(proposalOf(shorten))).toBe('accepted');
    expect(ruleOf(proposalOf(shorten), { state: stateOf({ enabled: false }) })).toBe('P7');
  });

  it('P6: during a rescue, while paused, without control or eligibility, or in the cool-down', () => {
    const refusedWith = (overrides: Partial<PlanState>) =>
      ruleOf(proposalOf(shorten), { state: stateOf(overrides) });
    expect(refusedWith({ rescue: true })).toBe('P6');
    expect(refusedWith({ paused: true })).toBe('P6');
    expect(refusedWith({ control: false })).toBe('P6');
    expect(refusedWith({ heartRatePaired: false })).toBe('P6');

    // H1: a substituted default enables nothing.
    const assumed = (power: boolean, heartRate: boolean): OwnThresholds => ({
      ...ATHLETE,
      assumed: { power, heartRate },
    });
    expect(ruleOf(proposalOf(shorten), { athlete: assumed(true, false) })).toBe('P6');
    expect(ruleOf(proposalOf(shorten), { athlete: assumed(false, true) })).toBe('P6');
    expect(ruleOf(proposalOf(shorten), { athlete: { ...ATHLETE, thresholdPower: watts(0) } })).toBe(
      'P6',
    );
    // An unset threshold heart rate or machine maximum is NaN-shaped: the bound comparisons
    // fail open on it, so the guard refuses before they run.
    const nan = Number.NaN;
    const holdUp = proposalOf({ kind: 'move-hold-range', block: 3, bpm: 5 });
    expect(
      ruleOf(holdUp, { athlete: { ...ATHLETE, thresholdHeartRate: nan as BeatsPerMinute } }),
    ).toBe('P6');
    const swapIn = proposalOf({ kind: 'swap-next-block', workoutId: 'w-1', blockIndex: 0 });
    expect(ruleOf(swapIn, { machine: { minimum: watts(0), maximum: nan as Watts } })).toBe('P6');
    // Goals that do not read are no bounds to check against.
    const unread = { powerCeiling: 250 } as unknown as WorkoutGoals;
    expect(ruleOf(proposalOf(shorten), { goals: unread })).toBe('P6');

    // Inside the cool-down, which starts at 4200 s.
    const end = { kind: 'end-main-set' };
    expect(ruleOf(proposalOf(end), { state: stateOf({ position: seconds(4199) }) })).not.toBe('P6');
    expect(ruleOf(proposalOf(end), { state: stateOf({ position: seconds(4200) }) })).toBe('P6');
  });

  it('P2: never the current block, and only 30 s or more before the next boundary', () => {
    // 700 s is in block 1, which ends at 1200 s.
    const inBlockOne = stateOf({ position: seconds(700) });
    for (const kind of ['extend-block', 'shorten-block'] as const) {
      expect(ruleOf(proposalOf({ kind, block: 1, minutes: 1 }), { state: inBlockOne })).toBe('P2');
      // Nor one already ridden — the warm-up among them.
      expect(ruleOf(proposalOf({ kind, block: 0, minutes: 1 }), { state: inBlockOne })).toBe('P2');
      // Nor one the plan does not have.
      expect(ruleOf(proposalOf({ kind, block: 7, minutes: 1 }), { state: inBlockOne })).toBe('P2');
    }
    const inTheHold = stateOf({ position: seconds(2500) });
    const range = { kind: 'move-hold-range', block: 3, bpm: -3 };
    expect(ruleOf(proposalOf(range), { state: inTheHold })).toBe('P2');
    expect(ruleOf(proposalOf(range), { state: inBlockOne })).toBe('accepted');

    // The lead: the warm-up ends at 600 s.
    expect(ruleOf(proposalOf(shorten), { state: stateOf({ position: seconds(570) }) })).toBe(
      'accepted',
    );
    expect(ruleOf(proposalOf(shorten), { state: stateOf({ position: seconds(571) }) })).toBe('P2');
    // Past the end there is no boundary to wait for.
    expect(ruleOf(proposalOf(shorten), { state: stateOf({ position: seconds(4800) }) })).toBe('P2');
  });

  it('P2: a scale leaves the block being ridden, and everything before it, alone', () => {
    // In the intervals block, 1500 s in.
    const result = accepted(proposalOf({ kind: 'scale-remaining-intervals', percent: -10 }), {
      state: stateOf({ position: seconds(1500) }),
    });
    expect(result.fromBlock).toBe(3);
    for (const index of [0, 1, 2, 3, 5, 6]) {
      // The hold and the free ride are not scaled; the cool-down never is.
      expect(result.workout.blocks[index]).toBe(LOADED.blocks[index]);
    }
    expect(sharesOf(result.workout.blocks[4] as WorkoutBlock)[0]).toBeCloseTo(0.72, 12);
    // With only the cool-down left after this block, there is nothing to scale.
    expect(
      ruleOf(proposalOf({ kind: 'scale-remaining-intervals', percent: -10 }), {
        state: stateOf({ position: seconds(4000) }),
      }),
    ).toBe('P2');
  });

  it('P3: warm-up and cool-down are untouched', () => {
    for (const kind of ['extend-block', 'shorten-block'] as const) {
      expect(
        ruleOf(proposalOf({ kind, block: 6, minutes: 1 }), { goals: { durationMinutes: 120 } }),
      ).toBe('P3');
    }
    const scaled = accepted(proposalOf({ kind: 'scale-remaining-intervals', percent: -10 }));
    expect(scaled.workout.blocks[0]).toBe(LOADED.blocks[0]);
    expect(scaled.workout.blocks[6]).toBe(LOADED.blocks[6]);
    const ended = accepted(proposalOf({ kind: 'end-main-set' }));
    expect(ended.workout.blocks).toStrictEqual([LOADED.blocks[0], LOADED.blocks[6]]);
  });

  it('P3: total time never above the goal duration, or the loaded workout with no goal', () => {
    const extend = { kind: 'extend-block', block: 1, minutes: 5 };
    // No duration goal: the loaded 80 minutes is the most there may be.
    expect(ruleOf(proposalOf(extend))).toBe('P3');
    expect(ruleOf(proposalOf(extend), { goals: { durationMinutes: 84 } })).toBe('P3');
    const result = accepted(proposalOf(extend), { goals: { durationMinutes: 85 } });
    expect(result.workout.blocks[1]).toStrictEqual({ ...LOADED.blocks[1], seconds: 900 });
    expect(totalOf(result.workout.blocks)).toBe(85 * 60);

    // With no goal, an extension fits only in the room a shortening made.
    const shortened = accepted(proposalOf({ kind: 'shorten-block', block: 4, minutes: 5 }));
    expect(shortened.workout.blocks[4]).toStrictEqual({ ...LOADED.blocks[4], seconds: 300 });
    expect(ruleOf(later(extend, shortened.plan), after(shortened.plan, 1300))).toBe('accepted');
    expect(
      ruleOf(
        later({ kind: 'extend-block', block: 1, minutes: 5 }, shortened.plan),
        after(shortened.plan, 1300, { position: seconds(100) }),
      ),
    ).toBe('accepted');
  });

  it('P1: a block is never shortened to nothing, and an intervals block has no minutes', () => {
    // The free ride is 5 minutes long.
    expect(ruleOf(proposalOf({ kind: 'shorten-block', block: 5, minutes: 5 }))).toBe('P1');
    expect(ruleOf(proposalOf({ kind: 'shorten-block', block: 5, minutes: 2 }))).toBe('accepted');
    expect(ruleOf(proposalOf({ kind: 'shorten-block', block: 2, minutes: 1 }))).toBe('P1');
    expect(ruleOf(proposalOf({ kind: 'move-hold-range', block: 4, bpm: -3 }))).toBe('P1');
  });

  it('P3: a scale is bounded by the loaded peak, the goal and the machine, and never by a Stop', () => {
    const up = proposalOf({ kind: 'scale-remaining-intervals', percent: 5 }) as { move: object };
    const blocksOf = (result: Accepted) => result.workout.blocks.map(sharesOf);

    // The loaded peaks: steady 0.8, intervals 0.9. A share at its peak stays.
    const [, one, intervals, hold, four, free] = blocksOf(accepted(up));
    expect(one?.[0]).toBeCloseTo(0.735, 12);
    expect(intervals?.[0]).toBe(0.9);
    expect(intervals?.[1]).toBeCloseTo(0.525, 12);
    expect(hold).toStrictEqual([0.6, 0.75]);
    expect(four).toStrictEqual([0.8]);
    expect(free).toStrictEqual([]);

    // The goal's ceiling: 0.7 stops at 0.72, and nothing already above it moves.
    const capped = blocksOf(accepted(up, { goals: { powerCeiling: share(0.72) } }));
    expect(capped[1]).toStrictEqual([0.72]);
    expect(capped[2]?.[0]).toBe(0.9);
    expect(capped[4]).toStrictEqual([0.8]);
    // The machine: 180 W of 250 W is 0.72 as well.
    const machine = { minimum: watts(0), maximum: watts(180) };
    expect(blocksOf(accepted(up, { machine }))[1]).toStrictEqual([0.72]);
    // Every share already at a bound: there is nothing left to raise.
    expect(ruleOf(up, { goals: { powerCeiling: share(0.5) } })).toBe('P3');

    // Easier: −10 % of each share, the same blocks.
    const down = blocksOf(
      accepted(proposalOf({ kind: 'scale-remaining-intervals', percent: -10 })),
    );
    expect(down[1]?.[0]).toBeCloseTo(0.63, 12);
    expect(down[2]?.[0]).toBeCloseTo(0.81, 12);
    expect(down[2]?.[1]).toBeCloseTo(0.45, 12);
    expect(down[3]).toStrictEqual([0.6, 0.75]);
    expect(down[4]?.[0]).toBeCloseTo(0.72, 12);

    // A share above the ceiling is never raised, even on the way back from a cut:
    // with a goal of 0.6, 0.8 cut to 0.72 stays 0.72 and only the 0.45 rises.
    const goals = { powerCeiling: share(0.6) };
    const cut = accepted(proposalOf({ kind: 'scale-remaining-intervals', percent: -10 }), {
      goals,
    });
    const back = blocksOf(accepted(later(up.move, cut.plan), { ...after(cut.plan, 1300), goals }));
    expect(back[1]?.[0]).toBeCloseTo(0.63, 12);
    expect(back[2]?.[0]).toBeCloseTo(0.81, 12);
    expect(back[2]?.[1]).toBeCloseTo(0.475, 12);
    expect(back[4]?.[0]).toBeCloseTo(0.72, 12);

    // The floor is the lowest share a target may carry, 0.2, and it is a target.
    let plan = loadPlan({
      name: 'Low',
      blocks: [
        LOADED.blocks[0],
        { kind: 'steady', seconds: seconds(600), target: share(0.21) },
        LOADED.blocks[6],
      ] as WorkoutBlock[],
    });
    const lowered = accepted(
      later({ kind: 'scale-remaining-intervals', percent: -10 }, plan),
      after(plan, 0),
    );
    expect(sharesOf(lowered.workout.blocks[1] as WorkoutBlock)).toStrictEqual([0.2]);
    plan = lowered.plan;
    expect(
      ruleOf(later({ kind: 'scale-remaining-intervals', percent: -10 }, plan), after(plan, 200)),
    ).toBe('P3');
  });

  it('P4: one accepted move per 3 minutes', () => {
    const first = accepted(proposalOf(shorten));
    const again = later(shorten, first.plan);
    expect(ruleOf(again, after(first.plan, NOW + 179))).toBe('P4');
    expect(ruleOf(again, after(first.plan, NOW + 180))).toBe('accepted');
  });

  it('P4: one harder move per 10 minutes, while an easier one is still accepted', () => {
    const goals = { durationMinutes: 120 };
    const first = accepted(proposalOf({ kind: 'extend-block', block: 1, minutes: 1 }), { goals });
    const harder: readonly unknown[] = [
      { kind: 'extend-block', block: 4, minutes: 1 },
      { kind: 'scale-remaining-intervals', percent: 5 },
      { kind: 'swap-next-block', workoutId: 'w-1', blockIndex: 0 },
    ];
    for (const move of harder) {
      const proposal = later(move, first.plan);
      expect(ruleOf(proposal, { ...after(first.plan, NOW + 599), goals })).toBe('P4');
      expect(ruleOf(proposal, { ...after(first.plan, NOW + 600), goals })).toBe('accepted');
    }
    for (const move of [
      shorten,
      { kind: 'scale-remaining-intervals', percent: -5 },
      { kind: 'end-main-set' },
    ]) {
      expect(ruleOf(later(move, first.plan), { ...after(first.plan, NOW + 599), goals })).toBe(
        'accepted',
      );
    }
    // An easier move does not restart the harder clock, and does not stop it.
    const eased = accepted(later(shorten, first.plan), { ...after(first.plan, NOW + 300), goals });
    expect(eased.plan.lastHarderAt).toBe(NOW);
    expect(eased.plan.lastAcceptedAt).toBe(NOW + 300);
  });

  it('P4: +10 % cumulative, counted per block from the share it joined the plan with', () => {
    let plan = accepted(proposalOf({ kind: 'scale-remaining-intervals', percent: -10 })).plan;
    const up = { kind: 'scale-remaining-intervals', percent: 5 };
    const steps: number[] = [];
    for (let at = 2000; at <= 8000; at += 1000) {
      const result = decide(later(up, plan), after(plan, at));
      if (!result.ok) {
        expect(result.rule).toBe('P4');
        break;
      }
      plan = result.plan;
      steps.push(sharesOf(plan.blocks[1]?.block as WorkoutBlock)[0] ?? 0);
    }
    // −10, then −5, 0, +5, +10: four rises, and the fifth is refused.
    expect(steps).toHaveLength(4);
    expect(steps[0]).toBeCloseTo(0.665, 12);
    expect(steps[1]).toBe(0.7);
    expect(steps[2]).toBeCloseTo(0.735, 12);
    expect(steps[3]).toBeCloseTo(0.77, 12);
    expect(plan.blocks[1]?.percents).toStrictEqual([10]);
    // The plan keeps the share each block joined with.
    expect(plan.blocks[1]?.base).toBe(LOADED.blocks[1]);
  });

  it('P3: a hold range moves down freely and up only to what was loaded and chosen', () => {
    const move = (bpm: number) => ({ kind: 'move-hold-range', block: 3, bpm });
    // Up from the highest range loaded is above the loaded peak.
    expect(ruleOf(proposalOf(move(3)))).toBe('P3');

    const down = accepted(proposalOf(move(-5)));
    expect(down.workout.blocks[3]).toStrictEqual({
      ...LOADED.blocks[3],
      range: { low: 125, high: 135 },
    });
    // Back up by 5 is back at the loaded 140; by 3 then 3 would be 141.
    const up = accepted(later(move(3), down.plan), after(down.plan, 1300));
    expect(up.plan.lastHarderAt).toBe(1300);
    expect(ruleOf(later(move(3), up.plan), after(up.plan, 2000))).toBe('P3');
    expect(ruleOf(later(move(5), down.plan), after(down.plan, 1300))).toBe('accepted');

    // The rider's own choices bound it too.
    const call = (goals: WorkoutGoals, athlete = ATHLETE) => ({
      ...after(down.plan, 1300),
      goals,
      athlete,
    });
    expect(ruleOf(later(move(5), down.plan), call({ heartRateAbove: beatsPerMinute(139) }))).toBe(
      'P3',
    );
    expect(
      ruleOf(
        later(move(5), down.plan),
        call({ holdRange: { low: beatsPerMinute(120), high: beatsPerMinute(138) } }),
      ),
    ).toBe('P3');
    expect(
      ruleOf(
        later(move(5), down.plan),
        call({}, { ...ATHLETE, thresholdHeartRate: beatsPerMinute(139) }),
      ),
    ).toBe('P3');

    // Down stops at the lowest heart rate a range may be written in, 30 bpm.
    const low = loadPlan({
      name: 'Low',
      blocks: [
        LOADED.blocks[0],
        { ...LOADED.blocks[3], range: { low: beatsPerMinute(34), high: beatsPerMinute(44) } },
        LOADED.blocks[6],
      ] as WorkoutBlock[],
    });
    const lowMove = (bpm: number) => later({ kind: 'move-hold-range', block: 1, bpm }, low);
    expect(ruleOf(lowMove(-5), after(low, 0))).toBe('P3');
    expect(ruleOf(lowMove(-3), after(low, 0))).toBe('accepted');
  });

  it('end-main-set leaves the block being ridden and the cool-down, or is refused', () => {
    const result = accepted(proposalOf({ kind: 'end-main-set' }), {
      state: stateOf({ position: seconds(1500) }),
    });
    expect(result.workout.blocks).toStrictEqual([
      LOADED.blocks[0],
      LOADED.blocks[1],
      LOADED.blocks[2],
      LOADED.blocks[6],
    ]);
    // In the free ride, the cool-down is already next.
    expect(
      ruleOf(proposalOf({ kind: 'end-main-set' }), { state: stateOf({ position: seconds(4000) }) }),
    ).toBe('P2');
  });

  it('P9: every decision yields a record of the move, the rule and the time', () => {
    const move = { kind: 'shorten-block', block: 1, minutes: 2 };
    const result = accepted(proposalOf(move, { reason: 'heart-rate-high' }));
    expect(result.record).toStrictEqual({
      decision: 'accepted',
      move,
      reason: 'heart-rate-high',
      revision: 1,
      at: NOW,
    });
    expect(
      decide(proposalOf(move, { reason: 'heart-rate-high' }), { state: stateOf({ paused: true }) }),
    ).toStrictEqual({
      ok: false,
      rule: 'P6',
      record: { decision: 'refused', rule: 'P6', move, reason: 'heart-rate-high', at: NOW },
    });
  });

  it('an accepted move is the next revision, and its workout is the plan the player reads', () => {
    const result = accepted(proposalOf({ kind: 'shorten-block', block: 4, minutes: 2 }));
    expect(result.plan.revision).toBe(1);
    expect(result.plan.loaded).toBe(LOADED);
    expect(result.plan.lastAcceptedAt).toBe(NOW);
    expect(result.plan.lastHarderAt).toBeUndefined();
    expect(result.fromBlock).toBe(1);
    expect(result.workout).toStrictEqual(planWorkout(result.plan));
    expect(result.workout.name).toBe('Over-unders');
    expect(planWorkout(loadPlan(LOADED))).toStrictEqual(LOADED);
    expect(() => loadPlan({ name: 'Empty', blocks: [] })).toThrow(/at least one block/);
  });
});

describe("the owner's rulings of 2026-10-12 — #1296", () => {
  const scale = (percent: number) => ({ kind: 'scale-remaining-intervals', percent });
  const swapOf = (workoutId: string, blockIndex: number) => ({
    kind: 'swap-next-block',
    workoutId,
    blockIndex,
  });
  const steady = (target: number, length = 600): WorkoutBlock => ({
    kind: 'steady',
    seconds: seconds(length),
    target: share(target),
  });
  const WARM_UP = steady(0.5);
  const COOL_DOWN = steady(0.45);

  /** Moves made 1 000 s apart, each on the plan the one before it made. */
  function sequence(
    workout: Workout,
    moves: readonly unknown[],
    overrides: Partial<PlanState> = {},
  ): PlanRevision {
    let plan = loadPlan(workout);
    for (const [index, move] of moves.entries()) {
      const at = 2000 + index * 1000;
      plan = accepted(later(move, plan), after(plan, at, overrides)).plan;
    }
    return plan;
  }

  const targetsOf = (plan: PlanRevision): number[][] =>
    plan.blocks.map((entry) => sharesOf(entry.block));

  describe('an easier move takes full effect after a harder one that changed nothing', () => {
    // The issue's own measurement: steady 0.7, 0.8 (the loaded peak) and 0.4.
    const PEAKED: Workout = {
      name: 'Peaked',
      blocks: [WARM_UP, steady(0.7), steady(0.8), steady(0.4), COOL_DOWN],
    };

    it('eases the peak block by the whole of a −5 that follows a +5', () => {
      const alone = targetsOf(sequence(PEAKED, [scale(-5)]));
      expect(alone[1]?.[0]).toBeCloseTo(0.665, 12);
      expect(alone[2]?.[0]).toBeCloseTo(0.76, 12);
      expect(alone[3]?.[0]).toBeCloseTo(0.38, 12);

      const raised = sequence(PEAKED, [scale(5)]);
      // The peak block was asked for more and given none: its count has not moved.
      expect(targetsOf(raised)[2]).toStrictEqual([0.8]);
      expect(raised.blocks[2]?.percents).toStrictEqual([0]);
      expect(raised.blocks[1]?.percents).toStrictEqual([5]);

      const eased = targetsOf(sequence(PEAKED, [scale(5), scale(-5)]));
      expect(eased[1]?.[0]).toBe(0.7);
      expect(eased[2]?.[0]).toBeCloseTo(0.76, 12);
      expect(eased[3]?.[0]).toBe(0.4);

      const easedTwice = targetsOf(sequence(PEAKED, [scale(5), scale(-10)]));
      expect(easedTwice[2]?.[0]).toBeCloseTo(0.72, 12);
    });

    it('counts each share of a block on its own', () => {
      // Intervals 0.9 / 0.5 are the loaded peak: +5 raises only the easy share.
      const raised = sequence(LOADED, [scale(5)]);
      expect(raised.blocks[2]?.percents).toStrictEqual([0, 5]);
      const eased = targetsOf(sequence(LOADED, [scale(5), scale(-5)]));
      expect(eased[2]?.[0]).toBeCloseTo(0.855, 12);
      expect(eased[2]?.[1]).toBe(0.5);
    });

    it('keeps the change a share reached when a bound stopped it part of the way', () => {
      // 0.78 can rise to the loaded peak of 0.8 and no further: 2.56 points, not 5.
      const near: Workout = {
        name: 'Near',
        blocks: [WARM_UP, steady(0.78), steady(0.8), COOL_DOWN],
      };
      const raised = sequence(near, [scale(5)]);
      expect(targetsOf(raised)[1]).toStrictEqual([0.8]);
      expect(raised.blocks[1]?.percents[0]).toBeCloseTo((0.8 / 0.78 - 1) * 100, 9);
      // −5 is then 5 points of 0.78 below what is ridden.
      const eased = targetsOf(sequence(near, [scale(5), scale(-5)]));
      expect(eased[1]?.[0]).toBeCloseTo(0.8 - 0.05 * 0.78, 12);
    });

    it('does not spend the +10 % on a rise that did not happen', () => {
      // Two +5 moves: 0.7 reaches the loaded peak of 0.75 on the second, and the
      // peak block itself is never raised.
      const one: Workout = {
        name: 'One',
        blocks: [WARM_UP, steady(0.7), steady(0.4), steady(0.75), COOL_DOWN],
      };
      const plan = sequence(one, [scale(5), scale(5)]);
      expect(targetsOf(plan)[1]).toStrictEqual([0.75]);
      expect(plan.blocks[1]?.percents[0]).toBeCloseTo((0.75 / 0.7 - 1) * 100, 9);
      expect(plan.blocks[2]?.percents).toStrictEqual([10]);
      expect(plan.blocks[3]?.percents).toStrictEqual([0]);
      // The 0.4 block is at +10: a third rise is over the allowance.
      expect(ruleOf(later(scale(5), plan), after(plan, 9000))).toBe('P4');
    });

    it('takes a harder move in full after a cut the floor stopped', () => {
      const low: Workout = { name: 'Low', blocks: [WARM_UP, steady(0.21), COOL_DOWN] };
      const cut = sequence(low, [scale(-10)]);
      expect(targetsOf(cut)[1]).toStrictEqual([0.2]);
      expect(cut.blocks[1]?.percents[0]).toBeCloseTo((0.2 / 0.21 - 1) * 100, 9);
      const back = targetsOf(sequence(low, [scale(-10), scale(5)]));
      expect(back[1]?.[0]).toBeCloseTo(0.2 + 0.05 * 0.21, 12);
    });
  });

  describe('ruling 2: a swap is bound by +5 % a move and +10 % in total', () => {
    const saved = (...targets: number[]): readonly SavedWorkout[] => [
      { id: 's', workout: { name: 'S', blocks: targets.map((target) => steady(target)) } },
    ];
    // The loaded steady peak is 1.0, so P3 refuses none of these.
    const ROOMY: Workout = {
      name: 'Roomy',
      blocks: [
        WARM_UP,
        steady(0.7),
        steady(1),
        { kind: 'free-ride', seconds: seconds(600) },
        COOL_DOWN,
      ],
    };
    const at = (position: number, library: readonly SavedWorkout[], plan = loadPlan(ROOMY)) =>
      stateOf({ plan, position: seconds(position), library });

    it('refuses a rise of more than 5 % over the block it replaces', () => {
      const library = saved(0.8, 0.735, 0.736, 0.6);
      const rule = (blockIndex: number) =>
        ruleOf(proposalOf(swapOf('s', blockIndex)), { state: at(100, library) });
      // 0.7 for the loaded 0.8 was accepted before #1296: 14 % in one move.
      expect(rule(0)).toBe('P4');
      // Exactly +5 %, which 0.735 / 0.7 is only to within rounding.
      expect(rule(1)).toBe('accepted');
      expect(rule(2)).toBe('P4');
      expect(rule(3)).toBe('accepted');
    });

    it('counts the rise, and what the replaced block was raised by, toward the +10 %', () => {
      const library = saved(0.77, 0.772, 0.7);
      const state = (plan: PlanRevision) => ({ library, plan });
      // +5 % by a scale: 0.735. A swap to 0.77 is 5 more points of the loaded
      // 0.7, 10 in all (#1300; 9.76 when each rise was counted over the last).
      const raised = sequence(ROOMY, [scale(5)], { library });
      expect(raised.blocks[1]?.percents).toStrictEqual([5]);
      const swapped = accepted(later(swapOf('s', 0), raised), after(raised, 9000, state(raised)));
      const entry = swapped.plan.blocks[1];
      expect(entry?.block).toStrictEqual(steady(0.77));
      expect(entry?.percents).toStrictEqual([0]);
      expect(entry?.loadedShare).toBe(0.7);
      expect(entry?.carried).toBeCloseTo(10, 9);
      // 0.772 is 5.03 % over 0.735: over a move's +5 %.
      expect(ruleOf(later(swapOf('s', 1), raised), after(raised, 9000, state(raised)))).toBe('P4');

      // The count did not go back to 0: another +5 % would be 15.5.
      const plan = swapped.plan;
      expect(ruleOf(later(scale(5), plan), after(plan, 12000, state(plan)))).toBe('P4');
      // An easier move is still taken, in full, from the share swapped in.
      const eased = accepted(later(scale(-5), plan), after(plan, 12000, state(plan)));
      expect(sharesOf(eased.plan.blocks[1]?.block as WorkoutBlock)[0]).toBeCloseTo(0.7315, 12);

      // At +10 by scales, a swap may not rise at all, and a fall earns nothing back.
      const full = sequence(ROOMY, [scale(5), scale(5)], { library });
      expect(ruleOf(later(swapOf('s', 1), full), after(full, 9000, state(full)))).toBe('P4');
      const fallen = accepted(later(swapOf('s', 2), full), after(full, 9000, state(full)));
      expect(fallen.plan.blocks[1]?.carried).toBeCloseTo(10, 9);
      expect(
        ruleOf(later(scale(5), fallen.plan), after(fallen.plan, 12000, state(fallen.plan))),
      ).toBe('P4');
    });

    it('carries the count from one swap to the next in the same place', () => {
      const library = saved(0.735, 0.77, 0.8);
      const state = (plan: PlanRevision) => ({ library, plan });
      // +5 %, then +4.76 % of that: 10 % of the loaded 0.7 in all (#1300).
      const twice = sequence(ROOMY, [swapOf('s', 0), swapOf('s', 1)], { library });
      expect(twice.blocks[1]?.block).toStrictEqual(steady(0.77));
      expect(twice.blocks[1]?.carried).toBeCloseTo(10, 9);
      // 0.8 is 3.9 % over 0.77, a move's worth, and 14.3 % over the loaded 0.7.
      expect(ruleOf(later(swapOf('s', 2), twice), after(twice, 9000, state(twice)))).toBe('P4');
    });

    it('takes a swap of exactly +5 % as 5, and a second rise of exactly 5 as 10', () => {
      const library = saved(0.735, 0.77);
      const state = (plan: PlanRevision) => ({ library, plan });
      const swapped = sequence(ROOMY, [swapOf('s', 0)], { library });
      // 0.735 / 0.7 is 1.05 only to within rounding, and neither limit refuses it for that.
      expect(swapped.blocks[1]?.carried).toBeCloseTo(5, 9);
      // 0.77 is 10 % over the loaded 0.7, again only to within rounding.
      expect(ruleOf(later(swapOf('s', 1), swapped), after(swapped, 9000, state(swapped)))).toBe(
        'accepted',
      );
      // Eased by 5 and brought back by 5: not refused either.
      const undone = sequence(ROOMY, [swapOf('s', 0), scale(-5), scale(5)], { library });
      expect(undone.blocks[1]?.percents).toStrictEqual([0]);
    });

    it('refuses a block with a target in place of a free ride, and is a harder move', () => {
      const library = saved(0.3);
      // 1 300 s: riding the 1.0 block, and the next block is the free ride.
      expect(ruleOf(proposalOf(swapOf('s', 0)), { state: at(1300, library) })).toBe('P4');
      // An easier block is still a harder move: it starts P4's ten minutes.
      const easier = accepted(proposalOf(swapOf('s', 0)), { state: at(100, library) });
      expect(easier.plan.lastHarderAt).toBe(NOW);
    });

    it('lets a hold swapped in for a hold raise the range by 5 bpm at most', () => {
      const hold = (low: number, high: number): WorkoutBlock => ({
        kind: 'heart-rate-hold',
        seconds: seconds(600),
        range: { low: beatsPerMinute(low), high: beatsPerMinute(high) },
        startShare: share(0.6),
        ceilingShare: share(0.7),
      });
      const holds: Workout = {
        name: 'Holds',
        blocks: [WARM_UP, hold(120, 130), hold(130, 140), COOL_DOWN],
      };
      const library: readonly SavedWorkout[] = [
        { id: 'h', workout: { name: 'H', blocks: [hold(125, 135), hold(126, 136)] } },
      ];
      const state = stateOf({ plan: loadPlan(holds), library });
      expect(ruleOf(proposalOf(swapOf('h', 0)), { state })).toBe('accepted');
      // 136 is inside the highest range loaded (140), and 6 above the hold it replaces.
      expect(ruleOf(proposalOf(swapOf('h', 1)), { state })).toBe('P4');
    });
  });

  describe('#1300, ruling a: the +10 % is of the share the place was loaded with', () => {
    const saved = (...targets: number[]): readonly SavedWorkout[] => [
      { id: 's', workout: { name: 'S', blocks: targets.map((target) => steady(target)) } },
    ];
    // The loaded steady peak is 1.0, so P3 refuses none of these.
    const ROOMY: Workout = {
      name: 'Roomy',
      blocks: [WARM_UP, steady(0.7), steady(1), COOL_DOWN],
    };
    const state = (library: readonly SavedWorkout[]) => (plan: PlanRevision) => ({
      library,
      plan,
    });

    it("refuses the issue's own measurement: 0.7, 0.735, then 0.77175", () => {
      const library = saved(0.735, 0.77175, 0.77);
      const once = sequence(ROOMY, [swapOf('s', 0)], { library });
      const call = after(once, 9000, state(library)(once));
      // +5 % of +5 % is 10.25 % over the loaded 0.7. Each move is 5 % or less.
      expect(ruleOf(later(swapOf('s', 1), once), call)).toBe('P4');
      // A true 10 % is the most there is.
      const twice = accepted(later(swapOf('s', 2), once), call).plan;
      expect(twice.blocks[1]?.block).toStrictEqual(steady(0.77));
      expect(twice.blocks[1]?.loadedShare).toBe(0.7);
    });

    it('refuses a +5 % scale of a block swapped in at +5 %, which would compound', () => {
      const library = saved(0.735);
      const swapped = sequence(ROOMY, [swapOf('s', 0)], { library });
      // 0.735 × 1.05 is 0.77175: 5 points, and 5.25 more.
      expect(ruleOf(later(scale(5), swapped), after(swapped, 9000, state(library)(swapped)))).toBe(
        'P4',
      );
    });

    it('counts a rise in points of the loaded share, not of the share ridden', () => {
      const library = saved(0.66);
      // Cut to 0.63, then 0.66: 4.76 % over what is ridden, 4.29 % of the loaded 0.7.
      const plan = sequence(ROOMY, [scale(-10), swapOf('s', 0)], { library });
      expect(plan.blocks[1]?.block).toStrictEqual(steady(0.66));
      expect(plan.blocks[1]?.carried).toBeCloseTo((0.03 / 0.7) * 100, 9);
    });

    it('counts a scale of a block swapped in by the share it moves, in the same points', () => {
      const library = saved(0.35);
      // +5 by a scale (5 points), then a fall to 0.35, which earns nothing back.
      const fallen = sequence(ROOMY, [scale(5), swapOf('s', 0)], { library });
      expect(fallen.blocks[1]?.carried).toBeCloseTo(5, 9);
      // +10 % of 0.35 is 0.035, which is 5 points of the loaded 0.7: 10 in all.
      const raised = sequence(ROOMY, [scale(5), swapOf('s', 0), scale(5), scale(5)], { library });
      expect(sharesOf(raised.blocks[1]?.block as WorkoutBlock)[0]).toBeCloseTo(0.385, 12);
      expect(raised.blocks[1]?.percents).toStrictEqual([10]);
    });

    it('still holds a block swapped in to +10 % of the share it joined with (ruling 7)', () => {
      const plain: Workout = { name: 'Plain', blocks: [WARM_UP, steady(0.7), COOL_DOWN] };
      const library = saved(0.3);
      // 0.3 for 0.7, then +5 twice: 0.33, which is far under the loaded share.
      const plan = sequence(plain, [swapOf('s', 0), scale(5), scale(5)], { library });
      expect(sharesOf(plan.blocks[1]?.block as WorkoutBlock)[0]).toBeCloseTo(0.33, 12);
      expect(plan.blocks[1]?.carried).toBe(0);
      expect(ruleOf(later(scale(5), plan), after(plan, 9000, state(library)(plan)))).toBe('P4');
    });

    it('ruling c, kept: one block with nothing left refuses a +5 % for them all', () => {
      const three: Workout = {
        name: 'Three',
        blocks: [WARM_UP, steady(0.7), steady(0.6), steady(1), COOL_DOWN],
      };
      const library = saved(0.735);
      const swapped = sequence(three, [swapOf('s', 0)], { library });
      const call = after(swapped, 9000, state(library)(swapped));
      // The 0.6 block has all of its +10 % left, and is not raised alone.
      expect(ruleOf(later(scale(5), swapped), call)).toBe('P4');
      expect(ruleOf(later(scale(-5), swapped), call)).toBe('accepted');
    });
  });

  describe('#1300, ruling b: a replaced hold is measured at its start share', () => {
    const hold = (start: number, ceiling: number): WorkoutBlock => ({
      kind: 'heart-rate-hold',
      seconds: seconds(600),
      range: { low: beatsPerMinute(120), high: beatsPerMinute(130) },
      startShare: share(start),
      ceilingShare: share(ceiling),
    });
    const libraryOf = (...blocks: WorkoutBlock[]): readonly SavedWorkout[] => [
      { id: 'b', workout: { name: 'B', blocks } },
    ];
    // The loaded peaks are 1.0 for a steady block and 0.85 for a hold.
    const HELD: Workout = {
      name: 'Held',
      blocks: [WARM_UP, hold(0.5, 0.85), steady(1), COOL_DOWN],
    };
    const CAPPED: Workout = {
      name: 'Capped',
      blocks: [WARM_UP, hold(0.5, 0.7), hold(0.5, 0.85), COOL_DOWN],
    };
    const rule = (workout: Workout, library: readonly SavedWorkout[], blockIndex: number) =>
      ruleOf(proposalOf(swapOf('b', blockIndex)), {
        state: stateOf({ plan: loadPlan(workout), library }),
      });

    it("refuses the issue's own measurement: steady 0.89 for a hold that starts at 0.5", () => {
      const library = libraryOf(steady(0.89), steady(0.525), steady(0.53));
      expect(loadPlan(HELD).blocks[1]?.loadedShare).toBe(0.5);
      // 4.7 % over the ceiling of 0.85, and 78 % over where the hold starts.
      expect(rule(HELD, library, 0)).toBe('P4');
      // +5 % of the start share is the most.
      expect(rule(HELD, library, 1)).toBe('accepted');
      expect(rule(HELD, library, 2)).toBe('P4');
    });

    it('measures the +10 % in that place against the start share too', () => {
      const library = libraryOf(steady(0.525), steady(0.55), steady(0.5513));
      const swapped = sequence(HELD, [swapOf('b', 0)], { library });
      expect(swapped.blocks[1]?.carried).toBeCloseTo(5, 9);
      const call = after(swapped, 9000, { library, plan: swapped });
      // Each is 5 % or less over 0.525. 0.55 is 10 % over 0.5, and 0.5513 is more.
      expect(ruleOf(later(swapOf('b', 1), swapped), call)).toBe('accepted');
      expect(ruleOf(later(swapOf('b', 2), swapped), call)).toBe('P4');
    });

    it('compares a hold swapped in for a hold start with start and ceiling with ceiling', () => {
      const library = libraryOf(hold(0.5, 0.7), hold(0.53, 0.7), hold(0.5, 0.74), hold(0.5, 0.735));
      // The same hold again: its ceiling is not read against the other's start.
      expect(rule(CAPPED, library, 0)).toBe('accepted');
      // A start 6 % higher.
      expect(rule(CAPPED, library, 1)).toBe('P4');
      // A ceiling 5.7 % higher, inside the loaded peak of 0.85.
      expect(rule(CAPPED, library, 2)).toBe('P4');
      // A ceiling 5 % higher is 0.035, which is 7 points of the loaded start share.
      const raised = accepted(proposalOf(swapOf('b', 3)), {
        state: stateOf({ plan: loadPlan(CAPPED), library }),
      });
      expect(raised.plan.blocks[1]?.carried).toBeCloseTo(7, 9);
    });
  });

  it('ruling 3: shortening a recovery is a harder move', () => {
    const shortenOf = (block: number) => ({ kind: 'shorten-block', block, minutes: 1 });
    const harderAt = (block: number, position = 100) =>
      accepted(proposalOf(shortenOf(block)), { state: stateOf({ position: seconds(position) }) })
        .plan.lastHarderAt;
    // 0.7 before intervals that reach 0.9.
    expect(harderAt(1)).toBe(NOW);
    // The hold starts at 0.6, before 0.8.
    expect(harderAt(3)).toBe(NOW);
    // 0.8 before a free ride, which asks for nothing.
    expect(harderAt(4)).toBeUndefined();
    // A free ride before the cool-down's 0.45.
    expect(harderAt(5)).toBe(NOW);
    // A block as hard as the one after it is not a recovery.
    const level = loadPlan({
      name: 'Level',
      blocks: [WARM_UP, steady(0.7), steady(0.7), COOL_DOWN],
    });
    expect(
      accepted(proposalOf(shortenOf(1)), { state: stateOf({ plan: level }) }).plan.lastHarderAt,
    ).toBeUndefined();

    // A ramp from 0.4 to 0.8 before 0.7: its lowest share is what is compared.
    const ramped = loadPlan({
      name: 'Ramped',
      blocks: [
        WARM_UP,
        { kind: 'ramp', seconds: seconds(600), from: share(0.4), to: share(0.8) },
        steady(0.7),
        COOL_DOWN,
      ],
    });
    expect(
      accepted(proposalOf(shortenOf(1)), { state: stateOf({ plan: ramped }) }).plan.lastHarderAt,
    ).toBe(NOW);

    // Bound as a harder move is: one in ten minutes.
    const first = accepted(proposalOf({ kind: 'scale-remaining-intervals', percent: 5 }));
    const recovery = later(shortenOf(1), first.plan);
    expect(ruleOf(recovery, after(first.plan, NOW + 599))).toBe('P4');
    expect(ruleOf(recovery, after(first.plan, NOW + 600))).toBe('accepted');
    expect(ruleOf(later(shortenOf(4), first.plan), after(first.plan, NOW + 599))).toBe('accepted');
    // And it starts the ten minutes for the next one.
    const shortened = accepted(proposalOf(shortenOf(1)));
    expect(ruleOf(later(scale(5), shortened.plan), after(shortened.plan, NOW + 599))).toBe('P4');
  });

  it('ruling 4: a free ride is swapped in with none loaded, and no other kind is', () => {
    const plain: Workout = { name: 'Plain', blocks: [WARM_UP, steady(0.7), COOL_DOWN] };
    const library: readonly SavedWorkout[] = [
      {
        id: 'f',
        workout: {
          name: 'F',
          blocks: [
            { kind: 'free-ride', seconds: seconds(300) },
            { kind: 'ramp', seconds: seconds(300), from: share(0.4), to: share(0.6) },
          ],
        },
      },
    ];
    const state = stateOf({ plan: loadPlan(plain), library });
    const free = accepted(proposalOf(swapOf('f', 0)), { state });
    expect(free.workout.blocks[1]).toStrictEqual({ kind: 'free-ride', seconds: 300 });
    expect(ruleOf(proposalOf(swapOf('f', 1)), { state })).toBe('P3');
  });

  it("ruling 5: the machine's minimum is not read", () => {
    // Threshold 200 W and a trainer that goes no lower than 100 W: −10 % of 0.4 is 72 W.
    const light: Workout = { name: 'Light', blocks: [WARM_UP, steady(0.4), COOL_DOWN] };
    const result = accepted(proposalOf(scale(-10)), {
      state: stateOf({ plan: loadPlan(light) }),
      athlete: { ...ATHLETE, thresholdPower: watts(200) },
      machine: { minimum: watts(100), maximum: watts(1000) },
    });
    const target = sharesOf(result.workout.blocks[1] as WorkoutBlock)[0] ?? 0;
    expect(target * 200).toBeCloseTo(72, 9);
  });
});

describe('planNotApplied — an accepted move dropped before its boundary (#1244)', () => {
  const SCALE: PlanMove = { kind: 'scale-remaining-intervals', percent: 5 };
  const first = accepted(proposalOf(SCALE));
  const kept = planNotApplied(loadPlan(LOADED), first.plan);

  it('keeps the blocks being ridden, not the dropped move’s', () => {
    expect(planWorkout(kept)).toEqual(LOADED);
    expect(planWorkout(first.plan)).not.toEqual(LOADED);
  });

  it('takes a revision number neither plan has had', () => {
    expect(kept.revision).toBe(2);
  });

  it('refuses a proposal that names the dropped revision — P5', () => {
    const stale = proposalOf(SCALE, { revision: first.plan.revision, summarySeq: 8 });
    expect(ruleOf(stale, after(kept, 2000))).toBe('P5');
    // The same proposal naming the plan that stands is read.
    expect(ruleOf(later(SCALE, kept), after(kept, 2000))).toBe('accepted');
  });

  it('still counts the dropped move toward P4’s three minutes', () => {
    expect(ruleOf(later({ kind: 'end-main-set' }, kept), after(kept, NOW + 179))).toBe('P4');
    expect(ruleOf(later({ kind: 'end-main-set' }, kept), after(kept, NOW + 180))).toBe('accepted');
  });

  it('still counts a dropped harder move toward P4’s ten minutes', () => {
    expect(ruleOf(later(SCALE, kept), after(kept, NOW + 599))).toBe('P4');
    expect(ruleOf(later(SCALE, kept), after(kept, NOW + 600))).toBe('accepted');
  });
});

describe('readReplanRecord — what a ride kept, read whole or not at all (#1244, P9)', () => {
  const MOVE: PlanMove = { kind: 'extend-block', block: 3, minutes: 5 };
  const ACCEPTED = { decision: 'accepted', move: MOVE, reason: 'on-plan', revision: 2, at: 1234 };
  const REFUSED = { decision: 'refused', rule: 'P4', move: MOVE, reason: 'on-plan', at: 1234 };
  const BARE = { decision: 'refused', rule: 'P1', at: 1234 };
  const DROPPED = { decision: 'not-applied', why: 'kept', revision: 2, at: 1234 };

  it.each([
    ['an accepted move', ACCEPTED],
    ['a refusal with its move', REFUSED],
    ['a refusal of something that did not decode', BARE],
    ['a move that was not ridden', DROPPED],
  ])('reads %s as itself, in a new object', (_, record) => {
    const read = readReplanRecord(record);
    expect(read).toEqual(record);
    expect(read).not.toBe(record);
  });

  it('reads every record the validator itself makes', () => {
    const made = [
      accepted(proposalOf({ kind: 'end-main-set' })).record,
      decide(proposalOf(MOVE, { revision: 9 })).record,
      decide({ nonsense: true }).record,
    ];
    expect(made.map((each) => each.decision)).toEqual(['accepted', 'refused', 'refused']);
    for (const record of made) {
      // As JSON, the way a row holds it: a refusal's absent move is no key.
      expect(readReplanRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    }
  });

  it('reads every reason a move may not have been ridden for', () => {
    for (const why of REPLAN_NOT_APPLIED) {
      expect(readReplanRecord({ ...DROPPED, why })).toEqual({ ...DROPPED, why });
    }
  });

  it.each([
    ['one key too many', { ...ACCEPTED, text: 'ease off' }],
    ['a move off the list', { ...ACCEPTED, move: { kind: 'extend-block', block: 3, minutes: 4 } }],
    ['a move with a key too many', { ...ACCEPTED, move: { ...MOVE, watts: 400 } }],
    ['a reason off the list', { ...ACCEPTED, reason: 'tired' }],
    ['a revision that is not a count', { ...ACCEPTED, revision: -1 }],
    [
      'an accepted move with no move',
      { decision: 'accepted', reason: 'on-plan', revision: 2, at: 1 },
    ],
    ['a rule off the list', { ...BARE, rule: 'P9' }],
    ['a refusal with a move and no reason', { decision: 'refused', rule: 'P4', move: MOVE, at: 1 }],
    ['a refusal with a reason and no move', { ...BARE, reason: 'on-plan' }],
    ['a reason it was not ridden off the list', { ...DROPPED, why: 'bored' }],
    ['a decision off the list', { ...BARE, decision: 'ignored' }],
    ['a time that is not a number', { ...BARE, at: '1234' }],
    ['a negative time', { ...BARE, at: -1 }],
    ['a time that is not finite', { ...BARE, at: Number.POSITIVE_INFINITY }],
    ['no time', { decision: 'refused', rule: 'P1' }],
    ['a list', [BARE]],
    ['nothing', null],
  ])('reads %s as nothing', (_, value) => {
    expect(readReplanRecord(value)).toBeUndefined();
  });
});
