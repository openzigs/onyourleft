// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Devices row's `Added …` and the revoke button beside it name one day
 * for one key (#1511), in a zone where UTC's calendar is not the device's.
 *
 * The zone is set before anything is imported (`vi.hoisted`), because the
 * day formatters resolve the zone when their module loads. So this file runs
 * at UTC+14 whatever zone the run is in, and a UTC run — which is what CI
 * is — still tells the device's calendar from UTC's.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('TZ', 'Pacific/Kiritimati');
});

import { formatDay, formatIsoDay } from '../instance/account-change-notices';
import { scriptedInstance } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { ACCOUNT_NOTICES_TEXT } from './InstanceDevices';
import { InstanceView } from './InstanceView';

afterAll(() => {
  vi.unstubAllEnvs();
});

// 23:30 UTC on 21 September: 13:30 on the 22nd at UTC+14.
const LATE_UTC = Date.UTC(2026, 8, 21, 23, 30) / 1000;

describe("the Devices row's day, east of UTC (#1511)", () => {
  it("writes the day on the device's calendar, as the revoke name does", () => {
    expect(formatIsoDay(LATE_UTC)).toBe('2026-09-22');
    expect(formatDay(LATE_UTC)).toBe('22 September');
  });

  it('shows a key added near midnight UTC as added on the day its revoke button names', async () => {
    const scripted = scriptedInstance({ connected: true });
    const [mine, other] = scripted.held.devices;
    if (mine === undefined || other === undefined) throw new Error('two scripted devices');
    scripted.held.devices = [
      { ...mine, addedAt: Date.UTC(2026, 8, 10, 12) / 1000 },
      { ...other, addedAt: LATE_UTC },
    ];
    let mounted: Mounted | undefined;
    try {
      mounted = await mount(<InstanceView port={scripted.port} />);
      await settle();
      const rows = [...mounted.container.querySelectorAll('.oyl-instance__devices li')].map((row) =>
        (row.textContent ?? '').replace(/\s+/g, ' '),
      );
      expect(rows[1]).toContain('Added 2026-09-22;');
      const names = [...mounted.container.querySelectorAll('button')].map(
        (each) => each.textContent,
      );
      expect(names).toContain(ACCOUNT_NOTICES_TEXT.revoke('the key added on 22 September'));
    } finally {
      mounted?.unmount();
    }
  });
});
