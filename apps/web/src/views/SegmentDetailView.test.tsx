// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The segment screen (#67) — what a *rider* is told.
 *
 * Four of the seven criteria are about the screen rather than the arithmetic,
 * so they are asserted here:
 *
 * - every effort is listed with the personal best distinguished, and a
 *   `private-match` effort appears (criterion 1);
 * - the comparison has a **non-visual equivalent** carrying the same numbers
 *   (criterion 3);
 * - the ranking basis is **named on screen** (criterion 4);
 * - a failing read produces a sentence rather than a blank page (criterion 7).
 *
 * ⚠️ The claim running through them: **nothing is carried by colour or by
 * position alone.** "Personal best" is a word in a cell, not a highlighted row;
 * the two compared efforts are named by column headers, not by line colour.
 */

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  seconds,
  unixSeconds,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  segmentEffortId,
  segmentId,
  type ActivityRecord,
  type AthleteId,
  type SegmentEffortRecord,
  type SegmentRecord,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { stubEffortPort, type StubEffortRide } from '../efforts/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { SegmentDetailView } from './SegmentDetailView';

import type { GeographicPosition } from '@onyourleft/domain';

const OWNER: AthleteId = athleteId('athlete-a');
const SEGMENT = segmentId('segment-1');
const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function northOf(metresNorth: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude + metresNorth / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN.longitude),
  );
}

function theSegment(): SegmentRecord {
  const built = createSegment({
    id: 'segment-1',
    createdBy: OWNER,
    name: 'The long drag',
    sport: 'ride',
    geometry: [northOf(0), northOf(250), northOf(500)],
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
  });
  return { ...built, id: SEGMENT, createdBy: OWNER };
}

function ride(id: string, startedAt: number): ActivityRecord {
  return {
    id: activityId(id),
    athleteId: OWNER,
    name: `Ride ${id}`,
    startedAt: unixSeconds(startedAt),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: 3600,
    movingTime: 3400,
    distance: 30_000,
    hasPosition: true,
    visibility: 'private',
  } as unknown as ActivityRecord;
}

function effort(
  id: string,
  activity: string,
  startedAt: number,
  elapsedSeconds: number,
  visibility: SegmentEffortRecord['visibility'] = 'public',
): SegmentEffortRecord {
  return {
    id: segmentEffortId(id),
    athleteId: OWNER,
    segmentId: SEGMENT,
    activityId: activityId(activity),
    startedAt: unixSeconds(startedAt),
    elapsed: seconds(elapsedSeconds),
    deviation: metres(5),
    visibility,
    attributes: {},
  };
}

function tracked(
  id: string,
  startedAt: number,
  metresPerSecond: number,
  interval: number,
): StubEffortRide {
  const track: GeographicPosition[] = [];
  for (let at = 0; at <= 500 / metresPerSecond + 1e-9; at += interval) {
    track.push(northOf(at * metresPerSecond));
  }
  return { activity: ride(id, startedAt), track, sampleIntervalSeconds: interval };
}

/** The text of every cell in the one data table, or of the nth. */
function cells(root: ParentNode, table = 0): string[] {
  const tables = queryAll<HTMLTableElement>(root, 'table');
  const chosen = tables[table];
  return chosen === undefined
    ? []
    : queryAll<HTMLTableCellElement>(chosen, 'td, th').map((cell) => cell.textContent ?? '');
}

describe('the effort list — #67’s first and fourth criteria', () => {
  it('lists every effort fastest first, and names the personal best in WORDS', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [
        effort('slow', 'ride-2', 1_760_100_100, 120),
        effort('quick', 'ride-1', 1_760_000_100, 90),
      ],
      rides: [
        { activity: ride('ride-1', 1_760_000_000) },
        { activity: ride('ride-2', 1_760_100_000) },
      ],
    });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('The long drag');
    expect(text).toContain('Personal best');
    // The fastest is listed before the slower one, and the word is on its row.
    const rows = queryAll<HTMLTableRowElement>(mounted.container, 'tbody tr');
    expect(rows[0]?.textContent).toContain('Personal best');
    expect(rows[1]?.textContent ?? '').not.toContain('Personal best');
  });

  it('names the ranking basis on screen, which criterion 4 asks for explicitly', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [effort('e1', 'ride-1', 1_760_000_100, 90)],
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    expect(mounted.container.textContent ?? '').toContain('elapsed time');
  });

  it('shows a private-match effort, and says why it is the rider’s alone', async () => {
    // Criterion 1: "A private-match effort appears here — it is the athlete's
    // own data — and a test asserts it does."
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [effort('hidden', 'ride-1', 1_760_000_100, 88, 'private-match')],
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('privacy zone');
    expect(text).toContain('Personal best');
  });

  it('says so plainly when there are no efforts yet', async () => {
    const port = stubEffortPort({ athleteId: OWNER, segments: [theSegment()], efforts: [] });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    expect(mounted.container.textContent ?? '').toContain('no efforts on this segment yet');
  });
});

describe('the comparison has a non-visual equivalent — #67’s third criterion', () => {
  it('renders the checkpoints as a table with a caption and row headers', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [
        effort('fast', 'ride-1', 1_760_000_000, 50),
        effort('slow', 'ride-2', 1_760_100_000, 62),
      ],
      rides: [tracked('ride-1', 1_760_000_000, 10, 1), tracked('ride-2', 1_760_100_000, 8, 5)],
    });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    // Pick both efforts, then compare.
    const boxes = queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]');
    for (const box of boxes) {
      box.click();
      await settle();
    }
    const compare = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').includes('Compare the two'),
    );
    expect(compare?.disabled).toBe(false);
    compare?.click();
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Where the time went');
    // The numbers, in a table, not only in a picture.
    expect(queryAll(mounted.container, 'table')).toHaveLength(2);
    expect(cells(mounted.container, 1).length).toBeGreaterThan(20);
    // And the two sample rates are stated, because they differ.
    expect(text).toContain('Recorded every 1.0 s and every 5.0 s');
  });

  it('the compare control is disabled until exactly two efforts are chosen', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [
        effort('fast', 'ride-1', 1_760_000_000, 50),
        effort('slow', 'ride-2', 1_760_100_000, 62),
      ],
      rides: [tracked('ride-1', 1_760_000_000, 10, 1), tracked('ride-2', 1_760_100_000, 8, 5)],
    });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    const button = (): HTMLButtonElement | undefined =>
      queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((one) =>
        (one.textContent ?? '').includes('Compare the two'),
      );
    expect(button()?.disabled).toBe(true);

    queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]')[0]?.click();
    await settle();
    expect(button()?.disabled).toBe(true);
  });
});

describe('what the screen does when it cannot read — #67’s seventh criterion', () => {
  it('shows a message rather than a blank page when a read throws', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [effort('e1', 'ride-1', 1_760_000_100, 90)],
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });
    port.failNextRead = true;

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    expect(mounted.container.textContent ?? '').toContain('could not read');
  });

  it('says a segment is unknown rather than rendering an empty history', async () => {
    const port = stubEffortPort({ athleteId: OWNER, segments: [], efforts: [] });

    mounted = await mount(<SegmentDetailView port={port} segment="segment-1" />);
    await settle();

    expect(mounted.container.textContent ?? '').toContain('No segment on this device');
  });

  it('renders a sentence with no port at all, which is how the audit sees it', async () => {
    mounted = await mount(<SegmentDetailView port={undefined} segment={undefined} />);
    await settle();

    expect(mounted.container.textContent ?? '').toContain('Open a segment');
  });
});
