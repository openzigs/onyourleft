// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import type { PairRecord } from './measure';
import { appendRow, REPORT_COLUMNS, reportRow } from './report';

const STEP = { routeMs: 1, requests: 0, tiles: 0, bytes: 0, transferBytes: 0 };

const FULL: PairRecord = {
  pair: 2,
  run: 1,
  targetKm: 40,
  routedKm: 38.912,
  withinClass: true,
  init: { ms: 182.4, workerReadyMs: 180, moduleStartupMs: 120, graphStartupMs: 30, bytes: 13_990 },
  cold: { ms: 252.6, routeMs: 250, bytes: 9_600_000, tiles: 5, requests: 5, transferBytes: null },
  warm: { ...STEP, ms: 12.4 },
  drag: { ...STEP, ms: 17.5, requests: 1 },
  wasmHighWaterBytes: 128 * 1024 * 1024,
  decodedCacheBytes: 7.4 * 1024 * 1024,
};

describe('reportRow', () => {
  it('gives one cell per column, in the spike’s units', () => {
    const row = reportRow(FULL);
    expect(row).toHaveLength(REPORT_COLUMNS.length);
    expect(Object.fromEntries(REPORT_COLUMNS.map((column, at) => [column, row[at]]))).toEqual({
      Pair: '2',
      Run: '1',
      'Class (km)': '40',
      'Routed (km)': '38.91',
      'Init (ms)': '182',
      'Cold (ms)': '253',
      'Cold bytes (MB)': '9.6',
      'Cold tiles': '5',
      'Cold transfer (MB)': 'unknown',
      'Warm (ms)': '12',
      'Warm requests': '0',
      'Drag (ms)': '18',
      'Drag requests': '1',
      'WASM high water (MiB)': '128',
      'Decoded cache (MiB)': '7.4',
      Error: '',
    });
  });

  it('says when a route is out of its class, and which step failed', () => {
    const row = reportRow({
      pair: 1,
      run: 3,
      targetKm: 150,
      routedKm: 180,
      withinClass: false,
      cold: { ...STEP, ms: 900, transferBytes: 2_500_000 },
      error: { step: 'warm', code: 'NETWORK' },
    });
    expect(row[3]).toBe('180.00 (out of class)');
    expect(row[8]).toBe('2.5');
    expect(row[9]).toBe('');
    expect(row.at(-1)).toBe('warm: NETWORK');
  });
});

describe('appendRow', () => {
  it('writes each cell as text, never as markup', () => {
    const body = document.createElement('tbody');
    appendRow(body, { pair: 1, run: 1, targetKm: 5, error: { step: 'init', code: '<b>X</b>' } });
    const cells = [...body.querySelectorAll('tr > td')];
    expect(cells).toHaveLength(REPORT_COLUMNS.length);
    expect(cells.at(-1)?.textContent).toBe('init: <b>X</b>');
    expect(body.querySelector('b')).toBeNull();
  });
});
