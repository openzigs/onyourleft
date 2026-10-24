// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #782's end-to-end room (and #771's last criterion): **two pages join one room
 * on a real instance, and each sees the other move.**
 *
 * The instance is the production `startInstance` — handler, identity, room
 * router and a forked room worker — over a temporary SQLite file, started in
 * this spec's own process from `apps/instance/src/room/room-gate-testing.ts`,
 * the way `identity.browser.spec.ts` starts its own. Each page is its own
 * browser context — its own `localStorage` and IndexedDB, so its own device key
 * and its own athlete — and signs in, mints a ticket and opens the room's
 * socket through the client's ONE instance module (`room-harness.ts`).
 *
 * **The control** is a third page with fan-out switched off where the client
 * meets it (`acceptFrame: () => false`): it is in the room — joined, reporting —
 * and must see nobody move while the other two do. Without it, "each sees the
 * other move" would also pass over a page that drew riders from somewhere
 * other than the room's frames.
 *
 * **An edge restart** (#782's rejoin and keepalive criteria, the owner's ruling
 * Q3/Q6): the same real instance reached only through a TCP relay standing in
 * for the Cloudflare edge (`room-gate-testing.ts` §`RoomGateEdge`), which drops
 * every room socket mid-ride and is unreachable for a moment. Both pages must
 * come back on their own, through fresh sockets, to their own seats, with the
 * room's distance for each carrying on from where it was.
 *
 * ⚠️ **What it does not cover**: a real Cloudflare Tunnel (its idle timeout is
 * met by the keepalive, `net/room-session.ts` §`KEEPALIVE_INTERVAL_MS`, which
 * the relay never tests because it has none), a phone with its screen off,
 * and a second PERSON — #733 is the owner's list.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import type { RoomHarness, RoomSample } from './room-harness';

interface RoomGateInstance {
  readonly origin: string;
  readonly roomId: string;
  close(): Promise<void>;
}

interface RoomGateEdge {
  upgrades(): number;
  restart(holdMs: number): number;
}

interface RoomGateTesting {
  startRoomGateInstance(): Promise<RoomGateInstance>;
  startRoomGateInstanceBehindEdge(): Promise<RoomGateInstance & { readonly edge: RoomGateEdge }>;
}

const ROOM_GATE_TESTING = new URL('../../instance/src/room/room-gate-testing.ts', import.meta.url)
  .href;

let instance: RoomGateInstance;

test.beforeAll(async () => {
  const testing = (await import(ROOM_GATE_TESTING)) as RoomGateTesting;
  instance = await testing.startRoomGateInstance();
});

test.afterAll(async () => {
  await instance.close();
});

async function rider(
  browser: Browser,
  name: string,
  fanOut: boolean,
  at: RoomGateInstance = instance,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: HARNESS_ORIGIN });
  const page = await context.newPage();
  const response = await page.goto('/room.html');
  expect(
    response?.status(),
    'room.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylRoom !== undefined);
  const connected = await page.evaluate(
    ([address, room, who, fan]) =>
      (window.__oylRoom as RoomHarness).join(address, room, who, 200, fan),
    [at.origin, at.roomId, name, fanOut] as const,
  );
  expect(connected.kind, `${name} signed in`).toBe('connected');
  return page;
}

const sample = (page: Page): Promise<RoomSample> =>
  page.evaluate(() => (window.__oylRoom as RoomHarness).sample());

/** Whether `page` sees another rider move forward over `seconds`. */
async function seesAnotherMove(page: Page, seconds: number): Promise<boolean> {
  const first = await sample(page);
  await page.waitForTimeout(seconds * 1000);
  const second = await sample(page);
  return second.others.some((rider) => {
    const before = first.others.find((each) => each.riderId === rider.riderId);
    return before !== undefined && rider.distanceMetres > before.distanceMetres + 1;
  });
}

test.describe('two riders in one room on a real instance — #782', () => {
  test('each page sees the other move, and a page with fan-out off sees nobody', async ({
    browser,
  }) => {
    const anna = await rider(browser, 'Anna', true);
    const ben = await rider(browser, 'Ben', true);
    const control = await rider(browser, 'Cleo', false);

    // All three are joined: the control is really in the room, reporting.
    await expect
      .poll(
        async () => (await Promise.all([anna, ben, control].map(sample))).map((s) => s.status),
        {
          timeout: 15_000,
        },
      )
      .toEqual(['joined', 'joined', 'joined']);
    // The room runs its 1 Hz frames and the render delay fills: each page then
    // has the others in view.
    await expect.poll(async () => (await sample(anna)).others.length, { timeout: 15_000 }).toBe(2);
    await expect.poll(async () => (await sample(ben)).others.length, { timeout: 15_000 }).toBe(2);

    expect(await seesAnotherMove(anna, 2.5)).toBe(true);
    expect(await seesAnotherMove(ben, 2.5)).toBe(true);
    // The control: fan-out off, so the same observation over the same time is false.
    expect(await seesAnotherMove(control, 2.5)).toBe(false);
    expect((await sample(control)).others).toEqual([]);

    for (const page of [anna, ben, control]) {
      await page.evaluate(() => {
        (window.__oylRoom as RoomHarness).leave();
      });
      await page.context().close();
    }
  });
});

test.describe('an edge drops every room socket mid-ride — #782, ruling Q3/Q6', () => {
  // An instance of its own, as #784's below: three registrations an address an hour (#775).
  let behind: RoomGateInstance & { readonly edge: RoomGateEdge };
  test.beforeAll(async () => {
    const testing = (await import(ROOM_GATE_TESTING)) as RoomGateTesting;
    behind = await testing.startRoomGateInstanceBehindEdge();
  });
  test.afterAll(async () => {
    await behind.close();
  });

  /** How far the room may carry a rider on 200 W on the level in `ms` — generously. */
  const MOST_METRES_PER_SECOND = 20;
  /** How long the edge stays down: long enough that each page is seen lost. */
  const EDGE_DOWN_MS = 3_000;

  test('both riders come back on their own, through fresh sockets, to their own seats, and their distance carries on', async ({
    browser,
  }) => {
    const pages = [
      await rider(browser, 'Gia', true, behind),
      await rider(browser, 'Hal', true, behind),
    ] as const;
    const both = (): Promise<RoomSample[]> => Promise.all(pages.map(sample));

    // Riding: joined, each seeing the other, and the room moving each along.
    await expect
      .poll(async () => (await both()).map((s) => s.status), { timeout: 15_000 })
      .toEqual(['joined', 'joined']);
    await expect
      .poll(async () => (await both()).map((s) => s.others.length), { timeout: 15_000 })
      .toEqual([1, 1]);
    await expect
      .poll(async () => (await both()).every((s) => (s.ownDistanceMetres ?? 0) > 5), {
        timeout: 15_000,
      })
      .toBe(true);

    const before = await both();
    const droppedAt = Date.now();
    const upgradesBefore = behind.edge.upgrades();
    // The edge restarts: every socket through it closes, from the far side of the browser.
    expect(behind.edge.restart(EDGE_DOWN_MS)).toBe(2);
    await expect
      .poll(async () => (await both()).map((s) => s.status), { timeout: EDGE_DOWN_MS })
      .toEqual(['lost', 'lost']);

    // And they come back on their own: nothing on either page is touched.
    await expect
      .poll(async () => (await both()).map((s) => s.status), { timeout: 30_000 })
      .toEqual(['joined', 'joined']);
    // Through fresh sockets, each opened with a fresh single-use ticket.
    expect(behind.edge.upgrades()).toBeGreaterThanOrEqual(upgradesBefore + 2);

    const after = await both();
    // The same seats: the room restored each rider's seat (#779) rather than seating them anew.
    expect(after.map((s) => s.seat)).toEqual(before.map((s) => s.seat));
    expect(after[0]?.others.map((r) => r.riderId)).toEqual([before[1]?.seat]);
    expect(after[1]?.others.map((r) => r.riderId)).toEqual([before[0]?.seat]);

    // The distance carries on: every frame the room sends after the rejoin
    // puts each rider at or past where it last had them — never back at the
    // start — until it has carried each of them further on. Sampled well
    // inside the room's 1 Hz frame interval, so no frame goes unread.
    const carriedOn = async (): Promise<boolean> => {
      const now = await both();
      now.forEach((s, index) => {
        expect(
          s.ownDistanceMetres ?? Number.NaN,
          `rider ${String(index)}: the room put them behind where it last had them`,
        ).toBeGreaterThanOrEqual(before[index]?.ownDistanceMetres ?? 0);
      });
      return now.every(
        (s, index) => (s.ownDistanceMetres ?? 0) > (before[index]?.ownDistanceMetres ?? 0) + 1,
      );
    };
    const deadline = Date.now() + 15_000;
    while (!(await carriedOn())) {
      expect(Date.now(), 'the room never carried both riders on').toBeLessThan(deadline);
      await pages[0].waitForTimeout(100);
    }
    const resumed = await both();
    const ceiling = (MOST_METRES_PER_SECOND * (Date.now() - droppedAt)) / 1000;
    resumed.forEach((s, index) => {
      const was = before[index]?.ownDistanceMetres ?? 0;
      expect(s.ownDistanceMetres ?? 0).toBeLessThanOrEqual(was + ceiling);
    });
    // And each sees the other move again.
    expect(await seesAnotherMove(pages[0], 2.5)).toBe(true);
    expect(await seesAnotherMove(pages[1], 2.5)).toBe(true);

    for (const page of pages) {
      await page.evaluate(() => {
        (window.__oylRoom as RoomHarness).leave();
      });
      await page.context().close();
    }
  });
});

test.describe('a group ride made, shared by its code, joined and ridden — #784', () => {
  // An instance of its own: an instance registers three riders an address an
  // hour (#775), and the describe above has spent this address's three.
  let own: RoomGateInstance;
  test.beforeAll(async () => {
    const testing = (await import(ROOM_GATE_TESTING)) as RoomGateTesting;
    own = await testing.startRoomGateInstance();
  });
  test.afterAll(async () => {
    await own.close();
  });

  test('the joining page draws the maker’s route, fetched by hash and checked, and the two ride together; an altered route is refused', async ({
    browser,
  }) => {
    const signedIn = async (name: string): Promise<Page> => {
      const context = await browser.newContext({ baseURL: HARNESS_ORIGIN });
      const page = await context.newPage();
      expect((await page.goto('/room.html'))?.status()).toBe(200);
      await page.waitForFunction(() => window.__oylRoom !== undefined);
      const connected = await page.evaluate(
        ([address, who]) => (window.__oylRoom as RoomHarness).signIn(address, who),
        [own.origin, name] as const,
      );
      expect(connected.kind, `${name} signed in`).toBe('connected');
      return page;
    };
    const drawn = (page: Page): Promise<readonly string[]> =>
      page.evaluate(() => (window.__oylRoom as RoomHarness).drawn());

    const maker = await signedIn('Dee');
    const made = await maker.evaluate(() => (window.__oylRoom as RoomHarness).make());
    expect(made.kind).toBe('made');
    if (made.kind !== 'made') return;
    expect(made.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);

    // The control: a page whose copy of the route is altered on its way in
    // must refuse it and draw nothing — the check is against the room's hash.
    const control = await signedIn('Eli');
    const refused = await control.evaluate(
      (code) => (window.__oylRoom as RoomHarness).enter(code, true),
      made.code,
    );
    expect(refused).toEqual({ kind: 'refused', reason: 'not-the-rooms-route' });
    expect(await drawn(control)).toEqual([]);

    const friend = await signedIn('Fay');
    const joined = await friend.evaluate(
      (code) => (window.__oylRoom as RoomHarness).enter(code.toLowerCase(), false),
      made.code,
    );
    expect(joined).toEqual({ kind: 'entered', roomId: made.roomId });
    // The friend drew exactly the road the maker's own page drew.
    const makerDrew = await drawn(maker);
    expect(makerDrew.length).toBeGreaterThan(0);
    expect(makerDrew[0]?.length ?? 0).toBeGreaterThan(100);
    expect(await drawn(friend)).toEqual(makerDrew);

    // And they ride it together, each seeing the other move.
    await maker.evaluate(() => {
      (window.__oylRoom as RoomHarness).ride(220);
    });
    await friend.evaluate(() => {
      (window.__oylRoom as RoomHarness).ride(180);
    });
    await expect.poll(async () => (await sample(maker)).others.length, { timeout: 15_000 }).toBe(1);
    await expect
      .poll(async () => (await sample(friend)).others.length, { timeout: 15_000 })
      .toBe(1);
    expect(await seesAnotherMove(maker, 2.5)).toBe(true);
    expect(await seesAnotherMove(friend, 2.5)).toBe(true);

    for (const page of [maker, friend, control]) {
      await page.evaluate(() => {
        (window.__oylRoom as RoomHarness).leave();
      });
      await page.context().close();
    }
  });
});
