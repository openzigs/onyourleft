// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TransportAvailability } from '@onyourleft/sensors';
import { describe, expect, it } from 'vitest';

import { mayShowDeviceList, permissionNotice } from './notice';

const ALL: readonly TransportAvailability[] = [
  { kind: 'available' },
  { kind: 'not-permitted' },
  { kind: 'adapter-unavailable' },
  { kind: 'unsupported' },
];

describe('every unavailable outcome is explained', () => {
  it('has a notice for every kind that is not available', () => {
    for (const availability of ALL) {
      const notice = permissionNotice(availability);
      if (availability.kind === 'available') {
        expect(notice).toBeNull();
        continue;
      }
      expect(notice?.title).toBeTruthy();
      expect(notice?.explanation).toBeTruthy();
    }
  });

  it('gives each kind a DISTINCT title, so three problems are not one screen', () => {
    // The whole failure #87's criterion 8 names is a rider being told the same
    // unhelpful thing whatever went wrong.
    const titles = ALL.flatMap((one) => permissionNotice(one)?.title ?? []);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('the action is the one thing worth doing next', () => {
  it('sends a denied rider to the app’s settings, where the grant can be made', () => {
    expect(permissionNotice({ kind: 'not-permitted' })?.action).toEqual({
      label: 'Open app settings',
      kind: 'open-settings',
    });
  });

  it('sends a rider with Bluetooth off to the Bluetooth toggle, not to app settings', () => {
    expect(permissionNotice({ kind: 'adapter-unavailable' })?.action?.kind).toBe(
      'open-bluetooth-settings',
    );
  });

  it('offers NO action on an unsupported stack', () => {
    // Deliberately null. A retry button that cannot help invites a rider to
    // keep pressing it, which is worse than no button.
    expect(permissionNotice({ kind: 'unsupported' })?.action).toBeNull();
  });
});

describe('what the denial message may and may not say', () => {
  it('says the app does not ask for location', () => {
    // The manifest bounds ACCESS_FINE_LOCATION at API 30 and declares
    // BLUETOOTH_SCAN neverForLocation precisely so this sentence is true. If
    // the override is ever lost, this assertion becomes a lie the tests still
    // pass -- which is why the manifest has its own case in manifest.test.ts.
    expect(permissionNotice({ kind: 'not-permitted' })?.explanation).toContain('never asks');
    expect(permissionNotice({ kind: 'not-permitted' })?.explanation).toContain('location');
  });

  it('names the sensors a rider recognises rather than the Android permission', () => {
    const explanation = permissionNotice({ kind: 'not-permitted' })?.explanation ?? '';
    expect(explanation).toContain('trainer');
    expect(explanation).not.toContain('BLUETOOTH_SCAN');
    expect(explanation).not.toContain('Nearby devices');
  });
});

describe('a device list is never the answer to a permission problem', () => {
  it('may be shown only when the transport is available', () => {
    for (const availability of ALL) {
      expect(mayShowDeviceList(availability)).toBe(availability.kind === 'available');
    }
  });
});
