// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A write-up asked of the rider's instance, audited in every state it
 * streams through** — #1102. The whole page is audited, so the control is
 * audited where it sits: on a ride's page, under the section's heading.
 *
 * ⚠️ Named `*.a11y.test.tsx` because that is what `test:a11y` selects on
 * (#142).
 */

import { unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, type RideWriteUpRecord } from '@onyourleft/store';
import { screenSavedWriteUp, type ScreenedWriteUp } from '@onyourleft/analysis';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { stubActivity, stubDetail } from '../detail/testing';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';
import type {
  InstanceAnalysisPort,
  InstanceAskOutcome,
  InstanceJobView,
} from './instance-analysis-port';
import {
  INSTANCE_ASK_LABEL,
  INSTANCE_CANCEL_LABEL,
  INSTANCE_RECONNECTING,
  INSTANCE_SENDS_LEAD_ID,
  INSTANCE_WITHDRAWN,
  instanceProgressText,
} from './InstanceWriteUpControl';
import { INSTANCE_SENDS_LEAD, WRITE_UP_NO_INSTANCE_BEFORE } from '../detail/write-up';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

const EARLIER: RideWriteUpRecord = {
  activityId: RIDE,
  athleteId: ATHLETE,
  text: 'A steady ride.',
  templateId: 'ride-write-up-agent',
  templateVersion: '1',
  source: 'instance-local',
  includedPose: false,
  missingSections: [],
  writtenAt: unixSeconds(1_800_000_000),
};

let mounted: Mounted | undefined;
let push: ((view: InstanceJobView) => void) | undefined;
let finish: ((outcome: InstanceAskOutcome) => void) | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function screened(text: string): ScreenedWriteUp {
  const passed = screenSavedWriteUp(text);
  if (typeof passed !== 'string') throw new Error('fixture does not pass the screen');
  return passed;
}

function port(connected: boolean): InstanceAnalysisPort {
  return {
    connected: () => connected,
    availableSources: () => (connected ? ['instance-local'] : []),
    pendingJob: () => false,
    ask: async (_id, _source, view) =>
      new Promise((resolve) => {
        push = view;
        finish = resolve;
      }),
    followAgain: async () => Promise.resolve({ kind: 'detached' }),
    cancel: async () => Promise.resolve(),
  };
}

async function open(connected: boolean, writeUp?: RideWriteUpRecord): Promise<void> {
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
        instanceWriteUp={port(connected)}
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
  if (found === undefined) throw new Error(`no button "${label}"`);
  return found;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

async function show(view: InstanceJobView): Promise<void> {
  await act(async () => {
    push?.(view);
    await Promise.resolve();
  });
}

const status = (): string =>
  document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '';

describe('every state of the instance’s write-up passes the audit (#1102)', () => {
  it.each([
    ['no instance, nothing saved', false, undefined],
    ['no instance, a write-up saved', false, EARLIER],
    ['an instance, nothing asked yet', true, undefined],
    ['an instance, a write-up saved', true, EARLIER],
  ])('%s', async (what, connected, writeUp) => {
    await open(connected, writeUp);
    expectClean(what);
    if (!connected) {
      expect(document.body.textContent).toContain(WRITE_UP_NO_INSTANCE_BEFORE);
    }
  });

  it('starting, streaming, reconnecting, withdrawn and ended, each said politely', async () => {
    await open(true, EARLIER);
    await activateWithKeyboard(button(INSTANCE_ASK_LABEL['instance-local']));
    expectClean('starting');

    await show({
      phase: 'streaming',
      step: 2,
      sections: [screened('First part.')],
      withdrawn: false,
    });
    expect(status()).toBe(instanceProgressText(2));
    expectClean('streaming');
    // Every control is still in the tab order, and named.
    const tabbable = tabbableElements(document).map((element) => element.textContent);
    expect(tabbable).toEqual(
      expect.arrayContaining([INSTANCE_ASK_LABEL['instance-local'], INSTANCE_CANCEL_LABEL]),
    );

    await show({
      phase: 'reconnecting',
      step: 2,
      sections: [screened('First part.')],
      withdrawn: false,
    });
    expect(status()).toBe(INSTANCE_RECONNECTING);
    expectClean('reconnecting');

    await show({ phase: 'streaming', step: 3, sections: [], withdrawn: true });
    expect(status()).toBe(INSTANCE_WITHDRAWN);
    expectClean('withdrawn');

    await act(async () => {
      finish?.({ kind: 'failed', text: 'The model took too long, so nothing was kept.' });
      await Promise.resolve();
    });
    await settle();
    expectClean('failed, the earlier write-up standing');
  });

  it('describes the press by the lead of what it sends, the rest beside it', async () => {
    await open(true);
    const control = button(INSTANCE_ASK_LABEL['instance-local']);
    expect(control.getAttribute('aria-describedby')).toBe(INSTANCE_SENDS_LEAD_ID);
    expect(document.getElementById(INSTANCE_SENDS_LEAD_ID)?.textContent).toBe(INSTANCE_SENDS_LEAD);
    expect(document.body.textContent).toContain('Never a picture.');
  });
});
