// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Report* on the HUD — #789: audited closed, open and answered, in the HUD
 * the game mounts; named for the rider it reports and opening a group named
 * for them; and adding no live region beside the HUD's one (`announce.ts`).
 * Where it is drawn is the browser gate's (`ride-room.browser.spec.ts` §"#789");
 * that it files through the room is `room-wiring.test.tsx` §"#789".
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { RIDE_SIZE_CLASS } from '../../design/Button';
import { namesControl, RIDE_TIME_CONTROLS } from '../../design/ride-time-controls';
import type { RoomReportAnswer } from '../../net/room-session';
import { flush } from '../../net/testing';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';
import { REPORT_REASONS_MS } from './RoomReport';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

async function hud(answer: RoomReportAnswer = { kind: 'reported' }): Promise<void> {
  const profile = route();
  mounted = await mount(
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        room={{ nearby: 2 }}
        onFollowNext={() => undefined}
        report={{
          target: { riderId: 4, rider: 'Bea' },
          onReport: () => Promise.resolve(answer),
        }}
      />
    </main>,
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const button = (name: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) => text(each) === name);

async function press(name: string): Promise<void> {
  const target = button(name);
  expect(target, name).toBeDefined();
  await act(async () => {
    target?.click();
    await flush();
  });
}

const liveRegions = (): Element[] =>
  [...document.querySelectorAll('*')].filter(
    (each) =>
      each.hasAttribute('aria-live') ||
      ['status', 'log', 'alert', 'timer', 'marquee'].includes(each.getAttribute('role') ?? ''),
  );

describe('Report on the HUD — #789', () => {
  it('audits clean closed, open and answered, and adds no live region', async () => {
    await hud();
    const regions = liveRegions().length;
    expect(formatViolations(auditAccessibility(document))).toBe('');
    await press('Report Bea');
    expect(formatViolations(auditAccessibility(document))).toBe('');
    await press('Other: something else about how they rode');
    expect(formatViolations(auditAccessibility(document))).toBe('');
    expect(liveRegions()).toHaveLength(regions);
  });

  it('names the control for the rider, says whether it is open, and opens a group named for them', async () => {
    await hud();
    const report = button('Report Bea');
    // The visible word first, so a voice command of what is seen reaches it (SC 2.5.3).
    expect(report?.firstChild?.textContent).toBe('Report');
    expect(report?.getAttribute('aria-expanded')).toBe('false');
    await press('Report Bea');
    expect(report?.getAttribute('aria-expanded')).toBe('true');
    const group = document.getElementById(report?.getAttribute('aria-controls') ?? '');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Report Bea for');
    expect([...(group?.querySelectorAll('button') ?? [])].map(text)).toEqual([
      'Name: an offensive display name',
      'Cheating, or riding that cannot be real',
      'Other: something else about how they rode',
    ]);
  });

  it('moves focus into the reasons on opening, and Escape closes them back to Report', async () => {
    await hud();
    await press('Report Bea');
    expect(text(document.activeElement)).toBe('Name: an offensive display name');
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await flush();
    });
    expect(document.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(button('Report Bea'));
  });

  it('closes the reasons by themselves when nothing is chosen, filing nothing', async () => {
    vi.useFakeTimers();
    const filed: string[] = [];
    const profile = route();
    mounted = await mount(
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        room={{ nearby: 2 }}
        report={{
          target: { riderId: 4, rider: 'Bea' },
          onReport: (_seat, reason) => {
            filed.push(reason);
            return Promise.resolve({ kind: 'reported' });
          },
        }}
      />,
    );
    await press('Report Bea');
    await act(async () => {
      vi.advanceTimersByTime(REPORT_REASONS_MS - 1);
      await flush();
    });
    expect(document.querySelector('[role="group"]')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await flush();
    });
    expect(document.querySelector('[role="group"]')).toBeNull();
    expect(filed).toEqual([]);
  });

  for (const [kind, said] of [
    ['gone', 'Not sent: that rider has left the room.'],
    ['refused', 'Not sent: your instance refused the report.'],
    ['unreachable', 'Not sent: your instance could not be reached.'],
  ] as const) {
    it(`moves focus to what became of the report — ${kind}`, async () => {
      await hud({ kind });
      await press('Report Bea');
      await press('Cheating, or riding that cannot be real');
      expect(text(document.activeElement)).toBe(said);
    });
  }
});

describe('*Report* is a 48 px ride-time target — #788, #669’s list', () => {
  it('is on the list, and wears the declared size; its reasons are not, and do not', async () => {
    await hud();
    const report = [...document.querySelectorAll('button')].find((each) =>
      text(each).startsWith('Report'),
    );
    expect(report, 'Report is on the HUD').toBeDefined();
    expect(
      RIDE_TIME_CONTROLS.some(
        (entry) => entry.surface === 'game-hud' && namesControl(entry, text(report)),
      ),
    ).toBe(true);
    expect(report?.classList.contains(RIDE_SIZE_CLASS), report?.outerHTML).toBe(true);
    await act(async () => {
      report?.click();
      await Promise.resolve();
    });
    const reasons = [...document.querySelectorAll('[role="group"] button')];
    expect(reasons).toHaveLength(3);
    for (const reason of reasons) {
      expect(reason.classList.contains(RIDE_SIZE_CLASS), reason.outerHTML).toBe(false);
    }
  });
});
