// SPDX-License-Identifier: Apache-2.0

/**
 * The #44 simulator's heart rate, read the way a rider's strap is read (#1238).
 *
 * Every observation here goes through the octets of a Heart Rate Measurement
 * and the real `heartRateProfile` — never through the simulator's own state —
 * so an encoding the decoder disagrees with is a red test, not a number the
 * simulator agrees with itself about.
 */

import { revolutionsPerMinute, seconds, watts, type BeatsPerMinute } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId, type MeasurementFor } from '../../src/index';
import {
  createSimulator,
  DEFAULT_RESTING_HEART_RATE,
  ftmsTrainer,
  hrsStrap,
  HUNT_HURNI_BPM_PER_WATT,
  type SimulatedHeartRate,
  type SimulatorOptions,
} from '../../src/simulator/index';
import { decodeHeartRateMeasurement } from './heart-rate';
import { heartRateFrameToOctets, heartRatesThroughTheDecoder } from './simulator-bridge';

const STRAP = deviceId('hrs-strap');
const TRAINER = deviceId('kickr');
const RESPONSIVE: SimulatedHeartRate = { kind: 'responsive' };

async function strapOn(options: Omit<SimulatorOptions, 'devices'> & { trainer?: boolean } = {}) {
  const devices =
    options.trainer === true ? [ftmsTrainer({ id: 'kickr' }), hrsStrap()] : [hrsStrap()];
  const simulator = createSimulator({ ...options, devices });
  await simulator.transport.connect(STRAP);
  const decoded: (BeatsPerMinute | undefined)[] = [];
  let thisTick: BeatsPerMinute | undefined;
  heartRatesThroughTheDecoder(simulator.bench, STRAP, (value) => {
    thisTick = value;
  });
  /** One second, and what the decoder read in it — `undefined` for nothing. */
  const second = (): BeatsPerMinute | undefined => {
    thisTick = undefined;
    simulator.bench.advance(seconds(1));
    decoded.push(thisTick);
    return thisTick;
  };
  const run = (count: number): (BeatsPerMinute | undefined)[] =>
    Array.from({ length: count }, second);
  return { ...simulator, decoded, second, run };
}

const steady = (power: number): number =>
  DEFAULT_RESTING_HEART_RATE + HUNT_HURNI_BPM_PER_WATT * power;

describe('a responsive heart rate, through the real decoder', () => {
  it('a step from 100 W to 150 W reaches 63 % of +19.6 bpm at one τ and 95 % at three, within 1 bpm', async () => {
    const strap = await strapOn({ heartRate: RESPONSIVE, rider: { power: watts(100) } });
    expect(strap.second()).toBe(Math.round(steady(100)));

    strap.bench.rider.set({ power: watts(150) });
    const start = strap.decoded.length;
    strap.run(197);
    // Index 66 after the step is the 66th second: one τ (65.6 s), to the whole second.
    const atOneTau = strap.decoded[start + 65];
    const atThreeTau = strap.decoded[start + 196];
    expect(
      Math.abs((atOneTau ?? 0) - (steady(100) + 19.6 * (1 - Math.exp(-66 / 65.6)))),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((atThreeTau ?? 0) - (steady(100) + 19.6 * (1 - Math.exp(-197 / 65.6)))),
    ).toBeLessThanOrEqual(1);
    expect((atOneTau ?? 0) - steady(100)).toBeGreaterThan(19.6 * 0.63 - 1);
    expect((atThreeTau ?? 0) - steady(100)).toBeGreaterThan(19.6 * 0.95 - 1);
  });

  it('answers to the ERG target a trainer holds, not to the power the profile says', async () => {
    const strap = await strapOn({
      heartRate: RESPONSIVE,
      rider: { power: watts(100) },
      trainer: true,
    });
    await strap.transport.connect(TRAINER);
    const controlPoint = strap.bench.device(TRAINER).controlPoint;
    controlPoint?.enableIndications();
    controlPoint?.write({ opCode: 'request-control' });
    strap.second();
    controlPoint?.write({ opCode: 'set-target-power', target: watts(200) });
    strap.run(600);
    expect(strap.decoded.at(-1)).toBe(Math.round(steady(200)));
  });

  it('falls towards rest when the rider stops pedalling, whatever the ERG target', async () => {
    const strap = await strapOn({
      heartRate: RESPONSIVE,
      rider: { power: watts(200) },
      trainer: true,
    });
    await strap.transport.connect(TRAINER);
    const controlPoint = strap.bench.device(TRAINER).controlPoint;
    controlPoint?.enableIndications();
    controlPoint?.write({ opCode: 'request-control' });
    strap.second();
    controlPoint?.write({ opCode: 'set-target-power', target: watts(200) });
    strap.run(10);
    const riding = strap.decoded.at(-1) ?? 0;

    strap.bench.rider.set({ cadence: revolutionsPerMinute(0) });
    strap.run(600);
    expect(strap.decoded.at(-1)).toBeLessThan(riding - 70);
    expect(strap.decoded.at(-1)).toBe(DEFAULT_RESTING_HEART_RATE);
  });

  it('drifts upward at constant power: 7.7 bpm/h for an hour, less the lag', async () => {
    const still = await strapOn({ heartRate: RESPONSIVE, rider: { power: watts(150) } });
    const drifting = await strapOn({ heartRate: RESPONSIVE, rider: { power: watts(150) } });
    drifting.bench.device(STRAP).script({ kind: 'heart-rate-drift', bpmPerHour: 7.7 });
    still.run(3600);
    drifting.run(3600);
    const rise = (drifting.decoded.at(-1) ?? 0) - (still.decoded.at(-1) ?? 0);
    expect(rise).toBeGreaterThanOrEqual(7);
    expect(rise).toBeLessThanOrEqual(8);
  });

  it('a dropout delivers nothing for its length, then the heart rate resumes', async () => {
    const strap = await strapOn({ heartRate: RESPONSIVE, rider: { power: watts(100) } });
    strap.run(3);
    strap.bench.device(STRAP).script({ kind: 'notification-dropout', duration: seconds(10) });
    expect(strap.run(10)).toEqual(Array.from({ length: 10 }, () => undefined));
    expect(strap.second()).toBe(Math.round(steady(100)));
  });

  it('implausible readings arrive as the decoder reads them: 0, 255 and a 60 bpm jump', async () => {
    const strap = await strapOn({ heartRate: RESPONSIVE, rider: { power: watts(100) } });
    const resting = strap.second() ?? 0;
    strap.bench
      .device(STRAP)
      .script({ kind: 'heart-rate-readings', values: [0, 255, resting + 60, 300] });
    expect(strap.run(5)).toEqual([0, 255, resting + 60, 300, resting]);
  });

  it('a strap off the chest notifies "not detected", which the decoder drops, for its whole absence', async () => {
    const strap = await strapOn({ heartRate: RESPONSIVE, rider: { power: watts(100) } });
    const typed: MeasurementFor<'heart-rate'>[] = [];
    await strap.transport.subscribe(STRAP, 'heart-rate', (m) => typed.push(m));
    strap.second();
    strap.bench.device(STRAP).script({ kind: 'strap-absent', duration: seconds(5) });
    const absent = strap.bench.device(STRAP).inspect().frames.hrs;
    expect(absent?.sensorContact).toBe('not-detected');
    expect(strap.run(5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // The typed stream agrees: nothing for five seconds.
    expect(typed).toHaveLength(1);
    expect(strap.second()).toBe(Math.round(steady(100)));
    expect(typed).toHaveLength(2);
  });

  it('a rider with no strap has no heart rate, and the strap scenarios are refused on a trainer', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'kickr' })],
      heartRate: RESPONSIVE,
    });
    await transport.connect(TRAINER);
    const heard: BeatsPerMinute[] = [];
    heartRatesThroughTheDecoder(bench, TRAINER, (value) => heard.push(value));
    bench.advance(seconds(5));
    expect(heard).toEqual([]);
    for (const scenario of [
      { kind: 'heart-rate-drift', bpmPerHour: 1 },
      { kind: 'heart-rate-readings', values: [0] },
      { kind: 'strap-absent', duration: seconds(1) },
    ] as const) {
      expect(() => bench.device(TRAINER).script(scenario)).toThrow(
        expect.objectContaining({ code: 'capability-unsupported' }),
      );
    }
  });
});

describe('scripted readings the wire cannot carry', () => {
  it('are refused: a Heart Rate Measurement holds a whole number from 0 to 65535', async () => {
    const strap = await strapOn();
    for (const value of [-1, 70_000, 120.5]) {
      expect(() =>
        strap.bench.device(STRAP).script({ kind: 'heart-rate-readings', values: [value] }),
      ).toThrow(RangeError);
    }
  });
});

describe('the fixed heart rate is still the default', () => {
  it('reports the profile heart rate whatever the power, and refuses to drift', async () => {
    const strap = await strapOn({ rider: { power: watts(100) } });
    strap.run(2);
    strap.bench.rider.set({ power: watts(300) });
    strap.run(300);
    expect(new Set(strap.decoded)).toEqual(new Set([145]));
    expect(() =>
      strap.bench.device(STRAP).script({ kind: 'heart-rate-drift', bpmPerHour: 2 }),
    ).toThrow(RangeError);
  });
});

describe('the Heart Rate Measurement octets', () => {
  const octets = (view: DataView): number[] => [
    ...new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
  ];

  it('255 is one uint8 with flag bit 0 clear; 300 is a uint16 with it set', () => {
    expect(
      octets(
        heartRateFrameToOctets({ heartRate: 255 as BeatsPerMinute, sensorContact: 'unsupported' }),
      ),
    ).toEqual([0x00, 0xff]);
    const wide = heartRateFrameToOctets({
      heartRate: 300 as BeatsPerMinute,
      sensorContact: 'unsupported',
    });
    expect(octets(wide)).toEqual([0x01, 0x2c, 0x01]);
    expect(decodeHeartRateMeasurement(wide).heartRate).toBe(300);
  });

  it('Sensor Contact Status is bits 2 and 1, as the decoder reads them', () => {
    for (const contact of ['unsupported', 'not-detected', 'detected'] as const) {
      const view = heartRateFrameToOctets({
        heartRate: 120 as BeatsPerMinute,
        sensorContact: contact,
      });
      expect(decodeHeartRateMeasurement(view).sensorContact).toBe(contact);
    }
  });
});
