// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #48's seventh acceptance criterion: *"the shell renders and is navigable with
 * JavaScript-heavy charts absent, so a failed chart bundle does not blank the
 * page."*
 *
 * Two halves, and both are here because either alone would be misleading:
 *
 * 1. **With no chart at all**, every route renders its data and every
 *    navigation link works. That is the shell as it ships today — #50's
 *    activity detail view supplies the first chart — so it is the literal
 *    reading of "charts absent".
 * 2. **With a chart that fails**, the failure is contained: the table replaces
 *    it, the surrounding page is still there, and the navigation beside it is
 *    still focusable and still works. Without a boundary the whole React tree
 *    unmounts, and "does not blank the page" is exactly the thing that stops
 *    being true.
 */

import { unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubAnalysis } from '../analysis/testing';
import type * as ZoneChartModule from '../analysis/ZoneChart';
import type * as WeekChartModule from '../home/WeekChart';
import { ChartSlot } from '../design/ChartSlot';
import { stubActivity } from '../detail/testing';
import { AnalysisView } from '../views/AnalysisView';
import { stubLibrary } from '../library/testing';
import { AppShell } from '../shell/AppShell';
import { groupDestination, hrefFor, ROUTES, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { auditAccessibility, formatViolations, tabbableElements } from './audit';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/**
 * #2069: the zone chart, made to throw on demand. The real one otherwise, so
 * every other case in this file draws what ships.
 */
const zoneChartFails = vi.hoisted(() => ({ now: false }));
vi.mock('../analysis/ZoneChart', async (importOriginal) => {
  const real = await importOriginal<typeof ZoneChartModule>();
  return {
    ...real,
    ZoneChart: (props: ZoneChartModule.ZoneChartProps) => {
      if (zoneChartFails.now) {
        throw new Error('the zone chart failed to draw');
      }
      return real.ZoneChart(props);
    },
  };
});

/** #2049: Home's week chart, made to throw on demand, as the zone chart above. */
const weekChartFails = vi.hoisted(() => ({ now: false }));
vi.mock('../home/WeekChart', async (importOriginal) => {
  const real = await importOriginal<typeof WeekChartModule>();
  return {
    ...real,
    WeekChart: (props: WeekChartModule.WeekChartProps) => {
      if (weekChartFails.now) {
        throw new Error('the week chart failed to draw');
      }
      return real.WeekChart(props);
    },
  };
});

/**
 * An empty local store for the activities route.
 *
 * Passed since #62, which made `ActivitiesView` say "this browser has no local
 * store" when it has no port rather than render an empty table — an empty table
 * would tell a rider they have no rides when the truth is that we could not
 * look. This test is about the chart-free *table*, so it supplies the store the
 * table needs; the no-store state has its own coverage in
 * `views/ActivitiesView.test.tsx`.
 */
const EMPTY_LIBRARY = stubLibrary(athleteId('athlete-a'), []);

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function Boom(): never {
  throw new Error('the chart bundle failed to load');
}

describe('with no charts at all — the shell as it ships', () => {
  it('renders every route and stays navigable', async () => {
    globalThis.location.hash = '#/';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    for (const destination of ROUTES) {
      const find = (): HTMLAnchorElement | null =>
        document.querySelector<HTMLAnchorElement>(
          `nav a[href="${hrefFor(destination)}"], .oyl-more a[href="${hrefFor(destination)}"]`,
        );
      if (find() === null) {
        // #1429: the More tab opens its menu, which links to the page.
        const group = document.querySelector<HTMLAnchorElement>(
          `nav[aria-label="Primary"] a[href="${hrefFor(groupDestination(destination.group ?? 'more'))}"]`,
        );
        expect(group).not.toBeNull();
        await activateWithKeyboard(group as HTMLAnchorElement);
      }
      const link = find();
      expect(link).not.toBeNull();
      await activateWithKeyboard(link as HTMLAnchorElement);
      expect(document.querySelector('h1')?.textContent).toBe(destination.title);
      expect(document.querySelector('main')?.textContent).not.toBe('');
    }
  });

  it('shows the ride and activity data as tables, which is the chart-free base case', async () => {
    globalThis.location.hash = '#/activities';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} library={EMPTY_LIBRARY} />);
    await settle();
    expect(document.body.textContent).toContain('Rides on this device');
    expect(document.body.textContent).toContain('Nothing recorded yet');
  });
});

describe('with a chart that throws while rendering', () => {
  it('replaces it with the table and leaves the rest of the page standing', async () => {
    mounted = await mount(
      <div>
        <nav aria-label="Primary">
          <ul>
            <li>
              <a href={hrefFor(routeById('about'))}>About</a>
            </li>
          </ul>
        </nav>
        <main>
          <h1>Ride</h1>
          <ChartSlot
            caption="Power"
            columns={['Time', 'Watts']}
            rows={[
              ['0:01', '212'],
              ['0:02', '218'],
            ]}
            emptyMessage="No readings."
            chart={<Boom />}
          />
        </main>
      </div>,
    );
    await settle();

    // The chart failed…
    expect(mounted.caughtErrors.map((error) => error.message)).toContain(
      'the chart bundle failed to load',
    );
    // …the data is still on the page…
    expect(document.querySelector('table caption')?.textContent).toBe('Power');
    expect(document.body.textContent).toContain('218');
    // …and the page around it did not go with it.
    const link = document.querySelector<HTMLAnchorElement>('nav a');
    expect(link).not.toBeNull();
    expect(tabbableElements(document)).toContain(link);
    expect(document.querySelector('h1')?.textContent).toBe('Ride');
  });

  it('leaves the degraded page passing the accessibility audit', async () => {
    // A fallback nobody audited is where a table without headers, or a caption
    // that is really a heading, ends up. The degraded state is a state.
    document.documentElement.lang = 'en';
    mounted = await mount(
      <main>
        <h1>Ride</h1>
        <ChartSlot
          caption="Power"
          columns={['Time', 'Watts']}
          rows={[['0:01', '212']]}
          emptyMessage="No readings."
          chart={<Boom />}
        />
      </main>,
    );
    await settle();
    const violations = auditAccessibility(document);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });
});

describe('with a zone chart that throws while rendering — #2069', () => {
  afterEach(() => {
    zoneChartFails.now = false;
  });

  async function analysisOfOneRide(): Promise<Mounted> {
    const port = stubAnalysis(athleteId('athlete-a'), [
      {
        activity: stubActivity({ id: activityId('ride-1'), name: 'ride-1' }),
        power: Array.from({ length: 600 }, () => watts(200)),
      },
    ]);
    const result = await mount(
      <div>
        <nav aria-label="Primary">
          <ul>
            <li>
              <a href={hrefFor(routeById('about'))}>About</a>
            </li>
          </ul>
        </nav>
        <main>
          <h1>Analysis</h1>
          <AnalysisView port={port} />
        </main>
      </div>,
    );
    await settle();
    return result;
  }

  it('leaves the zone table, with every share, and the page around it', async () => {
    zoneChartFails.now = true;
    mounted = await analysisOfOneRide();

    expect(mounted.caughtErrors.map((error) => error.message)).toContain(
      'the zone chart failed to draw',
    );
    expect(document.querySelector('.oyl-zone-chart')).toBeNull();
    const table = [...document.querySelectorAll('table')].find((each) =>
      (each.querySelector('caption')?.textContent ?? '').startsWith('Power zones'),
    );
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(table?.textContent).toContain('100%');
    const link = document.querySelector<HTMLAnchorElement>('nav a');
    expect(tabbableElements(document)).toContain(link);
    expect(document.body.textContent).toContain('Duration personal bests');
  });

  it('draws the chart above the same table when nothing throws — the control', async () => {
    mounted = await analysisOfOneRide();

    expect(mounted.caughtErrors).toEqual([]);
    expect(document.querySelector('.oyl-zone-chart')).not.toBeNull();
  });
});

describe('with Home’s week chart throwing while rendering — #2049', () => {
  afterEach(() => {
    weekChartFails.now = false;
  });

  /** Home through the real shell, with rides on two days of this week. */
  async function homeWithAWeek(): Promise<Mounted> {
    const now = Date.now() / 1000;
    const port = stubAnalysis(athleteId('athlete-a'), [
      {
        activity: stubActivity({
          id: activityId('this-week-1'),
          name: 'Tuesday',
          startedAt: unixSeconds(Math.floor(now - 2 * 86_400)),
          startedAtTimeZone: 'UTC',
        }),
      },
      {
        activity: stubActivity({
          id: activityId('this-week-2'),
          name: 'Yesterday',
          startedAt: unixSeconds(Math.floor(now - 86_400)),
          startedAtTimeZone: 'UTC',
        }),
      },
    ]);
    globalThis.location.hash = '#/';
    const result = await mount(<AppShell capabilities={NO_BLUETOOTH} analysis={port} />);
    await settle();
    await settle();
    return result;
  }

  const weekTable = (): HTMLTableElement | undefined =>
    [...document.querySelectorAll('main table')].find(
      (each) => each.querySelector('caption')?.textContent === 'Day by day',
    ) as HTMLTableElement | undefined;

  it('is replaced by its table, open, and Home is still there around it', async () => {
    weekChartFails.now = true;
    mounted = await homeWithAWeek();

    expect(mounted.caughtErrors.map((error) => error.message)).toContain(
      'the week chart failed to draw',
    );
    expect(document.querySelector('.oyl-week-chart')).toBeNull();
    // The text equivalent, every day of it, and not tucked in a disclosure.
    const table = weekTable();
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(table?.closest('details')).toBeNull();
    // The rest of Home: its title, Next up, the last ride and the week's totals.
    expect(document.querySelector('main h1')?.textContent).toBe('Home');
    expect(document.querySelector('main .oyl-next-up')).not.toBeNull();
    expect(document.querySelector('main .oyl-home__last')?.textContent).toContain('Yesterday');
    expect(document.querySelector('main .oyl-home__week .oyl-home__facts')?.textContent).toContain(
      'Rides2',
    );
    const violations = auditAccessibility(document);
    expect(formatViolations(violations)).toBe('');
  });

  it('draws the chart, with the table one press away, when nothing throws — the control', async () => {
    mounted = await homeWithAWeek();

    expect(mounted.caughtErrors).toEqual([]);
    expect(document.querySelector('.oyl-week-chart')).not.toBeNull();
    const table = weekTable();
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(table?.closest('details')).not.toBeNull();
  });
});
