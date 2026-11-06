// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { percent } from '@onyourleft/domain';
import { deviceId, type DeviceId } from '@onyourleft/sensors';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mount, type Mounted } from '../testing/mount';
import { BATTERY_READ_EVERY_MILLISECONDS, useBatteryLevels } from './battery-level';
import type { BatteryLevelPort } from './battery-port';
import type { PairedSensor } from './controller';

const STRAP = deviceId('strap');
const strap: PairedSensor = {
  id: STRAP,
  name: 'HRM 04B1',
  role: 'heart-rate',
  capabilities: ['heart-rate'],
  state: 'connected',
};

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
});

describe('useBatteryLevels re-read — #2047', () => {
  it('asks again every minute while open, and shows the newer level', async () => {
    vi.useFakeTimers();
    const reads: DeviceId[] = [];
    let level = 80;
    const port: BatteryLevelPort = {
      readBatteryLevel: (id) => {
        reads.push(id);
        return Promise.resolve(percent(level));
      },
    };
    function Probe(): React.JSX.Element {
      const levels = useBatteryLevels(port, [strap], true);
      return <p>{String(levels.get(STRAP) ?? 'none')}</p>;
    }
    mounted = await mount(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads).toEqual([STRAP]);
    level = 70;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BATTERY_READ_EVERY_MILLISECONDS);
    });
    expect(reads).toEqual([STRAP, STRAP]);
    expect(document.body.textContent).toContain('70');
  });
});
