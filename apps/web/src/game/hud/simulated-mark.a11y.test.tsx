// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's simulated-ride mark — #1992: audited in the HUD the game mounts,
 * as plain text, and its colours held to the tokens. That a simulated ride shows it and a
 * real one does not is `simulated-rider-wiring.test.tsx`'s; where it lands on
 * the stage is a layout claim for the owner's screenshots.
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
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { AA_TEXT, contrastRatio } from '../../design/contrast';
import { CONTRAST_REQUIREMENTS, paletteColours, THEMES } from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Each value `property` is declared with in the rules whose selector list names `selector`. */
function declared(selector: string, property: string): (string | undefined)[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values: (string | undefined)[] = [];
  for (const match of themeCss.matchAll(new RegExp(`${escaped}(?=\\s*[,{])`, 'g'))) {
    const opened = themeCss.indexOf('{', match.index);
    const closed = themeCss.indexOf('}', opened);
    const block = themeCss.slice(opened + 1, closed);
    for (const found of block.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))) {
      values.push(found[1]?.trim());
    }
  }
  return values;
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

const MARK = 'Simulated ride at 200 W, 8× real time. Not recorded or shared.';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('the simulated-ride mark on the HUD — #1992', () => {
  it('is on the HUD as text, and the HUD audits clean with it', async () => {
    const profile = route();
    mounted = await mount(
      <main>
        <h1>Ride</h1>
        <HudPanel
          profile={profile}
          state={atStartLine(profile)}
          cadence={{ value: undefined, live: false }}
          heartRate={{ value: undefined, live: false }}
          onPause={() => undefined}
          onEnd={() => undefined}
          paused={false}
          announcement=""
          simulated={MARK}
        />
      </main>,
    );
    const mark = document.querySelector('.oyl-hud__simulated');
    expect(mark?.tagName).toBe('P');
    expect(mark?.textContent).toBe(MARK);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is set in the HUD’s full ink on the panel’s opaque surface, AA in every theme', () => {
    expect(declared('.oyl-hud__simulated', 'color')).toEqual(['var(--oyl-color-hud-ink)']);
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    const pair = CONTRAST_REQUIREMENTS.find(
      (each) => each.foreground === 'hudInk' && each.background === 'hudSurface',
    );
    expect(pair?.minimum).toBeGreaterThanOrEqual(AA_TEXT);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      expect(contrastRatio(palette.hudInk, palette.hudSurface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
