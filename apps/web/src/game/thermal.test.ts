// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { BROWSER_THERMAL, type ThermalPort } from './thermal-port';
import { HEADROOM_REDUCE_ABOVE, HEADROOM_RESTORE_BELOW } from './quality';
import {
  SPENT_HEADROOM,
  forecastForFrame,
  THERMAL_FORECAST_SECONDS,
  THERMAL_POLL_MILLISECONDS,
  watchThermalHeadroom,
  type Every,
} from './thermal';

/** A schedule the test runs by hand. */
function manualSchedule(): {
  every: Every;
  tick: () => void;
  cancelled: () => boolean;
  ms: () => number | undefined;
} {
  let task: (() => void) | undefined;
  let interval: number | undefined;
  let cancelled = false;
  return {
    every: (next, milliseconds) => {
      task = next;
      interval = milliseconds;
      return () => {
        cancelled = true;
      };
    },
    tick: () => task?.(),
    cancelled: () => cancelled,
    ms: () => interval,
  };
}

/** A port whose answers the test hands out one at a time. */
function scriptedPort(): ThermalPort & {
  readonly answer: (value: number | undefined) => Promise<void>;
  readonly refuse: () => Promise<void>;
  readonly reads: () => number;
} {
  const waiting: {
    resolve: (value: number | undefined) => void;
    reject: (error: Error) => void;
  }[] = [];
  let reads = 0;
  return {
    readThermalHeadroom: () => {
      reads += 1;
      return new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
    answer: async (value) => {
      waiting.shift()?.resolve(value);
      await Promise.resolve();
      await Promise.resolve();
    },
    refuse: async () => {
      waiting.shift()?.reject(new Error('plugin is not implemented on this platform'));
      await Promise.resolve();
      await Promise.resolve();
    },
    reads: () => reads,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('the browser has no thermal forecast (#247)', () => {
  it('answers undefined, which the ladder reads as no opinion', async () => {
    await expect(BROWSER_THERMAL.readThermalHeadroom()).resolves.toBeUndefined();
  });
});

describe('watchThermalHeadroom (#247)', () => {
  it('reads once at once, then once per poll, and forecasts one poll ahead', async () => {
    const schedule = manualSchedule();
    const port = scriptedPort();
    const watch = watchThermalHeadroom(port, schedule.every);
    expect(port.reads()).toBe(1);
    expect(schedule.ms()).toBe(THERMAL_POLL_MILLISECONDS);
    expect(THERMAL_FORECAST_SECONDS).toBe(THERMAL_POLL_MILLISECONDS / 1000);

    expect(watch.latest()).toEqual({ headroom: undefined, reading: 0 });
    await port.answer(0.4);
    expect(watch.latest()).toEqual({ headroom: 0.4, reading: 1 });

    schedule.tick();
    expect(port.reads()).toBe(2);
    await port.answer(0.9);
    // Each answer is a new reading, even when the value repeats — that is what
    // lets GameView tell "the next reading" from "the same one, held".
    expect(watch.latest()).toEqual({ headroom: 0.9, reading: 2 });
  });

  it('passes a NaN from the platform through unchanged', async () => {
    // #247's own criterion: `quality.ts` documents that NaN is not hot, and a
    // watcher that turned NaN into `undefined` or into 0 would leave that rule
    // exercised by nobody on a device.
    const schedule = manualSchedule();
    const port = scriptedPort();
    const watch = watchThermalHeadroom(port, schedule.every);
    await port.answer(Number.NaN);
    expect(Number.isNaN(watch.latest().headroom)).toBe(true);
  });

  it('forgets a hot reading when the next read is refused, rather than holding it', async () => {
    const schedule = manualSchedule();
    const port = scriptedPort();
    const watch = watchThermalHeadroom(port, schedule.every);
    await port.answer(0.95);
    schedule.tick();
    await port.refuse();
    expect(watch.latest().headroom).toBeUndefined();
  });

  it('drops an older answer that arrives after a newer one', async () => {
    const schedule = manualSchedule();
    const reads: ((value: number) => void)[] = [];
    const port: ThermalPort = {
      readThermalHeadroom: () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
    };
    const watch = watchThermalHeadroom(port, schedule.every);
    schedule.tick();
    reads[1]?.(0.3);
    await flush();
    reads[0]?.(0.95);
    await flush();
    expect(watch.latest()).toEqual({ headroom: 0.3, reading: 1 });
  });

  it('stops polling, and discards a read in flight, when stopped', async () => {
    const schedule = manualSchedule();
    const port = scriptedPort();
    const watch = watchThermalHeadroom(port, schedule.every);
    watch.stop();
    expect(schedule.cancelled()).toBe(true);
    await port.answer(0.95);
    expect(watch.latest().headroom).toBeUndefined();
  });
});

describe('forecastForFrame — one reading moves the ladder one rung at most (#523 review)', () => {
  it('hands an unspent reading to the frame as it is', () => {
    expect(forecastForFrame({ headroom: 0.95, reading: 3 }, 2)).toBe(0.95);
    expect(forecastForFrame({ headroom: 0.2, reading: 3 }, 2)).toBe(0.2);
  });

  it('turns a spent reading neutral, which is neither hot nor cool to the ladder', () => {
    expect(forecastForFrame({ headroom: 0.95, reading: 3 }, 3)).toBe(SPENT_HEADROOM);
    expect(forecastForFrame({ headroom: 0.2, reading: 3 }, 3)).toBe(SPENT_HEADROOM);
    expect(SPENT_HEADROOM).toBeGreaterThanOrEqual(HEADROOM_RESTORE_BELOW);
    expect(SPENT_HEADROOM).toBeLessThanOrEqual(HEADROOM_REDUCE_ABOVE);
  });

  it('leaves no forecast and a NaN forecast as they are', () => {
    expect(forecastForFrame({ headroom: undefined, reading: 0 }, 0)).toBeUndefined();
    expect(forecastForFrame({ headroom: undefined, reading: 4 }, 4)).toBeUndefined();
    expect(Number.isNaN(forecastForFrame({ headroom: Number.NaN, reading: 4 }, 4))).toBe(true);
  });
});
