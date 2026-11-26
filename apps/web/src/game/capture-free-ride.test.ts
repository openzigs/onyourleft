// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3154: a free-ride capture's start and placeholder names, read without a
 * screen. The screen is `capture-free-ride-wiring.test.tsx`'s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CAPTURE_STREET_NAMES,
  captureOpenWorldStart,
  captureStreetName,
} from './capture-free-ride';
import { CAPTURE_MODE } from './capture-scene';
import {
  fixturePosition,
  GRID_COLUMN_NAMES,
  GRID_ROW_NAMES,
  START_COLUMN,
  START_ROW,
} from './open-world/fixture-testing';

const AT = fixturePosition(START_COLUMN, START_ROW);
const START = `${String(AT.latitude)},${String(AT.longitude)}`;

describe('a capture’s street names — #3154', () => {
  const mapped = [...GRID_ROW_NAMES, ...GRID_COLUMN_NAMES].filter(
    (name): name is string => name !== undefined,
  );

  it('shows each street by a placeholder from the list, never its own name', () => {
    for (const name of mapped) {
      const shown = captureStreetName(name);
      expect(CAPTURE_STREET_NAMES).toContain(shown);
      expect(shown).not.toBe(name);
    }
  });

  it('shows one street by one placeholder however often it is read, and spreads the streets over the list', () => {
    expect(mapped.map(captureStreetName)).toEqual(mapped.map(captureStreetName));
    expect(new Set(mapped.map(captureStreetName)).size).toBeGreaterThan(mapped.length / 2);
  });

  it('carries no name of the fixture’s map in its list', () => {
    for (const name of mapped) expect(CAPTURE_STREET_NAMES).not.toContain(name);
  });
});

describe('a free-ride capture’s start — #3154', () => {
  beforeEach(() => {
    vi.stubEnv('MODE', CAPTURE_MODE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the command’s, as the picker makes one from a pin', () => {
    const start = captureOpenWorldStart(
      `#/game?capture=free-ride&start=${encodeURIComponent(START)}`,
    );
    expect(start?.position.latitude).toBeCloseTo(AT.latitude, 9);
    expect(start?.position.longitude).toBeCloseTo(AT.longitude, 9);
    expect(start?.source).toBe('pin');
  });

  it('is nothing for a scene that rides no open world, a missing or malformed start, or one off the map', () => {
    expect(captureOpenWorldStart(`#/game?capture=route-hud&start=${START}`)).toBeUndefined();
    expect(captureOpenWorldStart('#/game?capture=free-ride')).toBeUndefined();
    expect(captureOpenWorldStart('#/game?capture=free-ride&start=north')).toBeUndefined();
    expect(captureOpenWorldStart('#/game?capture=free-ride&start=1,2,3')).toBeUndefined();
    expect(captureOpenWorldStart('#/game?capture=free-ride&start=91,0')).toBeUndefined();
    // Outside the basemap's coverage (`start.ts` §`US_BASEMAP_COVERAGE`).
    expect(captureOpenWorldStart('#/game?capture=free-ride&start=0,0')).toBeUndefined();
  });

  it('is nothing in every other build, a release among them', () => {
    vi.stubEnv('MODE', 'production');
    expect(captureOpenWorldStart(`#/game?capture=free-ride&start=${START}`)).toBeUndefined();
  });
});
