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
import { seconds } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { buttonsByView, onePrimaryViolations } from '../a11y/button-hierarchy';
import { stubAnalysis, type StubAnalysisRide } from '../analysis/testing';
import { stubActivity } from '../detail/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';

import { AnalysisView, THRESHOLDS_WHERE_THEY_GO } from './AnalysisView';

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

  it('offers its two next steps as buttons, one of them primary — #668, finished by #666', async () => {
    mounted = await mount(
      <main>
        <AnalysisView />
      </main>,
    );
    const named = (label: string): Element | undefined =>
      queryAll(mounted?.container ?? document, 'main a').find(
        (element) => (element.textContent ?? '').trim() === label,
      );
    const rides = named('Your rides');
    const files = named('Import or export files');
    expect(rides?.classList.contains('oyl-button'), rides?.outerHTML).toBe(true);
    expect(files?.classList.contains('oyl-button--secondary'), files?.outerHTML).toBe(true);
    expect(buttonsByView(document)[0]?.primaries).toEqual([rides]);
    expect(onePrimaryViolations(document)).toEqual([]);
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

  it('hides the zone chart from assistive technology, because the table already says every share', async () => {
    // #2069: the chart repeats the table's shares, so announcing it would read
    // each number twice.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const charts = queryAll(mounted.container, '.oyl-zone-chart');
    expect(charts).toHaveLength(1);
    expect(charts[0]?.getAttribute('aria-hidden')).toBe('true');
    // The single-accent bar it replaced in the Share cell is gone.
    expect(queryAll(mounted.container, '.oyl-zone-bar')).toHaveLength(0);
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

describe('AnalysisView — the zone chart (#2069)', () => {
  /**
   * 100 s at 100 W (zone 1 at the 200 W default threshold), 200 s at 200 W
   * (zone 4), 100 s at 280 W (zone 6), and a 100 s gap where the meter said
   * nothing. Covered: 400 s of the stub's 3 500 s moving time, so a share of
   * covered time (25 / 50 / 25 %) and a share of moving time (3 / 6 / 3 %) are
   * far apart.
   */
  function knownRide(): StubAnalysisRide {
    const power = [
      ...steadyPower(100, 100),
      ...steadyPower(200, 200),
      ...Array.from({ length: 100 }, () => undefined),
      ...steadyPower(280, 100),
    ];
    return ride('ride-1', { power });
  }

  /** Each bar's zone, words, drawn width (as a share of 100) and share text, read from the DOM. */
  function barsOf(container: HTMLElement): {
    readonly zone: string | null;
    readonly words: string;
    readonly width: number;
    readonly share: string;
  }[] {
    return queryAll(container, '.oyl-zone-chart__row').map((row) => ({
      zone: row.getAttribute('data-oyl-zone-bar'),
      words: row.querySelector('.oyl-zone-chart__label')?.textContent ?? '',
      width: Number.parseFloat(
        row.querySelector('.oyl-zone-chart__fill')?.getAttribute('width') ?? 'NaN',
      ),
      share: row.querySelector('.oyl-zone-chart__share')?.textContent ?? '',
    }));
  }

  it('draws each bar at its share of covered time, and says the same share as the table', async () => {
    const port = stubAnalysis(OWNER, [knownRide()]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const bars = barsOf(mounted.container);
    const rows = rowsOf(mounted.container, 'Power zones');
    expect(bars).toHaveLength(7);
    expect(bars.map((bar) => bar.share)).toEqual(['25%', '0%', '0%', '50%', '0%', '25%', '0%']);
    expect(bars.map((bar) => Math.round(bar.width))).toEqual([25, 0, 0, 50, 0, 25, 0]);
    // The chart and the table are one set of rows: each bar's share is its row's.
    for (const [index, bar] of bars.entries()) {
      expect(bar.share).toBe(rows[index]?.[3]);
      expect(`${String(Math.round(bar.width))}%`).toBe(rows[index]?.[3]);
    }
  });

  it('names every bar by its zone number and name, as text beside its colour', async () => {
    const port = stubAnalysis(OWNER, [knownRide()]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(barsOf(mounted.container).map((bar) => bar.words)).toEqual([
      '1 Recovery',
      '2 Endurance',
      '3 Tempo',
      '4 Threshold',
      '5 VO₂',
      '6 Anaerobic',
      '7 Sprint',
    ]);
    const threshold = mounted.container.querySelector('[data-oyl-zone-bar="4"]');
    expect(threshold?.querySelector('.oyl-zone-key__swatch--band-threshold')).not.toBeNull();
    expect(threshold?.querySelector('.oyl-zone-chart__fill--band-threshold')).not.toBeNull();
  });

  it('draws heart rate’s five zones in the first five power zones’ colours, by their own names', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { heartRate: steadyHeartRate(150, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    const chart = mounted.container.querySelector('[data-oyl-zone-key="heartRate"]');
    expect(
      queryAll(chart as Element, '.oyl-zone-chart__label').map((label) => label.textContent),
    ).toEqual(['1 Recovery', '2 Endurance', '3 Tempo', '4 Threshold', '5 Maximal']);
    expect(
      chart?.querySelector('[data-oyl-zone-bar="5"] .oyl-zone-chart__fill--band-vo2'),
    ).not.toBeNull();
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

describe('AnalysisView — ride load (#76)', () => {
  it('shows the load and says which channel it came from', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 3600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('Ride load');
    // An hour at the default threshold is 100 by construction.
    expect(mounted.container.textContent).toContain('100');
    expect(mounted.container.textContent).toContain('from your power trace');
  });

  it('warns that a heart-rate load is not comparable with a power one', async () => {
    // #76's fifth criterion is not satisfied by naming the channel: the two
    // numbers share a scale without being the same measurement, and a rider
    // comparing Tuesday with Thursday needs to be told so.
    const port = stubAnalysis(OWNER, [ride('ride-1', { heartRate: steadyHeartRate(160, 3600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).toContain('from your heart-rate trace');
    expect(mounted.container.textContent).toContain('not directly comparable');
  });

  it('shows no load panel for a ride with neither channel', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1')]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(mounted.container.textContent).not.toContain('Ride load');
  });
});

describe('AnalysisView — the threshold editor (#76 criterion 6, and #78\u2019s gap)', () => {
  const athlete = {
    id: OWNER,
    displayName: 'A',
    createdAt: unixSeconds(1_700_000_000),
    thresholdPower: watts(250),
  };

  function fieldNamed(label: string): HTMLInputElement {
    const input = queryAll<HTMLInputElement>(mounted?.container ?? document.body, 'input').find(
      (candidate) =>
        (candidate.labels?.[0]?.textContent ?? '').toLowerCase().includes(label.toLowerCase()),
    );
    if (input === undefined) {
      throw new Error(`no input labelled ${label}`);
    }
    return input;
  }

  it('describes both boxes with how to clear one, under them and never tucked — #1023', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], athlete);
    mounted = await mount(<AnalysisView port={port} />);
    await settle();
    for (const label of ['Threshold power', 'Threshold heart rate']) {
      const ids = (fieldNamed(label).getAttribute('aria-describedby') ?? '').split(' ');
      const hints = ids.map((id) => document.getElementById(id));
      expect(
        hints.map((hint) => hint?.textContent?.trim()),
        label,
      ).toEqual(['Leave one blank to go back to the assumed default.']);
      expect(hints[0]?.closest('details'), label).toBeNull();
    }
  });

  // #1342: threshold power is in every ride analysis' input and a re-plan's
  // power is a share of it, so the card says so, on the screen, and nowhere
  // says that nothing is sent. `thresholds-disclosure.test.ts` holds each
  // clause of the sentence to the code that makes it true.
  it('says where the thresholds go, never tucked, and never that nothing is sent — #1342', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], athlete);
    mounted = await mount(<AnalysisView port={port} />);
    await settle();
    const container = mounted.container;
    const paragraph = queryAll<HTMLParagraphElement>(container, 'p').find(
      (candidate) => candidate.textContent === THRESHOLDS_WHERE_THEY_GO,
    );
    expect(paragraph).toBeDefined();
    expect(paragraph?.closest('details')).toBeNull();
    expect((container.textContent ?? '').replace(/\s+/g, ' ')).not.toMatch(
      /nothing is sent anywhere/i,
    );
  });

  it('seeds the form from what is stored', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], athlete);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(fieldNamed('Threshold power').value).toBe('250');
  });

  it('leaves the box blank when the threshold is only assumed', async () => {
    // ⚠️ The default must not be typed into the box. A rider who never set a
    // threshold would otherwise save 200 W as though they had chosen it, and
    // the screen would stop saying the number is assumed.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    expect(fieldNamed('Threshold power').value).toBe('');
    expect(mounted.container.textContent).toContain('assumed threshold power');
  });

  it('saves a threshold and re-derives every zone and the load from it', async () => {
    // #76's sixth criterion in its literal form: change the setting, and every
    // dependent number for a fixed ride changes.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 3600) })], athlete);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    // At a 250 W threshold, 200 W is 0.8 — zone 3.
    expect(rowsOf(mounted.container, 'Power zones')[2]?.[3]).toBe('100%');

    await typeInto(fieldNamed('Threshold power'), '400');
    await activateWithKeyboard(buttonNamed('Save thresholds'));

    expect(port.thresholdWrites.at(-1)?.thresholdPower).toBe(400);
    // 200 W is now half of threshold — zone 1 — and the load falls with it.
    expect(rowsOf(mounted.container, 'Power zones')[0]?.[3]).toBe('100%');
    expect(mounted.container.textContent).toContain('threshold power 400 W');
    expect(mounted.container.textContent).toContain('Saved.');
  });

  it('clears a threshold when the box is emptied, so a mistake can be undone', async () => {
    // The store replaces both and treats blank as "not set". Without that
    // there would be no way back to the default at all.
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], athlete);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    await typeInto(fieldNamed('Threshold power'), '');
    await activateWithKeyboard(buttonNamed('Save thresholds'));

    expect(port.thresholdWrites.at(-1)?.thresholdPower).toBeUndefined();
    expect(mounted.container.textContent).toContain('assumed threshold power');
  });

  it('refuses a value that is not a positive number, and keeps what was typed', async () => {
    const port = stubAnalysis(OWNER, [ride('ride-1', { power: steadyPower(200, 600) })], athlete);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();

    await typeInto(fieldNamed('Threshold power'), '-40');
    await activateWithKeyboard(buttonNamed('Save thresholds'));

    expect(port.thresholdWrites).toHaveLength(0);
    expect(mounted.container.textContent).toContain('must be a positive number');
    // The rider does not lose what they typed while being told it is wrong.
    expect(fieldNamed('Threshold power').value).toBe('-40');
  });
});

/** A button by its visible label. */
function buttonNamed(label: string): HTMLElement {
  const button = queryAll(mounted?.container ?? document.body, 'button').find((candidate) =>
    (candidate.textContent ?? '').includes(label),
  );
  if (button === undefined) {
    throw new Error(`no button labelled ${label}`);
  }
  return button;
}

describe('AnalysisView — fitness and fatigue (#77)', () => {
  const DAY = 86_400;
  const START = 1_788_782_400;

  /** A ride that already carries a load summary. */
  function measured(id: string, offset: number): StubAnalysisRide {
    return {
      activity: stubActivity({
        id: activityId(id),
        startedAt: unixSeconds(START + offset * DAY),
        startedAtTimeZone: 'UTC',
        effortWeightedPower: watts(200),
        loadCoveredTime: seconds(3600),
      }),
    };
  }

  it('reports the three readings in words, with a direction and a change', async () => {
    // #77's sixth criterion. The non-visual equivalent is these sentences, not
    // the table: a decade of riding is 3 650 rows, and a table nobody can read
    // is not an equivalent of a picture anybody can.
    const rides = Array.from({ length: 30 }, (_unused, index) =>
      measured(`r${String(index)}`, index),
    );
    const port = stubAnalysis(OWNER, rides);

    mounted = await mount(<AnalysisView port={port} />);
    // Twice: the screen reaches `ready` on the first pass and the history — a
    // second, deliberately separate read — lands on the next. That separation
    // is the design, not a race: a failure to draw the chart must not empty
    // the rest of the page.
    await settle();
    await settle();

    expect(mounted.container.textContent).toContain('Fitness');
    expect(mounted.container.textContent).toContain('Fatigue');
    expect(mounted.container.textContent).toContain('Freshness');
    expect(mounted.container.textContent).toMatch(/rising|falling|steady/);
    expect(mounted.container.textContent).toContain('over the last week');
  });

  it('says the chart is built from power when every ride was', async () => {
    // #77's eighth criterion.
    const port = stubAnalysis(OWNER, [measured('r0', 0), measured('r1', 1)]);

    mounted = await mount(<AnalysisView port={port} />);
    // Twice: the screen reaches `ready` on the first pass and the history — a
    // second, deliberately separate read — lands on the next. That separation
    // is the design, not a race: a failure to draw the chart must not empty
    // the rest of the page.
    await settle();
    await settle();

    expect(mounted.container.textContent).toContain('all measured from power');
  });

  it('says so plainly when the history mixes the two bases', async () => {
    const strapped: StubAnalysisRide = {
      activity: stubActivity({
        id: activityId('strap'),
        startedAt: unixSeconds(START + DAY),
        startedAtTimeZone: 'UTC',
        effortWeightedHeartRate: beatsPerMinute(150),
        loadCoveredTime: seconds(3600),
      }),
    };
    const port = stubAnalysis(OWNER, [measured('r0', 0), strapped]);

    mounted = await mount(<AnalysisView port={port} />);
    // Twice: the screen reaches `ready` on the first pass and the history — a
    // second, deliberately separate read — lands on the next. That separation
    // is the design, not a race: a failure to draw the chart must not empty
    // the rest of the page.
    await settle();
    await settle();

    expect(mounted.container.textContent).toContain(
      'some measured from power and some from heart rate',
    );
    expect(mounted.container.textContent).toContain('without being the same measurement');
  });

  it('warns that the start of a short history is climbing out of nothing', async () => {
    // The seeding, said to the reader rather than buried in a comment.
    const port = stubAnalysis(OWNER, [measured('r0', 0), measured('r1', 1)]);

    mounted = await mount(<AnalysisView port={port} />);
    // Twice: the screen reaches `ready` on the first pass and the history — a
    // second, deliberately separate read — lands on the next. That separation
    // is the design, not a race: a failure to draw the chart must not empty
    // the rest of the page.
    await settle();
    await settle();

    expect(mounted.container.textContent).toContain('start from zero');
  });

  it('never tells the rider whether their numbers are good or bad', async () => {
    // Fatigue rises because the athlete trained. A chart that called that a
    // warning on the strength of three numbers would be overreaching.
    const rides = Array.from({ length: 40 }, (_unused, index) =>
      measured(`r${String(index)}`, index),
    );
    const port = stubAnalysis(OWNER, rides);

    mounted = await mount(<AnalysisView port={port} />);
    // Twice: the screen reaches `ready` on the first pass and the history — a
    // second, deliberately separate read — lands on the next. That separation
    // is the design, not a race: a failure to draw the chart must not empty
    // the rest of the page.
    await settle();
    await settle();

    const panel = mounted.container.textContent ?? '';
    expect(panel).not.toMatch(/overtrain|overreach|you should rest|too hard|at risk/i);
  });

  it('offers to measure rides imported before load was recorded, and does not do it unasked', async () => {
    // The backfill is an explicit act. A read path that writes is a read path
    // whose cost nobody can state.
    const port = stubAnalysis(OWNER, [
      {
        activity: stubActivity({
          id: activityId('old'),
          startedAt: unixSeconds(START),
          startedAtTimeZone: 'UTC',
        }),
        power: Array.from({ length: 600 }, () => watts(200)),
      },
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    // Twice: the screen reaches `ready` on the first pass and the history — a
    // second, deliberately separate read — lands on the next. That separation
    // is the design, not a race: a failure to draw the chart must not empty
    // the rest of the page.
    await settle();
    await settle();

    expect(mounted.container.textContent).toContain('imported before this device');
    // Nothing was written by rendering.
    expect(port.summaryWrites).toEqual([]);

    const measure = queryAll(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Measure'),
    );
    expect(measure).toBeDefined();
    await activateWithKeyboard(measure as HTMLElement);
    await settle();

    expect(port.summaryWrites).toEqual(['old']);
    expect(mounted.container.textContent).toContain('Measured 1 more ride');
  });

  it('says what it found with nothing to measure, and stops offering it — #1084', async () => {
    const port = stubAnalysis(OWNER, [
      {
        activity: stubActivity({
          id: activityId('zero'),
          startedAt: unixSeconds(START),
          startedAtTimeZone: 'UTC',
        }),
        power: Array.from({ length: 600 }, () => watts(0)),
      },
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();
    await settle();

    const measure = queryAll(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Measure'),
    );
    expect(measure).toBeDefined();
    await activateWithKeyboard(measure as HTMLElement);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain(
      'Measured 0 more rides, and found 1 with nothing to work a load out from — too short, or no usable power or heart rate.',
    );
    expect(text).toContain('1 ride has no load: nothing on it was enough to work one out from.');
    // No offer left: no pass could measure it.
    expect(
      queryAll(mounted.container, 'button').some((button) =>
        (button.textContent ?? '').startsWith('Measure'),
      ),
    ).toBe(false);
    expect(text).not.toContain('imported before this device');
  });

  it('says a ride with no recording stored yet is looked at again, and does not call it no load — #1084', async () => {
    const port = stubAnalysis(OWNER, [
      {
        activity: stubActivity({
          id: activityId('saving'),
          startedAt: unixSeconds(START),
          startedAtTimeZone: 'UTC',
        }),
      },
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();
    await settle();

    const measure = queryAll(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Measure'),
    );
    await activateWithKeyboard(measure as HTMLElement);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain(
      'Measured 0 more rides. 1 ride has no recording stored yet, so it was left to look at again next time.',
    );
    expect(text).not.toContain('has no load');
    expect(port.summaryWrites).toEqual([]);
  });

  it('names the rides with no load beside a chart — #1084', async () => {
    const port = stubAnalysis(OWNER, [
      {
        activity: stubActivity({
          id: activityId('loaded'),
          startedAt: unixSeconds(START),
          startedAtTimeZone: 'UTC',
          effortWeightedPower: watts(200),
          loadCoveredTime: seconds(3600),
        }),
      },
      ...['a', 'b'].map((id, index) => ({
        activity: stubActivity({
          id: activityId(id),
          startedAt: unixSeconds(START + (index + 1) * 86_400),
          startedAtTimeZone: 'UTC',
          loadCoveredTime: seconds(0),
        }),
      })),
    ]);

    mounted = await mount(<AnalysisView port={port} />);
    await settle();
    await settle();

    expect(mounted.container.textContent).toContain(
      'Built from 1 measured ride, all measured from power. 2 rides have no load: nothing on them was enough to work one out from.',
    );
  });
});
