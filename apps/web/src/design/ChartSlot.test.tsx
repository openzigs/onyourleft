// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import { ChartSlot } from './ChartSlot';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const ROWS = [
  ['0:01', '212'],
  ['0:02', '218'],
] as const;

function Boom(): never {
  throw new Error('the chart bundle failed to load');
}

describe('with no chart supplied — how every view in the shell uses it today', () => {
  it('renders the data as a table, not a placeholder', async () => {
    mounted = await mount(
      <ChartSlot
        caption="Power"
        columns={['Time', 'Watts']}
        rows={ROWS.map((row) => [...row])}
        emptyMessage="No readings."
      />,
    );
    expect(mounted.container.querySelector('caption')?.textContent).toBe('Power');
    expect([...mounted.container.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Time',
      'Watts',
    ]);
    expect(mounted.container.querySelectorAll('tbody tr')).toHaveLength(2);
    // `scope` is what ties a header to its column for a screen reader reading
    // cell by cell. Without it a data table is a grid of unlabelled numbers.
    expect(
      [...mounted.container.querySelectorAll('th')].every(
        (th) => th.getAttribute('scope') === 'col',
      ),
    ).toBe(true);
  });

  it('says what is missing rather than rendering an empty table', async () => {
    mounted = await mount(
      <ChartSlot
        caption="Power"
        columns={['Time', 'Watts']}
        rows={[]}
        emptyMessage="No readings yet."
      />,
    );
    expect(mounted.container.querySelector('table')).toBeNull();
    expect(mounted.container.textContent).toContain('No readings yet.');
  });
});

describe('with a chart that renders', () => {
  it('shows the chart and not the table', async () => {
    mounted = await mount(
      <ChartSlot
        caption="Power"
        columns={['Time', 'Watts']}
        rows={ROWS.map((row) => [...row])}
        emptyMessage="No readings."
        chart={<svg role="img" aria-label="Power over time" />}
      />,
    );
    expect(mounted.container.querySelector('svg')).not.toBeNull();
    expect(mounted.container.querySelector('table')).toBeNull();
  });
});

describe('with a chart that throws — criterion 7', () => {
  it('falls back to the table carrying the same values', async () => {
    mounted = await mount(
      <ChartSlot
        caption="Power"
        columns={['Time', 'Watts']}
        rows={ROWS.map((row) => [...row])}
        emptyMessage="No readings."
        chart={<Boom />}
      />,
    );
    await settle();
    expect(mounted.container.querySelector('table')).not.toBeNull();
    expect(mounted.container.textContent).toContain('218');
  });

  it('reports what it caught, so a caller can do something about it', async () => {
    const seen: string[] = [];
    mounted = await mount(
      <ChartSlot
        caption="Power"
        columns={['Time', 'Watts']}
        rows={ROWS.map((row) => [...row])}
        emptyMessage="No readings."
        chart={<Boom />}
        onChartError={(error) => seen.push(error.message)}
      />,
    );
    await settle();
    expect(seen).toEqual(['the chart bundle failed to load']);
  });

  it('does not take its siblings down with it', async () => {
    // The failure mode the boundary exists for. Without it the exception
    // propagates to the root and React unmounts the entire tree — the heading,
    // the navigation and everything else on the page.
    mounted = await mount(
      <div>
        <h2 id="sibling">Still here</h2>
        <ChartSlot
          caption="Power"
          columns={['Time', 'Watts']}
          rows={ROWS.map((row) => [...row])}
          emptyMessage="No readings."
          chart={<Boom />}
        />
        <button type="button">Also still here</button>
      </div>,
    );
    await settle();
    expect(mounted.container.querySelector('#sibling')?.textContent).toBe('Still here');
    expect(mounted.container.querySelector('button')?.textContent).toBe('Also still here');
  });
});
