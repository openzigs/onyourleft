// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The power field's view on the HUD — #2420: its term says which view it is
 * in, *Power (3 s)* or *Power (instant)*, as a screen reader announces it, the
 * HUD audits clean with it, and the view is drawn out of the label's capitals.
 * `fields.test.ts` §"#2420" holds the numbers; `power-shown-wiring.test.tsx`
 * the ride.
 *
 * ⚠️ It reads the stylesheet as a **file**, for the reason
 * `a11y/theme.a11y.test.ts` gives: jsdom resolves no custom property.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import type { ShownPower } from './fields';
import { HudPanel } from './HudPanel';

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the one rule whose whole selector is `selector`. */
function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(themeCss);
  return match?.[1] ?? '';
}

/** A synthetic straight road north from 0° 0°. */
function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude((index * 10) / 111_320), degreesLongitude(0)),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function hud(shownPower: ShownPower | undefined): Promise<void> {
  const profile = route();
  const state = atStartLine(profile);
  mounted = await mount(
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={{ ...state, input: { power: watts(312), live: true } }}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        thresholdPower={watts(250)}
        shownPower={shownPower}
      />
    </main>,
  );
}

/** The power field's term and value, as a screen reader reads the pair. */
function powerField(): { readonly term: string; readonly value: string } {
  const row = [...document.querySelectorAll('.oyl-hud__field')].find((each) =>
    (each.querySelector('dt')?.textContent ?? '').startsWith('Power'),
  );
  return {
    term: row?.querySelector('dt')?.textContent ?? '',
    value: row?.querySelector('dd')?.textContent ?? '',
  };
}

describe('the power field’s view — #2420', () => {
  it('names the 3 s average in its term, shows the average, and audits clean', async () => {
    await hud({ view: 'average', average: 200 });
    expect(powerField()).toEqual({ term: 'Power (3 s)', value: '200 W' });
    // The zone beside it is the zone of the power shown: 200 W of 250 W is zone 3.
    expect(document.querySelector('.oyl-hud__zone-strip')?.getAttribute('aria-label')).toBe(
      'Zone 3 of 7: Tempo',
    );
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('names instant in its term, shows the reading, and audits clean', async () => {
    await hud({ view: 'instant', average: 200 });
    expect(powerField()).toEqual({ term: 'Power (instant)', value: '312 W' });
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('keeps the plain term where no view is handed in (the demo)', async () => {
    await hud(undefined);
    expect(powerField()).toEqual({ term: 'Power', value: '312 W' });
    expect(document.querySelector('.oyl-hud__label-qualifier')).toBeNull();
  });

  it('draws the view out of the label’s capitals, in one piece', async () => {
    await hud({ view: 'average', average: 200 });
    const qualifier = document.querySelector('.oyl-hud__label-qualifier');
    expect(qualifier?.closest('dt')?.classList).toContain('oyl-hud__label');
    expect(ruleFor('.oyl-hud__label')).toMatch(/text-transform:\s*uppercase/);
    const rule = ruleFor('.oyl-hud__label-qualifier');
    expect(rule).toMatch(/text-transform:\s*none/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });
});
