// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A write-up asked of the rider's instance (#1102), against the real store and
 * a scripted instance (`instance-job-testing.ts`). Every save is read back
 * through a FRESH connection — the path the ride's page reads — never through
 * the handle that wrote it.
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
import { ANALYSIS_AGENT_TEMPLATE_V1, passedScreen, screenSavedWriteUp } from '@onyourleft/analysis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createInstanceAnalysis,
  INSTANCE_ASK_TEXT,
  INSTANCE_FAILURE_TEXT,
  instanceFailureText,
  MAXIMUM_RECONNECTS,
  PENDING_JOBS_STORAGE_KEY,
  pendingJobForgetter,
  reconnectDelayMilliseconds,
  type InstanceAnalysisOptions,
  type PendingJobStorage,
} from './instance-analysis';
import type { InstanceJobView } from './instance-analysis-port';
import { forgettingOnDelete } from '../library/store-port';
import {
  failedWith,
  progress,
  scriptedJobs,
  section,
  startedWith,
  succeeded,
  withdrawn,
  SCRIPTED_JOB_ID,
  type ScriptedJobs,
} from './instance-job-testing';

const WRITE_UP = 'A steady ride. You held your power well through the middle section.';

const POSE = {
  differences: { torso: -9.5, elbow: 2.25 },
  posed: 2700,
  noRider: 41,
  unreadable: 6,
  source: 'computer' as const,
};

let harness: StoreHarness;
let writer: PersistentStore;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = indexedDbStoreFactory.open(harness.databaseName);
});

afterEach(async () => {
  writer.close();
  await harness.destroy();
});

async function seededRide(): Promise<ActivityId> {
  const ride = await seedRide(harness, ATHLETE_A);
  await harness.write(async (store) =>
    store.putStreamSet(streamSetFor(ride, { sampleCount: 1800 })),
  );
  return ride.id;
}

/** `localStorage`'s shape, in memory: a "reopened app" is a new controller over the same one. */
function memoryStorage(): PendingJobStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function controller(scripted: ScriptedJobs, overrides: Partial<InstanceAnalysisOptions> = {}) {
  return createInstanceAnalysis({
    store: writer,
    athleteId: ATHLETE_A,
    connected: () => true,
    session: async () => Promise.resolve(scripted.session),
    cameraConsented: () => false,
    now: () => unixSeconds(1_800_000_000),
    wait: async () => Promise.resolve(),
    ...overrides,
  });
}

async function saved(id: ActivityId): Promise<RideWriteUpRecord | undefined> {
  return harness.read(async (reader) => reader.getRideWriteUp(ATHLETE_A, id));
}

const live = (): AbortSignal => new AbortController().signal;

function recorder(): { views: InstanceJobView[]; push: (view: InstanceJobView) => void } {
  const views: InstanceJobView[] = [];
  return { views, push: (view) => views.push(view) };
}

describe('one press: start, follow, screen, save, acknowledge', () => {
  it('saves the write-up, read back on a fresh connection, and acknowledges the job', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([
      progress(1),
      section(1, 'First part.'),
      progress(2),
      section(2, 'Second part.'),
      succeeded(WRITE_UP),
    ]);
    const seen = recorder();
    const outcome = await controller(scripted).ask(id, 'instance-local', seen.push, live());
    expect(outcome).toStrictEqual({ kind: 'written' });
    const row = await saved(id);
    expect(row?.text).toBe(WRITE_UP);
    expect(row?.source).toBe('instance-local');
    expect(row?.templateId).toBe(ANALYSIS_AGENT_TEMPLATE_V1.id);
    expect(row?.templateVersion).toBe(ANALYSIS_AGENT_TEMPLATE_V1.version);
    expect(row?.includedPose).toBe(false);
    expect(scripted.acknowledged).toStrictEqual([SCRIPTED_JOB_ID]);
    // The page was handed each section, in order, as it came.
    expect(seen.views.at(-2)?.sections).toStrictEqual(['First part.', 'Second part.']);
    expect(seen.views.some((view) => view.phase === 'saving')).toBe(true);
  });

  it('sends the input, the agent template’s version and the source, and nothing else', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([succeeded(WRITE_UP)]);
    await controller(scripted).ask(id, 'instance-local', () => undefined, live());
    const body = startedWith(scripted);
    expect(Object.keys(body ?? {}).sort()).toStrictEqual(['input', 'source', 'templateVersion']);
    expect(body?.source).toBe('instance-local');
    expect(body?.templateVersion).toBe(ANALYSIS_AGENT_TEMPLATE_V1.version);
    expect(body?.input.sections.length).toBeGreaterThan(0);
  });

  it('does not save a write-up this device’s screen withholds, and keeps the earlier one', async () => {
    const id = await seededRide();
    const first = scriptedJobs([succeeded(WRITE_UP)]);
    await controller(first).ask(id, 'instance-local', () => undefined, live());
    const before = await saved(id);
    // "Edited on the instance": the instance passed it, this device does not.
    const edited = scriptedJobs([succeeded('Your knee opened to 12° at the bottom.')]);
    const outcome = await controller(edited).ask(id, 'instance-local', () => undefined, live());
    expect(outcome).toStrictEqual({
      kind: 'failed',
      text: INSTANCE_ASK_TEXT['withheld-on-device'],
    });
    expect(await saved(id)).toStrictEqual(before);
    expect(edited.acknowledged).toStrictEqual([]);
  });

  it('screens every section again, and one that fails takes back every one shown', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([
      section(1, 'First part.'),
      section(2, 'Second part.'),
      section(3, 'Your hip angle was 95°.'),
      section(4, 'Fourth part.'),
      failedWith('out-of-time'),
    ]);
    const seen = recorder();
    await controller(scripted).ask(id, 'instance-local', seen.push, live());
    for (const view of seen.views) {
      for (const text of view.sections) {
        expect(passedScreen(screenSavedWriteUp(text)), text).toBe(true);
      }
    }
    const after = seen.views.at(-1);
    expect(after?.withdrawn).toBe(true);
    expect(after?.sections).toStrictEqual([]);
  });

  it('takes back every section on the instance’s withdrawal, and says the instance withheld it', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([
      section(1, 'First part.'),
      withdrawn(),
      { kind: 'result', data: { status: 'withheld', reasons: ['angle'] } },
    ]);
    const seen = recorder();
    const outcome = await controller(scripted).ask(id, 'instance-local', seen.push, live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: INSTANCE_FAILURE_TEXT.withheld });
    expect(seen.views.at(-1)?.withdrawn).toBe(true);
    expect(await saved(id)).toBeUndefined();
  });
});

describe('failures are sentences', () => {
  it.each([
    'out-of-steps',
    'out-of-tool-calls',
    'out-of-time',
    'out-of-tokens',
    'model-without-tools',
    'hosted_unavailable',
    'interrupted',
  ] as const)('says %s in its own sentence, and saves nothing', async (failure) => {
    const id = await seededRide();
    const outcome = await controller(scriptedJobs([failedWith(failure)])).ask(
      id,
      'instance-local',
      () => undefined,
      live(),
    );
    expect(outcome).toStrictEqual({ kind: 'failed', text: INSTANCE_FAILURE_TEXT[failure] });
    expect(await saved(id)).toBeUndefined();
  });

  it.each(['analysis_off', 'job_running', 'rate_limited'] as const)(
    'says a refused start’s %s in its own sentence',
    async (code) => {
      const id = await seededRide();
      const scripted = scriptedJobs();
      scripted.startAnswer = {
        status: code === 'analysis_off' ? 503 : 409,
        body: { error: { code } },
      };
      const outcome = await controller(scripted).ask(id, 'instance-local', () => undefined, live());
      expect(outcome).toStrictEqual({ kind: 'failed', text: INSTANCE_FAILURE_TEXT[code] });
      expect(scripted.streams()).toBe(0);
    },
  );

  it('reads a code it does not know as the general sentence, never the code', () => {
    expect(instanceFailureText('model-on-fire')).toBe(INSTANCE_ASK_TEXT.failed);
    expect(instanceFailureText(undefined)).toBe(INSTANCE_ASK_TEXT.failed);
  });

  it('sends nothing with no instance, and says so', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([succeeded(WRITE_UP)]);
    const outcome = await controller(scripted, { connected: () => false }).ask(
      id,
      'instance-local',
      () => undefined,
      live(),
    );
    expect(outcome).toStrictEqual({ kind: 'failed', text: INSTANCE_ASK_TEXT['no-instance'] });
    expect(scripted.requests).toStrictEqual([]);
  });

  it('offers no source with no instance, and only the instance’s own model with one', () => {
    const scripted = scriptedJobs();
    expect(controller(scripted, { connected: () => false }).availableSources()).toStrictEqual([]);
    expect(controller(scripted).availableSources()).toStrictEqual(['instance-local']);
  });

  it('says what the closed session says, and sends nothing', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs();
    const outcome = await controller(scripted, {
      session: async () => Promise.resolve({ kind: 'closed', text: 'Closed for a reason.' }),
    }).ask(id, 'instance-local', () => undefined, live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: 'Closed for a reason.' });
    expect(scripted.requests).toStrictEqual([]);
  });
});

describe('the pose summary goes only with camera consent (#809’s rule, ADR 0046 D-6)', () => {
  async function filmedRide(): Promise<ActivityId> {
    const id = await seededRide();
    await harness.write(async (store) =>
      store.putSideCameraReport({
        activityId: id,
        athleteId: ATHLETE_A,
        summary: 'Your position was compared across the session.',
        observations: [],
        pose: POSE,
      }),
    );
    return id;
  }

  it('sends it, and says so on the row, with the consent', async () => {
    const id = await filmedRide();
    const scripted = scriptedJobs([succeeded(WRITE_UP)]);
    await controller(scripted, { cameraConsented: () => true }).ask(
      id,
      'instance-local',
      () => undefined,
      live(),
    );
    expect(startedWith(scripted)?.input.pose).toBeDefined();
    expect(JSON.stringify(startedWith(scripted))).toContain('-9.5');
    expect((await saved(id))?.includedPose).toBe(true);
  });

  it('leaves it out without the consent', async () => {
    const id = await filmedRide();
    const scripted = scriptedJobs([succeeded(WRITE_UP)]);
    await controller(scripted).ask(id, 'instance-local', () => undefined, live());
    expect(startedWith(scripted)?.input.pose).toBeUndefined();
    expect(JSON.stringify(startedWith(scripted))).not.toContain('-9.5');
    expect((await saved(id))?.includedPose).toBe(false);
  });
});

describe('resume', () => {
  it('follows a dropped stream again after the last event, with no section twice', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([
      section(1, 'First part.'),
      section(2, 'Second part.'),
      section(3, 'Third part.'),
      succeeded(WRITE_UP),
    ]);
    scripted.cutAfter = 2;
    const seen = recorder();
    const outcome = await controller(scripted).ask(id, 'instance-local', seen.push, live());
    expect(outcome).toStrictEqual({ kind: 'written' });
    const streams = scripted.requests.filter((request) => request.method === 'GET');
    expect(streams.map((request) => request.lastEventId)).toStrictEqual([undefined, '2']);
    expect(seen.views.some((view) => view.phase === 'reconnecting')).toBe(true);
    const shown = seen.views.at(-2)?.sections ?? [];
    expect(shown).toStrictEqual(['First part.', 'Second part.', 'Third part.']);
  });

  it('picks a job up on a page opened again in the same tab, after the last event it saw', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([section(1, 'First part.'), section(2, 'Second part.')]);
    scripted.holdAfter = 2;
    const port = controller(scripted);
    const leaving = new AbortController();
    const first = recorder();
    const asked = port.ask(id, 'instance-local', first.push, leaving.signal);
    await until(() => (first.views.at(-1)?.sections.length ?? 0) === 2);
    leaving.abort();
    expect(await asked).toStrictEqual({ kind: 'detached' });
    expect(port.pendingJob(id)).toBe(true);

    scripted.push(section(3, 'Third part.'), succeeded(WRITE_UP));
    scripted.release();
    const second = recorder();
    expect(await port.followAgain(id, second.push, live())).toStrictEqual({ kind: 'written' });
    const resumed = scripted.requests.filter((request) => request.method === 'GET').at(-1);
    expect(resumed?.lastEventId).toBe('2');
    expect(second.views.find((view) => view.sections.length === 3)?.sections).toStrictEqual([
      'First part.',
      'Second part.',
      'Third part.',
    ]);
    expect(port.pendingJob(id)).toBe(false);
  });

  it('picks a job up after the app is reopened, from its first event, with no section twice', async () => {
    const id = await seededRide();
    const storage = memoryStorage();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    scripted.holdAfter = 1;
    const leaving = new AbortController();
    const asked = controller(scripted, { pending: storage }).ask(
      id,
      'instance-local',
      () => undefined,
      leaving.signal,
    );
    await until(() => storage.items.has(PENDING_JOBS_STORAGE_KEY) && scripted.streams() === 1);
    leaving.abort();
    await asked;
    // Ids only: nothing of the ride and nothing a model wrote.
    expect(storage.items.get(PENDING_JOBS_STORAGE_KEY)).not.toContain('First part');

    scripted.push(section(2, 'Second part.'), succeeded(WRITE_UP));
    scripted.release();
    const reopened = controller(scripted, { pending: storage });
    expect(reopened.pendingJob(id)).toBe(true);
    const seen = recorder();
    expect(await reopened.followAgain(id, seen.push, live())).toStrictEqual({ kind: 'written' });
    expect(scripted.requests.filter((r) => r.method === 'GET').at(-1)?.lastEventId).toBeUndefined();
    expect(seen.views.at(-2)?.sections).toStrictEqual(['First part.', 'Second part.']);
    expect(storage.items.has(PENDING_JOBS_STORAGE_KEY)).toBe(false);
    expect((await saved(id))?.text).toBe(WRITE_UP);
  });

  it('stops following after its tries, keeps the job, and says it carries on', async () => {
    const id = await seededRide();
    // Every stream is cut before its first event, so no event resets the count.
    const scripted = scriptedJobs();
    scripted.cutAfter = 0;
    const waits: number[] = [];
    const port = controller(scripted, {
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        scripted.cutAfter = 0;
        return Promise.resolve();
      },
    });
    const outcome = await port.ask(id, 'instance-local', () => undefined, live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: INSTANCE_ASK_TEXT.dropped });
    expect(waits).toStrictEqual([1, 2, 3, 4, 5, 6].map(reconnectDelayMilliseconds));
    expect(waits).toHaveLength(MAXIMUM_RECONNECTS);
    expect(port.pendingJob(id)).toBe(true);
  });

  it('waits longer between tries, up to fifteen seconds', () => {
    expect([1, 2, 3, 4, 5, 6].map(reconnectDelayMilliseconds)).toStrictEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ]);
  });

  it('forgets a job the instance no longer has, and says so', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs();
    scripted.streamRefusal = { status: 404, body: { error: { code: 'not_found' } } };
    const port = controller(scripted);
    const outcome = await port.ask(id, 'instance-local', () => undefined, live());
    expect(outcome).toStrictEqual({ kind: 'failed', text: INSTANCE_ASK_TEXT.gone });
    expect(port.pendingJob(id)).toBe(false);
  });
});

describe('cancel', () => {
  it('asks the instance to stop, and the follow ends with the cancel’s sentence', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    scripted.holdAfter = 1;
    const port = controller(scripted);
    const seen = recorder();
    const asked = port.ask(id, 'instance-local', seen.push, live());
    await until(() => seen.views.some((view) => view.sections.length === 1));
    await port.cancel(id);
    expect(await asked).toStrictEqual({ kind: 'failed', text: INSTANCE_ASK_TEXT.cancelled });
    expect(scripted.cancelled).toStrictEqual([SCRIPTED_JOB_ID]);
    expect(await saved(id)).toBeUndefined();
    expect(port.pendingJob(id)).toBe(false);
  });

  it('starts nothing when Cancel is pressed before the start is sent', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    scripted.holdAfter = 1;
    let open: (() => void) | undefined;
    const port = controller(scripted, {
      session: async () =>
        new Promise((resolve) => {
          open = () => {
            resolve(scripted.session);
          };
        }),
    });
    const asked = port.ask(id, 'instance-local', () => undefined, live());
    await until(() => open !== undefined);
    await port.cancel(id);
    open?.();
    expect(await asked).toStrictEqual({ kind: 'failed', text: INSTANCE_ASK_TEXT.cancelled });
    // Cancelled before the start was sent: nothing was.
    expect(scripted.requests).toStrictEqual([]);
  });

  it('sends a cancel pressed while the start was on its way, once the instance answers it', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    scripted.holdAfter = 1;
    let answer: (() => void) | undefined;
    const call = scripted.session.channel.call.bind(scripted.session.channel);
    const port = controller(scripted, {
      session: async () =>
        Promise.resolve({
          ...scripted.session,
          channel: {
            ...scripted.session.channel,
            call: async (method, path, options) => {
              if (path === '/v1/analysis/jobs') {
                await new Promise<void>((resolve) => {
                  answer = resolve;
                });
              }
              return call(method, path, options);
            },
          },
        }),
    });
    const asked = port.ask(id, 'instance-local', () => undefined, live());
    await until(() => answer !== undefined);
    await port.cancel(id);
    answer?.();
    expect(await asked).toStrictEqual({ kind: 'failed', text: INSTANCE_ASK_TEXT.cancelled });
    expect(scripted.cancelled).toStrictEqual([SCRIPTED_JOB_ID]);
  });

  it('letting go is not a cancel: the instance is asked nothing', async () => {
    const id = await seededRide();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    scripted.holdAfter = 1;
    const leaving = new AbortController();
    const asked = controller(scripted).ask(id, 'instance-local', () => undefined, leaving.signal);
    await until(() => scripted.streams() === 1);
    leaving.abort();
    expect(await asked).toStrictEqual({ kind: 'detached' });
    expect(scripted.cancelled).toStrictEqual([]);
  });
});

/** Turn the event loop until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('never happened');
}

describe('a ride deleted takes its pending job with it (#1102)', () => {
  /** A job started, then the page left: the note holds it, as after an app closed mid-job. */
  async function leftPending(
    scripted: ScriptedJobs,
    storage: ReturnType<typeof memoryStorage>,
    id: ActivityId,
  ): Promise<void> {
    scripted.holdAfter = 1;
    const leaving = new AbortController();
    const asked = controller(scripted, { pending: storage }).ask(
      id,
      'instance-local',
      () => undefined,
      leaving.signal,
    );
    await until(() => storage.items.has(PENDING_JOBS_STORAGE_KEY) && scripted.streams() === 1);
    leaving.abort();
    await asked;
  }

  it('is never followed again once the library has deleted the ride, through the real store', async () => {
    const id = await seededRide();
    const storage = memoryStorage();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    await leftPending(scripted, storage, id);
    expect(controller(scripted, { pending: storage }).pendingJob(id)).toBe(true);

    const library = forgettingOnDelete(writer, [pendingJobForgetter(storage)]);
    expect(await library.deleteActivity(ATHLETE_A, id)).toBe(true);
    expect(await harness.read(async (reader) => reader.getActivity(ATHLETE_A, id))).toBeUndefined();

    const reopened = controller(scripted, { pending: storage });
    expect(reopened.pendingJob(id)).toBe(false);
    const streamsBefore = scripted.streams();
    expect(await reopened.followAgain(id, () => undefined, live())).toStrictEqual({
      kind: 'detached',
    });
    expect(scripted.streams()).toBe(streamsBefore);
    expect(storage.items.has(PENDING_JOBS_STORAGE_KEY)).toBe(false);
  });

  it('takes only that ride’s entry, and keeps the others', () => {
    const storage = memoryStorage();
    storage.setItem(
      PENDING_JOBS_STORAGE_KEY,
      JSON.stringify({
        gone: { jobId: 'j1', source: 'instance-local', includedPose: false },
        kept: { jobId: 'j2', source: 'instance-local', includedPose: false },
      }),
    );
    pendingJobForgetter(storage).forgetRide('gone' as ActivityId);
    expect(JSON.parse(storage.items.get(PENDING_JOBS_STORAGE_KEY) ?? '{}')).toStrictEqual({
      kept: { jobId: 'j2', source: 'instance-local', includedPose: false },
    });
  });

  it('removes a note it cannot read, and leaves no note where there was none', () => {
    const storage = memoryStorage();
    pendingJobForgetter(storage).forgetRide('any' as ActivityId);
    expect(storage.items.has(PENDING_JOBS_STORAGE_KEY)).toBe(false);
    storage.setItem(PENDING_JOBS_STORAGE_KEY, '{not json');
    pendingJobForgetter(storage).forgetRide('any' as ActivityId);
    expect(storage.items.has(PENDING_JOBS_STORAGE_KEY)).toBe(false);
  });

  it('keeps the job when the delete threw, because the ride may still be there', async () => {
    const id = await seededRide();
    const storage = memoryStorage();
    const scripted = scriptedJobs([section(1, 'First part.')]);
    await leftPending(scripted, storage, id);
    const refusing = forgettingOnDelete(
      {
        listActivitySummaries: async () => Promise.resolve([]),
        getActivity: async () => Promise.resolve(undefined),
        deleteActivity: async () => Promise.reject(new Error('refused')),
      },
      [pendingJobForgetter(storage)],
    );
    await expect(refusing.deleteActivity(ATHLETE_A, id)).rejects.toThrow('refused');
    expect(controller(scripted, { pending: storage }).pendingJob(id)).toBe(true);
  });
});
