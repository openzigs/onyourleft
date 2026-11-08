// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The built-in Delivery levels on the Delivery picker, and the setup a
 * level's link opens — #2362, audited inside `test:a11y`, on
 * `circuits-chooser.a11y.test.tsx`'s precedent.
 *
 * Mounted through the real `AppShell`, so the landmark and the page heading
 * are the shell's. What is read is what a rider reaches: the levels under
 * their own heading, above the rider's routes, each link named by its level;
 * the credit and its link by name; and the setup on level 1, its card in the
 * chooser's one radio group. The setup's ride is the synthetic fixture level
 * under level 1's id (ADR 0065 D-7.5).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../../a11y/audit';
import { OSM_ATTRIBUTION } from '../../../map/basemap';
import { AppShell } from '../../../shell/AppShell';
import { hrefForGamePlay } from '../../../shell/routes';
import type { CapabilityProbe } from '../../../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../../../testing/mount';
import { GAME_COURSES_TEXT } from '../../../views/GameCoursesView';
import { GameView, type GamePort, type RidableRoute } from '../../GameView';
import { northRoute } from '../../route-fixtures-testing';
import { SHIPPED_LEVELS } from '../../shipped-levels';
import { BUILT_IN_CIRCUITS_TEXT } from '../../StageChooser';
import { writeRealisticWorldChoice } from '../../world-preference';

import { parseLevelFile } from './level-file';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-level.json'),
    'utf8',
  ),
) as Record<string, unknown>;
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const OWN: RidableRoute = {
  id: 'own',
  name: 'Out to the coast',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};

function port(routes: readonly RidableRoute[]): GamePort {
  return {
    listRoutes: () => Promise.resolve(routes),
    listDeliveryLevels: () => Promise.resolve(SHIPPED_LEVELS.list()),
    loadDeliveryLevel: (id) => {
      const name = SHIPPED_LEVELS.list().find((level) => level.id === id)?.name ?? 'Fixture Lane';
      return Promise.resolve(parseLevelFile({ ...FIXTURE, id, name }, id));
    },
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(220), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

let mounted: Mounted | undefined;

beforeEach(() => {
  localStorage.clear();
  writeRealisticWorldChoice(localStorage, true);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
  globalThis.location.hash = '';
});

async function picker(routes: readonly RidableRoute[]): Promise<void> {
  globalThis.location.hash = '#/games/delivery';
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} game={port(routes)} />);
  for (let i = 0; i < 50 && document.querySelector('[data-level]') === null; i++) await settle();
}

describe('#2362 — the built-in levels on the Delivery picker', () => {
  for (const [label, routes] of [
    ['beside a saved route', [OWN]],
    ['to a rider with no routes', []],
  ] as const) {
    it(`are listed under their own heading, ${label}, each link named by its level, with no finding`, async () => {
      await picker(routes);
      const section = document.querySelector('.oyl-game-courses__levels');
      const heading = section?.querySelector('h2');
      expect(heading?.textContent).toBe(GAME_COURSES_TEXT.levelsHeading);
      expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
      for (const level of SHIPPED_LEVELS.list()) {
        const link = queryAll<HTMLAnchorElement>(section ?? document, 'a').find(
          (each) =>
            (each.textContent ?? '').replace(/\s+/g, ' ').trim() ===
            `${GAME_COURSES_TEXT.choose}: ${level.name}`,
        );
        expect(link, level.name).toBeDefined();
      }
      const credit = section?.querySelector('[data-credit="levels"]');
      expect(credit?.textContent).toContain(OSM_ATTRIBUTION);
      expect(credit?.querySelector('a')?.textContent).toBe(BUILT_IN_CIRCUITS_TEXT.licence);
      expect(formatViolations(auditAccessibility(document))).toBe('');
    });
  }

  it('open a setup on level 1 whose card is in the chooser’s one radio group, with no finding', async () => {
    const [first] = SHIPPED_LEVELS.list();
    if (first === undefined) throw new Error('the app ships no level');
    globalThis.location.hash = hrefForGamePlay('delivery', first.routeId);
    mounted = await mount(
      <main>
        <h1>Trainer game</h1>
        <GameView port={port([OWN])} />
      </main>,
    );
    for (
      let i = 0;
      i < 50 && !(mounted.container.textContent ?? '').includes(`Ride ${first.name}`);
      i++
    ) {
      await settle();
    }
    const radios = queryAll<HTMLInputElement>(document, 'input').filter(
      (input) => input.type === 'radio' && input.closest('.oyl-chooser__routes') !== null,
    );
    expect(radios.map((radio) => radio.value)).toStrictEqual([first.routeId, OWN.id]);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios[0]?.checked).toBe(true);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
