// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The open-world start picker in the accessibility gate — #2889, §4e.
 *
 * The whole flow by keyboard alone: drop the pin where the map is looking,
 * nudge it, or choose a saved route or a past ride instead, and start. Each
 * state is audited, and every control the flow needs is a tab stop with a
 * name. Through a `main` with an `h1`, for `RouteBuilder.a11y.test.tsx`'s
 * reason: the shell draws both, and the audit walks the document.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import { createOpenWorldEntry } from '../game/open-world/entry';
import { openWorldStartPort } from '../game/open-world/start-port';
import { ME, tilesPreference, twoAthletesStore } from '../game/open-world/start-testing';
import { OSM_ATTRIBUTION } from '../map/basemap';
import { stubMapPort } from '../map/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { OpenWorldStartView } from './OpenWorldStartView';

const BASEMAP = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(options: { tiles?: boolean; port?: boolean } = {}): Promise<Mounted> {
  const engine = stubMapPort();
  mounted = await mount(
    <main>
      <h1>Open world: choose a start</h1>
      <OpenWorldStartView
        port={
          options.port === false
            ? undefined
            : openWorldStartPort({
                store: twoAthletesStore(),
                owner: ME,
                entry: createOpenWorldEntry(),
                opened: () => undefined,
              })
        }
        map={() => Promise.resolve(engine)}
        basemap={BASEMAP}
        preferences={tilesPreference(options.tiles ?? true)}
      />
    </main>,
  );
  await settle();
  await settle();
  return mounted;
}

function tabStop(view: Mounted, name: string): HTMLElement {
  const found = tabbableElements(view.container).find(
    (element) => accessibleName(element).trim() === name,
  );
  if (found === undefined) throw new Error(`no tab stop named "${name}"`);
  return found;
}

function rideStop(view: Mounted, name: string): HTMLElement {
  const found = tabbableElements(view.container).find((element) =>
    accessibleName(element).startsWith(`${name},`),
  );
  if (found === undefined) throw new Error(`no tab stop for the ride "${name}"`);
  return found;
}

describe('the open-world start picker is inside the accessibility gate — #2889', () => {
  it('audits clean as it opens', async () => {
    await open();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('places and nudges the pin from the tab order, and audits clean with it placed', async () => {
    const view = await open();
    await activateWithKeyboard(tabStop(view, 'Put the pin at the map’s centre'));
    for (const direction of ['north', 'south', 'east', 'west']) {
      await activateWithKeyboard(tabStop(view, `Move the pin ${direction}`));
    }
    expect(tabStop(view, 'Start the ride')).toBeDefined();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('chooses a saved route or a past ride from the tab order, each a toggle that says it is chosen', async () => {
    const view = await open();
    const loop = tabStop(view, 'Lookout loop');
    await activateWithKeyboard(loop);
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    const spin = rideStop(view, 'Morning spin');
    await activateWithKeyboard(spin);
    await settle();
    expect(spin.getAttribute('aria-pressed')).toBe('true');
    expect(loop.getAttribute('aria-pressed')).toBe('false');
    expect(tabStop(view, 'Start the ride')).toBeDefined();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says a refusal in the status region, and audits clean', async () => {
    const view = await open();
    await activateWithKeyboard(rideStop(view, 'Thames path'));
    await settle();
    const status = view.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('outside the map');
    expect(queryAll(view.container, 'button').map((each) => each.textContent)).not.toContain(
      'Start the ride',
    );
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with map tiles off, and with no store to read', async () => {
    await open({ tiles: false });
    expect(formatViolations(auditAccessibility(document))).toBe('');
    mounted?.unmount();
    await open({ port: false });
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
