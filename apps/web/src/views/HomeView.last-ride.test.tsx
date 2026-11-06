// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Home's last-ride module — #2048 — over the **real** local store.
 *
 * Rides are written through the store (`@onyourleft/store/testing`), and
 * Home is opened through the real shell over a fresh connection, so what is
 * asserted is what the module RENDERS from the store's own newest-first read
 * (`home/home.ts` §"The read budget") — the path a rider's eyes take, not the
 * rows a test built.
 *
 * ⚠️ **A location surface.** The module draws the ride's climb, never its
 * trace; the last case seeds a route at a latitude no other number on the
 * page could be, and requires that no coordinate reaches the module.
 */

import { metres, unixSeconds, watts, type UnixSeconds } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  seedRoute,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../design/contrast';
import { ILLUSTRATION_PAINTS } from '../design/illustration/paint';
import { CONTRAST_REQUIREMENTS, THEMES, paletteColours } from '../design/tokens';
import { AppShell } from '../shell/AppShell';
import { hrefFor, hrefForActivity, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { idleSnapshot, stubRideController } from '../ride/testing';
import { mount, settle, type Mounted } from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const DAY = 86_400;
const NOW: UnixSeconds = unixSeconds(1_800_000_000);
/** A latitude no other figure on Home could be. */
const ORIGIN_LATITUDE = 63.987654;

let harness: StoreHarness | undefined;
let mounted: Mounted | undefined;
afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  await harness?.destroy();
  harness = undefined;
});

async function seeded(): Promise<StoreHarness> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  return open;
}

/** Open Home through the shell over a fresh read of `open`, and hand back the module. */
async function withHome<T>(
  open: StoreHarness,
  look: (module: HTMLElement | null) => T,
): Promise<T> {
  return open.read(async (store) => {
    globalThis.location.hash = '#/';
    const realNow = Date.now;
    Date.now = () => NOW * 1000;
    try {
      mounted = await mount(
        <AppShell
          capabilities={NO_BLUETOOTH}
          analysis={{ athleteId: ATHLETE_A, store }}
          routes={{ athleteId: ATHLETE_A, store }}
          rideController={stubRideController(idleSnapshot()).controller}
        />,
      );
      await settle();
      await settle();
      await settle();
    } finally {
      Date.now = realNow;
    }
    return look(document.querySelector<HTMLElement>('main section.oyl-home__last'));
  });
}

describe('Home’s last ride — #2048', () => {
  it('shows the NEWER of two rides: its name, its distance, and a link to its own page', async () => {
    const open = await seeded();
    const older = rideFor(ATHLETE_A, {
      id: activityId('older'),
      name: 'Tuesday hills',
      startedAt: unixSeconds(NOW - 5 * DAY),
      startedAtTimeZone: 'UTC',
      distance: metres(41_000),
    });
    const newer = rideFor(ATHLETE_A, {
      id: activityId('newer'),
      name: 'Thursday spin',
      startedAt: unixSeconds(NOW - DAY),
      startedAtTimeZone: 'UTC',
      distance: metres(23_500),
    });
    await open.write(async (store) => {
      // Written newest first, so insertion order is not what puts it on top.
      await store.putActivity(newer);
      await store.putActivity(older);
    });

    const found = await withHome(open, (module) => ({
      text: module?.textContent ?? '',
      link: module?.querySelector('a')?.getAttribute('href'),
      linkText: module?.querySelector('a')?.textContent,
    }));
    expect(found.text).toContain('Thursday spin');
    expect(found.text).toContain('23.5 km');
    expect(found.text).not.toContain('Tuesday hills');
    expect(found.text).not.toContain('41.0 km');
    expect([found.linkText, found.link]).toEqual(['Thursday spin', hrefForActivity('newer')]);
  });

  it('says the average power where it was recorded, and has no power line where it was not', async () => {
    const open = await seeded();
    await open.write(async (store) => {
      await store.putActivity(
        rideFor(ATHLETE_A, {
          id: activityId('powered'),
          startedAt: unixSeconds(NOW - DAY),
          averagePower: watts(187.6),
        }),
      );
    });
    expect(await withHome(open, (module) => module?.textContent ?? '')).toMatch(
      /Average power188\sW/,
    );
    mounted?.unmount();
    mounted = undefined;
    await harness?.destroy();

    const bare = await seeded();
    await bare.write(async (store) => {
      await store.putActivity(
        rideFor(ATHLETE_A, { id: activityId('bare'), startedAt: unixSeconds(NOW - DAY) }),
      );
    });
    expect(await withHome(bare, (module) => module?.textContent ?? '')).not.toContain(
      'Average power',
    );
  });

  it.each([0, 0.3])('has no power line for a stored mean of %s W (#1054)', async (mean) => {
    const open = await seeded();
    await open.write(async (store) => {
      await store.putActivity(
        rideFor(ATHLETE_A, {
          id: activityId('zero-power'),
          startedAt: unixSeconds(NOW - DAY),
          averagePower: watts(mean),
        }),
      );
    });
    expect(await withHome(open, (module) => module?.textContent ?? '')).not.toContain(
      'Average power',
    );
  });

  it('draws the climb of the route it was ridden on, with the climb in words — and no coordinate reaches the module', async () => {
    const open = await seeded();
    const route = await seedRoute(open, ATHLETE_A, {
      name: 'Fjord loop',
      originLatitude: ORIGIN_LATITUDE,
    });
    await open.write(async (store) => {
      await store.putActivity(
        rideFor(ATHLETE_A, {
          id: activityId('on-route'),
          name: 'Round the fjord',
          startedAt: unixSeconds(NOW - DAY),
          routeId: route.id,
          hasPosition: true,
        }),
      );
    });

    const found = await withHome(open, (module) => ({
      text: module?.textContent ?? '',
      html: module?.outerHTML ?? '',
      profiles: module?.querySelectorAll('svg path').length ?? 0,
      hidden: module?.querySelector('svg')?.closest('[aria-hidden="true"]') !== null,
      attributes: [...(module?.querySelectorAll('*') ?? [])].flatMap((element) =>
        [...element.attributes]
          .filter((attribute) => attribute.name !== 'd')
          .map((attribute) => attribute.value),
      ),
    }));
    expect(found.text).toContain('Round the fjord');
    // The route's climb is drawn, hidden from assistive technology, and said in words.
    expect(found.profiles).toBeGreaterThan(0);
    expect(found.hidden).toBe(true);
    expect(found.text).toMatch(/Climb \d+ m/);
    // No coordinate, in any form: not the latitude, not a degree sign, not a
    // decimal with the precision a position carries — in the words or in any
    // attribute but the drawing's own geometry, whose numbers are its viewBox.
    expect(found.html).not.toContain(String(ORIGIN_LATITUDE).slice(0, 7));
    expect(found.text).not.toMatch(/°|\d+\.\d{3,}/);
    expect(found.attributes.join(' ')).not.toMatch(/°|-?\d+\.\d{3,}/);
  });

  /*
   * The owner's screenshot review of 2026-11-05: the profile was the near
   * hill's faint dark green on the dark card. It is painted with a token whose
   * pair on the card's `surfaceRaised` is DECLARED at the non-text 3:1 (SC
   * 1.4.11) — so `contrast.a11y.test.ts` holds its measured ratio in both
   * palettes — and that ratio is at least 3:1 in each here as well.
   */
  it('paints the climb in a declared non-text pair on the card, at least 3:1 in both palettes', async () => {
    const open = await seeded();
    const route = await seedRoute(open, ATHLETE_A, { name: 'Hill loop' });
    await open.write(async (store) => {
      await store.putActivity(
        rideFor(ATHLETE_A, {
          id: activityId('on-route'),
          name: 'Round the hill',
          startedAt: unixSeconds(NOW - DAY),
          routeId: route.id,
        }),
      );
    });
    const classes = await withHome(open, (module) => [
      ...new Set(
        [...(module?.querySelectorAll('svg path') ?? [])].map((path) => path.getAttribute('class')),
      ),
    ]);
    const paints = Object.values(ILLUSTRATION_PAINTS).filter((each) =>
      classes.includes(each.className),
    );
    expect(paints.map((each) => each.property)).toEqual(['fill']);
    const token = paints[0]?.token;
    expect(
      CONTRAST_REQUIREMENTS.filter(
        (pair) =>
          pair.foreground === token &&
          pair.background === 'surfaceRaised' &&
          pair.minimum >= AA_LARGE_TEXT_OR_NON_TEXT,
      ),
      `${String(token)} on surfaceRaised is not a declared non-text pair`,
    ).toHaveLength(1);
    for (const theme of THEMES) {
      const colours = paletteColours(theme);
      if (token === undefined) throw new Error('the climb has no paint');
      expect(contrastRatio(colours[token], colours.surfaceRaised), theme).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_OR_NON_TEXT,
      );
    }
  });

  it('a ride on no saved route draws no climb — not even the route an OLDER ride was on, which Next up offers', async () => {
    const open = await seeded();
    const route = await seedRoute(open, ATHLETE_A, { name: 'Last week’s loop' });
    await open.write(async (store) => {
      await store.putActivity(
        rideFor(ATHLETE_A, {
          id: activityId('older-on-route'),
          startedAt: unixSeconds(NOW - 6 * DAY),
          routeId: route.id,
        }),
      );
      await store.putActivity(
        rideFor(ATHLETE_A, {
          id: activityId('free'),
          name: 'A free ride today',
          startedAt: unixSeconds(NOW - DAY),
        }),
      );
    });
    const found = await withHome(open, (module) => ({
      drawings: module?.querySelectorAll('svg').length ?? -1,
      text: module?.textContent ?? '',
      nextUp: document.querySelector('main .oyl-next-up')?.textContent ?? '',
    }));
    // Next up offers the route; the last ride, which was not on it, draws none.
    expect(found.nextUp).toContain('Last week’s loop');
    expect(found.text).toContain('A free ride today');
    expect(found.drawings).toBe(0);
    expect(found.text).not.toContain('Climb');
  });

  it('with no rides there is no last ride; the slot says nothing is recorded, and Next up offers the start', async () => {
    const open = await seeded();
    const found = await withHome(open, (module) => ({
      module,
      empty: document.querySelector('main .oyl-home__empty')?.textContent ?? '',
      start: [...document.querySelectorAll('main .oyl-next-up a')].map((link) => [
        link.textContent,
        link.getAttribute('href'),
      ]),
    }));
    expect(found.module).toBeNull();
    expect(found.empty).toContain('Nothing recorded yet');
    expect(found.start).toEqual([['Start a ride', hrefFor(routeById('ride'))]]);
  });
});
