// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { RoutingError } from './errors';
import type { ElevationDataset } from './provider';
import { metres } from '../quantities';
import {
  MAXIMUM_LEG_POINTS,
  MINIMUM_LEG_POINTS,
  checkedHeights,
  checkedLeg,
  surfaceFrom,
  type RawLeg,
  type RawPosition,
} from './validate';

const GLO30: ElevationDataset = { name: 'Copernicus DEM GLO-30', resolution: metres(30) };

function point(latitude: number, longitude: number): RawPosition {
  return { latitude, longitude };
}

function leg(overrides: Partial<RawLeg> = {}): RawLeg {
  return {
    shape: [point(51.5, -0.12), point(51.51, -0.121), point(51.52, -0.122)],
    distance: 2_240,
    surface: 'paved',
    ...overrides,
  };
}

describe('a malformed response is a typed error, never a route', () => {
  it('refuses a NaN distance rather than passing it on', () => {
    // ⚠️ #70's sixth criterion in its literal form: "never a route with NaN
    // distance rendered as a real route". `metres(NaN)` is what catches it.
    expect(() => checkedLeg(leg({ distance: Number.NaN }), 0)).toThrow(RoutingError);
  });

  it('refuses a negative distance', () => {
    expect(() => checkedLeg(leg({ distance: -1 }), 0)).toThrow(RoutingError);
  });

  it('refuses a coordinate that is not a position on Earth', () => {
    expect(() => checkedLeg(leg({ shape: [point(91, 0), point(0, 0)] }), 0)).toThrow(RoutingError);
  });

  it('refuses a leg with fewer than two points', () => {
    const thrown = attempt(() => checkedLeg(leg({ shape: [point(51.5, -0.12)] }), 3));
    expect(thrown?.code).toBe('malformed-response');
    // Legs are zero-based on the wire and one-based in the sentence a rider reads.
    expect(thrown?.message).toContain('leg 4');
    expect(thrown?.leg).toBe(3);
  });

  it('refuses a leg whose geometry is larger than this client will draw', () => {
    const shape = Array.from({ length: MAXIMUM_LEG_POINTS + 1 }, (_, index) =>
      point(51.5 + index * 1e-6, -0.12),
    );
    expect(attempt(() => checkedLeg(leg({ shape }), 0))?.code).toBe('malformed-response');
  });

  it('accepts a leg exactly at each bound', () => {
    expect(
      checkedLeg(leg({ shape: [point(51.5, -0.12), point(51.51, -0.12)] }), 0).shape,
    ).toHaveLength(MINIMUM_LEG_POINTS);
    const largest = Array.from({ length: MAXIMUM_LEG_POINTS }, (_, index) =>
      point(51.5 + index * 1e-6, -0.12),
    );
    expect(checkedLeg(leg({ shape: largest }), 0).shape).toHaveLength(MAXIMUM_LEG_POINTS);
  });

  it('never names a coordinate in the message', () => {
    // ADR 0004 decision D. A routing failure is exactly the layer that wants to
    // quote the point that failed, and the point is somebody's front door.
    const thrown = attempt(() =>
      checkedLeg(leg({ shape: [point(51.5074, -0.1278), point(999, 0)] }), 0),
    );
    expect(thrown?.message).not.toContain('51.5074');
    expect(thrown?.message).not.toContain('0.1278');
    expect(thrown?.message).not.toContain('999');
  });
});

describe('what a surface word becomes', () => {
  it('carries the two the engine can actually establish', () => {
    expect(surfaceFrom('paved')).toBe('paved');
    expect(surfaceFrom('unpaved')).toBe('unpaved');
  });

  it('calls anything else unknown rather than paved', () => {
    // ⚠️ The rule #72 states: assuming paved is how a road bike ends up on a
    // gravel track. An engine that grows a new word degrades to honest
    // ignorance.
    expect(surfaceFrom(undefined)).toBe('unknown');
    expect(surfaceFrom('compacted')).toBe('unknown');
    expect(surfaceFrom('')).toBe('unknown');
  });
});

describe('the elevation series', () => {
  it('carries the source through, because a route stores it', () => {
    const profile = checkedHeights(GLO30, [
      { along: 0, elevation: 12 },
      { along: 30, elevation: 14 },
    ]);
    expect(profile.source).toStrictEqual(GLO30);
  });

  it('keeps a void as a gap rather than filling it', () => {
    // ⚠️ #72: a data void renders AS a gap. Filling it here would destroy the
    // only evidence it was ever a hole, and the ascent would silently sum
    // across it.
    const profile = checkedHeights(GLO30, [
      { along: 0, elevation: 12 },
      { along: 30, elevation: null },
      { along: 60, elevation: 14 },
    ]);
    expect(profile.samples.map((sample) => sample.elevation)).toStrictEqual([12, undefined, 14]);
  });

  it('refuses a series that goes backwards', () => {
    expect(
      attempt(() =>
        checkedHeights(GLO30, [
          { along: 0, elevation: 12 },
          { along: 30, elevation: 13 },
          { along: 20, elevation: 14 },
        ]),
      )?.code,
    ).toBe('malformed-response');
  });

  it('refuses a repeated distance, which would be a zero-length step', () => {
    expect(() =>
      checkedHeights(GLO30, [
        { along: 0, elevation: 12 },
        { along: 0, elevation: 13 },
      ]),
    ).toThrow(RoutingError);
  });

  it('refuses a height that is not a finite number', () => {
    expect(() =>
      checkedHeights(GLO30, [{ along: 0, elevation: Number.POSITIVE_INFINITY }]),
    ).toThrow(RoutingError);
  });

  it('accepts an empty series, which is what a shape of nothing returns', () => {
    expect(checkedHeights(GLO30, []).samples).toStrictEqual([]);
  });
});

function attempt(action: () => unknown): RoutingError | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof RoutingError ? error : undefined;
  }
}
