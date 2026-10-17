// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pre-ride chooser, measured by a real engine — #940 and #1011.
 *
 * Sections of `ride.browser.spec.ts` until #1414, which divided that file so
 * the browser gate's shards could divide it too; its header says which
 * section went where. `ride.html?picker=chooser` stops at the chooser rather
 * than riding (`ride-harness.tsx` §`PICKER`), and the comment opening the
 * section below is its account. ⚠️ Not `ride-chooser.browser.spec.ts`, which
 * is Analysis' ride chooser (#1028), a different control.
 */

import { expect, test, type Page } from '@playwright/test';

import { applyInsets, PIXEL_TABLET_LANDSCAPE_INSETS } from './insets';
import { SUBPIXEL_TOLERANCE, openRide } from './ride-stage';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../src/design/contrast';

/*
 * #940 — THE PRE-RIDE CHOOSER.
 *
 * `ride.html?picker=chooser` stops at the chooser with seven routes rather than
 * riding (`ride-harness.tsx` §`PICKER`). The LAST route's name is as long as a
 * route's name can be (`routes/save.ts` §`MAXIMUM_ROUTE_NAME_LENGTH`), so the
 * *Ride* named after it is the tallest it gets. Each case chooses that card as
 * a rider does, puts the page back at `scrollY === 0`, and reads *Ride*: on the
 * screen, the topmost thing at its own centre, and on the owner's tablet with
 * the #439 insets 50 px clear of the fold (`rideview.browser.spec.ts`
 * §`FOLD_MARGIN_PIXELS`' floor and its reason). Every margin is printed.
 *
 * ⚠️ **The control is `?picker=list`**: the same chooser with the old picker's
 * layout put back — the loadout above the routes, one route to a row, and
 * *Ride* after them — and *Ride* must then be under the tablet's floor.
 * Without it, every assertion here is true of a chooser with one short route.
 */

/** `rideview.browser.spec.ts` §`FOLD_MARGIN_PIXELS`, restated for a different page. */
const CHOOSER_FOLD_FLOOR_PIXELS = 50;

/** `design/ride-time-controls.ts` §`RIDE_TIME_TARGET_PIXELS`. */
const CHOOSER_RIDE_TARGET_PIXELS = 48;

interface ChooserViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: boolean;
}

const TABLET_IN_THE_SHELL_CHOOSER: ChooserViewport = {
  name: 'a landscape tablet inside the Android shell — 1280×800, insets 36/32',
  width: 1280,
  height: 800,
  insets: true,
};

/** The three viewports #940 names. */
const CHOOSER_VIEWPORTS: readonly ChooserViewport[] = [
  { name: 'a phone upright — 390×844', width: 390, height: 844, insets: false },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390, insets: false },
  TABLET_IN_THE_SHELL_CHOOSER,
];

/**
 * #940's second review: every size it measured a pinned *Ride* over the
 * promise at, and the two where the longest name outgrew the pin, beside
 * #940's own three and two between its layouts.
 */
const CHOOSER_REVIEW_VIEWPORTS: readonly ChooserViewport[] = [
  { name: '932×430', width: 932, height: 430, insets: false },
  { name: '844×390', width: 844, height: 390, insets: false },
  { name: '740×360', width: 740, height: 360, insets: false },
  { name: '640×360', width: 640, height: 360, insets: false },
  { name: '568×320', width: 568, height: 320, insets: false },
  { name: '320×640', width: 320, height: 640, insets: false },
  { name: '360×740', width: 360, height: 740, insets: false },
  { name: '390×844', width: 390, height: 844, insets: false },
  { name: '1024×768', width: 1024, height: 768, insets: false },
  { name: '800×1280', width: 800, height: 1280, insets: false },
  TABLET_IN_THE_SHELL_CHOOSER,
];

/** Where the chooser's *Ride* is, and the three readings of its size. */
interface ChooserRide {
  readonly text: string;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
  readonly onTop: boolean;
  readonly scrollY: number;
  readonly fold: number;
  readonly minHeight: number;
  readonly minWidth: number;
}

/**
 * Which notices stand above *Ride*. `promise` is the default fixture: a ready
 * trainer, so only #503's promise. `release` is a ready trainer whose last
 * release was not confirmed — the release fault AND the promise, the state in
 * which #940's pinned *Ride* hid the whole promise on every landscape phone.
 * `all` is the TALLEST stack (`ride-harness.tsx` §`ALL_NOTICES`): the release
 * fault, the trainer notice and the realistic world.
 */
type ChooserNotices = 'promise' | 'release' | 'all';

const CHOOSER_NOTICE_STATES: readonly ChooserNotices[] = ['promise', 'release', 'all'];

async function openChooser(
  page: Page,
  viewport: ChooserViewport,
  query: 'chooser' | 'list',
  notices: ChooserNotices = 'promise',
): Promise<void> {
  if (viewport.insets) {
    await applyInsets(page, PIXEL_TABLET_LANDSCAPE_INSETS);
  }
  await openRide(
    page,
    { ...viewport, unstagedFails: false },
    `?picker=${query}${notices === 'promise' ? '' : `&notices=${notices}`}`,
  );
}

/** The notice labels each state must render, in order, every one above *Ride*. */
const CHOOSER_NOTICE_LABELS: Readonly<Record<ChooserNotices, readonly string[]>> = {
  promise: ['Your trainer'],
  release: ['Not released', 'Your trainer'],
  // #1011: the realistic world is a compact line FIRST, so #503's promise —
  // or here the trainer notice standing in its place — is last before Ride.
  all: ['Realistic world', 'Not released', 'The road will not reach your trainer'],
};

/**
 * One reading of the chooser at the page's CURRENT scroll, with whatever is
 * pinned left where it is: whether *Ride* is the topmost thing at its centre,
 * and for every notice how many of a grid of points over its whole box the
 * hit test reaches (`elementFromPoint` lands inside the notice), how many lie
 * off the screen or under the shell's sticky header (scrolled past), and how
 * many land on something else — which is a notice OBSCURED.
 */
interface ChooserSight {
  readonly scrollY: number;
  readonly rideOnTop: boolean;
  readonly notices: readonly {
    readonly label: string;
    readonly reached: number;
    readonly offScreen: number;
    readonly obscured: number;
    readonly points: number;
    /** Page coordinates, for the order. */
    readonly top: number;
    readonly bottom: number;
  }[];
  /** *Ride*'s top in page coordinates. */
  readonly rideTop: number;
}

/** Read {@link ChooserSight} at each of `scrolls` (page offsets; clamped by the browser). */
async function sightsAt(page: Page, scrolls: readonly number[] | 'sweep'): Promise<ChooserSight[]> {
  return page.evaluate((asked) => {
    const chooser = document.querySelector('.oyl-chooser');
    if (chooser === null) throw new Error('no chooser');
    const ride = [...chooser.querySelectorAll<HTMLButtonElement>('button')].find((each) =>
      (each.textContent ?? '').startsWith('Ride '),
    );
    if (ride === undefined) throw new Error('the chooser has no Ride');
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const offsets: number[] = [];
    if (asked === 'sweep') {
      for (let y = 0; y < maximum; y += 24) offsets.push(y);
      offsets.push(Math.max(0, maximum));
    } else {
      offsets.push(...asked);
    }
    const header = document.querySelector<HTMLElement>('.oyl-header');
    const readings = [];
    for (const offset of offsets) {
      window.scrollTo(0, offset);
      const rideBox = ride.getBoundingClientRect();
      const cx = rideBox.left + rideBox.width / 2;
      const cy = rideBox.top + rideBox.height / 2;
      const inView = cx >= 0 && cx < window.innerWidth && cy >= 0 && cy < window.innerHeight;
      const hit = inView ? document.elementFromPoint(cx, cy) : null;
      // Every notice above Ride: each status box, and since #1011 the
      // realistic world's one line.
      const notices = [...chooser.querySelectorAll<HTMLElement>('.oyl-chooser__notices > *')].map(
        (each) => {
          const box = each.getBoundingClientRect();
          let reached = 0;
          let offScreen = 0;
          let obscured = 0;
          let points = 0;
          // Every 6 px down and across over the WHOLE box, inset only by its
          // corner radius: a hit test 1 px inside a rounded corner is outside
          // the shape and lands on whatever is behind it.
          const inset =
            Math.max(1, Number.parseFloat(getComputedStyle(each).borderTopLeftRadius)) + 1;
          for (let y = box.top + inset; y <= box.bottom - inset; y += 6) {
            for (let x = box.left + inset; x <= box.right - inset; x += 6) {
              points += 1;
              if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
                offScreen += 1;
                continue;
              }
              const at = document.elementFromPoint(x, y);
              if (at !== null && each.contains(at)) reached += 1;
              else if (at !== null && header !== null && header.contains(at)) offScreen += 1;
              else obscured += 1;
            }
          }
          return {
            label:
              each
                .querySelector('.oyl-status__label, .oyl-chooser__world-label')
                ?.textContent?.replace(/:\s*$/, '') ?? '',
            reached,
            offScreen,
            obscured,
            points,
            top: box.top + window.scrollY,
            bottom: box.bottom + window.scrollY,
          };
        },
      );
      readings.push({
        scrollY: window.scrollY,
        rideOnTop: hit !== null && ride.contains(hit),
        notices,
        rideTop: rideBox.top + window.scrollY,
      });
    }
    window.scrollTo(0, 0);
    return readings;
  }, scrolls);
}

/**
 * Tab through EVERY control in the chooser — forwards from the top of the
 * page, or backwards from its last control — and for each, read how much of
 * it lies behind anything pinned ANYWHERE in the document: any box whose
 * computed `position` is `sticky` or `fixed` (the shell's header and its
 * navigation included), less the control's own ancestors. Chromium scrolls a
 * newly focused control just into the viewport, so a control at an edge is
 * exactly where a pinned box sits (WCAG 2.2 SC 2.4.11, and 2.4.12's "any
 * part").
 */
async function tabWalk(
  page: Page,
  direction: 'forwards' | 'backwards',
): Promise<
  readonly {
    readonly name: string;
    readonly covered: number;
    readonly height: number;
  }[]
> {
  await page.evaluate((backwards) => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
    if (backwards) {
      const chooser = document.querySelector('.oyl-chooser');
      const controls = [
        ...(chooser?.querySelectorAll<HTMLElement>('input, select, button, a[href]') ?? []),
      ].filter((each) => each.tabIndex >= 0 && !(each as HTMLInputElement).disabled);
      const last = controls.at(-1);
      if (last === undefined) throw new Error('the chooser has no controls');
      last.focus();
    }
  }, direction === 'backwards');
  const key = direction === 'forwards' ? 'Tab' : 'Shift+Tab';
  const seen: { name: string; covered: number; height: number }[] = [];
  const read = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (element === null || element === document.body) return { kind: 'nothing' as const };
      const chooser = document.querySelector('.oyl-chooser');
      if (chooser === null || !chooser.contains(element)) return { kind: 'outside' as const };
      const box = element.getBoundingClientRect();
      const pinned = [...document.querySelectorAll<HTMLElement>('*')].filter((each) => {
        const position = getComputedStyle(each).position;
        return (position === 'sticky' || position === 'fixed') && !each.contains(element);
      });
      let covered = 0;
      for (const pin of pinned) {
        const over = pin.getBoundingClientRect();
        const height = Math.min(box.bottom, over.bottom) - Math.max(box.top, over.top);
        const width = Math.min(box.right, over.right) - Math.max(box.left, over.left);
        if (height > 0 && width > 0) covered = Math.max(covered, height);
      }
      // Off the screen counts as covered: a focused control nobody can see.
      covered = Math.max(covered, -box.top, box.bottom - window.innerHeight, 0);
      // A label's own words, without a `<select>`'s options inside it.
      const label = (element as HTMLInputElement).labels?.[0];
      const words =
        label === undefined
          ? ''
          : [...label.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? '')
              .join('');
      const name =
        element.getAttribute('aria-label') ??
        (words === '' ? (element.textContent ?? element.tagName) : words);
      return {
        kind: 'control' as const,
        name: name.trim().slice(0, 60),
        covered,
        height: box.height,
      };
    });
  if (direction === 'backwards') {
    const first = await read();
    if (first.kind === 'control') seen.push(first);
  }
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press(key);
    const reading = await read();
    if (reading.kind === 'nothing') break;
    if (reading.kind === 'outside') {
      if (seen.length > 0) break;
      continue;
    }
    seen.push({ name: reading.name, covered: reading.covered, height: reading.height });
  }
  return seen;
}

/**
 * `routes/save.ts` §`MAXIMUM_ROUTE_NAME_LENGTH`, as the harness publishes it —
 * the spec runs in Node and does not import the client (`devices-fixture.ts`'
 * reason); the harness builds its longest name from the constant and refuses
 * to start if the two disagree.
 */
async function maximumRouteName(page: Page): Promise<number> {
  const published = await page.evaluate(() => document.documentElement.dataset.oylMaximumRouteName);
  const bound = Number(published);
  expect(bound, 'the harness published no route-name bound').toBeGreaterThan(0);
  return bound;
}

/** Choose the last card, as a rider does, and return its name. */
async function chooseLast(page: Page): Promise<string> {
  const lastName = await page.evaluate(() => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('.oyl-chooser__radio')];
    const last = radios.at(-1);
    if (last === undefined || radios.length < 2) throw new Error('the chooser offers no routes');
    last.click();
    last.blur();
    return document.querySelector(`label[for="${last.id}"]`)?.textContent ?? '';
  });
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('button')].some((each) => each.textContent === `Ride ${name}`),
    lastName,
  );
  return lastName;
}

/** Choose the last card, as a rider does, then read *Ride* at the top of the page. */
async function chooseLastAndReadRide(page: Page): Promise<ChooserRide> {
  await chooseLast(page);
  return page.evaluate(() => {
    window.scrollTo(0, 0);
    const ride = [...document.querySelectorAll<HTMLButtonElement>('.oyl-chooser__go button')].find(
      (each) => (each.textContent ?? '').startsWith('Ride '),
    );
    if (ride === undefined) throw new Error('the chooser has no Ride');
    const box = ride.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;bottom:0;height:env(safe-area-inset-bottom,0px)';
    document.body.append(probe);
    const inset = probe.getBoundingClientRect().height;
    probe.remove();
    // A navigation BAR along the bottom is a fold too (`controls-first`'s rule).
    const nav = document.querySelector<HTMLElement>('.oyl-nav');
    const navBox = nav?.getBoundingClientRect();
    const barTop =
      nav !== null &&
      navBox !== undefined &&
      getComputedStyle(nav).position === 'fixed' &&
      navBox.width >= window.innerWidth - 1
        ? navBox.top
        : window.innerHeight;
    const style = getComputedStyle(ride);
    const minHeight = Number.parseFloat(style.minHeight);
    const minWidth = Number.parseFloat(style.minWidth);
    return {
      text: ride.textContent ?? '',
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      width: box.width,
      height: box.height,
      onTop: hit !== null && ride.contains(hit),
      scrollY: window.scrollY,
      fold: Math.min(window.innerHeight - inset, barTop),
      minHeight,
      minWidth,
    };
  });
}

/** The most space between the last notice and *Ride*: one notice's own margin. */
const CHOOSER_NOTICE_TO_RIDE_PIXELS = 16;

/**
 * Where #940's criterion — *Ride* on the screen at `scrollY === 0` — must hold,
 * and where it CANNOT without hiding a notice, which #503 forbids: on a phone
 * held sideways a release fault and the promise are taller than what the
 * shell leaves under its own title and summary (they end 15 px above the
 * fold on a Mac), and the tallest stack is taller than an upright phone's
 * screen above its navigation bar (21 px left). There the case requires
 * *Ride* to come straight after the last notice — the notices, and nothing
 * else, are what is in its way — and lets it be on the screen if the fonts
 * leave room.
 */
const RIDE_AT_THE_TOP: Readonly<Record<ChooserNotices, readonly string[]>> = {
  promise: CHOOSER_VIEWPORTS.map((each) => each.name),
  release: [CHOOSER_VIEWPORTS[0]?.name ?? '', TABLET_IN_THE_SHELL_CHOOSER.name],
  all: [TABLET_IN_THE_SHELL_CHOOSER.name],
};

test.describe('#940 — the pre-ride chooser', () => {
  for (const notices of CHOOSER_NOTICE_STATES) {
    for (const viewport of CHOOSER_VIEWPORTS) {
      const onScreen = RIDE_AT_THE_TOP[notices].includes(viewport.name);
      test(`notices ${notices}: ${onScreen ? 'Ride is on the screen' : 'Ride comes straight after the notices'} after choosing the last route — ${viewport.name}`, async ({
        page,
      }) => {
        await openChooser(page, viewport, 'chooser', notices);
        const ride = await chooseLastAndReadRide(page);
        const margin = ride.fold - ride.bottom;
        const lastNotice = await page.evaluate(() =>
          Math.max(
            ...[...document.querySelectorAll('.oyl-chooser__notices > *')].map(
              (each) => each.getBoundingClientRect().bottom,
            ),
          ),
        );
        console.log(
          `#940 notices ${notices} — ${viewport.name}: Ride at ${ride.top.toFixed(1)}–${ride.bottom.toFixed(1)} px (${ride.height.toFixed(0)} tall), ${margin.toFixed(1)} px above the fold; the notices end at ${lastNotice.toFixed(1)} px, ${(ride.fold - lastNotice).toFixed(1)} px above it`,
        );

        expect(ride.text.length).toBe('Ride '.length + (await maximumRouteName(page)));
        expect(ride.scrollY).toBe(0);
        expect(ride.left).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
        expect(ride.right).toBeLessThanOrEqual(viewport.width + SUBPIXEL_TOLERANCE);
        // ONE line, whatever the name (`.oyl-chooser__ride-label`).
        expect(ride.height).toBeLessThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS + SUBPIXEL_TOLERANCE);
        if (onScreen) {
          expect(ride.top).toBeGreaterThanOrEqual(-SUBPIXEL_TOLERANCE);
          expect(margin).toBeGreaterThanOrEqual(viewport.insets ? CHOOSER_FOLD_FLOOR_PIXELS : 0);
          expect(ride.onTop, 'something covers Ride at its own centre').toBe(true);
        } else {
          // Ride straight after the last notice, and nothing else between:
          // what keeps it off the screen is the notices #503 needs read first.
          expect(ride.top - lastNotice).toBeGreaterThanOrEqual(0);
          expect(ride.top - lastNotice).toBeLessThanOrEqual(
            CHOOSER_NOTICE_TO_RIDE_PIXELS + SUBPIXEL_TOLERANCE,
          );
        }
      });
    }
  }

  for (const viewport of CHOOSER_VIEWPORTS) {
    test(`Ride is at least 48 × 48, as laid out and as declared — ${viewport.name}`, async ({
      page,
    }) => {
      await openChooser(page, viewport, 'chooser');
      const ride = await chooseLastAndReadRide(page);
      // The shipped box.
      expect(ride.height).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      expect(ride.width).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      // The declaration (`.oyl-button--ride`).
      expect(ride.minHeight).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      expect(ride.minWidth).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
      // The third reading, the box with the floor stripped, is the case after
      // this loop: the last route's name wraps, and a two-line Ride is over 48
      // without any floor, so it is read on the first route's one line.
    });
  }

  test('the floor is what holds Ride at 48 px — a one-line Ride, stripped', async ({ page }) => {
    await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'chooser');
    const stripped = await page.evaluate(() => {
      const ride = [
        ...document.querySelectorAll<HTMLButtonElement>('.oyl-chooser__go button'),
      ].find((each) => (each.textContent ?? '').startsWith('Ride '));
      if (ride === undefined) throw new Error('the chooser has no Ride');
      const shipped = ride.getBoundingClientRect().height;
      ride.style.minHeight = '0px';
      ride.style.minWidth = '0px';
      return {
        text: ride.textContent ?? '',
        shipped,
        stripped: ride.getBoundingClientRect().height,
      };
    });
    expect(stripped.text).toBe('Ride Harness hills');
    expect(stripped.shipped).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
    expect(stripped.stripped).toBeLessThan(CHOOSER_RIDE_TARGET_PIXELS);
  });

  test('the control — the old list puts Ride under the tablet’s floor', async ({ page }) => {
    await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'list');
    const ride = await chooseLastAndReadRide(page);
    const margin = ride.fold - ride.bottom;
    console.log(
      `#940 — the control, ${TABLET_IN_THE_SHELL_CHOOSER.name}: Ride ends ${margin.toFixed(1)} px above the fold`,
    );
    expect(margin).toBeLessThan(CHOOSER_FOLD_FLOOR_PIXELS);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`a card's focus ring is 3:1, and the arrow keys move the choice — ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'chooser');
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(colorScheme);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      let onRadio = false;
      for (let press = 0; press < 40 && !onRadio; press += 1) {
        await page.keyboard.press('Tab');
        onRadio = await page.evaluate(
          () => document.activeElement?.classList.contains('oyl-chooser__radio') ?? false,
        );
      }
      expect(onRadio, 'Tab never reached a route card').toBe(true);
      const rings = await page.evaluate(() => {
        const radio = document.activeElement as HTMLInputElement;
        const card = radio.closest('.oyl-chooser__card') as HTMLElement;
        const paintedBehind = (element: Element): string => {
          for (let at = element.parentElement; at !== null; at = at.parentElement) {
            const background = getComputedStyle(at).backgroundColor;
            if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
              return background;
            }
          }
          return getComputedStyle(document.documentElement).backgroundColor;
        };
        const read = (element: Element) => {
          const style = getComputedStyle(element);
          return {
            colour: style.outlineColor,
            style: style.outlineStyle,
            width: Number.parseFloat(style.outlineWidth),
            surface: paintedBehind(element),
          };
        };
        return {
          visible: radio.matches(':focus-visible'),
          checked: radio.checked,
          card: read(card),
          radio: read(radio),
        };
      });
      expect(rings.visible).toBe(true);
      for (const ring of [rings.card, rings.radio]) {
        expect(ring.style).toBe('solid');
        expect(ring.width).toBeGreaterThanOrEqual(2);
        expect(
          contrastRatio(hexOf(ring.colour), hexOf(ring.surface)),
          `${ring.colour} on ${ring.surface}`,
        ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
      }

      // Native radio behaviour: an arrow key moves the choice, and Ride follows.
      const rideText = () =>
        page.evaluate(
          () => [...document.querySelectorAll('.oyl-chooser__go button')].at(-1)?.textContent,
        );
      const before = await rideText();
      await page.keyboard.press('ArrowDown');
      const after = {
        ride: await rideText(),
        focused: await page.evaluate(
          () => document.activeElement?.classList.contains('oyl-chooser__radio') ?? false,
        ),
      };
      expect(after.focused).toBe(true);
      expect(after.ride).not.toBe(before);

      // The tab order is notices, Ride, the cards, the loadout: Tab leaves the
      // group for the loadout and never meets Ride again, and Shift+Tab from
      // the group lands on Ride, now named for the route just chosen.
      const where = () =>
        page.evaluate(() => {
          const element = document.activeElement;
          if (element === null) return 'nothing';
          if (element.closest('.oyl-chooser__cards') !== null) return 'card';
          if (element.closest('.oyl-chooser__loadout') !== null) return 'loadout';
          if (element.closest('.oyl-chooser__go') !== null) return 'ride';
          return 'elsewhere';
        });
      const order: string[] = [];
      for (let press = 0; press < 20; press += 1) {
        await page.keyboard.press('Tab');
        const at = await where();
        if (at !== 'loadout' && order.length > 0) break;
        order.push(at);
      }
      expect(order[0], order.join(' → ')).toBe('loadout');
      expect(order, order.join(' → ')).not.toContain('ride');
      expect(order, order.join(' → ')).not.toContain('card');
      for (let press = 0; press < 20 && (await where()) !== 'card'; press += 1) {
        await page.keyboard.press('Shift+Tab');
      }
      await page.keyboard.press('Shift+Tab');
      expect(await where()).toBe('ride');
      expect(await rideText()).toBe(after.ride);
    });
  }
});

/*
 * #940's second review — the two blockers, as hit tests with NOTHING moved.
 *
 * - **#503**: whenever *Ride* is the topmost thing at its centre, every notice
 *   above it is reached by `elementFromPoint` over its WHOLE box at
 *   `scrollY === 0`; and at every scroll position, no point of a notice that is
 *   on the screen lands on anything but the notice (the shell's sticky header
 *   over a notice scrolled under it counts as scrolled past, not obscured).
 *   The notices also stand above *Ride* on the page. Measured in all three
 *   notice states, the release fault + promise among them, at every size the
 *   review measured a pinned *Ride* over the promise.
 * - **SC 2.4.11**: with the LONGEST route name chosen, a Tab walk forwards and
 *   a Shift+Tab walk backwards through every control in the chooser, in which
 *   no focused control lies behind anything pinned anywhere in the document,
 *   or off the screen — not wholly, and not by one pixel.
 */
test.describe('#940 — the notices are never hidden while Ride is offered, and focus is never under anything pinned', () => {
  for (const notices of CHOOSER_NOTICE_STATES) {
    for (const viewport of CHOOSER_REVIEW_VIEWPORTS) {
      test(`notices ${notices}: every notice is unobscured whenever Ride is — ${viewport.name}`, async ({
        page,
      }) => {
        await openChooser(page, viewport, 'chooser', notices);
        await chooseLast(page);
        const sights = await sightsAt(page, 'sweep');
        const first = sights[0] as ChooserSight;
        const share = (notice: ChooserSight['notices'][number]) =>
          ((100 * notice.reached) / notice.points).toFixed(0);
        console.log(
          `#940 #503 notices ${notices} — ${viewport.name}: at scrollY 0 Ride ${first.rideOnTop ? 'on top' : 'not on the screen'}, ${first.notices
            .map((each) => `${each.label} ${share(each)} %`)
            .join(
              ', ',
            )}; ${String(sights.filter((each) => each.rideOnTop).length)} of ${String(sights.length)} scroll positions show Ride`,
        );
        expect(first.scrollY).toBe(0);
        expect(first.notices.map((each) => each.label)).toEqual(CHOOSER_NOTICE_LABELS[notices]);
        for (const notice of first.notices) {
          expect(notice.bottom, `${notice.label} is not above Ride`).toBeLessThanOrEqual(
            first.rideTop + SUBPIXEL_TOLERANCE,
          );
        }
        if (first.rideOnTop) {
          for (const notice of first.notices) {
            expect(
              notice.reached,
              `Ride is on the screen at scrollY 0 and ${notice.label} is ${share(notice)} % reached`,
            ).toBe(notice.points);
          }
        }
        for (const sight of sights) {
          if (!sight.rideOnTop) continue;
          for (const notice of sight.notices) {
            expect(
              notice.obscured,
              `at scrollY ${sight.scrollY.toFixed(0)}, ${notice.label} is covered while Ride is on top`,
            ).toBe(0);
          }
        }
      });
    }
  }

  for (const notices of ['promise', 'all'] as const) {
    for (const viewport of CHOOSER_REVIEW_VIEWPORTS) {
      for (const direction of ['forwards', 'backwards'] as const) {
        test(`notices ${notices}, the longest route name: Tab ${direction}, and no focused control is under anything pinned — ${viewport.name}`, async ({
          page,
        }) => {
          await openChooser(page, viewport, 'chooser', notices);
          const name = await chooseLast(page);
          expect(name.length).toBe(await maximumRouteName(page));
          const walk = await tabWalk(page, direction);
          console.log(
            `#940 Tab ${direction}, notices ${notices} — ${viewport.name}: ${walk
              .map(
                (each) =>
                  `${each.name.slice(0, 24)} ${each.covered.toFixed(0)}/${each.height.toFixed(0)}`,
              )
              .join(' | ')}`,
          );
          expect(
            walk.some((each) => each.name.startsWith('Ride ')),
            'the walk never reached Ride',
          ).toBe(true);
          expect(walk.length).toBeGreaterThanOrEqual(8);
          for (const step of walk) {
            expect(
              step.covered,
              `${step.name} is behind something pinned, or off the screen, when focused`,
            ).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
          }
        });
      }
    }
  }
});

/** `rgb(16, 22, 28)` → `#10161c`, for {@link contrastRatio}. */
function hexOf(rgb: string): string {
  const channels = /^rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
  if (channels === null) throw new Error(`not an opaque rgb() colour: ${rgb}`);
  return `#${channels
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

/*
 * #1011 — Phase 2 of epic #935: the routes as TILES (the drawing fills the
 * tile, the facts on a solid band at its foot, the chosen tile told by a tick
 * and a word as well as its edge), two columns on a tablet and one on a phone,
 * one full-width *Ride*, and the realistic world as one line. Every #940 case
 * above still runs on this layout; these read what is new.
 *
 * Its control, `?picker=list` (the old layout, one route per row), must read
 * ONE column on the tablets — which is what makes "two columns" a measurement
 * of the shipped rule rather than of the harness.
 */
const TILE_VIEWPORTS: readonly (ChooserViewport & { readonly columns: number })[] = [
  { ...(CHOOSER_VIEWPORTS[0] as ChooserViewport), columns: 1 },
  { ...(CHOOSER_VIEWPORTS[1] as ChooserViewport), columns: 1 },
  { ...TABLET_IN_THE_SHELL_CHOOSER, columns: 2 },
  { name: 'a tablet upright — 800×1280', width: 800, height: 1280, insets: false, columns: 2 },
];

interface TileReading {
  readonly columns: number;
  readonly tiles: readonly {
    readonly width: number;
    readonly shapeWidth: number;
    readonly shapeHeight: number;
    readonly shapeLeftInset: number;
    readonly bandBottomInset: number;
    readonly shapeToBand: number;
    readonly bandBackground: string;
    readonly bandText: string;
    readonly chosenMark: boolean;
    readonly chosenVisible: boolean;
    readonly doubledEdge: string;
  }[];
  readonly rideWidth: number;
  readonly goWidth: number;
  readonly rideHeight: number;
  readonly overlay: string;
}

async function readTiles(page: Page): Promise<TileReading> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('.oyl-chooser__card')];
    const firstTop = cards[0]?.getBoundingClientRect().top ?? 0;
    const columns = cards.filter(
      (card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 1,
    ).length;
    const ride = [...document.querySelectorAll<HTMLElement>('.oyl-chooser__go button')][0];
    const go = document.querySelector<HTMLElement>('.oyl-chooser__go');
    const probe = document.createElement('div');
    probe.style.background = 'var(--oyl-color-surface-overlay)';
    document.body.append(probe);
    const overlay = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      columns,
      tiles: cards.map((card) => {
        const box = card.getBoundingClientRect();
        const border = Number.parseFloat(getComputedStyle(card).borderLeftWidth);
        const shape = card.querySelector('svg.oyl-chooser__shape')?.getBoundingClientRect();
        const band = card.querySelector<HTMLElement>('.oyl-chooser__facts');
        const bandBox = band?.getBoundingClientRect();
        const mark = card.querySelector<HTMLElement>('.oyl-chooser__chosen');
        const markBox = mark?.getBoundingClientRect();
        return {
          width: box.width - 2 * border,
          shapeWidth: shape?.width ?? 0,
          shapeHeight: shape?.height ?? 0,
          shapeLeftInset: (shape?.left ?? 0) - (box.left + border),
          bandBottomInset: box.bottom - border - (bandBox?.bottom ?? 0),
          shapeToBand: (bandBox?.top ?? 0) - (shape?.bottom ?? 0),
          bandBackground: band === null ? '' : getComputedStyle(band).backgroundColor,
          bandText: band?.textContent ?? '',
          chosenMark: mark !== null,
          chosenVisible:
            mark !== null &&
            markBox !== undefined &&
            markBox.width > 0 &&
            getComputedStyle(mark).visibility === 'visible',
          doubledEdge: getComputedStyle(card, '::before').boxShadow,
        };
      }),
      rideWidth: ride?.getBoundingClientRect().width ?? 0,
      goWidth: go?.getBoundingClientRect().width ?? 0,
      rideHeight: ride?.getBoundingClientRect().height ?? 0,
      overlay,
    };
  });
}

test.describe('#1011 — route tiles, one full-width Ride, the realistic world in one line', () => {
  for (const viewport of TILE_VIEWPORTS) {
    test(`tiles in ${String(viewport.columns)} column(s), each filled by its drawing over a solid band — ${viewport.name}`, async ({
      page,
    }) => {
      await openChooser(page, viewport, 'chooser');
      const read = await readTiles(page);
      console.log(
        `#1011 ${viewport.name}: ${String(read.columns)} column(s), tile ${read.tiles[0]?.width.toFixed(0) ?? '?'} px, drawing ${read.tiles[0]?.shapeWidth.toFixed(0) ?? '?'}×${read.tiles[0]?.shapeHeight.toFixed(0) ?? '?'} px; Ride ${read.rideWidth.toFixed(0)} of ${read.goWidth.toFixed(0)} px`,
      );
      expect(read.columns).toBe(viewport.columns);
      expect(read.tiles.length).toBeGreaterThan(1);
      for (const [index, tile] of read.tiles.entries()) {
        // The drawing fills the tile, edge to edge.
        expect(Math.abs(tile.shapeLeftInset)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        expect(tile.shapeWidth).toBeGreaterThanOrEqual(tile.width - SUBPIXEL_TOLERANCE);
        expect(tile.shapeHeight).toBeGreaterThanOrEqual(100);
        // The facts on a solid band at the foot, in the declared surface.
        expect(Math.abs(tile.bandBottomInset)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        // ...and the drawing stands on it: the slack in a row is sky, above.
        expect(Math.abs(tile.shapeToBand)).toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
        expect(tile.bandBackground).toBe(read.overlay);
        expect(tile.bandText).toMatch(/ · climb .+ · steepest \d+%$/);
        // The chosen tile: a tick and a word, and the doubled edge.
        expect(tile.chosenMark).toBe(index === 0);
        if (index === 0) {
          expect(tile.chosenVisible).toBe(true);
          expect(tile.doubledEdge).toContain('inset');
        } else {
          expect(tile.doubledEdge).toBe('none');
        }
      }
      // One full-width Ride, still 48 px.
      expect(read.rideWidth).toBeGreaterThanOrEqual(read.goWidth - SUBPIXEL_TOLERANCE);
      expect(read.rideHeight).toBeGreaterThanOrEqual(CHOOSER_RIDE_TARGET_PIXELS);
    });
  }

  test('control: the old one-per-row layout reads ONE column on the tablet', async ({ page }) => {
    await openChooser(page, TABLET_IN_THE_SHELL_CHOOSER, 'list');
    expect((await readTiles(page)).columns).toBe(1);
  });

  for (const viewport of CHOOSER_VIEWPORTS) {
    test(`the realistic world is ONE line, first, and the promise’s place is last — ${viewport.name}`, async ({
      page,
    }) => {
      await openChooser(page, viewport, 'chooser', 'all');
      const line = await page.evaluate(() => {
        const world = document.querySelector<HTMLElement>('.oyl-chooser__world');
        const notices = [...document.querySelectorAll('.oyl-chooser__notices > *')];
        const summary = world?.querySelector('summary')?.getBoundingClientRect();
        const words = world?.querySelector('p');
        const range = document.createRange();
        if (words) range.selectNodeContents(words);
        return {
          slack: (words?.getBoundingClientRect().width ?? 0) - range.getBoundingClientRect().width,
          height: world?.getBoundingClientRect().height ?? 0,
          first: notices[0] === world,
          summaryHeight: summary?.height ?? 0,
          summaryWidth: summary?.width ?? 0,
          link: world?.querySelector('a')?.textContent ?? '',
        };
      });
      console.log(
        `#1011 the realistic world's line — ${viewport.name}: ${line.height.toFixed(1)} px tall, ${line.slack.toFixed(1)} px to spare beside its words`,
      );
      expect(line.first).toBe(true);
      expect(line.link).toBe('Change in Settings');
      // One row: the ⓘ's 44 px target and the border, and nothing else.
      expect(line.height).toBeLessThanOrEqual(44 + 4 + SUBPIXEL_TOLERANCE);
      expect(line.summaryHeight).toBeGreaterThanOrEqual(44);
      expect(line.summaryWidth).toBeGreaterThanOrEqual(44);
    });
  }
});
