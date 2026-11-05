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
  distanceBetween,
  geographicPosition,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  openActivityStore,
  privacyZoneId,
  type PrivacyZoneRecord,
  type Samples,
  type StreamChannel,
  type UnitSystem,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  streamSetFor,
} from '@onyourleft/store/testing';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { stubAnalysis, type StubAnalysis } from '../analysis/testing';
import { trimRadius } from '../detail/privacy';
import {
  installFakeIntersectionObserver,
  stubActivity,
  stubDetail,
  stubLap,
  type FakeIntersectionObservers,
  type StubDetail,
} from '../detail/testing';
import { CHART_POINTS } from '../detail/series';
import {
  OSM_ATTRIBUTION,
  styleOrigins,
  type BasemapConfig,
  type BasemapStyle,
} from '../map/basemap';
import { MAP_TILES_STORAGE_KEY } from '../map/tiles-preference';
import type { PreferenceStorage } from '../game/hud/announce-preference';
import type { MapPort } from '../map/port';
import {
  coordinatesNowOn,
  everyCoordinateHandedTo,
  stubMapPort,
  type StubMapPort,
} from '../map/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { UnitsProvider } from '../units/context';

import { ActivityDetailView, READING_RIDE_TEXT } from './ActivityDetailView';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');
const HOME = geographicPosition(degreesLatitude(51.5074), degreesLongitude(-0.1278));
const BASEMAP: BasemapConfig = {
  archiveUrl: 'https://tiles.example.org/basemap.pmtiles',
  attribution: OSM_ATTRIBUTION,
};

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
 *
 * ⚠️ **And the chart's module is loaded first** (#1311). The second settle is
 * one macrotask, and the file's first chart is a module transform away: on a
 * slow runner the transform outlasted it and #1054's case read no trace (run
 * 38347793411, attempt 1). Imported here, the view's own `import()` finds it
 * already evaluated, so what the settles wait for no longer depends on the
 * runner.
 */
interface MapOptions {
  /** The engine the view is given, or `undefined` for none. */
  readonly map?: StubMapPort | undefined;
  readonly basemap?: BasemapConfig | undefined;
  /** Called each time the view asks for the engine, so a test can count. */
  readonly onLoad?: () => void;
  /** Where the map-tiles choice is read from. Defaults to jsdom's own storage. */
  readonly preferences?: PreferenceStorage;
}

async function open(
  port: StubDetail | undefined,
  id: string = RIDE,
  options: MapOptions = {},
): Promise<Mounted> {
  await import('../detail/TraceChart');
  const loader: (() => Promise<MapPort>) | undefined =
    options.map === undefined
      ? undefined
      : () => {
          options.onLoad?.();
          return Promise.resolve(options.map as MapPort);
        };
  const result = await mount(
    <ActivityDetailView
      port={port}
      activityId={id}
      map={loader}
      basemap={options.basemap}
      {...(options.preferences === undefined ? {} : { preferences: options.preferences })}
    />,
  );
  await settle();
  await settle();
  mounted = result;
  return result;
}

/** The view inside a unit preference, for the #238 cases below. */
function reading(port: StubDetail, units: UnitSystem): ReactElement {
  return (
    <UnitsProvider units={units}>
      <ActivityDetailView port={port} activityId={RIDE} />
    </UnitsProvider>
  );
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

  it('says power read zero, not "No power meter" nor "0 W", for a ride whose power readings were all 0 — #1054', async () => {
    const zeros = Array.from({ length: 600 }, () => watts(0)) as Samples<'power'>;
    mounted = await open(
      stubDetail(ATHLETE, {
        activity: stubActivity({ hasPosition: false, averagePower: watts(0) }),
        channels: { power: zeros },
        laps: [],
      }),
    );
    const summary = document.querySelector('.oyl-ride-summary');
    const power = queryAll(summary as Element, ':scope > div').find(
      (fact) => fact.querySelector('dt')?.textContent === 'Average power',
    );
    expect(power?.querySelector('dd')?.textContent).toBe('Power read zero throughout');
    expect(summary?.textContent).not.toMatch(/\b0 W\b/);
    // The Power trace is still drawn for that channel: the summary must not
    // contradict it by claiming there is no meter.
    const traceLabels = queryAll(document.body, '[aria-label]').map((n) =>
      n.getAttribute('aria-label'),
    );
    expect(traceLabels.some((l) => l?.startsWith('Power over'))).toBe(true);
    expect(summary?.textContent).not.toContain('No power meter');
  });

  it('shows no Distance row, not "0.0 km", for a ride stored at 0 m — #1070', async () => {
    mounted = await open(
      stubDetail(ATHLETE, {
        activity: stubActivity({ hasPosition: false, distance: metres(0) }),
        channels: { power: powerSeries(600) },
        laps: [],
      }),
    );
    const summary = document.querySelector('.oyl-ride-summary');
    const terms = queryAll(summary as Element, 'dt').map((term) => term.textContent);
    expect(terms).not.toContain('Distance');
    // The rest of the summary is still there.
    expect(terms).toContain('Moving time');
    expect(summary?.textContent).not.toMatch(/\b0\.0\b/);
  });

  it('states the private race the ride was ridden in, as its room said it, and nothing for a ride in none — #785', async () => {
    const terms = () =>
      queryAll(document.querySelector('.oyl-ride-summary') as Element, 'dt').map(
        (term) => term.textContent,
      );
    mounted = await open(
      stubDetail(ATHLETE, {
        activity: stubActivity({
          hasPosition: false,
          rideFacts: { races: [{ roomId: 'room-race', place: 2, finishers: 5 }] },
        }),
        channels: { power: powerSeries(600) },
        laps: [],
      }),
    );
    const row = [...document.querySelectorAll('.oyl-ride-summary > div')].find(
      (each) => each.querySelector('dt')?.textContent === 'Race',
    );
    expect(row?.querySelector('dd')?.textContent).toBe('2nd of 5 in a private race');
    mounted.unmount();
    // #1360's review (N3): two races in one ride are both said, in order.
    mounted = await open(
      stubDetail(ATHLETE, {
        activity: stubActivity({
          hasPosition: false,
          rideFacts: {
            races: [
              { roomId: 'room-race', place: 2, finishers: 5 },
              { roomId: 'room-2', place: null, finishers: null, crossedTheLine: true },
              // #1364: and a place among the riders already across.
              {
                roomId: 'room-3',
                place: null,
                finishers: null,
                crossedTheLine: true,
                placeAcross: 1,
                across: 5,
              },
            ],
          },
        }),
        channels: { power: powerSeries(600) },
        laps: [],
      }),
    );
    const both = [...document.querySelectorAll('.oyl-ride-summary > div')].find(
      (each) => each.querySelector('dt')?.textContent === 'Races',
    );
    expect([...(both?.querySelectorAll('dd') ?? [])].map((each) => each.textContent)).toEqual([
      '2nd of 5 in a private race',
      'A private race, finished: you left before the room gave places',
      '1st across of 5 in a private race, before the room gave places',
    ]);
    mounted.unmount();
    mounted = await open(indoorRide());
    expect(terms()).not.toContain('Race');
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

  it('draws one path a chart and no gap language for an unbroken ride', async () => {
    mounted = await open(indoorRide());
    // Three channels stored, three charts, one unbroken run each.
    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(3);
    expect(queryAll(document, 'svg.oyl-trace path')).toHaveLength(3 * 1);
    expect(document.body.textContent).not.toContain('no reading');
  });
});

describe('#2069 — the ride’s time in zone, on its own page', () => {
  let observers: FakeIntersectionObservers | undefined;

  afterEach(() => {
    observers?.restore();
    observers = undefined;
  });

  /** The same ride to both ports: 300 s at 100 W (zone 1) and 300 s at 200 W (zone 4). */
  function bothPorts(): { readonly detail: StubDetail; readonly analysis: StubAnalysis } {
    const power = [
      ...Array.from({ length: 300 }, () => watts(100)),
      ...Array.from({ length: 300 }, () => watts(200)),
    ];
    const activity = stubActivity({ hasPosition: false });
    return {
      detail: stubDetail(ATHLETE, { activity, channels: { power }, laps: [] }),
      analysis: stubAnalysis(ATHLETE, [{ activity, power }]),
    };
  }

  async function openWithZones(
    detail: StubDetail,
    analysis: StubAnalysis | undefined,
  ): Promise<Mounted> {
    await import('../detail/TraceChart');
    const result = await mount(
      <ActivityDetailView port={detail} activityId={RIDE} analysis={analysis} />,
    );
    await settle();
    await settle();
    return result;
  }

  it('reads nothing for it until the section scrolls into view, then draws the chart and its table', async () => {
    observers = installFakeIntersectionObserver();
    const { detail, analysis } = bothPorts();
    mounted = await openWithZones(detail, analysis);

    const slot = document.querySelector('[data-oyl-zones-slot]');
    expect(slot?.querySelector('h3')?.textContent).toBe('Time in zone');
    expect(slot?.textContent).toContain('Reading time in zone…');
    expect(analysis.channelReads).toEqual([]);

    await observers.reveal([slot as Element]);
    await settle();
    await settle();

    expect(analysis.channelReads).toEqual(['ride-1:power']);
    const shares = queryAll(slot as Element, '.oyl-zone-chart__share').map(
      (share) => share.textContent,
    );
    expect(shares).toEqual(['50%', '0%', '0%', '50%', '0%', '0%', '0%']);
    const table = queryAll(slot as Element, 'table').find((each) =>
      (each.querySelector('caption')?.textContent ?? '').startsWith('Power zones'),
    );
    expect(
      queryAll(table as Element, 'tbody tr').map((row) => row.lastElementChild?.textContent),
    ).toEqual(shares);
    expect(slot?.querySelector('h4')?.textContent).toBe('Power zones');
  });

  it('has no such section with no analysis port, nor for a ride with no power or heart rate', async () => {
    const { detail } = bothPorts();
    mounted = await openWithZones(detail, undefined);
    expect(document.querySelector('[data-oyl-zones-slot]')).toBeNull();
    mounted.unmount();

    const cadenceOnly = stubDetail(ATHLETE, {
      activity: stubActivity({ hasPosition: false }),
      channels: { cadence: Array.from({ length: 60 }, () => revolutionsPerMinute(90)) },
      laps: [],
    });
    mounted = await openWithZones(cadenceOnly, bothPorts().analysis);
    expect(document.querySelector('[data-oyl-zones-slot]')).toBeNull();
    expect(document.body.textContent).not.toContain('Time in zone');
  });

  it('forgets one ride’s zones when the page moves to another, and reads the next only once it is in view', async () => {
    observers = installFakeIntersectionObserver();
    const power = [
      ...Array.from({ length: 300 }, () => watts(100)),
      ...Array.from({ length: 300 }, () => watts(200)),
    ];
    const first = stubActivity({ hasPosition: false });
    const second = stubActivity({ id: activityId('ride-2'), hasPosition: false });
    const detail = stubDetail(ATHLETE, { activity: first, channels: { power }, laps: [] });
    const other = stubDetail(ATHLETE, { activity: second, channels: { power }, laps: [] });
    const analysis = stubAnalysis(ATHLETE, [
      { activity: first, power },
      { activity: second, power },
    ]);
    await import('../detail/TraceChart');
    const view = (port: StubDetail, id: string): ReactElement => (
      <ActivityDetailView port={port} activityId={id} analysis={analysis} />
    );
    mounted = await mount(view(detail, 'ride-1'));
    await settle();
    await settle();
    await observers.reveal([document.querySelector('[data-oyl-zones-slot]') as Element]);
    await settle();
    await settle();
    expect(analysis.channelReads).toEqual(['ride-1:power']);

    await mounted.rerender(view(other, 'ride-2'));
    await settle();
    await settle();

    const slot = document.querySelector('[data-oyl-zones-slot]');
    expect(analysis.channelReads).toEqual(['ride-1:power']);
    expect(slot?.querySelector('.oyl-zone-chart')).toBeNull();
    expect(slot?.textContent).toContain('Reading time in zone…');

    await observers.reveal([slot as Element]);
    await settle();
    await settle();
    expect(analysis.channelReads).toEqual(['ride-1:power', 'ride-2:power']);
  });

  it('says so when the read fails, rather than drawing nothing', async () => {
    const { detail, analysis } = bothPorts();
    const broken: StubAnalysis = {
      ...analysis,
      store: {
        ...analysis.store,
        getAthlete: () => Promise.reject(new Error('the database is closed')),
      },
    };
    mounted = await openWithZones(detail, broken);
    expect(document.querySelector('[data-oyl-zones-slot]')?.textContent).toContain(
      'Could not read this ride’s time in zone. the database is closed',
    );
  });
});

describe('#2068 — every recorded channel is a chart, read when it scrolls into view', () => {
  let observers: FakeIntersectionObservers | undefined;

  afterEach(() => {
    observers?.restore();
    observers = undefined;
  });

  const slotOf = (channel: string): Element =>
    document.querySelector(`[data-oyl-trace-slot="${channel}"]`) as Element;

  it('decodes on first render only the charts in view, and the rest as each scrolls in', async () => {
    observers = installFakeIntersectionObserver();
    const port = indoorRide();
    mounted = await open(port);
    // Every chart's slot is drawn and watched, and nothing is read until one
    // is in view: a four-hour ride inflates only what is seen.
    expect(
      queryAll(document, '[data-oyl-trace-slot]').map((slot) =>
        slot.getAttribute('data-oyl-trace-slot'),
      ),
    ).toEqual(['power', 'heartRate', 'cadence']);
    expect(observers.observed()).toHaveLength(3);
    expect(port.channelReads).toEqual([]);

    // The first two in view, as a page opened at the top shows them.
    await observers.reveal([slotOf('power'), slotOf('heartRate')]);
    await settle();
    await settle();
    expect(port.channelReads).toEqual(['power', 'heartRate']);
    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(2);
    expect(slotOf('cadence').textContent).toBe('Reading cadence…');

    // Scrolled down: the third arrives, and the first two are not read again.
    await observers.reveal([slotOf('cadence')]);
    await settle();
    await settle();
    expect(port.channelReads).toEqual(['power', 'heartRate', 'cadence']);
    expect(queryAll(document, 'svg.oyl-trace')).toHaveLength(3);
    expect(slotOf('cadence').querySelector('.oyl-trace-chart__value-title')?.textContent).toBe(
      'Cadence (rpm)',
    );
  });

  it('reads a chart once, however often it scrolls back into view', async () => {
    // The samples do not change, so a second inflate of the same blob is pure
    // cost — and it is the read this whole module is arranged to avoid.
    observers = installFakeIntersectionObserver();
    const port = indoorRide();
    mounted = await open(port);
    await observers.reveal([slotOf('power')]);
    await settle();
    // A slot once seen is no longer watched, so a second sighting cannot ask.
    expect(observers.observed()).not.toContain(slotOf('power'));
    await observers.reveal([slotOf('power')]);
    await settle();
    expect(port.channelReads).toEqual(['power']);
  });

  it('draws every chart on one time axis: the ride’s own start and end', async () => {
    // Power is 1 200 s long and heart rate only 600 s, so a chart that took its
    // axis from its own trace would end heart rate's at 10:00.
    mounted = await open(
      stubDetail(ATHLETE, {
        activity: stubActivity({ hasPosition: false }),
        channels: {
          power: powerSeries(1200),
          heartRate: Array.from({ length: 600 }, () => beatsPerMinute(142)),
        },
        laps: [],
      }),
    );
    const times = queryAll(document, '.oyl-trace-chart').map((chart) =>
      queryAll(chart, '.oyl-trace-chart__times > div').map((each) => each.textContent),
    );
    expect(times).toEqual([
      ['0:00', '10:00', '20:00'],
      ['0:00', '10:00', '20:00'],
    ]);
    // And the shorter trace is drawn over its own half of the width.
    const xsOf = (path: Element): number[] =>
      [...(path.getAttribute('d') ?? '').matchAll(/[ML](-?[\d.]+)/g)].map((match) =>
        Number(match[1]),
      );
    const [power, heartRate] = queryAll(document, 'svg.oyl-trace path');
    expect(Math.max(...xsOf(power as Element))).toBeCloseTo(600, 0);
    expect(Math.max(...xsOf(heartRate as Element))).toBeCloseTo(300, 0);
  });

  it('moves one cursor across every chart, and reads each chart at that time in words', async () => {
    mounted = await open(indoorRide());
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]#oyl-trace-cursor');
    expect(slider).not.toBeNull();
    expect(document.querySelector('label[for="oyl-trace-cursor"]')?.textContent).toBe(
      'Read every chart at',
    );
    // A 1 200 s ride drawn at 600 points: a step is one point, two seconds.
    expect(slider?.max).toBe('1200');
    expect(slider?.step).toBe('2');

    await typeInto(slider as HTMLInputElement, '600');
    await settle();

    expect(slider?.getAttribute('aria-valuetext')).toBe('10:00');
    // Power's point 300 is samples 600 and 601 averaged: 150 W and 151 W.
    expect(document.querySelector('output[for="oyl-trace-cursor"]')?.textContent).toBe(
      '10:00: Power 151 W, Heart rate 142 bpm, Cadence 88 rpm',
    );
    // Halfway along the ride, on every chart: x = 300 of the 600-unit drawing.
    const lines = queryAll(document, 'svg.oyl-trace line.oyl-trace__cursor');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.getAttribute('x1'))).toEqual(['300.00', '300.00', '300.00']);
  });

  it('says "no reading" at the cursor in a gap, never a zero', async () => {
    mounted = await open(indoorRide(powerSeries(1200, 400, 300)));
    await typeInto(
      document.querySelector<HTMLInputElement>('#oyl-trace-cursor') as HTMLInputElement,
      '500',
    );
    await settle();
    expect(document.querySelector('output[for="oyl-trace-cursor"]')?.textContent).toBe(
      '8:20: Power no reading, Heart rate 142 bpm, Cadence 88 rpm',
    );
  });

  it('labels a speed chart and its table in km/h once converted, not twice', async () => {
    // 10 m/s is 36 km/h. Before #2068 the axis and the table converted the
    // already-converted points again, and read 129.6.
    mounted = await open(
      stubDetail(ATHLETE, {
        activity: stubActivity({ hasPosition: false }),
        channels: { speed: Array.from({ length: 600 }, () => metresPerSecond(10)) },
        laps: [],
      }),
    );
    const chart = document.querySelector('[data-oyl-trace-slot="speed"]');
    expect(
      queryAll(chart as Element, '.oyl-trace-chart__values > div').map((each) => each.textContent),
    ).toEqual(['', '36.0 km/h', '']);
    const cells = queryAll(chart as Element, 'table.oyl-data-table tbody tr > :nth-child(2)').map(
      (cell) => cell.textContent,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(new Set(cells)).toEqual(new Set(['36.0']));
  });

  it('charts no coordinate: an outdoor ride’s latitude and longitude are neither read nor drawn', async () => {
    const port = outdoorRide([]);
    mounted = await open(port);
    expect(
      queryAll(document, '[data-oyl-trace-slot]').map((slot) =>
        slot.getAttribute('data-oyl-trace-slot'),
      ),
    ).toEqual(['power']);
    expect(port.channelReads).toEqual(['power']);
    expect(document.body.textContent).not.toMatch(/latitude|longitude/i);
    expect(document.body.textContent).not.toContain('51.5');
  });
});

describe('criterion 4 — the view does not load a full 1 Hz stream', () => {
  it('reads each chart’s channel once and never one it does not draw', async () => {
    // No observer in jsdom, so every slot counts as in view (`detail/visibility.ts`).
    const port = indoorRide();
    mounted = await open(port);
    expect(port.channelReads).toEqual(['power', 'heartRate', 'cadence']);
    expect(port.channelReads).not.toContain('latitude');
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

  it('reads no privacy zone until the shared view is asked for', async () => {
    // ⚠️ This assertion moved with #63 and the move is the point. It used to
    // say no *position channel* was read until the preview was opened, which
    // was true only because nothing drew the track. A map draws it, so the
    // positions are now read on open — see the map tests below.
    //
    // What is still true, and is the thing that actually separates the owner's
    // view from the published one, is that **no zone is consulted**: the
    // rider's own track is not trimmed (ADR 0004 decision E), so the zone query
    // is the preview's cost rather than the page's.
    const port = outdoorRide([homeZone()]);
    mounted = await open(port);
    expect(port.zoneReads).toEqual([]);
  });
});

describe('#63 — the map on the detail screen', () => {
  it('draws the ride’s own whole track, and consults no zone to do it', async () => {
    const port = outdoorRide([homeZone()]);
    const map = stubMapPort();
    mounted = await open(port, RIDE, { map, basemap: BASEMAP });

    expect(map.created).toHaveLength(1);
    expect(port.zoneReads).toEqual([]);
    // Every stored fix reaches the map, including the ones inside the zone:
    // this is the rider looking at their own ride.
    const drawn = everyCoordinateHandedTo(map.created[0] as never);
    expect(drawn.length).toBe(300);
  });

  it('loads no map engine at all for an indoor ride', async () => {
    // #63's first criterion, as a read rather than as a rendering decision: a
    // ride with no GPS costs no `maplibre-gl` download and no position decode.
    // The loader is never called, so the 900 KB chunk is never fetched.
    let loads = 0;
    const port = indoorRide();
    mounted = await open(port, RIDE, {
      map: stubMapPort(),
      basemap: BASEMAP,
      onLoad: () => {
        loads += 1;
      },
    });
    expect(loads).toBe(0);
    expect(port.channelReads).not.toContain('latitude');
    expect(document.querySelector('.oyl-map')).toBeNull();
  });

  it('hands the map the trimmed track when the shared view is open — criterion 6', async () => {
    // The strongest form of the criterion at this layer: the untrimmed
    // coordinates are not in the map's props, its recorded history or the DOM.
    const port = outdoorRide([homeZone()]);
    const map = stubMapPort();
    mounted = await open(port, RIDE, { map, basemap: BASEMAP });

    const reveal = queryAll<HTMLButtonElement>(document, 'button').find((button) =>
      button.textContent?.includes('Show what a shared copy would contain'),
    );
    await activateWithKeyboard(reveal as HTMLButtonElement);
    await settle();
    await settle();

    // What the map is showing *now*, not everything it has ever been given:
    // the owner's own whole track was on it a moment ago and correctly so.
    // The same map object, because swapping the line does not rebuild it.
    expect(map.created).toHaveLength(1);
    const drawn = coordinatesNowOn(map.created[0] as never);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(300);
    const radius = trimRadius(metres(500), RIDE, 'home');
    for (const [longitude, latitude] of drawn) {
      expect(
        distanceBetween(
          geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
          HOME,
        ),
      ).toBeGreaterThan(radius);
    }
  });

  it('says no basemap is configured rather than drawing an empty grid', async () => {
    // A build told `none`, or given a value that is not an `https:` URL.
    // Since #534 an unconfigured build defaults to the published archive.
    const port = outdoorRide([]);
    mounted = await open(port, RIDE, { map: stubMapPort(), basemap: undefined });
    expect(document.body.textContent).toContain('No basemap is configured');
    expect(document.querySelector('.oyl-map')).toBeNull();
  });

  it('asks for no tile when the rider turned map tiles off, and still draws the line and the credit', async () => {
    // The owner's decision of 2026-09-25: a Settings switch, on by default.
    const port = outdoorRide([]);
    const map = stubMapPort();
    const turnedOff: PreferenceStorage = {
      getItem: (key) => (key === MAP_TILES_STORAGE_KEY ? 'off' : null),
      setItem: () => undefined,
    };
    mounted = await open(port, RIDE, { map, basemap: BASEMAP, preferences: turnedOff });
    expect(map.created).toHaveLength(1);
    expect(styleOrigins(map.created[0]?.options.style as BasemapStyle)).toEqual([]);
    expect(everyCoordinateHandedTo(map.created[0] as never).length).toBe(300);
    expect(document.querySelector('.oyl-map__attribution')?.textContent).toBe(
      '© OpenStreetMap contributors',
    );
  });

  it('draws tiles from the configured host for a device that never chose', async () => {
    const port = outdoorRide([]);
    const map = stubMapPort();
    const never: PreferenceStorage = { getItem: () => null, setItem: () => undefined };
    mounted = await open(port, RIDE, { map, basemap: BASEMAP, preferences: never });
    expect(styleOrigins(map.created[0]?.options.style as BasemapStyle)).toEqual([
      'https://tiles.example.org',
    ]);
  });

  it('renders the OpenStreetMap credit whenever it renders a map', async () => {
    const port = outdoorRide([]);
    mounted = await open(port, RIDE, { map: stubMapPort(), basemap: BASEMAP });
    expect(document.querySelector('.oyl-map__attribution')?.textContent).toBe(
      '© OpenStreetMap contributors',
    );
  });
});

describe('criterion 6 — every chart has a non-visual equivalent', () => {
  it('renders a table of the same series beside the drawing', async () => {
    mounted = await open(indoorRide());
    const tables = queryAll(document, 'table.oyl-data-table');
    expect(tables.length).toBe(3);
    expect(tables[0]?.querySelector('caption')?.textContent).toBe('Power (W)');
  });

  it('puts each table behind a closed disclosure under its chart, named for its readings — #1439', async () => {
    mounted = await open(indoorRide());
    const disclosures = queryAll<HTMLDetailsElement>(document, 'details.oyl-chart-table');
    expect(disclosures).toHaveLength(3);
    for (const disclosure of disclosures) {
      expect(disclosure.open).toBe(false);
      expect(disclosure.querySelector('table.oyl-data-table')).not.toBeNull();
      // Right after its own chart.
      expect(disclosure.previousElementSibling?.classList.contains('oyl-trace-chart')).toBe(true);
    }
    expect(disclosures[0]?.querySelector('summary')?.textContent).toBe(
      'Power (W): the readings as a table',
    );
  });

  it('labels each chart’s value axis and time axis — #1439', async () => {
    mounted = await open(indoorRide());
    const chart = document.querySelector('.oyl-trace-chart');
    expect(chart?.querySelector('.oyl-trace-chart__value-title')?.textContent).toBe('Power (W)');
    expect(queryAll(chart as Element, '.oyl-trace-chart__values > div')).toHaveLength(3);
    expect(
      queryAll(chart as Element, '.oyl-trace-chart__times > div').map(
        (each) => each.textContent,
      )[0],
    ).toBe('0:00');
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
    // #1312: the page marks the best lap in the row's own header. The stub's
    // two laps took the same time, and the earlier of two equal laps is it
    // (`detail/LapsTable.test.tsx` holds the rule's other cases).
    expect(rows[0]?.querySelector('th')?.textContent).toBe('1 · Best lap');
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

describe('the workout-block table — #1319', () => {
  const headings = () =>
    queryAll<HTMLElement>(document, 'h3').map((heading) => heading.textContent ?? '');

  it('lists a ride’s workout blocks under their own heading, after the laps', async () => {
    const port = stubDetail(ATHLETE, {
      activity: stubActivity({
        rideFacts: {
          workoutBlocks: [
            {
              outcome: 'cut-short',
              block: { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
              startedAt: unixSeconds(1_760_000_000),
              elapsedTime: seconds(300),
              movingTime: seconds(300),
            },
            { outcome: 'skipped', block: { kind: 'free-ride', seconds: seconds(300) } },
          ],
        },
      }),
      channels: { power: powerSeries(60) },
      laps: [stubLap(0)],
    });
    mounted = await open(port);
    const shown = headings();
    expect(shown.indexOf('Workout blocks')).toBeGreaterThan(shown.indexOf('Laps'));
    const table = queryAll<HTMLElement>(document, 'table').find((each) =>
      each.querySelector('caption')?.textContent?.startsWith('Workout blocks'),
    );
    const rows = queryAll<HTMLElement>(table!, 'tbody th').map((cell) => cell.textContent);
    expect(rows).toEqual(['1 · Cut short', '2 · Skipped']);
  });

  it('shows nothing of it for a ride with no workout', async () => {
    mounted = await open(indoorRide());
    expect(headings()).not.toContain('Workout blocks');
  });
});

describe('a trace is not left converted into the units the rider has left (#238)', () => {
  it('re-reads every open trace when the preference changes', async () => {
    // ⚠️ **The defect this guards is invisible.** A `Trace` holds numbers that
    // have already been through `series.display` — miles per hour, or feet —
    // so a cache keyed on the channel alone keeps serving the *old* system's
    // numbers under the new system's axis label. The chart redraws, the label
    // changes, and the line does not move.
    const port = indoorRide();
    const view = await mount(reading(port, 'metric'));
    await settle();
    await settle();
    mounted = view;

    const before = [...port.channelReads];
    expect(before).toEqual(['power', 'heartRate', 'cadence']);

    await view.rerender(reading(port, 'imperial'));
    await settle();
    await settle();

    expect(port.channelReads).toEqual([...before, 'power', 'heartRate', 'cadence']);
  });

  it('renders the ride summary in the rider\u2019s units', async () => {
    const port = indoorRide();
    const view = await mount(reading(port, 'imperial'));
    await settle();
    await settle();
    mounted = view;

    // `stubActivity`'s distance in miles rather than kilometres. Read from the
    // summary list the view renders rather than from a helper, so a component
    // that converted the number and kept the old label fails here.
    const summary = document.querySelector('.oyl-ride-summary')?.textContent ?? '';
    expect(summary).toContain('mi');
    expect(summary).not.toContain('km');
  });
});

describe('#2068 — the stacked charts, read back from the real store (docs/agents/quality-gate.md §5)', () => {
  /** Turns of the event loop a real-store read may take before the test gives up (#575's bound). */
  const READ_TURNS = 200;
  const SAMPLES = 1800;

  async function until(done: () => boolean, what: string): Promise<void> {
    for (let turn = 0; !done(); turn += 1) {
      if (turn >= READ_TURNS) {
        throw new Error(`${what} after ${String(READ_TURNS)} turns`);
      }
      await settle();
    }
  }

  interface DrawnChart {
    readonly channel: string | null;
    readonly paths: number;
    readonly times: readonly (string | null)[];
  }

  /**
   * Record a ride with `channels` through the store's public writes, open its
   * page on a connection nothing wrote on, scroll every chart into view, and
   * read what each one drew.
   */
  async function chartsOf(channels: readonly StreamChannel[]): Promise<readonly DrawnChart[]> {
    resetFixtureIds();
    const harness = createStoreHarness();
    const observers = installFakeIntersectionObserver();
    try {
      await seedAthletes(harness);
      const ride = await seedRide(harness, ATHLETE_A);
      await harness.write(async (store) =>
        store.putStreamSet(streamSetFor(ride, { sampleCount: SAMPLES, channels })),
      );
      await harness.discard();
      const store = openActivityStore(harness.databaseName);
      try {
        await import('../detail/TraceChart');
        mounted = await mount(
          <ActivityDetailView port={{ athleteId: ATHLETE_A, store }} activityId={ride.id} />,
        );
        await until(
          () => !(document.body.textContent ?? '').includes(READING_RIDE_TEXT),
          'the ride’s page was still reading its ride',
        );
        // Scrolled from the top to the bottom, one slot at a time.
        const slots = queryAll(document, '[data-oyl-trace-slot]');
        for (const slot of slots) {
          await observers.reveal([slot]);
          await until(
            () => slot.querySelector('svg.oyl-trace') !== null,
            `the ${slot.getAttribute('data-oyl-trace-slot') ?? ''} chart was still not drawn`,
          );
        }
        return slots.map((slot) => ({
          channel: slot.getAttribute('data-oyl-trace-slot'),
          paths: queryAll(slot, 'svg.oyl-trace path').length,
          times: queryAll(slot, '.oyl-trace-chart__times > div').map((each) => each.textContent),
        }));
      } finally {
        mounted?.unmount();
        mounted = undefined;
        store.close();
      }
    } finally {
      observers.restore();
      await harness.destroy();
    }
  }

  it('draws five charts for a ride with all five channels, each on the ride’s own time axis', async () => {
    const charts = await chartsOf(['power', 'heartRate', 'cadence', 'speed', 'altitude']);
    expect(charts.map((chart) => chart.channel)).toEqual([
      'power',
      'heartRate',
      'cadence',
      'speed',
      'altitude',
    ]);
    for (const chart of charts) {
      expect(chart.paths, `${chart.channel ?? ''} drew no line`).toBeGreaterThanOrEqual(1);
      // 1 800 samples a second apart: the ride starts at 0:00 and ends at 30:00.
      expect(chart.times[0]).toBe('0:00');
      expect(chart.times.at(-1)).toBe('30:00');
    }
  });

  it('draws four for the same ride with no cadence — the control', async () => {
    const charts = await chartsOf(['power', 'heartRate', 'speed', 'altitude']);
    expect(charts.map((chart) => chart.channel)).toEqual([
      'power',
      'heartRate',
      'speed',
      'altitude',
    ]);
  });
});
