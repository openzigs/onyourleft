// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2358 — the Devices screen's Controllers section audited in each of its
 * states: nothing listed yet, a pad listed, and the button test after a
 * press. Named `*.a11y.test.tsx` so `test:a11y` selects it:
 * `routes.a11y.test.tsx` renders Devices with no pads, so it audits only the
 * empty state.
 *
 * What a sighted rider reads and what a screen reader hears are held
 * together: a pad's coming and going is in a polite live region, and the
 * readout is one of its own, both in words.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import type { GamepadPort, PadSnapshot } from '../game/gamepad-port';
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

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
});

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

const XBOX: PadSnapshot = {
  id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  connected: true,
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === 2 })),
};

describe('the Controllers section, audited — #2358', () => {
  it('is clean before a press, with a pad, and after the button test, and adds no tab stop', async () => {
    let list: (PadSnapshot | null)[] = [];
    let wake: (() => void) | undefined;
    const port: GamepadPort = {
      pads: () => list,
      onConnectionChange: (listener) => {
        wake = listener;
        return () => undefined;
      },
    };
    const stub = stubRideController(idleSnapshot());
    mounted = await mount(
      <main>
        <h1>Devices</h1>
        <DevicesView capabilities={CAPABLE} controller={stub.controller} gamepads={port} />
      </main>,
    );
    await settle();
    expectClean('Devices, no controller seen yet');
    const tabStops = tabbableElements(document).length;

    list = [XBOX];
    act(() => {
      wake?.();
      vi.advanceTimersToNextFrame();
    });
    expectClean('Devices, a controller connected, after a press');
    expect(tabbableElements(document)).toHaveLength(tabStops);

    const regions = [...document.querySelectorAll('[role="status"]')].map((each) =>
      each.textContent.trim(),
    );
    expect(regions).toContain('Xbox Wireless Controller connected.');
    expect(regions).toContain('Last moved: Left face button.');
  });
});
