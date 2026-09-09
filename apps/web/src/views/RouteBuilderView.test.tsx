// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  RoutingError,
} from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, type RouteDraft } from '../routing/draft';
import type { DraftStorage } from '../routing/draft-storage';
import { scriptedProvider, type ScriptedProvider } from '../routing/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { NUDGE_DEGREES, RouteBuilderView } from './RouteBuilderView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * A draft store that lives in a closure.
 *
 * ⚠️ **Every test gets its own, and that is not tidiness.** With no `storage`
 * prop the screen reaches for the browser's `localStorage`, which jsdom keeps
 * for the whole FILE — so one test's waypoints turn up in the next one's
 * assertions and a test that placed three finds eleven. That is the shape
 * `CLAUDE.md` §5 calls the wrong harness, arriving through a global.
 */
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

async function open(
  options: {
    provider?: ScriptedProvider | undefined;
    storage?: DraftStorage | undefined;
  } = {},
): Promise<Mounted> {
  // ⚠️ Unmount whatever is already up. `mount` attaches its container to
  // `document.body`, so a second mount inside one test leaves two builders in
  // the document and `document.querySelector` then finds the first one's
  // controls while the assertions read the second one's container. That is a
  // test reading a screen nobody pressed anything on.
  mounted?.unmount();
  mounted = await mount(
    <main>
      <h1>Draw a route</h1>
      <RouteBuilderView
        provider={options.provider}
        storage={options.storage ?? isolatedStorage()}
      />
    </main>,
  );
  await settle();
  return mounted;
}

/** Buttons of the mounted builder, never of the whole document. See `open`. */
function buttons(): HTMLButtonElement[] {
  if (mounted === undefined) throw new Error('nothing is mounted');
  return queryAll<HTMLButtonElement>(mounted.container, 'button');
}

function buttonNamed(label: string): HTMLButtonElement {
  const found = buttons().find((button) => button.textContent?.trim() === label);
  if (found === undefined) {
    throw new Error(
      `no button labelled "${label}". Present: ${buttons()
        .map((button) => button.textContent?.trim())
        .join(' | ')}`,
    );
  }
  return found;
}

function present(label: string): boolean {
  return buttons().some((button) => button.textContent?.trim() === label);
}

async function press(label: string): Promise<void> {
  await activateWithKeyboard(buttonNamed(label));
  await settle();
}

async function place(times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) await press('Add a waypoint');
}

describe('every control works from the keyboard', () => {
  it('places waypoints', async () => {
    // ⚠️ #71's eighth criterion. `activateWithKeyboard` refuses to activate
    // anything it cannot focus first, which is what makes this more than a
    // click in disguise.
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    expect(view.container.textContent).toContain('Waypoint 3');
  });

  it('selects one, and says which is selected in words', async () => {
    await open({ provider: scriptedProvider() });
    await place(2);
    await press('Waypoint 1');
    expect(present('Waypoint 1, selected')).toBe(true);
    // Selection is not colour: the label itself changes, which is the only
    // channel a screen reader has.
    await press('Waypoint 1, selected');
    expect(present('Waypoint 1')).toBe(true);
  });

  it('moves one in each of the four directions', async () => {
    const provider = scriptedProvider();
    await open({ provider });
    await place(2);
    provider.routeCalls.length = 0;
    for (const direction of ['north', 'south', 'east', 'west']) {
      await press(`Move waypoint 1 ${direction}`);
    }
    // Four moves of the end waypoint, one adjacent leg each.
    expect(provider.routeCalls).toHaveLength(4);
  });

  it('nudges by a stated distance rather than by a pixel', async () => {
    const provider = scriptedProvider();
    await open({ provider });
    await place(2);
    provider.routeCalls.length = 0;
    await press('Move waypoint 1 north');
    const moved = provider.routeCalls[0]?.waypoints[0]?.position.latitude ?? 0;
    expect(moved).toBeCloseTo(51.5 + NUDGE_DEGREES, 6);
  });

  it('deletes one', async () => {
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    await press('Delete waypoint 2');
    expect(view.container.textContent).not.toContain('Waypoint 3');
  });
});

describe('a control that cannot act is absent, not disabled', () => {
  it('renders no disabled control anywhere', async () => {
    // `design/Button.tsx`'s rule: a disabled button leaves the tab order, so a
    // keyboard user never reaches it and never hears why.
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    await press('Clear');
    expect(view.container.querySelectorAll('button[disabled]')).toHaveLength(0);
  });

  it('offers no undo before anything has been done', async () => {
    await open({ provider: scriptedProvider() });
    expect(present('Undo')).toBe(false);
    await place(1);
    expect(present('Undo')).toBe(true);
  });

  it('offers no reverse until there is a route to reverse', async () => {
    await open({ provider: scriptedProvider() });
    await place(1);
    expect(present('Reverse')).toBe(false);
    await place(1);
    expect(present('Reverse')).toBe(true);
  });
});

describe('clearing asks first', () => {
  it('does not clear on the first press', async () => {
    // ⚠️ #71: "an unconfirmed clear that destroys an hour of planning is the
    // single most expensive UI mistake available here."
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    await press('Clear');
    expect(view.container.textContent).toContain('Waypoint 3');
    expect(view.container.textContent).toContain('Clear the whole route?');
  });

  it('clears when the confirmation is taken', async () => {
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    await press('Clear');
    await press('Yes, clear the route');
    expect(view.container.textContent).toContain('No waypoints yet');
  });

  it('keeps the route when the confirmation is refused', async () => {
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    await press('Clear');
    await press('Keep the route');
    expect(view.container.textContent).toContain('Waypoint 3');
  });

  it('leaves a cleared route recoverable with undo', async () => {
    const view = await open({ provider: scriptedProvider() });
    await place(3);
    await press('Clear');
    await press('Yes, clear the route');
    await press('Undo');
    expect(view.container.textContent).toContain('Waypoint 3');
  });
});

describe('a half-drawn route survives a reload', () => {
  it('comes back with its waypoints', async () => {
    // ⚠️ #71's seventh criterion: "a test reloads mid-draw and asserts the
    // waypoints are still there". Unmounting and mounting again IS the reload
    // this screen can be given — the state that survives is whatever reached
    // storage, which is the thing under test.
    const held = { current: undefined as RouteDraft | undefined };
    const storage: DraftStorage = {
      read: () => held.current,
      write: (draft) => {
        held.current = draft;
      },
      forget: () => {
        held.current = undefined;
      },
    };
    await open({ provider: scriptedProvider(), storage });
    await place(3);
    mounted?.unmount();

    const second = await open({ provider: scriptedProvider(), storage });
    expect(second.container.textContent).toContain('Waypoint 3');
  });

  it('routes the restored legs again rather than showing them empty', async () => {
    const held = { current: undefined as RouteDraft | undefined };
    const storage: DraftStorage = {
      read: () => held.current,
      write: (draft) => {
        held.current = draft;
      },
      forget: () => {
        held.current = undefined;
      },
    };
    held.current = addWaypoint(
      addWaypoint(emptyDraft(), geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)))
        .draft,
      geographicPosition(degreesLatitude(51.51), degreesLongitude(-0.12)),
    ).draft;

    const provider = scriptedProvider();
    await open({ provider, storage });
    await settle();
    expect(provider.routeCalls).toHaveLength(1);
  });

  it('does not let a slow restore overwrite an edit made while it was in flight', async () => {
    // ⚠️ **Found by review, and it had no test at all.** The restore effect
    // settles the draft it was started for; without the guard `apply` uses, an
    // edit made in the meantime is silently replaced by the PRE-EDIT draft —
    // and `history` keeps the edit, so undo and the screen then disagree about
    // what the route is.
    const held = { current: undefined as RouteDraft | undefined };
    const storage: DraftStorage = {
      read: () => held.current,
      write: (draft) => {
        held.current = draft;
      },
      forget: () => {
        held.current = undefined;
      },
    };
    held.current = addWaypoint(
      addWaypoint(emptyDraft(), geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)))
        .draft,
      geographicPosition(degreesLatitude(51.51), degreesLongitude(-0.12)),
    ).draft;

    // ⚠️ A provider that answers only when this test says so, **collecting one
    // resolver per call**. A single `release` variable is not enough and was
    // the first version's flaw: the edit below issues its own routing call,
    // which overwrites the handle, so releasing it left the *restore's* promise
    // pending for ever and the mutation this test exists for stayed green.
    const releases: (() => void)[] = [];
    const slow = scriptedProvider();
    const provider: ScriptedProvider = {
      ...slow,
      route: async (request) =>
        new Promise((resolve) => {
          releases.push(() => {
            resolve(slow.route(request));
          });
        }),
    };

    const view = await open({ provider, storage });
    expect(releases).toHaveLength(1); // the restore is outstanding
    // Draw a third waypoint on top of it.
    await press('Add a waypoint');
    expect(view.container.textContent).toContain('Waypoint 3');

    // Release the RESTORE, which is the one carrying the pre-edit draft.
    releases[0]?.();
    await settle();
    await settle();

    // The edit survives, and the screen and the history still agree — undo
    // takes the third waypoint away rather than doing nothing.
    expect(view.container.textContent).toContain('Waypoint 3');
    await press('Undo');
    expect(view.container.textContent).not.toContain('Waypoint 3');
  });

  it('forgets an emptied route rather than restoring an empty one forever', async () => {
    const held = { current: undefined as RouteDraft | undefined };
    const storage: DraftStorage = {
      read: () => held.current,
      write: (draft) => {
        held.current = draft;
      },
      forget: () => {
        held.current = undefined;
      },
    };
    await open({ provider: scriptedProvider(), storage });
    await place(2);
    await press('Clear');
    await press('Yes, clear the route');
    expect(held.current).toBeUndefined();
  });
});

describe('what the screen says when a leg has no route', () => {
  it('names the failure on that leg and leaves the others alone', async () => {
    const provider = scriptedProvider();
    const view = await open({ provider });
    await place(3);
    provider.failNextRoute(new RoutingError('no-route', 'No path between these two points.', 1));
    await press('Move waypoint 3 north');
    expect(view.container.textContent).toContain('No path between these two points.');
    expect(view.container.textContent).toContain('legs have no route');
  });

  it('says when a failure is worth trying again', async () => {
    const provider = scriptedProvider();
    const view = await open({ provider });
    await place(2);
    provider.failNextRoute(new RoutingError('unavailable', 'The service did not answer in time.'));
    await press('Move waypoint 2 north');
    expect(view.container.textContent).toContain('worth trying again');
  });

  it('explains itself when there is no routing service at all', async () => {
    // ⚠️ The state the whole product is in today. A screen that rendered
    // controls and quietly produced nothing would read as broken.
    const view = await open({});
    expect(view.container.textContent).toContain('No routing service');
    await place(2);
    expect(view.container.textContent).toContain('Waypoint 2');
  });
});

describe('legs, surfaces and the settings that decide them', () => {
  it('turns a leg freehand and back, and says which it is', async () => {
    const provider = scriptedProvider();
    const view = await open({ provider });
    await place(2);
    expect(view.container.textContent).toContain('Following roads');
    await press('Draw leg 1 freehand');
    expect(view.container.textContent).toContain('Freehand');
    provider.routeCalls.length = 0;
    await press('Follow roads on leg 1');
    expect(provider.routeCalls).toHaveLength(1);
  });

  it('never calls an unknown surface paved', async () => {
    const view = await open({ provider: scriptedProvider({ surface: 'unknown' }) });
    await place(2);
    expect(view.container.textContent).toContain('Unknown');
  });

  it('warns before a rider picks the setting that can strand them', async () => {
    // ⚠️ #70: at its strictest the engine refuses a route whose endpoints are
    // unpaved — "a silent no-route is the failure being prevented".
    const view = await open({ provider: scriptedProvider() });
    const select = view.container.querySelector('select');
    expect(select).not.toBeNull();
    expect(view.container.textContent).not.toContain('including your own driveway');
    const { chooseOption } = await import('../testing/mount');
    await chooseOption(select as HTMLSelectElement, 'paved-only');
    await settle();
    expect(view.container.textContent).toContain('including your own driveway');
  });
});

describe('the profile', () => {
  it('names the dataset, the resolution and the interval', async () => {
    const view = await open({ provider: scriptedProvider({ heights: [10, 20, 30] }) });
    await place(3);
    await settle();
    expect(view.container.textContent).toContain('Copernicus DEM GLO-30');
    expect(view.container.textContent).toContain('sampled every 30 m');
  });

  it('says nothing about elevation before there is a route', async () => {
    const view = await open({ provider: scriptedProvider() });
    expect(view.container.textContent).toContain('No elevation profile yet');
  });

  it('names every gradient band in the table caption, so colour carries nothing', async () => {
    const view = await open({ provider: scriptedProvider({ heights: [10, 40, 12, 60] }) });
    await place(3);
    await settle();
    expect(view.container.textContent).toContain('Steep climb');
  });
});
