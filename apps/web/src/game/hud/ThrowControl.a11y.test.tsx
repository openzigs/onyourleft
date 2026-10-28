// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's Delivery throw control — #1810: audited in the HUD the game
 * mounts, with its name, role and ride-time size, and its colours held to
 * the tokens. What a press and a key do is `HudPanel.throw.test.tsx`'s.
 * Where it lands on the stage is a layout claim for the browser gate, which
 * has no ride to measure it on until #1816 runs a round.
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
import { AA_LARGE_TEXT_OR_NON_TEXT, AA_TEXT, contrastRatio } from '../../design/contrast';
import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import {
  CONTRAST_REQUIREMENTS,
  paletteColours,
  THEMES,
  type ColourToken,
} from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import type { ThrowInputPort } from '../delivery/throw-input-port';
import { atStartLine } from '../simulation';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';
import { HudPanel } from './HudPanel';
import { THROW_BUTTONS, THROW_BY_KEY_SENTENCE, THROW_CONTROL_NAME } from './ThrowControl';

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

/** Each value `property` is declared with in the rules for `selector`. */
function declared(selector: string, property: string): (string | undefined)[] {
  return rulesFor(selector).flatMap((block) =>
    [...block.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))].map((match) =>
      match[1]?.trim(),
    ),
  );
}

/** A `var(--oyl-color-…)` back to the token it names. */
function tokenOf(value: string | undefined): ColourToken {
  const name = /^var\(--oyl-color-([a-z-]+)\)$/.exec(value ?? '')?.[1];
  expect(name, value).toBeDefined();
  return (name ?? '').replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  ) as ColourToken;
}

/** The pair is declared at `minimum` or above, and meets it in every theme. */
function meets(foreground: ColourToken, background: ColourToken, minimum: number): void {
  const pair = CONTRAST_REQUIREMENTS.find(
    (each) => each.foreground === foreground && each.background === background,
  );
  expect(pair, `${foreground} on ${background}`).toBeDefined();
  expect(pair?.minimum).toBeGreaterThanOrEqual(minimum);
  for (const theme of THEMES) {
    const palette = paletteColours(theme);
    expect(contrastRatio(palette[foreground], palette[background])).toBeGreaterThanOrEqual(minimum);
  }
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

const PORT: ThrowInputPort = { throwParcel: () => undefined };

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
        throwing={PORT}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const group = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[role="group"][aria-label="${THROW_CONTROL_NAME}"]`);

const buttons = (): HTMLButtonElement[] => [
  ...(group()?.querySelectorAll<HTMLButtonElement>('button') ?? []),
];

describe('the throw control on the HUD — #1810', () => {
  it('is a named group of three buttons, each named by what it says, and audits clean', async () => {
    mounted = await mount(hud());

    expect(group()).not.toBeNull();
    expect(buttons().map((each) => each.textContent)).toEqual(
      THROW_BUTTONS.map((each) => each.label),
    );
    expect(buttons().map((each) => each.textContent)).toEqual(['Left', 'Next house', 'Right']);
    for (const each of buttons()) {
      expect(each.getAttribute('type')).toBe('button');
      // Named by its text alone (SC 2.5.3): no label that says otherwise.
      expect(each.hasAttribute('aria-label')).toBe(false);
    }
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with the touch lock on and its sentence showing', async () => {
    mounted = await mount(hud());
    const lock = [...document.querySelectorAll('button')].find(
      (each) => each.textContent === TOUCH_LOCK_NAME,
    );
    tap(lock as HTMLButtonElement);

    expect(document.body.textContent).toContain(THROW_BY_KEY_SENTENCE);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('puts every throw button in the tab order, after Pause and End ride', async () => {
    mounted = await mount(hud());

    const order = tabbableElements(document).map((each) => each.textContent);
    const at = (name: string): number => order.indexOf(name);
    for (const name of ['Left', 'Next house', 'Right']) {
      expect(at(name), name).toBeGreaterThan(at('End ride'));
    }
    expect(at('Left')).toBeLessThan(at('Next house'));
    expect(at('Next house')).toBeLessThan(at('Right'));
  });

  it('gives each button a ride-time target: 48 px at the least, and the HUD’s 72 px floor', async () => {
    mounted = await mount(hud());

    expect(buttons()).toHaveLength(3);
    for (const each of buttons()) {
      for (const size of [each.style.minHeight, each.style.minWidth]) {
        // #669's 48 px, under #94's 72 px for a gloved rider.
        expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(48);
        expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
      }
      expect(each.classList.contains(RIDE_SIZE_CLASS), each.outerHTML).toBe(true);
      expect(each.classList.contains('oyl-hud__control'), each.outerHTML).toBe(true);
    }
  });

  it('is drawn in the HUD control’s tokens, each pair AA in every theme', () => {
    const ink = tokenOf(declared('.oyl-hud__control', 'color')[0]);
    const surface = tokenOf(declared('.oyl-hud__control', 'background')[0]);
    const edge = declared('.oyl-hud__control', 'border')[0]?.match(/var\([^)]+\)/)?.[0];
    expect([ink, surface]).toEqual(['hudInk', 'hudSurface']);
    meets(ink, surface, AA_TEXT);
    meets(tokenOf(edge), surface, AA_LARGE_TEXT_OR_NON_TEXT);
  });

  it('sets the lock’s sentence in the HUD’s muted ink, on the panel’s opaque surface', () => {
    expect(declared('.oyl-hud__throw-note', 'color')).toEqual(['var(--oyl-color-hud-ink-muted)']);
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    // No backing of its own to change the pair the panel declares.
    expect(declared('.oyl-hud__throws', 'background')).toEqual([]);
    meets('hudInkMuted', 'hudSurface', AA_TEXT);
  });
});
