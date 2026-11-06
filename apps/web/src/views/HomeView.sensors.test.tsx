// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Home's sensors module — #2045 — over the REAL ride controller and the REAL
 * Web Bluetooth transport, whose `navigator.bluetooth` is the package's own
 * scripted stack.
 *
 * Nothing between the device and the rendered words is a double: the strap's
 * notification goes through the transport's Heart Rate decoder, the
 * controller's `onMeasurement` and its snapshot, and is read back from the
 * module the shell renders at `#/` — the path a rider's eyes take.
 * `browser/devices.browser.spec.ts` §"#2045" walks the same thing in a real
 * engine; this is where every state the transport can report is reached.
 *
 * ⚠️ **"Never says searching" is held over the transport that cannot search.**
 * Web Bluetooth has no silent reconnect and no background scan
 * (docs/agents/web-bluetooth.md), so the only honest words are *connected*
 * and *not connected*. Each state the transport reports — connecting, with
 * the connect held open; connected; and the link lost — is rendered and read,
 * so a "Searching…" or "Reconnecting…" added for any one of them is red.
 */

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import {
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
} from '@onyourleft/sensors/protocol';
import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';
import { createFakeBluetooth, type FakeBluetooth } from '@onyourleft/sensors/web-bluetooth/testing';
import { athleteId, recordingSessionId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { stubAnalysis } from '../analysis/testing';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { createRideController, type RideController } from '../ride/controller';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const OWNER = athleteId('athlete-a');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const STRAP_NAME = 'HRM 04B1';
const T0 = 1_790_000_000;

/** Nothing is recorded here, so the checkpoint store holds nothing. */
const checkpoints: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(0),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(false),
};

let mounted: Mounted | undefined;
let controller: RideController | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  controller?.dispose();
  controller = undefined;
  globalThis.location.hash = '';
});

interface Rig {
  readonly fake: FakeBluetooth;
  readonly controller: RideController;
  /** The transport's and the controller's clock, which a test moves. */
  readonly clock: { at: number };
}

function rig(): Rig {
  const fake = createFakeBluetooth({
    devices: [
      {
        id: 'strap',
        name: STRAP_NAME,
        services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
      },
    ],
  });
  // One clock for the transport's receive times and the controller's.
  const clock = { at: T0 };
  const now = (): UnixSeconds => unixSeconds(clock.at);
  const transport = createWebBluetoothTransport({
    profiles: [heartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
    now,
  });
  controller = createRideController({
    transport,
    store: checkpoints,
    athleteId: OWNER,
    newSessionId: () => recordingSessionId('home-sensors'),
    now,
  });
  return { fake, controller, clock };
}

async function openHome(on: Rig): Promise<void> {
  globalThis.location.hash = '#/';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      analysis={stubAnalysis(OWNER, [])}
      rideController={on.controller}
    />,
  );
  await settle();
  await settle();
}

/** The module, as the shell rendered it. */
const module = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('main section[aria-labelledby="oyl-home-sensors"]');

const words = (): string => module()?.textContent ?? '';

/** One Heart Rate Measurement: flags 0 (a `uint8` value), then the beats per minute. */
const beat = (bpm: number): Uint8Array => Uint8Array.from([0x00, bpm]);

/** The words a module about a link that cannot search must never use. */
const SEARCHING = /search|scan|looking for|reconnect|finding|waiting for the device/i;

describe('Home’s sensors module — #2045', () => {
  it('with nothing connected, says so in words, and its one link reaches Devices', async () => {
    const on = rig();
    await openHome(on);
    expect(module()?.querySelector('h2')?.textContent).toBe('Sensors');
    expect(words()).toContain('No trainer paired.');
    expect(words()).toContain('No heart rate, power or cadence sensor paired.');
    const links = [...(module()?.querySelectorAll('a') ?? [])].map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toEqual([hrefFor(routeById('devices'))]);
  });

  it('a strap paired through the controller reads connected and its own live value, and moves with it', async () => {
    const on = rig();
    await openHome(on);
    await on.controller.pair('heart-rate');
    on.fake.bench.device('strap').notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, beat(142));
    await settle();

    const rows = [...(module()?.querySelectorAll('li') ?? [])].map((row) => row.textContent);
    expect(rows).toContain(`Heart rate strap, ${STRAP_NAME}, Heart rate: 142 bpm, Connected`);
    // Read from the subscription, not a copy taken when Home opened: a new
    // beat is a new number on the screen.
    on.fake.bench.device('strap').notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, beat(151));
    await settle();
    expect(words()).toContain('Heart rate: 151 bpm');
    expect(words()).not.toContain('142');
    // Still one way to Devices, not two: with no trainer paired it is the
    // trainer's own line, and the module adds none of its own.
    expect(
      [...(module()?.querySelectorAll('a') ?? [])].map((link) => [
        link.textContent,
        link.getAttribute('href'),
      ]),
    ).toEqual([['Pair one on Devices', hrefFor(routeById('devices'))]]);
  });

  it('a reading the strap has stopped sending is said to be unavailable, never shown as live', async () => {
    const on = rig();
    await openHome(on);
    await on.controller.pair('heart-rate');
    on.fake.bench.device('strap').notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, beat(142));
    on.clock.at = T0 + 10;
    await on.controller.tickNow();
    await settle();
    expect(words()).toContain('Heart rate: unavailable');
    expect(words()).not.toContain('142');
  });

  it('never says searching or reconnecting, in any state Web Bluetooth reports', async () => {
    const on = rig();
    await openHome(on);
    const seen: string[] = [];

    // Connecting: the chooser has answered and the link is not up yet.
    on.fake.bench.hold('connect');
    const pairing = on.controller.pair('heart-rate');
    await settle();
    seen.push(words());
    on.fake.bench.release('connect');
    await pairing;
    await settle();
    // Connected.
    seen.push(words());
    // The link lost, which Web Bluetooth never brings back by itself.
    on.fake.bench.device('strap').drop();
    await settle();
    seen.push(words());

    expect(seen[0]).toContain(`${STRAP_NAME}, Not connected`);
    expect(seen[1]).toContain(
      `${STRAP_NAME}, Heart rate: waiting for the first reading, Connected`,
    );
    expect(seen[2]).toContain(`${STRAP_NAME}, Not connected`);
    for (const said of seen) {
      expect(said).not.toMatch(SEARCHING);
    }
  });
});

/**
 * The owner's screenshot review of #2045 (2026-11-05): one compact row a
 * device. What the screen shows of a row is its icon, its name, its reading
 * and a dot; the rest of the row's sentence is for a screen reader only. The
 * dot is never the only sign of the state (SC 1.4.1): a device that is not
 * connected is a ring with the words beside it, on screen.
 */
describe('one compact row a device — the owner’s review of #2045', () => {
  /** A row's words as the screen shows them: every visually hidden part left out. */
  const shown = (row: Element): string => {
    const copy = row.cloneNode(true) as Element;
    for (const hidden of copy.querySelectorAll('.oyl-visually-hidden, [aria-hidden="true"]')) {
      hidden.remove();
    }
    return copy.textContent;
  };
  const strapRow = (): Element | undefined =>
    [...(module()?.querySelectorAll('.oyl-home__sensor-row') ?? [])].find((row) =>
      (row.textContent ?? '').includes(STRAP_NAME),
    );

  it('shows the name, the reading and a filled dot, and says the rest to a screen reader', async () => {
    const on = rig();
    await openHome(on);
    await on.controller.pair('heart-rate');
    on.fake.bench.device('strap').notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, beat(142));
    await settle();
    const row = strapRow();
    expect(row?.textContent).toBe(
      `Heart rate strap, ${STRAP_NAME}, Heart rate: 142 bpm, Connected`,
    );
    expect(row === undefined ? undefined : shown(row)).toBe(`${STRAP_NAME}142 bpm`);
    expect(row?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(row?.querySelectorAll('.oyl-home__sensor-dot--on')).toHaveLength(1);
  });

  it('a device not connected shows a ring and the words, never the dot alone', async () => {
    const on = rig();
    await openHome(on);
    await on.controller.pair('heart-rate');
    on.fake.bench.device('strap').drop();
    await settle();
    const row = strapRow();
    expect(row === undefined ? undefined : shown(row)).toBe(`${STRAP_NAME}Not connected`);
    expect(row?.querySelector('.oyl-home__sensor-dot')).not.toBeNull();
    expect(row?.querySelectorAll('.oyl-home__sensor-dot--on')).toHaveLength(0);
  });
});

describe('the trainer’s row — #2045 over #939', () => {
  it('names the trainer, its own power and whether this app has control, and the module’s one way to Devices', async () => {
    const riding = ridingSnapshot();
    const [kickr] = riding.sensors;
    if (kickr === undefined) throw new Error('ridingSnapshot has no trainer');
    globalThis.location.hash = '#/';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        analysis={stubAnalysis(OWNER, [])}
        rideController={
          stubRideController({
            ...riding,
            trainer: { ...riding.trainer, hasControl: false },
            sensors: [
              {
                ...kickr,
                readings: [
                  { id: 'power', state: { kind: 'live', value: 212.4, at: unixSeconds(T0) } },
                  { id: 'cadence', state: { kind: 'live', value: 88, at: unixSeconds(T0) } },
                ],
              },
            ],
          }).controller
        }
      />,
    );
    await settle();
    await settle();
    const rows = [...(module()?.querySelectorAll('li') ?? [])].map((row) => row.textContent);
    expect(rows).toEqual([
      'Smart trainer, KICKR 1F2A, Power: 212 W, Connected' +
        'Paired, and this app has not been given control. Ask for it on Ride.',
    ]);
    expect(words()).toContain('No heart rate, power or cadence sensor paired.');
    expect(
      [...(module()?.querySelectorAll('a') ?? [])].map((link) => [
        link.textContent,
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Pair or forget devices on Devices', hrefFor(routeById('devices'))],
      ['Ask for it on Ride', hrefFor(routeById('ride'))],
    ]);
  });
});
