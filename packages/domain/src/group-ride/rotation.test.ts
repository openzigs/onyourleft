// SPDX-License-Identifier: Apache-2.0

/**
 * #3299: the paceline rotation for one line, through whole scripted rides
 * (`line-testing.ts`) and single steps. Each `describe` below names the
 * criterion or the transition it holds.
 */

import { describe, expect, it } from 'vitest';

import type { BotCapacity } from '../lap-race/wbal';
import { GroupRideError } from './errors';
import { frontSpells, rideLine, SCRIPT_GROUP_SPEED_MPS, type LineWindow } from './line-testing';
import rolesSource from './roles.ts?raw';
import { isLineRole, LINE_PHASES, RIDER_ROLES, type LinePhase, type RiderRole } from './roles';
import rotationSource from './rotation.ts?raw';
import {
  ROTATION_BOT_PULL_MS,
  ROTATION_CLIMB_HOLD_METRES,
  ROTATION_EASE_SHARE,
  ROTATION_FADE_DWELL_MS,
  ROTATION_FORMING_MOST_MS,
  ROTATION_RIDER_GRACE_MS,
  ROTATION_RIDER_PULL_MS,
  ROTATION_WINDOW_MS,
  startRotation,
  stepRotation,
  type LineMember,
  type RotationState,
  type RotationView,
} from './rotation';

/** A bot of critical power `cp` watts, with 18 kJ of W′. */
function bot(id: string, cp = 250): LineMember {
  const capacity: BotCapacity = {
    cpWatts: cp,
    wPrimeJoules: 18_000,
    peakWatts: 1.8 * cp,
    floorWatts: 0.8 * cp,
  };
  return { id, kind: 'bot', capacity };
}

const RIDER: LineMember = { id: 'you', kind: 'rider' };

/** Five bots and the rider third: the line of six the issue scripts. */
const SIX: readonly LineMember[] = [bot('b1'), bot('b2'), RIDER, bot('b3'), bot('b4'), bot('b5')];

const FIVE_BOTS: readonly LineMember[] = [bot('b1'), bot('b2'), bot('b3'), bot('b4'), bot('b5')];

/** The window at `atMs`. */
function windowAt(windows: readonly LineWindow[], atMs: number): LineWindow {
  return windows.find((window) => window.atMs === atMs) as LineWindow;
}

/** The windows in which a pull change started: the line went from `steady` to `changing`. */
function changes(windows: readonly LineWindow[]): readonly LineWindow[] {
  return windows.filter(
    (window, at) => at > 0 && window.phase === 'changing' && windows[at - 1]?.phase === 'steady',
  );
}

/** The thrown error's code, or `undefined` if nothing was thrown. */
function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof GroupRideError ? error.code : 'not a GroupRideError';
  }
  return undefined;
}

/** A view of `state`'s line, everyone on the wheel from 0 m, full reserves, a straight flat road. */
function viewOf(
  state: RotationState,
  atMs: number,
  change: Partial<RotationView> = {},
): RotationView {
  const members: Record<string, { distanceM: number; speedMps: number }> = {};
  const energy: Record<string, { wbalJoules: number; exhausted: boolean }> = {};
  state.line.forEach((member, at) => {
    members[member.id] = { distanceM: -at * 0.5, speedMps: SCRIPT_GROUP_SPEED_MPS };
    if (member.kind === 'bot') {
      energy[member.id] = { wbalJoules: member.capacity.wPrimeJoules, exhausted: false };
    }
  });
  return {
    atMs,
    groupSpeedMps: SCRIPT_GROUP_SPEED_MPS,
    members,
    energy,
    climbAheadM: null,
    bendRadiusM: null,
    riderSignal: false,
    riderSittingIn: false,
    ...change,
  };
}

describe('a full rotation: each member on the front once, in order, and the order restored', () => {
  it('a line of six with a rider who holds the wheel and signals on time', () => {
    const { windows } = rideLine({
      line: SIX,
      seed: 7,
      seconds: 400,
      rider: { signalAfterMs: ROTATION_RIDER_PULL_MS },
    });
    const before = SIX.map((member) => member.id);
    const spells = frontSpells(windows);
    // Six spells, one each, in the line's order; the seventh is the first again.
    expect(spells.slice(0, 6).map((spell) => spell.id)).toEqual(before);
    expect(spells[6]?.id).toBe('b1');
    // Every member came round, once each, and the line is back as it started.
    const backAt = windows.findIndex(
      (window, at) => at > 0 && window.order[0] === 'b1' && windows[at - 1]?.order[0] !== 'b1',
    );
    const settled = windows.slice(backAt).find((window) => window.phase === 'steady');
    expect(settled?.order).toEqual(before);
    // The rider was on the front, and pulled off by their press at the target.
    const riderSpell = spells.find((spell) => spell.id === 'you');
    expect(riderSpell?.windows).toBeGreaterThanOrEqual(ROTATION_RIDER_PULL_MS / ROTATION_WINDOW_MS);
    const riderRoles = new Set(windows.map((window) => window.roles['you']));
    expect(riderRoles).toEqual(
      new Set<RiderRole>([
        'in-line',
        'second-wheel',
        'on-front',
        'drifting-back',
        'latching',
        'last-wheel',
      ]),
    );
  });
});

describe('a bot arriving on the front does not lift', () => {
  it('its demand in its first window there is the group speed of the window before', () => {
    // The plan's speed creeps up, so the window before and the window of the change differ.
    const groupSpeed = (atMs: number): number => 8 + (0.002 * atMs) / ROTATION_WINDOW_MS;
    const { windows } = rideLine({ line: FIVE_BOTS, seed: 3, seconds: 200, groupSpeed });
    const arrivals = windows.filter(
      (window, at) => at > 0 && window.order[0] !== windows[at - 1]?.order[0],
    );
    expect(arrivals.length).toBeGreaterThanOrEqual(4);
    for (const arrival of arrivals) {
      const before = windows[windows.indexOf(arrival) - 1] as LineWindow;
      const front = arrival.order[0] as string;
      expect(arrival.demands[front]).toBe(before.view.groupSpeedMps);
      expect(arrival.demands[front]).not.toBe(arrival.view.groupSpeedMps);
      // The window after, it rides the group's speed now.
      const after = windows[windows.indexOf(arrival) + 1] as LineWindow;
      expect(after.demands[front]).toBe(after.view.groupSpeedMps);
    }
  });

  it('a bot aside eases by the share, and every bot in the line rides the line speed', () => {
    const { windows } = rideLine({ line: FIVE_BOTS, seed: 3, seconds: 120 });
    const drifting = windows.find((window) =>
      Object.values(window.roles).includes('drifting-back'),
    ) as LineWindow;
    for (const [id, role] of Object.entries(drifting.roles)) {
      const demand = drifting.demands[id] as number;
      expect(demand).toBeCloseTo(
        role === 'drifting-back'
          ? SCRIPT_GROUP_SPEED_MPS * (1 - ROTATION_EASE_SHARE)
          : SCRIPT_GROUP_SPEED_MPS,
        9,
      );
    }
  });
});

describe('a strong bot pulls longer than a weak one, at the same speed', () => {
  it('in the same seeded line', () => {
    const line = [bot('strong', 320), bot('mid1'), bot('weak', 180), bot('mid2'), bot('mid3')];
    const { windows } = rideLine({ line, seed: 11, seconds: 200 });
    const spells = frontSpells(windows);
    const strong = spells.find((spell) => spell.id === 'strong')?.windows as number;
    const weak = spells.find((spell) => spell.id === 'weak')?.windows as number;
    expect(strong).toBeGreaterThan(weak);
    // Strength scales the 30 s base both ways.
    expect(strong * ROTATION_WINDOW_MS).toBeGreaterThan(ROTATION_BOT_PULL_MS);
    expect(weak * ROTATION_WINDOW_MS).toBeLessThan(ROTATION_BOT_PULL_MS);
    // On the front, past their first window, each rode the group's speed and nothing else.
    for (const id of ['strong', 'weak']) {
      const onFront = windows.filter(
        (window, at) => window.order[0] === id && windows[at - 1]?.order[0] === id,
      );
      expect(onFront.length).toBeGreaterThan(5);
      for (const window of onFront) expect(window.demands[id]).toBe(window.view.groupSpeedMps);
    }
  });

  it('a bot with less of its reserve left pulls shorter than the same bot full', () => {
    const full = frontSpells(rideLine({ line: FIVE_BOTS, seed: 5, seconds: 60 }).windows);
    const half = frontSpells(
      rideLine({
        line: FIVE_BOTS,
        seed: 5,
        seconds: 60,
        energy: (id) => ({ wbalJoules: id === 'b1' ? 10_800 : 18_000, exhausted: false }),
      }).windows,
    );
    expect(full[0]?.id).toBe('b1');
    expect(half[0]?.windows).toBeLessThan(full[0]?.windows as number);
  });
});

describe('steady → changing', () => {
  it('a bot’s pull timer ends', () => {
    const { windows } = rideLine({ line: FIVE_BOTS, seed: 2, seconds: 60 });
    const first = changes(windows)[0] as LineWindow;
    expect(first.order[0]).toBe('b2');
    expect(first.roles['b1']).toBe('drifting-back');
    // Within the seeded variation of the base, and never before it could have ended.
    expect(first.atMs).toBeGreaterThanOrEqual(0.9 * ROTATION_BOT_PULL_MS);
    expect(first.atMs).toBeLessThanOrEqual(1.1 * ROTATION_BOT_PULL_MS + ROTATION_WINDOW_MS);
  });

  it('a bot on the front is tired: under a quarter of its W′, it pulls off early', () => {
    const { windows } = rideLine({
      line: FIVE_BOTS,
      seed: 2,
      seconds: 60,
      energy: (id, atMs) => ({
        wbalJoules: id === 'b1' && atMs >= 10_000 ? 4_000 : 18_000,
        exhausted: false,
      }),
    });
    expect(changes(windows)[0]?.atMs).toBe(10_000);
  });

  it('a bot on the front is exhausted', () => {
    const { windows } = rideLine({
      line: FIVE_BOTS,
      seed: 2,
      seconds: 60,
      energy: (id, atMs) => ({ wbalJoules: 18_000, exhausted: id === 'b1' && atMs >= 8_000 }),
    });
    expect(changes(windows)[0]?.atMs).toBe(8_000);
  });

  it('the rider signals at 5 s: the window it arrives in is `changing`', () => {
    const line = [RIDER, bot('b1'), bot('b2'), bot('b3'), bot('b4'), bot('b5')];
    const { windows } = rideLine({ line, seed: 1, seconds: 20, rider: { signalAfterMs: 5_000 } });
    expect(windowAt(windows, 0).phase).toBe('steady');
    expect(windowAt(windows, 4_000).phase).toBe('steady');
    expect(windowAt(windows, 4_000).roles['you']).toBe('on-front');
    expect(windowAt(windows, 5_000).view.riderSignal).toBe(true);
    expect(windowAt(windows, 5_000).phase).toBe('changing');
    expect(windowAt(windows, 5_000).roles['you']).toBe('drifting-back');
  });

  it('the rider fades on the front and never signals: the line comes round anyway', () => {
    const line = [RIDER, bot('b1'), bot('b2'), bot('b3'), bot('b4'), bot('b5')];
    const { windows } = rideLine({
      line,
      seed: 1,
      seconds: 120,
      rider: { fade: { afterMs: 35_000, underMps: 1 } },
    });
    expect(windows.some((window) => window.view.riderSignal)).toBe(false);
    const change = changes(windows)[0] as LineWindow;
    expect(change.atMs).toBe(35_000 + ROTATION_WINDOW_MS + ROTATION_FADE_DWELL_MS);
    expect(change.roles['you']).toBe('drifting-back');
    // One window short of the dwell, still on the front.
    expect(windowAt(windows, change.atMs - ROTATION_WINDOW_MS).roles['you']).toBe('on-front');
  });

  it('a rider who rides the group’s speed on the front is not brought round', () => {
    const line = [RIDER, bot('b1'), bot('b2')];
    const { windows } = rideLine({ line, seed: 1, seconds: 300 });
    expect(changes(windows)).toEqual([]);
  });
});

describe('the rider’s pull asks for the pull-off once, and once more, and never again', () => {
  it('at the target and after the grace', () => {
    const line = [RIDER, bot('b1'), bot('b2')];
    const { windows } = rideLine({ line, seed: 1, seconds: 300 });
    const asked = windows.flatMap((window) =>
      window.requests.map((request) => [window.atMs, request.kind]),
    );
    expect(asked).toEqual([
      [ROTATION_RIDER_PULL_MS, 'pull-off-due'],
      [ROTATION_RIDER_PULL_MS + ROTATION_RIDER_GRACE_MS, 'pull-off-repeat'],
    ]);
  });

  it('not while a climb holds the change: the ask waits for the crest', () => {
    const line = [RIDER, bot('b1'), bot('b2')];
    // The climb starts 400 m in and crests at 600 m; the front is at 250 m at 30 s.
    const { windows } = rideLine({
      line,
      seed: 1,
      seconds: 120,
      climbAheadM: (frontM) => (frontM < 400 ? 400 - frontM : frontM < 600 ? 0 : null),
    });
    const due = windows.find((window) => window.requests.length > 0) as LineWindow;
    expect(due.requests).toEqual([{ kind: 'pull-off-due' }]);
    expect(due.view.climbAheadM).toBeNull();
    expect(windows[windows.indexOf(due) - 1]?.view.climbAheadM).toBe(0);
  });
});

describe('a rider who sits in is never on the front, and the line still rotates', () => {
  it('across three full rotations', () => {
    const line = [bot('b1'), RIDER, bot('b2'), bot('b3'), bot('b4'), bot('b5')];
    const { windows } = rideLine({ line, seed: 9, seconds: 700, rider: { sittingInFromMs: 0 } });
    expect(windows.some((window) => window.roles['you'] === 'on-front')).toBe(false);
    expect(windows.some((window) => window.order[0] === 'you')).toBe(false);
    const fronts = frontSpells(windows).map((spell) => spell.id);
    expect(fronts.slice(0, 15)).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
      'b5',
      'b1',
      'b2',
      'b3',
      'b4',
      'b5',
      'b1',
      'b2',
      'b3',
      'b4',
      'b5',
    ]);
    expect(windows.every((window) => window.roles['you'] === 'sitting-in')).toBe(true);
  });

  it('a rider on the front who sits in hands it to the bot behind, who starts a pull', () => {
    const line = [RIDER, bot('b1'), bot('b2'), bot('b3')];
    const { windows } = rideLine({
      line,
      seed: 9,
      seconds: 60,
      rider: { sittingInFromMs: 10_000 },
    });
    expect(windowAt(windows, 9_000).order[0]).toBe('you');
    const handed = windowAt(windows, 10_000);
    expect(handed.phase).toBe('steady');
    expect(handed.order.slice(0, 2)).toEqual(['b1', 'you']);
    expect(handed.roles['you']).toBe('sitting-in');
    // b1's pull is its own, from 10 s: no change before 10 s plus 90 % of the base.
    expect(changes(windows)[0]?.atMs).toBeGreaterThanOrEqual(10_000 + 0.9 * ROTATION_BOT_PULL_MS);
  });

  it('a sitting-in rider at the front of a forming line is seated behind the bot', () => {
    const line = [RIDER, bot('b1'), bot('b2')];
    const { windows } = rideLine({ line, seed: 9, seconds: 2, rider: { sittingInFromMs: 0 } });
    expect(windowAt(windows, 0).order).toEqual(['b1', 'you', 'b2']);
  });

  it('a line whose only other member sits in does not rotate', () => {
    const { windows } = rideLine({
      line: [bot('b1'), RIDER],
      seed: 9,
      seconds: 120,
      rider: { sittingInFromMs: 0 },
    });
    expect(changes(windows)).toEqual([]);
    expect(windows.every((window) => window.order[0] === 'b1')).toBe(true);
  });
});

describe('a rider who never signals and holds a wheel stays in the group with no fault state', () => {
  it('a whole hour: only the line’s own roles, and at most the one repeat ask', () => {
    const { windows } = rideLine({ line: SIX, seed: 4, seconds: 3_600 });
    for (const window of windows) {
      expect(isLineRole(window.roles['you'] as RiderRole)).toBe(true);
      expect(['forming', 'steady', 'changing', 'latching']).toContain(window.phase);
    }
    const asked = windows.flatMap((window) => window.requests.map((request) => request.kind));
    expect(asked.filter((kind) => kind === 'pull-off-repeat').length).toBeLessThanOrEqual(1);
    expect(asked.filter((kind) => kind === 'pull-off-due').length).toBeLessThanOrEqual(1);
  });
});

describe('no pull change on a climb’s approach or a tight bend: deferred, not dropped', () => {
  // The fixture course: a climb from 400 m to 1 000 m. The first pull is due at
  // about 30 s, when the front is about 250 m in, inside the hold.
  const climbAheadM = (frontM: number): number | null =>
    frontM < 400 ? 400 - frontM : frontM < 1_000 ? 0 : null;

  it('the change waits for the crest, and happens in the first window after it', () => {
    const { windows } = rideLine({ line: FIVE_BOTS, seed: 2, seconds: 200, climbAheadM });
    for (const change of changes(windows)) {
      const ahead = change.view.climbAheadM;
      expect(ahead === null || ahead > ROTATION_CLIMB_HOLD_METRES).toBe(true);
    }
    const first = changes(windows)[0] as LineWindow;
    expect(first.order[0]).toBe('b2');
    expect(first.view.climbAheadM).toBeNull();
    expect(windows[windows.indexOf(first) - 1]?.view.climbAheadM).toBe(0);
    // With no climb, the same line changes at about 30 s: the deferral is real.
    const flat = changes(
      rideLine({ line: FIVE_BOTS, seed: 2, seconds: 200 }).windows,
    )[0] as LineWindow;
    expect(flat.atMs).toBeLessThan(first.atMs);
  });

  it('a change due 300 m before the climb is held; one due 310 m before is not', () => {
    const at = (metres: number) =>
      rideLine({
        line: FIVE_BOTS,
        seed: 2,
        seconds: 200,
        climbAheadM: () => metres,
      }).windows;
    expect(changes(at(ROTATION_CLIMB_HOLD_METRES))).toEqual([]);
    expect(changes(at(ROTATION_CLIMB_HOLD_METRES + 10)).length).toBeGreaterThan(0);
  });

  it('a bend tighter than the threshold holds it until the road straightens', () => {
    const { windows } = rideLine({
      line: FIVE_BOTS,
      seed: 2,
      seconds: 200,
      bendRadiusM: (frontM) => (frontM < 800 ? 15 : null),
    });
    const first = changes(windows)[0] as LineWindow;
    expect(first.view.bendRadiusM).toBeNull();
    expect(windows[windows.indexOf(first) - 1]?.view.bendRadiusM).toBe(15);
    // A gentle bend holds nothing.
    const gentle = rideLine({ line: FIVE_BOTS, seed: 2, seconds: 60, bendRadiusM: () => 40 });
    expect(changes(gentle.windows).length).toBe(1);
  });

  it('the rider’s press is never held: nobody is kept on the front', () => {
    const line = [RIDER, bot('b1'), bot('b2')];
    const { windows } = rideLine({
      line,
      seed: 1,
      seconds: 20,
      rider: { signalAfterMs: 5_000 },
      climbAheadM: () => 0,
    });
    expect(changes(windows)[0]?.atMs).toBe(5_000);
  });
});

describe('forming → steady', () => {
  it('every gap is inside the wheel band: steady in the first window', () => {
    const { windows } = rideLine({ line: FIVE_BOTS, seed: 1, seconds: 3 });
    expect(windowAt(windows, 0).phase).toBe('steady');
  });

  it('a gap is open: forming until 60 s have passed, then steady', () => {
    let state = startRotation({ line: FIVE_BOTS, seed: 1, atMs: 0 });
    const open = (atMs: number): RotationView => {
      const view = viewOf(state, atMs);
      return { ...view, members: { ...view.members, b5: { distanceM: -20, speedMps: 8 } } };
    };
    for (let atMs = 0; atMs < ROTATION_FORMING_MOST_MS; atMs += ROTATION_WINDOW_MS) {
      state = stepRotation(state, open(atMs)).state;
      expect(state.phase, String(atMs)).toBe('forming');
    }
    const step = stepRotation(state, open(ROTATION_FORMING_MOST_MS));
    expect(step.state.phase).toBe('steady');
    expect(step.roles['b1']).toBe('on-front');
  });
});

describe('changing → latching → steady', () => {
  it('the old front goes behind the last wheel, then closes onto it and is the last wheel', () => {
    const { windows } = rideLine({ line: FIVE_BOTS, seed: 2, seconds: 60 });
    const first = windows.findIndex((window) => window.phase === 'latching');
    const latching = windows[first] as LineWindow;
    const before = windows[first - 1] as LineWindow;
    expect(before.phase).toBe('changing');
    // Latching starts the first window the old front is behind the last wheel.
    const last = latching.order[latching.order.length - 1] as string;
    expect(latching.view.members['b1']?.distanceM).toBeLessThan(
      latching.view.members[last]?.distanceM as number,
    );
    expect(before.view.members['b1']?.distanceM).toBeGreaterThanOrEqual(
      before.view.members[last]?.distanceM as number,
    );
    expect(latching.roles['b1']).toBe('latching');
    const steady = windows[first + 1] as LineWindow;
    expect(steady.phase).toBe('steady');
    expect(steady.order).toEqual(['b2', 'b3', 'b4', 'b5', 'b1']);
    expect(steady.roles['b1']).toBe('last-wheel');
  });

  it('latching holds while the gap to the last wheel is outside the band', () => {
    // Ride to a latching window, then hold the old front 3 m off, then 0.9 m.
    const ride = rideLine({ line: FIVE_BOTS, seed: 2, seconds: 200 });
    const at = ride.windows.findIndex((window) => window.phase === 'latching');
    const latching = rideLine({ line: FIVE_BOTS, seed: 2, seconds: at + 1 }).state;
    expect(latching.phase).toBe('latching');
    const view = viewOf(latching, (at + 1) * ROTATION_WINDOW_MS);
    const lastM = view.members['b5']?.distanceM as number;
    const far = {
      ...view,
      members: { ...view.members, b1: { distanceM: lastM - 3, speedMps: 8 } },
    };
    expect(stepRotation(latching, far).state.phase).toBe('latching');
    const near = {
      ...view,
      members: { ...view.members, b1: { distanceM: lastM - 0.9, speedMps: 8 } },
    };
    expect(stepRotation(latching, near).state.phase).toBe('steady');
  });
});

describe('waiting and regrouping: declared here, moved by #3301, held by this step', () => {
  it.each(['waiting', 'regrouping'] as const)('%s holds', (phase) => {
    const steady = stepRotation(
      startRotation({ line: FIVE_BOTS, seed: 1, atMs: 0 }),
      viewOf(startRotation({ line: FIVE_BOTS, seed: 1, atMs: 0 }), 0),
    ).state;
    const held: RotationState = { ...steady, phase };
    const step = stepRotation(held, viewOf(held, 60_000, { riderSignal: true }));
    expect(step.state.phase).toBe(phase);
    expect(step.state.order).toEqual(steady.order);
    expect(step.roles['b1']).toBe('on-front');
  });
});

describe('an unknown phase or role is a compile error, and refused at run time', () => {
  it('a phase from outside the list throws, never defaults', () => {
    const start = startRotation({ line: FIVE_BOTS, seed: 1, atMs: 0 });
    const odd = { ...start, phase: 'dropped' as LinePhase };
    expect(codeOf(() => stepRotation(odd, viewOf(odd, 0)))).toBe('unknown-value');
  });

  it('a role from outside the list throws, never defaults', () => {
    expect(codeOf(() => isLineRole('dropped' as RiderRole))).toBe('unknown-value');
    // @ts-expect-error -- 'dropped' arrives with Phase 2; it is not a role yet.
    expect(codeOf(() => isLineRole('dropped'))).toBe('unknown-value');
  });

  it('every listed role and phase is handled', () => {
    expect(RIDER_ROLES.filter((role) => isLineRole(role))).toEqual([
      'on-front',
      'second-wheel',
      'in-line',
      'last-wheel',
      'drifting-back',
      'latching',
      'sitting-in',
    ]);
    expect(LINE_PHASES).toEqual([
      'forming',
      'steady',
      'changing',
      'latching',
      'waiting',
      'regrouping',
    ]);
  });
});

describe('deterministic, and decided per window, not per tick (ADR 0067 D-6)', () => {
  it('the same seed and inputs give identical output', () => {
    const one = rideLine({ line: SIX, seed: 21, seconds: 400, rider: { signalAfterMs: 20_000 } });
    const two = rideLine({ line: SIX, seed: 21, seconds: 400, rider: { signalAfterMs: 20_000 } });
    expect(two).toEqual(one);
    const other = rideLine({ line: SIX, seed: 22, seconds: 400, rider: { signalAfterMs: 20_000 } });
    expect(frontSpells(other.windows)).not.toEqual(frontSpells(one.windows));
  });

  it('twenty steps a window decide exactly what one step a window does', () => {
    const script = { line: SIX, seed: 21, seconds: 400, rider: { signalAfterMs: 20_000 } };
    const once = rideLine(script);
    const often = rideLine({ ...script, ticksPerWindow: 20 });
    expect(often.windows).toEqual(once.windows);
  });

  it('a step inside a window changes nothing, and a press there waits for the next window', () => {
    const line = [RIDER, bot('b1'), bot('b2')];
    const start = startRotation({ line, seed: 1, atMs: 0 });
    const first = stepRotation(start, viewOf(start, 0));
    expect(first.state.phase).toBe('steady');
    const inside = stepRotation(
      first.state,
      viewOf(first.state, 400, { riderSignal: true, groupSpeedMps: 3 }),
    );
    expect(inside.state.phase).toBe('steady');
    expect(inside.roles).toBe(first.roles);
    expect(inside.demands).toBe(first.demands);
    expect(inside.requests).toEqual([]);
    expect(inside.state.signalPending).toBe(true);
    const next = stepRotation(inside.state, viewOf(inside.state, ROTATION_WINDOW_MS));
    expect(next.state.phase).toBe('changing');
    expect(next.roles['you']).toBe('drifting-back');
    expect(next.state.signalPending).toBe(false);
  });

  it('a press made before the line is steady again waits for it', () => {
    const line = [bot('b1'), RIDER, bot('b2'), bot('b3')];
    const ride = rideLine({ line, seed: 1, seconds: 200 });
    const at = ride.windows.findIndex(
      (window) => window.phase === 'changing' && window.order[0] === 'you',
    );
    const changing = rideLine({ line, seed: 1, seconds: at + 1 }).state;
    expect(changing.phase).toBe('changing');
    const pressed = stepRotation(changing, {
      ...viewOf(changing, (at + 1) * ROTATION_WINDOW_MS),
      riderSignal: true,
    });
    expect(pressed.state.signalPending).toBe(true);
    // The old front latches on and the line is steady: the held press brings it round then.
    let state = pressed.state;
    const windows: LinePhase[] = [];
    for (let window = at + 2; window < at + 12 && state.aside !== 'you'; window += 1) {
      const view = viewOf(state, window * ROTATION_WINDOW_MS);
      const aside = state.aside;
      const behind =
        aside === null
          ? view
          : { ...view, members: { ...view.members, [aside]: { distanceM: -2.4, speedMps: 8 } } };
      state = stepRotation(state, behind).state;
      windows.push(state.phase);
    }
    expect(windows).toEqual(['latching', 'steady', 'changing']);
    expect(state.aside).toBe('you');
  });

  it('a step after a skipped stretch decides at once and keeps its windows a second apart', () => {
    const start = startRotation({ line: FIVE_BOTS, seed: 1, atMs: 0 });
    const first = stepRotation(start, viewOf(start, 0)).state;
    const late = stepRotation(first, viewOf(first, 7_500)).state;
    expect(late.decidedAtMs).toBe(7_500);
    expect(late.nextWindowAtMs).toBe(8_500);
    const regular = stepRotation(late, viewOf(late, 8_500)).state;
    expect(regular.nextWindowAtMs).toBe(9_500);
  });
});

describe('a line and a view are refused unless they are a ride’s', () => {
  it.each<[string, readonly LineMember[]]>([
    ['one member', [bot('b1')]],
    ['nine members', Array.from({ length: 9 }, (_, at) => bot(`b${String(at)}`))],
    ['a name twice', [bot('b1'), bot('b1')]],
    ['an empty name', [bot(''), bot('b1')]],
    ['two riders', [RIDER, { id: 'me', kind: 'rider' }, bot('b1')]],
    ['a bot of no power', [bot('b1', 0), bot('b2')]],
    [
      'a bot of no W′',
      [
        {
          id: 'b1',
          kind: 'bot',
          capacity: { cpWatts: 200, wPrimeJoules: 0, peakWatts: 300, floorWatts: 100 },
        },
        bot('b2'),
      ],
    ],
  ])('a line with %s', (_, line) => {
    expect(codeOf(() => startRotation({ line, seed: 1, atMs: 0 }))).toBe('line-invalid');
  });

  it('a seed that is not whole, and a start that is not finite', () => {
    expect(codeOf(() => startRotation({ line: FIVE_BOTS, seed: 1.5, atMs: 0 }))).toBe(
      'seed-not-integer',
    );
    expect(codeOf(() => startRotation({ line: FIVE_BOTS, seed: 1, atMs: Number.NaN }))).toBe(
      'view-out-of-range',
    );
  });

  const state = startRotation({ line: [RIDER, bot('b1'), bot('b2')], seed: 1, atMs: 0 });
  const base = viewOf(state, 0);
  it.each<[string, Partial<RotationView>]>([
    ['a time that is not finite', { atMs: Number.POSITIVE_INFINITY }],
    ['a group speed below zero', { groupSpeedMps: -1 }],
    ['a group speed that is not a number', { groupSpeedMps: Number.NaN }],
    [
      'a member missing',
      { members: { you: { distanceM: 0, speedMps: 8 }, b1: { distanceM: 0, speedMps: 8 } } },
    ],
    [
      'an odometer that is not finite',
      { members: { ...base.members, b1: { distanceM: Number.NaN, speedMps: 8 } } },
    ],
    ['a speed below zero', { members: { ...base.members, you: { distanceM: 0, speedMps: -1 } } }],
    ['a bot with no reserve', { energy: { b1: { wbalJoules: 1, exhausted: false } } }],
    [
      'a reserve over W′',
      { energy: { ...base.energy, b2: { wbalJoules: 18_001, exhausted: false } } },
    ],
    [
      'a reserve below zero',
      { energy: { ...base.energy, b2: { wbalJoules: -1, exhausted: false } } },
    ],
    ['a climb behind', { climbAheadM: -1 }],
    ['a bend of no radius', { bendRadiusM: 0 }],
  ])('a view with %s', (_, change) => {
    expect(codeOf(() => stepRotation(state, { ...base, ...change }))).toBe('view-out-of-range');
  });

  it('a view before the last decision', () => {
    const decided = stepRotation(state, viewOf(state, 5_000)).state;
    expect(codeOf(() => stepRotation(decided, viewOf(decided, 4_999)))).toBe(
      'instant-out-of-order',
    );
    expect(codeOf(() => stepRotation(decided, viewOf(decided, 5_000)))).toBeUndefined();
  });
});

describe('platform-free, and only + − × ÷ min max sqrt (ADR 0067 D-5.2)', () => {
  it.each([
    ['rotation.ts', rotationSource],
    ['roles.ts', rolesSource],
  ])('%s reads no clock, draws no random number and calls no other Math', (_, source) => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.length).toBeGreaterThan(500);
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
    expect(maths.every((name) => name === 'min' || name === 'max' || name === 'sqrt')).toBe(true);
  });
});
