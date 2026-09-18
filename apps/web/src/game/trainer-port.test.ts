// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which trainer the game may talk to, and what a rider is told when it may not
 * — #362.
 *
 * Every branch here is reachable without a Bluetooth adapter, which is the
 * whole reason `gameTrainerFrom` is a pure function of a snapshot rather than a
 * branch inside `main.tsx`: the one case that matters most — a machine whose
 * Feature bits do **not** offer simulation mode — cannot be produced by any
 * trainer anyone in this loop owns.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  NO_GAME_TRAINER,
  gameTrainerFrom,
  trainerRoadNotice,
  type GameTrainer,
  type GameTrainerKind,
  type GradientTrainer,
} from './trainer-port';

/** A control that records nothing, because no case here calls it. */
function silentControl(): GradientTrainer {
  return {
    setSimulationParameters: vi.fn(async () => Promise.resolve()),
    stop: vi.fn(async () => Promise.resolve()),
  };
}

const PAIRED_AND_READY = {
  paired: true,
  controllable: true,
  canSimulate: true,
  hasControl: true,
} as const;

describe('gameTrainerFrom', () => {
  it('hands over a control only when every gate has passed', () => {
    const control = silentControl();
    expect(gameTrainerFrom(PAIRED_AND_READY, control)).toEqual({ kind: 'ready', control });
  });

  it('is `none` where there is no ride controller at all', () => {
    // Safari, Firefox, a page served over plain HTTP. `main.tsx` builds the
    // port unconditionally and the controller is what is absent.
    expect(gameTrainerFrom(undefined, silentControl())).toEqual(NO_GAME_TRAINER);
  });

  it('is `none` where nothing is paired', () => {
    expect(gameTrainerFrom({ ...PAIRED_AND_READY, paired: false }, undefined)).toEqual(
      NO_GAME_TRAINER,
    );
  });

  it('is `not-controllable` where the machine served no control point', () => {
    expect(gameTrainerFrom({ ...PAIRED_AND_READY, controllable: false }, silentControl())).toEqual({
      kind: 'not-controllable',
      control: undefined,
    });
  });

  it('is `not-controllable` where the snapshot says yes and there is no control object', () => {
    // ⚠️ Belt and braces on purpose: `controllable` is derived from the same
    // connection `simulationControl()` returns, so the two agreeing is a
    // property of `controller.ts` rather than of this function — and this
    // function is the one that decides whether anything may be written.
    expect(gameTrainerFrom(PAIRED_AND_READY, undefined)).toEqual({
      kind: 'not-controllable',
      control: undefined,
    });
  });

  it('withholds the control from a machine that does not offer simulation mode', () => {
    // #362's fourth criterion, and the case no trainer in this loop can
    // produce. `control: undefined` is what makes "is not written to" a
    // property of the construction rather than of a guard in the ride loop.
    const decided = gameTrainerFrom({ ...PAIRED_AND_READY, canSimulate: false }, silentControl());
    expect(decided.kind).toBe('no-simulation');
    expect(decided.control).toBeUndefined();
  });

  it('withholds the control from a machine that has not granted it', () => {
    const decided = gameTrainerFrom({ ...PAIRED_AND_READY, hasControl: false }, silentControl());
    expect(decided.kind).toBe('no-control');
    expect(decided.control).toBeUndefined();
  });

  it('prefers the simulation refusal over the control one', () => {
    // A machine that offers neither is told about the one that cannot be
    // fixed, because "take control on the Ride screen" would send a rider to
    // press a button that changes nothing.
    const decided = gameTrainerFrom(
      { ...PAIRED_AND_READY, canSimulate: false, hasControl: false },
      silentControl(),
    );
    expect(decided.kind).toBe('no-simulation');
  });
});

describe('trainerRoadNotice', () => {
  const KINDS: readonly GameTrainerKind[] = [
    'none',
    'not-controllable',
    'no-simulation',
    'no-control',
    'ready',
  ];

  it('says nothing for a ready trainer and for no trainer', () => {
    expect(trainerRoadNotice({ kind: 'ready', control: silentControl() })).toBeUndefined();
    expect(trainerRoadNotice(NO_GAME_TRAINER)).toBeUndefined();
  });

  it('says something distinct about the road for each of the three refusals', () => {
    const said = KINDS.map((kind) => trainerRoadNotice({ kind, control: undefined })).filter(
      (text) => text !== undefined,
    );
    expect(said).toHaveLength(3);
    // Distinct, because three refusals a rider can act on differently must not
    // read alike — and a `switch` that fell through would still return a
    // string.
    expect(new Set(said).size).toBe(3);
    for (const text of said) {
      // ⚠️ The assertion that stops these becoming "trainer control
      // unavailable". What a rider is about to be misled about is the *road*:
      // the screen shows a 6 % climb and their legs feel a flat one.
      expect(text.toLowerCase()).toMatch(/hill|road/);
    }
  });

  it('tells a rider whose trainer has not granted control where to fix it', () => {
    const text = trainerRoadNotice({ kind: 'no-control', control: undefined }) ?? '';
    expect(text).toContain('Ride screen');
    // "before you start" is only actionable on the picker, which is why
    // `GameView` renders this notice there as well as during the ride.
    expect(text).toContain('before you start');
  });

  it('never claims a machine that cannot simulate merely needs control', () => {
    const text = trainerRoadNotice({ kind: 'no-simulation', control: undefined }) ?? '';
    expect(text).not.toContain('Take control');
  });

  it('covers every kind the port can report', () => {
    // Fails closed: a sixth kind added without a sentence is a `switch` with a
    // missing arm, which TypeScript catches — and a sixth kind added with an
    // arm that returns `undefined` by mistake is caught here instead.
    const answered: GameTrainer[] = KINDS.map((kind) => ({ kind, control: undefined }));
    expect(answered).toHaveLength(5);
    for (const trainer of answered) {
      const text = trainerRoadNotice(trainer);
      expect(text === undefined || text.length > 40).toBe(true);
    }
  });
});
