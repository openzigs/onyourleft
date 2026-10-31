// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A lap race on the HUD — #1904: rendered by the HUD the game mounts, the
 * race driven through the model (`lap-race-testing.ts`), and read back from
 * the document the way a screen reader reads it — each field as its term and
 * its definition, the standings as a labelled list, and **the one live region
 * as its text content**, never as a call to a spy. Audited at each state.
 *
 * The caller's loop is `GameView`'s for Delivery (#1816): step the race, owe
 * what changed, offer what is owed to the real core, put what it said in the
 * region, settle it. #1906 is what runs that loop in a ride.
 */

import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type ItemRaceState,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';

import { INITIAL_ANNOUNCER, announce, type AnnouncerState } from './announce';
import { DEFAULT_ANNOUNCEMENTS } from './announce-preference';
import { HudPanel } from './HudPanel';
import {
  PLACE_ANNOUNCE_SECONDS,
  lapRaceEvents,
  lapRaceOwedAtStart,
  lapRaceSpoken,
  oweRaceTick,
  type LapRaceOwed,
} from './lap-race-announce';
import { lapRaceStandings } from './lap-race-hud';
import { BOTS, RIDER, holding, hudOf, startRace, tick } from './lap-race-testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A loop's worth of road, as the HUD's own tests draw one. */
function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
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

/** The HUD with the race on it, its standings panel open, and `announcement` in the region. */
function panel(race: ItemRaceState, announcement: string): JSX.Element {
  const hud = hudOf(race);
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
        lapRace={hud}
        standings={lapRaceStandings(hud)}
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
function region(): Element | null {
  return document.querySelector('[data-oyl-announcer="hud"]');
}

/** The rider's loop, rendered: every sentence the core says is read back out of the region. */
class Ride {
  race: ItemRaceState;
  owed: LapRaceOwed;
  state: AnnouncerState = INITIAL_ANNOUNCER;
  /** What the region said, read off the document. */
  readonly heard: string[] = [];

  constructor(race: ItemRaceState) {
    this.race = race;
    this.owed = lapRaceOwedAtStart(race, RIDER);
  }

  async step(
    seconds: number,
    rider: number,
    bots: readonly number[],
    uses: readonly string[] = [],
  ): Promise<void> {
    const before = this.race;
    const effortDistances: Record<string, number> = { [RIDER]: rider };
    BOTS.forEach((id, index) => {
      effortDistances[id] = bots[index] ?? 0;
    });
    this.race = tick(before, { atMs: seconds * 1_000, effortDistances, uses });
    this.owed = oweRaceTick(this.owed, before, this.race, RIDER, uses.includes(RIDER));
    const said = announce(this.state, {
      now: seconds,
      readings: [],
      events: lapRaceEvents(this.owed, seconds),
      // A lap race follows the setting, as Delivery does: announcements on, every reading never.
      preference: {
        ...DEFAULT_ANNOUNCEMENTS,
        enabled: true,
        powerEverySeconds: 'never',
        distanceEvery: 'never',
      },
    });
    this.state = said.state;
    this.owed = lapRaceSpoken(this.owed, said.kind, seconds);
    if (said.sentence !== undefined) {
      await mounted?.rerender(panel(this.race, said.sentence));
      expect(region()?.getAttribute('role')).toBe('status');
      this.heard.push(text(region()));
    }
  }
}

describe('a lap race on the HUD — #1904', () => {
  it('shows the place, the lap and the item, with the standings panel open, and audits clean', async () => {
    let race = startRace({ laps: 3 });
    race = tick(race, {
      atMs: 1_000,
      effortDistances: { [RIDER]: 120, 'bot-1': 130, 'bot-2': 110, 'bot-3': 100 },
    });
    mounted = await mount(panel(race, ''));
    expect(field('Place')).toBe('Place 2 of 4 Lap 1 of 3');
    expect(field('Item')).toBe('Item None');
    const standings = document.querySelector('[aria-label="Race standings"]');
    expect(text(standings?.querySelector('p'))).toBe('You are 2 of 4.');
    expect([...(standings?.querySelectorAll('li') ?? [])].map((line) => text(line))).toEqual([
      '1 Brisk bot 1 −1 s 3.0 W/kg',
      '2 You 3.2 W/kg',
      '3 Steady bot 2 +1 s 2.3 W/kg',
      '4 Fierce bot 3 +2 s 4.5 W/kg',
    ]);
    expect(standings?.querySelector('[aria-current="true"]')?.textContent).toContain('You');
    // ADR 0051 D-7: the standings are not a live region, and the HUD has one.
    expect(standings?.closest('[role="status"], [aria-live]')).toBeNull();
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('warns of a hit coming in words and with the outline’s shape, never a tint alone, and audits clean', async () => {
    let race = startRace({ laps: 3 });
    race = tick(race, {
      atMs: 1_000,
      effortDistances: { [RIDER]: 100, 'bot-1': 80, 'bot-2': 10, 'bot-3': 10 },
    });
    race = holding(race, 'bot-1', 'crosswind-gust');
    race = holding(race, RIDER, 'tailwind');
    mounted = await mount(panel(race, ''));
    expect(field('Item')).toBe('Item Tailwind Gust behind you');
    const item = [...document.querySelectorAll('.oyl-hud__field')].find(
      (each) => text(each.querySelector('dt')) === 'Item',
    );
    expect(item?.classList.contains('oyl-hud__field--alert')).toBe(true);
    // The warning is said by the field's own words, inside its definition.
    expect(text(item?.querySelector('.oyl-hud__detail'))).toBe('Gust behind you');
    expect(formatViolations(auditAccessibility(document))).toBe('');
    // And it goes when the hit has landed: no alert outline, no words.
    const hit = tick(race, {
      atMs: 2_000,
      effortDistances: { [RIDER]: 110, 'bot-1': 90 },
      uses: ['bot-1'],
    });
    await mounted.rerender(panel(hit, ''));
    expect(field('Item')).toBe('Item Tailwind');
    expect(document.querySelector('.oyl-hud__field--alert')).toBeNull();
  });

  it('reads a hit and a lap back out of the live region, as a screen reader hears them', async () => {
    // Laps of 300 m, so the first is done in half a minute of riding.
    let race = startRace({ laps: 3, lap: 300 });
    race = holding(race, 'bot-1', 'crosswind-gust');
    const ride = new Ride(race);
    mounted = await mount(panel(ride.race, ''));
    await ride.step(1, 10, [5, 0, 0]);
    // bot-1, 5 m behind in the rider's lane, uses its gust.
    await ride.step(2, 20, [15, 0, 0], ['bot-1']);
    for (let second = 3; second <= 40; second += 1) {
      await ride.step(second, second * 10, [second * 9, second * 8, second * 7]);
    }
    expect(ride.heard).toContain('Hit by a crosswind gust.');
    expect(ride.heard).toContain('Lap 1 of 3 done. You are 1 of 4.');
    expect(ride.heard.indexOf('Hit by a crosswind gust.')).toBeLessThan(
      ride.heard.indexOf('Lap 1 of 3 done. You are 1 of 4.'),
    );
    expect(field('Place')).toBe('Place 1 of 4 Lap 2 of 3');
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says the item a pick-up gives once: never again at a pick-up passed holding it, and again when one is used and another drawn in the same tick', async () => {
    // Laps of 1 000 m: pick-ups at 250, 500 and 750 m. The bots stay behind, so no place is owed.
    const ride = new Ride(startRace({ laps: 3 }));
    mounted = await mount(panel(ride.race, ''));
    await ride.step(1, 100, [50, 40, 30]);
    await ride.step(6, 260, [60, 50, 40]);
    const items = (): string[] => ride.heard.filter((each) => each.startsWith('You have '));
    const first = ride.race.racers.find((entry) => entry.racer.id === RIDER)?.held;
    expect(first).not.toBeNull();
    expect(items()).toHaveLength(1);
    // Past the second pick-up still holding it: it draws nothing and nothing is said.
    await ride.step(11, 510, [70, 60, 50]);
    await ride.step(16, 600, [80, 70, 60]);
    expect(ride.race.racers.find((entry) => entry.racer.id === RIDER)?.held).toBe(first);
    expect(items()).toHaveLength(1);
    // Used in the tick that passes the third, and another drawn: that one is said.
    await ride.step(21, 760, [90, 80, 70], [RIDER]);
    await ride.step(26, 800, [100, 90, 80]);
    expect(ride.race.racers.find((entry) => entry.racer.id === RIDER)?.held).not.toBeNull();
    expect(items()).toHaveLength(2);
    expect(field('Item')).toMatch(/^Item /);
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it(`overtaking five times in two seconds reads at most one change of place out of the region (one per ${String(PLACE_ANNOUNCE_SECONDS)} s)`, async () => {
    const ride = new Ride(startRace({ laps: 50, lap: 10_000, itemsOn: false }));
    mounted = await mount(panel(ride.race, ''));
    // Settle the place off the line, then let the window and the interval run out.
    await ride.step(1, 10, [5, 0, 0]);
    expect(ride.heard).toEqual(['You are 1 of 4.']);
    await ride.step(1 + PLACE_ANNOUNCE_SECONDS, 100, [90, 0, 0]);
    const from = ride.heard.length;
    const start = 1 + PLACE_ANNOUNCE_SECONDS;
    // Five overtakes between bot-1 and the rider in two seconds.
    for (let swap = 1; swap <= 5; swap += 1) {
      const at = start + swap * 0.4;
      const rider = 100 + swap * 4;
      await ride.step(at, rider, [rider + (swap % 2 === 1 ? 1 : -1), 0, 0]);
    }
    const places = ride.heard.slice(from).filter((each) => each.startsWith('You are '));
    expect(places.length).toBeLessThanOrEqual(1);
    expect(places).toEqual(['You are 2 of 4.']);
    // And thirty seconds of it reads one change of place per interval, at most.
    for (let swap = 6; swap <= 80; swap += 1) {
      const at = start + swap * 0.4;
      const rider = 100 + swap * 4;
      await ride.step(at, rider, [rider + (swap % 2 === 1 ? 1 : -1), 0, 0]);
    }
    const all = ride.heard.slice(from).filter((each) => each.startsWith('You are '));
    expect(all.length).toBeLessThanOrEqual(Math.ceil((80 * 0.4) / PLACE_ANNOUNCE_SECONDS));
  });
});
