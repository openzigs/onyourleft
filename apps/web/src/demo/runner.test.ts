// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1646's runner: the same physics as a real rider, deterministic, and each
 * preset doing what its name says — every claim read back from the runner's
 * own output, the way #1647's renderer will read it.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { Seconds } from '@onyourleft/domain';
import { BOT_MASS_KILOGRAMS, metres, metresPerSecond, seconds } from '@onyourleft/domain';
import { advance } from '@onyourleft/physics';

import { CLIMB_PRESET, DEMO_PRESETS, GROUP_PRESET, SPRINT_PRESET } from './presets';
import type { DemoFrame } from './runner';
import { createDemoRide } from './runner';
import type { DemoPreset } from './script';

// Wraps the REAL `advance` in a spy, as `packages/physics/src/pacer.test.ts`
// does: every assertion runs the genuine physics, and the spy exists so that
// the call can be observed and, in one test, replaced.
vi.mock('@onyourleft/physics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@onyourleft/physics')>();
  return { ...actual, advance: vi.fn(actual.advance) };
});

/** Half-second instants from zero to `untilSeconds`, the cadence a test rides at. */
function instants(untilSeconds: number, stepSeconds = 0.5): Seconds[] {
  const out: Seconds[] = [];
  for (let index = 0; index * stepSeconds <= untilSeconds; index += 1) {
    out.push(seconds(index * stepSeconds));
  }
  return out;
}

function ride(preset: DemoPreset, at: readonly Seconds[]): DemoFrame[] {
  const demo = createDemoRide(preset);
  return at.map((each) => demo.sample(each));
}

/** How long each preset is ridden for in these tests. */
const RIDE_SECONDS: Readonly<Record<DemoPreset['id'], number>> = {
  climb: 400,
  sprint: 180,
  group: 300,
};

function rideOf(preset: DemoPreset): DemoFrame[] {
  return ride(preset, instants(RIDE_SECONDS[preset.id]));
}

describe('a scripted rider goes through the same physics tick as a real one', () => {
  it('calls `advance` with the scripted power and the bot mass', () => {
    vi.mocked(advance).mockClear();
    const demo = createDemoRide(SPRINT_PRESET);
    demo.sample(seconds(1));
    expect(advance).toHaveBeenCalledTimes(1);
    const [, step, conditions] = vi.mocked(advance).mock.calls[0] ?? [];
    expect(step?.power).toBe(2.6 * BOT_MASS_KILOGRAMS);
    expect(step?.duration).toBe(1);
    expect(conditions?.totalMass).toBe(BOT_MASS_KILOGRAMS);
  });

  it("moves with `advance`'s answer: replacing it changes the rider's distance", () => {
    // A rider with its own `speed = k · power` would ignore the sentinel and
    // report the distance it worked out for itself.
    const honest = createDemoRide(SPRINT_PRESET).sample(seconds(1));
    vi.mocked(advance).mockImplementationOnce(() => ({
      speed: metresPerSecond(0),
      distance: metres(12_345),
    }));
    const sentinel = createDemoRide(SPRINT_PRESET).sample(seconds(1));
    expect(honest.riders[0]?.state.distance).not.toBe(12_345);
    expect(sentinel.riders[0]?.state.distance).toBe(12_345);
  });
});

describe('a demo ride is deterministic', () => {
  /** The `{distance, speed, watts, cadence, heartRate}` series of every rider, hashed. */
  function digest(frames: readonly DemoFrame[]): string {
    const series = frames.map((frame) =>
      frame.riders.map((rider) => [
        rider.state.distance,
        rider.state.speed,
        rider.watts,
        rider.cadence,
        rider.heartRate,
      ]),
    );
    return createHash('sha256').update(JSON.stringify(series)).digest('hex');
  }

  /**
   * Pinned. A change to a preset, to the runner or to the physics changes
   * these, which is the point: the video export (#1655) and the browser gate
   * (#1648) both rely on a preset being the same ride every time.
   */
  const PINNED: Readonly<Record<DemoPreset['id'], string>> = {
    climb: '1373305848a796b9e38ec5d680bd3b844a1b2c65f2ba33df5c85e82e9c047dce',
    sprint: '5b418d469b3b077e168302a48724418916f70d21f098749de47db1cd46b18f39',
    group: '31b601e39708b503fb404e933a9c2f28ce6ec40f8d880eb21353e80f87c162bf',
  };

  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))(
    'rides %s byte for byte the same twice, and as pinned',
    (id, preset) => {
      const first = digest(rideOf(preset));
      const second = digest(rideOf(preset));
      expect(second).toBe(first);
      expect(first).toBe(PINNED[id]);
    },
  );

  it('does not wind back for a time that is not after the last', () => {
    const demo = createDemoRide(SPRINT_PRESET);
    const at = demo.sample(seconds(10));
    expect(demo.sample(seconds(5))).toBe(at);
    expect(demo.sample(seconds(10))).toBe(at);
    expect(demo.current()).toBe(at);
  });
});

describe('a demo never shows a dropped sensor', () => {
  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))(
    'every %s sample is live and paired, from the first frame',
    (_id, preset) => {
      const demo = createDemoRide(preset);
      for (const frame of [demo.current(), ...rideOf(preset)]) {
        const { rider, cadence, heartRate } = frame.lead;
        expect([rider.live, rider.paired, cadence.live, cadence.paired]).toEqual([
          true,
          true,
          true,
          true,
        ]);
        expect([heartRate.live, heartRate.paired]).toEqual([true, true]);
        expect(cadence.value).toBe(frame.riders[0]?.cadence);
        expect(heartRate.value).toBe(frame.riders[0]?.heartRate);
        expect(rider.power).toBe(frame.riders[0]?.watts);
      }
    },
  );
});

describe('each preset behaves as named', () => {
  it('climb: the lead slows by at least 30 % from the flat to the steepest part while power rises', () => {
    const frames = rideOf(CLIMB_PRESET);
    const lead = frames.map((frame) => frame.riders[0]).filter((each) => each !== undefined);
    const steepest = Math.max(...lead.map((each) => each.grade));
    // Moving and on the flat (the opening, once up to speed), against moving on
    // the steepest gradient the rider actually reached.
    const flat = lead.filter((each) => Math.abs(each.grade) < 0.1 && each.state.speed > 1);
    const steep = lead.filter((each) => each.grade > steepest - 0.1);
    expect(steepest).toBeGreaterThan(7.5);
    expect(flat.length).toBeGreaterThan(20);
    expect(steep.length).toBeGreaterThan(20);
    const mean = (values: readonly number[]): number =>
      values.reduce((sum, each) => sum + each, 0) / values.length;
    const flatSpeed = mean(flat.slice(Math.floor(flat.length / 2)).map((each) => each.state.speed));
    const steepSpeed = mean(steep.map((each) => each.state.speed));
    expect(steepSpeed).toBeLessThanOrEqual(flatSpeed * 0.7);
    expect(mean(steep.map((each) => each.watts))).toBeGreaterThan(
      mean(flat.map((each) => each.watts)),
    );
  });

  it('sprint: peak power is at least 2.5 times the flat power, for at most 20 s', () => {
    const step = 0.5;
    const frames = ride(SPRINT_PRESET, instants(RIDE_SECONDS.sprint, step));
    const power = frames.map((frame) => frame.riders[0]?.watts ?? 0);
    // The preset's flat power is what it opens at, on a flat road.
    const flatPower = power[0] ?? 0;
    expect(flatPower).toBeGreaterThan(0);
    expect(Math.max(...power)).toBeGreaterThanOrEqual(2.5 * flatPower);
    // "For at most 20 s": every sample more than 10 % above the flat power is
    // the sprint, ramps included.
    const above = power.filter((each) => each > flatPower * 1.1).length;
    expect(above * step).toBeGreaterThan(0);
    expect(above * step).toBeLessThanOrEqual(20);
  });

  it('group: at least three riders, and no two in the same place for more than 1 s', () => {
    const step = 0.5;
    const frames = ride(GROUP_PRESET, instants(RIDE_SECONDS.group, step));
    const count = GROUP_PRESET.riders.length;
    expect(count).toBeGreaterThanOrEqual(3);
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        let run = 0;
        let longest = 0;
        for (const frame of frames) {
          const gap = Math.abs(
            (frame.riders[a]?.state.distance ?? 0) - (frame.riders[b]?.state.distance ?? 0),
          );
          run = gap < SAME_PLACE_METRES ? run + step : 0;
          longest = Math.max(longest, run);
        }
        expect(longest, `riders ${String(a)} and ${String(b)}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * Two riders closer than this along the road are "in the same place": a
 * bicycle is about 1.75 m long, so two markers nearer than that overlap on
 * screen — the failure #1646's group criterion prevents.
 */
const SAME_PLACE_METRES = 2;
