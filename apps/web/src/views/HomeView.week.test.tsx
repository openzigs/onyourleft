// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Home's week module — #2049 — over the **real** local store.
 *
 * Rides are written through the store (`@onyourleft/store/testing`) on three
 * days of this week and one of the week before, Home is opened through the
 * real shell over a fresh connection, and the days are read back from what
 * the module RENDERS: the table beside the chart, and the chart's own bars.
 *
 * ⚠️ **The bars say nothing the table does not.** Every bar is a day the
 * table gives a moving time for, and every bar is the same one-class shape
 * with no colour of its own — so colour is not a signal at all (SC 1.4.1).
 */

import { metres, seconds, unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { idleSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const DAY = 86_400;
/** 2027-01-15, a Friday, at 12:00 UTC. */
const NOW: UnixSeconds = unixSeconds(1_800_014_400);

let harness: StoreHarness | undefined;
let mounted: Mounted | undefined;
afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  await harness?.destroy();
  harness = undefined;
});

/** A ride `daysAgo` before NOW, at the same hour, in UTC. */
function rideOn(id: string, daysAgo: number, movingMinutes: number, kilometres: number) {
  return rideFor(ATHLETE_A, {
    id: activityId(id),
    name: `Ride ${id}`,
    startedAt: unixSeconds(NOW - daysAgo * DAY - 3600),
    startedAtTimeZone: 'UTC',
    movingTime: seconds(movingMinutes * 60),
    elapsedTime: seconds(movingMinutes * 60),
    distance: metres(kilometres * 1000),
  });
}

interface Seen {
  readonly rows: readonly (readonly string[])[];
  readonly bars: readonly {
    readonly day: string | null;
    readonly classes: string;
    readonly fill: string | null;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly units: boolean;
    readonly value: string | null;
    readonly valueX: number;
    readonly valueBottom: number;
  }[];
  readonly values: readonly (string | null)[];
  readonly facts: string;
}

/** The value laid over one day's bar, and where (percent of the plot). */
function valueOf(
  week: Element | null,
  day: string | null,
): { readonly value: string | null; readonly valueX: number; readonly valueBottom: number } {
  const value = week?.querySelector<HTMLElement>(
    `.oyl-week-chart__value[data-oyl-week-day="${day ?? ''}"]`,
  );
  return {
    value: value?.textContent ?? null,
    valueX: Number.parseFloat(value?.style.left ?? ''),
    valueBottom: Number.parseFloat(value?.style.bottom ?? ''),
  };
}

async function openWeek(rides: readonly ReturnType<typeof rideOn>[]): Promise<Seen> {
  const open = createStoreHarness();
  harness = open;
  await seedAthletes(open);
  await open.write(async (store) => {
    for (const ride of rides) await store.putActivity(ride);
  });
  return open.read(async (store) => {
    globalThis.location.hash = '#/';
    const realNow = Date.now;
    Date.now = () => NOW * 1000;
    try {
      mounted = await mount(
        <AppShell
          capabilities={NO_BLUETOOTH}
          analysis={{ athleteId: ATHLETE_A, store }}
          rideController={stubRideController(idleSnapshot()).controller}
        />,
      );
      await settle();
      await settle();
    } finally {
      Date.now = realNow;
    }
    const week = document.querySelector('main section.oyl-home__week');
    return {
      rows: [...(week?.querySelectorAll('table tbody tr') ?? [])].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
      ),
      bars: [...(week?.querySelectorAll('.oyl-week-chart rect') ?? [])].map((bar) => ({
        day: bar.getAttribute('data-oyl-week-day'),
        classes: bar.getAttribute('class') ?? '',
        fill: bar.getAttribute('fill'),
        // Percent of the drawing (the owner's review: the chart is the card's
        // width, with no viewBox to stretch its values).
        x: Number.parseFloat(bar.getAttribute('x') ?? ''),
        y: Number.parseFloat(bar.getAttribute('y') ?? ''),
        width: Number.parseFloat(bar.getAttribute('width') ?? ''),
        height: Number.parseFloat(bar.getAttribute('height') ?? ''),
        units: [bar.getAttribute('x'), bar.getAttribute('height')].every((each) =>
          (each ?? '').endsWith('%'),
        ),
        // The value written over this bar: the one for the same day.
        ...valueOf(week, bar.getAttribute('data-oyl-week-day')),
      })),
      values: [...(week?.querySelectorAll('.oyl-week-chart__value') ?? [])].map(
        (value) => value.textContent,
      ),
      facts: week?.querySelector('.oyl-home__facts')?.textContent ?? '',
    };
  });
}

describe('Home’s week, day by day — #2049', () => {
  it('reads three days’ rides and moving time from the table, and three bars from the chart', async () => {
    const seen = await openWeek([
      rideOn('mon', 4, 45, 18),
      rideOn('wed', 2, 90, 41.5),
      rideOn('wed-2', 2, 30, 10),
      rideOn('fri', 0, 60, 25),
      // The week before: on no day of this week's table, and no bar.
      rideOn('last-week', 9, 200, 80),
    ]);

    expect(seen.rows).toEqual([
      ['Saturday 9 Jan', '0', '0:00'],
      ['Sunday 10 Jan', '0', '0:00'],
      ['Monday 11 Jan', '1', '45:00'],
      ['Tuesday 12 Jan', '0', '0:00'],
      ['Wednesday 13 Jan', '2', '2:00:00'],
      ['Thursday 14 Jan', '0', '0:00'],
      ['Today', '1', '1:00:00'],
    ]);
    expect(seen.bars.map((bar) => bar.day)).toEqual(['2027-01-11', '2027-01-13', '2027-01-15']);
    // The geometry, in percent of the drawing: the longest day (Wed, 120 min)
    // fills the 70 % of its height the bars are given, the others are their
    // share of it, and each bar sits in its own day's column (a seventh of the
    // width, the bar its middle 60 %): Mon is the third, Wed the fifth, today
    // the seventh.
    expect(seen.bars.every((bar) => bar.units)).toBe(true);
    expect(seen.bars.map((bar) => bar.height)).toEqual([26.25, 70, 35]);
    expect(seen.bars.map((bar) => bar.y)).toEqual([73.75, 30, 65]);
    expect(seen.bars.map((bar) => bar.x)).toEqual([31.429, 60, 88.571]);
    expect(seen.bars.map((bar) => bar.width)).toEqual([8.571, 8.571, 8.571]);
    // The owner's review (2026-11-05): a value on each bar — that day's moving
    // time, over its own bar's middle — and none where there is no bar.
    expect(seen.bars.map((bar) => bar.value)).toEqual(['0:45', '2:00', '1:00']);
    expect(seen.values).toEqual(['0:45', '2:00', '1:00']);
    for (const bar of seen.bars) {
      // Over the bar's middle, its foot on the bar's top.
      expect(bar.valueX).toBeCloseTo(bar.x + bar.width / 2, 2);
      expect(bar.valueBottom).toBeCloseTo(bar.height, 2);
    }
    // The totals, in text: rides, moving time and distance.
    expect(seen.facts).toContain('Rides4');
    expect(seen.facts).toContain('3:45:00');
    expect(seen.facts).toMatch(/Distance94\.5\skm/);
  });

  it('gives no bar a colour or a class of its own — the height is the only thing it says, and the table says it too', async () => {
    const seen = await openWeek([rideOn('a', 1, 30, 10), rideOn('b', 3, 75, 30)]);
    expect(seen.bars.length).toBe(2);
    for (const bar of seen.bars) {
      expect(bar.classes).toBe('oyl-week-chart__bar');
      expect(bar.fill).toBeNull();
    }
    // Every barred day is a day the table gives a moving time for.
    const ridden = seen.rows.filter((cells) => cells[2] !== '0:00').length;
    expect(ridden).toBe(seen.bars.length);
  });
});
