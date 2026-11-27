// SPDX-License-Identifier: Apache-2.0

/**
 * #3301: the no-drop rule's own table, a window at a time, on lines laid out
 * by hand. What the bots then ride is `step.test.ts`; the issue's criteria on
 * whole rides through the real physics are
 * `packages/physics/src/group-no-drop.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { BotCapacity } from '../lap-race/wbal';
import { pacerTerrainAt } from '../pacer/terrain-rule';
import { GroupRideError } from './errors';
import { courseOf, FLAT_COURSE } from './fixtures/courses';
import noDropSource from './no-drop.ts?raw';
import {
  NO_DROP_FULL_EASE_SECONDS,
  NO_DROP_GAPPED_METRES,
  NO_DROP_REACH_METRES,
  NO_DROP_SETTLE_MS,
  noDropRole,
  RIDER_STANDINGS,
  startNoDrop,
  stepNoDrop,
  type NoDropState,
  type NoDropView,
} from './no-drop';
import { RIDER_ROLES, type LinePhase } from './roles';
import { startRotation, type LineMember, type MemberView, type RotationState } from './rotation';

const PLAN_MPS = 8;
const FLAT = courseOf(FLAT_COURSE);
/** Level, 400 m at 6 % from 1 000 m, level: the top is at 1 400 m. */
const CLIMB = courseOf([
  [1_000, 0],
  [400, 6],
  [2_000, 0],
]);

function bot(id: string): LineMember {
  const capacity: BotCapacity = {
    cpWatts: 300,
    wPrimeJoules: 20_000,
    peakWatts: 600,
    floorWatts: 0,
  };
  return { id, kind: 'bot', capacity };
}
const RIDER: LineMember = { id: 'you', kind: 'rider' };
const MEMBERS: readonly LineMember[] = [bot('b1'), bot('b2'), bot('b3'), RIDER];

/** A steady line in `order`, with `aside` out of it. */
function lineOf(
  order: readonly string[] = ['b1', 'b2', 'b3', 'you'],
  phase: LinePhase = 'steady',
  aside: string | null = null,
): RotationState {
  return { ...startRotation({ line: MEMBERS, seed: 1, atMs: 0 }), phase, order, aside };
}

/** Odometers by id, every member at `speedMps` unless the rider's is named. */
function membersAt(
  at: Readonly<Record<string, number>>,
  riderSpeedMps = PLAN_MPS,
): Readonly<Record<string, MemberView>> {
  return Object.fromEntries(
    Object.entries(at).map(([id, distanceM]) => [
      id,
      { distanceM, speedMps: id === 'you' ? riderSpeedMps : PLAN_MPS },
    ]),
  );
}

/** The bots a wheel gap apart from `frontM` back, and the rider `behindM` behind b3. */
function riderBehind(behindM: number, riderSpeedMps = PLAN_MPS, frontM = 500) {
  return membersAt(
    { b1: frontM, b2: frontM - 0.65, b3: frontM - 1.3, you: frontM - 1.3 - behindM },
    riderSpeedMps,
  );
}

function viewOf(
  members: Readonly<Record<string, MemberView>>,
  more: Partial<NoDropView> = {},
): NoDropView {
  return {
    atMs: 0,
    rotation: lineOf(),
    members,
    groupSpeedMps: PLAN_MPS,
    course: FLAT,
    riderStopped: false,
    ...more,
  };
}

const START = startNoDrop(0);
const decide = (members: Readonly<Record<string, MemberView>>, more: Partial<NoDropView> = {}) =>
  stepNoDrop(START, viewOf(members, more));

describe('where the rider stands', () => {
  it('is with the line on a wheel: no sweep, no hold, and the line untouched', () => {
    const view = viewOf(riderBehind(0.65));
    const step = stepNoDrop(START, view);
    expect(step.state).toEqual({
      nextWindowAtMs: 1_000,
      hold: null,
      standing: 'with',
      sweep: null,
      easedSpeedMps: null,
      insideSinceMs: null,
      overTheTop: false,
    });
    expect(step.rotation).toBe(view.rotation);
  });

  it('is gapped over 5 m off the wheel and off the back over the draft’s 30 m, and not at either', () => {
    expect(NO_DROP_GAPPED_METRES).toBe(5);
    expect(NO_DROP_REACH_METRES).toBe(30);
    expect(decide(riderBehind(5)).state.standing).toBe('with');
    expect(decide(riderBehind(5.01)).state.standing).toBe('gapped');
    expect(decide(riderBehind(30)).state.standing).toBe('gapped');
    expect(decide(riderBehind(30.01)).state.standing).toBe('off-the-back');
  });

  it('measures a rider in the middle of the line from the bot in the seat ahead, not from a bot behind them', () => {
    const rotation = lineOf(['b1', 'b2', 'you', 'b3']);
    // 6 m off b2's wheel, with b3 on their own.
    const members = membersAt({ b1: 500, b2: 499.35, you: 493.35, b3: 492.7 });
    const step = decide(members, { rotation });
    expect(step.state.standing).toBe('gapped');
    expect(step.state.sweep).toBe('b2');
    // They keep their seat: b3 stays on the rider's wheel.
    expect(step.rotation).toBe(rotation);
  });

  it('measures a rider who is aside after a pull from the line’s last wheel', () => {
    const rotation = lineOf(['b1', 'b2', 'b3'], 'latching', 'you');
    expect(decide(riderBehind(6), { rotation }).state).toMatchObject({
      standing: 'gapped',
      sweep: 'b3',
    });
    // Still drifting back beside the line: ahead of the last wheel, and with it.
    const beside = membersAt({ b1: 500, b2: 499.35, b3: 498.7, you: 500.4 });
    expect(
      decide(beside, { rotation: lineOf(['b1', 'b2', 'b3'], 'changing', 'you') }).state,
    ).toMatchObject({ standing: 'with', sweep: null });
  });

  it('has a rider on the front with the line, whatever is behind them', () => {
    const rotation = lineOf(['you', 'b1', 'b2', 'b3']);
    const members = membersAt({ you: 500, b1: 440, b2: 439, b3: 438 }, 3);
    expect(decide(members, { rotation }).state).toMatchObject({ standing: 'with', hold: null });
  });

  it('never holds a line with no rider in it', () => {
    const bots = [bot('b1'), bot('b2'), bot('b3')];
    const rotation: RotationState = {
      ...startRotation({ line: bots, seed: 1, atMs: 0 }),
      phase: 'steady',
    };
    const view = viewOf(membersAt({ b1: 500, b2: 460, b3: 400 }), { rotation });
    const step = stepNoDrop(START, view);
    expect(step.state).toEqual({ ...START, nextWindowAtMs: 1_000 });
    expect(step.rotation).toBe(rotation);
  });
});

describe('the sweep', () => {
  it('is the last bot of the line ahead of a rider who is gapped or off the back, and nobody otherwise', () => {
    expect(decide(riderBehind(0.65)).state.sweep).toBeNull();
    expect(decide(riderBehind(12)).state.sweep).toBe('b3');
    expect(decide(riderBehind(45)).state.sweep).toBe('b3');
  });

  it('is nobody where only one bot is ahead of the rider: that bot is the line', () => {
    const rotation = lineOf(['b1', 'you', 'b2', 'b3']);
    const members = membersAt({ b1: 500, you: 488, b2: 487.35, b3: 486.7 });
    expect(decide(members, { rotation }).state).toMatchObject({ standing: 'gapped', sweep: null });
  });

  it('is not counted once it is back with the rider: the gap is to the bot ahead of it', () => {
    // b3 has dropped back to sit a wheel gap ahead of the rider, 12 m behind b2.
    const members = membersAt({ b1: 500, b2: 499.35, b3: 487.35, you: 486.7 });
    const sweeping: NoDropState = { ...START, standing: 'gapped', sweep: 'b3' };
    expect(stepNoDrop(sweeping, viewOf(members)).state).toMatchObject({
      standing: 'gapped',
      sweep: 'b3',
    });
    // A bot that is not the sweep, in the same place, is a wheel the rider is on.
    expect(stepNoDrop(START, viewOf(members)).state).toMatchObject({
      standing: 'with',
      sweep: null,
    });
    // Back within 5 m of b2 behind their sweep, the rider is with the line and nobody sweeps.
    const back = membersAt({ b1: 500, b2: 499.35, b3: 495.4, you: 494.75 });
    expect(stepNoDrop(sweeping, viewOf(back)).state).toMatchObject({
      standing: 'with',
      sweep: null,
    });
  });
});

describe('a rider off the front', () => {
  it('gives up a seat in the middle of the line: no bot follows them up the road', () => {
    const rotation = lineOf(['b1', 'b2', 'you', 'b3']);
    const members = membersAt({ you: 512, b1: 500, b2: 499.35, b3: 498 }, 11);
    const step = decide(members, { rotation, riderStopped: true });
    expect(step.rotation.order).toEqual(['b1', 'b2', 'b3', 'you']);
    expect(step.rotation.phase).toBe('steady');
    // Not chased and not waited for, a stopped rider included: the line rides up to them.
    expect(step.state).toMatchObject({
      standing: 'off-the-front',
      sweep: null,
      hold: null,
      easedSpeedMps: null,
    });
  });

  it('keeps the order where the rider is already at the back of it', () => {
    const rotation = lineOf();
    const members = membersAt({ you: 512, b1: 500, b2: 499.35, b3: 498.7 }, 11);
    const step = decide(members, { rotation });
    expect(step.state.standing).toBe('off-the-front');
    expect(step.rotation).toBe(rotation);
  });

  it('is not a rider who has just pulled off and is still ahead of the new front', () => {
    const rotation = lineOf(['b1', 'b2', 'b3'], 'changing', 'you');
    const members = membersAt({ you: 500.65, b1: 500, b2: 499.35, b3: 498.7 });
    expect(decide(members, { rotation }).state.standing).toBe('with');
  });
});

describe('waiting', () => {
  it('does not hold the line for a gapped rider', () => {
    const view = viewOf(riderBehind(25));
    const step = stepNoDrop(START, view);
    expect(step.state).toMatchObject({ standing: 'gapped', hold: null, easedSpeedMps: null });
    expect(step.rotation).toBe(view.rotation);
  });

  it.each(['forming', 'steady', 'changing', 'latching'] as const)(
    'holds a %s line for a rider off the back, and leaves its order and whoever is aside alone',
    (phase) => {
      const aside = phase === 'changing' || phase === 'latching' ? 'b1' : null;
      const order = aside === null ? ['b1', 'b2', 'b3', 'you'] : ['b2', 'b3', 'you'];
      const rotation = lineOf(order, phase, aside);
      const members = membersAt({ b1: 499, b2: 500, b3: 499.35, you: 460 });
      const step = decide(members, { rotation });
      expect(step.state).toMatchObject({ standing: 'off-the-back', hold: 'waiting' });
      expect(step.rotation).toEqual({ ...rotation, phase: 'waiting' });
    },
  );

  const waiting: NoDropState = { ...START, hold: 'waiting', standing: 'off-the-back', sweep: 'b3' };

  it('keeps waiting while the rider is inside the reach and not yet on a wheel', () => {
    // 20 m behind b2, their sweep b3 a wheel gap ahead of them.
    const members = membersAt({ b1: 500, b2: 499.35, b3: 480, you: 479.35 });
    const step = stepNoDrop(waiting, viewOf(members, { rotation: lineOf(undefined, 'waiting') }));
    expect(step.state).toMatchObject({ standing: 'gapped', hold: 'waiting', sweep: 'b3' });
    expect(step.rotation.phase).toBe('waiting');
  });

  it('releases the line to steady when the rider is back on a wheel', () => {
    const members = membersAt({ b1: 500, b2: 499.35, b3: 495.6, you: 494.95 });
    const step = stepNoDrop(waiting, viewOf(members, { rotation: lineOf(undefined, 'waiting') }));
    expect(step.state).toMatchObject({ standing: 'with', hold: null, easedSpeedMps: null });
    expect(step.rotation.phase).toBe('steady');
  });

  it('releases a line that was changing to changing: whoever was aside finishes coming round', () => {
    const rotation = lineOf(['b2', 'b3', 'you'], 'waiting', 'b1');
    const members = membersAt({ b1: 497, b2: 500, b3: 499.35, you: 498.7 });
    const step = stepNoDrop({ ...waiting, sweep: null }, viewOf(members, { rotation }));
    expect(step.state.hold).toBeNull();
    expect(step.rotation).toEqual({ ...rotation, phase: 'changing' });
  });

  it('waits for a rider who has stopped, wherever they are in the line, until they ride again', () => {
    const rotation = lineOf(['b1', 'b2', 'you', 'b3']);
    const members = membersAt({ b1: 500, b2: 499.35, you: 498.7, b3: 498.05 }, 6);
    const stopped = decide(members, { rotation, riderStopped: true });
    expect(stopped.state).toMatchObject({ standing: 'with', hold: 'waiting', sweep: null });
    expect(stopped.rotation.phase).toBe('waiting');
    // Their speed, less the wheel gap they are behind b2: 0.65 m of the 60 m that 10 s is at 6 m/s.
    expect(stopped.state.easedSpeedMps).toBeCloseTo(6 * (1 - 0.65 / 60), 9);
    const riding = stepNoDrop(
      stopped.state,
      viewOf(members, { atMs: 1_000, rotation: stopped.rotation }),
    );
    expect(riding.state.hold).toBeNull();
    expect(riding.rotation.phase).toBe('steady');
  });
});

describe('how fast a held line rides', () => {
  const eased = (behindM: number, riderSpeedMps: number, planMps = PLAN_MPS) =>
    decide(riderBehind(behindM, riderSpeedMps), { groupSpeedMps: planMps }).state.easedSpeedMps;

  it('rides under the rider’s own speed by the share their time gap is of 10 s', () => {
    expect(NO_DROP_FULL_EASE_SECONDS).toBe(10);
    // 40 m at 8 m/s is 5 s: half.
    expect(eased(40, 8)).toBe(4);
    // 60 m at 8 m/s is 7.5 s: three quarters off.
    expect(eased(60, 8)).toBe(2);
  });

  it('never rides above the plan’s speed', () => {
    // A rider coming back fast: 12 × (1 − 36/120) is 8.4.
    expect(eased(36, 12)).toBe(PLAN_MPS);
    expect(eased(36, 12, 9)).toBeCloseTo(8.4, 9);
  });

  it('has no floor: far under the pacer’s 20 %, a crawl for a crawling rider, and nothing at 10 s or for a stopped one', () => {
    expect(eased(40, 8) as number).toBeLessThan(0.8 * PLAN_MPS);
    // 31 m behind at 3.5 m/s: 8.86 s.
    expect(eased(31, 3.5)).toBeCloseTo(3.5 * (1 - 31 / 35), 9);
    expect(eased(31, 3.5) as number).toBeLessThan(0.5);
    expect(eased(80, 8)).toBe(0);
    expect(eased(500, 8)).toBe(0);
    expect(eased(31, 0)).toBe(0);
  });

  it('stands still with a rider who has stopped in the line', () => {
    const members = membersAt({ b1: 500, b2: 499.35, b3: 498.7, you: 498.05 }, 0);
    expect(decide(members, { riderStopped: true }).state).toMatchObject({
      hold: 'waiting',
      easedSpeedMps: 0,
    });
  });
});

describe('regrouping over the top of a climb', () => {
  /** The line with its front at `frontM` on the climb's course and the rider `behindM` behind b3. */
  const at = (state: NoDropState, atMs: number, frontM: number, behindM: number, speed = 4) =>
    stepNoDrop(
      state,
      viewOf(riderBehind(behindM, speed, frontM), {
        atMs,
        course: CLIMB,
        rotation: lineOf(undefined, state.hold ?? 'steady'),
      }),
    );
  /** One window on the climb, 10 m under the top, with the rider `behindM` behind. */
  const climbing = (behindM: number): NoDropState => at(START, 0, 1_390, behindM).state;

  it('reads the top off the course: on the climb at 1 390 m, over the top at 1 410 m', () => {
    expect(pacerTerrainAt(CLIMB, 1_390)).toBe('none');
    expect(pacerTerrainAt(CLIMB, 1_410)).toBe('over-the-top');
  });

  it('begins when the front comes over the top with the rider gapped, and holds for the settle time', () => {
    const before = climbing(12);
    expect(before).toMatchObject({ standing: 'gapped', hold: null, overTheTop: false });
    const over = at(before, 1_000, 1_410, 12);
    expect(over.state).toMatchObject({
      hold: 'regrouping',
      insideSinceMs: 1_000,
      overTheTop: true,
    });
    expect(over.rotation.phase).toBe('regrouping');
    // Eased though the rider is inside the reach: 12.65 m behind b2, their sweep b3 not counted.
    expect(over.state.easedSpeedMps).toBeCloseTo(4 * (1 - 12.65 / 40), 9);
    let state = over.state;
    for (let atMs = 2_000; atMs < 1_000 + NO_DROP_SETTLE_MS; atMs += 1_000) {
      state = at(state, atMs, 1_410 + atMs / 250, 12).state;
      expect(state.hold).toBe('regrouping');
    }
    // Settled: the pace resumes, though the rider is still gapped. A wait is for a rider off the back.
    const settled = at(state, 1_000 + NO_DROP_SETTLE_MS, 1_460, 12);
    expect(settled.state).toMatchObject({ standing: 'gapped', hold: null, insideSinceMs: null });
    expect(settled.rotation.phase).toBe('steady');
  });

  it('with the rider 15 s behind, regroups until they are inside the reach and only then counts the settle time', () => {
    // 60 m at 4 m/s.
    const over = at(climbing(60), 1_000, 1_410, 60);
    expect(over.state).toMatchObject({
      standing: 'off-the-back',
      hold: 'regrouping',
      insideSinceMs: null,
    });
    expect(over.state.easedSpeedMps).toBe(0);
    // Half a minute beyond the reach: still regrouping, the settle not begun.
    const outside = at(over.state, 31_000, 1_420, 31).state;
    expect(outside).toMatchObject({ hold: 'regrouping', insideSinceMs: null });
    const inside = at(outside, 32_000, 1_420, 29).state;
    expect(inside).toMatchObject({ hold: 'regrouping', insideSinceMs: 32_000 });
    const nearly = at(inside, 41_000, 1_430, 8).state;
    expect(nearly.hold).toBe('regrouping');
    expect(at(nearly, 42_000, 1_430, 8).state.hold).toBeNull();
  });

  it('starts the settle time again for a rider who falls out of the reach during it', () => {
    const over = at(climbing(12), 1_000, 1_410, 12).state;
    const out = at(over, 6_000, 1_420, 40).state;
    expect(out).toMatchObject({ hold: 'regrouping', insideSinceMs: null });
    const back = at(out, 9_000, 1_420, 20).state;
    expect(back.insideSinceMs).toBe(9_000);
    expect(at(back, 18_000, 1_430, 20).state.hold).toBe('regrouping');
    expect(at(back, 19_000, 1_430, 20).state.hold).toBeNull();
  });

  it('turns a line that was waiting on the climb into a regrouping one over the top', () => {
    const waiting = climbing(60);
    expect(waiting.hold).toBe('waiting');
    const over = at(waiting, 1_000, 1_410, 60);
    expect(over.state.hold).toBe('regrouping');
    expect(over.rotation.phase).toBe('regrouping');
  });

  it('does not begin with the rider on a wheel, nor later on the same top', () => {
    const over = at(climbing(0.65), 1_000, 1_410, 0.65).state;
    expect(over).toMatchObject({ hold: null, overTheTop: true });
    // Gapped 20 m further on: the front came over the top a while ago.
    expect(at(over, 2_000, 1_430, 12).state.hold).toBeNull();
  });

  it('does not ease a regrouping line for a rider who has ridden past its front', () => {
    const over = at(climbing(12), 1_000, 1_410, 12).state;
    // 6 m ahead of b1, at 4 m/s where the plan asks 8.
    const past = stepNoDrop(
      over,
      viewOf(membersAt({ you: 1_426, b1: 1_420, b2: 1_419.35, b3: 1_418.7 }, 4), {
        atMs: 2_000,
        course: CLIMB,
        rotation: lineOf(undefined, 'regrouping'),
      }),
    );
    expect(past.state).toMatchObject({
      standing: 'off-the-front',
      hold: 'regrouping',
      easedSpeedMps: PLAN_MPS,
    });
  });

  it('goes on to wait, once settled, for a rider who has stopped', () => {
    const over = at(climbing(12), 1_000, 1_410, 12).state;
    const stopped = stepNoDrop(
      over,
      viewOf(riderBehind(12, 0, 1_420), {
        atMs: 11_000,
        course: CLIMB,
        rotation: lineOf(undefined, 'regrouping'),
        riderStopped: true,
      }),
    );
    expect(stopped.state.hold).toBe('waiting');
    expect(stopped.rotation.phase).toBe('waiting');
  });
});

describe('once per decision window', () => {
  it('returns the last decision and the line unchanged inside a window, and decides at the next', () => {
    const first = decide(riderBehind(12));
    expect(first.state.standing).toBe('gapped');
    // Half a second on and off the back: not yet.
    const view = viewOf(riderBehind(45), { atMs: 500 });
    const inside = stepNoDrop(first.state, view);
    expect(inside.state).toBe(first.state);
    expect(inside.rotation).toBe(view.rotation);
    const next = stepNoDrop(first.state, viewOf(riderBehind(45), { atMs: 1_000 }));
    expect(next.state).toMatchObject({ hold: 'waiting', nextWindowAtMs: 2_000 });
  });

  it('keeps to the second after a late step, and never decides twice in one', () => {
    expect(stepNoDrop(START, viewOf(riderBehind(1), { atMs: 250 })).state.nextWindowAtMs).toBe(
      1_000,
    );
    expect(stepNoDrop(START, viewOf(riderBehind(1), { atMs: 1_400 })).state.nextWindowAtMs).toBe(
      2_400,
    );
  });
});

describe('what it refuses', () => {
  it.each([
    ['an odometer', { distanceM: Number.NaN, speedMps: 8 }],
    ['a speed', { distanceM: 400, speedMps: Number.POSITIVE_INFINITY }],
  ])('a rider without %s that is finite, naming no value', (_what, rider) => {
    const members = { ...riderBehind(1), you: rider };
    let raised: unknown;
    try {
      stepNoDrop(START, viewOf(members));
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(GroupRideError);
    expect((raised as GroupRideError).code).toBe('view-out-of-range');
    expect((raised as GroupRideError).message).not.toMatch(/\d/);
  });
});

describe('the rider’s role with their standing', () => {
  it('names a rider off the back or off the front whatever their role, and a gapped one in place of a wheel’s', () => {
    for (const role of RIDER_ROLES) {
      expect(noDropRole('with', role)).toBe(role);
      expect(noDropRole('off-the-back', role)).toBe('off-the-back');
      expect(noDropRole('off-the-front', role)).toBe('off-the-front');
    }
    expect(noDropRole('gapped', 'last-wheel')).toBe('gapped');
    expect(noDropRole('gapped', 'in-line')).toBe('gapped');
    expect(noDropRole('gapped', 'sitting-in')).toBe('gapped');
  });

  it('leaves a gapped rider who is aside after a pull their drifting or latching role: the drift-back cues read it', () => {
    expect(noDropRole('gapped', 'drifting-back')).toBe('drifting-back');
    expect(noDropRole('gapped', 'latching')).toBe('latching');
  });

  it('refuses a standing it does not name', () => {
    expect(RIDER_STANDINGS).toEqual(['with', 'gapped', 'off-the-back', 'off-the-front']);
    expect(() => noDropRole('dropped' as never, 'in-line')).toThrowError(GroupRideError);
  });
});

describe('room-portable and seeded', () => {
  it('names no clock, no random draw, no platform API and no arithmetic beyond + − × ÷, min and max', () => {
    const code = noDropSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const banned of [
      /Math\.random\b/,
      /\bDate\b/,
      /performance\./,
      /\*\*/,
      /\bdocument\b/,
      /\bwindow\./,
    ]) {
      expect(code).not.toMatch(banned);
    }
    const maths = [...code.matchAll(/Math\.(\w+)/g)].map((match) => match[1]);
    expect(maths.length).toBeGreaterThan(0);
    expect(maths.every((name) => name === 'min' || name === 'max')).toBe(true);
  });

  it('is a pure function of its inputs, and makes no draw from the line’s seed', () => {
    const view = viewOf(riderBehind(45));
    const once = stepNoDrop(START, view);
    const again = stepNoDrop(START, view);
    expect(again).toEqual(once);
    expect(once.rotation.random).toBe(view.rotation.random);
  });
});
