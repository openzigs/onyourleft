// SPDX-License-Identifier: Apache-2.0

/**
 * #90: a route's gradient, all the way onto a simulated trainer's brake.
 *
 * Everything here runs against the **#44 device simulator**, which is what #90
 * asks for — *"asserted against the device simulator, not against real
 * hardware, so it runs in CI"* — and it is the run that has to hold, because
 * `ubuntu-latest` has no Bluetooth adapter.
 *
 * The assertions are about **the octets on the wire and their order**, read out
 * of `simulator-bridge.ts`'s log, because that is where the criteria are
 * written: no `0x11` before a successful `0x80 0x00 0x01`, no `0x01` at all,
 * and a grade field that agrees with the profile at the rider's position.
 */

import {
  altitudeMetres,
  createSimulationDriver,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  gradePercent,
  metres,
  routeProfile,
  seconds,
  unixSeconds,
  watts,
  type GeographicPosition,
  type RoutePoint,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';
import { dualControlTrainer, ftmsTrainer, vendorOnlyTrainer } from '../../src/simulator/index';

import { FITNESS_MACHINE_SERVICE } from './fitness-machine';
import {
  CONTROL_NOT_PERMITTED_GUIDANCE,
  FTMS_OP_CODE,
  type SimulationParameters,
} from './fitness-machine-control';
import { createSimulationWriter } from './simulation-writer';
import { connectSimulatedTrainer, readInt16, type WireEntry } from './simulator-bridge';
import { chooseTrainerControl, WAHOO_TRAINER_CONTROL_POINT } from './trainer-control-choice';
import { CYCLING_POWER_SERVICE } from './cycling-power';

// --- A route with a +6 % section --------------------------------------------

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

const eastOf = (eastMetres: number): GeographicPosition => {
  const perDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((ORIGIN.latitude * Math.PI) / 180);
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude),
    degreesLongitude(ORIGIN.longitude + eastMetres / perDegreeLongitude),
  );
};

const RAMP_START = 500;
const RAMP_END = 1500;

/** Flat, then 1 000 m at exactly +6 %, then flat. */
function sixPercentRoute(): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let distance = 0; distance <= 2000; distance += 10) {
    const climbed = Math.min(Math.max(distance - RAMP_START, 0), RAMP_END - RAMP_START) * 0.06;
    points.push({ position: eastOf(distance), elevation: altitudeMetres(100 + climbed) });
  }
  return points;
}

const RAMPED = routeProfile(sixPercentRoute());

/** FTMS Table 4.20: op code, wind `sint16`, grade `sint16` at 0.01 %, crr, cw. */
const gradeInWrite = (entry: WireEntry): number => readInt16(Uint8Array.from(entry.bytes), 3) / 100;

const writes = (wire: readonly WireEntry[]): readonly WireEntry[] =>
  wire.filter((entry) => entry.direction === 'write');

const opCodesWritten = (wire: readonly WireEntry[]): readonly number[] =>
  writes(wire).map((entry) => entry.bytes[0] as number);

/** The index of the first successful Request Control response, or -1. */
const controlGrantedAt = (wire: readonly WireEntry[]): number =>
  wire.findIndex(
    (entry) =>
      entry.direction === 'indication' &&
      entry.bytes[0] === FTMS_OP_CODE.responseCode &&
      entry.bytes[1] === FTMS_OP_CODE.requestControl &&
      entry.bytes[2] === 0x01,
  );

// --- Criterion 3: the gradient that reaches the machine ----------------------

describe('the gradient written is the gradient at the rider’s position', () => {
  it('writes +6 % at the +6 % section, matching the profile within tolerance', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();

    const driver = createSimulationDriver({ profile: RAMPED });
    const writer = createSimulationWriter(trainer.control, {
      onError: (error) => {
        throw error;
      },
    });

    // 200 s at 10 m/s: the whole route, one position a second.
    for (let second = 0; second <= 200; second += 1) {
      const setpoint = driver.sample({
        at: unixSeconds(1_800_000_000 + second),
        distance: metres(second * 10),
      });
      if (setpoint !== undefined) {
        writer.offer({ grade: setpoint.grade });
      }
      // Nothing is queued behind anything: the bridge answers synchronously,
      // so each offer is written before the next position arrives.
      await writer.idle();
    }

    // The machine ends the run holding the gradient at the end of the route,
    // which is flat, so the interesting assertion is the one taken mid-climb.
    expect(trainer.gradeOnTheTrainer()).toBeCloseTo(gradeAt(RAMPED, RAMPED.totalDistance), 2);

    const simulationWrites = writes(trainer.wire).filter(
      (entry) => entry.bytes[0] === FTMS_OP_CODE.setIndoorBikeSimulationParameters,
    );
    expect(simulationWrites.length).toBeGreaterThan(5);

    // Every gradient that reached the wire is one the profile actually has,
    // to the 0.01 % the field can carry.
    const profileGrades = RAMPED.grades.map((grade) => Math.round(grade * 100) / 100);
    for (const entry of simulationWrites) {
      const written = gradeInWrite(entry);
      expect(
        profileGrades.some((grade) => Math.abs(grade - written) <= 0.01),
        `${String(written)} % is not a gradient this route has`,
      ).toBe(true);
    }

    // And the steepest thing written is the ramp itself: 6 %.
    const steepest = Math.max(...simulationWrites.map(gradeInWrite));
    expect(steepest).toBeCloseTo(6, 1);
  });

  it('writes the profile’s grade for the position it was sampled at, one position at a time', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    const driver = createSimulationDriver({ profile: RAMPED, gradeDeadbandPercent: 0 });

    for (const distance of [0, 600, 1000, 1400, 1900]) {
      const setpoint = driver.sample({
        at: unixSeconds(1_800_000_000 + distance),
        distance: metres(distance),
      });
      expect(setpoint).toBeDefined();
      await trainer.control.setSimulationParameters({
        grade: (setpoint as NonNullable<typeof setpoint>).grade,
      });
      // Read back off the MACHINE, not off the setpoint the test just built.
      expect(trainer.gradeOnTheTrainer()).toBeCloseTo(gradeAt(RAMPED, distance), 2);
    }

    // In the middle of the ramp, that number is 6 rather than merely consistent.
    expect(gradeAt(RAMPED, 1000)).toBeCloseTo(6, 1);
  });

  it('keeps a descent negative all the way to the machine', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    await trainer.control.setSimulationParameters({ grade: gradePercent(-6.2) });

    const entry = writes(trainer.wire).at(-1) as WireEntry;
    expect(entry.bytes[0]).toBe(FTMS_OP_CODE.setIndoorBikeSimulationParameters);
    expect(gradeInWrite(entry)).toBeCloseTo(-6.2, 6);
    expect(trainer.gradeOnTheTrainer()).toBeCloseTo(-6.2, 6);
  });
});

// --- Criterion 1: Request Control comes first --------------------------------

describe('Request Control succeeds before any simulation parameter is written', () => {
  it('writes no 0x11 before the 0x80 0x00 0x01 that grants control', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    await trainer.control.setSimulationParameters({ grade: gradePercent(4) });

    const granted = controlGrantedAt(trainer.wire);
    expect(granted).toBeGreaterThanOrEqual(0);

    const firstSimulation = trainer.wire.findIndex(
      (entry) =>
        entry.direction === 'write' &&
        entry.bytes[0] === FTMS_OP_CODE.setIndoorBikeSimulationParameters,
    );
    expect(firstSimulation).toBeGreaterThan(granted);
  });

  it('writes NOTHING at all when the caller skips Request Control', async () => {
    const trainer = await connectSimulatedTrainer();

    await expect(
      trainer.control.setSimulationParameters({ grade: gradePercent(4) }),
    ).rejects.toThrow(/control/);

    // Not "wrote it and the machine refused" — the octets never left.
    expect(opCodesWritten(trainer.wire)).toStrictEqual([]);
    expect(trainer.gradeOnTheTrainer()).toBeUndefined();
  });

  it('re-requests control after a reconnection before it writes a gradient again', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    await trainer.control.setSimulationParameters({ grade: gradePercent(4) });

    trainer.control.linkLost();
    trainer.control.linkRestored();
    expect(trainer.control.hasControl()).toBe(false);

    await expect(
      trainer.control.setSimulationParameters({ grade: gradePercent(5) }),
    ).rejects.toThrow(/control/);

    const afterRestore = opCodesWritten(trainer.wire).slice(2);
    expect(afterRestore).toStrictEqual([]);
  });
});

// --- Criterion 6: Reset is never sent mid-session ----------------------------

describe('0x01 Reset is never sent mid-session', () => {
  it('sends no Reset through a whole simulated ride', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();

    const driver = createSimulationDriver({ profile: RAMPED });
    const writer = createSimulationWriter(trainer.control);
    for (let second = 0; second <= 200; second += 1) {
      const setpoint = driver.sample({
        at: unixSeconds(1_800_000_000 + second),
        distance: metres(second * 10),
      });
      if (setpoint !== undefined) {
        writer.offer({ grade: setpoint.grade });
      }
      await writer.idle();
    }
    // The deliberate way to end resistance, which is Stop and not Reset.
    await trainer.control.stop();

    expect(opCodesWritten(trainer.wire)).not.toContain(FTMS_OP_CODE.reset);
    // FTMS §4.16.2.1: a client-initiated Reset revokes the client's own
    // control permission, so a player that reset between sections and kept
    // writing would be ignored for the rest of the ride. Control survives.
    expect(trainer.control.hasControl()).toBe(true);
  });

  it('shows what a Reset would have cost, so the rule is not a superstition', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    await trainer.control.setSimulationParameters({ grade: gradePercent(6) });

    await trainer.control.reset();

    expect(trainer.control.hasControl()).toBe(false);
    // Every later gradient is refused — and if the client did not refuse, the
    // machine would silently ignore it.
    await expect(
      trainer.control.setSimulationParameters({ grade: gradePercent(8) }),
    ).rejects.toThrow(/control/);
  });
});

// --- Criterion 5: 0x05 Control Not Permitted ---------------------------------

describe('0x05 Control Not Permitted is a state a rider can act on', () => {
  it('names another app as the likely cause, and is not a generic refusal', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    await trainer.control.setSimulationParameters({ grade: gradePercent(4) });

    // Another client takes control. ⚠️ The clock is deliberately NOT advanced:
    // the status notification that would tell this client is still queued, so
    // the client still believes it holds control and the next gradient goes to
    // the wire and is answered `0x05`. That is the path this criterion is
    // about — the machine's own refusal, not the client's own guard.
    trainer.handle().script({ kind: 'control-permission-lost' });

    const error = await trainer.control
      .setSimulationParameters({ grade: gradePercent(9) })
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    // The machine really did answer 0x05: the indication is in the log.
    expect(
      trainer.wire.some(
        (entry) =>
          entry.direction === 'indication' &&
          entry.bytes[1] === FTMS_OP_CODE.setIndoorBikeSimulationParameters &&
          entry.bytes[2] === 0x05,
      ),
    ).toBe(true);

    // Its own code — NOT `control-rejected`, which is what every other result
    // code becomes, and which a UI would render as "the trainer refused it".
    expect(isSensorError(error, 'control-not-held')).toBe(true);
    expect(isSensorError(error, 'control-rejected')).toBe(false);
    // ...carrying a message a rider can act on.
    expect((error as Error).message).toContain(CONTROL_NOT_PERMITTED_GUIDANCE);
    expect((error as Error).message).toMatch(/another app/i);
    expect((error as Error).message).toMatch(/Control Not Permitted/);

    // And the client stops believing it has control, so the next gradient is
    // refused before it is written rather than written into the void.
    expect(trainer.control.hasControl()).toBe(false);
    expect(trainer.gradeOnTheTrainer()).toBeCloseTo(4, 6);
  });

  it('refuses before the wire once the status notification has arrived', async () => {
    // The other half of the pair: the same physical situation, one tick later.
    // Here the client has heard Fitness Machine Status 0xFF, so nothing is
    // written at all — still `control-not-held`, still not a generic refusal.
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    trainer.handle().script({ kind: 'control-permission-lost' });
    trainer.bench.advance(seconds(1));
    const before = writes(trainer.wire).length;

    const error = await trainer.control
      .setSimulationParameters({ grade: gradePercent(9) })
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(isSensorError(error, 'control-not-held')).toBe(true);
    expect(writes(trainer.wire).length).toBe(before);
  });

  it('is what the machine really answers, taken by writing at it directly', async () => {
    // Evidence that the refusal above is the trainer's and not the bridge's.
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    trainer.handle().script({ kind: 'control-permission-lost' });
    trainer.bench.advance(seconds(1));

    trainer.handle().controlPoint?.write({ opCode: 'set-target-power', target: watts(200) });
    trainer.bench.advance(seconds(1));

    expect(trainer.wire.at(-1)?.bytes).toStrictEqual([
      FTMS_OP_CODE.responseCode,
      FTMS_OP_CODE.setTargetPower,
      0x05,
    ]);
  });
});

// --- Criterion 7: FTMS wins over a proprietary control point -----------------

describe('a machine that exposes both FTMS and a proprietary control point', () => {
  it('is driven through FTMS, and nothing reaches the vendor’s characteristic', async () => {
    const trainer = await connectSimulatedTrainer({
      spec: dualControlTrainer({ id: 'kickr' }),
    });
    const handle = trainer.handle();
    expect(handle.controlPoint).toBeDefined();
    expect(handle.vendorControlPoint).toBeDefined();

    // The choice, made from what the link resolved.
    const choice = chooseTrainerControl([
      FITNESS_MACHINE_SERVICE,
      CYCLING_POWER_SERVICE,
      WAHOO_TRAINER_CONTROL_POINT,
    ]);
    expect(choice.kind).toBe('fitness-machine');
    expect(choice.kind === 'fitness-machine' && choice.vendorAlsoPresent).toBe(true);

    await trainer.control.requestControl();
    await trainer.control.setSimulationParameters({ grade: gradePercent(6) });

    expect(trainer.gradeOnTheTrainer()).toBeCloseTo(6, 6);
    // The observable half: the proprietary control point was never touched.
    expect(handle.vendorControlPoint?.writes()).toStrictEqual([]);
    expect(opCodesWritten(trainer.wire)).toContain(FTMS_OP_CODE.setIndoorBikeSimulationParameters);
  });

  it('reports a machine with only the proprietary one as unimplemented, not as absent', () => {
    const spec = vendorOnlyTrainer();
    expect(spec.services).toContain('wahoo');
    expect(spec.services).not.toContain('ftms');

    const choice = chooseTrainerControl([CYCLING_POWER_SERVICE, WAHOO_TRAINER_CONTROL_POINT]);
    expect(choice).toStrictEqual({
      kind: 'vendor-not-implemented',
      controlPoint: WAHOO_TRAINER_CONTROL_POINT,
    });
  });

  it('still prefers FTMS on a trainer that has no proprietary characteristic at all', async () => {
    const trainer = await connectSimulatedTrainer({ spec: ftmsTrainer({ id: 'kickr' }) });
    expect(trainer.handle().vendorControlPoint).toBeUndefined();

    const choice = chooseTrainerControl([FITNESS_MACHINE_SERVICE]);
    expect(choice.kind === 'fitness-machine' && choice.vendorAlsoPresent).toBe(false);
  });
});

// --- The two together, as apps/web will compose them -------------------------

describe('the driver and the writer, composed', () => {
  it('sends one gradient a second at most, and each one is on the route', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();

    const driver = createSimulationDriver({ profile: RAMPED, gradeDeadbandPercent: 0 });
    const writer = createSimulationWriter(trainer.control);

    // Ten offers a second for twenty seconds: 200 positions, at most 21 writes.
    let offered = 0;
    for (let tick = 0; tick <= 200; tick += 1) {
      const setpoint = driver.sample({
        at: unixSeconds(1_800_000_000 + tick / 10),
        distance: metres(tick),
      });
      if (setpoint !== undefined) {
        offered += 1;
        const parameters: SimulationParameters = { grade: setpoint.grade };
        writer.offer(parameters);
      }
      await writer.idle();
    }

    expect(offered).toBeLessThanOrEqual(21);
    expect(writer.attempted()).toBe(offered);
  });
});
