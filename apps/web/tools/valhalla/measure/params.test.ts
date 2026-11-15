// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { MeasureParamError, parseMeasureParams } from './params';

const BASE = 'http://localhost:5180/';
const MANIFEST = 'https://tiles.example/routing/r1/manifest.json';

// Synthetic numbers on no map: the page is tested with values nobody rides.
const PAIR = '40:1.25,2.5,-1.125,-2.75';

function search(params: Record<string, string | string[]>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }
  return `?${query.toString()}`;
}

function errorOf(run: () => unknown): MeasureParamError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof MeasureParamError) return error;
    throw error;
  }
  throw new Error('expected a MeasureParamError');
}

describe('parseMeasureParams', () => {
  it('reads the manifest, every pair in order, and the defaults', () => {
    const config = parseMeasureParams(
      search({ manifest: MANIFEST, pair: ['5:0.5,0.25,0.75,1', PAIR] }),
      BASE,
    );
    expect(config.manifestUrl).toBe(MANIFEST);
    expect(config.pairs).toEqual([
      { targetKm: 5, origin: { lat: 0.5, lon: 0.25 }, destination: { lat: 0.75, lon: 1 } },
      { targetKm: 40, origin: { lat: 1.25, lon: 2.5 }, destination: { lat: -1.125, lon: -2.75 } },
    ]);
    expect(config).toMatchObject({
      runs: 1,
      budgetBytes: 128 * 1024 * 1024,
      timeoutMs: 120_000,
      dragMetres: 250,
    });
  });

  it('reads the optional settings', () => {
    const config = parseMeasureParams(
      search({
        manifest: MANIFEST,
        pair: PAIR,
        runs: '3',
        budgetMiB: '48',
        timeoutS: '30',
        dragM: '100',
      }),
      BASE,
    );
    expect(config).toMatchObject({
      runs: 3,
      budgetBytes: 48 * 1024 * 1024,
      timeoutMs: 30_000,
      dragMetres: 100,
    });
  });

  it('resolves a relative manifest against the page', () => {
    const config = parseMeasureParams(
      search({ manifest: '/routing/r1/manifest.json', pair: PAIR }),
      BASE,
    );
    expect(config.manifestUrl).toBe('http://localhost:5180/routing/r1/manifest.json');
  });

  it.each([
    [{ pair: PAIR }, 'manifest is required'],
    [
      { manifest: 'javascript:alert(1)//manifest.json', pair: PAIR },
      'manifest must be an http(s) URL',
    ],
    [
      { manifest: 'https://tiles.example/r1/graph.tar', pair: PAIR },
      'manifest must be an http(s) URL',
    ],
    [{ manifest: MANIFEST }, 'at least one pair is required'],
    [{ manifest: MANIFEST, pair: PAIR, runs: '0' }, 'runs must be a whole number from 1 to 10'],
    [
      { manifest: MANIFEST, pair: PAIR, budgetMiB: '256' },
      'budgetMiB must be a whole number from 1 to 128',
    ],
    [
      { manifest: MANIFEST, pair: PAIR, timeoutS: '1.5' },
      'timeoutS must be a whole number from 1 to 600',
    ],
  ])('refuses %j', (params, message) => {
    expect(errorOf(() => parseMeasureParams(search(params), BASE)).message).toContain(message);
  });

  it.each([
    ['40-1,2,3,4', 'pair 1 must be KM:LAT,LON,LAT,LON'],
    ['40:1,2,3', 'pair 1 must be KM:LAT,LON,LAT,LON'],
    ['0:1,2,3,4', 'pair 1: its length class must be'],
    ['40:91.5,2,3,4', "pair 1: the origin's latitude must be a number from -90 to 90"],
    ['40:1,2,3,-181.25', "pair 1: the destination's longitude must be a number from -180 to 180"],
    ['40:1,,3,4', "pair 1: the origin's longitude must be a number"],
  ])('refuses the pair %s, naming the field and never the value', (pair, message) => {
    const error = errorOf(() => parseMeasureParams(search({ manifest: MANIFEST, pair }), BASE));
    expect(error.message).toContain(message);
    for (const value of ['91.5', '-181.25', '1,2,3']) expect(error.message).not.toContain(value);
  });

  it('numbers the pair that is wrong', () => {
    const error = errorOf(() =>
      parseMeasureParams(search({ manifest: MANIFEST, pair: [PAIR, '5:1,2,99,4'] }), BASE),
    );
    expect(error.message).toBe(
      "pair 2: the destination's latitude must be a number from -90 to 90",
    );
  });
});
