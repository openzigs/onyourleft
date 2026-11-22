// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A level's own throw window on the HUD — #2931, ADR 0065 D-4.1: a level
 * round and a round on a rider's own route, ridden step by step through the
 * real `ride-round.ts` on the synthetic town, and read back from the HUD the
 * game mounts as a screen reader reads it — the next-house field where the
 * window opens, and the one live region where a house is missed. Audited at
 * each state.
 */

import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { deliveryTown } from '../delivery/delivery-town-testing';
import {
  nextHouse,
  startDeliveryRide,
  stepDeliveryRide,
  type DeliveryRide,
} from '../delivery/ride-round';
import { DELIVERY_TICK_SECONDS, THROW_WINDOW_AFTER_METRES } from '../delivery/throw';
import { atStartLine } from '../simulation';

import { INITIAL_ANNOUNCER, announce, type AnnouncerState } from './announce';
import { DEFAULT_ANNOUNCEMENTS, type PreferenceStorage } from './announce-preference';
import {
  NOTHING_OWED,
  deliveryEvents,
  deliverySpoken,
  oweRoundChange,
  type DeliveryOwed,
} from './delivery-announce';
import { HudPanel } from './HudPanel';

const town = deliveryTown();

/** Narrower than the throw's own at both edges. */
const NARROW = { beforeMetres: 10, afterMetres: 0.5 } as const;

const SPEED = 8;

let mounted: Mounted | undefined;

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 2_931;
      return array;
    },
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
});

function storage(): PreferenceStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** A round in the town with no obstacle on it: a level's with {@link NARROW}, or the week's. */
function round(level: boolean): DeliveryRide {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    lineOffset: 0,
    storage: storage(),
    ...(level
      ? {
          level: {
            houses: 5,
            hazardsPerKilometre: { static: 0, moving: 0 },
            lengthMetres: 2_000,
            id: 'test-level',
            throwWindow: NARROW,
          },
        }
      : {}),
  });
  if (ride === undefined) throw new Error('the town gave no round');
  return { ...ride, obstacles: [], obstacleState: { tick: 0, startedAt: [], crashed: [] } };
}

/** A ride, what is owed to be said of it, and the announcer: the caller's loop in `GameView`. */
interface Riding {
  readonly ride: DeliveryRide;
  readonly owed: DeliveryOwed;
  readonly state: AnnouncerState;
  readonly now: number;
  /** The last sentence the announcer said, `''` until one is. */
  readonly sentence: string;
}

/** Ride on at {@link SPEED} to `along`, one step a call, owing each change and offering it as `GameView` does. */
function rideTo(riding: Riding, along: number): Riding {
  let { ride, owed, state, now, sentence } = riding;
  while (ride.along < along - 1e-9) {
    const stepped = stepDeliveryRide(ride, {
      ticks: 1,
      along: Math.min(along, ride.along + SPEED * DELIVERY_TICK_SECONDS),
      speed: SPEED,
    }).ride;
    owed = oweRoundChange(owed, ride.round, stepped.round);
    ride = stepped;
    now += DELIVERY_TICK_SECONDS;
    const said = announce(state, {
      now,
      readings: [],
      events: deliveryEvents(owed),
      preference: {
        ...DEFAULT_ANNOUNCEMENTS,
        enabled: true,
        powerEverySeconds: 'never',
        distanceEvery: 'never',
      },
    });
    owed = deliverySpoken(owed, said.kind);
    state = said.state;
    if (said.sentence !== undefined) sentence = said.sentence;
  }
  return { ride, owed, state, now, sentence };
}

function begin(level: boolean): Riding {
  return { ride: round(level), owed: NOTHING_OWED, state: INITIAL_ANNOUNCER, now: 0, sentence: '' };
}

function panel(riding: Riding): JSX.Element {
  const profile = town.profile;
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement={riding.sentence}
        delivery={{
          round: riding.ride.round,
          week: riding.ride.week,
          score: riding.ride.score,
          next: nextHouse(riding.ride),
        }}
      />
    </main>
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The field labelled `label`, as a screen reader hears it: its term, then its definition. */
function field(label: string): string | undefined {
  const found = [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === label,
  );
  return found === undefined
    ? undefined
    : `${text(found.querySelector('dt'))} ${text(found.querySelector('dd'))}`;
}

/** The HUD's one live region. */
function region(): string {
  return text(document.querySelector('[data-oyl-announcer="hud"]'));
}

/** Which side the round's first house is on, in the HUD's words. */
function sideOf(ride: DeliveryRide): string {
  return ride.targets[0]?.side === 1 ? 'on the right' : 'on the left';
}

describe('a level’s own throw window on the HUD — #2931', () => {
  it('counts the next house down to where the level’s window opens, and says to throw from there', async () => {
    const level = begin(true);
    const own = begin(false);
    const first = level.ride.targets[0]?.distance ?? 0;
    const ownFirst = own.ride.targets[0]?.distance ?? 0;
    // 3 m short of the level's opening edge: inside the throw's own window, outside the level's.
    const short = rideTo(level, first - NARROW.beforeMetres - 3);
    mounted = await mount(panel(short));
    expect(field('Next house')).toBe(`Next house 3 m ${sideOf(level.ride)}`);
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // The same place on a rider's own route is inside its house's window.
    await mounted.rerender(panel(rideTo(own, ownFirst - NARROW.beforeMetres - 3)));
    expect(field('Next house')).toBe(`Next house Throw now, ${sideOf(own.ride)}`);
    // At the level's own opening edge, it says to throw.
    await mounted.rerender(panel(rideTo(short, first - NARROW.beforeMetres)));
    expect(field('Next house')).toBe(`Next house Throw now, ${sideOf(level.ride)}`);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says a house is missed where the level’s window closes, through the one live region', async () => {
    const level = begin(true);
    const own = begin(false);
    const first = level.ride.targets[0]?.distance ?? 0;
    const ownFirst = own.ride.targets[0]?.distance ?? 0;
    const houses = level.ride.targets.length;
    // At the level's closing edge: nothing said yet.
    const atClose = rideTo(level, first + NARROW.afterMetres);
    mounted = await mount(panel(atClose));
    expect(region()).toBe('');
    // Past it, and the round says the miss.
    const past = rideTo(atClose, first + NARROW.afterMetres + 0.2);
    await mounted.rerender(panel(past));
    expect(region()).toBe(`Missed the 1st house. ${String(houses - 1)} houses left.`);
    expect(field('Houses')).toBe(`Houses ${String(houses - 1)} left 0 delivered, 1 missed`);
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // A rider's own route, the same way past its house, is still in its window: nothing said.
    const ownPast = rideTo(own, ownFirst + NARROW.afterMetres + 0.2);
    await mounted.rerender(panel(ownPast));
    expect(region()).toBe('');
    expect(field('Next house')).toBe(`Next house Throw now, ${sideOf(own.ride)}`);
    // And past the throw's own closing edge, it says the miss as before.
    const ownMissed = rideTo(ownPast, ownFirst + THROW_WINDOW_AFTER_METRES + 0.2);
    await mounted.rerender(panel(ownMissed));
    expect(region()).toMatch(/^Missed the 1st house\. /);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
