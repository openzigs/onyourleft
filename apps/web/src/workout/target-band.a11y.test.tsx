// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The block's target band and the accessibility audit — #1434: on the Ride
 * screen with a running workout, the page audits clean with the band in it,
 * its gauge is an image with a name and no tab stop, the cadence warning is
 * a labelled message, and the sentences that were there before it still are.
 *
 * ⚠️ Contrast is not measured here — jsdom resolves no custom property. Each
 * mark's token is one `tokens.ts` already pairs with the surface it is drawn
 * on (`TargetBand.tsx` §TARGET_BAND_PAINTS, held to `theme.css` by
 * `TargetBand.test.tsx`), and `contrast.a11y.test.ts` walks the pairs.
 */

import { expandWorkout, seconds, thresholdShare } from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { RideWorkoutSnapshot } from '../ride/controller';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import { RideView } from '../views/RideView';
import { mount, settle, type Mounted } from '../testing/mount';
import { workoutStub } from '../workouts/testing';

import { ERG_CUE, targetBand, targetBandWords } from './target-band';

const ATHLETE = athleteId('athlete-a');

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const workout = (cadence: number): RideWorkoutSnapshot => ({
  name: 'Sweet spot',
  status: 'running',
  elapsedSeconds: 300,
  totalSeconds: 1200,
  holdingWatts: 150,
  nowRiding: '10 min at 60%',
  fault: undefined,
  rescue: undefined,
  thresholdWatts: 250,
  hasControl: true,
  targetConfirmed: true,
  live: { power: 140, heartRate: undefined, cadence },
  blockAverageWatts: 147,
  trace: [298, 299, 300].map((at) => ({
    at,
    target: 150,
    power: 140,
    heartRate: undefined,
    range: undefined,
  })),
  timeline: expandWorkout({
    name: 'Sweet spot',
    blocks: [
      { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
      { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.8) },
    ],
  }),
});

const page = (snapshot: RideWorkoutSnapshot): React.ReactElement => {
  const stub = stubRideController(ridingSnapshot());
  stub.set({ workout: snapshot });
  return (
    <main>
      <h1>Ride</h1>
      <RideView controller={stub.controller} workouts={workoutStub(ATHLETE, [])} />
    </main>
  );
};

describe.each([
  ['spinning freely', 90],
  ['with a low cadence', 58],
] as const)('the target band on the Ride screen, %s — #1434', (_, cadence) => {
  it('is there, and the page audits clean', async () => {
    mounted = await mount(page(workout(cadence)));
    await settle();
    expect(document.querySelector('[data-oyl-target-band]')).not.toBeNull();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is an image named by every number it draws, and is not a tab stop', async () => {
    mounted = await mount(page(workout(cadence)));
    await settle();
    const band = targetBand(workout(cadence));
    if (band === undefined) throw new Error('no band');
    const gauge = document.querySelector('[data-oyl-target-band] [role="img"]');
    expect(gauge?.getAttribute('aria-label')).toBe(targetBandWords(band).name);
    expect(gauge?.hasAttribute('tabindex')).toBe(false);
  });

  it('says under the band in words, and who holds what in ERG', async () => {
    mounted = await mount(page(workout(cadence)));
    await settle();
    const text = document.querySelector('[data-oyl-target-band]')?.textContent ?? '';
    expect(text).toContain('Target 150 W, ride 142–158 W');
    expect(text).toContain('2 W under the band');
    expect(text).toContain('5:00 left in this block');
    expect(text).toContain(ERG_CUE);
    expect(text.includes('Spin faster now')).toBe(cadence < 65);
  });

  it('keeps the sentences that were there before it', async () => {
    mounted = await mount(page(workout(cadence)));
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Now: 10 min at 60%');
    expect(text).toContain('Holding 150 W.');
  });
});
