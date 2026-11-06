// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A race's standings on the HUD — #1347: audited, in the HUD the game mounts,
 * and held to "on request, never announced every second": a labelled section
 * with no live region in it, beside the HUD's one region (`announce.ts`).
 * Where it is drawn is the browser gate's (`ride-room.browser.spec.ts` §"#1347").
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import type { RaceStandingsView } from '../room-ride';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
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

const STANDINGS: RaceStandingsView = {
  place: 2,
  of: 3,
  lines: [
    {
      riderId: 5,
      place: 1,
      who: 'Ann',
      gap: '−8 s',
      figure: '3.9 W/kg',
      flagged: true,
      you: false,
    },
    { riderId: 3, place: 2, who: 'You', gap: '', figure: '3.5 W/kg', flagged: false, you: true },
    {
      riderId: 7,
      place: 3,
      who: 'Bea',
      gap: '+12 s',
      figure: 'Coasting',
      flagged: false,
      you: false,
    },
  ],
};

async function hud(standings: RaceStandingsView | undefined): Promise<void> {
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
        standings={standings}
      />
    </main>,
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('a race’s standings on the HUD — #1347', () => {
  it('audits clean', async () => {
    await hud(STANDINGS);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is a labelled section a screen reader can go to, saying where the rider is first, then each line', async () => {
    await hud(STANDINGS);
    const section = document.querySelector('section[aria-label="Race standings"]');
    expect(section).not.toBeNull();
    expect(text(section?.querySelector('p'))).toBe('You are 2 of 3.');
    expect([...(section?.querySelectorAll('li') ?? [])].map(text)).toEqual([
      '1 Ann −8 s 3.9 W/kg Flagged',
      '2 You 3.5 W/kg',
      '3 Bea +12 s Coasting',
    ]);
    // The rider's own line is marked for a screen reader as well as by its look.
    const current = section?.querySelectorAll('[aria-current="true"]');
    expect([...(current ?? [])].map(text)).toEqual(['2 You 3.5 W/kg']);
  });

  it('keeps list semantics under list-style none and numbers from the first visible place', async () => {
    await hud({
      ...STANDINGS,
      lines: STANDINGS.lines.map((line) => ({ ...line, place: line.place + 28 })),
    });
    const list = document.querySelector('section[aria-label="Race standings"] ol');
    expect(list?.getAttribute('role')).toBe('list');
    expect(list?.getAttribute('start')).toBe('29');
  });

  it('numbers each line by its own place when the leader is kept above a window further back (#1967)', async () => {
    await hud({
      ...STANDINGS,
      lines: STANDINGS.lines.map((line, at) => ({
        ...line,
        place: at === 0 ? 1 : line.place + 28,
      })),
    });
    const items = [
      ...document.querySelectorAll<HTMLLIElement>('section[aria-label="Race standings"] li'),
    ];
    expect(items.map((item) => item.value)).toEqual([1, 30, 31]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is never a live region: the standings are read on request, not announced every second', async () => {
    await hud(STANDINGS);
    const section = document.querySelector('section[aria-label="Race standings"]');
    const live = [section, ...(section?.querySelectorAll('*') ?? [])].filter(
      (each) =>
        each !== null &&
        (each.hasAttribute('aria-live') ||
          ['status', 'log', 'alert', 'timer', 'marquee'].includes(each.getAttribute('role') ?? '')),
    );
    expect(live).toEqual([]);
    // The HUD still has its one region, and the standings are not in it.
    const region = document.querySelector('[data-oyl-announcer="hud"]');
    expect(region).not.toBeNull();
    expect(text(region)).toBe('');
  });

  it('is not there at all without standings — a group ride, or before the room sends any', async () => {
    await hud(undefined);
    expect(document.querySelector('.oyl-hud__standings')).toBeNull();
  });
});
