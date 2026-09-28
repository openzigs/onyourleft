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
import {
  MAX_SIMULATED_GRADE_PERCENT,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
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
    // Seven distinct sentences, because a rider reading "the trainer refused
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
      new TargetHeldBack('let-go', 'the ride controller has let the trainer go'),
    ]) {
      said.add(await faultFor(error));
    }
    expect(said.size).toBe(7);
    expect(said).toContain(HELD_BACK);
    expect(said).toContain(HELD_WHILE_LETTING_GO);
    expect(said).toContain(HELD_AFTER_LETTING_GO);
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
    });

    it('promises the next gradient only for the hold that lifts by itself (#728)', async () => {
      // A forget that is running lands and the hold lifts; a trainer let go to
      // be forgotten is gone once it has been, and a disposed controller
      // writes nothing again — so neither may say the next one will be sent.
      expect(HELD_BACK).toContain('will be sent again');
      for (const hold of ['letting-go-to-forget', 'let-go'] as const) {
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
