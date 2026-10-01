// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Home → Devices → Pair, in the pinned Chromium — #659.
 *
 * Until #659 Home's *"Pair a sensor or a smart trainer"* and the More tab both
 * landed on a Devices screen that said *"Not built yet"* and offered no
 * control. This walks a new rider's path through the real shell, the real ride
 * controller and the real Web Bluetooth transport over the scripted stack, and
 * reads the connection back where a rider reads it — Devices, then Ride, then
 * Home — which is the controller mounted above the router being the one both
 * screens read, observed rather than asserted.
 *
 * ⚠️ **The control is the dead end itself.** `?control=dead-end` is the same
 * page with no ride controller, which is the *"Not built yet"* state in the
 * only shape it still has, and the same walk is required to FAIL there — on
 * the pairing control, not on the way in.
 *
 * Read `devices-harness.tsx`'s header for what this does not prove.
 */

import { expect, test, type Page } from '@playwright/test';

import { STRAP_NAME, TRAINER_NAME } from './devices-fixture';
import type { DevicesHarness } from './devices-harness';

/** A phone, upright — #654's re-review names this viewport for the fold. */
const PHONE = { width: 390, height: 844 } as const;
/**
 * How long a step of the walk may take before it counts as absent. Generous,
 * because the gate runs every spec at once on a loaded machine; the control
 * pays it once, on the step that is missing.
 */
const STEP_MS = 15_000;

async function open(page: Page, control = false): Promise<void> {
  await page.setViewportSize(PHONE);
  const response = await page.goto(`/devices.html${control ? '?control=dead-end' : ''}`);
  expect(
    response?.status(),
    'devices.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylDevices !== undefined);
  const published = await page.evaluate((): Partial<DevicesHarness> => ({
    ready: window.__oylDevices?.ready,
    errors: window.__oylDevices?.errors,
    control: window.__oylDevices?.control,
  }));
  expect(published.errors, 'the devices harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
  expect(published.control).toBe(control);
}

/** The pairing row for one kind of device. */
const row = (page: Page, kind: string) =>
  page.locator('.oyl-pairing__row').filter({ has: page.getByRole('heading', { name: kind }) });

/**
 * The walk: Home's own link, then the trainer's Pair button, then its state in
 * words. Every step waits `STEP_MS` and no longer, so the control fails in
 * seconds on the step that is missing.
 */
async function walkHomeToPaired(page: Page): Promise<void> {
  await page
    .getByRole('link', { name: 'Pair a sensor or a smart trainer' })
    .click({ timeout: STEP_MS });
  await expect(page).toHaveURL(/#\/devices$/, { timeout: STEP_MS });
  // With nothing paired there are TWO: the empty garage's one action and the
  // trainer row's own, one name for one function since #987's review. The
  // first is the empty state's, which a first-run rider meets first.
  await page
    .getByRole('button', { name: 'Pair a smart trainer' })
    .first()
    .click({ timeout: STEP_MS });
  await expect(row(page, 'Smart trainer').locator('.oyl-pairing__state')).toHaveText(
    `${TRAINER_NAME}: Connected`,
    { timeout: STEP_MS },
  );
}

test('a new rider pairs a trainer from Home, and Ride and Home both see it', async ({ page }) => {
  await open(page);
  await expect(row(page, 'Smart trainer')).toHaveCount(0);

  await walkHomeToPaired(page);

  // Read back through the other consumers, with no reload: the controller is
  // above the router, so what Devices paired is what Ride shows.
  await page.evaluate(() => {
    window.location.hash = '#/ride';
  });
  await expect(page.locator('.oyl-ride__group--sensors li')).toHaveText([
    `${TRAINER_NAME}: Connected`,
  ]);
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  // ⚠️ Positive, not `not.toContainText('No trainer paired')` — a negated
  // matcher passes over a Home that rendered no Trainer region at all (#659's
  // review). This is `HomeView.tsx` §`FromTheRide`'s sentence for a trainer
  // that is paired and has not been given control.
  await expect(page.getByRole('region', { name: 'Trainer' })).toContainText(
    'Paired, and this app has not been given control.',
  );
});

test('a second device is its own press, and Forget lets it go through BluetoothDevice.forget()', async ({
  page,
}) => {
  await open(page);
  await walkHomeToPaired(page);

  await page.getByRole('button', { name: 'Pair a heart rate strap' }).click();
  await expect(row(page, 'Heart rate strap').locator('.oyl-pairing__state')).toHaveText(
    `${STRAP_NAME}: Connected`,
  );

  await page.getByRole('button', { name: `Forget ${STRAP_NAME}` }).click();
  await expect(row(page, 'Heart rate strap').locator('.oyl-pairing__state')).toHaveText(
    'Not paired',
  );
  expect(await page.evaluate(() => window.__oylDevices?.forgets())).toEqual({
    trainer: 0,
    strap: 1,
  });

  // And the chooser brings it back.
  await page.getByRole('button', { name: 'Pair a heart rate strap' }).click();
  await expect(row(page, 'Heart rate strap').locator('.oyl-pairing__state')).toHaveText(
    `${STRAP_NAME}: Connected`,
  );
});

test(`on a ${String(PHONE.width)}×${String(PHONE.height)} phone the first pairing control is above the fold, and the prose is after the controls`, async ({
  page,
}) => {
  await open(page);
  await page.getByRole('link', { name: 'Pair a sensor or a smart trainer' }).click();
  await expect(page).toHaveURL(/#\/devices$/);
  // The hash moves before the route renders; measure the screen, not the gap.
  // `toBeVisible` does not scroll, so this also says nothing about the fold.
  // Two of that name with nothing paired (the empty garage's action and the
  // row's, #987); both must be drawn.
  await expect(page.getByRole('button', { name: 'Pair a smart trainer' })).toHaveCount(2);
  for (const pair of await page.getByRole('button', { name: 'Pair a smart trainer' }).all()) {
    await expect(pair).toBeVisible();
  }

  const measured = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>('.oyl-pairing__row .oyl-button')];
    const details = document.querySelector('main details');
    const first = buttons[0]?.getBoundingClientRect();
    const last = buttons.at(-1)?.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      buttons: buttons.length,
      firstBottom: first?.bottom,
      firstHeight: first?.height,
      firstWidth: first?.width,
      lastBottom: last?.bottom,
      detailsTop: details?.getBoundingClientRect().top,
      detailsOpen: (details as HTMLDetailsElement | null)?.open,
    };
  });
  expect(measured.buttons).toBe(4);
  expect(measured.scrollY).toBe(0);
  expect(measured.firstBottom ?? Infinity).toBeLessThanOrEqual(measured.innerHeight);
  // 44 × 44, `.oyl-button`'s declared floor.
  expect(measured.firstHeight ?? 0).toBeGreaterThanOrEqual(44);
  expect(measured.firstWidth ?? 0).toBeGreaterThanOrEqual(44);
  // The limits are beneath every control, and closed.
  expect(measured.detailsTop ?? -Infinity).toBeGreaterThanOrEqual(measured.lastBottom ?? Infinity);
  expect(measured.detailsOpen).toBe(false);
  // "One user gesture per device" is on the page, visible, not tucked away.
  await expect(page.getByText('one user gesture per device')).toBeVisible();
  // …and so are the other two working-path constraints, ADR 0003 D-7 rule 5.
  // Exact, because the closed disclosure holds the longer wording of each too.
  await expect(
    page.getByText('There is no silent reconnect: after a reload, each device is chosen again.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Recording does not continue in the background: keep this tab open and in front while you ride.',
      { exact: true },
    ),
  ).toBeVisible();
});

test('the control — today’s dead end fails the same walk, on the pairing control', async ({
  page,
}) => {
  await open(page, true);
  // It must fail AT the pairing control — the link to Devices was never the
  // defect, so a walk that failed on the way in would prove nothing here.
  await expect(walkHomeToPaired(page)).rejects.toThrow(/Pair a smart trainer/);
  await expect(page).toHaveURL(/#\/devices$/);
  await expect(page.getByRole('button', { name: /^Pair / })).toHaveCount(0);
});
