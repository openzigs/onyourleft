// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The ride page's group ride debrief, read back through the real path** —
 * #3310, ADR 0101 D-5.8.
 *
 * Every ride here is saved through `recording/finish.ts` as the ride
 * controller saves it, every handle is closed, and the page is opened on a
 * connection that never wrote it, for the athlete it is opened as. So a
 * debrief drawn from anything but the saved ride — the ride's in-memory
 * state, gone after a reload — has nothing to draw from and goes red.
 *
 * `group-ride-debrief.test.ts` holds what each line counts; the
 * accessibility audit of the section is `GroupRideDebriefSection.a11y.test.tsx`.
 */

import {
  metresPerSecond,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import {
  activityId,
  openActivityStore,
  type ActivityId,
  type AthleteId,
  type GroupRideFact,
  type StreamChannelValue,
  type UnitSystem,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rideToSave, saveFinishedRide } from '../recording/finish';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { UnitsProvider } from '../units/context';
import { ActivityDetailView, READING_RIDE_TEXT } from '../views/ActivityDetailView';

import { GROUP_RIDE_DEBRIEF_WORDS } from './GroupRideDebriefSection';
import { bannedWordIn } from '../privacy/no-medical-wording';
import { GROUP_RIDE_WAITED, installFakeIntersectionObserver } from './testing';

const RIDE_A = activityId('group-ride-a');
const RIDE_B = activityId('group-ride-b');
const PLAIN = activityId('no-group-ride');
const STARTED = unixSeconds(Date.UTC(2026, 10, 27, 8) / 1000);
const SAMPLES = 600;
const READ_TURNS = 200;

/** Athlete B's group ride: one pull, and nothing like A's. */
const B_FACT: GroupRideFact = {
  version: 2,
  seed: 99,
  startedAt: 0,
  ridden: 300,
  targetSpeed: 36 / 3.6,
  bots: 3,
  log: [
    { at: 0, phase: 'steady', role: 'on-front', groupSpeed: 10 },
    { at: 45, phase: 'changing', role: 'drifting-back', groupSpeed: 10 },
    { at: 75, phase: 'steady', role: 'last-wheel', groupSpeed: 10 },
  ],
};

let harness: StoreHarness;
let mounted: Mounted | undefined;
let observers: ReturnType<typeof installFakeIntersectionObserver> | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  observers = installFakeIntersectionObserver();
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  observers?.restore();
  observers = undefined;
  await harness.destroy();
});

/** Ten minutes at `speed`, a second apart. */
function series(speed: number): RecordedSeries<StreamChannelValue> {
  return {
    startedAt: STARTED,
    sampleInterval: seconds(1),
    sampleCount: SAMPLES,
    channels: {
      power: Array.from({ length: SAMPLES }, () => watts(150)),
      speed: Array.from({ length: SAMPLES }, () => metresPerSecond(speed)),
    },
    pauses: [],
  };
}

/** Save a ride through `finish.ts`, as the ride controller does. */
async function save(input: {
  readonly id: ActivityId;
  readonly athlete: AthleteId;
  readonly groupRide?: GroupRideFact;
  readonly speed?: number;
}): Promise<void> {
  const finished = rideToSave({
    id: input.id,
    athleteId: input.athlete,
    series: series(input.speed ?? 7.5),
    elapsedTime: seconds(SAMPLES),
    movingTime: seconds(SAMPLES),
    timeZone: 'Etc/UTC',
    now: unixSeconds(STARTED + SAMPLES),
    draft: { drafted: input.groupRide !== undefined },
    ...(input.groupRide === undefined ? {} : { groupRide: input.groupRide }),
  });
  const outcome = await harness.write(async (store) => saveFinishedRide(store, finished));
  expect(outcome).toStrictEqual({ status: 'saved', id: input.id });
}

interface OpenedPage {
  /** Each of the debrief's terms, with what it says. `undefined` with no debrief. */
  readonly debrief: Readonly<Record<string, string>> | undefined;
  /** The debrief's whole text, `''` with none. */
  readonly text: string;
  readonly headings: readonly string[];
  readonly body: string;
}

/** Open `id`'s page as `athlete`, from a fresh store with every handle closed. */
async function openPage(
  athlete: AthleteId,
  id: ActivityId,
  units: UnitSystem = 'metric',
): Promise<OpenedPage> {
  await harness.discard();
  const store = openActivityStore(harness.databaseName);
  try {
    mounted = await mount(
      <UnitsProvider units={units}>
        <ActivityDetailView port={{ athleteId: athlete, store }} activityId={id} />
      </UnitsProvider>,
    );
    for (let turn = 0; (document.body.textContent ?? '').includes(READING_RIDE_TEXT); turn += 1) {
      if (turn >= READ_TURNS) throw new Error('the ride’s page was still reading its ride');
      await settle();
    }
    const section = document.querySelector('[data-oyl-group-debrief]');
    const debrief =
      section === null
        ? undefined
        : Object.fromEntries(
            queryAll(section, 'dl > div').map((row) => [
              row.querySelector('dt')?.textContent ?? '',
              row.querySelector('dd')?.textContent ?? '',
            ]),
          );
    return {
      debrief,
      text: section?.textContent ?? '',
      headings: queryAll(document, 'h2, h3').map((heading) => heading.textContent ?? ''),
      body: document.body.textContent ?? '',
    };
  } finally {
    mounted?.unmount();
    mounted = undefined;
    store.close();
  }
}

const W = GROUP_RIDE_DEBRIEF_WORDS;

describe('the group ride debrief on the ride page — #3310', () => {
  it('shows the pulls and times the scripted ride produced, read back from a fresh store', async () => {
    await save({ id: RIDE_A, athlete: ATHLETE_A, groupRide: GROUP_RIDE_WAITED });
    const page = await openPage(ATHLETE_A, RIDE_A);
    expect(page.headings).toContain(W.heading);
    expect(page.debrief).toStrictEqual({
      [W.pulls]: '2',
      [W.averagePull]: '1:30',
      [W.front]: '3:00',
      [W.draft]: '5:30',
      [W.withGroup]: '9:00',
      [W.gapsOpened]: '1',
      [W.gapsClosed]: '1',
      [W.target]: '30.0 km/h',
      [W.ridden]: `27.0 km/h ${W.riddenNote}`,
    });
    // ADR 0066 D-5: the ride keeps its "Draft" row beside it.
    expect(page.body).toContain('Draft');
  });

  it('ends the group ride where its own clock did, not where the recording did', async () => {
    // The group's clock stopped 30 s before the recording's: a HUD pause, or a ride on alone.
    await save({
      id: RIDE_A,
      athlete: ATHLETE_A,
      groupRide: { ...GROUP_RIDE_WAITED, ridden: 570 },
    });
    const page = await openPage(ATHLETE_A, RIDE_A);
    // The last entry, sitting in from 540 s, is 30 s and not 60.
    expect(page.debrief?.[W.draft]).toBe('5:00');
    expect(page.debrief?.[W.withGroup]).toBe('8:30');
  });

  it('shows no debrief and no empty heading for a ride with no group ride', async () => {
    await save({ id: PLAIN, athlete: ATHLETE_A });
    const page = await openPage(ATHLETE_A, PLAIN);
    expect(page.debrief).toBeUndefined();
    expect(page.headings).not.toContain(W.heading);
    // The page itself is drawn, as before: its own headings are there.
    expect(page.headings).toContain('Traces');
    expect(page.headings).toContain('Laps');
  });

  it('never shows another athlete’s debrief: the read filters on the owning athlete', async () => {
    await save({ id: RIDE_A, athlete: ATHLETE_A, groupRide: GROUP_RIDE_WAITED });
    await save({ id: RIDE_B, athlete: ATHLETE_B, groupRide: B_FACT, speed: 9 });
    const mine = await openPage(ATHLETE_A, RIDE_A);
    expect(mine.debrief?.[W.pulls]).toBe('2');
    expect(mine.debrief?.[W.target]).toBe('30.0 km/h');
    // B's ride, opened as A: not found, and nothing of B's debrief.
    const theirs = await openPage(ATHLETE_A, RIDE_B);
    expect(theirs.debrief).toBeUndefined();
    expect(theirs.body).toContain('No ride on this device has that id.');
    expect(theirs.body).not.toContain('36.0 km/h');
    // B's own page has it: the fixture's second debrief is real.
    const hers = await openPage(ATHLETE_B, RIDE_B);
    expect(hers.debrief?.[W.pulls]).toBe('1');
    expect(hers.debrief?.[W.front]).toBe('0:45');
    expect(hers.debrief?.[W.target]).toBe('36.0 km/h');
  });

  it('shows the target and the ridden averages in the rider’s units, apart where the group waited', async () => {
    await save({ id: RIDE_A, athlete: ATHLETE_A, groupRide: GROUP_RIDE_WAITED });
    const metric = await openPage(ATHLETE_A, RIDE_A, 'metric');
    const imperial = await openPage(ATHLETE_A, RIDE_A, 'imperial');
    expect(imperial.debrief?.[W.target]).toBe('18.6 mph');
    expect(imperial.debrief?.[W.ridden]).toBe(`16.8 mph ${W.riddenNote}`);
    for (const page of [metric, imperial]) {
      const target = page.debrief?.[W.target] ?? '';
      const ridden = (page.debrief?.[W.ridden] ?? '').replace(W.riddenNote, '').trim();
      expect(target).not.toBe('');
      expect(ridden).not.toBe('');
      expect(ridden).not.toBe(target);
    }
  });
});

describe('what the debrief may say — #3310, ADR 0101 D-5.8', () => {
  /** Every string the section can draw: its words, and the page's text in both units. */
  async function everything(): Promise<readonly string[]> {
    await save({ id: RIDE_A, athlete: ATHLETE_A, groupRide: GROUP_RIDE_WAITED });
    await save({
      id: RIDE_B,
      athlete: ATHLETE_A,
      groupRide: { ...GROUP_RIDE_WAITED, logCut: true },
    });
    const drawn: string[] = [...Object.values(GROUP_RIDE_DEBRIEF_WORDS)];
    for (const units of ['metric', 'imperial'] as const) {
      for (const id of [RIDE_A, RIDE_B]) {
        const page = await openPage(ATHLETE_A, id, units);
        expect(page.text).not.toBe('');
        drawn.push(
          page.text,
          ...Object.keys(page.debrief ?? {}),
          ...Object.values(page.debrief ?? {}),
        );
      }
    }
    return drawn;
  }

  it('no load-metric name, no medical or body wording, no praise and no urging', async () => {
    const drawn = await everything();
    // The cut log's line is drawn, so it is screened too.
    expect(drawn.some((each) => each.includes(W.logCut))).toBe(true);
    for (const text of drawn) {
      expect(text, text).not.toMatch(/\b(?:NP|TSS|IF|CTL|ATL|TSB)\b/);
      expect(text, text).not.toMatch(
        /normali[sz]ed\s+power|training\s+stress|intensity\s+factor|training\s+load|fitness|fatigue|form\b/i,
      );
      expect(bannedWordIn(text), text).toBeUndefined();
      expect(text, text).not.toMatch(
        /\b(?:heart|cardiac|doctors?|injur\w*|pain\w*|health\w*|tired|exhaust\w*|lactate|breath\w*|calories?|weight|body|legs?|lungs?|muscles?|strong|weak\w*|unfit|fit)\b/i,
      );
      expect(text, text).not.toMatch(
        /\b(?:great|well\s+done|good|nice|awesome|brilliant|impressive|proud|congrat\w*|harder|faster|push\w*|next\s+time|try\s+to|should|must|improve\w*|better|worse)\b/i,
      );
    }
  });

  it('no place and no coordinate', async () => {
    const drawn = await everything();
    for (const text of drawn) {
      expect(text, text).not.toMatch(/°|\b(?:lat|lon|lng|latitude|longitude)\b/i);
      // A coordinate's run of decimals: no figure here has more than one.
      expect(text, text).not.toMatch(/\d+\.\d{2,}/);
      expect(text, text).not.toMatch(
        /\b(?:road|street|avenue|lane|hill|park|bridge|town|city|village|route|near|at\s+the)\b/i,
      );
    }
  });
});
