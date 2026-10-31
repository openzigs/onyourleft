// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's lap-race item control — #1901: audited in the HUD the game
 * mounts, with its name, role, place in the tab order and ride-time size, and
 * its colours held to the tokens. What a press, a key and a pad do is
 * `HudPanel.items.test.tsx`'s. Where it lands on the stage is a layout claim,
 * not this file's: it is measured on a ride that runs a lap race (#1906).
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

import { auditAccessibility, formatViolations, tabbableElements } from '../../a11y/audit';
import { RIDE_SIZE_CLASS } from '../../design/Button';
import { AA_TEXT, contrastRatio } from '../../design/contrast';
import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { CONTRAST_REQUIREMENTS, paletteColours, THEMES } from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import type { ItemInputPort } from '../lap-race/item-input-port';
import { atStartLine } from '../simulation';
import type { SteerInputPort } from '../steer-port';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';
import { HudPanel } from './HudPanel';
import { ITEM_BUTTON_LABEL, ITEM_BY_KEY_SENTENCE } from './ItemControl';

// A path rather than `new URL(…, import.meta.url)`: under jsdom that URL is
// not a `file:` one.
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

const ITEMS: ItemInputPort = { useItem: () => undefined };
const STEERING: SteerInputPort = { steer: () => undefined };

function hud(): React.ReactElement {
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
        steering={STEERING}
        items={ITEMS}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const item = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => each.textContent === ITEM_BUTTON_LABEL,
  );

describe('the item control on the HUD — #1901', () => {
  it('is one button named by what it says, and the HUD audits clean with it', async () => {
    mounted = await mount(hud());

    const button = item();
    expect(button).toBeDefined();
    expect(button?.getAttribute('type')).toBe('button');
    // Named by its text alone (SC 2.5.3): no label that says otherwise.
    expect(button?.hasAttribute('aria-label')).toBe(false);
    // Steering has no button (D-13.3: item use is its own control).
    expect(document.querySelectorAll('.oyl-hud__item button')).toHaveLength(1);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with the touch lock on and its sentence showing', async () => {
    mounted = await mount(hud());
    const lock = [...document.querySelectorAll('button')].find(
      (each) => each.textContent === TOUCH_LOCK_NAME,
    );
    tap(lock as HTMLButtonElement);

    expect(document.body.textContent).toContain(ITEM_BY_KEY_SENTENCE);
    expect(item()?.getAttribute('aria-describedby')).not.toBeNull();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is in the tab order after Pause and End ride, and stays there with the lock on', async () => {
    mounted = await mount(hud());

    const order = (): (string | null)[] =>
      tabbableElements(document).map((each) => each.textContent);
    expect(order().indexOf(ITEM_BUTTON_LABEL)).toBeGreaterThan(order().indexOf('End ride'));

    const lock = [...document.querySelectorAll('button')].find(
      (each) => each.textContent === TOUCH_LOCK_NAME,
    );
    tap(lock as HTMLButtonElement);
    expect(order()).toContain(ITEM_BUTTON_LABEL);
  });

  it('gives the button a ride-time target: 48 px at the least, and the HUD’s 72 px floor', async () => {
    mounted = await mount(hud());

    const button = item() as HTMLButtonElement;
    for (const size of [button.style.minHeight, button.style.minWidth]) {
      expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(48);
      expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
    }
    expect(button.classList.contains(RIDE_SIZE_CLASS)).toBe(true);
    expect(button.classList.contains('oyl-hud__control')).toBe(true);
  });

  it('sets the lock’s sentence in the HUD’s muted ink, on the panel’s opaque surface, AA in every theme', () => {
    expect(declared('.oyl-hud__item-note', 'color')).toEqual(['var(--oyl-color-hud-ink-muted)']);
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    // No backing of its own to change the pair the panel declares.
    expect(declared('.oyl-hud__item', 'background')).toEqual([]);
    const pair = CONTRAST_REQUIREMENTS.find(
      (each) => each.foreground === 'hudInkMuted' && each.background === 'hudSurface',
    );
    expect(pair?.minimum).toBeGreaterThanOrEqual(AA_TEXT);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      expect(contrastRatio(palette.hudInkMuted, palette.hudSurface)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });
});
