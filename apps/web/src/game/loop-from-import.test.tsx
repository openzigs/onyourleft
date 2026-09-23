// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A rider rides a lap of a route they imported — #296's fourth criterion.
 *
 * ## What this is for, and why every other test on this path passes without it
 *
 * Three shipped features read `RouteProfile.loop`: #253's road markers that wrap
 * past the finish line, #285's `on lap 2` on the plan view, and #287's `25% of
 * lap 2` under the elevation strip. All three have tests. All three tests build
 * their own `routeProfile(points, { loop: true })` fixture — which is correct
 * unit testing, and is exactly why not one of them noticed that **no route a
 * rider could create was ever a loop**. The flag had no producer.
 *
 * So nothing here constructs a profile. The route is built by the same code a
 * submitted import form runs, written to a real IndexedDB, and read back on a
 * connection that never saw it written — and only then handed to the screen.
 * If any link in that chain drops the flag, the lap wording below never appears.
 *
 * ⚠️ **It rides a whole lap rather than asserting on the profile**, because the
 * wording is what a rider actually gets and it is produced three layers above
 * the flag: `plan.ts` §`planLap` decides it, `fields.ts` §`profileReading` says
 * it under the strip, and `describePlan` says it to a screen reader. A test that
 * stopped at `profile.loop === true` would be the fourth one to pass over a
 * dormant feature.
 *
 * ⚠️ `requestAnimationFrame` is pumped by hand with the clock advanced
 * explicitly, for the reason `GameView.test.tsx` gives: jsdom's own rAF fires on
 * a real timer, so a test that waited for it would assert against however many
 * frames the machine happened to deliver.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { unixSeconds, watts } from '@onyourleft/domain';
import { routeId, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { GameView, type GamePort } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { LOOP_FIELD, routeFromImportForm } from '../routes/import-form';
import { loopGpx } from '../routes/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

/**
 * How long the imported circuit is, in metres.
 *
 * Short deliberately: a lap has to be completed and a second one begun inside
 * frames that are pumped one at a time, and 300 m at a steady 200-odd watts is
 * about half a minute of riding.
 */
const LAP_METRES = 300;

const ID = routeId('imported-loop');

let harness: StoreHarness | undefined;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 3_000_000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  await harness?.destroy();
  harness = undefined;
});

/**
 * The route a rider would have after importing a circuit with the loop box
 * ticked: through the form reader, through `putRoute`, and back out of a fresh
 * connection.
 */
async function importedRoute(loop: boolean): Promise<RouteRecord> {
  const open = createStoreHarness();
  await seedAthletes(open);
  harness = open;

  const form = new FormData();
  form.set('file', new File([loopGpx({ circumferenceMetres: LAP_METRES })], 'circuit.gpx'));
  if (loop) form.set(LOOP_FIELD, 'on');

  const outcome = await routeFromImportForm(form, {
    id: ID,
    owner: ATHLETE_A,
    now: unixSeconds(1_700_000_000),
  });
  if (outcome.status !== 'saved') {
    throw new Error(`the import refused the circuit: ${outcome.refusal.message}`);
  }
  const found = await open.roundTrip(
    async (store) => store.putRoute(outcome.record),
    async (store) => store.getRoute(ATHLETE_A, ID),
  );
  if (found === undefined) {
    throw new Error('a fresh connection can see no route with that id');
  }
  return found;
}

function pedallingPort(route: RouteRecord): GamePort {
  return {
    listRoutes: () =>
      Promise.resolve([{ id: route.id, name: route.name, profile: route.profile, attempts: 0 }]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(230), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

/** A renderer that draws nothing and keeps every frame it was handed. */
function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    // #475: never asked — no ride in this file chose the realistic world.
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** A quarter of a second of riding per frame. @see GameView.test.tsx */
const FRAME_PERIOD_MS = 250;

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_PERIOD_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

/** Start riding the one route the picker offers, keeping what was drawn. */
async function ride(route: RouteRecord, frames: SceneFrame[] = []): Promise<Mounted> {
  mounted = await mount(
    <GameView
      port={pedallingPort(route)}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
    />,
  );
  await settle();

  const start = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(start?.disabled).toBe(false);
  await act(async () => {
    start?.click();
    await Promise.resolve();
  });
  await settle();
  return mounted;
}

/** The sentence under the elevation strip — #287's half. */
function stripText(view: Mounted): string {
  return view.container.querySelector('.oyl-hud__profile-text')?.textContent ?? '';
}

/** The value of one HUD field, found the way a rider finds it: by its label. */
function fieldSaying(view: Mounted, label: string): string {
  const row = queryAll(view.container, '.oyl-hud__field').find(
    (element) => element.querySelector('.oyl-hud__label')?.textContent === label,
  );
  return row?.querySelector('.oyl-hud__value')?.textContent ?? '';
}

/** What a screen reader is told about the plan view — #285's half. */
function planDescription(view: Mounted): string {
  return view.container.querySelector('.oyl-hud__plan-svg')?.getAttribute('aria-label') ?? '';
}

/**
 * ⚠️ **Fifteen seconds rather than Vitest's five**, for `position-wiring.test.tsx`
 * §`RIDE_TIMEOUT_MS`'s reason: every frame builds a landform, the water and
 * the villages since #458–#460, and the slowest case here took about 7.1 s
 * under coverage on #468's head. A stop on a hung ride, not a budget; the
 * assertions are unchanged.
 */
const RIDE_TIMEOUT_MS = 15_000;

describe('a circuit imported with the loop box ticked', { timeout: RIDE_TIMEOUT_MS }, () => {
  it('counts the second lap on the HUD a rider is looking at', async () => {
    const route = await importedRoute(true);
    expect(route.profile.totalDistance).toBeGreaterThan(LAP_METRES * 0.9);
    const view = await ride(route);

    // Before the finish line: the first lap, said in the same words.
    await pump(20);
    await settle();
    expect(stripText(view)).toContain('of lap 1');

    // Round it, and past it. At a bit over 200 W this takes about half a
    // minute; the extra frames are so the assertion is not sitting on the line.
    await pump(240);
    await settle();

    expect(stripText(view)).toContain('of lap 2');
    // And the other panel, which decides "which lap" through the same function
    // and says it to a reader who cannot see the mark move.
    expect(planDescription(view)).toContain('on lap 2');
    // ⚠️ **And the field that was wrong until this branch found it.** `To go`
    // counted down to a total a rider on a loop never reaches, so it read
    // `0.00` from the line onwards — the #287 defect one field over, invisible
    // because nothing could make a loop. It now counts down to the end of the
    // lap being ridden. @see hud/fields.ts §hudReadings
    const togo = Number.parseFloat(fieldSaying(view, 'To go'));
    expect(togo).toBeGreaterThan(0);
    // And it is this lap's remainder rather than some larger total: a number
    // above the lap's own length would mean the countdown had been rebased on
    // something else.
    expect(togo).toBeLessThanOrEqual((route.profile.totalDistance as number) / 1000);
    // Nothing threw on the way — a render boundary catching an error would
    // otherwise leave the assertions above reading a stale DOM.
    expect(view.caughtErrors).toEqual([]);
  });

  it('hands the renderer road that wraps past the finish line — #253', async () => {
    // #253's own geometry is asserted in `terrain.test.ts`, against a profile
    // that file builds. What is asserted here is the half no unit test can
    // reach: that the corridor a **rider's own route** produces on lap two is
    // built past the finish rather than stopping at it. A point whose odometer
    // is beyond the route's length while the place it was read from has wrapped
    // back to the beginning is exactly the two-field split #253 introduced, and
    // on a `loop: false` route it cannot occur, because `distance` clamps.
    const route = await importedRoute(true);
    const total = route.profile.totalDistance as number;
    const frames: SceneFrame[] = [];
    await ride(route, frames);
    await pump(260);
    await settle();

    const last = frames[frames.length - 1];
    expect(last).toBeDefined();
    const wrapped = (last?.corridor.centre ?? []).filter(
      (point) => point.along > total && point.distance < total,
    );
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it('sweeps the strip again rather than pinning it to the finish — #287', async () => {
    // The marker's fraction is the wrapped one, so on the second lap it is back
    // near the start. Before #296 this could only ever be 1 on a real route,
    // because no real route was a loop.
    const view = await ride(await importedRoute(true));
    await pump(260);
    await settle();

    const marker = view.container.querySelector('[data-testid="oyl-hud-position"]');
    const position = Number(marker?.getAttribute('data-position') ?? '1');
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBeLessThan(1);
  });
});

describe('the same file imported without the box', { timeout: RIDE_TIMEOUT_MS }, () => {
  it('finishes rather than lapping, and says nothing about a lap', async () => {
    // The control on the assertions above: the geometry is identical, so a
    // wording that appeared here too would be coming from something other than
    // the rider's claim.
    const route = await importedRoute(false);
    expect(route.profile.loop).toBe(false);
    const view = await ride(route);
    await pump(260);
    await settle();

    expect(stripText(view)).toContain('100% complete');
    expect(stripText(view)).not.toContain('lap');
    expect(planDescription(view)).not.toContain('lap');
  });
});
