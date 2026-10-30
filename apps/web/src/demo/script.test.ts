// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1646's scripts: what a script says at a ride time, and that a script is
 * synthetic by construction — at compile time and over the shipped presets at
 * run time.
 */

import { describe, expect, it } from 'vitest';

import { BOT_MASS_KILOGRAMS, seconds } from '@onyourleft/domain';

import type { KIT_PALETTE } from '../game/bicycle';
import { DEMO_PRESETS } from './presets';
import type {
  AssertSyntheticPreset,
  AssertSyntheticScript,
  DemoPreset,
  RiderScript,
  ScriptSegment,
} from './script';
import { scriptedSample } from './script';

const SCRIPT: RiderScript = {
  label: 'Rider A',
  kit: 'house',
  startMetres: 0,
  segments: [
    { untilSeconds: 10, wattsPerKilogram: 2, cadenceRpm: 80, heartRateBpm: 120, easeSeconds: 5 },
    { untilSeconds: 20, wattsPerKilogram: 4, cadenceRpm: 100, heartRateBpm: 160, easeSeconds: 4 },
    { untilSeconds: 30, wattsPerKilogram: 3, cadenceRpm: 90, heartRateBpm: 150, easeSeconds: 0 },
  ],
};

describe('scriptedSample', () => {
  it('opens at the first segment, without easing in from zero', () => {
    expect(scriptedSample(SCRIPT, seconds(0))).toEqual({
      watts: 2 * BOT_MASS_KILOGRAMS,
      cadence: 80,
      heartRate: 120,
    });
    expect(scriptedSample(SCRIPT, seconds(9.9)).watts).toBe(2 * BOT_MASS_KILOGRAMS);
  });

  it("eases in a straight line from the last segment's targets over easeSeconds", () => {
    // Half-way through segment 2's four-second ease.
    expect(scriptedSample(SCRIPT, seconds(12))).toEqual({
      watts: 3 * BOT_MASS_KILOGRAMS,
      cadence: 90,
      heartRate: 140,
    });
    expect(scriptedSample(SCRIPT, seconds(14)).watts).toBe(4 * BOT_MASS_KILOGRAMS);
    expect(scriptedSample(SCRIPT, seconds(19)).cadence).toBe(100);
  });

  it('steps at once for a segment with no ease', () => {
    expect(scriptedSample(SCRIPT, seconds(20)).watts).toBe(3 * BOT_MASS_KILOGRAMS);
  });

  it('holds the last segment past its end', () => {
    expect(scriptedSample(SCRIPT, seconds(3600))).toEqual({
      watts: 3 * BOT_MASS_KILOGRAMS,
      cadence: 90,
      heartRate: 150,
    });
  });

  it('refuses a script with no segments', () => {
    expect(() => scriptedSample({ ...SCRIPT, segments: [] }, seconds(0))).toThrow(RangeError);
  });
});

describe('a demo script is synthetic by construction', () => {
  /**
   * Every key a shipped preset may carry, named once, as `pacing.test.ts`
   * names a pacer plan's. Adding a field fails this until somebody has looked
   * at the name and decided it is not a recorded ride.
   */
  const ALLOWED_PRESET_KEYS = ['id', 'riders', 'route'];
  const ALLOWED_RIDER_KEYS = ['kit', 'label', 'segments', 'startMetres'];
  const ALLOWED_SEGMENT_KEYS = [
    'cadenceRpm',
    'easeSeconds',
    'heartRateBpm',
    'untilSeconds',
    'wattsPerKilogram',
  ];
  const ALLOWED_ROUTE_KEYS = ['gradePercent', 'lengthMetres'];

  /** The keys of a record, and that every value is a scalar rather than a place for a series. */
  function scalarKeys(record: object): string[] {
    for (const value of Object.values(record)) {
      expect(['number', 'string']).toContain(typeof value);
    }
    return Object.keys(record).sort();
  }

  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))(
    'the %s preset holds nothing outside the allowlist',
    (_id, preset) => {
      expect(Object.keys(preset).sort()).toEqual(ALLOWED_PRESET_KEYS);
      expect(typeof preset.id).toBe('string');
      for (const section of preset.route) {
        expect(scalarKeys(section)).toEqual(ALLOWED_ROUTE_KEYS);
      }
      for (const rider of preset.riders) {
        expect(Object.keys(rider).sort()).toEqual(ALLOWED_RIDER_KEYS);
        const { segments, ...scalars } = rider;
        expect(scalarKeys(scalars)).toEqual(ALLOWED_RIDER_KEYS.filter((key) => key !== 'segments'));
        for (const segment of segments) {
          expect(scalarKeys(segment)).toEqual(ALLOWED_SEGMENT_KEYS);
        }
      }
    },
  );

  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))(
    'the %s preset labels its riders with letters, not names, in kits the renderer draws',
    (_id, preset) => {
      for (const rider of preset.riders) {
        expect(rider.label).toMatch(/^Rider [A-Z]$/);
        // Compile-time: a `DemoKit` is a key of the renderer's palette.
        const kit: keyof typeof KIT_PALETTE = rider.kit;
        expect(kit).toBe(rider.kit);
      }
    },
  );

  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))(
    "the %s preset's segments are in time order",
    (_id, preset) => {
      for (const rider of preset.riders) {
        const ends = rider.segments.map((segment) => segment.untilSeconds);
        expect(ends).toEqual([...ends].sort((a, b) => a - b));
        expect(new Set(ends).size).toBe(ends.length);
      }
    },
  );

  it('will not compile a script that could carry a recorded ride', () => {
    // The compile-time half, per docs/agents/quality-gate.md §5 "Verifying a
    // compile-time guarantee". `script.ts` §`RiderScriptIsSynthetic` applies the
    // constraint to `RiderScript` itself, so adding any of the fields below to
    // that interface fails `typecheck` with TS2344. The directives apply the
    // same constraint to a widened copy, so if the constraint is ever loosened
    // to admit one of them, TS2578 ("Unused '@ts-expect-error' directive")
    // fails the build.
    type WithSamples = RiderScript & { readonly samples: readonly number[] };
    type WithActivity = RiderScript & { readonly activityId: string };
    type WithAthlete = RiderScript & { readonly athleteId: string };
    type WithNested = RiderScript & { readonly source: { readonly id: number } };
    type WithRecordedSegment = Omit<RiderScript, 'segments'> & {
      readonly segments: readonly (ScriptSegment & { readonly power: readonly number[] })[];
    };
    type WithRecordedRoute = Omit<DemoPreset, 'route'> & {
      readonly route: readonly { readonly track: readonly number[] }[];
    };
    type WithRecordedRider = Omit<DemoPreset, 'riders'> & {
      readonly riders: readonly WithSamples[];
    };

    // @ts-expect-error — a recorded power series is not a script.
    type RejectsSamples = AssertSyntheticScript<WithSamples>;
    // @ts-expect-error — nor is an activity somebody rode.
    type RejectsActivity = AssertSyntheticScript<WithActivity>;
    // @ts-expect-error — nor is another athlete.
    type RejectsAthlete = AssertSyntheticScript<WithAthlete>;
    // @ts-expect-error — nor a nested object of any shape.
    type RejectsNested = AssertSyntheticScript<WithNested>;
    // @ts-expect-error — a segment may not carry a series either.
    type RejectsSegment = AssertSyntheticScript<WithRecordedSegment>;
    // @ts-expect-error — nor may a preset's road carry a track.
    type RejectsRoute = AssertSyntheticPreset<WithRecordedRoute>;
    // @ts-expect-error — nor may a preset carry a rider that could.
    type RejectsRider = AssertSyntheticPreset<WithRecordedRider>;

    // And the shipped shapes pass, so the constraint is not simply `never`.
    type AcceptsScript = AssertSyntheticScript<RiderScript>;
    type AcceptsPreset = AssertSyntheticPreset<DemoPreset>;
    const accepted: [AcceptsScript, AcceptsPreset] | undefined = undefined;
    const rejected:
      | [
          RejectsSamples,
          RejectsActivity,
          RejectsAthlete,
          RejectsNested,
          RejectsSegment,
          RejectsRoute,
          RejectsRider,
        ]
      | undefined = undefined;
    expect([accepted, rejected]).toEqual([undefined, undefined]);
  });
});
