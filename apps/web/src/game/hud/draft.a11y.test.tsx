// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The draft on the HUD — #787, ADR 0038 D-5: rendered by the HUD the game
 * mounts and read back from its text. A share of aerodynamic drag beside the
 * draft's label and never a watt figure; absent on a ride with no room.
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

async function hud(
  room:
    | {
        readonly nearby: number;
        readonly draft?: number | 'off';
        readonly draftShown?: boolean;
      }
    | undefined,
): Promise<void> {
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
        room={room}
      />
    </main>,
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The field labelled `label`, as a screen reader hears it: its term, then its definition. */
function field(label: string): string | undefined {
  const found = [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === label,
  );
  return found === undefined
    ? undefined
    : `${text(found.querySelector('dt'))} ${text(found.querySelector('dd'))}`;
}

describe('the draft on the HUD — #787', () => {
  it('says the room’s draft as a share of drag, never beside a watt figure, and audits clean', async () => {
    await hud({ nearby: 1, draft: 34, draftShown: true });
    expect(field('Draft')).toBe('Draft 34 % of drag at most 59 %');
    expect(field('Draft')).not.toMatch(/\bW\b|watt/i);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says Off in a room made with drafting off', async () => {
    await hud({ nearby: 1, draft: 'off', draftShown: true });
    expect(field('Draft')).toBe('Draft Off');
  });

  it('is not on the HUD at all on a ride with no room — absent, not "0 %"', async () => {
    await hud(undefined);
    expect(field('Draft')).toBeUndefined();
    expect(text(document.querySelector('.oyl-hud'))).not.toContain('% of drag');
  });

  it('is not on the HUD in a room unless the ride says the rider’s setting shows it — ADR 0038 D-5', async () => {
    await hud({ nearby: 1, draft: 34 });
    expect(field('Nearby')).toBeDefined();
    expect(field('Draft')).toBeUndefined();
    expect(document.querySelector('.oyl-hud__gauge')).toBeNull();
  });

  it('draws a gauge filled to the share of the full scale, with the full-scale end drawn, hidden from a screen reader — #327', async () => {
    await hud({ nearby: 1, draft: 34, draftShown: true });
    const gauges = document.querySelectorAll('.oyl-hud__gauge');
    expect(gauges).toHaveLength(1);
    const gauge = gauges[0];
    expect(gauge?.closest('.oyl-hud__field')?.querySelector('dt')?.textContent).toBe('Draft');
    expect(gauge?.getAttribute('aria-hidden')).toBe('true');
    const fill = Number(gauge?.querySelector('.oyl-hud__gauge-fill')?.getAttribute('width'));
    expect(fill).toBeCloseTo((34 / 59) * 100, 9);
    expect(gauge?.querySelector('.oyl-hud__gauge-scale')?.getAttribute('width')).toBe('100');
    const full = gauge?.querySelector('.oyl-hud__gauge-full');
    expect([full?.getAttribute('x1'), full?.getAttribute('x2')]).toEqual(['100', '100']);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('draws no gauge in a room with drafting off', async () => {
    await hud({ nearby: 1, draft: 'off', draftShown: true });
    expect(document.querySelector('.oyl-hud__gauge')).toBeNull();
  });
});
