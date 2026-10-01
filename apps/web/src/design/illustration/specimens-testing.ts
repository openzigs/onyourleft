// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One or more ways to draw each part of the illustration kit — #938.
 *
 * Test support, never shipped. Both the Vitest suite (`illustration.test.tsx`)
 * and the browser gate's page (`browser/shell-harness.tsx`
 * §`IllustrationSpecimens`) draw every part from this table, so the part the
 * jsdom suite holds to the rules and the part whose pixels the browser reads
 * are drawn the same way.
 *
 * ⚠️ **Typed against the kit's exports**, so a part added to `index.ts` with
 * no entry here is a compile error — and `illustration.test.tsx` also fails at
 * run time on an export with no specimen, rather than skipping it.
 */

import type { ComponentProps } from 'react';

import { expandWorkout, seconds, thresholdShare, type Workout } from '@onyourleft/domain';

import type * as kit from './index';
import { SENSOR_GLYPH_KINDS } from './SensorGlyph';

type Kit = typeof kit;

/** The name of one exported part. */
export type IllustrationPartName = keyof Kit;

/** Every way each part is drawn by the specimens. */
export type IllustrationSpecimens = {
  readonly [Name in IllustrationPartName]: readonly ComponentProps<Kit[Name]>[];
};

/**
 * A climb and a descent with a stretch missing in the middle — a ride's
 * altitude stream can have one — so the specimen shows a gap kept as a gap.
 */
export const SPECIMEN_ELEVATIONS: readonly (number | undefined)[] = Array.from(
  { length: 400 },
  (_, index) =>
    index >= 250 && index < 280 ? undefined : 120 + 80 * Math.sin((index / 400) * Math.PI * 1.6),
);

/** A warm-up ramp, four hard efforts, and a free-ride cool-down. */
export const SPECIMEN_WORKOUT: Workout = {
  name: 'Specimen',
  blocks: [
    { kind: 'ramp', seconds: seconds(600), from: thresholdShare(0.5), to: thresholdShare(0.8) },
    {
      kind: 'intervals',
      repeats: 4,
      hardSeconds: seconds(180),
      hardTarget: thresholdShare(1.1),
      easySeconds: seconds(120),
      easyTarget: thresholdShare(0.55),
    },
    { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.75) },
    { kind: 'free-ride', seconds: seconds(300) },
  ],
};

export const ILLUSTRATION_SPECIMENS: IllustrationSpecimens = {
  Sky: [{}],
  Hills: [{ seed: 7 }],
  RoadRibbon: [{}],
  RiderSilhouette: [{}],
  SensorGlyph: SENSOR_GLYPH_KINDS.map((kind) => ({ kind })),
  ProfileShape: [{ profile: { elevations: SPECIMEN_ELEVATIONS } }],
  WorkoutShape: [{ workout: expandWorkout(SPECIMEN_WORKOUT) }],
};
