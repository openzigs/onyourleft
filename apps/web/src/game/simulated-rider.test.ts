// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1992: the simulated rider's query, its sensors, its clock and its mark.
 * `simulated-rider-wiring.test.tsx` rides it through the real game screen;
 * `simulated-body.test.ts` pins the curves of its invented readings (#3210).
 */

import { describe, expect, it } from 'vitest';

import {
  simulatedClock,
  previewPower,
  previewRider,
  simulatedRideText,
  simulatedRiderFromHash,
  simulatedRiderKey,
  simulatedStartMetres,
  SimulatedRiderSensors,
} from './simulated-rider';

describe('simulatedRiderFromHash', () => {
  it('reads the power, the speed-up and the start from the game route’s query', () => {
    expect(simulatedRiderFromHash('#/game?simulate=200&speedup=8&at=5000')).toEqual({
      watts: 200,
      speedup: 8,
      startMetres: 5000,
    });
    expect(simulatedRiderFromHash('#/game?route=r1&simulate=150')).toEqual({
      watts: 150,
      speedup: 1,
      startMetres: undefined,
    });
  });

  it('is off with no power, or one that is not above nought and at most 2000 W', () => {
    for (const hash of [
      '',
      '#/game',
      '#/game?route=r1',
      '#/game?simulate=',
      '#/game?simulate=on',
      '#/game?simulate=0',
      '#/game?simulate=-50',
      '#/game?simulate=2001',
      '#/game?simulate=Infinity',
      '#/game?speedup=8',
    ]) {
      expect(simulatedRiderFromHash(hash), hash).toBeUndefined();
    }
    expect(simulatedRiderFromHash('#/game?simulate=2000')?.watts).toBe(2000);
  });

  it('holds the speed-up to 1–32 and reads a speed-up that is not a number as real time', () => {
    expect(simulatedRiderFromHash('#/game?simulate=200&speedup=100')?.speedup).toBe(32);
    expect(simulatedRiderFromHash('#/game?simulate=200&speedup=0.5')?.speedup).toBe(1);
    expect(simulatedRiderFromHash('#/game?simulate=200&speedup=fast')?.speedup).toBe(1);
    expect(simulatedRiderFromHash('#/game?simulate=200&speedup=32')?.speedup).toBe(32);
  });

  it('starts at the start line for a start that is not a non-negative number', () => {
    expect(simulatedRiderFromHash('#/game?simulate=200&at=-1')?.startMetres).toBeUndefined();
    expect(simulatedRiderFromHash('#/game?simulate=200&at=x')?.startMetres).toBeUndefined();
    expect(simulatedRiderFromHash('#/game?simulate=200&at=0')?.startMetres).toBe(0);
  });

  it('reads a fixed cadence and heart rate — #3210', () => {
    expect(simulatedRiderFromHash('#/game?simulate=200&cadence=92&hr=141')).toEqual({
      watts: 200,
      speedup: 1,
      startMetres: undefined,
      cadence: 92,
      heartRate: 141,
    });
    expect(simulatedRiderFromHash('#/game?simulate=200&cadence=0')?.cadence).toBe(0);
    expect(simulatedRiderFromHash('#/game?simulate=200&cadence=200&hr=30')).toMatchObject({
      cadence: 200,
      heartRate: 30,
    });
    expect(simulatedRiderFromHash('#/game?simulate=200&hr=230')?.heartRate).toBe(230);
  });

  it('leaves a cadence or heart rate it cannot take invented — #3210', () => {
    for (const hash of [
      '#/game?simulate=200&cadence=-1&hr=29',
      '#/game?simulate=200&cadence=201&hr=231',
      '#/game?simulate=200&cadence=fast&hr=',
    ]) {
      const rider = simulatedRiderFromHash(hash);
      expect(rider, hash).toEqual({ watts: 200, speedup: 1, startMetres: undefined });
    }
  });
});

describe('simulatedRiderKey', () => {
  it('is one key for every ordinary ride and a different one for each choice', () => {
    const a = simulatedRiderFromHash('#/game?simulate=200');
    const b = simulatedRiderFromHash('#/game?simulate=200&speedup=8');
    const c = simulatedRiderFromHash('#/game?simulate=200&at=10');
    expect(simulatedRiderKey(undefined)).toBe(simulatedRiderKey(undefined));
    const keys = new Set([simulatedRiderKey(undefined), ...[a, b, c].map(simulatedRiderKey)]);
    expect(keys.size).toBe(4);
    // #3210: a fixed reading is a choice of its own.
    const fixed = [
      simulatedRiderFromHash('#/game?simulate=200&cadence=90'),
      simulatedRiderFromHash('#/game?simulate=200&hr=140'),
      simulatedRiderFromHash('#/game?simulate=200&cadence=90&hr=140'),
    ].map(simulatedRiderKey);
    expect(new Set([...keys, ...fixed]).size).toBe(7);
    expect(simulatedRiderKey(simulatedRiderFromHash('#/game?route=x&simulate=200'))).toBe(
      simulatedRiderKey(a),
    );
  });
});

describe('SimulatedRiderSensors — #3210', () => {
  const rider = { watts: 250, speedup: 1, startMetres: undefined };
  const START = 50_000;

  it('rides the chosen power, and a body at rest before the ride starts, all live and paired', () => {
    const sensors = new SimulatedRiderSensors(rider).read(START + 60_000);
    expect(sensors.rider).toEqual({ power: 250, live: true, paired: true });
    expect(sensors.cadence).toEqual({ value: 0, live: true, paired: true });
    expect(sensors.heartRate.live).toBe(true);
    expect(sensors.heartRate.paired).toBe(true);
    expect(sensors.heartRate.value).toBeGreaterThanOrEqual(65);
    expect(sensors.heartRate.value).toBeLessThanOrEqual(75);
  });

  it('invents a cadence and heart rate on the ride’s clock from its start', () => {
    const sensors = new SimulatedRiderSensors(rider);
    sensors.start(START, () => 0, {});
    expect(sensors.read(START).cadence.value).toBe(0);
    for (let ms = 100; ms <= 300_000; ms += 100) sensors.read(START + ms);
    const after = sensors.read(START + 300_000);
    expect(after.cadence.value).toBeGreaterThanOrEqual(85);
    expect(after.cadence.value).toBeLessThanOrEqual(95);
    expect(after.heartRate.value).toBeGreaterThanOrEqual(160);
    expect(after.heartRate.value).toBeLessThanOrEqual(180);
  });

  it('reads the gradient it was handed, and slows the legs on a climb', () => {
    const cadenceOn = (grade: number): number | undefined => {
      const sensors = new SimulatedRiderSensors(rider);
      sensors.start(START, () => grade, {});
      for (let ms = 100; ms <= 60_000; ms += 100) sensors.read(START + ms);
      return sensors.read(START + 60_000).cadence.value;
    };
    expect(cadenceOn(10)).toBeLessThanOrEqual(80);
    expect(cadenceOn(0)).toBeGreaterThanOrEqual(85);
  });

  it('scales the heart rate to the thresholds it was handed', () => {
    const heartAt = (own: { power?: number; heartRate?: number }): number | undefined => {
      const sensors = new SimulatedRiderSensors(rider);
      sensors.start(START, () => 0, own);
      for (let ms = 1_000; ms <= 600_000; ms += 1_000) sensors.read(START + ms);
      return sensors.read(START + 600_000).heartRate.value;
    };
    expect(heartAt({ power: 250, heartRate: 150 })).toBeLessThanOrEqual(152);
    expect(heartAt({})).toBeGreaterThanOrEqual(165);
  });

  it('starts at rest again on the next ride', () => {
    const sensors = new SimulatedRiderSensors(rider);
    sensors.start(START, () => 0, {});
    for (let ms = 1_000; ms <= 120_000; ms += 1_000) sensors.read(START + ms);
    sensors.start(START + 200_000, () => 0, {});
    expect(sensors.read(START + 200_000).cadence.value).toBe(0);
    expect(sensors.read(START + 200_000).heartRate.value).toBeLessThanOrEqual(75);
  });

  it('reads the fixed cadence and heart rate it was asked for in place of invented ones', () => {
    const sensors = new SimulatedRiderSensors({ ...rider, cadence: 0, heartRate: 141 });
    sensors.start(START, () => 0, {});
    for (let ms = 100; ms <= 30_000; ms += 100) sensors.read(START + ms);
    expect(sensors.read(START + 30_000).cadence).toEqual({ value: 0, live: true, paired: true });
    expect(sensors.read(START + 30_000).heartRate).toEqual({
      value: 141,
      live: true,
      paired: true,
    });
  });
});

describe('simulatedClock', () => {
  it('runs the given clock faster by the speed-up, from the moment it is made', () => {
    let now = 1_000;
    const clock = simulatedClock(() => now, 8);
    expect(clock()).toBe(1_000);
    now = 1_500;
    expect(clock()).toBe(5_000);
    now = 2_000;
    expect(clock()).toBe(9_000);
  });

  it('is the given clock at a speed-up of one', () => {
    let now = 42;
    const clock = simulatedClock(() => now, 1);
    now = 1_042;
    expect(clock()).toBe(1_042);
  });
});

describe('simulatedStartMetres', () => {
  it('is the asked distance, held to the route, or the start line', () => {
    const at = (startMetres: number | undefined) =>
      simulatedStartMetres({ watts: 200, speedup: 1, startMetres }, 2_000);
    expect(at(undefined)).toBeUndefined();
    expect(at(750)).toBe(750);
    expect(at(9_000)).toBe(2_000);
    expect(at(0)).toBe(0);
  });
});

describe('simulatedRideText', () => {
  it('says the ride is simulated, at what power and pace, and that it is kept nowhere', () => {
    expect(simulatedRideText({ watts: 200, speedup: 1, startMetres: undefined })).toBe(
      'Simulated ride at 200 W. Not recorded or shared. Moving needs a recording.',
    );
    expect(simulatedRideText({ watts: 200, speedup: 8, startMetres: 5 })).toBe(
      'Simulated ride at 200 W, 8× real time. Not recorded or shared. Moving needs a recording.',
    );
  });
});

describe('previewPower — the picker’s power box (PR #2113)', () => {
  it('takes whole watts from 50 to 1000, and refuses anything else with one sentence', () => {
    expect(previewPower('200')).toEqual({ watts: 200 });
    expect(previewPower('50')).toEqual({ watts: 50 });
    expect(previewPower('1000')).toEqual({ watts: 1000 });
    const refusal = { problem: 'Enter a whole number of watts from 50 to 1000.' };
    for (const text of ['49', '1001', '205.5', '', '  ', 'fast', '-200']) {
      expect(previewPower(text), text).toEqual(refusal);
    }
  });

  it('rides a preview from the start line at the speed-up chosen', () => {
    expect(previewRider(250, 4)).toEqual({ watts: 250, speedup: 4, startMetres: undefined });
  });
});
