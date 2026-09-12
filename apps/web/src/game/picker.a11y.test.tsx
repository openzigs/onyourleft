// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The route picker, audited — including the pacer controls #237 added to it.
 *
 * ⚠️ **This file exists because the route-level audit cannot reach these
 * controls.** `routes.a11y.test.tsx` renders every entry in `shell/routes.ts`,
 * and it renders the game screen with **no port**, so `listRoutes` never
 * resolves to anything and the screen shows *"No saved routes yet"*. Every
 * control on this screen — the ghost checkbox, the new pacer checkbox, the
 * intensity box and the ride buttons — is therefore outside the gate that looks
 * exactly like the gate that covers them. Adding controls to a screen the a11y
 * suite renders is not the same as adding controls the a11y suite audits, and
 * this is the difference.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it, and so
 * `scripts/check-a11y-suite.mjs` would catch it if it ever stopped being
 * selected.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

function ridableRoute(id: string, name: string, attempts: number): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 40; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.3),
    });
  }
  return { id, name, profile: routeProfile(points), attempts };
}

const PORT: GamePort = {
  listRoutes: () =>
    Promise.resolve([ridableRoute('a', 'Box Hill', 0), ridableRoute('b', 'Ditchling', 4)]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(0), live: false, paired: false },
    cadence: { value: undefined, live: false, paired: false },
    heartRate: { value: undefined, live: false, paired: false },
  }),
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * The picker inside the landmark it actually lives in.
 *
 * The same argument `HudPanel.a11y.test.tsx` makes: `auditAccessibility` walks
 * the whole document, and mounting a screen bare would report a missing landmark
 * the shipping shell supplies — a false failure that trains the next person to
 * loosen the audit.
 */
async function mountPicker(): Promise<Mounted> {
  const tree = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={PORT} />
    </main>,
  );
  await settle();
  return tree;
}

describe('the route picker', () => {
  it('is clean under every accessibility rule', async () => {
    mounted = await mountPicker();

    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('names every one of its controls, the pacer ones included', async () => {
    mounted = await mountPicker();

    // The pacer checkbox and the intensity box are both present — if either
    // disappeared the rule above would have nothing to audit and would pass.
    expect(queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')).toHaveLength(1);
    expect(
      queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').filter((input) =>
        (input.closest('label')?.textContent ?? '').includes('pacer'),
      ),
    ).toHaveLength(1);
  });

  it('puts every control in the tab order, so none of them needs a pointer', async () => {
    mounted = await mountPicker();

    const reachable = tabbableElements(document);
    const controls = queryAll(mounted.container, 'input, button').filter(
      (element) => !(element as HTMLInputElement | HTMLButtonElement).disabled,
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(reachable).toContain(control);
    }
  });
});
