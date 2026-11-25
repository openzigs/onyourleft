// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The planner's profile chart throwing — #3185.
 *
 * The chart is the enhancement and the gradient table is the base case
 * (`design/ChartSlot.tsx`): a chart that throws must leave the table, open,
 * and the rest of the planner standing. A separate file because the chart is
 * replaced for the whole module.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RouteDraft } from '../routing/draft';
import { scriptedProvider } from '../routing/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GRADIENT_TABLE_SUMMARY, RouteBuilderView } from './RouteBuilderView';

vi.mock('../routing/ProfileChart', () => ({
  ProfileChart: () => {
    throw new Error('the chart broke');
  },
}));

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
});

describe('a profile chart that throws (#3185)', () => {
  it('leaves the gradient table, open, and the planner standing', async () => {
    // React reports a caught render error on the console; it is the expected one here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let held: RouteDraft | undefined;
    mounted = await mount(
      <main>
        <h1>Draw a route</h1>
        <RouteBuilderView
          provider={scriptedProvider({ heights: [10, 40, 12, 60] })}
          storage={{
            read: () => held,
            write: (draft) => {
              held = draft;
            },
            forget: () => {
              held = undefined;
            },
          }}
        />
      </main>,
    );
    await settle();
    const add = queryAll<HTMLButtonElement>(mounted.container, 'button').find(
      (button) => button.textContent?.trim() === 'Add a waypoint',
    );
    if (add === undefined) throw new Error('no Add a waypoint');
    for (let index = 0; index < 3; index += 1) {
      await activateWithKeyboard(add);
      await settle();
    }
    await settle();
    const gradient = [...mounted.container.querySelectorAll('caption')].find((caption) =>
      caption.textContent?.includes('The gradient along the route'),
    );
    expect(gradient).toBeDefined();
    // Not inside a closed disclosure: the table is the whole profile now.
    expect(gradient?.closest('details')).toBeNull();
    expect(mounted.container.textContent).not.toContain(GRADIENT_TABLE_SUMMARY);
    // The rest of the planner is still there.
    expect(mounted.container.textContent).toContain('Waypoint 3');
    expect(mounted.container.textContent).toContain('Copernicus DEM GLO-30');
  });
});
