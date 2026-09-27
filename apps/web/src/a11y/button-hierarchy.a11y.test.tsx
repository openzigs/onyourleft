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
 * 2. Across the walk, buttons and primaries must both have been seen. A client
 *    whose buttons all disappeared would otherwise pass every route.
 * 3. The control: a view with two primaries, rendered with the real `Button`,
 *    must be reported.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';
import { recordingSessionId } from '@onyourleft/store';

import { Button } from '../design/Button';
import type { RideController, RideSnapshot } from '../ride/controller';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { ALL_ROUTES, hrefFor, routeById, type RouteDefinition } from '../shell/routes';
import { mount, settle, type Mounted } from '../testing/mount';
import { PARAMETERS, POPULATED, PopulatedShell } from '../testing/populated-shell';

import { buttonsByView, onePrimaryViolations } from './button-hierarchy';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function hashFor(route: RouteDefinition): string {
  if (!route.path.split('/').some((segment) => segment.startsWith(':'))) {
    return hrefFor(route);
  }
  const parameter = PARAMETERS[route.id];
  if (parameter === undefined) {
    throw new Error(`${route.id} is parameterised and populated-shell.tsx names no fixture id`);
  }
  return hrefFor(route, parameter);
}

/** Settle until the page stops changing, because every view reads a port. */
async function settled(): Promise<void> {
  let before = '';
  for (let round = 0; round < 40; round += 1) {
    await settle();
    const now = document.body.innerHTML;
    if (now === before) return;
    before = now;
  }
}

async function open(
  route: RouteDefinition,
  populated: boolean,
  rideController?: RideController,
): Promise<void> {
  globalThis.location.hash = hashFor(route);
  mounted = await mount(
    <PopulatedShell
      populated={populated}
      {...(rideController === undefined ? {} : { rideController })}
    />,
  );
  await settled();
}

const seen = { buttons: 0, primaries: 0 };

describe('#668 — at most one primary button per view, on every route', () => {
  for (const data of ['empty', 'populated'] as const) {
    for (const route of ALL_ROUTES) {
      it(`${route.id} (${route.path}), ${data}`, async () => {
        await open(route, data === 'populated');
        expect(document.querySelector('h1')?.textContent).toBe(route.title);

        const expectation = POPULATED[route.id];
        if (expectation.kind === 'fixture') {
          expect(
            document.querySelector(expectation.marker) !== null,
            `${route.id}: the fixture marker ${expectation.marker} should be ` +
              (data === 'populated' ? 'present' : 'absent'),
          ).toBe(data === 'populated');
        }

        const views = buttonsByView(document);
        expect(views, 'the shell renders exactly one main').toHaveLength(1);
        for (const view of views) {
          seen.buttons += view.buttons;
          seen.primaries += view.primaries.length;
        }
        expect(onePrimaryViolations(document), `${route.id}, ${data}`).toEqual([]);
      });
    }
  }

  it('saw buttons and primaries on the walk, so the loop above counted something', () => {
    // ⚠️ Runs after the loop in file order, which Vitest keeps within a file.
    expect(seen.buttons, 'no route rendered a single .oyl-button').toBeGreaterThan(0);
    expect(seen.primaries, 'no route rendered a primary button at all').toBeGreaterThan(0);
  });
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
  ] as const;
  for (const [id, label] of cases) {
    it(`${id}: “${label}”`, async () => {
      await open(routeById(id), false);
      const control = [...document.querySelectorAll('main a, main button')].find(
        (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() === label,
      );
      expect(control, `no control named “${label}” on ${id}`).toBeDefined();
      expect(control?.classList.contains('oyl-button'), control?.outerHTML).toBe(true);
    });
  }
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

  it('counts a link drawn as a button, and not a secondary or a toggle', async () => {
    mounted = await mount(
      <main>
        <Button>Start recording</Button>
        <a className="oyl-button" href="#/routes">
          Import a GPX file
        </a>
        <Button variant="secondary">Pause</Button>
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
