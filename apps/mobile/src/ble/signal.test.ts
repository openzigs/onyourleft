// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1435's signal strength, Android half: the plugin's RSSI in, a figure or
 * nothing out. Against the scripted port, not a phone (`apps/mobile/README.md`
 * §4) — what the radio measures on a real link is not claimed here.
 */

import { describe, expect, it } from 'vitest';

import { readCapacitorSignal } from './signal';
import { scriptedPort, SCRIPTED_DEVICE, type ScriptedPort, type ScriptedStack } from './testing';

const DEVICE = SCRIPTED_DEVICE.deviceId;

async function started(stack: ScriptedStack): Promise<ScriptedPort> {
  const port = scriptedPort(stack);
  await port.initialize();
  return port;
}

describe('readCapacitorSignal', () => {
  it('asks the plugin about the device it was given and hands back the figure', async () => {
    const port = await started({ rssi: -71 });

    await expect(readCapacitorSignal(port, DEVICE)).resolves.toBe(-71);
    expect(port.calls).toContain(`readRssi:${DEVICE}`);
  });

  it('is no reading, never a rejection, when the plugin cannot say', async () => {
    const port = await started({ rssiRejectsWith: new Error('Reading RSSI timeout.') });

    await expect(readCapacitorSignal(port, DEVICE)).resolves.toBeUndefined();
  });

  it.each([127, -128, Number.NaN, 21])(
    'reads %s — outside what a radio measures — as no reading',
    async (rssi) => {
      const port = await started({ rssi });

      await expect(readCapacitorSignal(port, DEVICE)).resolves.toBeUndefined();
    },
  );

  it.each([-127, 20])('keeps %s, the edge of the measurable range', async (rssi) => {
    const port = await started({ rssi });

    await expect(readCapacitorSignal(port, DEVICE)).resolves.toBe(rssi);
  });
});
