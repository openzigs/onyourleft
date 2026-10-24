// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The three demo presets — #1646: a climb, a sprint, a group ride.
 *
 * ⚠️ **Every number below was written by hand** (ADR 0007 D4). None is taken
 * from, fitted to or checked against a recorded ride, the owner's or anybody
 * else's, and none may be. A preset that wants to look more like a real ride
 * gets better-chosen authored numbers, never a recording. `script.ts` says how
 * that is enforced.
 *
 * The labels are letters, never a person's name. Heart rate is a scripted
 * number, which the overlay (#1650) says on screen.
 *
 * What each preset is for is checked by riding it: `runner.test.ts` reads the
 * runner's output and asserts that the climb slows the lead rider while power
 * rises, that the sprint is a short peak well above the flat power, and that
 * the group's riders never sit on top of each other.
 */

import type { DemoPreset } from './script';

/** A kilometre and a bit of flat, then an 8 % climb, ridden harder once the road tips up. */
export const CLIMB_PRESET: DemoPreset = {
  id: 'climb',
  route: [
    { lengthMetres: 1200, gradePercent: 0 },
    { lengthMetres: 300, gradePercent: 4 },
    { lengthMetres: 1500, gradePercent: 8 },
  ],
  riders: [
    {
      label: 'Rider A',
      kit: 'house',
      startMetres: 0,
      segments: [
        {
          untilSeconds: 120,
          wattsPerKilogram: 3,
          cadenceRpm: 90,
          heartRateBpm: 136,
          easeSeconds: 0,
        },
        {
          untilSeconds: 160,
          wattsPerKilogram: 3.4,
          cadenceRpm: 84,
          heartRateBpm: 150,
          easeSeconds: 15,
        },
        {
          untilSeconds: 900,
          wattsPerKilogram: 3.8,
          cadenceRpm: 76,
          heartRateBpm: 166,
          easeSeconds: 20,
        },
      ],
    },
  ],
};

/** A steady minute on the flat, a twelve-second sprint, then back to the same steady pace. */
export const SPRINT_PRESET: DemoPreset = {
  id: 'sprint',
  route: [{ lengthMetres: 4000, gradePercent: 0 }],
  riders: [
    {
      label: 'Rider A',
      kit: 'green',
      startMetres: 0,
      segments: [
        {
          untilSeconds: 60,
          wattsPerKilogram: 2.6,
          cadenceRpm: 90,
          heartRateBpm: 140,
          easeSeconds: 0,
        },
        {
          untilSeconds: 72,
          wattsPerKilogram: 10.5,
          cadenceRpm: 115,
          heartRateBpm: 162,
          easeSeconds: 1,
        },
        {
          untilSeconds: 100,
          wattsPerKilogram: 2.6,
          cadenceRpm: 88,
          heartRateBpm: 168,
          easeSeconds: 2,
        },
        {
          untilSeconds: 240,
          wattsPerKilogram: 2.6,
          cadenceRpm: 90,
          heartRateBpm: 148,
          easeSeconds: 30,
        },
      ],
    },
  ],
};

/**
 * Four riders in a line on a rolling road, close enough to read as a group and
 * spaced so that no two are drawn in the same place.
 */
export const GROUP_PRESET: DemoPreset = {
  id: 'group',
  route: [
    { lengthMetres: 800, gradePercent: 0 },
    { lengthMetres: 600, gradePercent: 2 },
    { lengthMetres: 600, gradePercent: -1 },
    { lengthMetres: 2000, gradePercent: 0 },
  ],
  riders: [
    {
      label: 'Rider A',
      kit: 'house',
      startMetres: 30,
      segments: [
        {
          untilSeconds: 300,
          wattsPerKilogram: 2.8,
          cadenceRpm: 90,
          heartRateBpm: 142,
          easeSeconds: 0,
        },
      ],
    },
    {
      label: 'Rider B',
      kit: 'green',
      startMetres: 20,
      segments: [
        {
          untilSeconds: 190,
          wattsPerKilogram: 2.8,
          cadenceRpm: 88,
          heartRateBpm: 138,
          easeSeconds: 0,
        },
        {
          untilSeconds: 215,
          wattsPerKilogram: 2.9,
          cadenceRpm: 92,
          heartRateBpm: 144,
          easeSeconds: 5,
        },
        {
          untilSeconds: 300,
          wattsPerKilogram: 2.8,
          cadenceRpm: 88,
          heartRateBpm: 140,
          easeSeconds: 5,
        },
      ],
    },
    {
      label: 'Rider C',
      kit: 'purple',
      startMetres: 10,
      segments: [
        {
          untilSeconds: 30,
          wattsPerKilogram: 2.8,
          cadenceRpm: 85,
          heartRateBpm: 146,
          easeSeconds: 0,
        },
        {
          untilSeconds: 60,
          wattsPerKilogram: 2.72,
          cadenceRpm: 82,
          heartRateBpm: 144,
          easeSeconds: 5,
        },
        {
          untilSeconds: 300,
          wattsPerKilogram: 2.8,
          cadenceRpm: 85,
          heartRateBpm: 146,
          easeSeconds: 5,
        },
      ],
    },
    {
      label: 'Rider D',
      kit: 'magenta',
      startMetres: 0,
      segments: [
        {
          untilSeconds: 300,
          wattsPerKilogram: 2.8,
          cadenceRpm: 94,
          heartRateBpm: 150,
          easeSeconds: 0,
        },
      ],
    },
  ],
};

/** Every preset, in the order a picker would list them. */
export const DEMO_PRESETS: readonly DemoPreset[] = [CLIMB_PRESET, SPRINT_PRESET, GROUP_PRESET];
