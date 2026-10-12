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
import { hostedPressSends } from './hosted-consent';
import type { InstanceJobSource } from './instance-job';
import {
  HOSTED_SENDS_ID,
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

/** The service a hosted write-up would be sent to, when a case offers one (#1251). */
const HOSTED_ENDPOINT = 'https://models.example';
let asked: InstanceJobSource[] = [];

function port(connected: boolean, hosted = false): InstanceAnalysisPort {
  return {
    connected: () => connected,
    availableSources: () =>
      !connected ? [] : hosted ? ['instance-local', 'instance-hosted'] : ['instance-local'],
    hostedEndpoint: () => (connected && hosted ? HOSTED_ENDPOINT : undefined),
    pendingJob: () => false,
    ask: async (_id, source, view) =>
      new Promise((resolve) => {
        asked.push(source);
        push = view;
        finish = resolve;
      }),
    followAgain: async () => Promise.resolve({ kind: 'detached' }),
    cancel: async () => Promise.resolve(),
  };
}

async function open(
  connected: boolean,
  writeUp?: RideWriteUpRecord,
  hosted = false,
): Promise<void> {
  asked = [];
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
        instanceWriteUp={port(connected, hosted)}
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

  // #1251: the hosted press is drawn only where there is a service to name,
  // and it is described by the sentence that names it.
  it('offers no hosted press, and names no service, where none is on offer', async () => {
    await open(true);
    expect(
      [...document.querySelectorAll('button')].map((candidate) => candidate.textContent),
    ).not.toContain(INSTANCE_ASK_LABEL['instance-hosted']);
    expect(document.getElementById(HOSTED_SENDS_ID)).toBeNull();
  });

  it('describes the hosted press by the sentence naming the service, kept visible, and asks that source', async () => {
    await open(true, undefined, true);
    const control = button(INSTANCE_ASK_LABEL['instance-hosted']);
    expect(control.getAttribute('aria-describedby')).toBe(HOSTED_SENDS_ID);
    const sentence = document.getElementById(HOSTED_SENDS_ID);
    expect(sentence?.textContent).toBe(hostedPressSends(HOSTED_ENDPOINT));
    expect(sentence?.textContent).toContain(HOSTED_ENDPOINT);
    expect(sentence?.closest('details')).toBeNull();
    // The instance's own press keeps its own description.
    expect(button(INSTANCE_ASK_LABEL['instance-local']).getAttribute('aria-describedby')).toBe(
      INSTANCE_SENDS_LEAD_ID,
    );
    expectClean('hosted on offer');
    await activateWithKeyboard(control);
    expect(asked).toStrictEqual(['instance-hosted']);
    expectClean('hosted, starting');
  });
});
