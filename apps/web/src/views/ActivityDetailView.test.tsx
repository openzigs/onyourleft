// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #50's acceptance criteria, at the layer a rider actually meets.
 *
 * The arithmetic ones are pinned in `detail/series.test.ts`,
 * `detail/privacy.test.ts` and `detail/load.test.ts`; what is here is the half
 * the criteria phrase as *"asserted on rendered output"* — a gap that is a hole
 * in the drawing, a toggle that changes the drawing, an indoor ride that renders
 * without a map rather than with an empty one.
 */

import {
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  privacyZoneId,
  type PrivacyZoneRecord,
  type Samples,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { stubActivity, stubDetail, stubLap, type StubDetail } from '../detail/testing';
import { CHART_POINTS } from '../detail/series';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { ActivityDetailView } from './ActivityDetailView';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * Mount, and let the lazy chart arrive.
 *
 * ⚠️ **Two settles, deliberately.** The chart is loaded through `React.lazy`
 * (`design/ChartSlot.tsx` records why that is #50's obligation), so the first
 * settle resolves the store reads and the second resolves the dynamic import
 * and the render it unblocks. One settle leaves every `<svg>` assertion reading
 * the pre-chart render, which looks exactly like a chart that does not work.
 */
async function open(port: StubDetail | undefined, id: string = RIDE): Promise<Mounted> {
  const result = await mount(<ActivityDetailView port={port} activityId={id} />);
  await settle();
  await settle();
  mounted = result;
  return result;
}

function powerSeries(count: number, holeFrom = -1, holeLength = 0): Samples<'power'> {
  return Array.from({ length: count }, (_unused, index) =>
    index >= holeFrom && index < holeFrom + holeLength ? undefined : watts(150 + (index % 60)),
  );
}

function indoorRide(power: Samples<'power'> = powerSeries(1200)): StubDetail {
  return stubDetail(ATHLETE, {
    activity: stubActivity({ hasPosition: false, averagePower: watts(212) }),
    channels: {
      power,
      heartRate: Array.from({ length: power.length }, () => beatsPerMinute(142)),
      cadence: Array.from({ length: power.length }, () => revolutionsPerMinute(88)),
    },
    laps: [stubLap(0), stubLap(1)],
  });
}

/** A track running due north away from `HOME`, so the first points are inside a home zone. */
const METRES_PER_DEGREE_LATITUDE = 111_194.93;

function outdoorRide(zones: readonly PrivacyZoneRecord[]): StubDetail {
  const count = 300;
  const latitude = Array.from({ length: count }, (_unused, index) =>
    degreesLatitude(HOME.latitude + (index * 10) / METRES_PER_DEGREE_LATITUDE),
  ) as Samples<'latitude'>;
  const longitude = Array.from({ length: count }, () =>
    degreesLongitude(HOME.longitude),
  ) as Samples<'longitude'>;
  return stubDetail(
    ATHLETE,
    {
      activity: stubActivity({ hasPosition: true, distance: metres(3000) }),
      channels: { power: powerSeries(count), latitude, longitude },
      laps: [],
    },
    zones,
  );
}

function homeZone(): PrivacyZoneRecord {
  return {
    id: privacyZoneId('home'),
    athleteId: ATHLETE,
    centre: HOME,
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(1),
  };
}

describe('criterion 1 — a ride with no position renders without a map', () => {
  it('says the ride is indoor rather than leaving a hole where a map would be', async () => {
    mounted = await open(indoorRide());
    expect(document.body.textContent).toContain('Indoor — no GPS track');
    // The failure this is really about: a map component centred on (0, 0)
    // because there was nothing to centre it on. There is no map at all in
    // Phase 1 — it moved to #63 — and nothing here renders a coordinate.
    expect(document.body.textContent).not.toContain('0°');
    expect(document.querySelector('.oyl-map')).toBeNull();
  });

  it('renders without an error and with the ride’s own numbers', async () => {
    mounted = await open(indoorRide());
    expect(mounted.caughtErrors).toEqual([]);
    expect(document.querySelector('h2')?.textContent).toBe('Tuesday morning');
    expect(document.body.textContent).toContain('212 W');
    expect(document.body.textContent).toContain('42.2 km');
  });

  it('offers no shared view at all, because there is no track to share', async () => {
    mounted = await open(indoorRide());
    expect(document.body.textContent).not.toContain('What a shared copy would contain');
  });
});

describe('criterion 2 — a gap renders as a visible discontinuity', () => {
  it('draws one path per unbroken run, so the line does not cross the hole', async () => {
    // 1 200 samples with a 300-second hole in the middle. The failure this
    // catches is a single path with the missing points omitted, which draws a
    // straight line through the gap — indistinguishable from a steady effort.
    mounted = await open(indoorRide(powerSeries(1200, 400, 300)));
    const svg = document.querySelector('svg.oyl-trace');
    expect(svg).not.toBeNull();
    const paths = queryAll<SVGPathElement>(svg as Element, 'path');
    expect(paths.length).toBe(2);
  });

  it('leaves the drawing empty across the gap, asserted on the coordinates drawn', async () => {
    mounted = await open(indoorRide(powerSeries(1200, 400, 300)));
    const paths = queryAll<SVGPathElement>(document, 'svg.oyl-trace path');
    const xsOf = (path: Element): number[] =>
      [...(path.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+)/g)].map((match) =>
        Number(match[1]),
      );
    const first = xsOf(paths[0] as Element);
    const second = xsOf(paths[1] as Element);
    // The hole is a third of the way in and a quarter of the ride long, so the
    // first run ends well before the second begins and nothing is drawn between.
    expect(Math.max(...first)).toBeLessThan(Math.min(...second));
    expect(Math.min(...second) - Math.max(...first)).toBeGreaterThan(CHART_POINTS / 10);
  });

  it('names the gap in the table too, rather than showing it as a zero', async () => {
    // The non-visual half of the same criterion. A dash or a zero in the table
    // is a reading; "no reading" is the absence of one.
    mounted = await open(indoorRide(powerSeries(1200, 400, 300)));
    expect(document.body.textContent).toContain('no reading');
  });

  it('draws one path and no gap language for an unbroken ride', async () => {
    mounted = await open(indoorRide());
    expect(queryAll(document, 'svg.oyl-trace path')).toHaveLength(2 * 1);
    expect(document.body.textContent).not.toContain('no reading');
  });
});

describe('criterion 3 — toggling a series changes what is rendered', () => {
  it('adds a trace to the page, not merely to a state store', async () => {
    // The criterion is explicit that a store-level assertion is a no-op that
    // passes: client state nothing renders from changes nothing. So this counts
    // drawings before and after.
    const port = indoorRide();
    mounted = await open(port);
    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(2);

    const show = queryAll<HTMLButtonElement>(document, 'button').find(
      (button) => button.textContent?.trim() === 'Show cadence',
    );
    expect(show).toBeDefined();
    await activateWithKeyboard(show as HTMLButtonElement);
    await settle();
    await settle();

    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(3);
    expect(document.body.textContent).toContain('Cadence (rpm)');
  });

  it('removes a trace from the page when it is switched off', async () => {
    const port = indoorRide();
    mounted = await open(port);
    const hide = queryAll<HTMLButtonElement>(document, 'button').find(
      (button) => button.textContent?.trim() === 'Hide power',
    );
    await activateWithKeyboard(hide as HTMLButtonElement);
    await settle();

    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Power (W)');
  });

  it('reads a channel once even after switching it off and on again', async () => {
    // The samples do not change, so a second inflate of the same blob is pure
    // cost — and it is the read this whole module is arranged to avoid.
    const port = indoorRide();
    mounted = await open(port);
    expect(port.channelReads).toEqual(['power', 'heartRate']);

    const buttonNamed = (text: string): HTMLButtonElement =>
      queryAll<HTMLButtonElement>(document, 'button').find(
        (button) => button.textContent?.trim() === text,
      ) as HTMLButtonElement;

    await activateWithKeyboard(buttonNamed('Hide power'));
    await settle();
    await activateWithKeyboard(buttonNamed('Show power'));
    await settle();
    await settle();

    expect(port.channelReads).toEqual(['power', 'heartRate']);
    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(2);
  });
});

describe('criterion 4 — the view does not load a full 1 Hz stream', () => {
  it('reads only the series it opens with, and never the ones it does not draw', async () => {
    const port = indoorRide();
    mounted = await open(port);
    // Cadence is stored and is not read, because it is not switched on.
    expect(port.channelReads).toEqual(['power', 'heartRate']);
    expect(port.channelReads).not.toContain('cadence');
  });

  it('states the reduction on the page, so the budget is visible rather than assumed', async () => {
    mounted = await open(indoorRide());
    expect(document.body.textContent).toContain('1200 readings a second apart');
    expect(document.body.textContent).toContain(`up to ${String(CHART_POINTS)} points a trace`);
  });
});

describe('criterion 5 — the shared view is trimmed in the data, not in the drawing', () => {
  it('renders the shared summary and puts no withheld coordinate in the document', async () => {
    const port = outdoorRide([homeZone()]);
    mounted = await open(port);

    const reveal = queryAll<HTMLButtonElement>(document, 'button').find((button) =>
      button.textContent?.includes('Show what a shared copy would contain'),
    );
    expect(reveal).toBeDefined();
    await activateWithKeyboard(reveal as HTMLButtonElement);
    await settle();

    expect(document.body.textContent).toContain('Positions withheld');
    // No coordinate of any kind reaches the DOM — the shared view reports
    // counts and distances, never places. A renderer that hid points would
    // still have them in its props; this view never has them at all.
    expect(document.body.textContent).not.toContain('51.50');
    expect(document.body.textContent).not.toContain('-0.127');
  });

  it('says plainly that a zone is not anonymity — ADR 0004 decision B', async () => {
    const port = outdoorRide([homeZone()]);
    mounted = await open(port);
    const reveal = queryAll<HTMLButtonElement>(document, 'button').find((button) =>
      button.textContent?.includes('Show what a shared copy would contain'),
    );
    await activateWithKeyboard(reveal as HTMLButtonElement);
    await settle();
    // "The UI must not describe a privacy zone as making a location private."
    expect(document.body.textContent).toContain('does not make where you live private');
  });

  it('tells a rider with no zones that a shared copy would carry the whole track', async () => {
    const port = outdoorRide([]);
    mounted = await open(port);
    const reveal = queryAll<HTMLButtonElement>(document, 'button').find((button) =>
      button.textContent?.includes('Show what a shared copy would contain'),
    );
    await activateWithKeyboard(reveal as HTMLButtonElement);
    await settle();
    expect(document.body.textContent).toContain('You have no privacy zones');
  });

  it('reads no position channel until the shared view is asked for', async () => {
    // The rider's own view is the true track and needs no trimming, so the
    // preview's reads are the rider's decision rather than a cost of opening
    // the page.
    const port = outdoorRide([homeZone()]);
    mounted = await open(port);
    expect(port.channelReads).not.toContain('latitude');
  });
});

describe('criterion 6 — every chart has a non-visual equivalent', () => {
  it('renders a table of the same series beside the drawing', async () => {
    mounted = await open(indoorRide());
    const tables = queryAll(document, 'table.oyl-data-table');
    expect(tables.length).toBe(2);
    expect(tables[0]?.querySelector('caption')?.textContent).toBe('Power (W)');
  });

  it('describes the shape of the trace in words, for a reader who cannot see it', async () => {
    mounted = await open(indoorRide(powerSeries(1200, 400, 300)));
    const svg = document.querySelector('svg.oyl-trace');
    const label = svg?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Power over');
    expect(label).toContain('Average');
    expect(label).toContain('broken into 2 parts');
    expect(label).toContain('300 seconds');
  });

  it('keeps the table short enough to be read rather than mirroring the drawing', async () => {
    mounted = await open(indoorRide());
    const rows = queryAll(document, 'table.oyl-data-table tbody tr');
    // Two series, so twice the table size — and far short of 600 points each.
    expect(rows.length).toBeLessThan(CHART_POINTS);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('the states that are not a ride', () => {
  it('says there is no local store rather than claiming the ride is missing', async () => {
    mounted = await open(undefined);
    expect(document.body.textContent).toContain('No local store on this browser');
    // And still offers a way out, which a dead end would not.
    expect(queryAll(document, 'a[href]').length).toBeGreaterThan(0);
  });

  it('says no ride has that id, without confirming whether one exists elsewhere', async () => {
    mounted = await open(indoorRide(), 'no-such-ride');
    expect(document.body.textContent).toContain('No ride on this device has that id');
    // Deliberately not "that ride belongs to somebody else": the store's reads
    // are athlete-scoped, so distinguishing the two would confirm the id names
    // a real ride.
    expect(document.body.textContent).not.toContain('belongs to');
  });

  it('says a read failed rather than rendering an empty ride', async () => {
    const port = indoorRide();
    const broken: StubDetail = {
      ...port,
      store: {
        ...port.store,
        getActivity: () => Promise.reject(new Error('the database is closed')),
      },
    };
    mounted = await open(broken);
    expect(document.body.textContent).toContain('Could not read this ride');
    expect(document.body.textContent).toContain('the database is closed');
  });

  it('says a ride has nothing to chart when it stored no streams', async () => {
    const port = stubDetail(ATHLETE, {
      activity: stubActivity({ elapsedTime: seconds(60) }),
      channels: {},
      laps: [],
    });
    mounted = await open(port);
    expect(document.body.textContent).toContain('no per-second data stored on this device');
    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(0);
  });
});

describe('the lap table', () => {
  it('lists the laps in the order they were ridden, numbered from one', async () => {
    mounted = await open(indoorRide());
    const rows = queryAll(document, 'table.oyl-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('th')?.textContent).toBe('1');
    expect(rows[1]?.querySelector('th')?.textContent).toBe('2');
  });

  it('says a ride has no laps rather than rendering an empty table', async () => {
    const port = stubDetail(ATHLETE, {
      activity: stubActivity(),
      channels: { power: powerSeries(60) },
      laps: [],
    });
    mounted = await open(port);
    expect(document.body.textContent).toContain('no laps recorded');
    expect(queryAll(document, 'table.oyl-table')).toHaveLength(0);
  });
});
