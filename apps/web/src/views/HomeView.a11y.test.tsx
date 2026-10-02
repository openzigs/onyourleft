// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The home screen — #428 — in its three states, rendered through the real
 * shell and audited.
 *
 * `routes.a11y.test.tsx` already opens `/` and audits it, and there it is the
 * shell with no ports: the "no local store" branch. This file is the other
 * branches — empty, one ride, a full history, a trainer, a ride left
 * unfinished — because a screen audited only in its failure state has not
 * been audited.
 */

import { metres, seconds, unixSeconds, watts, type UnixSeconds } from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId, recordingSessionId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

const OWNER = toAthleteId('athlete-a');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const DAY = 86_400;
const NOW: UnixSeconds = unixSeconds(1_790_000_000);

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function ride(id: string, daysAgo: number): StubAnalysisRide {
  return {
    activity: stubActivity({
      id: activityId(id),
      name: `Ride ${id}`,
      startedAt: unixSeconds(NOW - daysAgo * DAY),
      startedAtTimeZone: 'UTC',
      movingTime: seconds(3000),
      distance: metres(30_000),
      effortWeightedPower: watts(200),
      loadCoveredTime: seconds(3600),
    }),
  };
}

async function openHome(
  rides: readonly StubAnalysisRide[],
  snapshot = idleSnapshot(),
): Promise<void> {
  globalThis.location.hash = '#/';
  // `Date.now()` is the home screen's clock; held so "this week" is stable.
  const realNow = Date.now;
  Date.now = () => NOW * 1000;
  try {
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        analysis={stubAnalysis(OWNER, rides)}
        rideController={stubRideController(snapshot).controller}
      />,
    );
    await settle();
    await settle();
  } finally {
    Date.now = realNow;
  }
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(
    violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`,
    `accessibility violations on ${where}`,
  ).toBe('');
}

const text = (): string => document.querySelector('main')?.textContent ?? '';

/**
 * The load metrics' familiar names, which are registered trademarks
 * (CLAUDE.md §6) — as whole words, so "IF" is not found inside "different".
 */
const TRADEMARKED =
  /\b(NP|TSS|IF|CTL|ATL|TSB|Normali[sz]ed Power|Training Stress|Intensity Factor|Chronic Training Load|Acute Training Load)\b/;

describe('the home screen — #428', () => {
  it('opens on Home, with the Ride screen one activation away', async () => {
    await openHome([]);
    expect(document.querySelector('h1')?.textContent).toBe('Home');
    const start = queryAll<HTMLAnchorElement>(document.body, 'main a').find(
      (link) => link.textContent === 'Start a ride',
    );
    expect(start?.getAttribute('href')).toBe(hrefFor(routeById('ride')));
  });

  it('empty: says what to do, as links, and draws no empty ride cards', async () => {
    await openHome([]);
    expect(text()).toContain('Nothing recorded yet');
    for (const destination of ['devices', 'ride', 'transfer'] as const) {
      expect(
        document.querySelector(`main a[href="${hrefFor(routeById(destination))}"]`),
      ).not.toBeNull();
    }
    expect(text()).not.toContain('Last ride');
    expect(text()).not.toContain('The last seven days');
    expectClean('home, empty');
  });

  it('one ride: describes it, in the rider’s units', async () => {
    await openHome([ride('only', 2)]);
    expect(text()).toContain('Last ride');
    expect(text()).toContain('Ride only');
    expect(text()).toContain('30.0 km');
    expect(text()).toContain('50:00');
    expect(text()).not.toContain('Nothing recorded yet');
    // #992: every figure in the last ride's facts is a reading — large
    // numerals, and the unit in its own small label.
    const readings = [...document.querySelectorAll('.oyl-home__facts .oyl-reading')].map(
      (reading) => [
        reading.querySelector('.oyl-reading__value')?.textContent,
        reading.querySelector('.oyl-reading__unit')?.textContent ?? null,
      ],
    );
    expect(readings).toEqual(
      expect.arrayContaining([
        ['50:00', null],
        ['30.0', 'km'],
      ]),
    );
    expectClean('home, one ride');
  });

  it('full: the week and the fitness sentences, from the same words Analysis uses', async () => {
    await openHome(
      Array.from({ length: 40 }, (_unused, index) => ride(`r${String(index)}`, 40 - index)),
    );
    expect(text()).toContain('The last seven days');
    expect(text()).toMatch(/Fitness \d+/);
    expect(text()).toMatch(/Fatigue \d+/);
    expect(text()).toMatch(/Freshness -?\d+/);
    expectClean('home, full');
  });

  it('never says one of the trademarked metric names', async () => {
    await openHome(
      Array.from({ length: 40 }, (_unused, index) => ride(`r${String(index)}`, 40 - index)),
    );
    // Text node by text node: `textContent` runs a `<dt>` into its `<dd>`
    // ("TSS71"), and a word boundary between two of them does not exist.
    // Found by the mutation that put one in — the whole-body match missed it.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (TRADEMARKED.test(node.textContent ?? '')) found.push(node.textContent ?? '');
    }
    expect(found).toEqual([]);
  });

  it('says what the trainer is doing, and offers the unfinished ride', async () => {
    await openHome([ride('only', 2)], {
      ...ridingSnapshot(),
      recoverable: [
        {
          id: recordingSessionId('left-over'),
          kind: 'interrupted',
          startedAt: unixSeconds(NOW - 3600),
          lastWrittenAt: unixSeconds(NOW - 600),
          spannedSeconds: 3000,
          spanned: '50:00',
          canContinue: true,
          alreadySaved: false,
        },
      ],
    });
    expect(text()).toContain('A ride left unfinished');
    expect(text()).toContain('this app has control');
    expectClean('home, trainer and a leftover ride');
  });

  it('tells a rider with no trainer, and one without control, what to do next', async () => {
    await openHome([]);
    expect(text()).toContain('No trainer paired');
    mounted?.unmount();
    await openHome([], {
      ...idleSnapshot(),
      trainer: { ...idleSnapshot().trainer, paired: true, controllable: true },
    });
    expect(text()).toContain('has not been given control');
  });

  it('says so when there has been no ride this week, and when no ride has a load yet', async () => {
    const old = ride('old', 30);
    await openHome([
      {
        activity: { ...old.activity, effortWeightedPower: undefined, loadCoveredTime: undefined },
      },
    ]);
    expect(text()).toContain('No rides in the last seven days.');
    expect(text()).toContain('No ride here has a load yet');
    expect(text()).toContain('not worked out yet');
  });
});

describe('the illustrated home — #939', () => {
  const cards = (): HTMLLIElement[] => [
    ...document.querySelectorAll<HTMLLIElement>('main .oyl-home__rides > li'),
  ];

  it('offers three ride cards, each a heading, a line and ONE link, to the three places a ride starts', async () => {
    await openHome([]);
    const found = cards().map((card) => ({
      heading: card.querySelector('h3')?.textContent,
      links: [...card.querySelectorAll('a, button, input, select, textarea')].map((control) => [
        control.textContent,
        control.getAttribute('href'),
      ]),
    }));
    expect(found).toEqual([
      { heading: 'Free ride', links: [['Start a ride', hrefFor(routeById('ride'))]] },
      { heading: 'Ride a route', links: [['Choose a route', hrefFor(routeById('game'))]] },
      { heading: 'Workout', links: [['Choose a workout', hrefFor(routeById('workouts'))]] },
    ]);
    expectClean('home, the ride cards');
  });

  it('draws its pictures from the kit: hidden from assistive technology, no word in them, and no <img>', async () => {
    await openHome([ride('only', 2)]);
    const main = document.querySelector('main');
    expect(main?.querySelectorAll('img')).toHaveLength(0);
    const pictures = [...(main?.querySelectorAll('svg') ?? [])];
    // The hero's three layers, the cards' eight, the trainer's glyph and the ring.
    expect(pictures.length).toBeGreaterThanOrEqual(12);
    for (const picture of pictures) {
      expect(
        picture.closest('[aria-hidden="true"]'),
        picture.outerHTML.slice(0, 80),
      ).not.toBeNull();
      expect(picture.querySelectorAll('text, title, desc')).toHaveLength(0);
      expect((picture.textContent ?? '').trim()).toBe('');
    }
    expect(document.querySelector('.oyl-home-hero')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the trainer’s sentence and its link to Devices (#659) when no trainer is paired', async () => {
    await openHome([]);
    const trainer = document.querySelector('[aria-labelledby="oyl-home-trainer"]');
    expect(trainer?.textContent).toContain('No trainer paired.');
    expect(trainer?.querySelector(`a[href="${hrefFor(routeById('devices'))}"]`)?.textContent).toBe(
      'Pair one on Devices',
    );
  });

  it('says how many of the last seven days were ridden, beside a ring that draws the same share', async () => {
    await openHome([ride('a', 5), ride('b', 2), ride('c', 2), ride('d', 30)]);
    expect(text()).toContain('You rode on 2 of the last seven days.');
    const fill = document.querySelector('.oyl-home__ring-fill');
    const [drawn, whole] = (fill?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
    expect((drawn ?? 0) / (whole ?? 1)).toBeCloseTo(2 / 7, 5);
  });

  it('never says "0 of the last seven days" above a ride: one window for both — #939 second review', async () => {
    // 23:00 UTC on the seventh calendar day back — inside 168 h of NOW, which
    // is 14:13 UTC. Under the old pair of windows this was "Rides 1" beneath
    // "You rode on 0 of the last seven days."
    await openHome([
      {
        activity: stubActivity({
          id: activityId('edge'),
          name: 'Ride edge',
          startedAt: unixSeconds(NOW - (NOW % DAY) - 6 * DAY - 3600),
          startedAtTimeZone: 'UTC',
          movingTime: seconds(3000),
          distance: metres(30_000),
        }),
      },
    ]);
    expect(text()).not.toMatch(/You rode on 0 of/);
    expect(text()).toContain('No rides in the last seven days.');
  });
});
