// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The OpenStreetMap credit on the HUD, audited — #1552, ADR 0054 D-3.6.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it: the issue asks that the
 * line meet WCAG AA in both themes and not be a live region, and an assertion
 * of either outside the accessibility gate would leave it outside the one gate
 * built for it.
 *
 * ⚠️ **Out of every panel since the owner's ruling on #1572**: a small line in
 * a corner of the game view, clear of the HUD (ADR 0054 D-3.6, D-8 Q3). Over
 * the world, so #423's rule is met by its own opaque backing rather than by a
 * panel's.
 *
 * ⚠️ jsdom performs no layout and resolves no custom property, so the colours
 * are read from `theme.css` as a file (as `hud-surface.a11y.test.ts` does) and
 * measured from the tokens, and where it is in the HUD is read from the DOM.
 * Where it lands on a real screen is `ride-attribution.browser.spec.ts`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type React from 'react';
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
import { OSM_ATTRIBUTION } from '../../map/basemap';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

// A path rather than `new URL(…, import.meta.url)`: under jsdom that URL is
// not a `file:` one.
const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list names `selector` exactly. */
function rulesFor(selector: string): readonly string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks: string[] = [];
  for (const match of themeCss.matchAll(new RegExp(`${escaped}(?=\\s*[,{])`, 'g'))) {
    const opened = themeCss.indexOf('{', match.index);
    const closed = themeCss.indexOf('}', opened);
    if (opened !== -1 && closed !== -1) blocks.push(themeCss.slice(opened + 1, closed));
  }
  return blocks;
}

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 60; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 30 ? index : 60 - index),
    });
  }
  return routeProfile(points);
}

function hud(attribution?: string): React.ReactElement {
  const profile = route();
  return (
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
        attribution={attribution}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('the OpenStreetMap credit on the HUD — #1552', () => {
  it('is a line of the HUD’s own, out of every panel, as plain text, and audits clean', async () => {
    mounted = await mount(hud(OSM_ATTRIBUTION));
    const line = document.querySelector('.oyl-hud__attribution');
    expect(line?.textContent).toBe(OSM_ATTRIBUTION);
    // A child of the HUD's region, so `theme.css` can set it in a corner of
    // the road; in no panel, so it is clear of every one.
    expect(line?.parentElement?.matches('section.oyl-hud[aria-label="Ride metrics"]')).toBe(true);
    expect(line?.closest('.oyl-hud__panel')).toBeNull();
    // Never a live region: it says nothing that changes, and the HUD's one
    // region is the only thing on the stage that speaks by itself (#445).
    expect(line?.closest('[role="status"], [role="alert"], [role="log"], [aria-live]')).toBeNull();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is set in the HUD’s muted ink on its own opaque HUD surface, a pair AA in both themes', () => {
    const rules = rulesFor('.oyl-hud__attribution');
    expect(rules.length).toBeGreaterThan(0);
    const declared = (property: string): (string | undefined)[] =>
      rules.flatMap((block) =>
        [...block.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))].map((match) =>
          match[1]?.trim(),
        ),
      );
    expect(declared('color')).toEqual(['var(--oyl-color-hud-ink-muted)']);
    // #423: over the world, so a backing of its own, and only the opaque token.
    expect(declared('background')).toEqual(['var(--oyl-color-hud-surface)']);
    for (const block of rules) {
      expect(block).not.toMatch(/\b(opacity|background-color|backdrop-filter)\s*:/);
    }
    const pair = CONTRAST_REQUIREMENTS.find(
      (each) => each.foreground === 'hudInkMuted' && each.background === 'hudSurface',
    );
    expect(pair?.minimum).toBe(AA_TEXT);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      expect(contrastRatio(palette.hudInkMuted, palette.hudSurface)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it('is not on the HUD at all with no credit owed — the stylised world’s HUD is unchanged', async () => {
    mounted = await mount(hud());
    expect(document.querySelector('.oyl-hud__attribution')).toBeNull();
    expect(document.body.textContent).not.toContain(OSM_ATTRIBUTION);
  });
});
