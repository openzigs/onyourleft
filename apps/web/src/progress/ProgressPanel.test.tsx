// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Home's streaks and badges, as a rider and a screen reader meet them — #947,
 * through the real `HomeView` over a stub store.
 */

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { UnitsProvider } from '../units/context';
import { HomeView } from '../views/HomeView';

const OWNER = toAthleteId('athlete-a');
const DAY = 86_400;
const NOW = unixSeconds(1_790_000_000);

function ride(id: string, daysAgo: number, extra: Partial<StubAnalysisRide['activity']> = {}) {
  return {
    activity: stubActivity({
      id: activityId(id),
      startedAt: unixSeconds(NOW - daysAgo * DAY),
      startedAtTimeZone: 'UTC',
      movingTime: seconds(3_600),
      distance: metres(60_000),
      ...extra,
    }),
    power: Array.from({ length: 120 }, () => watts(230)),
  } satisfies StubAnalysisRide;
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function panel(): HTMLElement {
  const found = mounted?.container.querySelector<HTMLElement>('.oyl-progress');
  if (found === null || found === undefined) throw new Error('no badges panel');
  return found;
}

describe('Home — streaks and badges (#947)', () => {
  it('reads each badge as a sentence, in the rider’s units, and says the streak in words', async () => {
    const port = stubAnalysis(OWNER, [
      ride('a', 8, { rideFacts: { ascent: metres(700) } }),
      ride('b', 1, { rideFacts: { ascent: metres(400), workoutFinished: true } }),
    ]);
    mounted = await mount(
      <UnitsProvider units="imperial">
        <HomeView analysis={port} controller={undefined} now={() => NOW} />
      </UnitsProvider>,
    );
    await settle();
    const text = panel().textContent;
    expect(text).toContain('You have ridden in 2 weeks running. Your longest run is 2 weeks.');
    const badges = [...panel().querySelectorAll('li')].map((each) => each.textContent);
    // 120 km ridden: the 100 km badge, said in miles.
    expect(badges.some((each) => each.startsWith('62 mi ridden in all'))).toBe(true);
    expect(badges.some((each) => each.startsWith('3,281 ft climbed in all'))).toBe(true);
    expect(badges.some((each) => each.startsWith('First workout finished'))).toBe(true);
    expect(badges.some((each) => each.startsWith('First ride'))).toBe(true);
    // The medal is decoration; the words are the badge.
    for (const mark of panel().querySelectorAll('svg')) {
      expect(mark.getAttribute('aria-hidden')).toBe('true');
    }
    // No streak is ever said to be lost.
    expect(text).not.toMatch(/\blost\b|\bbroke|\bmissed\b/i);
    // No read of its own: Home's one list read, and no channel decoded.
    expect(port.listReads).toHaveLength(1);
    expect(port.channelReads).toEqual([]);
  });

  it('a streak that has ended reads as the next one to start', async () => {
    const port = stubAnalysis(OWNER, [ride('a', 30), ride('b', 23)]);
    mounted = await mount(<HomeView analysis={port} controller={undefined} now={() => NOW} />);
    await settle();
    expect(panel().textContent).toContain(
      'Your next ride starts a new streak. Your longest run is 2 weeks.',
    );
  });

  it('looks at older rides only on a press, and then reads Home again', async () => {
    const port = stubAnalysis(OWNER, [
      ride('a', 2, { averagePower: watts(230) }),
      ride('b', 1, { rideFacts: {} }),
    ]);
    mounted = await mount(<HomeView analysis={port} controller={undefined} now={() => NOW} />);
    await settle();
    expect(panel().textContent).toContain(
      '1 ride from before badges has not been looked at for climbing and best power yet.',
    );
    expect(port.channelReads).toEqual([]);
    const button = [...panel().querySelectorAll('button')].find(
      (each) => each.textContent === 'Look at older rides',
    );
    if (button === undefined) throw new Error('no button');
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    await settle();
    expect(port.factsWrites).toEqual(['a']);
    expect(port.listReads).toHaveLength(2);
    expect(panel().textContent).not.toContain('has not been looked at');
  });
});
