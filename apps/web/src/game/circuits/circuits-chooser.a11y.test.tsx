// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The built-in circuits in the stage chooser — #2293, audited inside
 * `test:a11y`, on `lap-race-chooser.a11y.test.tsx`'s precedent.
 *
 * Mounted through the real `GameView`, inside the landmark and heading the
 * shell supplies, over a synthetic fixture circuit (ADR 0064 D-6.4). What is
 * read is what a rider reaches: the circuits under their own heading, in the
 * same radio group as the rider's routes, chosen by keyboard; the credit and
 * its link by name; and the circuit's race-only loadout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { OSM_ATTRIBUTION } from '../../map/basemap';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import { BUILT_IN_CIRCUITS_TEXT, LAP_RACE_CHOICE_TEXT } from '../StageChooser';

const OUT: RidableRoute = {
  id: 'out',
  name: 'Out to the coast',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};

const FIXTURE: RidableRoute = {
  id: circuitRouteId('fixture'),
  name: 'Fixture Circuit',
  profile: circuitRoute(60),
  attempts: 0,
};

function port(routes: readonly RidableRoute[]): GamePort {
  return {
    listRoutes: () => Promise.resolve(routes),
    listCircuits: () => Promise.resolve([FIXTURE]),
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
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function game(routes: readonly RidableRoute[]): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={port(routes)} />
    </main>,
  );
  await settle();
}

function circuitRadio(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[type="radio"]').find(
    (radio) => radio.value === FIXTURE.id,
  );
}

describe('#2293 — the built-in circuits in the chooser', () => {
  it('sit under their own heading, a level below the chooser’s, with no finding', async () => {
    await game([OUT]);
    const section = document.querySelector('.oyl-chooser__circuits');
    const heading = section?.querySelector('h3');
    expect(heading?.textContent).toBe(BUILT_IN_CIRCUITS_TEXT.heading);
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
    // The circuit's own name is a level below its section's heading.
    expect(section?.querySelector('h4 label')?.textContent).toBe(FIXTURE.name);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('are in the same radio group as the rider’s routes, labelled by name, and chosen by keyboard', async () => {
    await game([OUT]);
    const radio = circuitRadio();
    expect(radio).toBeDefined();
    if (radio === undefined) return;
    const own = queryAll<HTMLInputElement>(document.body, 'input[type="radio"]').find(
      (each) => each.value === OUT.id,
    );
    expect(radio.name).toBe(own?.name);
    expect(document.querySelector(`label[for="${radio.id}"]`)?.textContent).toBe(FIXTURE.name);
    await activateWithKeyboard(radio);
    await settle();
    expect(circuitRadio()?.checked).toBe(true);
    const loadout = document.querySelector('.oyl-chooser__loadout');
    expect(loadout?.textContent).toContain(LAP_RACE_CHOICE_TEXT.onCircuit);
    // The race's choices are labelled controls, reachable with no switch first.
    const laps = queryAll<HTMLLabelElement>(document.body, 'label').find(
      (label) => label.textContent === LAP_RACE_CHOICE_TEXT.laps,
    );
    expect(document.getElementById(laps?.htmlFor ?? '')?.tagName).toBe('SELECT');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('carry the OpenStreetMap credit, and a link to the licence that says where it goes', async () => {
    await game([OUT]);
    const credit = document.querySelector('[data-credit="circuits"]');
    expect(credit?.textContent).toContain(OSM_ATTRIBUTION);
    const link = credit?.querySelector('a');
    expect(link?.textContent).toBe(BUILT_IN_CIRCUITS_TEXT.licence);
    expect(link?.getAttribute('href')).toBe('#/about/credits');
  });

  it('are offered, with no finding, to a rider with no routes, with the way to import one', async () => {
    await game([]);
    expect(circuitRadio()?.checked).toBe(true);
    const link = queryAll<HTMLAnchorElement>(document.body, 'a').find(
      (each) => each.textContent === BUILT_IN_CIRCUITS_TEXT.noRoutes,
    );
    expect(link?.getAttribute('href')).toBe('#/routes');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
