// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * No place in words — #1812, DL11 and ADR 0055: a Delivery round ridden over
 * a synthetic town whose buildings carry a name and an address, through the
 * real throw (`delivery/throw.ts`), the real round, the real announcer's core
 * and the real HUD, and **nothing a rider can see or hear names either**.
 *
 * ⚠️ The town's name and address fields are carried as far as a careless
 * caller would carry them: onto every throw target, and onto the object the
 * HUD is handed. So a HUD or a sentence that formatted what it was handed,
 * rather than the counts it declares, is red here. What is read back is the
 * whole HUD's text and every attribute on it, and every sentence the core
 * said — the two ways a ride says anything to a rider.
 */

import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, type Mounted } from '../../testing/mount';
import {
  FRESH_WEEK,
  endRound,
  recordMiss,
  startRound,
  type Round,
  type WeekProgress,
} from '../delivery/round';
import {
  CARRIAGEWAY_HALF_WIDTH_METRES,
  DELIVERY_TICK_SECONDS,
  NO_PARCELS,
  PARCEL_THROW_SPEED_METRES_PER_SECOND,
  THROW_WINDOW_AFTER_METRES,
  stepThrows,
  type ThrowSide,
  type ThrowState,
  type ThrowTarget,
} from '../delivery/throw';
import { atStartLine } from '../simulation';

import { INITIAL_ANNOUNCER, announce, type AnnouncerState } from './announce';
import { DEFAULT_ANNOUNCEMENTS } from './announce-preference';
import {
  NOTHING_OWED,
  deliveryEvents,
  deliverySpoken,
  oweCrash,
  oweRoundChange,
  oweRoundOver,
  type DeliveryOwed,
} from './delivery-announce';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A building as a town's map data might describe it: a name and an address. */
interface TownBuilding {
  readonly name: string;
  readonly 'addr:housenumber': string;
  readonly 'addr:street': string;
  readonly 'addr:postcode': string;
  readonly along: number;
  readonly side: ThrowSide;
  readonly clear: number;
}

const TOWN: readonly TownBuilding[] = [
  ['Rose Cottage', '27b', 'Larkspur Lane', 'ZQ9 4XW', 100, 'left'],
  ['The Old Forge', '31d', 'Larkspur Lane', 'ZQ9 4XW', 160, 'right'],
  ['Hawthorn Lodge', '8a', 'Quillon Row', 'ZQ9 7YV', 220, 'left'],
  ['Mill View', '64c', 'Quillon Row', 'ZQ9 7YV', 280, 'right'],
  ['Wrenfield', '113e', 'Pemberly Close', 'ZQ8 2TT', 340, 'left'],
].map(([name, number, street, postcode, along, side]) => ({
  name: name as string,
  'addr:housenumber': number as string,
  'addr:street': street as string,
  'addr:postcode': postcode as string,
  along: along as number,
  side: side as ThrowSide,
  clear: 2,
}));

/** Every word of every name and address field, and each field whole. */
const FORBIDDEN: readonly string[] = TOWN.flatMap((building) => [
  building.name,
  building['addr:housenumber'],
  building['addr:street'],
  building['addr:postcode'],
  `${building['addr:housenumber']} ${building['addr:street']}`,
  ...building.name.split(' ').filter((word) => word.length > 3),
  ...building['addr:street'].split(' '),
]);

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 50; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();

function panel(delivery: { round: Round; week: WeekProgress }, announcement: string): JSX.Element {
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={PROFILE}
        state={atStartLine(PROFILE)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement={announcement}
        delivery={delivery}
      />
    </main>
  );
}

/** Everything the HUD shows or exposes: its text, and every attribute on every element. */
function everythingOnTheHud(): string {
  const parts = [document.body.textContent ?? ''];
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of element.attributes) parts.push(attribute.value);
  }
  return parts.join('\n');
}

const SPEED = 8;

describe('no place in words — #1812, DL11', () => {
  it('names no building and no address on the HUD or in a sentence, over a whole round', async () => {
    // The targets carry the town's fields, as a careless pick would leave them.
    const targets: readonly (ThrowTarget & TownBuilding)[] = TOWN.map((building, position) => ({
      ...building,
      position,
    }));
    // A parcel reaches its target's depth this far along from its throw.
    const lead =
      (SPEED * (CARRIAGEWAY_HALF_WIDTH_METRES + 2)) / PARCEL_THROW_SPEED_METRES_PER_SECOND;
    const throwAt = new Map([0, 1, 3].map((position) => [position, TOWN[position]!.along - lead]));
    const week: WeekProgress = { ...FRESH_WEEK, houses: TOWN.length };

    let round: Round = startRound(TOWN.length);
    let throws: ThrowState = NO_PARCELS;
    let owed: DeliveryOwed = NOTHING_OWED;
    let state: AnnouncerState = INITIAL_ANNOUNCER;
    let announcement = '';
    const said: string[] = [];
    const shown: string[] = [];
    const thrown = new Set<number>();

    // The HUD is handed the town too, beside what it declares.
    const hud = (): { round: Round; week: WeekProgress; town: typeof TOWN } => ({
      round,
      week,
      town: TOWN,
    });
    mounted = await mount(panel(hud(), announcement));

    const speak = (now: number): void => {
      const heard = announce(state, {
        now,
        readings: [],
        events: deliveryEvents(owed),
        preference: DEFAULT_ANNOUNCEMENTS,
      });
      state = heard.state;
      owed = deliverySpoken(owed, heard.kind);
      if (heard.sentence !== undefined) {
        said.push(heard.sentence);
        announcement = heard.sentence;
      }
    };

    const lastTick = Math.ceil(400 / SPEED / DELIVERY_TICK_SECONDS);
    for (let tick = 0; tick <= lastTick; tick += 1) {
      const along = SPEED * tick * DELIVERY_TICK_SECONDS;
      let throwTo: ThrowSide | undefined;
      for (const [position, at] of throwAt) {
        if (!thrown.has(position) && along >= at) {
          thrown.add(position);
          throwTo = TOWN[position]!.side;
        }
      }
      // And one parcel thrown to the wrong side of the road: wasted.
      if (tick === 300) throwTo = 'right';
      const step = stepThrows(throws, {
        rider: { along, speed: SPEED },
        targets,
        round,
        ...(throwTo === undefined ? {} : { throwTo }),
      });
      throws = step.state;
      let next = step.round;
      // A house whose window has closed with no delivery is missed.
      for (const target of targets) {
        if (
          next.houses[target.position] === 'expecting' &&
          along > target.along + THROW_WINDOW_AFTER_METRES
        ) {
          next = recordMiss(next, target.position);
        }
      }
      owed = oweRoundChange(owed, round, next);
      if (tick === 200) owed = oweCrash(owed);
      const changed = next !== round;
      round = next;
      const before = announcement;
      speak(tick * DELIVERY_TICK_SECONDS);
      if (changed || announcement !== before) {
        await mounted.rerender(panel(hud(), announcement));
        shown.push(everythingOnTheHud());
      }
    }

    owed = oweRoundOver(round, endRound(week, round));
    const end = lastTick * DELIVERY_TICK_SECONDS;
    for (let now = end; now <= end + 10; now += 1) speak(now);
    await mounted.rerender(panel(hud(), announcement));
    shown.push(everythingOnTheHud());

    // Not vacuous: the round was ridden, and the HUD and the region said so.
    expect(round.houses).toEqual(['delivered', 'delivered', 'missed', 'delivered', 'missed']);
    expect(said).toContain('Delivered to the 1st house. 4 houses left.');
    expect(said).toContain('Missed the 3rd house. 2 houses left.');
    expect(said).toContain('Crashed into an obstacle.');
    expect(said.at(-1)).toMatch(/^Round over: 3 of 5 houses delivered/);
    expect(shown.at(-1)).toContain('Houses');
    expect(shown.at(-1)).toContain('3\u00a0delivered, 2\u00a0missed');

    const leaks = FORBIDDEN.filter((word) =>
      [...said, ...shown].some((each) => each.includes(word)),
    );
    expect(leaks).toEqual([]);
  });
});
