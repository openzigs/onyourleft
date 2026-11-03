// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's drawn position on the bicycle — #1999: each of the owner's four
 * rules, the hysteresis and the dwell that keep it from flickering, and the
 * transition that draws a change as a movement.
 */

import { describe, expect, it } from 'vitest';

import { emptyRiderStance, stanceOf, type DrawnPosture, type RiderStance } from './bicycle';
import type { RidingInputs } from './port';
import {
  DROPS_ABOVE_METRES_PER_SECOND,
  DROPS_LEAVE_BELOW_METRES_PER_SECOND,
  POSTURE_DWELL_SECONDS,
  POSTURE_TRANSITION_SECONDS,
  STAND_ABOVE_GRADE_PERCENT,
  STAND_ABOVE_WATTS,
  STAND_BELOW_RPM,
  STAND_LEAVE_ABOVE_RPM,
  STAND_LEAVE_BELOW_GRADE_PERCENT,
  TOPS_BELOW_WATTS,
  TOPS_LEAVE_ABOVE_WATTS,
  drawnStance,
  emptyPostureTracker,
  ridingEffort,
  trackPosture,
  wantedPosture,
} from './posture';

/** A rider at 85 rpm and 200 W on the flat at 9 m/s: the hoods. */
const ORDINARY: RidingInputs = { cadence: 85, power: 200, grade: 0, speed: 9 };
const riding = (change: Partial<RidingInputs>): RidingInputs => ({ ...ORDINARY, ...change });

describe('the four rules — #1999', () => {
  it('rides an ordinary effort on the hoods, as every rider was drawn before', () => {
    expect(wantedPosture(ORDINARY, 'hoods')).toBe('hoods');
    expect(wantedPosture(undefined, 'standing')).toBe('hoods');
  });

  it('stands at a low cadence with high power, and not at either alone', () => {
    const grinding = riding({
      cadence: STAND_BELOW_RPM - 5,
      power: STAND_ABOVE_WATTS + 50,
      grade: 4,
      speed: 4,
    });
    expect(wantedPosture(grinding, 'hoods')).toBe('standing');
    expect(wantedPosture({ ...grinding, power: 220 }, 'hoods')).toBe('hoods');
    expect(wantedPosture({ ...grinding, cadence: 80 }, 'hoods')).not.toBe('standing');
    // A rule whose reading is missing is not met: no cadence sensor, no
    // standing for a cadence.
    expect(wantedPosture({ ...grinding, cadence: undefined }, 'hoods')).toBe('hoods');
  });

  it('stands on a steep grade, whatever the cadence, and on what a rider with no sensor has', () => {
    const steep = riding({ grade: STAND_ABOVE_GRADE_PERCENT + 1, speed: 4 });
    expect(wantedPosture(steep, 'hoods')).toBe('standing');
    // A ghost: its speed and the grade under it, nothing else.
    expect(
      wantedPosture({ cadence: undefined, power: undefined, grade: 9, speed: 3 }, 'hoods'),
    ).toBe('standing');
    expect(wantedPosture(riding({ grade: STAND_ABOVE_GRADE_PERCENT - 1 }), 'hoods')).toBe('hoods');
  });

  it('never stands stopped or not pedalling, however steep', () => {
    expect(wantedPosture(riding({ grade: 12, speed: 0 }), 'hoods')).not.toBe('standing');
    expect(wantedPosture(riding({ grade: 12, speed: 3, cadence: 0 }), 'hoods')).not.toBe(
      'standing',
    );
    expect(wantedPosture(riding({ grade: 12, speed: 3, power: 0 }), 'hoods')).not.toBe('standing');
  });

  it('goes to the drops when fast, and on a fast descent', () => {
    expect(wantedPosture(riding({ speed: DROPS_ABOVE_METRES_PER_SECOND + 0.5 }), 'hoods')).toBe(
      'drops',
    );
    expect(wantedPosture(riding({ speed: 10.5, grade: -5 }), 'hoods')).toBe('drops');
    // A coasting descent is a tuck, not sitting up.
    expect(wantedPosture(riding({ speed: 14, grade: -6, cadence: 0, power: 0 }), 'hoods')).toBe(
      'drops',
    );
    expect(wantedPosture(riding({ speed: 10.5, grade: 0 }), 'hoods')).toBe('hoods');
    expect(wantedPosture(riding({ speed: 7, grade: -5 }), 'hoods')).toBe('hoods');
  });

  it('sits up on the tops when the power is low or the rider coasts', () => {
    expect(wantedPosture(riding({ power: TOPS_BELOW_WATTS - 20 }), 'hoods')).toBe('upright');
    expect(wantedPosture(riding({ cadence: 0, power: undefined }), 'hoods')).toBe('upright');
    expect(wantedPosture(riding({ power: 0 }), 'hoods')).toBe('upright');
    // With no power reading a rider is not easy for want of one.
    expect(wantedPosture(riding({ power: undefined }), 'hoods')).toBe('hoods');
  });

  it('puts standing before the drops, and the drops before the tops', () => {
    expect(
      wantedPosture(riding({ grade: 9, speed: DROPS_ABOVE_METRES_PER_SECOND + 1 }), 'hoods'),
    ).toBe('standing');
    expect(wantedPosture(riding({ power: 50, speed: 14 }), 'hoods')).toBe('drops');
  });
});

describe('hysteresis: a position is kept on a gentler threshold than it is taken on — #1999', () => {
  it('keeps standing until the grade is well below the one it stood on', () => {
    const between = (STAND_ABOVE_GRADE_PERCENT + STAND_LEAVE_BELOW_GRADE_PERCENT) / 2;
    const climbing = riding({ grade: between, speed: 4 });
    expect(wantedPosture(climbing, 'hoods')).toBe('hoods');
    expect(wantedPosture(climbing, 'standing')).toBe('standing');
    expect(
      wantedPosture(riding({ grade: STAND_LEAVE_BELOW_GRADE_PERCENT - 0.5, speed: 4 }), 'standing'),
    ).toBe('hoods');
  });

  it('keeps standing at a low cadence until the cadence is well back up', () => {
    const cadence = (STAND_BELOW_RPM + STAND_LEAVE_ABOVE_RPM) / 2;
    const grinding = riding({ cadence, power: STAND_ABOVE_WATTS + 50, grade: 3, speed: 4 });
    expect(wantedPosture(grinding, 'hoods')).toBe('hoods');
    expect(wantedPosture(grinding, 'standing')).toBe('standing');
  });

  it('keeps the drops and the tops the same way', () => {
    const speed = (DROPS_ABOVE_METRES_PER_SECOND + DROPS_LEAVE_BELOW_METRES_PER_SECOND) / 2;
    expect(wantedPosture(riding({ speed }), 'hoods')).toBe('hoods');
    expect(wantedPosture(riding({ speed }), 'drops')).toBe('drops');
    const power = (TOPS_BELOW_WATTS + TOPS_LEAVE_ABOVE_WATTS) / 2;
    expect(wantedPosture(riding({ power }), 'hoods')).toBe('hoods');
    expect(wantedPosture(riding({ power }), 'upright')).toBe('upright');
  });
});

describe('a position is taken only once it has been wanted a while, and drawn as a movement — #1999', () => {
  const frame = 1 / 60;
  const STEEP = riding({ grade: 9, speed: 4 });

  /** Rides `seconds` of frames from `from` with `inputs`, returning the ride clock after. */
  function ride(
    tracker: ReturnType<typeof emptyPostureTracker>,
    inputs: RidingInputs,
    from: number,
    seconds: number,
  ): number {
    let at = from;
    for (let step = 0; step < Math.round(seconds / frame); step += 1) {
      at += frame;
      trackPosture(tracker, inputs, at);
    }
    return at;
  }

  it('takes the first frame’s position at once', () => {
    const tracker = trackPosture(emptyPostureTracker(), STEEP, 10);
    expect(tracker.posture).toBe('standing');
    expect(drawnStance(tracker, 10, emptyRiderStance()).standing).toBe(1);
  });

  it('does not change for a reading that wavers across a threshold, frame by frame', () => {
    const tracker = trackPosture(emptyPostureTracker(), ORDINARY, 0);
    let at = 0;
    for (let step = 0; step < 600; step += 1) {
      at += frame;
      // A grade read either side of the standing threshold on alternate frames.
      trackPosture(tracker, step % 2 === 0 ? STEEP : ORDINARY, at);
      expect(tracker.posture).toBe('hoods');
    }
  });

  it('stands once the climb has lasted the dwell, and not a frame before', () => {
    const tracker = trackPosture(emptyPostureTracker(), ORDINARY, 0);
    let at = 0;
    let stoodAt: number | undefined;
    while (at < 3) {
      at += frame;
      trackPosture(tracker, STEEP, at);
      if (stoodAt === undefined && tracker.posture === 'standing') stoodAt = at;
    }
    expect(stoodAt).toBeDefined();
    expect(stoodAt as number).toBeGreaterThanOrEqual(POSTURE_DWELL_SECONDS);
    expect(stoodAt as number).toBeLessThan(POSTURE_DWELL_SECONDS + 2 * frame);
  });

  it('moves the body there over the transition, never by more than a share of it in a frame', () => {
    const tracker = trackPosture(emptyPostureTracker(), ORDINARY, 0);
    const before = stanceOf('hoods', emptyRiderStance());
    const after = stanceOf('standing', emptyRiderStance());
    const drawn = emptyRiderStance();
    let at = 0;
    let previous = drawnStance(tracker, at, emptyRiderStance()).hipZ;
    let largest = 0;
    while (at < 4) {
      at += frame;
      trackPosture(tracker, STEEP, at);
      const hipZ = drawnStance(tracker, at, drawn).hipZ;
      largest = Math.max(largest, Math.abs(hipZ - previous));
      previous = hipZ;
    }
    // It got there…
    expect(drawn.hipZ).toBeCloseTo(after.hipZ, 12);
    // …and the hips moved forward out of the saddle, never in a jump: at most
    // twice the even share of a frame over the eased transition.
    const travel = Math.abs(after.hipZ - before.hipZ);
    expect(travel).toBeGreaterThan(0.1);
    expect(largest).toBeLessThan((2 * travel * frame) / POSTURE_TRANSITION_SECONDS);
  });

  // Read through a call, so the loop's own narrowing does not fix the type.
  const postureOf = (tracker: ReturnType<typeof emptyPostureTracker>): DrawnPosture =>
    tracker.posture;

  it('draws a change part-way through another from exactly where the body is', () => {
    const tracker = trackPosture(emptyPostureTracker(), ORDINARY, 0);
    let at = 0;
    while (tracker.posture !== 'standing') {
      at += frame;
      trackPosture(tracker, STEEP, at);
    }
    const stoodAt = tracker.changedAt;
    // The climb ends the moment the rider stands, so the change back is taken
    // before the body has finished standing up.
    let sat: number | undefined;
    const before = emptyRiderStance();
    const after = emptyRiderStance();
    for (let step = 0; step < 240; step += 1) {
      at += frame;
      drawnStance(tracker, at, before);
      trackPosture(tracker, ORDINARY, at);
      drawnStance(tracker, at, after);
      if (sat === undefined && postureOf(tracker) === 'hoods') sat = at;
      // Whatever the tracker decided this frame, the body is drawn where it
      // was: a change starts from the drawn stance, not the last posture's.
      for (const key of Object.keys(before) as (keyof RiderStance)[]) {
        expect(after[key], key).toBeCloseTo(before[key], 12);
      }
    }
    expect(sat).toBeDefined();
    // Not vacuous: the change back came while the first was still being drawn.
    expect((sat as number) - stoodAt).toBeLessThan(POSTURE_TRANSITION_SECONDS);
    expect(after.hipZ).toBeCloseTo(stanceOf('hoods', emptyRiderStance()).hipZ, 12);
  });

  it('holds still on a held ride: the same ride time is the same body', () => {
    const tracker = trackPosture(emptyPostureTracker(), ORDINARY, 0);
    const at = ride(tracker, STEEP, 0, POSTURE_DWELL_SECONDS + POSTURE_TRANSITION_SECONDS / 2);
    const held: RiderStance = { ...drawnStance(tracker, at, emptyRiderStance()) };
    for (let frames = 0; frames < 120; frames += 1) trackPosture(tracker, ORDINARY, at);
    expect(drawnStance(tracker, at, emptyRiderStance())).toEqual(held);
  });

  it('starts afresh when the ride clock goes back, as a new ride', () => {
    const tracker = trackPosture(emptyPostureTracker(), STEEP, 50);
    expect(tracker.posture).toBe('standing');
    trackPosture(tracker, ORDINARY, 0);
    expect(tracker.posture).toBe('hoods');
    expect(drawnStance(tracker, 0, emptyRiderStance()).standing).toBe(0);
  });
});

describe('effort, for the body’s motion — #1999', () => {
  it('grows with power and with cadence, and is the old ordinary effort with neither', () => {
    expect(ridingEffort(undefined)).toBe(0.5);
    expect(ridingEffort({ cadence: undefined, power: undefined, grade: 0, speed: 5 })).toBe(0.5);
    const easy = ridingEffort(riding({ power: 100, cadence: 60 }));
    const hard = ridingEffort(riding({ power: 400, cadence: 105 }));
    expect(easy).toBeLessThan(0.2);
    expect(hard).toBeGreaterThan(0.9);
    expect(ridingEffort(riding({ power: 250 }))).toBeGreaterThan(
      ridingEffort(riding({ power: 150 })),
    );
    expect(ridingEffort(riding({ cadence: 100 }))).toBeGreaterThan(
      ridingEffort(riding({ cadence: 70 })),
    );
    // Never outside nought to one.
    expect(ridingEffort(riding({ power: 2_000, cadence: 200 }))).toBe(1);
    expect(ridingEffort(riding({ power: 0, cadence: 0 }))).toBe(0);
  });
});

describe('each stance — #1999', () => {
  it('differs from the hoods where its posture says it should', () => {
    const of = (posture: DrawnPosture): RiderStance => stanceOf(posture, emptyRiderStance());
    const hoods = of('hoods');
    expect(of('drops').gripY).toBeLessThan(hoods.gripY - 0.1);
    expect(of('drops').shoulderY).toBeLessThan(hoods.shoulderY);
    expect(of('upright').shoulderY).toBeGreaterThan(hoods.shoulderY);
    expect(of('standing').hipZ).toBeGreaterThan(hoods.hipZ + 0.1);
    expect(of('standing').standing).toBe(1);
    expect(hoods.standing).toBe(0);
  });
});
