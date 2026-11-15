// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's zone strip — #2384: audited in the HUD the game mounts, named with
 * the zone in words, and every colour it paints held to a declared pair on the
 * panel. Which segment is lit, across every zone boundary, is
 * `HudPanel.test.tsx` §"#2384"; where the strip lands on a tablet is a layout
 * claim for the browser gate and the owner's screenshots.
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
import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../../design/contrast';
import {
  CONTRAST_REQUIREMENTS,
  paletteColours,
  THEMES,
  type ColourToken,
} from '../../design/tokens';
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
  for (const match of themeCss.matchAll(new RegExp(`(?<![\\w-])${escaped}(?=\\s*[,{])`, 'g'))) {
    const opened = themeCss.indexOf('{', match.index);
    const closed = themeCss.indexOf('}', opened);
    const block = themeCss.slice(opened + 1, closed);
    for (const found of block.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))) {
      values.push(found[1]?.trim());
    }
  }
  return values;
}

/** `var(--oyl-color-hud-zone-band3)` → `hudZoneBand3`. */
function tokenOf(value: string | undefined): string {
  const name = /^var\(--oyl-color-([a-z0-9-]+)\)$/.exec(value ?? '')?.[1] ?? '';
  return name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** That `foreground` on the HUD's panel is a declared non-text pair, and holds in every theme. */
function holdsOnThePanel(foreground: string): void {
  const pair = CONTRAST_REQUIREMENTS.find(
    (each) => each.foreground === foreground && each.background === 'hudSurface',
  );
  expect(pair?.minimum, `${foreground} on hudSurface is declared`).toBeGreaterThanOrEqual(
    AA_LARGE_TEXT_OR_NON_TEXT,
  );
  for (const theme of THEMES) {
    const palette = paletteColours(theme);
    expect(
      contrastRatio(palette[foreground as ColourToken], palette.hudSurface),
      `${foreground} on hudSurface, ${theme}`,
    ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
  }
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

describe('the zone strip on the HUD — #2384', () => {
  it('is an image named with the zone in words, and the HUD audits clean with it', async () => {
    const profile = route();
    const state = atStartLine(profile);
    mounted = await mount(
      <main>
        <h1>Ride</h1>
        <HudPanel
          profile={profile}
          state={{ ...state, input: { power: watts(200), live: true } }}
          cadence={{ value: 88, live: true }}
          heartRate={{ value: 150, live: true }}
          onPause={() => undefined}
          onEnd={() => undefined}
          paused={false}
          announcement=""
          thresholdPower={watts(250)}
        />
      </main>,
    );
    const strip = document.querySelector('.oyl-hud__zone-strip');
    // 200 W over 250 W is 0.8 of threshold: zone 3, from 0.76 to 0.91.
    expect(strip?.getAttribute('role')).toBe('img');
    expect(strip?.getAttribute('aria-label')).toBe('Zone 3 of 7: Tempo');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('outlines every segment in a colour that is 3:1 on the panel, in every theme', () => {
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    const outline = declared('.oyl-hud__zone-strip-segment', 'stroke');
    expect(outline).toEqual(['var(--oyl-color-hud-ink-muted)']);
    holdsOnThePanel(tokenOf(outline[0]));
    const lit = declared('.oyl-hud__zone-strip-segment--lit', 'stroke');
    expect(lit).toEqual(['var(--oyl-color-hud-ink)']);
    holdsOnThePanel(tokenOf(lit[0]));
  });

  it('fills the lit segment with its zone’s own colour, each 3:1 on the panel', () => {
    for (let zone = 1; zone <= 7; zone += 1) {
      const each = String(zone);
      // Unlit, the zone's colour dimmed onto the panel, inside the outline.
      expect(declared(`.oyl-hud__zone-strip-segment--${each}`, 'fill')).toEqual([
        `var(--oyl-color-hud-zone-band${each})`,
      ]);
      const fill = declared(
        `.oyl-hud__zone-strip-segment--lit.oyl-hud__zone-strip-segment--${each}`,
        'fill',
      );
      expect(fill).toEqual([`var(--oyl-color-hud-zone${each})`]);
      holdsOnThePanel(tokenOf(fill[0]));
    }
  });
});
