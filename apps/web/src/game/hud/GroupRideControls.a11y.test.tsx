// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's group-ride controls — #3307: the pull-off button and the sit-in
 * toggle audited in the HUD the game mounts, in every state each is drawn in,
 * with their names, roles, places in the tab order and ride-time sizes, and
 * their colours held to the tokens. What a press, a key and a pad do is
 * `HudPanel.group-ride.test.tsx`'s. Where they land on the stage is a layout
 * claim, not this file's: jsdom lays nothing out.
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
import { RIDE_TIME_TARGET_PIXELS } from '../../design/ride-time-controls';
import { tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { paletteColours, THEMES } from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import {
  PULL_OFF_BUTTON_LABEL,
  PULL_OFF_BY_KEY_SENTENCE,
  PULL_OFF_NOT_ON_FRONT_SENTENCE,
  SIT_IN_BUTTON_LABEL,
} from './GroupRideControls';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';
import { HudPanel } from './HudPanel';

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

function hud(onFront: boolean, sittingIn = false): React.ReactElement {
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
        groupRideInput={{
          onFront,
          sittingIn,
          pullOff: () => undefined,
          sitIn: () => undefined,
        }}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const named = (name: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => each.textContent === name,
  );

const lock = (): HTMLButtonElement =>
  [...document.querySelectorAll('button')].find(
    (each) => each.textContent === TOUCH_LOCK_NAME,
  ) as HTMLButtonElement;

describe('the group-ride controls on the HUD — #3307', () => {
  it.each([
    ['on the front', true, false],
    ['off the front', false, false],
    ['sitting in', false, true],
  ])('audits clean %s, each control a button named by what it says', async (_s, onFront, sat) => {
    mounted = await mount(hud(onFront, sat));

    for (const name of [PULL_OFF_BUTTON_LABEL, SIT_IN_BUTTON_LABEL]) {
      const button = named(name);
      expect(button, name).toBeDefined();
      expect(button?.getAttribute('type')).toBe('button');
      // Named by its text alone (SC 2.5.3): no label that says otherwise.
      expect(button?.hasAttribute('aria-label')).toBe(false);
    }
    // The toggle says which it is, and never by its name changing.
    expect(named(SIT_IN_BUTTON_LABEL)?.getAttribute('aria-pressed')).toBe(String(sat));
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it.each([
    ['on the front', true],
    ['off the front', false],
  ])('audits clean %s with the touch lock on and its sentence showing', async (_s, onFront) => {
    mounted = await mount(hud(onFront));
    tap(lock());

    expect(document.body.textContent).toContain(PULL_OFF_BY_KEY_SENTENCE);
    const described = (named(PULL_OFF_BUTTON_LABEL)?.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain(PULL_OFF_BY_KEY_SENTENCE);
    expect(described.includes(PULL_OFF_NOT_ON_FRONT_SENTENCE)).toBe(!onFront);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('keeps the unavailable button in the tab order, its reason a sentence off the screen', async () => {
    mounted = await mount(hud(false));

    const button = named(PULL_OFF_BUTTON_LABEL) as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(tabbableElements(document)).toContain(button);
    const note = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe(PULL_OFF_NOT_ON_FRONT_SENTENCE);
    // Off the screen by clip, never `display: none`, so a screen reader still reads it.
    expect(note?.classList.contains('oyl-visually-hidden')).toBe(true);
  });

  it('are reached by keyboard after Pause and End ride, pull off before sit in, lock on or off', async () => {
    mounted = await mount(hud(true));

    const order = (): (string | null)[] =>
      tabbableElements(document).map((each) => each.textContent);
    const places = (): number[] =>
      ['End ride', PULL_OFF_BUTTON_LABEL, SIT_IN_BUTTON_LABEL].map((name) => order().indexOf(name));
    expect(places().every((place) => place >= 0)).toBe(true);
    expect([...places()].sort((a, b) => a - b)).toStrictEqual(places());

    tap(lock());
    expect(order()).toContain(PULL_OFF_BUTTON_LABEL);
    expect(order()).toContain(SIT_IN_BUTTON_LABEL);
  });

  it('gives both a ride-time target of 48 px at the least: pull off the HUD’s 72 px floor, sit in the declared 3rem', async () => {
    mounted = await mount(hud(true));

    const pullOff = named(PULL_OFF_BUTTON_LABEL) as HTMLButtonElement;
    for (const size of [pullOff.style.minHeight, pullOff.style.minWidth]) {
      expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(RIDE_TIME_TARGET_PIXELS);
      expect(Number.parseInt(size, 10)).toBeGreaterThanOrEqual(CONTROL_MINIMUM_PIXELS);
    }
    expect(pullOff.classList.contains(RIDE_SIZE_CLASS)).toBe(true);
    expect(pullOff.classList.contains('oyl-hud__control')).toBe(true);

    // The toggle is the design system's at its ride size: 3rem each way, which is 48 px.
    const sitIn = named(SIT_IN_BUTTON_LABEL) as HTMLButtonElement;
    expect(sitIn.classList.contains(RIDE_SIZE_CLASS)).toBe(true);
    expect(sitIn.classList.contains('oyl-button--toggle')).toBe(true);
    expect(declared(`.${RIDE_SIZE_CLASS}`, 'min-height')).toContain('3rem');
    expect(declared(`.${RIDE_SIZE_CLASS}`, 'min-width')).toContain('3rem');
    expect(3 * 16).toBe(RIDE_TIME_TARGET_PIXELS);
  });

  it('draws the unavailable button and the lock’s sentence in the HUD’s muted ink, AA on its surface in every theme', () => {
    // The wrapper is the item control's, so its rules are the ones that paint these.
    const wrapper = '.oyl-hud__item';
    expect(declared(`${wrapper} .oyl-hud__control[aria-disabled='true']`, 'color')).toEqual([
      'var(--oyl-color-hud-ink-muted)',
    ]);
    expect(declared('.oyl-hud__item-note', 'color')).toEqual(['var(--oyl-color-hud-ink-muted)']);
    expect(declared('.oyl-hud__control', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    expect(declared(wrapper, 'background')).toEqual([]);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      expect(contrastRatio(palette.hudInkMuted, palette.hudSurface)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it('lights the button on the front and dashes its edge off it, its words AA either way — #3371', async () => {
    const lit = `.oyl-hud__item .oyl-hud__pull-off:not([aria-disabled='true'])`;
    const unlit = `.oyl-hud__item .oyl-hud__pull-off[aria-disabled='true']`;
    // On the front: a 4 px edge in the HUD's ink, its border and a ring inside it.
    expect(declared(lit, 'border-color')).toEqual(['var(--oyl-color-hud-ink)']);
    expect(declared(lit, 'box-shadow')).toEqual(['inset 0 0 0 2px var(--oyl-color-hud-ink)']);
    // Off it: a dashed edge, beside the muted ink the case above holds.
    expect(declared(unlit, 'border-style')).toEqual(['dashed']);
    // The panel's own surface either way (`hud-surface.a11y.test.ts`).
    expect(declared(lit, 'background')).toEqual([]);
    expect(declared(unlit, 'background')).toEqual([]);
    expect(declared('.oyl-hud__control', 'border')).toEqual([
      '2px solid var(--oyl-color-hud-border)',
    ]);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      // The lit edge, and the unlit one, against the surface they are drawn on (SC 1.4.11).
      expect(contrastRatio(palette.hudInk, palette.hudSurface)).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_OR_NON_TEXT,
      );
      expect(contrastRatio(palette.hudBorder, palette.hudSurface)).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_OR_NON_TEXT,
      );
      // And the one edge against the other, so the two states differ by more than a hue.
      expect(contrastRatio(palette.hudInk, palette.hudBorder)).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_OR_NON_TEXT,
      );
    }

    // Both rules are the pull-off button's, in both states, and *Sit in* is not it.
    for (const onFront of [true, false]) {
      mounted = await mount(hud(onFront));
      expect(named(PULL_OFF_BUTTON_LABEL)?.classList.contains('oyl-hud__pull-off')).toBe(true);
      expect(named(SIT_IN_BUTTON_LABEL)?.classList.contains('oyl-hud__pull-off')).toBe(false);
      expect(formatViolations(auditAccessibility(document))).toBe('');
      mounted.unmount();
      mounted = undefined;
    }
  });

  it('wraps both in the item control’s own box, so the rules above are theirs', async () => {
    mounted = await mount(hud(false));

    for (const name of [PULL_OFF_BUTTON_LABEL, SIT_IN_BUTTON_LABEL]) {
      expect(named(name)?.closest('.oyl-hud__item')).not.toBeNull();
    }
  });
});
