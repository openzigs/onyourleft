// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A model's write-up on a ride's page, audited in every state it renders**
 * — #805. The whole page is audited, so the section is audited where it sits:
 * under the ride's `h2`, below the side camera's report.
 *
 * ⚠️ Named `*.a11y.test.tsx` because that is what `test:a11y` selects on
 * (#142).
 */

import { unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, type RideWriteUpRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import type { AskOutcome, RideAnalysisPort } from '../ride-analysis/ride-analysis-port';
import { ASK_LABEL, CANCEL_LABEL } from '../ride-analysis/RideWriteUpControl';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
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
let settleAsk: ((outcome: AskOutcome) => void) | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const PORT: RideAnalysisPort = {
  availableSources: () => ['computer', 'hosted'],
  previewHostedRequest: async () => Promise.resolve({ kind: 'shown', steps: [], total: 1 }),
  hostedPreviewSeen: () => true,
  askForRideWriteUp: async () =>
    new Promise<AskOutcome>((resolve) => {
      settleAsk = resolve;
    }),
};

async function open(
  writeUp: StubRide['writeUp'],
  port: RideAnalysisPort | undefined = PORT,
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
        writeUp={port}
      />
    </main>,
  );
  await settle();
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (found === undefined) {
    throw new Error(`no button "${label}"`);
  }
  return found;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('every state of the write-up passes the audit', () => {
  it.each([
    ['the fallback, no model set up', undefined, undefined],
    ['nothing asked yet', undefined, PORT],
    ['a write-up saved', WRITE_UP, PORT],
    ['a saved write-up the screen withholds', { ...WRITE_UP, text: 'At 142° the knee.' }, PORT],
    ['a saved row that will not decode', 'unreadable' as const, PORT],
  ])('%s', async (what, writeUp, port) => {
    await open(writeUp, port);
    expectClean(what);
  });

  it('while a run goes, and after it fails with the earlier write-up standing', async () => {
    await open(WRITE_UP);
    await activateWithKeyboard(button(ASK_LABEL.computer.first));
    expectClean('running');
    // Every control is still in the tab order, and named.
    const tabbable = tabbableElements(document).map((element) => element.textContent);
    expect(tabbable).toEqual(
      expect.arrayContaining([ASK_LABEL.computer.first, ASK_LABEL.hosted.other, CANCEL_LABEL]),
    );
    settleAsk?.({ kind: 'failed', text: 'The model took too long, so nothing was kept.' });
    await settle();
    expectClean('failed, the earlier write-up standing');
  });

  it('describes each ask control by what it would send', async () => {
    await open(undefined);
    const control = button(ASK_LABEL.computer.first);
    const described = document.getElementById(control.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toContain('Never a picture.');
  });
});
