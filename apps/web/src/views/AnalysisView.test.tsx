// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The analysis screen (#78).
 *
 * Four of the eight acceptance criteria are about what a *reader* can tell
 * apart, so they are asserted here rather than in the loader:
 *
 * - a ride with only one of the two bases shows only that one (criterion 6);
 * - every zone carries its name, range, time and share as text, and the only
 *   coloured thing on the screen is hidden from assistive technology
 *   (criterion 7);
 * - duration bests are named as such and are told apart from segment bests in
 *   words (criterion 8);
 * - changing the threshold changes what the rider is told (criterion 1).
 */

import {
  beatsPerMinute,
  unixSeconds,
  watts,
  type BeatsPerMinute,
  type Watts,
} from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { AnalysisView } from './AnalysisView';

const OWNER = toAthleteId('athlete-a');

/**
 * The mounted tree, torn down in `afterEach`.
 *
 * A module-level handle rather than a destructured `{ unmount }`, matching
 * `ActivitiesView.test.tsx`: `unmount` separated from its object is what
 * `@typescript-eslint/unbound-method` reports, and a test that throws before
 * its own teardown line would otherwise leak a mounted root into the next one.
 */
let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function steadyPower(value: number, length: number): readonly Watts[] {
  return Array.from({ length }, () => watts(value));
}

function steadyHeartRate(value: number, length: number): readonly BeatsPerMinute[] {
  return Array.from({ length }, () => beatsPerMinute(value));
}

function ride(id: string, extra: Partial<StubAnalysisRide> = {}): StubAnalysisRide {
  return {
    activity: stubActivity({ id: activityId(id), name: id }),
    ...extra,
  };
}

/** The rows of one table, as arrays of cell text. */
function rowsOf(container: HTMLElement, caption: string): string[][] {
  const table = queryAll<HTMLTableElement>(container, 'table').find((candidate) =>
    (candidate.querySelector('caption')?.textContent ?? '').includes(caption),
  );
  if (table === undefined) {
    throw new Error(`no table whose caption contains ${caption}`);
  }
  return queryAll(table, 'tbody tr').map((row) =>
    queryAll(row, 'th, td').map((cell) => cell.textContent ?? ''),
  );
}

/**
 * Pick an option in a controlled `<select>`, the way a person would.
 *
 * The native setter on the prototype, for the reason `testing/mount.tsx`
 * records for text inputs: React tracks the last value it wrote to the node and
 * skips `onChange` for what it reads as a no-op assignment.
 */
async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (descriptor?.set === undefined) {
    throw new Error('this DOM implementation has no HTMLSelectElement value setter');
  }
  descriptor.set.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

describe('AnalysisView — with no local store', () => {
  it('says so instead of showing empty tables', async () => {
    // An empty table would claim the rider has no rides and no bests, which is
    // indistinguishable from the truth and is the answer they would act on.
    mounted = await mount(<AnalysisView />);

    expect(mounted.container.textContent).toContain('No local store on this browser');
    expect(queryAll(mounted.container, 'table')).toHaveLength(0);
  });
});

describe('AnalysisView — zones', () => {
  it('shows only power for a ride that has only power', async () => {
    // Criterion 6, at the screen: not an empty heart-rate chart, no heart-rate
    // section at all.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('Power zones');
    expect(mounted.container.textContent).not.toContain('Heart-rate zones');
  });

  it('shows only heart rate for a ride recorded with a strap and no meter', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { heartRate: steadyHeartRate(150, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('Heart-rate zones');
    expect(mounted.container.textContent).not.toContain('Power zones');
  });

  it('says a ride has neither rather than drawing two empty tables', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1')]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('no power and no heart-rate data');
    expect(mounted.container.textContent).not.toContain('Power zones');
  });

  it('carries name, range, time and share in text on every row', async () => {
    // Criterion 7, in its strong form: everything that distinguishes a zone is
    // a word or a number in the row.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const rows = rowsOf(mounted.container, 'Power zones');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual(['1. Recovery', '0–112 W', '0:00', '0%']);
    // 200 W at the default 200 W threshold is threshold itself — zone 4.
    expect(rows[3]?.[0]).toBe('4. Threshold');
    expect(rows[3]?.[2]).toBe('10:00');
    expect(rows[3]?.[3]).toBe('100%');
  });

  it('hides the bar from assistive technology, because the row already says the share', async () => {
    // The only coloured thing on the screen. It repeats the percentage in the
    // same cell, so announcing it would read the number twice.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const bars = queryAll(mounted.container, '.oyl-zone-bar');
    expect(bars).toHaveLength(7);
    for (const bar of bars) {
      expect(bar.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('states the boundary rule, so a reading on a shown number can be placed', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain(
      'includes its lower value and excludes its upper',
    );
  });

  it('marks an assumed threshold as assumed', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('assumed threshold power 200 W');
  });

  it('changes every displayed zone when the stored threshold changes', async () => {
    // Criterion 1, at the screen rather than at the formula: the rider is told
    // something different, not merely that a boundary object moved.
    const athlete = {
      id: OWNER,
      displayName: 'A',
      createdAt: unixSeconds(1_700_000_000),
      thresholdPower: watts(400),
    };
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], athlete);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const rows = rowsOf(mounted.container, 'Power zones');
    // 200 W is half of a 400 W threshold: zone 1, where at 200 W it was zone 4.
    expect(rows[0]?.[3]).toBe('100%');
    expect(rows[3]?.[3]).toBe('0%');
    expect(rows[0]?.[1]).toBe('0–224 W');
    expect(mounted.container.textContent).toContain('threshold power 400 W');
    expect(mounted.container.textContent).not.toContain('assumed threshold power');
  });

  it('switches ride when the picker changes', async () => {
    const port = stubAnalysis(OWNER, [
      {
        activity: stubActivity({ id: activityId('newer'), startedAt: unixSeconds(1_760_000_100) }),
        power: steadyPower(100, 600),
      },
      {
        activity: stubActivity({ id: activityId('older'), startedAt: unixSeconds(1_760_000_000) }),
        power: steadyPower(300, 600),
      },
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    // Opens on the newest ride: 100 W at the 200 W default is zone 1.
    expect(rowsOf(mounted.container, 'Power zones')[0]?.[3]).toBe('100%');

    const select = mounted.container.querySelector('select');
    expect(select).not.toBeNull();
    await choose(select as HTMLSelectElement, 'older');

    // 300 W at the 200 W default is 1.5× threshold — zone 6.
    expect(rowsOf(mounted.container, 'Power zones')[5]?.[3]).toBe('100%');
  });

  it('explains a shortfall between covered time and moving time', async () => {
    const withGap: readonly (Watts | undefined)[] = [
      ...steadyPower(200, 1750),
      ...Array.from<undefined>({ length: 1750 }).fill(undefined),
    ];
    const port = stubAnalysis(OWNER, [
      { activity: stubActivity({ id: activityId('ride-1') }), power: withGap },
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    // The stub activity's moving time is 3500 s; the channel covered half of it.
    expect(mounted.container.textContent).toContain('the sensor reported nothing for the rest');
    expect(mounted.container.textContent).toContain('50%');
  });
});

describe('AnalysisView — duration personal bests', () => {
  it('names what it is measuring and says segment bests are a different thing', async () => {
    // Criterion 8. Segment bests do not exist on this device yet (#67), so the
    // honest thing is to say what this table is and is not, before a rider ever
    // sees both.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(250, 1300) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('Duration personal bests');
    expect(mounted.container.textContent).toContain('anywhere in any ride');
    expect(mounted.container.textContent).toContain('a segment best is a named stretch of road');
  });

  it('lists each duration with the best average power held over it', async () => {
    const port = stubAnalysis(OWNER, [
      ride('sprint', { power: [...steadyPower(600, 30), ...steadyPower(100, 600)] }),
      ride('steady', { power: steadyPower(280, 1300) }),
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const rows = rowsOf(mounted.container, 'Best average power');
    const byDuration = new Map(rows.map((row) => [row[0], row[1]]));
    // The visually hidden clock reading is inside the row header, so the label
    // cell reads "30s (0:30)". Matching on the prefix keeps this about the
    // number rather than about the hidden text.
    const at = (label: string): string | undefined =>
      [...byDuration].find(([key]) => key?.startsWith(label))?.[1];

    expect(at('30s')).toBe('600');
    expect(at('20min')).toBe('280');
  });

  it('says a library with no power has no bests, rather than showing an empty table', async () => {
    const port = stubAnalysis(OWNER, [
      ride('strap-only', { heartRate: steadyHeartRate(150, 600) }),
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('carries power data');
    // The heart-rate zone table is still there — that ride has a strap. What
    // must not be there is a bests table with nothing in it.
    expect(
      queryAll(mounted.container, 'caption').map((caption) => caption.textContent ?? ''),
    ).not.toContainEqual(expect.stringContaining('Best average power'));
  });

  it('says when the read was bounded, so the claim is not wider than the data', async () => {
    // "Your best twenty minutes" and "your best twenty minutes in your last N
    // rides" are different claims, and only one of them is true here.
    const rides = Array.from({ length: 3 }, (_unused, index) =>
      ride(`ride-${String(index)}`, { power: steadyPower(200 + index, 60) }),
    );
    const port = stubAnalysis(OWNER, rides);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    // The default bound is far above three rides, so nothing is claimed.
    expect(mounted.container.textContent).not.toContain('most recent rides on this device');
  });
});
