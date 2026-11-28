// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The gradient control loop, against a trainer that records what it was told
 * — #362.
 *
 * ⚠️ **This file is necessary and is not sufficient**, and saying so is the
 * point: every one of #278's five defects had a green unit suite exactly like
 * this one. What makes the wiring real is `trainer-wiring.test.tsx`, which
 * drives the actual component and reads what a *trainer* was handed.
 */

import { describe, expect, it, vi } from 'vitest';

import { createGradientSession } from './gradient';
import type { GradientTrainer } from './trainer-port';
import { TargetHeldBack } from '../ride/held-back';
import { anchorScenery } from './scenery-anchor';
import {
  MAX_SIMULATED_GRADE_PERCENT,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  routeProfile,
  seconds,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';
import { SensorError } from '@onyourleft/sensors';
import type { SimulationParameters, TrainerRelease } from '@onyourleft/sensors/protocol';

/** A kilometre rising at a steady 4 %, then a kilometre falling at 4 %. */
function hill(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 100 ? index * 0.4 : (200 - index) * 0.4),
    });
  }
  return routeProfile(points);
}

/** A trainer that keeps every command, and answers whatever it is told to. */
function recordingTrainer(
  options: {
    readonly reject?: Error | undefined;
    readonly release?: TrainerRelease | undefined;
  } = {},
): {
  readonly control: GradientTrainer;
  readonly written: SimulationParameters[];
  readonly releases: number[];
} {
  const written: SimulationParameters[] = [];
  const releases: number[] = [];
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      written.push(parameters);
      if (options.reject !== undefined) {
        return Promise.reject(options.reject);
      }
      return Promise.resolve();
    },
    letGo: async () => {
      releases.push(written.length);
      return Promise.resolve(options.release ?? { kind: 'stopped' });
    },
  };
  return { control, written, releases };
}

/** Let the writer's promise chain run out. */
const drain = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

/** What a rider is told when the ride controller held a gradient back. */
const HELD_BACK =
  'The hills are not being sent yet: Bluetooth is still finishing forgetting a trainer. The next gradient will be sent again.';

/** What a rider is told while the trainer is being let go to be forgotten (#728). */
const HELD_WHILE_LETTING_GO =
  'That gradient was held back: this app asked the trainer to let go so it can be forgotten.';

/** What a rider is told once the ride controller was disposed (#728, #729). */
const HELD_AFTER_LETTING_GO =
  'The hills are no longer being sent: this app has stopped driving the trainer.';

/** Once its trainer has been detached (#732). */
const HELD_AFTER_DISCONNECT =
  'The hills are no longer being sent: this trainer is not connected to this app any more.';

/** The fault a session reports when its one gradient is refused with `error`. */
async function faultFor(error: Error): Promise<string> {
  const trainer = recordingTrainer({ reject: error });
  const session = createGradientSession({ profile: hill(), control: trainer.control });
  session.sample(seconds(0), 500);
  await drain();
  return session.state().fault ?? '';
}

describe('a gradient session drives a trainer from a route', () => {
  it('writes the gradient at the rider, through #90s driver', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });

    // 500 m in, halfway up the climb. `gradeAt` is interpolated on the
    // profile's own 10 m grid, so this is the road's number rather than one
    // this test computed.
    session.sample(seconds(0), 500);
    await drain();

    expect(trainer.written).toHaveLength(1);
    expect(trainer.written[0]?.grade).toBeCloseTo(4, 1);
    expect(session.state().writes).toBe(1);
    expect(session.state().asked).toBeCloseTo(4, 1);
  });

  it('signs a descent negative, so the sign reaches the rider’s legs', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });

    session.sample(seconds(0), 1_500);
    await drain();

    expect(trainer.written[0]?.grade).toBeLessThan(-3);
  });

  it('sends the grade and nothing else', async () => {
    // ⚠️ Deliberate, and `gradient.ts` §"What is deliberately NOT sent" says
    // why at length: the rider's wind is out of #362's scope and the drag area
    // they choose in #365 would double-count against the game's own physics.
    // Asserted rather than described, so adding one is a decision somebody
    // makes on purpose.
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 500);
    await drain();
    expect(Object.keys(trainer.written[0] ?? {})).toEqual(['grade']);
  });

  it('does not spend a write a second on a road that has not changed', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });

    // Six seconds of a steady 4 % climb, sampled every second.
    for (let at = 0; at <= 6; at += 1) {
      session.sample(seconds(at), 400 + at * 7);
      await drain();
    }
    // The driver's own deadband. One write for the first sample and nothing
    // after it, because 70 m of a constant gradient is under 0.1 % of change.
    expect(trainer.written).toHaveLength(1);
  });

  it('writes at most once a second however often it is offered', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });

    // Sixty frames at 60 fps covering one second of a climb that really is
    // changing under the rider — a hairpin's worth of gradient in a second.
    for (let frame = 0; frame < 60; frame += 1) {
      session.sample(seconds(frame / 60), 900 + frame * 3);
      await drain();
    }
    expect(trainer.written.length).toBeLessThanOrEqual(2);
  });

  it('never asks for more than the driver’s ceiling', async () => {
    // A cliff: 40 m of climb in 10 m of road.
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 20; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (index * 10) / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(index < 10 ? 0 : (index - 9) * 40),
      });
    }
    const trainer = recordingTrainer();
    const session = createGradientSession({
      profile: routeProfile(points),
      control: trainer.control,
    });
    for (let at = 0; at < 20; at += 1) {
      session.sample(seconds(at), 90 + at * 10);
      await drain();
    }
    for (const parameters of trainer.written) {
      expect(Math.abs(parameters.grade)).toBeLessThanOrEqual(MAX_SIMULATED_GRADE_PERCENT);
    }
  });

  it('restarts the driver after a refused write, so the next sample is not swallowed', async () => {
    // ⚠️ The case the deadband makes invisible without `driver.restart()`. The
    // driver believes it wrote the gradient it was refused, so an identical
    // road would never produce a second attempt and the trainer would be left
    // on the hill from before the failure.
    const trainer = recordingTrainer({ reject: new Error('control-not-permitted') });
    const session = createGradientSession({ profile: hill(), control: trainer.control });

    session.sample(seconds(0), 500);
    await drain();
    session.sample(seconds(2), 507);
    await drain();

    expect(trainer.written).toHaveLength(2);
    expect(trainer.written[1]?.grade).toBeCloseTo(4, 1);
  });

  it('tells the rider what a refused write means, without naming a characteristic', async () => {
    const trainer = recordingTrainer({ reject: new Error('control-not-permitted') });
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 500);
    await drain();

    const fault = session.state().fault ?? '';
    expect(fault).toContain('Ride screen');
    expect(fault).not.toMatch(/0x|characteristic|uuid/i);
  });

  it('tells the change listener, so a screen can re-render', async () => {
    const trainer = recordingTrainer();
    const onChange = vi.fn();
    const session = createGradientSession({
      profile: hill(),
      control: trainer.control,
      onChange,
    });
    session.sample(seconds(0), 500);
    await drain();
    expect(onChange).toHaveBeenCalled();
  });

  it('clears an old fault once a write goes through again', async () => {
    let failing = true;
    const control: GradientTrainer = {
      setSimulationParameters: async () =>
        failing ? Promise.reject(new Error('boom')) : undefined,
      letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
    };
    const session = createGradientSession({ profile: hill(), control });
    session.sample(seconds(0), 500);
    await drain();
    expect(session.state().fault).toBeDefined();

    failing = false;
    session.sample(seconds(2), 900);
    await drain();
    expect(session.state().fault).toBeUndefined();
  });

  it('releases the trainer when the ride ends, through letGo() rather than a flat road', async () => {
    // #362's "what happens to the applied resistance when the ride is stopped",
    // and `docs/validation/0002` Part L5. FTMS simulation parameters persist on
    // the machine until they are changed, so a ride ended on a wall would leave
    // the flywheel loaded against whoever gets on next. ⚠️ Since #372 the
    // release is `letGo()`, the ride controller's one release, so a game ride
    // is joined with any other and a refused one is reported like every other.
    // `stop` is not on `GradientTrainer` any more, so reverting to it is a
    // compile error; the octets a release sends are asserted in
    // `fitness-machine-control.test.ts`, and what a real trainer does with
    // them is validation 0002 L5 — on the one measured, nothing.
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 500);
    await drain();

    session.stop();
    await drain();

    expect(trainer.releases).toHaveLength(1);
    // Not a gradient of zero: a flat road is still a statement about the road.
    expect(trainer.written.every((parameters) => parameters.grade !== 0)).toBe(true);
  });

  it('is idempotent about stopping, because two paths end a ride', async () => {
    // "End ride" and the effect's cleanup both call it, and a rider who
    // navigates away has ended the ride just as surely as one who pressed the
    // button.
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.stop();
    session.stop();
    await drain();
    expect(trainer.releases).toHaveLength(1);
  });

  it('writes nothing after it has been stopped', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.stop();
    session.sample(seconds(1), 500);
    await drain();
    await session.settled();
    expect(trainer.written).toHaveLength(0);
  });

  it('tells the rider when the release itself is refused', async () => {
    // ⚠️ The path a rider most needs to be told about, because its consequence
    // is resistance left on a machine after they have got off. The write
    // succeeded, so the failure arrives only from `letGo()`.
    const control: GradientTrainer = {
      setSimulationParameters: async () => Promise.resolve(),
      letGo: async () => Promise.reject(new Error('control-not-held')),
    };
    const session = createGradientSession({ profile: hill(), control });
    session.sample(seconds(0), 500);
    await drain();
    session.stop();
    await drain();
    expect(session.state().fault).toContain('not granted control');
  });

  it('tells the rider when the trainer refused the release', async () => {
    // #372: a release the machine refused or did not answer is said out loud.
    const trainer = recordingTrainer({
      release: {
        kind: 'incomplete',
        refusal: new SensorError('control-rejected', 'operation-failed'),
      },
    });
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 500);
    await drain();

    session.stop();
    await drain();

    expect(session.state().fault).toContain('may still be holding resistance');
  });

  it('says nothing is wrong when the Stop was acknowledged', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 500);
    await drain();
    session.stop();
    await drain();
    expect(session.state().fault).toBeUndefined();
  });

  it('words each refusal for the road rather than for a target', async () => {
    // Eight distinct sentences, because a rider reading "the trainer refused
    // that target" while looking at a hill would go looking for a workout they
    // are not riding.
    const said = new Set<string>();
    for (const error of [
      new Error('control-not-permitted'),
      new Error('control-not-held'),
      new Error('timed out'),
      new Error('nonsense'),
      // `ride/controller.ts` §`mustWaitForForget` — the app held it back (#718).
      new TargetHeldBack('forget-running', 'a trainer is still being forgotten'),
      // The controller's other two holds (#728).
      new TargetHeldBack('letting-go-to-forget', 'the trainer is being forgotten'),
      new TargetHeldBack('let-go', 'the ride controller was disposed and writes nothing again'),
      // And once its trainer has been detached (#732).
      new TargetHeldBack('disconnected', 'the trainer is no longer connected to this app'),
    ]) {
      said.add(await faultFor(error));
    }
    expect(said.size).toBe(8);
    expect(said).toContain(HELD_BACK);
    expect(said).toContain(HELD_WHILE_LETTING_GO);
    expect(said).toContain(HELD_AFTER_LETTING_GO);
    expect(said).toContain(HELD_AFTER_DISCONNECT);
    for (const text of said) {
      expect(text).toMatch(/road|hill|gradient/);
    }
  });

  describe('a gradient the ride controller held back (#724)', () => {
    it('is recognised by its class, whatever its reason says', async () => {
      // A reworded reason, and one that says what a machine that did not
      // answer would: neither is told as anything but the hold.
      expect(await faultFor(new TargetHeldBack('forget-running', 'forget pending'))).toBe(
        HELD_BACK,
      );
      expect(await faultFor(new TargetHeldBack('forget-running', 'the forget timed out'))).toBe(
        HELD_BACK,
      );
    });

    it('words each hold by its kind, never by its reason (#728)', async () => {
      // The same words under each kind: only the kind decides the sentence.
      const reason = 'a trainer is still being forgotten';
      expect(await faultFor(new TargetHeldBack('forget-running', reason))).toBe(HELD_BACK);
      expect(await faultFor(new TargetHeldBack('letting-go-to-forget', reason))).toBe(
        HELD_WHILE_LETTING_GO,
      );
      expect(await faultFor(new TargetHeldBack('let-go', reason))).toBe(HELD_AFTER_LETTING_GO);
      expect(await faultFor(new TargetHeldBack('disconnected', reason))).toBe(
        HELD_AFTER_DISCONNECT,
      );
    });

    it('promises the next gradient only for the hold that lifts by itself (#728)', async () => {
      // A forget that is running lands and the hold lifts; a trainer let go to
      // be forgotten is gone once it has been, and a disposed controller
      // writes nothing again — so neither may say the next one will be sent.
      expect(HELD_BACK).toContain('will be sent again');
      for (const hold of ['letting-go-to-forget', 'let-go', 'disconnected'] as const) {
        const text = await faultFor(new TargetHeldBack(hold, 'held'));
        expect(text).not.toMatch(/sent again|refused/);
        // #729's review: each is on screen while the release's Stop is in
        // flight and after it was refused, so neither says it completed.
        expect(text).not.toMatch(/has let|is being let go|let the trainer go|released/);
      }
    });

    it('is not recognised by its words', async () => {
      // The words without the class are a refusal like any other: nothing
      // here reads the sentence any more.
      expect(await faultFor(new Error('a trainer is still being forgotten'))).toBe(
        'The trainer refused that gradient. The next one will be sent again.',
      );
    });
  });

  it('counts what a slow machine cost, rather than queueing it', async () => {
    // A trainer that never answers. The writer keeps at most one in flight and
    // one waiting, so a rider whose machine stalls does not accumulate a
    // backlog of hills they have already ridden past.
    const written: SimulationParameters[] = [];
    const control: GradientTrainer = {
      setSimulationParameters: async (parameters) => {
        written.push(parameters);
        return new Promise<void>(() => undefined);
      },
      letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
    };
    const session = createGradientSession({ profile: hill(), control });
    for (let at = 0; at < 30; at += 1) {
      session.sample(seconds(at), at * 40);
      await drain();
    }
    expect(written).toHaveLength(1);
    expect(session.state().coalesced).toBeGreaterThan(0);
  });
});

describe('a correction walks the trainer, however long since the last write — #928 review', () => {
  it('moves the first bounded write by at most one write interval’s step after a long steady climb', async () => {
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    // Up the 4 % climb, then nothing worth writing for 80 s: the driver's deadband.
    session.sample(seconds(0), 300);
    await drain();
    expect(trainer.written).toHaveLength(1);
    const climbing = trainer.written[0]?.grade ?? 0;
    expect(climbing).toBeCloseTo(4, 1);
    // A room moves the rider onto the descent, 80 s after that write.
    session.sample(seconds(80), 1_500, true);
    await drain();
    expect(trainer.written).toHaveLength(2);
    // One percent, not the eight between the two roads.
    expect(Math.abs((trainer.written[1]?.grade ?? 0) - climbing)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('a fault during a correction keeps the bound — #932', () => {
  /**
   * A trainer that refuses the writes `refuse` names (zero-based) and
   * confirms the rest — or, with `hold`, leaves that one unanswered until the
   * test settles it.
   */
  function faultyTrainer(refuse: ReadonlySet<number>, hold?: number) {
    const written: SimulationParameters[] = [];
    let settle: ((refused: Error) => void) | undefined;
    const control: GradientTrainer = {
      setSimulationParameters: async (parameters) => {
        const index = written.length;
        written.push(parameters);
        if (index === hold) {
          return new Promise<void>((_resolve, reject) => {
            settle = reject;
          });
        }
        if (refuse.has(index)) {
          return Promise.reject(new SensorError('control-rejected', 'operation-failed'));
        }
        return Promise.resolve();
      },
      letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
    };
    return {
      control,
      written,
      refuseHeld: (): void => settle?.(new Error('the write timed out')),
    };
  }

  it('steps the write after a refused one at most 1 % from the last confirmed grade', async () => {
    // Writes 0 (the climb, 4 %), 1 and 2 (the walk down) are confirmed; 3 is refused.
    const trainer = faultyTrainer(new Set([3]));
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 300);
    await drain();
    // A room moves the rider onto the descent: the road is −4 %, 8 % away.
    for (let at = 1; at <= 5; at += 1) {
      session.sample(seconds(at), 1_500, true);
      await drain();
    }
    const grades = trainer.written.map((parameters) => Number(parameters.grade));
    expect(grades.length).toBeGreaterThanOrEqual(5);
    expect(grades[0]).toBeCloseTo(4, 1);
    const lastConfirmed = grades[2] ?? Number.NaN;
    // The write after the refused one walks on from what the trainer holds.
    expect(Math.abs((grades[4] ?? Number.NaN) - lastConfirmed)).toBeLessThanOrEqual(1 + 1e-9);
    // And every write the trainer could have been on is a step from the last.
    for (let index = 1; index < grades.length; index += 1) {
      const from = index === 4 ? lastConfirmed : (grades[index - 1] ?? Number.NaN);
      expect(Math.abs((grades[index] ?? Number.NaN) - from)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('keeps the bound when the refusal comes after the correction has ended', async () => {
    // The correction is one sample; the walk after it is owed. Write 2 is refused.
    const trainer = faultyTrainer(new Set([2]));
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 300);
    await drain();
    session.sample(seconds(1), 1_500, true);
    await drain();
    for (let at = 2; at <= 4; at += 1) {
      session.sample(seconds(at), 1_500 + at);
      await drain();
    }
    const grades = trainer.written.map((parameters) => Number(parameters.grade));
    expect(grades.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs((grades[3] ?? Number.NaN) - (grades[1] ?? Number.NaN))).toBeLessThanOrEqual(
      1 + 1e-9,
    );
  });

  it('does not put a write walked from the refused grade on the trainer', async () => {
    // Write 1 is left unanswered while the walk carries on into the waiting
    // slot; then it times out. What is written next must still be a step from
    // the 4 % the trainer confirmed.
    const trainer = faultyTrainer(new Set(), 1);
    const session = createGradientSession({ profile: hill(), control: trainer.control });
    session.sample(seconds(0), 300);
    await drain();
    for (let at = 1; at <= 4; at += 1) {
      session.sample(seconds(at), 1_500, true);
      await drain();
    }
    expect(trainer.written).toHaveLength(2);
    trainer.refuseHeld();
    await drain();
    session.sample(seconds(5), 1_500, true);
    await drain();
    const grades = trainer.written.map((parameters) => Number(parameters.grade));
    expect(grades[0]).toBeCloseTo(4, 1);
    for (const grade of grades.slice(2)) {
      expect(Math.abs(grade - (grades[0] ?? Number.NaN))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('past a point-to-point route’s end, the trainer eases to flat — #3345', () => {
  /** `metres` north from 51.5° N, climbing at `percent` (falling, when negative). */
  function climb(percent: number, metres: number): RouteProfile {
    const points: RoutePoint[] = [];
    for (let along = 0; along <= metres; along += 10) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + along / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(100 + (along * percent) / 100),
      });
    }
    return routeProfile(points);
  }

  /** A loop: 300 m north descending at 5 %, and back 10 m east of it climbing at 5 %. */
  function loop(): RouteProfile {
    const points: RoutePoint[] = [];
    const east = 10 / (111_320 * Math.cos((51.5 * Math.PI) / 180));
    for (let along = 0; along <= 300; along += 10) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + along / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(100 - along * 0.05),
      });
    }
    for (let along = 300; along >= 0; along -= 10) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + along / 111_320),
          degreesLongitude(-0.12 + east),
        ),
        elevation: altitudeMetres(100 - along * 0.05),
      });
    }
    return routeProfile(points, { loop: true });
  }

  interface Write {
    readonly grade: number;
    readonly at: number;
    readonly distance: number;
  }

  /**
   * Rides `profile` from `from` to `to` metres at `speed` m/s, a sample every
   * quarter second as `GameView`'s loop samples, and keeps each write with the
   * ride second and distance it was offered at. With `stopAt`, the session is
   * stopped (the rider ended the ride) on the first sample at or past it.
   */
  async function rideOver(
    profile: RouteProfile,
    options: {
      readonly from: number;
      readonly to: number;
      readonly speed: number;
      readonly stopAt?: number;
      readonly refuse?: number;
    },
  ): Promise<{ readonly writes: Write[]; readonly releases: number[] }> {
    const frame = 0.25;
    let at = 0;
    let distance = options.from;
    const writes: Write[] = [];
    const releases: number[] = [];
    const control: GradientTrainer = {
      setSimulationParameters: async (parameters) => {
        const index = writes.length;
        writes.push({ grade: parameters.grade, at, distance });
        return index === options.refuse
          ? Promise.reject(new SensorError('control-rejected', 'operation-failed'))
          : Promise.resolve();
      },
      letGo: async () => {
        releases.push(writes.length);
        return Promise.resolve({ kind: 'stopped' as const });
      },
    };
    const session = createGradientSession({ profile, control });
    while (distance < options.to) {
      if (options.stopAt !== undefined && distance >= options.stopAt) session.stop();
      session.sample(seconds(at), distance);
      await drain();
      at += frame;
      distance += options.speed * frame;
    }
    return { writes, releases };
  }

  /**
   * Every write past the end is a step from the one before it within the
   * existing rate limit, toward 0 %, never away from it and never across it.
   * `held` maps a write to the one the trainer was holding before it, where a
   * refusal means that is not simply the write before.
   */
  function expectAMonotonicBoundedEase(
    writes: readonly Write[],
    end: number,
    held: (index: number) => number = (index) => index - 1,
  ): void {
    for (let index = 1; index < writes.length; index += 1) {
      const before = writes[held(index)] as Write;
      const write = writes[index] as Write;
      if (write.distance <= end) continue;
      const at = `${write.grade.toFixed(3)} % at ${(write.distance - end).toFixed(1)} m past the end`;
      // The existing rate limit: at most one write a second, and 1 % a second.
      expect(write.at - (writes[index - 1] as Write).at, at).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(Math.abs(write.grade - before.grade), at).toBeLessThanOrEqual(1 + 1e-9);
      // Toward flat, never away from it and never across it.
      expect(Math.abs(write.grade), at).toBeLessThanOrEqual(Math.abs(before.grade) + 1e-9);
      expect(Math.sign(write.grade) * Math.sign(before.grade), at).not.toBe(-1);
    }
  }

  it('walks the climb’s grade down to 0 % over about 100 m, then holds it, writing nothing more', async () => {
    const profile = climb(5, 600);
    const end: number = profile.totalDistance;
    // 30 km/h, from 200 m short of the end to 1 km past it.
    const { writes } = await rideOver(profile, {
      from: end - 200,
      to: end + 1_000,
      speed: 30 / 3.6,
    });
    const past = writes.filter((write) => write.distance > end);
    // Up to the end, the road's own grade there: the climb's, eased by the
    // profile's gradient windows over its last metres.
    const atTheEnd: number = gradeAt(profile, end);
    expect(atTheEnd).toBeGreaterThan(2);
    expect(writes.filter((write) => write.distance <= end).at(-1)?.grade).toBeCloseTo(atTheEnd, 0);
    // Non-vacuity: an ease, a write at a time.
    expect(past.length).toBeGreaterThanOrEqual(5);
    expectAMonotonicBoundedEase(writes, end);
    // Flat by about 100 m past the end, and exactly 0 %, not a deadband short of it.
    const flat = past.find((write) => write.grade === 0);
    expect(flat).toBeDefined();
    expect((flat?.distance ?? Number.POSITIVE_INFINITY) - end).toBeLessThanOrEqual(110);
    // And nothing after it: 0 % is held for the rest of the kilometre.
    expect(past.at(-1)).toBe(flat);
  });

  it('eases a descent’s grade up to 0 % the same way', async () => {
    const profile = climb(-6, 600);
    const end: number = profile.totalDistance;
    const { writes } = await rideOver(profile, { from: end - 200, to: end + 600, speed: 30 / 3.6 });
    const past = writes.filter((write) => write.distance > end);
    const atTheEnd: number = gradeAt(profile, end);
    expect(atTheEnd).toBeLessThan(-2);
    expect(writes.filter((write) => write.distance <= end).at(-1)?.grade).toBeCloseTo(atTheEnd, 0);
    expect(past.length).toBeGreaterThanOrEqual(5);
    expectAMonotonicBoundedEase(writes, end);
    expect(past.at(-1)?.grade).toBe(0);
  });

  it('never steps faster than the bound however fast the ride: an 8× preview’s speed eases over more road', async () => {
    const profile = climb(9, 800);
    const end: number = profile.totalDistance;
    // 70 m/s: the 100 m in under 1.5 s, which no walk at 1 % a second covers.
    const { writes } = await rideOver(profile, { from: end - 300, to: end + 1_500, speed: 70 });
    const past = writes.filter((write) => write.distance > end);
    expectAMonotonicBoundedEase(writes, end);
    // The end's grade in steps of at most 1 %: never at once.
    const atTheEnd: number = gradeAt(profile, end);
    expect(atTheEnd).toBeGreaterThan(4);
    expect(past.length).toBeGreaterThanOrEqual(Math.floor(atTheEnd));
    expect(past.at(-1)?.grade).toBe(0);
  });

  it('never walks away from flat, nor across it, when a correction is still walking at the line', async () => {
    // 300 m falling at 5 %, then 300 m climbing at 8 % to the end.
    const points: RoutePoint[] = [];
    for (let along = 0; along <= 600; along += 10) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + along / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(along <= 300 ? 100 - along * 0.05 : 85 + (along - 300) * 0.08),
      });
    }
    const profile = routeProfile(points);
    const end: number = profile.totalDistance;
    const trainer = recordingTrainer();
    const session = createGradientSession({ profile, control: trainer.control });
    // On the descent; then a room moves the rider to just short of the line,
    // and the grade walks up from the descent's at 1 % a second (#782)…
    session.sample(seconds(0), 150);
    await drain();
    session.sample(seconds(1), end - 5, true);
    await drain();
    // …and the rider crosses the line with the trainer still below flat.
    for (let at = 2; at <= 30; at += 1) {
      session.sample(seconds(at), end - 5 + at * 8);
      await drain();
    }
    const grades = trainer.written.map((parameters) => Number(parameters.grade));
    // Non-vacuity: below flat at the line, with the end's grade a climb.
    expect(grades[1]).toBeLessThan(-2);
    expect(gradeAt(profile, end)).toBeGreaterThan(2);
    for (let index = 2; index < grades.length; index += 1) {
      const before = grades[index - 1] ?? Number.NaN;
      const grade = grades[index] ?? Number.NaN;
      expect(Math.abs(grade - before)).toBeLessThanOrEqual(1 + 1e-9);
      // Up toward 0 %, and never over it into the end's climb.
      expect(grade).toBeGreaterThan(before);
      expect(grade).toBeLessThanOrEqual(0);
    }
    expect(grades.at(-1)).toBe(0);
  });

  it('stops with the ride: nothing is written once the session is stopped mid-ease', async () => {
    const profile = climb(6, 600);
    const end: number = profile.totalDistance;
    const ridden = await rideOver(profile, { from: end - 100, to: end + 400, speed: 30 / 3.6 });
    const stopped = await rideOver(profile, {
      from: end - 100,
      to: end + 400,
      speed: 30 / 3.6,
      stopAt: end + 30,
    });
    // The control: riding on writes the ease past 30 m.
    expect(ridden.writes.some((write) => write.distance > end + 30)).toBe(true);
    // Stopped 30 m past the end, mid-ease: released once and written to no more.
    expect(stopped.writes.some((write) => write.distance > end)).toBe(true);
    expect(stopped.writes.every((write) => write.distance < end + 30)).toBe(true);
    expect(stopped.releases).toEqual([stopped.writes.length]);
  });

  it('walks on from the grade the trainer holds when a write in the ease is refused', async () => {
    const profile = climb(5, 600);
    const end: number = profile.totalDistance;
    const ridden = await rideOver(profile, { from: end - 200, to: end + 400, speed: 30 / 3.6 });
    const refused = ridden.writes.findIndex((write) => write.distance > end) + 2;
    const { writes } = await rideOver(profile, {
      from: end - 200,
      to: end + 400,
      speed: 30 / 3.6,
      refuse: refused,
    });
    expect(writes.length).toBeGreaterThan(refused + 2);
    expect(writes[refused]?.distance).toBeGreaterThan(end);
    // The refused write was never held, so the one after it steps from the one before.
    expectAMonotonicBoundedEase(writes, end, (index) =>
      index === refused + 1 ? refused - 1 : index - 1,
    );
    expect(writes.at(-1)?.grade).toBe(0);
  });

  it('keeps the bound when a write held in the ease times out with another waiting — #932', async () => {
    const profile = climb(8, 600);
    const end: number = profile.totalDistance;
    const written: number[] = [];
    let timeOut: ((reason: Error) => void) | undefined;
    const control: GradientTrainer = {
      setSimulationParameters: async (parameters) => {
        written.push(Number(parameters.grade));
        // The third write, the second inside the ease, is left unanswered.
        if (written.length === 3) {
          return new Promise<void>((_resolve, reject) => {
            timeOut = reject;
          });
        }
        return Promise.resolve();
      },
      letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
    };
    const session = createGradientSession({ profile, control });
    session.sample(seconds(0), end - 100);
    await drain();
    // Seconds 1 and 2 write inside the ease; 3 and 4 find the slot occupied.
    for (let at = 1; at <= 4; at += 1) {
      session.sample(seconds(at), end + at * 10);
      await drain();
    }
    expect(written).toHaveLength(3);
    const confirmed = written[1] ?? Number.NaN;
    timeOut?.(new Error('the write timed out'));
    await drain();
    session.sample(seconds(5), end + 50);
    await drain();
    // Nothing walked from the timed-out grade goes out: the write after it is
    // a step from the grade the trainer confirmed, and never further from flat.
    expect(written.length).toBeGreaterThan(3);
    for (const grade of written.slice(3)) {
      expect(Math.abs(grade - confirmed)).toBeLessThanOrEqual(1 + 1e-9);
      expect(grade).toBeLessThanOrEqual(confirmed + 1e-9);
    }
  });

  it('leaves a loop alone: past its length it rides round onto its own grade', async () => {
    const profile = loop();
    expect(profile.loop).toBe(true);
    const lap: number = profile.totalDistance;
    const { writes } = await rideOver(profile, { from: lap - 200, to: lap + 200, speed: 30 / 3.6 });
    // Climbing in to the line, and over it onto the next lap's descent: never eased to 0 %.
    expect(writes.some((write) => write.distance < lap && write.grade > 3)).toBe(true);
    expect(writes.some((write) => write.distance > lap + 30 && write.grade < -3)).toBe(true);
  });

  it('leaves an open-world view alone, which has a road of its own ahead', async () => {
    const profile = climb(5, 600);
    anchorScenery(profile, { seed: 1, origin: 0 });
    const end: number = profile.totalDistance;
    const { writes } = await rideOver(profile, { from: end - 200, to: end + 300, speed: 30 / 3.6 });
    // The driver's own, as before #3345: the view's last grade, held.
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.at(-1)?.grade).toBeCloseTo(gradeAt(profile, end), 0);
    expect(writes.at(-1)?.grade).toBeGreaterThan(2);
  });
});
