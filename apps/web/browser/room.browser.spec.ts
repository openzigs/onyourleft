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
 * ⚠️ **What it does not cover**: a Cloudflare Tunnel's idle close and an edge
 * restart (the scripted room drops the socket for those, `net/`), a phone
 * with its screen off, and a second PERSON — #733 is the owner's list.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import type { RoomHarness, RoomSample } from './room-harness';

interface RoomGateInstance {
  readonly origin: string;
  readonly roomId: string;
  close(): Promise<void>;
}

interface RoomGateTesting {
  startRoomGateInstance(): Promise<RoomGateInstance>;
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

async function rider(browser: Browser, name: string, fanOut: boolean): Promise<Page> {
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
    [instance.origin, instance.roomId, name, fanOut] as const,
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
