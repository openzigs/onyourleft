// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Asking the instance from a ride's page, wired the way `main.tsx` wires
 * it** (#1102).
 *
 * `check:wiring` sees the port's methods called, and nothing more: the page is
 * handed the port as an OPTIONAL prop (docs/agents/wiring-gate.md §4j §Limits).
 * So this renders the real `AppShell` at the real detail route, handed
 * `createInstanceAnalysis` over the real store and a scripted instance
 * (`instance-job-testing.ts`, the job routes' double), presses the real
 * button, and reads what was saved back through the page's OWN read after
 * closing the store and opening it again. `main.tsx` is held to building and
 * passing exactly that by `instance-analysis-main.test.ts`.
 *
 * And the page's promises, on the DOM: no streamed text that fails the
 * device's screen is ever rendered, a withdrawal takes every section off the
 * page, a dropped stream and a remounted page resume with no section twice,
 * and Cancel keeps the earlier write-up and says why above it.
 */

import { unixSeconds } from '@onyourleft/domain';
import type { ActivityId, RideWriteUpRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  seedRide,
  streamSetFor,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { passedScreen, screenSavedWriteUp } from '@onyourleft/analysis';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WRITE_UP_EARLIER,
  WRITE_UP_NO_INSTANCE_BEFORE,
  WRITE_UP_SOURCE_TEXT,
} from '../detail/write-up';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { createInstanceAnalysis, INSTANCE_ASK_TEXT } from './instance-analysis';
import type { InstanceAnalysisPort } from './instance-analysis-port';
import {
  failedWith,
  progress,
  scriptedJobs,
  section,
  succeeded,
  withdrawn,
  SCRIPTED_JOB_ID,
  type ScriptedJobs,
} from './instance-job-testing';
import {
  INSTANCE_ASK_LABEL,
  INSTANCE_CANCEL_LABEL,
  INSTANCE_WITHDRAWN,
} from './InstanceWriteUpControl';
import { WRITE_UP_HEADING, WRITE_UP_SAVED } from './RideWriteUpControl';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

const WRITE_UP = 'A steady ride. You held your power well through the middle section.';

let harness: StoreHarness;
let store: PersistentStore;
let mounted: Mounted | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  store = indexedDbStoreFactory.open(harness.databaseName);
});

afterEach(async () => {
  // The page goes on to read its traces; let it finish before the store closes.
  if (mounted !== undefined) {
    for (let turn = 0; turn < 40; turn += 1) await settle();
  }
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  store.close();
  await harness.destroy();
});

/** The port, built as `main.tsx` §`buildInstanceAnalysis` builds it, over the scripted instance. */
function builtAsMainBuildsIt(
  scripted: ScriptedJobs,
  connected = true,
  over: PersistentStore = store,
): InstanceAnalysisPort {
  return createInstanceAnalysis({
    store: over,
    athleteId: ATHLETE_A,
    connected: () => connected,
    session: async () => Promise.resolve(scripted.session),
    cameraConsented: () => false,
    now: () => unixSeconds(1_800_000_000),
    wait: async () => Promise.resolve(),
  });
}

async function seededRide(): Promise<ActivityId> {
  const ride = await seedRide(harness, ATHLETE_A);
  await harness.write(async (writer) =>
    writer.putStreamSet(streamSetFor(ride, { sampleCount: 1800 })),
  );
  return ride.id;
}

async function openShell(
  id: ActivityId,
  port: InstanceAnalysisPort,
  over: PersistentStore = store,
): Promise<void> {
  globalThis.location.hash = `#/activities/${id}`;
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      detail={{ store: over, athleteId: ATHLETE_A }}
      instanceAnalysis={port}
    />,
  );
  await settle();
}

async function until(done: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (done()) return;
    await settle();
  }
  throw new Error(`never: ${what}`);
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
}

const askButton = (): HTMLButtonElement | undefined => button(INSTANCE_ASK_LABEL['instance-local']);

function liveRegion(): string {
  return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '';
}

function streamedSections(): string[] {
  return [...document.querySelectorAll('.oyl-write-up__section')].map(
    (element) => element.textContent,
  );
}

async function saved(id: ActivityId): Promise<RideWriteUpRecord | undefined> {
  return harness.read(async (reader) => reader.getRideWriteUp(ATHLETE_A, id));
}

describe('the real detail route, with the port main.tsx builds', () => {
  it('saves only what this device screened, and the page reads it back after the store is reopened', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([progress(1), section(1, 'First part.'), succeeded(WRITE_UP)]);
    await openShell(id, builtAsMainBuildsIt(scripted));
    await until(() => askButton() !== undefined, 'the ask button appears');
    expect(document.body.textContent).toContain(WRITE_UP_HEADING);
    // Opening the page sends nothing.
    expect(scripted.requests).toStrictEqual([]);

    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the write-up is saved');
    expect(scripted.acknowledged).toStrictEqual([SCRIPTED_JOB_ID]);

    // Close the store, open it again, and let the page read it through its own read.
    await until(
      () => document.querySelector('.oyl-write-up__text')?.textContent === WRITE_UP,
      'the page has read the new write-up back',
    );
    for (let turn = 0; turn < 40; turn += 1) await settle();
    mounted?.unmount();
    mounted = undefined;
    store.close();
    store = indexedDbStoreFactory.open(harness.databaseName);
    await openShell(id, builtAsMainBuildsIt(scriptedJobs()));
    await until(
      () => document.querySelector('.oyl-write-up__text')?.textContent === WRITE_UP,
      'the saved write-up is shown',
    );
    expect(document.body.textContent).toContain(WRITE_UP_SOURCE_TEXT['instance-local']);
  });

  it('does not save a candidate edited on the instance to state an angle, says so, and keeps the earlier one', async () => {
    const id = await seededRide();
    await openShell(id, builtAsMainBuildsIt(scriptedJobs([succeeded(WRITE_UP)])));
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the first write-up is saved');
    const first = await saved(id);
    mounted?.unmount();

    const edited = scriptedJobs([succeeded('Your knee opened to 12° at the bottom.')]);
    await openShell(id, builtAsMainBuildsIt(edited));
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(
      () => liveRegion() === INSTANCE_ASK_TEXT['withheld-on-device'],
      'the rider is told it was withheld',
    );
    expect(await saved(id)).toStrictEqual(first);
    expect(document.querySelector('.oyl-write-up__text')?.textContent).toBe(WRITE_UP);
    expect(document.body.textContent).toContain(WRITE_UP_EARLIER);
    expect(document.body.innerHTML).not.toContain('12°');
  });

  it('never renders a text node that fails the screen while a stream’s third section fails it', async () => {
    const id = await seededRide();
    const failing = 'Your hip angle was 95° at the top.';
    const scripted = scriptedJobs([
      section(1, 'First part.'),
      section(2, 'Second part.'),
      section(3, failing),
      section(4, 'Fourth part.'),
      failedWith('out-of-time'),
    ]);
    // Two good sections shown first; then the stream stops after the failing
    // one, so the page sits on what it made of it.
    scripted.holdAfter = 2;
    await openShell(id, builtAsMainBuildsIt(scripted));
    await until(() => askButton() !== undefined, 'the ask button appears');

    const rendered: string[] = [];
    const observer = new MutationObserver(() => {
      for (const element of document.querySelectorAll('.oyl-write-up__section')) {
        rendered.push(element.textContent);
      }
      rendered.push(document.body.textContent);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => streamedSections().length === 2, 'two sections are shown');
    scripted.holdAfter = 3;
    scripted.push();
    for (let turn = 0; turn < 20; turn += 1) await settle();
    // Sitting on the third section: none of it, nor the two before it, is on the page.
    expect(document.body.textContent).not.toContain('95°');
    expect(streamedSections()).toStrictEqual([]);
    expect(liveRegion()).toBe(INSTANCE_WITHDRAWN);
    scripted.release();
    await until(() => button(INSTANCE_CANCEL_LABEL) === undefined, 'the job ends');
    observer.disconnect();

    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.some((text) => text === 'First part.')).toBe(true);
    for (const text of rendered) {
      expect(text).not.toContain('95°');
    }
    for (const element of rendered.filter((text) => text.length < 200)) {
      expect(passedScreen(screenSavedWriteUp(element)), element).toBe(true);
    }
  });

  it('takes every section off the page on a withdrawal, and says so', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([section(1, 'First part.'), section(2, 'Second part.')]);
    scripted.holdAfter = 2;
    await openShell(id, builtAsMainBuildsIt(scripted));
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => streamedSections().length === 2, 'two sections are shown');
    scripted.push(withdrawn());
    scripted.release();
    await until(() => liveRegion() === INSTANCE_WITHDRAWN, 'the withdrawal is said');
    expect(streamedSections()).toStrictEqual([]);
  });

  it('resumes after a dropped stream, and again on a remounted page, with no section twice', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([
      section(1, 'First part.'),
      section(2, 'Second part.'),
      section(3, 'Third part.'),
    ]);
    scripted.cutAfter = 1;
    scripted.holdAfter = 3;
    const port = builtAsMainBuildsIt(scripted);
    await openShell(id, port);
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => streamedSections().length === 3, 'three sections, across a dropped stream');
    expect(streamedSections()).toStrictEqual(['First part.', 'Second part.', 'Third part.']);
    const resumedAt = scripted.requests.filter((r) => r.method === 'GET').map((r) => r.lastEventId);
    expect(resumedAt).toStrictEqual([undefined, '1']);

    // Reopening the page: the same tab's controller, a new mount.
    mounted?.unmount();
    await openShell(id, port);
    await until(() => streamedSections().length === 3, 'the page picks the job up');
    expect(streamedSections()).toStrictEqual(['First part.', 'Second part.', 'Third part.']);
    expect(scripted.requests.filter((r) => r.method === 'GET').at(-1)?.lastEventId).toBe('3');
    scripted.push(succeeded(WRITE_UP));
    scripted.release();
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the write-up is saved');
    expect((await saved(id))?.text).toBe(WRITE_UP);
  });

  it('cancels, keeps the earlier write-up, and says why above it; the ask keeps its tab stop', async () => {
    const id = await seededRide();
    await openShell(id, builtAsMainBuildsIt(scriptedJobs([succeeded(WRITE_UP)])));
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the first write-up is saved');
    mounted?.unmount();

    const scripted = scriptedJobs([section(1, 'First part.')]);
    scripted.holdAfter = 1;
    await openShell(id, builtAsMainBuildsIt(scripted));
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => streamedSections().length === 1, 'the job is streaming');
    expect(button(INSTANCE_CANCEL_LABEL)).toBeDefined();
    const ask = askButton() as HTMLButtonElement;
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(ask.disabled).toBe(false);
    // A press while a job goes starts nothing.
    await activateWithKeyboard(ask);
    expect(scripted.requests.filter((r) => r.path === '/v1/analysis/jobs')).toHaveLength(1);

    await activateWithKeyboard(button(INSTANCE_CANCEL_LABEL) as HTMLButtonElement);
    await until(() => liveRegion() === INSTANCE_ASK_TEXT.cancelled, 'the cancel is said');
    expect(scripted.cancelled).toStrictEqual([SCRIPTED_JOB_ID]);
    const quote = document.querySelector('.oyl-write-up__text');
    expect(quote?.textContent).toBe(WRITE_UP);
    expect(document.body.textContent).toContain(WRITE_UP_EARLIER);
    const status = document.querySelector('[role="status"][aria-live="polite"]');
    expect(
      (status?.compareDocumentPosition(quote as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('stops rendering a job while a ride is recorded, says nothing, and picks it up after', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([progress(1), section(1, 'First part.')]);
    scripted.holdAfter = 2;
    let recording = false;
    const listeners = new Set<() => void>();
    const port = createInstanceAnalysis({
      store,
      athleteId: ATHLETE_A,
      connected: () => true,
      session: async () => Promise.resolve(scripted.session),
      cameraConsented: () => false,
      now: () => unixSeconds(1_800_000_000),
      wait: async () => Promise.resolve(),
      ride: {
        inProgress: () => recording,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    const setRecording = async (value: boolean): Promise<void> => {
      recording = value;
      await act(async () => {
        for (const listener of listeners) listener();
        await Promise.resolve();
      });
      await settle();
    };
    await openShell(id, port);
    await until(() => askButton() !== undefined, 'the ask button appears');
    await activateWithKeyboard(askButton() as HTMLButtonElement);
    await until(() => streamedSections().length === 1, 'a section is shown');

    expect(scripted.openStreams()).toBe(1);
    await setRecording(true);
    await until(() => streamedSections().length === 0, 'the job is no longer rendered');
    // The page let go of the stream, rather than only hiding it.
    await until(() => scripted.openStreams() === 0, 'the stream is let go');
    expect(liveRegion()).toBe('');
    expect(askButton()?.getAttribute('aria-disabled')).toBe('true');
    expect(button(INSTANCE_CANCEL_LABEL)).toBeUndefined();
    // The job carries on: nothing was cancelled.
    expect(scripted.cancelled).toStrictEqual([]);
    expect(port.pendingJob(id)).toBe(true);

    await setRecording(false);
    await until(() => streamedSections().length === 1, 'the job is picked up again');
    scripted.push(succeeded(WRITE_UP));
    scripted.release();
    await until(() => liveRegion() === WRITE_UP_SAVED, 'the write-up is saved');
  });

  it('with no instance, says so in one sentence with a link, sends nothing, and still shows a saved write-up', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs();
    await openShell(id, builtAsMainBuildsIt(scripted, false));
    await until(
      () => document.body.textContent.includes(WRITE_UP_NO_INSTANCE_BEFORE),
      'the no-instance sentence appears',
    );
    expect(askButton()).toBeUndefined();
    expect(document.body.textContent).not.toContain(WRITE_UP_HEADING);
    const link = [...document.querySelectorAll('a')].find((a) =>
      a.closest('p')?.textContent.includes(WRITE_UP_NO_INSTANCE_BEFORE),
    );
    expect(link?.getAttribute('href')).toBe('#/settings/instance');
    mounted?.unmount();

    // A write-up saved earlier still shows, screened on display.
    await harness.write(async (writer) =>
      writer.putRideWriteUp({
        activityId: id,
        athleteId: ATHLETE_A,
        text: WRITE_UP,
        templateId: 'ride-write-up-agent',
        templateVersion: '1',
        source: 'instance-local',
        includedPose: false,
        missingSections: [],
        writtenAt: unixSeconds(1_800_000_000),
      }),
    );
    await openShell(id, builtAsMainBuildsIt(scripted, false));
    await until(
      () => document.querySelector('.oyl-write-up__text')?.textContent === WRITE_UP,
      'the saved write-up is shown',
    );
    expect(document.body.textContent).toContain(WRITE_UP_NO_INSTANCE_BEFORE);
    for (let turn = 0; turn < 20; turn += 1) await settle();
    expect(scripted.requests).toStrictEqual([]);
  });
});
