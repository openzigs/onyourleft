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

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  seconds,
  unixSeconds,
  watts,
  type RoutePoint,
  type UnixSeconds,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId as toAthleteId,
  recordingSessionId,
  type RouteRecord,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { HISTORY_ACTIVITY_LIMIT } from '../analysis/history';
import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import type { RoutePort } from '../routes/store-port';
import { routeStub, stubRouteId } from '../routes/testing';
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

function ride(
  id: string,
  daysAgo: number,
  extra: Partial<Parameters<typeof stubActivity>[0]> = {},
): StubAnalysisRide {
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
      ...extra,
    }),
  };
}

/** A saved route over a hill, 4 km long, climbing 80 m — `shape-cards.test.tsx`'s. */
function savedRoute(id: string, createdBy = OWNER): RouteRecord {
  const points: RoutePoint[] = [];
  for (let along = 0; along <= 4000; along += 25) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + along / 111_195),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(30 + 80 * Math.sin((Math.PI * along) / 8000)),
    });
  }
  return {
    id: stubRouteId(id),
    createdBy,
    name: 'Up the hill',
    profile: routeProfile(points),
    visibility: 'private',
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
  };
}

async function openHome(
  rides: readonly StubAnalysisRide[],
  snapshot = idleSnapshot(),
  routes?: RoutePort,
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
        routes={routes}
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

/** The last ride's section, by its heading. */
function lastRide(): Element {
  const section = document.getElementById('oyl-home-last')?.closest('section');
  if (section === null || section === undefined) {
    throw new Error('no last-ride section');
  }
  return section;
}

/**
 * The load metrics' familiar names, which are registered trademarks
 * (docs/agents/scope-and-ip.md §6) — as whole words, so "IF" is not found inside "different".
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

  it('draws no distance, never "0.0 km", for a ride that stored none — #1070', async () => {
    // `recording/finish.ts` §`distanceOf` stores 0 m for a ride recorded with
    // no speed channel: no distance known, as the Activities card reads it.
    await openHome([ride('still', 2, { distance: metres(0) })]);
    const terms = [...lastRide().querySelectorAll('dt')].map((t) => t.textContent);
    expect(terms).toEqual(['When', 'Moving time', 'Load']);
    expect(text()).not.toMatch(/0\.0\s*km/);
    expectClean('home, a ride with no distance');
  });

  it('shows no load 0 for a ride stored from a power channel that read 0 W — #1070', async () => {
    await openHome([ride('zero', 2, { effortWeightedPower: watts(0) })]);
    const readings = [...lastRide().querySelectorAll('.oyl-reading__value')].map(
      (reading) => reading.textContent,
    );
    expect(readings).toEqual(['50:00', '30.0']);
    expect(text()).toContain('not worked out yet');
    expect(text()).toContain('No ride here has a load yet');
  });

  it('says a ride with nothing to work a load out from has none, and offers no Analysis — #1084', async () => {
    await openHome([
      ride('marked', 2, { effortWeightedPower: undefined, loadCoveredTime: seconds(0) }),
    ]);
    const load = [...lastRide().querySelectorAll('dt')].find((t) => t.textContent === 'Load');
    expect(load?.nextElementSibling?.textContent).toBe(
      'none: nothing on this ride to work one out from',
    );
    expect(text()).not.toContain('not worked out yet');
    expect(text()).toContain('No ride here has a load, so there is nothing to smooth');
    expect(text()).not.toContain('can work them out');
    // No invented zero anywhere in the last ride's facts.
    const readings = [...lastRide().querySelectorAll('.oyl-reading__value')].map(
      (reading) => reading.textContent,
    );
    expect(readings).toEqual(['50:00', '30.0']);
    expectClean('home, a ride with no load to work out');
  });

  it('still says "not worked out yet" beside a ride with nothing to work out — #1084', async () => {
    await openHome([
      ride('marked', 3, { effortWeightedPower: undefined, loadCoveredTime: seconds(0) }),
      ride('bare', 2, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
    ]);
    expect(text()).toContain('not worked out yet');
    expect(text()).toContain('Analysis can work them out');
  });

  it('keeps the Analysis link when the history was cut short — #1084', async () => {
    // Every ride inside the window is marked; the one past it has no summary
    // at all, and only Analysis can work it out.
    const marked = Array.from({ length: HISTORY_ACTIVITY_LIMIT }, (_unused, index) =>
      ride(`m${String(index)}`, HISTORY_ACTIVITY_LIMIT + 10 - index, {
        effortWeightedPower: undefined,
        loadCoveredTime: seconds(0),
      }),
    );
    await openHome([
      ...marked,
      ride('past', 1, { effortWeightedPower: undefined, loadCoveredTime: undefined }),
    ]);
    expect(text()).not.toContain('nothing on any of them was enough');
    expect(text()).toContain('Analysis can work them out');
  });

  it('full: the week and the fitness sentences, from the same words Analysis uses', async () => {
    await openHome(
      Array.from({ length: 40 }, (_unused, index) => ride(`r${String(index)}`, 40 - index)),
    );
    expect(text()).toContain('This week');
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
    // Next up's three layers, the cards' eight, the trainer's glyph and the ring.
    expect(pictures.length).toBeGreaterThanOrEqual(13);
    for (const picture of pictures) {
      expect(
        picture.closest('[aria-hidden="true"]'),
        picture.outerHTML.slice(0, 80),
      ).not.toBeNull();
      expect(picture.querySelectorAll('text, title, desc')).toHaveLength(0);
      expect((picture.textContent ?? '').trim()).toBe('');
    }
    expect(document.querySelector('.oyl-next-up__art')?.getAttribute('aria-hidden')).toBe('true');
    for (const art of document.querySelectorAll('.oyl-ride-card__art')) {
      expect(art.getAttribute('aria-hidden')).toBe('true');
    }
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

describe('next up — #1010', () => {
  const nextUp = (): Element | null => document.querySelector('.oyl-next-up');
  const rideLink = (): HTMLAnchorElement | null =>
    document.querySelector<HTMLAnchorElement>('.oyl-next-up a.oyl-next-up__ride');

  it('offers the route the newest route ride was on, drawn from its profile, in words beside it', async () => {
    const routes = routeStub(OWNER, [savedRoute('hill')]);
    await openHome(
      [
        ride('old', 5, { routeId: stubRouteId('hill') }),
        // A later free ride does not hide the route.
        ride('new', 1),
      ],
      idleSnapshot(),
      routes,
    );
    expect(nextUp()?.querySelector('h2')?.textContent).toBe('Next up');
    expect(nextUp()?.querySelector('.oyl-next-up__name')?.textContent).toBe('Up the hill');
    expect(nextUp()?.textContent).toContain('The route you rode last: 4.0 km, climb 80 m.');
    expect(rideLink()?.textContent).toBe('Ride');
    expect(rideLink()?.getAttribute('href')).toBe('#/game?route=hill');
    expect(rideLink()?.getAttribute('aria-describedby')).toBe('oyl-next-up-name');
    expect(nextUp()?.querySelector('.oyl-next-up__profile')).not.toBeNull();
    // Words carry the meaning: the picture says nothing to assistive technology.
    expect(nextUp()?.querySelector('.oyl-next-up__art')?.getAttribute('aria-hidden')).toBe('true');
    // The first control on the screen.
    expect(document.querySelector('main a, main button')).toBe(rideLink());
    expectClean('home, next up on a route');
  });

  it('offers a free ride when no ride was on a route', async () => {
    await openHome([ride('only', 2)], idleSnapshot(), routeStub(OWNER));
    expect(nextUp()?.querySelector('.oyl-next-up__name')?.textContent).toBe('A free ride');
    expect(rideLink()?.getAttribute('href')).toBe(hrefFor(routeById('ride')));
    expect(nextUp()?.querySelector('.oyl-next-up__profile')).toBeNull();
    expectClean('home, next up free');
  });

  it('offers the first ride to a rider with nothing ridden', async () => {
    await openHome([], idleSnapshot(), routeStub(OWNER));
    expect(nextUp()?.querySelector('.oyl-next-up__name')?.textContent).toBe('Your first ride');
    expect(rideLink()?.getAttribute('href')).toBe(hrefFor(routeById('ride')));
    expectClean('home, next up first');
  });

  it('falls back to a free ride when the route was deleted, or is another athlete’s', async () => {
    const routes = routeStub(OWNER, [savedRoute('theirs', toAthleteId('athlete-b'))]);
    await openHome([ride('gone', 3, { routeId: stubRouteId('deleted') })], idleSnapshot(), routes);
    expect(nextUp()?.querySelector('.oyl-next-up__name')?.textContent).toBe('A free ride');
    mounted?.unmount();
    await openHome([ride('theirs', 3, { routeId: stubRouteId('theirs') })], idleSnapshot(), routes);
    expect(nextUp()?.querySelector('.oyl-next-up__name')?.textContent).toBe('A free ride');
  });

  it('falls back to a free ride, with no error on the screen, when the route cannot be read', async () => {
    const routes = routeStub(OWNER, [savedRoute('hill')]);
    const failing: RoutePort = {
      athleteId: OWNER,
      store: { ...routes.store, getRoute: () => Promise.reject(new Error('no store')) },
    };
    await openHome([ride('r', 3, { routeId: stubRouteId('hill') })], idleSnapshot(), failing);
    expect(nextUp()?.querySelector('.oyl-next-up__name')?.textContent).toBe('A free ride');
    expect(text()).not.toContain('could not be read');
  });
});

describe('this week, against the week before — #1010', () => {
  it('sets each figure beside the seven days before', async () => {
    await openHome([ride('before-a', 9), ride('before-b', 12), ride('this', 2)]);
    const week = document.querySelector('.oyl-home__week');
    expect(week?.querySelector('h2')?.textContent).toBe('This week');
    const befores = [...(week?.querySelectorAll('.oyl-home__before') ?? [])].map(
      (each) => each.textContent,
    );
    expect(befores).toEqual(['Week before: 2', 'Week before: 1:40:00', 'Week before: 200']);
    expectClean('home, this week');
  });
});
