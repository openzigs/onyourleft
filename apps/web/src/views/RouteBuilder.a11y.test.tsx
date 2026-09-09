// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The drawing canvas with something drawn on it, audited — #71 and #72.
 *
 * ⚠️ **`routes.a11y.test.tsx` audits this route already, and it audits an empty
 * one.** That suite renders every entry in `shell/routes.ts` with no ports at
 * all, so the builder it sees has no routing provider, no waypoints, no legs
 * table and no profile — which is to say none of the markup this screen
 * exists for. Every control, every table and every heading added here would
 * have sat outside the one gate in this repository with a real pass/fail line
 * in it while that suite stayed green.
 *
 * `RideRecovery.a11y.test.tsx` makes the same argument about the same hole, and
 * this is the second time it has been worth writing down: a route table cannot
 * audit a state a route only reaches when it has data.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it (§4e), and
 * `scripts/check-a11y-suite.mjs` would catch the reverse mistake.
 */

import { RoutingError } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import type { DraftStorage } from '../routing/draft-storage';
import { scriptedProvider, type ScriptedProvider } from '../routing/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { RouteBuilderView } from './RouteBuilderView';
import type { RouteDraft } from '../routing/draft';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function isolatedStorage(): DraftStorage {
  let held: RouteDraft | undefined;
  return {
    read: () => held,
    write: (draft) => {
      held = draft;
    },
    forget: () => {
      held = undefined;
    },
  };
}

/**
 * The builder inside the landmark it ships in.
 *
 * ⚠️ Through a `main` with an `h1`, because `auditAccessibility` walks the whole
 * document and the landmark and heading-order rules cannot be checked against a
 * fragment: this view renders neither of its own — `AppShell` does — so
 * mounting it bare reports three violations the shipping screen does not have.
 * `HudPanel.a11y.test.tsx` and `RideRecovery.a11y.test.tsx` make the same
 * argument.
 */
async function drawn(
  waypoints: number,
  provider: ScriptedProvider = scriptedProvider(),
): Promise<Mounted> {
  mounted = await mount(
    <main>
      <h1>Draw a route</h1>
      <RouteBuilderView provider={provider} storage={isolatedStorage()} />
    </main>,
  );
  await settle();
  for (let index = 0; index < waypoints; index += 1) {
    await press('Add a waypoint');
  }
  return mounted;
}

function buttonNamed(label: string): HTMLButtonElement {
  if (mounted === undefined) throw new Error('nothing is mounted');
  const found = queryAll<HTMLButtonElement>(mounted.container, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await activateWithKeyboard(buttonNamed(label));
  await settle();
}

describe('the drawing canvas is inside the accessibility gate', () => {
  it('audits clean with a route drawn on it', async () => {
    await drawn(4);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean while a leg has no route', async () => {
    const provider = scriptedProvider();
    await drawn(3, provider);
    provider.failEveryRoute(new RoutingError('no-route', 'No path between these two points.', 0));
    await press('Move waypoint 2 north');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean while the clear confirmation is up', async () => {
    await drawn(3);
    await press('Clear');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with no routing service at all', async () => {
    mounted = await mount(
      <main>
        <h1>Draw a route</h1>
        <RouteBuilderView storage={isolatedStorage()} />
      </main>,
    );
    await settle();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('every control on it is reachable by keyboard', () => {
  it('puts each waypoint’s controls in the tab order', async () => {
    // A waypoint a keyboard cannot move is a route a keyboard user cannot draw,
    // which on this screen is the whole feature.
    const view = await drawn(2);
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).toContain('Waypoint 1');
    expect(names).toContain('Move waypoint 1 north');
    expect(names).toContain('Move waypoint 1 west');
    expect(names).toContain('Delete waypoint 1');
  });

  it('puts the leg controls in the tab order', async () => {
    const view = await drawn(3);
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).toContain('Draw leg 1 freehand');
  });

  it('reaches every control on the screen, with none of them disabled', async () => {
    const view = await drawn(3);
    const controls = queryAll(view.container, 'a[href], button, input, select, textarea');
    const tabbable = new Set(tabbableElements(view.container));
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(tabbable.has(control), `not in the tab order: ${control.outerHTML}`).toBe(true);
    }
  });

  it('gives the routing preference a label a screen reader can read', async () => {
    const view = await drawn(2);
    const select = view.container.querySelector('select');
    const label = view.container.querySelector(`label[for="${select?.id ?? ''}"]`);
    expect(label?.textContent).toBe('What you will ride on');
  });
});

describe('what the tables say without being looked at', () => {
  it('gives both tables a caption', async () => {
    // A table with no caption is a grid of numbers a screen reader reaches with
    // no idea what it is a grid of.
    const view = await drawn(3);
    for (const table of queryAll(view.container, 'table')) {
      expect(table.querySelector('caption')?.textContent ?? '').not.toBe('');
    }
  });

  it('names every gradient band in the caption, so shading carries nothing alone', async () => {
    // #72's last criterion. The chart may shade by band; what it may not do is
    // shade ONLY.
    const view = await drawn(3);
    const captions = queryAll(view.container, 'caption').map((node) => node.textContent ?? '');
    expect(captions.some((text) => text.includes('Very steep climb'))).toBe(true);
  });

  it('marks the stretches the elevation dataset had no height for', async () => {
    const view = await drawn(3, scriptedProvider({ heights: [10, null, 30, 40] }));
    await settle();
    expect(view.container.textContent).toContain('the dataset has no height here');
  });
});
