// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The scan hook on its own — #550's second review. The two screens that use it
 * both stop asking when the reader will not load, so their tests cannot tell
 * whether the HOOK stops: this drives it with a caller that keeps asking.
 */

import { type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import { CameraController } from './session';
import { manualSchedule, scriptedCamera } from './testing';
import { usePairingScan } from './usePairingScan';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A timer the test owns: every tick is a call the test makes. */
function ownedTicks() {
  const ticks = new Set<() => void>();
  return {
    every: (tick: () => void): (() => void) => {
      ticks.add(tick);
      return () => {
        ticks.delete(tick);
      };
    },
    running: (): number => ticks.size,
    fire: (): void => {
      for (const tick of ticks) {
        tick();
      }
    },
  };
}

describe('usePairingScan', () => {
  it('stops its own timer, and says so once, when the reader will not load', async () => {
    const camera = scriptedCamera();
    let loads = 0;
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      loadCodeReader: async () => {
        loads += 1;
        return Promise.reject(new Error('the chunk would not load'));
      },
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
    await controller.turnOn();
    const timer = ownedTicks();
    let told = 0;
    // A caller that goes on asking: `active` never changes, and being told
    // changes nothing about it.
    function Scanner(): JSX.Element {
      usePairingScan(
        controller,
        true,
        () => undefined,
        () => {
          told += 1;
        },
        timer.every,
      );
      return <p>scanning</p>;
    }
    mounted = await mount(<Scanner />);
    expect(timer.running()).toBe(1);
    timer.fire();
    await settle();
    expect(told).toBe(1);
    expect(timer.running()).toBe(0);
    timer.fire();
    await settle();
    expect(loads).toBe(1);
    expect(told).toBe(1);
  });
});
