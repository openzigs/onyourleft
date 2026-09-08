// SPDX-License-Identifier: Apache-2.0

/**
 * #74's acceptance criteria, and the honest boundary of them.
 *
 * ⚠️ **Criterion 1 — that an exported file loads on a real head unit — is NOT
 * discharged here and cannot be.** There is no device in this environment and
 * the vendors' documentation was not reachable from it. Every assertion below
 * is about the document; none of them is about a Garmin. That criterion needs
 * somebody with an Edge or an ELEMNT to load a file and record the device, the
 * firmware and the date, and until then it stays open.
 *
 * The round trip re-imports through this package's own decoder, which is a
 * weaker check than #31's third-party FIT acceptance test: both ends can be
 * lenient in the same direction, which `write.ts` records having happened once
 * already with `&#1;`. So the assertions below go past "it came back" and into
 * *how far* it moved, with tolerances derived from the write precision rather
 * than tuned until green.
 */

import { describe, expect, it } from 'vitest';

import { decodeGpxRoute, type DecodedRoute } from './gpx-route';
import { encodeGpxRoute } from './gpx-course';
import { encodeTcxRoute, TCX_COURSE_NAME_LIMIT } from './tcx-course';
import {
  courseSampleCount,
  ODBL_LICENCE_URL,
  OSM_ATTRIBUTION,
  type ExportableRoute,
} from './course';

/**
 * A synthetic route: a shallow S-bend that climbs and descends twice.
 *
 * Inline rather than a committed fixture, for `gpx-route.test.ts`'s reason —
 * this is a *shape*, and the one real route is the committed corpus file. The
 * curve matters: a straight line would make the position tolerance meaningless,
 * because every re-gridded sample would land on the same straight line whatever
 * the resampling did.
 */
function syntheticRouteGpx(count: number, name = 'Ridgeway loop'): string {
  const points = Array.from({ length: count }, (_, index) => {
    const latitude = 0.5 + Math.sin(index / 40) * 0.002;
    const longitude = 0.5 + index * 0.0003;
    const elevation = 100 + Math.sin(index / 25) * 40;
    return (
      `<trkpt lat="${latitude.toFixed(9)}" lon="${longitude.toFixed(9)}">` +
      `<ele>${elevation.toFixed(3)}</ele></trkpt>`
    );
  }).join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `<trk><name>${name}</name><trkseg>\n${points}\n</trkseg></trk></gpx>`
  );
}

const route = (count = 400, name?: string) => {
  const decoded = decodeGpxRoute(syntheticRouteGpx(count, name));
  return { name: decoded.name, profile: decoded.profile };
};

/**
 * The tolerances, and where each comes from.
 *
 * ⚠️ **Derived, then measured — not measured, then rounded up.** A tolerance
 * fitted to an observed number is a tolerance that passes whatever the code
 * does; these are computed from the write precision first, and the measured
 * figure is recorded beside each so a future change that moves it is visible.
 */
const TOLERANCE = {
  /**
   * `degrees()` writes 7 decimal places, so a coordinate can move by half a
   * unit in the last place: 5e-8°, about 5.6 mm of latitude. Doubled to 1e-7°
   * because re-gridding lands a sample between two written points and inherits
   * both roundings. **Measured on this fixture: 5.4e-8° (6.0 mm).**
   */
  degrees: 1e-7,
  /**
   * `decimal(ele, 1)` rounds to a tenth, so half of that. **Measured: 0.0501 m
   * — which is the bound, reached, as it should be for a fixture whose heights
   * are not already on tenths.**
   */
  elevationMetres: 0.051,
  /**
   * Ascent is accumulated by *run* above a 3 m threshold
   * (`ASCENT_THRESHOLD_METRES`), so a ±0.05 m rounding only changes the answer
   * where a run's extent sits within 0.05 m of the threshold — it does not
   * accumulate per sample. Half a metre is generous against that and still far
   * below anything a rider would notice. **Measured: 0.048 m of ascent and
   * 0.073 m of descent over a 13.4 km route with 200 m of climbing.**
   */
  climbMetres: 0.5,
  /** A tenth of a metre over 13 km. **Measured: 0.0003 m.** */
  distanceMetres: 0.1,
} as const;

describe('a route survives a GPX round trip', () => {
  /**
   * ⚠️ Computed lazily, once, rather than at describe-body scope.
   *
   * A throw at describe-body scope fails the whole FILE to load, and vitest
   * reports that as "no tests" with no test name attached — which is what a
   * mutation dropping `<ele>` produced while this was three top-level consts.
   * A red that names no test is a red somebody has to bisect.
   */
  let cached: { original: ExportableRoute; exported: string; reimported: DecodedRoute } | undefined;
  const trip = () => {
    cached ??= (() => {
      const original = route();
      const exported = encodeGpxRoute(original).text;
      return { original, exported, reimported: decodeGpxRoute(exported) };
    })();
    return cached;
  };

  it('comes back with exactly the same number of samples', () => {
    // Not a tolerance: the grid is a function of the geometry, so a re-import
    // that lost or gained a sample would mean the geometry moved enough to
    // change the grid, and every comparison below would then be index-shifted
    // nonsense rather than a small error.
    const { original, reimported } = trip();
    expect(reimported.profile.positions).toHaveLength(original.profile.positions.length);
  });

  it('keeps every position within the coordinate write precision', () => {
    const { original, reimported } = trip();
    for (const [index, before] of original.profile.positions.entries()) {
      const after = reimported.profile.positions[index];
      expect(Math.abs(before.latitude - (after?.latitude ?? NaN))).toBeLessThan(TOLERANCE.degrees);
      expect(Math.abs(before.longitude - (after?.longitude ?? NaN))).toBeLessThan(
        TOLERANCE.degrees,
      );
    }
  });

  it('keeps every elevation within half of the written precision', () => {
    const { original, reimported } = trip();
    for (const [index, before] of original.profile.elevations.entries()) {
      expect(Math.abs(before - (reimported.profile.elevations[index] ?? NaN))).toBeLessThan(
        TOLERANCE.elevationMetres,
      );
    }
  });

  it('preserves total ascent and descent', () => {
    const { original, reimported } = trip();
    // #74's second criterion names total ascent specifically, and it is the
    // one that could go wrong invisibly: ascent is a sum over runs, so a
    // rounding that shifted one run's boundary would move it by metres rather
    // than by centimetres while every individual elevation still matched.
    expect(reimported.profile.totalAscent).toBeCloseTo(original.profile.totalAscent, 0);
    expect(Math.abs(reimported.profile.totalAscent - original.profile.totalAscent)).toBeLessThan(
      TOLERANCE.climbMetres,
    );
    expect(Math.abs(reimported.profile.totalDescent - original.profile.totalDescent)).toBeLessThan(
      TOLERANCE.climbMetres,
    );
  });

  it('preserves the route length', () => {
    const { original, reimported } = trip();
    expect(
      Math.abs(reimported.profile.totalDistance - original.profile.totalDistance),
    ).toBeLessThan(TOLERANCE.distanceMetres);
  });

  it('preserves the name', () => {
    const { original, reimported } = trip();
    expect(reimported.name).toBe(original.name);
  });
});

describe('what the GPX document is', () => {
  it('writes a <trk>, not a <rte>', () => {
    // The decision recorded in `gpx-course.ts`: a device that treats route
    // points as turn cues can re-route between them and give the rider a
    // different ride under the name of the one they loaded.
    const { text } = encodeGpxRoute(route());
    expect(text).toContain('<trk>');
    expect(text).not.toContain('<rte>');
    expect(text).not.toContain('<rtept');
  });

  it('writes no <time> anywhere', () => {
    // A planned route is not something that happened. A fabricated timestamp
    // would make the file indistinguishable from a recorded ride, which is how
    // a route ends up in an activity history as a ride nobody did.
    expect(encodeGpxRoute(route()).text).not.toContain('<time>');
  });

  it('re-imports through the same decoder that reads a planner’s file', () => {
    // Not a tautology: it asserts the exporter emits nothing `decodeGpxRoute`
    // refuses — no DOCTYPE, a root of <gpx>, at least one point with a lat and
    // a lon pair.
    expect(() => decodeGpxRoute(encodeGpxRoute(route()).text)).not.toThrow();
  });
});

describe('a name that is hostile to a writer, in both formats', () => {
  // #74's third criterion: "a route called 'Coffee & Cake' must not produce an
  // invalid file". The ampersand is the one that breaks naive concatenation;
  // `<` is the one that turns a document into a different document; the
  // non-ASCII characters are the ones a byte-oriented writer mangles; and the
  // emoji is a surrogate pair, which `escapeXmlText`'s `u` flag exists to keep
  // whole rather than tearing in two.
  const NASTY = 'Coffee & Cake <hills> — Örebro › 100 % 🚵';

  // ⚠️ The name is set on the ROUTE, not interpolated into the fixture
  // document. Writing it into the source GPX would need the fixture builder to
  // escape it, and then this case would be testing the fixture builder's
  // escaping rather than the exporter's — which is what the first draft did,
  // and it failed on the ampersand before the exporter was ever reached.
  const nastyRoute = () => ({ ...route(200), name: NASTY });

  it('round-trips intact through GPX', () => {
    const exported = encodeGpxRoute(nastyRoute());
    expect(exported.text).not.toContain('& C');
    expect(exported.text).toContain('&amp;');
    expect(decodeGpxRoute(exported.text).name).toBe(NASTY);
  });

  it('is escaped in TCX too', () => {
    const { text } = encodeTcxRoute(nastyRoute());
    expect(text).toContain('&amp;');
    expect(text).toContain('&lt;hills&gt;');
    expect(text).toContain('🚵');
  });
});

describe('the ODbL attribution', () => {
  it('goes in GPX’s own metadata, with the licence beside it', () => {
    const { text } = encodeGpxRoute(route());
    expect(text).toContain(`<copyright author="${OSM_ATTRIBUTION}">`);
    expect(text).toContain(`<license>${ODBL_LICENCE_URL}</license>`);
  });

  it('goes in TCX’s Notes, because TCX has no metadata element', () => {
    expect(encodeTcxRoute(route()).text).toContain(`<Notes>${OSM_ATTRIBUTION}</Notes>`);
  });

  it('can be turned off, because over-attributing is a default and not a law', () => {
    // The reasoning is in `course.ts`: a `RouteProfile` records no provenance,
    // so the default attributes. A route known not to owe OSM anything passes
    // null — which nothing in this program can currently establish, so today
    // this is a test's parameter and not a screen's.
    expect(encodeGpxRoute(route(), { attribution: null }).text).not.toContain('<copyright');
    expect(encodeTcxRoute(route(), { attribution: null }).text).not.toContain('<Notes>');
  });
});

describe('what an export tells the rider it could not carry', () => {
  it('always says gradient is not a field', () => {
    for (const result of [encodeGpxRoute(route()), encodeTcxRoute(route())]) {
      expect(result.faults.map((fault) => fault.code)).toContain('gradient-is-not-a-field');
    }
  });

  it('says a TCX course carries no time, every time', () => {
    expect(encodeTcxRoute(route()).faults.map((f) => f.code)).toContain(
      'tcx-course-time-is-unknown',
    );
    expect(encodeTcxRoute(route()).text).toContain('<TotalTimeSeconds>0.0</TotalTimeSeconds>');
  });

  it('warns about a long TCX name rather than silently truncating it', () => {
    const long = 'A'.repeat(TCX_COURSE_NAME_LIMIT + 1);
    const result = encodeTcxRoute(route(200, long));
    expect(result.faults.map((f) => f.code)).toContain('tcx-name-may-be-truncated');
    // The name is written in full. Truncating on a schema limit read from
    // memory rather than from the XSD would silently rename a rider's route.
    expect(result.text).toContain(`<Name>${long}</Name>`);
  });

  it('does not warn about a name that fits', () => {
    const fits = 'A'.repeat(TCX_COURSE_NAME_LIMIT);
    expect(encodeTcxRoute(route(200, fits)).faults.map((f) => f.code)).not.toContain(
      'tcx-name-may-be-truncated',
    );
  });

  it('carries no fault a rider cannot act on and no coordinate in any message', () => {
    // ADR 0004 decision D binds every layer that formats a coordinate into a
    // string, and a fault message is one.
    for (const fault of [...encodeGpxRoute(route()).faults, ...encodeTcxRoute(route()).faults]) {
      expect(fault.message.length).toBeGreaterThan(20);
      expect(fault.message).not.toMatch(/-?\d+\.\d{4,}/);
    }
  });
});

describe('a very long route', () => {
  // #74's sixth criterion. 9 000 source points at ~33 m spacing is 302 km,
  // which the profile re-grids to 30 226 samples at ~10 m.
  const long = route(9000);

  it('is 302 km and 30 226 grid samples', () => {
    expect(long.profile.totalDistance / 1000).toBeGreaterThan(300);
    expect(courseSampleCount(long)).toBeGreaterThan(30_000);
  });

  it('exports as a single string in both formats without exhausting memory', () => {
    // Measured on 2026-09-08, Node 24: GPX 2.58 MB, TCX 7.57 MB, both written
    // in about 360 ms for the pair. TCX is roughly three times the size for the
    // same route — one element per coordinate against one attribute pair — and
    // that is worth knowing before choosing a format for a device with a slow
    // card reader.
    const gpx = encodeGpxRoute(long);
    const tcx = encodeTcxRoute(long);
    expect(gpx.text.length).toBeGreaterThan(2_000_000);
    expect(gpx.text.length).toBeLessThan(4_000_000);
    expect(tcx.text.length).toBeGreaterThan(gpx.text.length * 2);
    expect(tcx.text.length).toBeLessThan(12_000_000);
  });

  it('is NOT simplified, which is the decision rather than an omission', () => {
    // `course.ts` records why: a cap here would be a guess at one device's
    // limit applied to every device, and a route silently missing its last
    // third is worse than one a device refuses outright. `courseSampleCount`
    // is what a caller warns from.
    const exported = encodeGpxRoute(long);
    const written = exported.text.match(/<trkpt /g)?.length ?? 0;
    expect(written).toBe(courseSampleCount(long));
  });
});
