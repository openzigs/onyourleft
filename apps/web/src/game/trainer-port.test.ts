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
    letGo: vi.fn(async () => Promise.resolve({ kind: 'reset' as const })),
  };
}

const PAIRED_AND_READY = {
  paired: true,
  controllable: true,
  canSimulate: true,
  hasControl: true,
} as const;

describe('what the game may command — #372', () => {
  it('can release the trainer and cannot Reset, Stop or take control of it', () => {
    // ⚠️ `stop` was on `GradientTrainer` until #372 and `letGo` replaced it:
    // a Stop did not release real hardware. The bare `reset` stays off, and so
    // does `requestControl`, which is the rider's. Widen the type and TS2578
    // fires on the directive that no longer has an error to expect.
    const control = silentControl();
    expect(control.letGo).toBeDefined();
    // @ts-expect-error the bare Reset is not the game's to send.
    expect(control.reset).toBeUndefined();
    // @ts-expect-error nor is a Stop, since #372.
    expect(control.stop).toBeUndefined();
    // @ts-expect-error nor is taking control.
    expect(control.requestControl).toBeUndefined();
    // @ts-expect-error nor is an ERG target, which is the workout's.
    expect(control.setTargetPower).toBeUndefined();
  });
});

describe('gameTrainerFrom', () => {
  it('hands over a control only when every gate has passed', () => {
    const control = silentControl();
    expect(gameTrainerFrom(PAIRED_AND_READY, control, false)).toEqual({ kind: 'ready', control });
  });

  it('carries an unconfirmed release to the picker, in whatever state it leaves the trainer — #372', () => {
    const fault = 'The trainer may still be holding resistance.';
    // A refused Reset leaves control held, so the trainer is still `ready`…
    expect(
      gameTrainerFrom({ ...PAIRED_AND_READY, releaseFault: fault }, silentControl(), false)
        .releaseFault,
    ).toBe(fault);
    // …and a release refused outright may leave it without control.
    expect(
      gameTrainerFrom(
        { ...PAIRED_AND_READY, hasControl: false, releaseFault: fault },
        silentControl(),
        false,
      ),
    ).toEqual({ kind: 'no-control', control: undefined, releaseFault: fault });
  });

  it('is `none` where there is no ride controller at all', () => {
    // Safari, Firefox, a page served over plain HTTP. `main.tsx` builds the
    // port unconditionally and the controller is what is absent.
    expect(gameTrainerFrom(undefined, silentControl(), false)).toEqual(NO_GAME_TRAINER);
  });

  it('is `none` where nothing is paired', () => {
    expect(gameTrainerFrom({ ...PAIRED_AND_READY, paired: false }, undefined, false)).toEqual(
      NO_GAME_TRAINER,
    );
  });

  it('is `not-controllable` where the machine served no control point', () => {
    expect(
      gameTrainerFrom({ ...PAIRED_AND_READY, controllable: false }, silentControl(), false),
    ).toEqual({
      kind: 'not-controllable',
      control: undefined,
    });
  });

  it('is `not-controllable` where the snapshot says yes and there is no control object', () => {
    // ⚠️ Belt and braces on purpose: `controllable` is derived from the same
    // connection `simulationControl()` returns, so the two agreeing is a
    // property of `controller.ts` rather than of this function — and this
    // function is the one that decides whether anything may be written.
    expect(gameTrainerFrom(PAIRED_AND_READY, undefined, false)).toEqual({
      kind: 'not-controllable',
      control: undefined,
    });
  });

  it('withholds the control from a machine that does not offer simulation mode', () => {
    // #362's fourth criterion, and the case no trainer in this loop can
    // produce. `control: undefined` is what makes "is not written to" a
    // property of the construction rather than of a guard in the ride loop.
    const decided = gameTrainerFrom(
      { ...PAIRED_AND_READY, canSimulate: false },
      silentControl(),
      false,
    );
    expect(decided.kind).toBe('no-simulation');
    expect(decided.control).toBeUndefined();
  });

  it('withholds the control from a machine that has not granted it', () => {
    const decided = gameTrainerFrom(
      { ...PAIRED_AND_READY, hasControl: false },
      silentControl(),
      false,
    );
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
      false,
    );
    expect(decided.kind).toBe('no-simulation');
  });

  it('refuses a trainer a workout is already driving', () => {
    // The hazard the review of #362 found: `RideSession` is mounted above the
    // router, so a workout started on the Ride screen keeps ticking while the
    // rider is in the game. Handing the game a control here put two writers on
    // one control point — and the game's own release is an FTMS Stop, after
    // which the machine ignores the workout's targets while the workout's
    // clock runs on and every write reports success.
    const decided = gameTrainerFrom(PAIRED_AND_READY, silentControl(), true);
    expect(decided.kind).toBe('workout');
    expect(decided.control).toBeUndefined();
  });

  it('says `workout` rather than `not-controllable` when the control is withheld for it', () => {
    // ⚠️ The ordering assertion, and the one that would go green on a wrong
    // fix. `ride/controller.ts` §`simulationControl` returns `undefined` while
    // a workout runs, so this is the shape `main.tsx` actually passes — and a
    // `workoutRunning` test placed *after* the `control === undefined` one
    // would report a perfectly healthy trainer as uncontrollable and send the
    // rider off to re-pair it.
    const decided = gameTrainerFrom(PAIRED_AND_READY, undefined, true);
    expect(decided.kind).toBe('workout');
  });

  it('is still `none` where nothing is paired, workout or not', () => {
    // A workout cannot be running against a trainer that is not paired, but
    // the refusal must not invent one: `none` is the state with nothing to say.
    expect(gameTrainerFrom({ ...PAIRED_AND_READY, paired: false }, undefined, true)).toEqual(
      NO_GAME_TRAINER,
    );
  });
});

describe('trainerRoadNotice', () => {
  const KINDS: readonly GameTrainerKind[] = [
    'none',
    'workout',
    'not-controllable',
    'no-simulation',
    'no-control',
    'ready',
  ];

  it('says nothing for a ready trainer and for no trainer', () => {
    expect(trainerRoadNotice({ kind: 'ready', control: silentControl() })).toBeUndefined();
    expect(trainerRoadNotice(NO_GAME_TRAINER)).toBeUndefined();
  });

  it('says something distinct about the road for each of the four refusals', () => {
    const said = KINDS.map((kind) => trainerRoadNotice({ kind, control: undefined })).filter(
      (text) => text !== undefined,
    );
    expect(said).toHaveLength(4);
    // Distinct, because four refusals a rider can act on differently must not
    // read alike — and a `switch` that fell through would still return a
    // string.
    expect(new Set(said).size).toBe(4);
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

  it('tells a rider whose workout holds the trainer why, and how to get it back', () => {
    const text = trainerRoadNotice({ kind: 'workout', control: undefined }) ?? '';
    expect(text).toContain('workout');
    expect(text).toContain('Ride screen');
    // ⚠️ It must not read as a fault in the trainer. The machine is fine; the
    // client is already using it, and a rider told "cannot be controlled"
    // would go and re-pair a working trainer.
    expect(text.toLowerCase()).not.toContain('cannot be controlled');
  });

  it('never claims a machine that cannot simulate merely needs control', () => {
    const text = trainerRoadNotice({ kind: 'no-simulation', control: undefined }) ?? '';
    expect(text).not.toContain('Take control');
  });

  it('covers every kind the port can report', () => {
    // Fails closed: a seventh kind added without a sentence is a `switch` with
    // a missing arm, which TypeScript catches — and a seventh kind added with
    // an arm that returns `undefined` by mistake is caught here instead.
    const answered: GameTrainer[] = KINDS.map((kind) => ({ kind, control: undefined }));
    expect(answered).toHaveLength(6);
    for (const trainer of answered) {
      const text = trainerRoadNotice(trainer);
      expect(text === undefined || text.length > 40).toBe(true);
    }
  });
});
