// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride's light and weather in the chooser — #3281, audited inside
 * `test:a11y`. Mounted through the real `GameView`, inside the landmark and
 * heading the shell supplies (`picker.a11y.test.tsx`'s reason). What is read
 * is what a screen reader reaches: one named group of five radios, each
 * described by the sentence that says what the choice does not do, reached
 * and chosen by keyboard, with no violation before or after.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { RIDE_SKY_TEXT } from './StageChooser';

function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-flat', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([flatRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(200), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let mounted: Mounted | undefined;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
});

function radios(): HTMLInputElement[] {
  return queryAll<HTMLInputElement>(document.body, 'input[name="oyl-ride-sky"]');
}

describe('#3281 — the light and weather choice in the chooser', () => {
  it('is one named group of five described radios, chosen by keyboard, with no violation', async () => {
    mounted = await mount(
      <main>
        <h1>Trainer game</h1>
        <GameView port={PORT} renderer={() => Promise.resolve(RENDERER)} />
      </main>,
    );
    await settle();
    const group = radios();
    expect(group).toHaveLength(5);
    const fieldset = group[0]?.closest('fieldset');
    expect(fieldset?.querySelector('legend')?.textContent).toBe(RIDE_SKY_TEXT.legend);
    for (const radio of group) {
      expect(radio.closest('fieldset')).toBe(fieldset);
      expect(radio.closest('label')?.textContent).toBe(
        RIDE_SKY_TEXT[radio.value as keyof typeof RIDE_SKY_TEXT],
      );
      const hint = document.getElementById(radio.getAttribute('aria-describedby') ?? '');
      expect(hint?.textContent).toBe(RIDE_SKY_TEXT.hint);
    }
    expect(group.filter((radio) => radio.checked).map((radio) => radio.value)).toStrictEqual([
      'clear',
    ]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // Reached and chosen from the keyboard: a radio takes focus, and a press chooses it.
    const surprise = group.find((radio) => radio.value === 'surprise');
    surprise?.focus();
    expect(document.activeElement).toBe(surprise);
    await act(async () => {
      surprise?.click();
      await Promise.resolve();
    });
    await settle();
    expect(radios().find((radio) => radio.checked)?.value).toBe('surprise');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
