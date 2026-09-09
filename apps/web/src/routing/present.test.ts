// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  type GeographicPosition,
  type HeightProfile,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, resolveDraft, setLegMode, type RouteDraft } from './draft';
import { ELEVATION_INTERVAL_METRES, elevationFrom, type PlannedElevation } from './elevation';
import { RIDING_DEFAULTS } from './preferences';
import {
  bandFor,
  elevationSentence,
  GRADE_BANDS,
  PROFILE_ROWS,
  profileRows,
  surfaceSummary,
  unresolvedSentence,
} from './present';
import { GLO30, scriptedProvider } from './testing';

const INTERVAL = metres(ELEVATION_INTERVAL_METRES);

function line(metresLong: number): readonly GeographicPosition[] {
  return [
    geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
    geographicPosition(degreesLatitude(51.5 + metresLong / 111_320), degreesLongitude(-0.12)),
  ];
}

function heights(elevations: readonly (number | undefined)[]): HeightProfile {
  return {
    source: GLO30,
    samples: elevations.map((elevation, index) => ({
      along: metres(index * ELEVATION_INTERVAL_METRES),
      elevation: elevation === undefined ? undefined : altitudeMetres(elevation),
    })),
  };
}

function planned(elevations: readonly (number | undefined)[], long = 1_200): PlannedElevation {
  const result = elevationFrom(line(long), heights(elevations), INTERVAL);
  if (result === undefined) throw new Error('fixture produced no profile');
  return result;
}

async function drawn(count: number, provider = scriptedProvider()): Promise<RouteDraft> {
  let draft = emptyDraft();
  for (let index = 0; index < count; index += 1) {
    draft = addWaypoint(
      draft,
      geographicPosition(degreesLatitude(51.5 + index * 0.005), degreesLongitude(-0.12)),
    ).draft;
  }
  return resolveDraft(
    draft,
    draft.legs.map((_, index) => index),
    provider,
    RIDING_DEFAULTS,
  );
}

describe('the gradient scale is stated and named', () => {
  it('gives every band a name, so colour is never the only channel', () => {
    // #72's last criterion, and #48's baseline. A shade with no label is a
    // channel a quarter of readers do not have.
    for (const band of GRADE_BANDS) {
      expect(band.name.length).toBeGreaterThan(0);
    }
  });

  it('bands a gradient by the scale', () => {
    expect(bandFor(-6)).toBe('Descending');
    expect(bandFor(0)).toBe('Flat');
    expect(bandFor(2)).toBe('Gentle climb');
    expect(bandFor(6)).toBe('Climb');
    expect(bandFor(9)).toBe('Steep climb');
    expect(bandFor(18)).toBe('Very steep climb');
  });

  it('puts a boundary in the band that starts there', () => {
    // The same rule `analysis/zones.ts` states for a reading exactly on a
    // boundary, so the two screens cannot disagree about a 4 %.
    expect(bandFor(4)).toBe('Climb');
    expect(bandFor(3.99)).toBe('Gentle climb');
  });
});

describe('the profile has a non-visual equivalent', () => {
  it('summarises distance, climbing and descending in a sentence', () => {
    const sentence = elevationSentence(planned(Array.from({ length: 41 }, (_, i) => 100 + i * 2)));
    expect(sentence).toContain('km');
    expect(sentence).toContain('climbing');
    expect(sentence).toContain('descending');
  });

  it('names the dataset and its resolution', () => {
    // ⚠️ Not decoration. ADR 0010 D-5's Copernicus terms require the notice to
    // travel with adapted data, and #72 requires the source with the route.
    const sentence = elevationSentence(planned(Array.from({ length: 41 }, () => 100)));
    expect(sentence).toContain('Copernicus DEM GLO-30');
    expect(sentence).toContain('30 m resolution');
  });

  it('states the sampling interval, because ascent depends on it', () => {
    expect(elevationSentence(planned(Array.from({ length: 41 }, () => 100)))).toContain(
      'sampled every 30 m',
    );
  });

  it('says the climbing figure is a floor when the dataset had holes', () => {
    const withHole = Array.from({ length: 41 }, (_, index) =>
      index > 10 && index < 15 ? undefined : 100 + index * 2,
    );
    const sentence = elevationSentence(planned(withHole));
    expect(sentence).toContain('no height for');
    expect(sentence).toContain('at least');
  });

  it('does not hedge when the dataset covered the whole route', () => {
    expect(elevationSentence(planned(Array.from({ length: 41 }, () => 100)))).not.toContain(
      'at least',
    );
  });

  it('bounds the table rather than printing one row per grid sample', () => {
    // A table with 20 000 rows is the same data with the summarising removed.
    const long = planned(
      Array.from({ length: 401 }, (_, i) => 100 + i * 0.5),
      12_000,
    );
    expect(profileRows(long).length).toBeLessThanOrEqual(PROFILE_ROWS);
  });

  it('names each stretch by band and gives its steepest gradient', () => {
    const rows = profileRows(planned(Array.from({ length: 41 }, (_, i) => 100 + i * 3)));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.band.length).toBeGreaterThan(0);
      expect(Number.isFinite(row.steepest)).toBe(true);
    }
  });

  it('marks the stretches the dataset had no height for', () => {
    // ⚠️ The gap survives into the table, not only into the chart. A reader who
    // cannot see the broken line still has to be told which part is invented.
    const withHole = Array.from({ length: 41 }, (_, index) =>
      index > 20 && index < 26 ? undefined : 100 + index,
    );
    const rows = profileRows(planned(withHole));
    expect(rows.some((row) => !row.measured)).toBe(true);
    expect(rows.some((row) => row.measured)).toBe(true);
  });
});

describe('what the route is surfaced with', () => {
  it('counts paved distance from what the engine said', async () => {
    const summary = surfaceSummary(await drawn(3, scriptedProvider({ surface: 'paved' })));
    expect(summary.pavedMetres).toBe(2_000);
    expect(summary.unpavedMetres).toBe(0);
    expect(summary.unknownMetres).toBe(0);
  });

  it('keeps unpaved separate rather than folded into a total', async () => {
    const summary = surfaceSummary(await drawn(2, scriptedProvider({ surface: 'unpaved' })));
    expect(summary.unpavedMetres).toBe(1_000);
    expect(summary.pavedMetres).toBe(0);
  });

  it('never counts an unknown surface as paved', async () => {
    // #72's rule, and the reason it is stated: assuming paved is how a road
    // bike ends up on a gravel track.
    const summary = surfaceSummary(await drawn(2, scriptedProvider({ surface: 'unknown' })));
    expect(summary.pavedMetres).toBe(0);
    expect(summary.unknownMetres).toBe(1_000);
  });

  it('counts a freehand leg as unknown and says how many there are', async () => {
    const routed = await drawn(3);
    const freehand = setLegMode(routed, 1, 'freehand').draft;
    const summary = surfaceSummary(freehand);
    expect(summary.freehandLegs).toBe(1);
    expect(summary.unknownMetres).toBeGreaterThan(0);
  });
});

describe('what a rider is told about a leg with no geometry', () => {
  it('says nothing when every leg is routed', async () => {
    expect(unresolvedSentence((await drawn(3)).legs)).toBeUndefined();
  });

  it('counts the failed legs and says the totals cover the rest', async () => {
    const provider = scriptedProvider();
    const routed = await drawn(3, provider);
    const broken = {
      ...routed,
      legs: routed.legs.map((leg, index) =>
        index === 0 ? { ...leg, state: 'failed' as const } : leg,
      ),
    };
    const sentence = unresolvedSentence(broken.legs);
    expect(sentence).toContain('1 leg has no route');
    expect(sentence).toContain('the rest of the route');
  });

  it('reads correctly for more than one', async () => {
    const routed = await drawn(4);
    const broken = routed.legs.map((leg) => ({ ...leg, state: 'failed' as const }));
    expect(unresolvedSentence(broken)).toContain('3 legs have no route');
  });

  it('distinguishes still-being-routed from could-not-be-routed', () => {
    const draft = emptyDraft();
    expect(unresolvedSentence(draft.legs)).toBeUndefined();
  });
});
