// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { readCapacitorThermalHeadroom, type ThermalPlugin, type ThermalReply } from './thermal';

/** A plugin that answers one reply and records what it was asked. */
function answering(reply: ThermalReply): ThermalPlugin & { readonly asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    headroom: (options) => {
      asked.push(options.forecastSeconds);
      return Promise.resolve(reply);
    },
  };
}

describe('readCapacitorThermalHeadroom (#247)', () => {
  it('passes the forecast through, unclamped, and asks for the horizon it was given', async () => {
    const plugin = answering({ supported: true, headroom: 1.2 });
    await expect(readCapacitorThermalHeadroom(plugin, 10)).resolves.toBe(1.2);
    expect(plugin.asked).toEqual([10]);
  });

  it('puts back a NaN the Java side could not send as a number', async () => {
    // #247's criterion: a NaN from the plugin reaches the ladder unchanged, so
    // `quality.ts`'s NaN-is-not-hot rule is what decides on such a device.
    const read = await readCapacitorThermalHeadroom(answering({ supported: true }), 10);
    expect(Number.isNaN(read)).toBe(true);
  });

  it('answers undefined below API 30, where there is no forecast at all', async () => {
    await expect(
      readCapacitorThermalHeadroom(answering({ supported: false }), 10),
    ).resolves.toBeUndefined();
  });

  it('answers undefined when the plugin is not there, rather than throwing into the frame loop', async () => {
    const missing: ThermalPlugin = {
      headroom: () => Promise.reject(new Error('"Thermal" plugin is not implemented on android')),
    };
    await expect(readCapacitorThermalHeadroom(missing, 10)).resolves.toBeUndefined();
  });
});
