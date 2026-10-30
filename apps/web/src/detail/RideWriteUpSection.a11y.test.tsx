// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A model's write-up on a ride's page, audited in every state it renders**
 * — #805. The whole page is audited, so the section is audited where it sits:
 * under the ride's `h2`, below the side camera's report.
 *
 * Since #1103 the ask is the instance's alone, and its states — the press,
 * a job streaming, a withdrawal — are audited in
 * `ride-analysis/InstanceWriteUpControl.a11y.test.tsx`. This file audits what
 * the section renders around it: the two sentences with nothing to ask, and a
 * saved write-up in every way it can be shown or withheld.
 *
 * ⚠️ Named `*.a11y.test.tsx` because that is what `test:a11y` selects on
 * (#142).
 */

import { unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, type RideWriteUpRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { InstanceAnalysisPort } from '../ride-analysis/instance-analysis-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';

import { stubActivity, stubDetail, type StubRide } from './testing';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

const WRITE_UP: RideWriteUpRecord = {
  activityId: RIDE,
  athleteId: ATHLETE,
  text: 'A steady ride.\n\nEven pacing throughout.',
  templateId: 'ride-write-up',
  templateVersion: '1',
  source: 'computer',
  includedPose: true,
  missingSections: [1],
  writtenAt: unixSeconds(1_800_000_000),
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** An instance this device holds no sign-in to: the section's one sentence and its link. */
const NOT_SIGNED_IN: InstanceAnalysisPort = {
  connected: () => false,
  availableSources: () => [],
  hostedEndpoint: () => undefined,
  pendingJob: () => false,
  ask: async () => Promise.resolve({ kind: 'detached' }),
  followAgain: async () => Promise.resolve({ kind: 'detached' }),
  cancel: async () => Promise.resolve(),
};

async function open(
  writeUp: StubRide['writeUp'],
  instance: InstanceAnalysisPort | undefined,
): Promise<void> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView
        port={stubDetail(ATHLETE, {
          activity: stubActivity(),
          channels: {},
          laps: [],
          ...(writeUp === undefined ? {} : { writeUp }),
        })}
        activityId={RIDE}
        instanceWriteUp={instance}
      />
    </main>,
  );
  await settle();
  await settle();
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('every state of the write-up passes the audit', () => {
  it.each([
    ['the fallback, a browser that cannot hold a sign-in', undefined, undefined],
    ['signed in to no instance', undefined, NOT_SIGNED_IN],
    ['a write-up saved, with the fallback', WRITE_UP, undefined],
    ['a write-up saved, signed in to no instance', WRITE_UP, NOT_SIGNED_IN],
    [
      'a saved write-up the screen withholds',
      { ...WRITE_UP, text: 'At 142° the knee.' },
      undefined,
    ],
    ['a saved row that will not decode', 'unreadable' as const, NOT_SIGNED_IN],
  ])('%s', async (what, writeUp, instance) => {
    await open(writeUp, instance);
    expectClean(what);
  });
});
