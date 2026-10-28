// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A Delivery round on the HUD — #1812: rendered by the HUD the game mounts
 * and read back from its text, the way a screen reader reads it — each field
 * as its term and its definition, and the one live region as the sentence
 * the announcer's core produced. Audited at each state.
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

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { endRound, recordDelivery, recordMiss, startRound, type Round } from '../delivery/round';
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
import type { DeliveryHud } from './fields';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

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

function panel(delivery: DeliveryHud | undefined, announcement = ''): JSX.Element {
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

const WEEK = { day: 2, houses: 6, score: 6 } as const;

/** The caller's loop, once: offer what is owed, take what the core said into the region. */
function heard(
  owed: DeliveryOwed,
  state: AnnouncerState,
  now: number,
): { readonly owed: DeliveryOwed; readonly state: AnnouncerState; readonly sentence: string } {
  const said = announce(state, {
    now,
    readings: [],
    events: deliveryEvents(owed),
    // #1812: Delivery follows the setting, so announcements on, every reading never.
    preference: {
      ...DEFAULT_ANNOUNCEMENTS,
      enabled: true,
      powerEverySeconds: 'never',
      distanceEvery: 'never',
    },
  });
  return {
    owed: deliverySpoken(owed, said.kind),
    state: said.state,
    sentence: said.sentence ?? '',
  };
}

describe('a Delivery round on the HUD — #1812', () => {
  it('shows the houses left with the delivered and missed counts, and the score with the day, and audits clean', async () => {
    const round = recordMiss(recordDelivery(startRound(6), 0), 1);
    mounted = await mount(panel({ round, week: WEEK }));
    expect(field('Houses')).toBe('Houses 4 left 1 delivered, 1 missed');
    expect(field('Score')).toBe('Score 1 Day 2 of 7');
    // In the secondary readings, where a screen reader meets them after the ride's own.
    const secondary = document.querySelector('[aria-label="Ride readings"]');
    expect(text(secondary)).toContain('Houses');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('changes the rendered counts when a parcel lands — the text, not only the state', async () => {
    const round = startRound(6);
    mounted = await mount(panel({ round, week: WEEK }));
    expect(field('Houses')).toBe('Houses 6 left 0 delivered, 0 missed');
    expect(field('Score')).toBe('Score 0 Day 2 of 7');
    await mounted.rerender(panel({ round: recordDelivery(round, 0), week: WEEK }));
    expect(field('Houses')).toBe('Houses 5 left 1 delivered, 0 missed');
    expect(field('Score')).toBe('Score 1 Day 2 of 7');
  });

  it('is absent from an ordinary ride, whose HUD is unchanged', async () => {
    const labels = (): string[] =>
      [...document.querySelectorAll('.oyl-hud__field dt')].map((each) => text(each));
    mounted = await mount(panel(undefined));
    const ordinary = { labels: labels(), text: text(document.querySelector('.oyl-hud')) };
    expect(field('Houses')).toBeUndefined();
    expect(field('Score')).toBeUndefined();
    expect(document.querySelector('.oyl-hud__field--delivery')).toBeNull();
    mounted.unmount();
    // The same HUD with a round: the round's two fields, last, and nothing else changed.
    mounted = await mount(panel({ round: startRound(6), week: WEEK }));
    expect(labels()).toEqual([...ordinary.labels, 'Houses', 'Score']);
    for (const each of document.querySelectorAll('.oyl-hud__field--delivery')) {
      each.remove();
    }
    expect(text(document.querySelector('.oyl-hud'))).toBe(ordinary.text);
  });

  it('speaks a delivery, a crash and the round’s end through the one region, with announcements on, and audits clean', async () => {
    let round: Round = startRound(3);
    let owed = NOTHING_OWED;
    let state = INITIAL_ANNOUNCER;
    const said: string[] = [];
    mounted = await mount(panel({ round, week: WEEK }));

    const delivered = recordDelivery(round, 0);
    owed = oweCrash(oweRoundChange(owed, round, delivered));
    round = delivered;
    for (const now of [0, 1, 2, 3, 4, 5, 6]) {
      const next = heard(owed, state, now);
      owed = next.owed;
      state = next.state;
      if (next.sentence !== '') {
        said.push(next.sentence);
        await mounted.rerender(panel({ round, week: WEEK }, next.sentence));
        expect(text(region())).toBe(next.sentence);
        expect(region()?.getAttribute('role')).toBe('status');
        expect(formatViolations(auditAccessibility(document))).toBe('');
      }
    }
    const ended = recordMiss(recordMiss(round, 1), 2);
    owed = oweRoundOver(owed, ended, endRound(WEEK, ended));
    for (const now of [7, 8, 9, 10]) {
      const next = heard(owed, state, now);
      owed = next.owed;
      state = next.state;
      if (next.sentence !== '') {
        said.push(next.sentence);
        await mounted.rerender(panel({ round: ended, week: WEEK }, next.sentence));
        expect(text(region())).toBe(next.sentence);
      }
    }
    expect(said).toEqual([
      'Crashed into an obstacle.',
      'Delivered to the 1st house. 2 houses left.',
      'Round over: 1 of 3 houses delivered, a score of 1. The round on day 3 has 1 house.',
    ]);
    // The region is the only live region on the HUD, with the round on it.
    expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
    expect(field('Houses')).toBe('Houses 0 left 1 delivered, 2 missed');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
