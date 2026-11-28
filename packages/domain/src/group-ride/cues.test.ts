// SPDX-License-Identifier: Apache-2.0

/**
 * #3302: the rider's cue, chosen once per window from the rotation's answer.
 * Whole rides come from `line-testing.ts`; a correction's band is broken by
 * moving the rider in the view the selector reads, so the rotation's own
 * answer is the scripted one.
 */

import { describe, expect, it } from 'vitest';

import type { BotCapacity } from '../lap-race/wbal';
import cuesSource from './cues.ts?raw';
import {
  CUE_ASK,
  CUE_ASKS,
  CUE_CEILING_PER_MINUTE,
  CUE_CORRECTION_GAP_MS,
  CUE_CORRECTION_KINDS,
  CUE_EVENT_KINDS,
  CUE_KINDS,
  CUE_PAST_FRONT_DWELL_MS,
  startCues,
  stepCues,
  type Cue,
  type CueCorrectionKind,
  type CueKind,
  type CueState,
} from './cues';
import { GroupRideError } from './errors';
import type { LinePhase, RiderRole } from './roles';
import { rideLine, SCRIPT_GROUP_SPEED_MPS, type LineScript, type LineWindow } from './line-testing';
import {
  ROTATION_RIDER_PULL_MS,
  ROTATION_WINDOW_MS,
  type LineMember,
  type MemberView,
  type RotationStep,
  type RotationView,
} from './rotation';

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

const SIX: readonly LineMember[] = [bot('b1'), bot('b2'), RIDER, bot('b3'), bot('b4'), bot('b5')];

/** The clean rider: holds the wheel, and presses pull off a window after the cue asks. */
const CLEAN = { signalAfterMs: ROTATION_RIDER_PULL_MS + ROTATION_WINDOW_MS };

/** What the selector said in one window. */
interface Said {
  readonly atMs: number;
  readonly cue: Cue | null;
  readonly mark: CueCorrectionKind | null;
}

/** How a test changes one window before the selector reads it. */
interface Alter {
  readonly step?: (window: LineWindow) => RotationStep;
  readonly view?: (window: LineWindow) => RotationView;
  readonly power?: (atMs: number) => number | null;
  readonly threshold?: number | null;
}

/** The selector over a ride's windows. */
function cuesOver(
  windows: readonly LineWindow[],
  alter: Alter = {},
): { said: readonly Said[]; state: CueState } {
  let state = startCues(0);
  const said: Said[] = [];
  for (const window of windows) {
    const step = stepCues(state, {
      rotation: alter.step?.(window) ?? window.step,
      line: alter.view?.(window) ?? window.view,
      powerWatts: alter.power === undefined ? 200 : alter.power(window.atMs),
      thresholdWatts: alter.threshold ?? null,
    });
    state = step.state;
    said.push({ atMs: window.atMs, cue: step.cue, mark: step.mark });
  }
  return { said, state };
}

function ride(
  script: Partial<LineScript> & { readonly line?: readonly LineMember[] },
): readonly LineWindow[] {
  return rideLine({ line: SIX, seed: 7, seconds: 300, ...script }).windows;
}

/** The kinds said, in order. */
function kinds(said: readonly Said[]): CueKind[] {
  return said.flatMap((each) => (each.cue === null ? [] : [each.cue.kind]));
}

/** `view` with the rider at `distanceM` and riding `speedMps`. */
function moveRider(view: RotationView, change: Partial<MemberView>): RotationView {
  const you = view.members['you'] as MemberView;
  return { ...view, members: { ...view.members, you: { ...you, ...change } } };
}

/** The odometer of the member ahead of the rider in the window's line. */
function aheadOfRider(window: LineWindow): number {
  const order = window.step.state.order;
  return (window.view.members[order[order.indexOf('you') - 1] as string] as MemberView).distanceM;
}

describe('one scripted rotation with a clean rider: each event once, in order', () => {
  it('next-up, your-pull, pull-off, ease, last-wheel, back-in-line', () => {
    const windows = ride({ rider: CLEAN });
    const { said } = cuesOver(windows);
    // The rotation's first lap of the rider: to the window they are back in the line.
    const back = said.findIndex((each) => each.cue?.kind === 'back-in-line');
    expect(back).toBeGreaterThan(0);
    expect(kinds(said.slice(0, back + 1))).toEqual([
      'next-up',
      'your-pull',
      'pull-off',
      'ease',
      'last-wheel',
      'back-in-line',
    ]);
    expect(said.slice(0, back + 1).every((each) => each.mark === null)).toBe(true);
  });
});

describe('each event once, on a clean rotation of any short line', () => {
  it.each([2, 3, 4])('a line of %i members: no event kind is said twice in a row', (size) => {
    const others = [bot('b1'), bot('b2'), bot('b3')].slice(0, size - 1);
    const line: readonly LineMember[] = [others[0] as LineMember, RIDER, ...others.slice(1)];
    const { said } = cuesOver(ride({ line, rider: CLEAN }));
    const spoken = kinds(said);
    expect(spoken).toContain('last-wheel');
    spoken.forEach((kind, at) => {
      if (kind !== 'ease' && kind !== 'last-wheel') return;
      expect(spoken[at + 1]).not.toBe(kind);
    });
    expect(spoken.filter((kind) => kind === 'last-wheel').length).toBe(
      spoken.filter((kind) => kind === 'ease').length,
    );
  });
});

describe('the next rotation cues the same events again', () => {
  it('each event once more, in the same order, on the rider’s second pull', () => {
    const { said } = cuesOver(ride({ rider: CLEAN, seconds: 450 }));
    const firstBack = said.findIndex((each) => each.cue?.kind === 'back-in-line');
    const secondBack = said.findIndex(
      (each, at) => at > firstBack && each.cue?.kind === 'back-in-line',
    );
    expect(secondBack).toBeGreaterThan(firstBack);
    expect(kinds(said.slice(firstBack + 1, secondBack + 1))).toEqual([
      'next-up',
      'your-pull',
      'pull-off',
      'ease',
      'last-wheel',
      'back-in-line',
    ]);
  });
});

describe('a correction only out of band for its dwell (bandwidth)', () => {
  /** The rider 2.5 m off the wheel ahead from 130 s, for `seconds`: in the line there from 121 s to 207 s. */
  const gapFor =
    (seconds: number) =>
    (window: LineWindow): RotationView =>
      window.atMs >= 130_000 &&
      window.atMs < 130_000 + seconds * 1_000 &&
      window.step.roles['you'] === 'in-line'
        ? moveRider(window.view, { distanceM: aheadOfRider(window) - 2.5 })
        : window.view;

  it('a 2.5 m gap for 3 s: no correction', () => {
    const windows = ride({ rider: CLEAN, seconds: 200 });
    expect(
      windows
        .filter((w) => w.atMs >= 130_000 && w.atMs < 136_000)
        .every((w) => w.step.roles['you'] === 'in-line'),
    ).toBe(true);
    const { said } = cuesOver(windows, { view: gapFor(3) });
    expect(said.filter((each) => each.cue?.family === 'correction')).toEqual([]);
  });

  it('a 2.5 m gap for 5 s: close-gap, once', () => {
    const windows = ride({ rider: CLEAN, seconds: 200 });
    const { said } = cuesOver(windows, { view: gapFor(5) });
    const corrections = said.filter((each) => each.cue?.family === 'correction');
    expect(corrections).toEqual([
      { atMs: 134_000, cue: { family: 'correction', kind: 'close-gap' }, mark: null },
    ]);
  });
});

describe('the same correction at most twice in a row, then a quiet mark', () => {
  it('a rider who surges on the front for 60 s hears surging twice, then a mark and no third cue', () => {
    const line = [RIDER, bot('b1'), bot('b2'), bot('b3')];
    const windows = rideLine({ line, seed: 1, seconds: 90 }).windows;
    expect(windows.every((window) => window.step.roles['you'] === 'on-front')).toBe(true);
    const surge = (window: LineWindow): RotationView =>
      window.atMs < 60_000
        ? moveRider(window.view, { speedMps: SCRIPT_GROUP_SPEED_MPS + 1 })
        : window.view;
    const { said, state } = cuesOver(windows, { view: surge });
    const surging = said.filter((each) => each.cue?.kind === 'surging').map((each) => each.atMs);
    expect(surging).toEqual([5_000, 5_000 + CUE_CORRECTION_GAP_MS]);
    expect(said.filter((each) => each.mark !== null)).toEqual([
      { atMs: 5_000 + 2 * CUE_CORRECTION_GAP_MS, cue: null, mark: 'surging' },
    ]);
    expect(state.marks.surging).toBe(1);
  });

  it('a different correction in between starts the count again', () => {
    // Surging on every pull of the rider, and a shorter-pull after each.
    const windows = ride({ rider: CLEAN, seconds: 450 });
    const view = (window: LineWindow): RotationView =>
      window.step.roles['you'] === 'on-front'
        ? moveRider(window.view, { speedMps: SCRIPT_GROUP_SPEED_MPS + 1 })
        : window.view;
    const { said } = cuesOver(windows, { view, threshold: 180, power: () => 200 });
    const corrections = said.flatMap((each) =>
      each.cue?.family === 'correction' ? [each.cue.kind] : [],
    );
    expect(corrections.slice(0, 4)).toEqual(['surging', 'surging', 'shorter-pull', 'surging']);
    expect(said.filter((each) => each.mark !== null)).toEqual([]);
  });
});

describe('a rider no-drop names off the front (#3301)', () => {
  it('is told past-front after its dwell: `off-the-front` is the same fact, and no wheel role is left to read it by', () => {
    const windows = ride({ rider: CLEAN, seconds: 200 });
    // From 130 s `stepGroupRide` names the rider off the front, in place of their seat's role.
    const step = (window: LineWindow): RotationStep =>
      window.step.roles['you'] === 'in-line' && window.atMs >= 130_000 && window.atMs < 170_000
        ? { ...window.step, roles: { ...window.step.roles, you: 'off-the-front' } }
        : window.step;
    const { said } = cuesOver(windows, { step });
    const corrections = said.filter((each) => each.cue?.family === 'correction');
    expect(corrections.map((each) => [each.atMs, each.cue?.kind])).toEqual([
      [130_000 + CUE_PAST_FRONT_DWELL_MS, 'past-front'],
      [130_000 + CUE_PAST_FRONT_DWELL_MS + CUE_CORRECTION_GAP_MS, 'past-front'],
    ]);
  });
});

describe('at most one correction every 20 s; events are never held', () => {
  it('two different corrections due 5 s apart: only the first inside the limit', () => {
    const windows = ride({ rider: CLEAN, seconds: 200 });
    // A gap from 130 s (close-gap due at 134 s), then past the front from 136 s (due at 139 s).
    const view = (window: LineWindow): RotationView => {
      if (window.step.roles['you'] !== 'in-line') return window.view;
      if (window.atMs >= 130_000 && window.atMs < 136_000) {
        return moveRider(window.view, { distanceM: aheadOfRider(window) - 2.5 });
      }
      if (window.atMs >= 136_000 && window.atMs < 170_000) {
        const front = window.view.members[window.step.state.order[0] as string] as MemberView;
        return moveRider(window.view, { distanceM: front.distanceM + 1 });
      }
      return window.view;
    };
    const { said } = cuesOver(windows, { view });
    const corrections = said.filter((each) => each.cue?.family === 'correction');
    expect(corrections.map((each) => [each.atMs, each.cue?.kind])).toEqual([
      [134_000, 'close-gap'],
      [134_000 + CUE_CORRECTION_GAP_MS, 'past-front'],
    ]);
  });

  it('pull-off and last-wheel due inside the limit are still said, at once', () => {
    const line = [RIDER, bot('b1'), bot('b2'), bot('b3')];
    const windows = rideLine({ line, seed: 1, seconds: 80, rider: CLEAN }).windows;
    // Surging from 15 s: the correction at 20 s shuts the limit until 40 s.
    const view = (window: LineWindow): RotationView =>
      window.atMs >= 15_000 && window.step.roles['you'] === 'on-front'
        ? moveRider(window.view, { speedMps: SCRIPT_GROUP_SPEED_MPS + 1 })
        : window.view;
    const { said } = cuesOver(windows, { view });
    const at = (kind: CueKind) => said.find((each) => each.cue?.kind === kind)?.atMs;
    expect(at('surging')).toBe(20_000);
    expect(at('pull-off')).toBe(ROTATION_RIDER_PULL_MS);
    const pullOff = windows.find((window) => window.step.requests.length > 0)?.atMs;
    expect(at('pull-off')).toBe(pullOff);
    const lastWheel = at('last-wheel') as number;
    expect(lastWheel).toBeLessThan(20_000 + CUE_CORRECTION_GAP_MS);
    expect(at('ease')).toBeLessThan(lastWheel);
  });
});

/** A ride, and how to change it, that makes each kind be said with power: the table the silence test runs. */
function scenario(kind: CueKind): {
  readonly windows: readonly LineWindow[];
  readonly alter: Alter;
} {
  const clean = ride({ rider: CLEAN });
  switch (kind) {
    case 'next-up':
    case 'your-pull':
    case 'pull-off':
    case 'ease':
    case 'last-wheel':
    case 'back-in-line':
      return { windows: clean, alter: {} };
    case 'climb':
      return {
        windows: ride({
          rider: CLEAN,
          climbAheadM: (frontM) => (frontM < 600 ? 600 - frontM : null),
        }),
        alter: {},
      };
    case 'regroup':
      return {
        windows: clean,
        alter: {
          step: (window) =>
            window.atMs >= 130_000
              ? { ...window.step, state: { ...window.step.state, phase: 'waiting' } }
              : window.step,
        },
      };
    case 'close-gap':
      return {
        windows: clean,
        alter: {
          view: (window) =>
            window.step.roles['you'] === 'in-line'
              ? moveRider(window.view, { distanceM: aheadOfRider(window) - 3 })
              : window.view,
        },
      };
    case 'surging':
      return {
        windows: clean,
        alter: {
          view: (window) =>
            window.step.roles['you'] === 'on-front'
              ? moveRider(window.view, { speedMps: SCRIPT_GROUP_SPEED_MPS + 1 })
              : window.view,
        },
      };
    case 'past-front':
      return {
        windows: clean,
        alter: {
          view: (window) =>
            window.step.roles['you'] === 'in-line'
              ? moveRider(window.view, {
                  distanceM:
                    (window.view.members[window.step.state.order[0] as string] as MemberView)
                      .distanceM + 2,
                })
              : window.view,
        },
      };
    case 'eased-too-much': {
      // The latching window, held for five windows with the rider 6 m off the last wheel.
      const at = clean.findIndex((window) => window.step.roles['you'] === 'latching');
      const latching = clean[at] as LineWindow;
      const order = latching.step.state.order;
      const lastM = (latching.view.members[order[order.length - 1] as string] as MemberView)
        .distanceM;
      const held = Array.from({ length: 5 }, (_, n): LineWindow => {
        const atMs = latching.atMs + n * ROTATION_WINDOW_MS;
        return {
          ...latching,
          atMs,
          view: { ...moveRider(latching.view, { distanceM: lastM - 6 }), atMs },
        };
      });
      return { windows: [...clean.slice(0, at), ...held], alter: {} };
    }
    case 'shorter-pull':
      return { windows: clean, alter: { threshold: 180, power: () => 200 } };
    default:
      throw new Error('a kind with no scenario');
  }
}

describe('with no power reading, no cue at all', () => {
  it.each(CUE_KINDS)('%s: said with power, silent without it', (kind) => {
    const { windows, alter } = scenario(kind);
    expect(kinds(cuesOver(windows, alter).said)).toContain(kind);
    const silent = cuesOver(windows, { ...alter, power: () => null }).said;
    expect(silent.every((each) => each.cue === null && each.mark === null)).toBe(true);
  });

  it('an event that happened while the reading was gone is not said when it returns', () => {
    const windows = ride({ rider: CLEAN });
    const yourPull = cuesOver(windows).said.find((each) => each.cue?.kind === 'your-pull')
      ?.atMs as number;
    const { said } = cuesOver(windows, { power: (atMs) => (atMs === yourPull ? null : 200) });
    const after = said.filter((each) => each.atMs >= yourPull && each.atMs < yourPull + 10_000);
    expect(kinds(after)).not.toContain('your-pull');
    // The reading back, the rest of the pull is cued as before.
    expect(kinds(said)).toContain('pull-off');
  });

  it('a one-window dropout where last-wheel is detected does not lose it: said once, a window later (6 members)', () => {
    const windows = ride({ rider: CLEAN });
    const lastWheel = cuesOver(windows).said.find((each) => each.cue?.kind === 'last-wheel')
      ?.atMs as number;
    const { said } = cuesOver(windows, { power: (atMs) => (atMs === lastWheel ? null : 200) });
    const spoken = said.filter(
      (each) => each.cue?.kind === 'last-wheel' && each.atMs < lastWheel + 30_000,
    );
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.atMs).toBeGreaterThan(lastWheel);
    expect(spoken[0]?.atMs).toBeLessThanOrEqual(lastWheel + 3 * ROTATION_WINDOW_MS);
  });
});

describe('shorter-pull: after the pull, from the rider’s own threshold, never guessed', () => {
  it('a pull over 105 % of the threshold: said once the rider is back on a wheel', () => {
    const windows = ride({ rider: CLEAN });
    const { said } = cuesOver(windows, { threshold: 180, power: () => 200 });
    const at = said.find((each) => each.cue?.kind === 'shorter-pull')?.atMs as number;
    const back = said.find((each) => each.cue?.kind === 'back-in-line')?.atMs as number;
    expect(at).toBeGreaterThan(back);
    // Once after each of the rider's pulls, and never during one.
    const pulls = kinds(said).filter((kind) => kind === 'your-pull').length;
    expect(kinds(said).filter((kind) => kind === 'shorter-pull').length).toBe(pulls);
    const onFront = new Set(
      windows
        .filter((window) => window.step.roles['you'] === 'on-front')
        .map((window) => window.atMs),
    );
    expect(said.some((each) => each.cue?.kind === 'shorter-pull' && onFront.has(each.atMs))).toBe(
      false,
    );
  });

  it('a pull at the threshold, or a rider who set none: never', () => {
    const windows = ride({ rider: CLEAN });
    expect(kinds(cuesOver(windows, { threshold: 200, power: () => 200 }).said)).not.toContain(
      'shorter-pull',
    );
    expect(kinds(cuesOver(windows, { threshold: null, power: () => 400 }).said)).not.toContain(
      'shorter-pull',
    );
  });

  it('the mean is of each pull’s own windows: an easy pull, then a hard one', () => {
    // The rider's pulls: from 58 s and from 238 s. Easy before 200 s, hard after.
    const windows = ride({ rider: CLEAN });
    const { said } = cuesOver(windows, {
      threshold: 180,
      power: (atMs) => (atMs < 200_000 ? 100 : 200),
    });
    const shorter = said.filter((each) => each.cue?.kind === 'shorter-pull');
    expect(shorter.length).toBe(1);
    expect(shorter[0]?.atMs).toBeGreaterThan(238_000);
  });
});

describe('nothing during a hard effort beyond the cue that started it', () => {
  // The line is on a climb from 300 m before it for the whole ride after 100 m.
  const climbAheadM = (frontM: number): number | null => (frontM < 100 ? 400 - frontM : 0);

  it('a gap on the climb is not corrected', () => {
    const windows = ride({ rider: CLEAN, climbAheadM, seconds: 200 });
    const view = (window: LineWindow): RotationView =>
      window.atMs >= 30_000 && window.step.roles['you'] === 'in-line'
        ? moveRider(window.view, { distanceM: aheadOfRider(window) - 3 })
        : window.view;
    const { said } = cuesOver(windows, { view });
    expect(kinds(said)).toContain('climb');
    expect(said.filter((each) => each.cue?.family === 'correction' || each.mark !== null)).toEqual(
      [],
    );
  });

  it('a press on the climb: last-wheel is said, the other events are not', () => {
    const line = [RIDER, bot('b1'), bot('b2'), bot('b3')];
    const windows = rideLine({
      line,
      seed: 1,
      seconds: 60,
      climbAheadM,
      rider: { signalAfterMs: 20_000 },
    }).windows;
    const { said } = cuesOver(windows);
    expect(kinds(said)).toEqual(['your-pull', 'climb', 'last-wheel']);
  });
});

describe('no cue urges more effort, and none carries a power', () => {
  it('every kind asks to hold, ease, move smoothly or nothing', () => {
    expect([...CUE_ASKS]).toEqual(['hold', 'ease', 'position', 'inform']);
    for (const kind of CUE_KINDS) expect(CUE_ASKS).toContain(CUE_ASK[kind]);
    for (const word of [...CUE_KINDS, ...CUE_ASKS]) {
      expect(word).not.toMatch(/push|harder|faster|more|attack|chase|sprint|effort|power|watt/);
    }
    expect(CUE_KINDS).toEqual([...CUE_EVENT_KINDS, ...CUE_CORRECTION_KINDS]);
  });

  it('a cue is a kind and a family, and its type names no power and no target', () => {
    const declared = /export type Cue =([\s\S]*?);\n/.exec(cuesSource)?.[1] ?? '';
    expect(declared).toContain('kind');
    expect(declared).not.toMatch(/watt|power|target|speed|metres|number/i);
    for (const kind of CUE_KINDS) {
      const { windows, alter } = scenario(kind);
      for (const each of cuesOver(windows, alter).said) {
        if (each.cue !== null) expect(Object.keys(each.cue).sort()).toEqual(['family', 'kind']);
      }
    }
  });
});

describe('the clean rider is not nagged: cues a minute under the stated ceiling', () => {
  it('a 30 min fixture ride with climbs', () => {
    // A climb every 4 km.
    const climbAheadM = (frontM: number): number | null => {
      const into = frontM % 4_000;
      return into < 3_000 ? 3_000 - into : into < 3_400 ? 0 : 4_000 - into + 3_000;
    };
    const windows = rideLine({
      line: SIX,
      seed: 7,
      seconds: 1_800,
      rider: CLEAN,
      climbAheadM,
    }).windows;
    const { said } = cuesOver(windows);
    const perMinute = kinds(said).length / 30;
    expect(perMinute).toBeGreaterThan(0.5);
    expect(perMinute).toBeLessThanOrEqual(CUE_CEILING_PER_MINUTE);
    expect(said.filter((each) => each.cue?.family === 'correction')).toEqual([]);
  });
});

describe('deterministic, once per window, and only for a line with a rider', () => {
  it('the same inputs give the same cues', () => {
    const windows = ride({ rider: CLEAN });
    expect(cuesOver(windows)).toEqual(cuesOver(windows));
  });

  it('inside a window it says nothing and changes nothing', () => {
    const windows = ride({ rider: CLEAN });
    const first = windows[0] as LineWindow;
    const decided = stepCues(startCues(0), {
      rotation: first.step,
      line: first.view,
      powerWatts: 200,
      thresholdWatts: null,
    });
    const inside = stepCues(decided.state, {
      rotation: { ...first.step, requests: [{ kind: 'pull-off-due' }] },
      line: { ...first.view, atMs: 500 },
      powerWatts: 200,
      thresholdWatts: null,
    });
    expect(inside.cue).toBeNull();
    expect(inside.state).toBe(decided.state);
  });

  it('a step after a skipped stretch keeps its windows a second apart', () => {
    const windows = ride({ rider: CLEAN });
    const first = windows[0] as LineWindow;
    const late = stepCues(startCues(0), {
      rotation: first.step,
      line: { ...first.view, atMs: 7_500 },
      powerWatts: 200,
      thresholdWatts: null,
    });
    expect(late.state.nextWindowAtMs).toBe(8_500);
  });

  it('a line of bots only: no cue', () => {
    const windows = rideLine({
      line: [bot('b1'), bot('b2'), bot('b3')],
      seed: 1,
      seconds: 120,
    }).windows;
    expect(cuesOver(windows).said.every((each) => each.cue === null)).toBe(true);
  });
});

describe('a view the selector refuses', () => {
  const windows = ride({ rider: CLEAN, seconds: 10 });
  const first = windows[0] as LineWindow;
  const codeOf = (run: () => unknown): string | undefined => {
    try {
      run();
    } catch (error) {
      return error instanceof GroupRideError ? error.code : 'not a GroupRideError';
    }
    return undefined;
  };
  it.each<[string, number | null, number | null]>([
    ['a power below zero', -1, null],
    ['a power that is not a number', Number.NaN, null],
    ['a threshold that is not finite', 200, Number.POSITIVE_INFINITY],
  ])('%s', (_, powerWatts, thresholdWatts) => {
    expect(
      codeOf(() =>
        stepCues(startCues(0), {
          rotation: first.step,
          line: first.view,
          powerWatts,
          thresholdWatts,
        }),
      ),
    ).toBe('view-out-of-range');
  });

  it('a role or a phase from outside the lists: refused, never defaulted', () => {
    const oddRole = { ...first.step, roles: { ...first.step.roles, you: 'dropped' as RiderRole } };
    expect(
      codeOf(() =>
        stepCues(startCues(0), {
          rotation: oddRole,
          line: first.view,
          powerWatts: 200,
          thresholdWatts: null,
        }),
      ),
    ).toBe('unknown-value');
    const oddPhase = {
      ...first.step,
      state: { ...first.step.state, phase: 'dropped' as LinePhase },
    };
    expect(
      codeOf(() =>
        stepCues(startCues(0), {
          rotation: oddPhase,
          line: first.view,
          powerWatts: 200,
          thresholdWatts: null,
        }),
      ),
    ).toBe('unknown-value');
  });

  it('a start that is not finite, and a window before the last', () => {
    expect(codeOf(() => startCues(Number.NaN))).toBe('view-out-of-range');
    const later = stepCues(startCues(0), {
      rotation: first.step,
      line: { ...first.view, atMs: 5_000 },
      powerWatts: 200,
      thresholdWatts: null,
    });
    expect(
      codeOf(() =>
        stepCues(later.state, {
          rotation: first.step,
          line: { ...first.view, atMs: 4_000 },
          powerWatts: 200,
          thresholdWatts: null,
        }),
      ),
    ).toBe('instant-out-of-order');
  });
});

describe('platform-free, and only + − × ÷ min max sqrt (ADR 0067 D-5.2)', () => {
  it('cues.ts reads no clock, draws no random number and calls no other Math', () => {
    const code = cuesSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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
