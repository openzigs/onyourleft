// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2358 — the Devices screen's Controllers section, read from the rendered
 * screen: the state before a press, a pad connecting and disconnecting, and
 * the button test. The pads come from a fake `GamepadPort`; the last case
 * goes through the real `game/gamepad-port.ts` on `window`, which is what
 * `main.tsx` gives the screen by handing it none.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GamepadPort, PadSnapshot } from '../game/gamepad-port';
import {
  GAMEPADS_HEADING,
  NOTHING_MOVED_YET,
  PRESS_SO_THE_APP_SEES_IT,
} from '../ride/GamepadControllers';
import { idleSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { DevicesView } from './DevicesView';

const CAPABLE: CapabilityProbe = {
  bluetooth: {
    getAvailability: async () => Promise.resolve(true),
    requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
  },
  secureContext: true,
};

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  Reflect.deleteProperty(window.navigator, 'getGamepads');
});

/** A pad as the platform lists it. */
function pad(id: string, down: readonly number[] = [], axes = [0, 0, 0, 0]): PadSnapshot {
  return {
    id,
    connected: true,
    mapping: 'standard',
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: down.includes(index) })),
  };
}

/** A port whose list the test sets, and whose connection events it fires. */
interface FakePads {
  readonly port: GamepadPort;
  list: (PadSnapshot | null)[];
  readonly fire: () => void;
  readonly listeners: () => number;
  readonly reads: () => number;
}

function fakePads(): FakePads {
  const listeners = new Set<() => void>();
  let reads = 0;
  const fake: FakePads = {
    list: [],
    port: {
      pads: () => {
        reads += 1;
        return fake.list;
      },
      onConnectionChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    fire: () => {
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    listeners: () => listeners.size,
    reads: () => reads,
  };
  return fake;
}

function frames(count: number): void {
  act(() => {
    for (let frame = 0; frame < count; frame += 1) vi.advanceTimersToNextFrame();
  });
}

/** The section's text: from its heading to the end of the screen. */
function sectionText(): string {
  const heading = [...document.querySelectorAll('h2')].find(
    (each) => each.textContent === GAMEPADS_HEADING,
  );
  if (heading === undefined) throw new Error('no Controllers heading');
  let text = '';
  for (let node: Element | null = heading; node !== null; node = node.nextElementSibling) {
    text += ` ${node.textContent}`;
  }
  return text;
}

function rows(): string[] {
  return [...document.querySelectorAll('[data-oyl-gamepads] li')].map(
    (row) => row.textContent?.trim() ?? '',
  );
}

const readout = (): string =>
  document.querySelector('[data-oyl-gamepad-readout]')?.textContent ?? 'no readout';

const announced = (): string =>
  document.querySelector('[data-oyl-gamepad-announcer]')?.textContent ?? 'no announcer';

async function browserScreen(gamepads?: GamepadPort): Promise<void> {
  const stub = stubRideController(idleSnapshot());
  mounted = await mount(
    <main>
      <h1>Devices</h1>
      <DevicesView capabilities={CAPABLE} controller={stub.controller} gamepads={gamepads} />
    </main>,
  );
  await settle();
}

describe('the Controllers section on the Devices screen — #2358', () => {
  it('before a press: says to press a button, and lists nothing', async () => {
    const fake = fakePads();
    await browserScreen(fake.port);
    expect(rows()).toEqual([PRESS_SO_THE_APP_SEES_IT]);
    expect(sectionText()).toContain('Steers and throws in Delivery.');
    expect(readout()).toBe(NOTHING_MOVED_YET);
    expect(announced()).toBe('');
    // No pad: one read at mount, and no poll a frame after it.
    frames(10);
    expect(fake.reads()).toBe(1);
  });

  it('lists a pad that connects by its trimmed name, says so, and says when it goes', async () => {
    const fake = fakePads();
    await browserScreen(fake.port);
    fake.list = [pad(XBOX)];
    fake.fire();
    frames(1);
    expect(rows()).toEqual(['Xbox Wireless Controller: Connected']);
    expect(announced()).toBe('Xbox Wireless Controller connected.');

    fake.list = [null];
    fake.fire();
    frames(1);
    expect(rows()).toEqual([PRESS_SO_THE_APP_SEES_IT]);
    expect(announced()).toBe('Xbox Wireless Controller disconnected.');
  });

  it('does not announce a pad that was already there when the screen opened', async () => {
    const fake = fakePads();
    fake.list = [pad(XBOX)];
    await browserScreen(fake.port);
    expect(rows()).toEqual(['Xbox Wireless Controller: Connected']);
    expect(announced()).toBe('');
  });

  it('the button test says, in words, which button or stick moved', async () => {
    const fake = fakePads();
    await browserScreen(fake.port);
    fake.list = [pad(XBOX, [0])];
    fake.fire();
    frames(1);
    expect(readout()).toBe('Last moved: Bottom face button.');

    fake.list = [pad(XBOX)];
    frames(2);
    fake.list = [pad(XBOX, [], [0, 0, 0.9, 0])];
    frames(1);
    expect(readout()).toBe('Last moved: Right stick right.');

    fake.list = [pad(XBOX, [14], [0, 0, 0.9, 0])];
    frames(1);
    expect(readout()).toBe('Last moved: D-pad left.');
  });

  it('stops listening when the screen goes', async () => {
    const fake = fakePads();
    await browserScreen(fake.port);
    expect(fake.listeners()).toBe(1);
    mounted?.unmount();
    mounted = undefined;
    expect(fake.listeners()).toBe(0);
  });

  it('is on the shell’s screen too, and in a browser that cannot pair', async () => {
    const fake = fakePads();
    fake.list = [pad(XBOX)];
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={{ bluetooth: undefined, secureContext: true }}
          shell={{ readShellSupport: () => new Promise(() => undefined) }}
          gamepads={fake.port}
        />
      </main>,
    );
    await settle();
    expect(rows()).toEqual(['Xbox Wireless Controller: Connected']);
    mounted.unmount();

    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView
          capabilities={{ bluetooth: undefined, secureContext: true }}
          gamepads={fake.port}
        />
      </main>,
    );
    await settle();
    expect(rows()).toEqual(['Xbox Wireless Controller: Connected']);
  });

  it('with no port handed to it, reads the platform’s pads through window', async () => {
    let listed: (PadSnapshot | null)[] = [];
    Object.defineProperty(window.navigator, 'getGamepads', {
      configurable: true,
      value: () => listed,
    });
    await browserScreen();
    expect(rows()).toEqual([PRESS_SO_THE_APP_SEES_IT]);
    listed = [pad(XBOX, [1])];
    act(() => {
      window.dispatchEvent(new Event('gamepadconnected'));
    });
    frames(1);
    expect(rows()).toEqual(['Xbox Wireless Controller: Connected']);
    expect(readout()).toBe('Last moved: Right face button.');
  });
});
