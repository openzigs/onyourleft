// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A fake Valhalla (#2008): a `fetch` that answers `/route`,
 * `/trace_attributes` and `/height` in Valhalla's own shapes, and records what
 * it was asked — so a test reads off the wire what the instance sent the
 * engine, and the real {@link createValhalla} parses the answer.
 *
 * Its answers are made from the request: a leg between two points is the
 * straight line between them cut into {@link FAKE_VERTICES} points, so a
 * routed leg has more points than its two waypoints (#71's first criterion)
 * and no real road or place is in any fixture. Its numbers are rough planar
 * metres, good enough to be checked for shape, not for geodesy.
 */

import type { Resolver } from '../history/address.ts';
import { createValhalla, type LatLon, type RoutingEngine } from './valhalla.ts';

/** How many points a fake leg has. */
export const FAKE_VERTICES = 8;

/** Two points just off Null Island, in no real place: a fixture's waypoints. */
export const NOWHERE: readonly LatLon[] = [
  [0.01, 0.01],
  [0.02, 0.015],
  [0.03, 0.01],
];

/** {@link NOWHERE} as a request carries it: `{ latitude, longitude }`. */
export const NOWHERE_POINTS = NOWHERE.map(([latitude, longitude]) => ({ latitude, longitude }));

export interface FakeValhalla {
  readonly fetch: typeof globalThis.fetch;
  /** Every request, in order: the action and the JSON body sent. */
  readonly requests: { readonly action: string; readonly body: Record<string, unknown> }[];
  /** Answer the next `action` request with this status and body instead. */
  failNext(action: string, status: number, body: unknown): void;
  /** {@link createValhalla} over this fake, at `http://routing:8002`, resolved to loopback. */
  engine(): RoutingEngine;
}

export interface FakeValhallaOptions {
  /** Valhalla's surface word for every edge: `paved_smooth` by default. */
  readonly surface?: string;
  /** Heights, cycled; `null` is a hole in the terrain data. */
  readonly heights?: readonly (number | null)[];
}

const LOCAL: Resolver = () => Promise.resolve(['127.0.0.1']);

function encodeSigned(value: number): string {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (shifted >= 0x20) {
    out += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>>= 5;
  }
  return out + String.fromCharCode(shifted + 63);
}

/** Google's polyline at 6 decimal places, as Valhalla writes one. */
export function encodePolyline6(points: readonly LatLon[]): string {
  let latitude = 0;
  let longitude = 0;
  let out = '';
  for (const [lat, lon] of points) {
    const nextLat = Math.round(lat * 1e6);
    const nextLon = Math.round(lon * 1e6);
    out += encodeSigned(nextLat - latitude) + encodeSigned(nextLon - longitude);
    latitude = nextLat;
    longitude = nextLon;
  }
  return out;
}

function between(from: LatLon, to: LatLon): LatLon[] {
  return Array.from({ length: FAKE_VERTICES }, (_, index) => {
    const t = index / (FAKE_VERTICES - 1);
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t] as const;
  });
}

/** Rough planar metres between two points: a fixture's arithmetic, not geodesy. */
function metresBetween(from: LatLon, to: LatLon): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) * 111_320;
}

function latLons(value: unknown): LatLon[] {
  return (value as { lat: number; lon: number }[]).map((point) => [point.lat, point.lon] as const);
}

export function fakeValhalla(options: FakeValhallaOptions = {}): FakeValhalla {
  const requests: { action: string; body: Record<string, unknown> }[] = [];
  const failures = new Map<string, { status: number; body: unknown }>();
  const heights = options.heights ?? [12.5];

  const answer = (action: string, body: Record<string, unknown>): Response => {
    const failure = failures.get(action);
    if (failure !== undefined) {
      failures.delete(action);
      return Response.json(failure.body, { status: failure.status });
    }
    if (action === 'route') {
      const locations = latLons(body.locations);
      const legs = locations.slice(1).map((to, index) => {
        const from = locations[index]!;
        return {
          shape: encodePolyline6(between(from, to)),
          summary: { length: metresBetween(from, to) / 1000, time: 60 },
        };
      });
      return Response.json({ trip: { status: 0, units: 'kilometers', legs } });
    }
    if (action === 'trace_attributes') {
      return Response.json({
        units: 'kilometers',
        edges: [
          { surface: options.surface ?? 'paved_smooth', length: 0.5 },
          { surface: options.surface ?? 'paved_smooth', length: 0.5 },
        ],
      });
    }
    if (action === 'height') {
      const shape = latLons(body.shape);
      const heightAt = (index: number): number | null => heights[index % heights.length] ?? null;
      if (body.range !== true && body.resample_distance === undefined) {
        // One height per point asked, as Valhalla 3.9.1 answers it.
        return Response.json({ height: shape.map((_, index) => heightAt(index)) });
      }
      // Asked to resample and measure, it answers its own distances, which are
      // not the app's: measured on the pinned 3.9.1 image (#3136), about 0.11%
      // longer than the domain's, so most land off the app's grid.
      const interval = (body.resample_distance as number | undefined) ?? 30;
      let span = 0;
      for (let index = 1; index < shape.length; index += 1) {
        span += metresBetween(shape[index - 1]!, shape[index]!);
      }
      const count = Math.max(2, Math.floor(span / interval) + 1);
      return Response.json({
        range_height: Array.from({ length: count }, (_, index) => [
          Math.round(index * interval * 1.0011 * 10) / 10,
          heightAt(index),
        ]),
      });
    }
    return Response.json(
      { error_code: 106, error: 'Try any of', status_code: 404 },
      { status: 404 },
    );
  };

  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const action = url.pathname.slice(1);
    // `valhalla.ts` sends a JSON string; anything else is no body.
    const text = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(text) as Record<string, unknown>;
    requests.push({ action, body });
    return Promise.resolve(answer(action, body));
  }) as typeof globalThis.fetch;

  return {
    fetch,
    requests,
    failNext: (action, status, body) => {
      failures.set(action, { status, body });
    },
    engine: () =>
      createValhalla({ endpoint: new URL('http://routing:8002'), resolve: LOCAL, fetch }),
  };
}
