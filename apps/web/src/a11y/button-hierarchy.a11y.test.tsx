// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * One primary per view, as a gate — #668's third criterion.
 *
 * Every route in `shell/routes.ts` §`ALL_ROUTES` — the table, never a hand
 * list (#142) — is rendered through the real `AppShell` over BOTH of
 * `testing/populated-shell.tsx`'s fixtures, the one the reflow walk (#660)
 * lays out, and each `main` may hold at most one `.oyl-button` that is neither
 * secondary nor a toggle.
 *
 * ## Why both fixtures
 *
 * The populated one is where a view's rows carry their own buttons — a delete
 * per ride, an edit per route — and so where a row's default `variant` puts
 * forty primaries on one screen. The empty one is where the next step is the
 * only thing on the page, and where #668's fifth criterion puts a button that
 * used to be a sentence link. Either alone leaves half the states unchecked.
 *
 * ## What stops it passing over nothing
 *
 * 1. Each populated route with a `fixture` expectation must show its marker,
 *    and must NOT show it empty — the reflow harness's own rule, so a fixture
 *    that stopped reaching its view fails here rather than being counted twice
 *    as an empty page.
 * 2. Somewhere on the walk, buttons and a primary must both be seen — its own
 *    walk, so it holds under any order or filter. A client whose buttons all
 *    disappeared would otherwise pass every route.
 * 3. The control: `button-hierarchy.control.a11y.test.tsx` gives a route of
 *    the real table a view drawing two primaries, walks it through the same
 *    `testing/hierarchy-walk.tsx` §`walkRoute` every route here goes through,
 *    and requires it to be reported. The bare `main`s at the end of this file
 *    pin the counting rule itself.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';

import { unixSeconds } from '@onyourleft/domain';
import { recordingSessionId } from '@onyourleft/store';

import { Button } from '../design/Button';
import type { RideController, RideSnapshot } from '../ride/controller';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { ALL_ROUTES, routeById, type RouteDefinition } from '../shell/routes';
import { openRoute, selectFixtureItem, walkRoute } from '../testing/hierarchy-walk';
import { answerTwoPanes } from '../testing/panes';
import { mount, settle, type Mounted } from '../testing/mount';
import { ActivitiesView } from '../views/ActivitiesView';

import { buttonsByView, onePrimaryViolations, primaryUnits } from './button-hierarchy';

// `join` rather than `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const THEME = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../design/theme.css'),
  'utf8',
);

let mounted: Mounted | undefined;
let restorePanes: (() => void) | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  restorePanes?.();
  restorePanes = undefined;
  globalThis.location.hash = '';
});

async function open(
  route: RouteDefinition,
  populated: boolean,
  rideController?: RideController,
): Promise<void> {
  mounted = await openRoute(route, populated, rideController);
}

describe('#668 — at most one primary button per view, on every route', () => {
  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      it(`${route.id} (${route.path}), ${data}`, async () => {
        const walked = await walkRoute(route, data === 'populated');
        mounted = walked.mounted;
        expect(walked.violations, `${route.id}, ${data}`).toEqual([]);
      });
    }
  }

  it('finds buttons and a primary somewhere on the walk, so the loop above counts something', async () => {
    // Its own walk rather than a tally the cases above leave behind, so it
    // holds whatever order the cases run in and whichever of them a filter
    // selects. It stops at the first route that shows both, so a green run
    // costs a route or two; a client whose buttons all disappeared walks
    // every route and fails.
    let buttons = 0;
    let primaries = 0;
    for (const route of ALL_ROUTES) {
      const walked = await walkRoute(route, true);
      walked.mounted.unmount();
      for (const view of walked.views) {
        buttons += view.buttons;
        primaries += view.primaries.length;
      }
      if (buttons > 0 && primaries > 0) break;
    }
    expect(buttons, 'no route rendered a single .oyl-button').toBeGreaterThan(0);
    expect(primaries, 'no route rendered a primary button at all').toBeGreaterThan(0);
  });
});

/**
 * #939: Home is where a ride starts, so its one primary is not optional —
 * EXACTLY one, *Start a ride* on the Free ride card, over both fixtures, and
 * the other two ride cards secondary.
 */
describe('#939 — Home has exactly one primary', () => {
  for (const data of ['empty', 'populated'] as const) {
    it(data, async () => {
      await open(routeById('home'), data === 'populated');
      const primaries = buttonsByView(document)[0]?.primaries ?? [];
      expect(primaries.map((element) => (element.textContent ?? '').trim())).toEqual([
        'Start a ride',
      ]);
      for (const label of ['Choose a route', 'Choose a workout']) {
        const link = [...document.querySelectorAll('main a.oyl-button')].find(
          (element) => (element.textContent ?? '').trim() === label,
        );
        expect(link?.classList.contains('oyl-button--secondary'), label).toBe(true);
      }
    });
  }
});

/**
 * The ride screen in the states neither fixture reaches.
 *
 * The walk above sees the ride screen idle and mid-ride. These are the states
 * where its panels' buttons MEET its own: a paused ride whose stop is armed
 * (Resume and the confirmation), and an idle one with a trainer under control,
 * a saved workout and a ride left over from a closed tab — which before #668
 * put *Start recording*, *Set target*, a *Start* per workout and a
 * *Continue* / *Save* / *Discard* per leftover on one screen, every one of
 * them filled.
 */
describe('#668 — the ride screen, in the states where its panels meet', () => {
  const leftover = {
    id: recordingSessionId('left-over'),
    kind: 'interrupted' as const,
    startedAt: unixSeconds(1_760_000_000),
    lastWrittenAt: unixSeconds(1_760_000_600),
    spannedSeconds: 600,
    spanned: '10:00',
    canContinue: true,
    alreadySaved: false,
  };
  const states: readonly (readonly [string, RideSnapshot])[] = [
    [
      'idle, with a trainer under control and a ride left over',
      { ...idleSnapshot(), trainer: ridingSnapshot().trainer, recoverable: [leftover] },
    ],
    ['recording, with the stop armed', { ...ridingSnapshot(), stopArmed: true }],
    ['paused, with the stop armed', { ...ridingSnapshot(), phase: 'paused', stopArmed: true }],
    ['paused', { ...ridingSnapshot(), phase: 'paused' }],
    ['stopped, and ready for another ride', { ...ridingSnapshot(), phase: 'stopped' }],
  ];
  for (const [name, snapshot] of states) {
    it(name, async () => {
      await open(routeById('ride'), true, stubRideController(snapshot).controller);
      const views = buttonsByView(document);
      expect(views[0]?.buttons, 'the ride screen rendered no buttons').toBeGreaterThan(1);
      expect(views[0]?.primaries, 'the ride screen has no primary at all').toHaveLength(1);
      expect(onePrimaryViolations(document), name).toEqual([]);
    });
  }
});

/**
 * #668's fifth criterion: an empty state whose next step is an action offers
 * it as a button, not a link in a sentence.
 */
describe('#668 — an empty state offers its next step as a button', () => {
  const cases = [
    ['routes', 'Draw a route on this device'],
    ['game', 'Import a GPX file on the Routes screen'],
    ['game', 'Draw one on this device'],
    ['activities', 'Start a ride'],
    ['activities', 'Import or export files'],
  ] as const;
  for (const [id, label] of cases) {
    it(`${id}: “${label}”`, async () => {
      await open(routeById(id), false);
      const control = [...document.querySelectorAll('main a, main button')].find(
        (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() === label,
      );
      expect(control, `no control named “${label}” on ${id}`).toBeDefined();
      expect(control?.classList.contains('oyl-button'), control?.outerHTML).toBe(true);
      expect(onePrimaryViolations(document)).toEqual([]);
    });
  }

  it('activities with no local store: “Start a ride” is the one primary, and importing is secondary', async () => {
    // The walk hands every route a store, so the no-store branch is mounted
    // on its own, inside a `main` as the shell would put it.
    mounted = await mount(
      <main>
        <ActivitiesView />
      </main>,
    );
    await settle();
    expect(document.body.textContent).toContain('No local store on this browser');
    const named = (label: string): Element | undefined =>
      [...document.querySelectorAll('main a')].find(
        (element) => (element.textContent ?? '').trim() === label,
      );
    expect(buttonsByView(document)[0]?.primaries).toEqual([named('Start a ride')]);
    expect(named('Import or export files')?.classList.contains('oyl-button--secondary')).toBe(true);
  });
});

/**
 * #670: on a list–detail route the rule is per pane. Every such route of the
 * table, over the populated fixture with its item selected, at both widths.
 */
describe('#670 — one primary per pane on a list–detail route', () => {
  const listDetail = ALL_ROUTES.filter((route) => route.layout === 'list-detail');

  it('has list–detail routes to walk', () => {
    expect(listDetail.map((route) => route.id).sort()).toEqual([
      'activities',
      'routes',
      'workouts',
    ]);
  });

  for (const route of listDetail) {
    for (const wide of [false, true]) {
      it(`${route.id}, an item selected, ${wide ? 'two panes' : 'one pane'}`, async () => {
        restorePanes = answerTwoPanes(wide, THEME);
        mounted = await openRoute(route, true);
        expect(await selectFixtureItem(route)).toBe(true);
        expect(document.querySelector('[data-oyl-panes]')?.getAttribute('data-oyl-panes')).toBe(
          wide ? '2' : '1',
        );
        expect(onePrimaryViolations(document), `${route.id}`).toEqual([]);
      });
    }
  }

  // #723: nothing chosen as well — at one pane that is where both panes are on
  // the page at once (the Workouts builder under its list), so it is the state
  // the whole-view count at one pane actually has something to count in.
  for (const route of listDetail) {
    for (const wide of [false, true]) {
      it(`${route.id}, nothing selected, ${wide ? 'two panes' : 'one pane'}`, async () => {
        restorePanes = answerTwoPanes(wide, THEME);
        mounted = await openRoute(route, true);
        expect(document.querySelector('[data-oyl-panes]')?.getAttribute('data-oyl-panes')).toBe(
          wide ? '2' : '1',
        );
        expect(onePrimaryViolations(document), `${route.id}`).toEqual([]);
      });
    }
  }

  it('is what lets Activities show two primaries at once — one per pane', async () => {
    // Without the per-pane rule this screen would be a violation: the list's
    // *Start a ride* and the selected ride's *Open ride details* are both on
    // a landscape tablet. So the whole-main count is 2, and it passes.
    restorePanes = answerTwoPanes(true, THEME);
    mounted = await openRoute(routeById('activities'), true);
    await selectFixtureItem(routeById('activities'));
    expect(buttonsByView(document)[0]?.primaries).toHaveLength(2);
    expect(primaryUnits(document).map((unit) => unit.primaries.length)).toEqual([0, 1, 1]);
    expect(onePrimaryViolations(document)).toEqual([]);
  });

  it('the control — the same panes in a main that is not list–detail are one view', async () => {
    mounted = await mount(
      <main className="oyl-main oyl-main--prose">
        <section data-oyl-pane="list">
          <Button>Start a ride</Button>
        </section>
        <section data-oyl-pane="detail">
          <Button>Open ride details</Button>
        </section>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view: “Start a ride”, “Open ride details”',
    ]);
  });

  it('the control — two primaries in ONE pane are still reported, and the pane is named', async () => {
    mounted = await mount(
      <main className="oyl-main oyl-main--list-detail">
        <div data-oyl-panes="2">
          <section data-oyl-pane="list">
            <Button>Start a ride</Button>
            <Button>Import route</Button>
          </section>
          <section data-oyl-pane="detail">
            <Button>Open ride details</Button>
          </section>
        </div>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view (main, list pane): “Start a ride”, “Import route”',
    ]);
  });

  it('the control — a primary outside the panes counts against the rest of main', async () => {
    mounted = await mount(
      <main className="oyl-main oyl-main--list-detail">
        <Button>Save everything</Button>
        <Button>Save it all again</Button>
        <div data-oyl-panes="2">
          <section data-oyl-pane="list">
            <Button>Start a ride</Button>
          </section>
        </div>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view (main, outside its panes): “Save everything”, “Save it all again”',
    ]);
  });
});

/**
 * #723: below the breakpoint the panes are stacked and a phone scrolls them as
 * ONE view, so the per-pane rule applies only at two panes.
 */
describe('#723 — at one pane, the panes are one view', () => {
  /** The same two panes, one primary in each, under a layout of `panes` panes. */
  function splitPrimaries(panes: '1' | '2', listHidden = false): JSX.Element {
    return (
      <main className="oyl-main oyl-main--list-detail">
        <div data-oyl-panes={panes}>
          <section data-oyl-pane="list" hidden={listHidden}>
            <Button>Build a workout</Button>
          </section>
          <section data-oyl-pane="detail">
            <Button>Save workout</Button>
          </section>
        </div>
      </main>
    );
  }

  it('the control — two primaries split across the panes of ONE pane are reported', async () => {
    mounted = await mount(splitPrimaries('1'));
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view: “Build a workout”, “Save workout”',
    ]);
  });

  it('the same markup at two panes passes — which is all the per-pane rule ever asked, at any width', async () => {
    // What #670's rule said of the fixture above: one primary per pane, so no
    // finding. Counting per pane regardless of width is the rule this control
    // exists to catch coming back.
    mounted = await mount(splitPrimaries('2'));
    expect(primaryUnits(document).map((unit) => unit.primaries.length)).toEqual([0, 1, 1]);
    expect(onePrimaryViolations(document)).toEqual([]);
  });

  it('leaves a pane the layout has hidden out of the one view', async () => {
    // One pane with an item chosen: the list is hidden, and its primary is not
    // on the page a rider scrolls.
    mounted = await mount(splitPrimaries('1', true));
    expect(primaryUnits(document).map((unit) => unit.primaries.length)).toEqual([1]);
    expect(onePrimaryViolations(document)).toEqual([]);
  });

  it('fails closed — a list–detail main that does not say how many panes it has is one view', async () => {
    mounted = await mount(
      <main className="oyl-main oyl-main--list-detail">
        <section data-oyl-pane="list">
          <Button>Build a workout</Button>
        </section>
        <section data-oyl-pane="detail">
          <Button>Save workout</Button>
        </section>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view: “Build a workout”, “Save workout”',
    ]);
  });
});

describe('the control — a view with two primaries is reported', () => {
  it('reports both primaries in one main, by name', async () => {
    mounted = await mount(
      <main>
        <Button>Start recording</Button>
        <Button>Import route</Button>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view: “Start recording”, “Import route”',
    ]);
  });

  it('counts a link drawn as a button, and not a secondary, a tertiary or a toggle', async () => {
    mounted = await mount(
      <main>
        <Button>Start recording</Button>
        <a className="oyl-button" href="#/routes">
          Import a GPX file
        </a>
        <Button variant="secondary">Pause</Button>
        <Button variant="tertiary">Keep the ride</Button>
        <Button variant="toggle" pressed={false}>
          Mute sounds
        </Button>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([
      '2 primary buttons in one view: “Start recording”, “Import a GPX file”',
    ]);
  });

  it('lets one primary beside any number of secondaries and toggles through', async () => {
    mounted = await mount(
      <main>
        <Button>Start recording</Button>
        <Button variant="secondary">Pause</Button>
        <Button variant="secondary">Stop</Button>
        <Button variant="toggle" pressed>
          Mute sounds
        </Button>
      </main>,
    );
    expect(onePrimaryViolations(document)).toEqual([]);
  });
});
