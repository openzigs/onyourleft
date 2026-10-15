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
  room: { readonly nearby: number; readonly draft?: number | 'off' } | undefined,
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
    await hud({ nearby: 1, draft: 34 });
    expect(field('Draft')).toBe('Draft 34 % of drag');
    expect(field('Draft')).not.toMatch(/\bW\b|watt/i);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says Off in a room made with drafting off', async () => {
    await hud({ nearby: 1, draft: 'off' });
    expect(field('Draft')).toBe('Draft Off');
  });

  it('is not on the HUD at all on a ride with no room — absent, not "0 %"', async () => {
    await hud(undefined);
    expect(field('Draft')).toBeUndefined();
    expect(text(document.querySelector('.oyl-hud'))).not.toContain('% of drag');
  });
});
