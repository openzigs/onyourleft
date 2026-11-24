// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Valhalla client's own rules (#2008): the costing table, a leg's
 * surface, the shape's decoding, and every answer it refuses to pass on —
 * against the fake Valhalla, whose answers a test bends one at a time.
 */

import { describe, expect, it } from 'vitest';

import {
  bicycleCosting,
  createValhalla,
  decodePolyline6,
  legSurface,
  type LatLon,
} from './valhalla.ts';
import { encodePolyline6, fakeValhalla, NOWHERE } from './valhalla-testing.ts';

const PREFERENCES = { bicycle: 'hybrid', hills: 'neutral', surface: 'any' } as const;
const SIGNAL = new AbortController().signal;

describe('the costing table (#70, ADR 0010 D-4)', () => {
  it.each([
    [{ bicycle: 'road', hills: 'avoid', surface: 'paved-only' }, ['road', 0, 1]],
    [{ bicycle: 'mountain', hills: 'neutral', surface: 'prefer-paved' }, ['mountain', 0.25, 0.25]],
    [{ bicycle: 'cross', hills: 'seek', surface: 'any' }, ['cross', 1, 0]],
  ] as const)('%o is %o', (preferences, [type, hills, surfaces]) => {
    expect(bicycleCosting(preferences)).toStrictEqual({
      bicycle_type: type,
      use_hills: hills,
      avoid_bad_surfaces: surfaces,
    });
  });
});

describe('a leg’s surface', () => {
  it('is paved only when nearly all of it is, and never assumed', () => {
    expect(legSurface([{ surface: 'paved_smooth', length: 1 }])).toBe('paved');
    expect(legSurface([{ surface: 'paved', length: 96 }, { length: 4 }])).toBe('paved');
    // A tenth with no surface on the map: unknown, not paved.
    expect(legSurface([{ surface: 'paved', length: 90 }, { length: 10 }])).toBe('unknown');
    expect(legSurface([])).toBe('unknown');
  });

  it('is unpaved once a twentieth of it is gravel, dirt or a path', () => {
    expect(
      legSurface([
        { surface: 'paved', length: 95 },
        { surface: 'gravel', length: 5 },
      ]),
    ).toBe('unpaved');
    expect(
      legSurface([
        { surface: 'paved', length: 96 },
        { surface: 'dirt', length: 4 },
      ]),
    ).toBe('paved');
  });
});

describe('a shape', () => {
  it('decodes what Valhalla encodes, at six places', () => {
    const points: LatLon[] = [
      [0.012345, -0.054321],
      [-0.5, 0.25],
      [0.000001, 0],
    ];
    expect(decodePolyline6(encodePolyline6(points))).toEqual(points);
  });

  it('refuses a cut-off or foreign string', () => {
    const whole = encodePolyline6(NOWHERE);
    expect(decodePolyline6(whole.slice(0, -1))).toBeUndefined();
    expect(decodePolyline6('  ')).toBeUndefined();
  });
});

describe('what the client will not pass on', () => {
  it.each([
    ['a length that is not a number', { units: 'kilometers', legs: [{ shape: 'x', summary: {} }] }],
    [
      'miles',
      { units: 'miles', legs: [{ shape: encodePolyline6(NOWHERE), summary: { length: 1 } }] },
    ],
    ['the wrong number of legs', { units: 'kilometers', legs: [] }],
    [
      'a one-point shape',
      { units: 'kilometers', legs: [{ shape: encodePolyline6([[0, 0]]), summary: { length: 1 } }] },
    ],
  ])('refuses %s as malformed', async (_case, trip) => {
    const valhalla = fakeValhalla();
    valhalla.failNext('route', 200, { trip });
    const answer = await valhalla.engine().route(NOWHERE.slice(0, 2), PREFERENCES, SIGNAL);
    expect(answer).toStrictEqual({ ok: false, why: 'malformed' });
  });

  it('refuses a height that is not a number or null', async () => {
    const valhalla = fakeValhalla();
    valhalla.failNext('height', 200, { height: [1, 'high', 3] });
    expect(await valhalla.engine().heights(NOWHERE, 30, SIGNAL)).toStrictEqual({
      ok: false,
      why: 'malformed',
    });
  });

  it('refuses heights that are not one per point asked', async () => {
    const valhalla = fakeValhalla();
    valhalla.failNext('height', 200, { height: [1, 2] });
    expect(await valhalla.engine().heights(NOWHERE, 30, SIGNAL)).toStrictEqual({
      ok: false,
      why: 'malformed',
    });
  });

  it('leaves a leg unknown, not failed, when its surface walk fails', async () => {
    const valhalla = fakeValhalla();
    valhalla.failNext('trace_attributes', 400, { error_code: 444 });
    const answer = await valhalla.engine().route(NOWHERE.slice(0, 2), PREFERENCES, SIGNAL);
    expect(answer.ok && answer.value[0]?.surface).toBe('unknown');
  });

  it('never connects to an engine whose name resolves off this network', async () => {
    const valhalla = fakeValhalla();
    const engine = createValhalla({
      endpoint: new URL('http://routing:8002'),
      resolve: () => Promise.resolve(['10.0.0.5', '203.0.113.9']),
      fetch: valhalla.fetch,
    });
    expect(await engine.route(NOWHERE.slice(0, 2), PREFERENCES, SIGNAL)).toStrictEqual({
      ok: false,
      why: 'unreachable',
    });
    expect(valhalla.requests).toHaveLength(0);
  });

  it('goes to the address the name was checked at, never the name', async () => {
    const valhalla = fakeValhalla();
    const seen: string[] = [];
    const engine = createValhalla({
      endpoint: new URL('http://routing:8002'),
      resolve: () => Promise.resolve(['172.30.87.20']),
      fetch: ((url: string, init?: RequestInit) => {
        seen.push(url);
        return valhalla.fetch(url, init);
      }) as typeof globalThis.fetch,
    });
    await engine.heights(NOWHERE, 30, SIGNAL);
    expect(seen).toEqual(['http://172.30.87.20:8002/height']);
  });
});
