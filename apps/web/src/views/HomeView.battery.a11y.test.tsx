// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Each sensor's battery on Home's sensors module — #2047 — rendered through
 * the real shell and audited.
 *
 * ⚠️ **The low state is read as TEXT, with every decoration removed.** The
 * warning colour is a second signal; the words are the first (WCAG 2.2 SC
 * 1.4.1). So the level is read back from the module's text with every
 * `aria-hidden` drawing taken out and no style consulted — jsdom loads no
 * stylesheet, so a state that existed only as a colour would read here as
 * the ordinary one.
 *
 * ⚠️ **A sensor that reports nothing shows nothing, never `0%`.** A port that
 * answers `undefined` for one device and a level for another is the control.
 */

import { percent, type Percent } from '@onyourleft/domain';
import { deviceId, type DeviceId } from '@onyourleft/sensors';
import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { stubAnalysis } from '../analysis/testing';
import type { BatteryLevelPort } from '../ride/battery-port';
import { LOW_BATTERY_PERCENT } from '../ride/battery-level';
import type { PairedSensor, RideSnapshot } from '../ride/controller';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const OWNER = athleteId('athlete-a');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const STRAP = deviceId('strap');
const METER = deviceId('meter');

const strap: PairedSensor = {
  id: STRAP,
  name: 'HRM 04B1',
  role: 'heart-rate',
  capabilities: ['heart-rate'],
  state: 'connected',
};
const meter: PairedSensor = {
  id: METER,
  name: 'Crank PM',
  role: 'power-meter',
  capabilities: ['power'],
  state: 'connected',
};

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

/** A port answering from a table, counting every read. */
function port(levels: ReadonlyMap<DeviceId, Percent>): BatteryLevelPort & { reads: DeviceId[] } {
  const reads: DeviceId[] = [];
  return {
    reads,
    readBatteryLevel: (id) => {
      reads.push(id);
      return Promise.resolve(levels.get(id));
    },
  };
}

async function openHome(snapshot: RideSnapshot, battery: BatteryLevelPort): Promise<void> {
  globalThis.location.hash = '#/';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      analysis={stubAnalysis(OWNER, [])}
      rideController={stubRideController(snapshot).controller}
      battery={battery}
    />,
  );
  await settle();
  await settle();
}

const sensorsModule = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    'main section[aria-labelledby="oyl-home-sensors"]',
  );
  if (found === null) throw new Error('no sensors module');
  return found;
};

/** A row's words, read with every `aria-hidden` decoration taken out. */
function rowText(name: string): string {
  const row = [...sensorsModule().querySelectorAll('li')].find((each) =>
    (each.textContent ?? '').includes(name),
  );
  if (row === undefined) throw new Error(`no row for ${name}`);
  const copy = row.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent ?? '';
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

describe('each sensor’s battery on Home — #2047', () => {
  it('shows a reported level as a number with a percent sign, and nothing for a sensor that reports none', async () => {
    const battery = port(new Map([[STRAP, percent(37)]]));
    await openHome({ ...idleSnapshot(), sensors: [strap, meter] }, battery);
    expect(rowText('HRM 04B1')).toContain('Battery 37%');
    // The control: the meter reports nothing, so says nothing — never 0%.
    expect(rowText('Crank PM')).not.toContain('Battery');
    expect(rowText('Crank PM')).not.toMatch(/\d\s?%/);
    expect(sensorsModule().textContent).not.toMatch(/\b0\s?%/);
    expect(battery.reads.sort()).toEqual([METER, STRAP].sort());
    expectClean('home, a sensor with a battery and one without');
  });

  it(`says a level at or under ${String(LOW_BATTERY_PERCENT)}% is low in words, not colour alone`, async () => {
    await openHome(
      { ...idleSnapshot(), sensors: [strap] },
      port(new Map([[STRAP, percent(LOW_BATTERY_PERCENT)]])),
    );
    expect(rowText('HRM 04B1')).toContain(
      `Battery ${String(LOW_BATTERY_PERCENT)}%, low — charge it or change it soon`,
    );
    expectClean('home, a low battery');
  });

  it('a level just over the threshold is not called low', async () => {
    await openHome(
      { ...idleSnapshot(), sensors: [strap] },
      port(new Map([[STRAP, percent(LOW_BATTERY_PERCENT + 1)]])),
    );
    expect(rowText('HRM 04B1')).toContain(`Battery ${String(LOW_BATTERY_PERCENT + 1)}%`);
    expect(rowText('HRM 04B1')).not.toContain('low');
  });

  it('an empty battery the sensor REPORTED is a real 0%, and low', async () => {
    await openHome({ ...idleSnapshot(), sensors: [strap] }, port(new Map([[STRAP, percent(0)]])));
    expect(rowText('HRM 04B1')).toContain('Battery 0%, low');
  });

  it('asks nothing of a sensor that is not connected, and shows it no level', async () => {
    const battery = port(new Map([[STRAP, percent(37)]]));
    await openHome({ ...idleSnapshot(), sensors: [{ ...strap, state: 'disconnected' }] }, battery);
    expect(battery.reads).toEqual([]);
    expect(rowText('HRM 04B1')).not.toContain('Battery');
  });

  it('asks nothing during a ride, when a read could wait ahead of a trainer’s control write', async () => {
    const battery = port(new Map([[STRAP, percent(37)]]));
    const riding = ridingSnapshot();
    await openHome({ ...riding, sensors: [...riding.sensors, strap] }, battery);
    expect(battery.reads).toEqual([]);
    expect(rowText('HRM 04B1')).not.toContain('Battery');
  });
});
