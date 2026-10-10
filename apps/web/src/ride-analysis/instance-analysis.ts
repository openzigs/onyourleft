// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A write-up asked of the rider's instance: start, follow, cancel, resume,
 * then screen and save on the device** —
 * [#1102](https://github.com/openzigs/onyourleft/issues/1102),
 * [ADR 0046](../../../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
 * D-3, D-6, D-11, D-12.
 *
 * ## What is built on the device, and what leaves
 *
 * The ride's input is built HERE, by #809's builder (`read-input.ts`), with the
 * camera consent read at the press — so the pose summary goes only with it
 * (the owner's ruling 5 on #795, ADR 0046 D-6) — and sent in the job request
 * (`instance-job.ts` §`analysisJobRequest`). Nothing else of the ride leaves
 * but its own id, and only for a ride already synced (below).
 *
 * ## Naming the ride, only when it is synced (#1229)
 *
 * The instance's history tool says how long before this ride each earlier
 * ride it finds was (ADR 0040 D-2), which needs the ride on the instance. So a
 * start names the ride ({@link syncedRideId}) when this device's sync base
 * says it was synced, and the instance checks it is the rider's.
 *
 * ⚠️ **The rule for a ride not yet synced, decided here: it is written up
 * without relative ages — never synced first, and never refused.** A sync
 * sends the ride's file, its positions and everything that goes with it
 * (`docs/privacy-policy.md` §"An instance you connect to"), which is far more
 * than a write-up sends and is the rider's own press of *Sync now*; a press of
 * the write-up button must not do it for them. And a write-up refused until
 * the ride is synced would refuse every write-up of a rider who never syncs.
 * The same holds for a ride the sync base names and the instance no longer
 * holds (deleted from another device since): the instance refuses the id,
 * and the start is made again without it.
 *
 * ## Never unscreened on the page, never unscreened in the store
 *
 * Every `section` is screened again here (`@onyourleft/analysis`
 * §`screenSavedWriteUp`) before it is handed to the page; one that fails takes
 * back everything shown, exactly as the instance's own `withdrawn` does, and
 * nothing more of that job is shown. The `result`'s write-up is screened
 * again before it is saved, and only a {@link ScreenedWriteUp} reaches
 * {@link RideAnalysisStore.putRideWriteUp}. A write-up the instance passed and
 * this device does not is not kept: the rider is told so, and an earlier
 * write-up of the ride is untouched.
 *
 * ## Resuming
 *
 * - **A dropped stream** is followed again after the last event id this tab
 *   opened (`Last-Event-ID`, inside the seal), after a short wait that grows,
 *   for up to {@link MAXIMUM_RECONNECTS} tries in a row without an event.
 * - **A page left and opened again** in the same tab resumes from the same
 *   id, with the sections already screened held in this controller's memory —
 *   so none is shown twice and none is fetched twice.
 * - **An app closed and opened again** finds the job in
 *   {@link PENDING_JOBS_STORAGE_KEY} — a ride's id and the job's, and nothing
 *   of the ride or of a model's words — and follows it from its first event,
 *   each section keyed by its index, so none is shown twice there either.
 *
 * ## Cancel, and letting go
 *
 * {@link InstanceAnalysisPort.cancel} asks the instance to stop the job; the
 * stream then ends `cancelled` and the rider is told so, above any earlier
 * write-up (#805). An aborted follow is not a cancel: the job carries on on
 * the instance (ADR 0046 D-7), and its result is waiting when the page is
 * opened again — which is how "nothing during a ride" (ADR 0035 D-8) is kept
 * without losing a write-up the rider asked for.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { ActivityId, AthleteId, SyncBaseRecord } from '@onyourleft/store';

import {
  ANALYSIS_AGENT_TEMPLATE_V1,
  passedScreen,
  screenSavedWriteUp,
  type ScreenedWriteUp,
} from '@onyourleft/analysis';

import {
  acknowledgeJob,
  analysisJobRequest,
  cancelJob,
  followJob,
  startJob,
  type InstanceJobSource,
  type JobEvent,
  type JobSession,
} from './instance-job';
import type {
  InstanceAnalysisPort,
  InstanceAskOutcome,
  InstanceJobView,
  RideInProgressWatch,
} from './instance-analysis-port';
import type { RideAnalysisStore } from './ride-analysis';
import { readRideInput } from './read-input';

/** Where this device notes the jobs it started and has not seen end (#1102). Ids only. */
export const PENDING_JOBS_STORAGE_KEY = 'oyl.analysis.pending-jobs.v1';

/**
 * What *Erase everything* does about the pending-job note: removes it. The note
 * holds ride and job ids only, but it is on this device, so an erase takes it
 * (`transfer/erase-device.ts` §`eraseDevice`'s `instanceAnalysis`). Deleting a
 * single ride takes that ride's entry ({@link pendingJobForgetter}). The account
 * export does not include it: it lists only jobs in flight, by id —
 * `docs/privacy-policy.md` says exactly that.
 */
export function instanceAnalysisEraser(storage: Pick<Storage, 'removeItem'> | undefined): {
  forget(): void;
} {
  return {
    forget: () => {
      try {
        storage?.removeItem(PENDING_JOBS_STORAGE_KEY);
      } catch {
        // Storage refused: nothing more this device can do about it.
      }
    },
  };
}

/**
 * What deleting a ride does about the pending-job note: takes that ride's entry
 * out, so a job asked about a ride that is gone is never followed again — a
 * page opened afterwards finds nothing pending, and {@link
 * InstanceAnalysisPort.followAgain} answers `detached`. Handed to the library's
 * delete by `main.tsx` (`library/store-port.ts` §`forgettingOnDelete`).
 *
 * A note that cannot be read is removed whole: it could not be resumed from
 * anyway (`readPending` reads it as empty).
 */
export function pendingJobForgetter(storage: PendingJobStorage | undefined): {
  forgetRide(activityId: ActivityId): void;
} {
  return {
    forgetRide: (activityId) => {
      if (storage === undefined) return;
      try {
        const noted = storage.getItem(PENDING_JOBS_STORAGE_KEY);
        if (noted === null) return;
        const parsed = JSON.parse(noted) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          storage.removeItem(PENDING_JOBS_STORAGE_KEY);
          return;
        }
        const jobs = { ...(parsed as Record<string, unknown>) };
        if (!Object.hasOwn(jobs, activityId)) return;
        delete jobs[activityId];
        if (Object.keys(jobs).length === 0) {
          storage.removeItem(PENDING_JOBS_STORAGE_KEY);
        } else {
          storage.setItem(PENDING_JOBS_STORAGE_KEY, JSON.stringify(jobs));
        }
      } catch {
        try {
          storage.removeItem(PENDING_JOBS_STORAGE_KEY);
        } catch {
          // Storage refused: nothing more this device can do about it.
        }
      }
    },
  };
}

/** The most pending jobs noted at once: one a ride, and a rider asks about few at a time. */
const MAXIMUM_PENDING_JOBS = 16;

/** Tries in a row, with no event between them, before the page stops following. */
export const MAXIMUM_RECONNECTS = 6;

/** The wait before the `attempt`th reconnect: 1 s, doubling, at most 15 s. */
export function reconnectDelayMilliseconds(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 15_000);
}

/**
 * What the rider is told, by how a job ended or never started. App text
 * under ADR 0030's vocabularies (the source scan reads this file), each one
 * saying nothing was kept, and none carrying anything the instance or its
 * model wrote. Keyed by the instance's own codes (#1095, #1096, #1098).
 */
export const INSTANCE_FAILURE_TEXT = {
  // Refusals of the start (#1095).
  analysis_off:
    'Your instance has no model set up for write-ups, so nothing was sent and nothing was kept. Whoever runs it can set one up.',
  job_running:
    'Your instance is already writing up a ride for you, and writes one at a time. Ask again once it has finished; nothing was kept.',
  rate_limited:
    'You have asked your instance for many write-ups in the last hour, so it is not taking another yet. Nothing was kept; try again later.',
  validation_failed:
    'Your instance could not read this ride as this app sent it, so nothing was kept. Updating the app or the instance may help.',
  // How a job ended (#1095, #1096, #1098).
  'out-of-steps':
    'The model took more steps than your instance allows, so the write-up was stopped and nothing was kept.',
  'out-of-tool-calls':
    'The model looked up your records more times than your instance allows, so the write-up was stopped and nothing was kept.',
  'out-of-time':
    'The model took too long, so the write-up was stopped and nothing was kept. A smaller or faster model may finish in time.',
  'out-of-tokens':
    'The write-up would have sent the model more text than your instance allows, so it was stopped and nothing was kept.',
  'model-without-tools':
    'The model on your instance cannot use tools, which this write-up needs, so nothing was written. Whoever runs it can choose a model that supports tool calling.',
  'model-not-local':
    'Your instance’s model address did not lead to its own machine or network, so nothing was sent to it and nothing was kept.',
  'model-unreachable':
    'Your instance could not reach its model, so nothing was kept. Check that the model server is running, then try again.',
  'model-refused': 'The model server refused the request, so nothing was kept.',
  'model-error': 'The model server had an error, so nothing was kept. Try again later.',
  'model-cut-off':
    'The model’s answer was cut off before it finished, so nothing was kept. A model with a larger context may do better.',
  'model-malformed': 'The model server sent an answer this app cannot read, so nothing was kept.',
  local_unavailable:
    'Your instance has no model of its own set up, so nothing was sent and nothing was kept.',
  hosted_unavailable:
    'The service your instance sends write-ups to is not available to you now, so nothing was sent and nothing was kept.',
  interrupted:
    'Your instance stopped while it was writing this up, so nothing was kept. Ask again to start over.',
  'engine-error': 'Something went wrong on your instance, so nothing was kept. Try again later.',
  withheld:
    'The write-up did not pass the checks on what may be shown, such as the angle of a joint, which this app does not show. None of it was kept.',
} as const;

/** Why a job ended, on this device's side, with nothing saved. */
export const INSTANCE_ASK_TEXT = {
  'no-instance':
    'This device is not signed in to an instance, so nothing was sent and nothing was kept.',
  'not-read':
    'This ride could not be read on this device, so nothing was sent and nothing was kept.',
  unreachable:
    'Your instance could not be reached, so nothing is known to have been sent and nothing was kept.',
  refused:
    'Your instance would not take the request, so nothing was kept. Signing in to it again may help.',
  'withheld-on-device':
    'The write-up your instance sent did not pass this app’s checks on what may be shown, so none of it was kept. Any earlier write-up of this ride is unchanged.',
  'not-saved':
    'The write-up could not be saved on this device, so nothing was kept. Opening this ride again tries once more.',
  gone: 'Your instance no longer has this write-up — it keeps a job for seven days — so nothing was kept. Ask again to start over.',
  dropped:
    'The connection to your instance kept dropping, so this page stopped following the write-up. Your instance carries on, and it is shown when you open this ride again.',
  cancelled:
    'The write-up was cancelled and nothing was kept. Your instance stops it at its next step.',
  failed: 'The write-up did not finish, so nothing was kept.',
} as const;

type InstanceFailureCode = keyof typeof INSTANCE_FAILURE_TEXT;

/** The sentence for an instance's code, or the general one for a code this build does not know. */
export function instanceFailureText(code: string | undefined): string {
  return code !== undefined && code in INSTANCE_FAILURE_TEXT
    ? INSTANCE_FAILURE_TEXT[code as InstanceFailureCode]
    : INSTANCE_ASK_TEXT.failed;
}

/** Where pending jobs are noted: `localStorage` in production. */
export interface PendingJobStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One pending job, as noted. Ids and two facts about what was sent — nothing of the ride. */
interface PendingJob {
  readonly jobId: string;
  readonly source: InstanceJobSource;
  readonly includedPose: boolean;
}

/** @see createInstanceAnalysis */
export interface InstanceAnalysisOptions {
  readonly store: RideAnalysisStore;
  readonly athleteId: AthleteId;
  /** Whether this device holds a sign-in to an instance. Reads storage only. */
  readonly connected: () => boolean;
  /** The sealed session a job runs under, opened at the press — `instance-port.ts` §`heldSealedSession`. */
  readonly session: () => Promise<JobSession>;
  /** Whether the rider's camera consent covers the pose summary, read at the press. */
  readonly cameraConsented: () => boolean;
  /** When a write-up is saved. */
  readonly now: () => UnixSeconds;
  /** Where pending jobs are noted; absent, they are held for this tab only. */
  readonly pending?: PendingJobStorage;
  /** The wait between reconnects, ending early when `signal` aborts. A timer unless a test says otherwise. */
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** The recording, so the page stops following while a ride is recorded. */
  readonly ride?: RideInProgressWatch;
  /**
   * This device's sync base (#776), read at the press to name a synced ride
   * in the start (#1229). Absent, no ride is named.
   */
  readonly syncBase?: SyncBaseReader;
}

/** What {@link syncedRideId} reads: `ActivityStore.listSyncBase`. */
export interface SyncBaseReader {
  listSyncBase(owner: AthleteId): Promise<readonly SyncBaseRecord[]>;
}

/**
 * The ride's id, when this device has synced the ride with its instance — an
 * `activity` row of the sync base for it — and `undefined` otherwise,
 * including when the base cannot be read: a write-up does not fail for want
 * of relative ages (#1229, the file comment).
 */
export async function syncedRideId(
  syncBase: SyncBaseReader | undefined,
  owner: AthleteId,
  activityId: ActivityId,
): Promise<string | undefined> {
  if (syncBase === undefined) return undefined;
  try {
    const rows = await syncBase.listSyncBase(owner);
    return rows.some((row) => row.kind === 'activity' && row.activityId === activityId)
      ? activityId
      : undefined;
  } catch {
    return undefined;
  }
}

/** A timer, ended early by `signal`. */
function platformWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(done, milliseconds);
    function done(): void {
      globalThis.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/** What this tab holds of a followed job: enough to resume it without showing a section twice. */
interface Followed {
  lastEventId?: string;
  step?: number;
  sections: Map<number, ScreenedWriteUp>;
  withdrawn: boolean;
}

const DETACHED: InstanceAskOutcome = { kind: 'detached' };

function failed(text: string): InstanceAskOutcome {
  return { kind: 'failed', text };
}

/** The instance-side write-up. @see the file comment. */
export function createInstanceAnalysis(options: InstanceAnalysisOptions): InstanceAnalysisPort {
  const { store, athleteId: owner } = options;
  const wait = options.wait ?? platformWait;
  const template = ANALYSIS_AGENT_TEMPLATE_V1;
  /** Pending jobs, when there is no storage to note them in. */
  const inMemory = new Map<string, PendingJob>();
  /** What this tab has followed, by ride. */
  const followed = new Map<string, Followed>();
  /** Rides whose job is being asked for, and has no id from the instance yet. */
  const starting = new Set<string>();
  /** Of those, the ones the rider cancelled before the instance had given it an id. */
  const cancelledEarly = new Set<string>();

  const readPending = (): Map<string, PendingJob> => {
    if (options.pending === undefined) return inMemory;
    try {
      const parsed = JSON.parse(
        options.pending.getItem(PENDING_JOBS_STORAGE_KEY) ?? '{}',
      ) as unknown;
      const read = new Map<string, PendingJob>();
      if (typeof parsed !== 'object' || parsed === null) return read;
      for (const [ride, value] of Object.entries(parsed as Record<string, unknown>)) {
        const job = value as Partial<PendingJob> | null;
        if (
          typeof job?.jobId === 'string' &&
          (job.source === 'instance-local' || job.source === 'instance-hosted') &&
          typeof job.includedPose === 'boolean'
        ) {
          read.set(ride, { jobId: job.jobId, source: job.source, includedPose: job.includedPose });
        }
      }
      return read;
    } catch {
      return new Map();
    }
  };

  const writePending = (jobs: Map<string, PendingJob>): void => {
    if (options.pending === undefined) return;
    try {
      if (jobs.size === 0) {
        options.pending.removeItem(PENDING_JOBS_STORAGE_KEY);
      } else {
        options.pending.setItem(PENDING_JOBS_STORAGE_KEY, JSON.stringify(Object.fromEntries(jobs)));
      }
    } catch {
      // Storage full or refused: the job is followed for this tab only.
    }
  };

  const remember = (activityId: ActivityId, job: PendingJob): void => {
    const jobs = readPending();
    jobs.delete(activityId);
    jobs.set(activityId, job);
    while (jobs.size > MAXIMUM_PENDING_JOBS) {
      const oldest = jobs.keys().next().value;
      if (oldest === undefined) break;
      jobs.delete(oldest);
    }
    writePending(jobs);
  };

  /** The job ended, here: nothing of it is held any longer. */
  const forget = (activityId: ActivityId): void => {
    const jobs = readPending();
    jobs.delete(activityId);
    writePending(jobs);
    followed.delete(activityId);
  };

  const viewOf = (state: Followed, phase: InstanceJobView['phase']): InstanceJobView => ({
    phase,
    ...(state.step === undefined ? {} : { step: state.step }),
    sections: state.withdrawn
      ? []
      : [...state.sections.entries()].sort(([a], [b]) => a - b).map(([, text]) => text),
    withdrawn: state.withdrawn,
  });

  /** A job's `result`: screen, save, acknowledge — or say why not. */
  async function ended(
    activityId: ActivityId,
    job: PendingJob,
    result: Extract<JobEvent, { kind: 'result' }>,
    session: Extract<JobSession, { kind: 'open' }>,
    state: Followed,
    view: (view: InstanceJobView) => void,
  ): Promise<InstanceAskOutcome> {
    switch (result.status) {
      case 'cancelled':
        forget(activityId);
        return failed(INSTANCE_ASK_TEXT.cancelled);
      case 'withheld':
        forget(activityId);
        return failed(INSTANCE_FAILURE_TEXT.withheld);
      case 'failed':
        forget(activityId);
        return failed(instanceFailureText(result.failure));
      case 'succeeded':
        break;
    }
    // ADR 0046 D-3: screened again on this device before it is kept.
    const screened = screenSavedWriteUp(result.writeUp ?? '');
    if (result.writeUp === undefined || !passedScreen(screened)) {
      forget(activityId);
      return failed(INSTANCE_ASK_TEXT['withheld-on-device']);
    }
    view(viewOf(state, 'saving'));
    try {
      await store.putRideWriteUp({
        activityId,
        athleteId: owner,
        text: screened,
        templateId: template.id,
        templateVersion: template.version,
        source: job.source,
        includedPose: job.includedPose,
        missingSections: [],
        writtenAt: options.now(),
      });
    } catch {
      // Still pending: opening the ride again replays the job and tries again.
      followed.delete(activityId);
      return failed(INSTANCE_ASK_TEXT['not-saved']);
    }
    // Saved: the instance may drop the job's events (ADR 0046 D-12).
    await acknowledgeJob(session, job.jobId);
    forget(activityId);
    return { kind: 'written' };
  }

  /** Follow `job` until it ends, the page lets go, or the connection gives up. */
  async function follow(
    activityId: ActivityId,
    job: PendingJob,
    session: Extract<JobSession, { kind: 'open' }>,
    view: (view: InstanceJobView) => void,
    signal: AbortSignal,
  ): Promise<InstanceAskOutcome> {
    let state = followed.get(activityId);
    if (state === undefined) {
      state = { sections: new Map(), withdrawn: false };
      followed.set(activityId, state);
    }
    const held = state;
    let tries = 0;
    view(viewOf(held, 'streaming'));
    for (;;) {
      if (signal.aborted) return DETACHED;
      let result: Extract<JobEvent, { kind: 'result' }> | undefined;
      const outcome = await followJob(
        session,
        job.jobId,
        held.lastEventId,
        (id, event) => {
          held.lastEventId = id;
          tries = 0;
          switch (event.kind) {
            case 'progress':
              held.step = event.step;
              break;
            case 'section': {
              if (held.withdrawn || held.sections.has(event.index)) break;
              const screened = screenSavedWriteUp(event.text);
              if (passedScreen(screened)) {
                held.sections.set(event.index, screened);
              } else {
                // One section this device will not show takes back all of them.
                held.sections.clear();
                held.withdrawn = true;
              }
              break;
            }
            case 'withdrawn':
              held.sections.clear();
              held.withdrawn = true;
              break;
            case 'result':
              result = event;
              return;
          }
          view(viewOf(held, 'streaming'));
        },
        signal,
      );
      if (result !== undefined) {
        return ended(activityId, job, result, session, held, view);
      }
      if (signal.aborted) return DETACHED;
      if (outcome.kind === 'gone') {
        forget(activityId);
        return failed(INSTANCE_ASK_TEXT.gone);
      }
      if (outcome.kind === 'refused') return failed(INSTANCE_ASK_TEXT.refused);
      tries += 1;
      if (tries > MAXIMUM_RECONNECTS) return failed(INSTANCE_ASK_TEXT.dropped);
      view(viewOf(held, 'reconnecting'));
      await wait(reconnectDelayMilliseconds(tries), signal);
    }
  }

  /** A start, then {@link follow}: see {@link InstanceAnalysisPort.ask}. */
  async function askNow(
    activityId: ActivityId,
    source: InstanceJobSource,
    view: (view: InstanceJobView) => void,
    signal: AbortSignal,
  ): Promise<InstanceAskOutcome> {
    view({ phase: 'starting', sections: [], withdrawn: false });
    const input = await readRideInput(store, owner, activityId, {
      templateVersion: template.version,
      cameraConsented: options.cameraConsented(),
    });
    if (input === undefined) return failed(INSTANCE_ASK_TEXT['not-read']);
    const session = await options.session();
    if (session.kind === 'closed') return failed(session.text);
    if (cancelledEarly.delete(activityId)) return failed(INSTANCE_ASK_TEXT.cancelled);
    const rideId = await syncedRideId(options.syncBase, owner, activityId);
    let started = await startJob(
      session,
      analysisJobRequest(input, template.version, source, rideId),
    );
    // A ride the instance no longer holds: the same start, naming no ride.
    if (started.kind === 'refused' && started.rideRefused === true && rideId !== undefined) {
      started = await startJob(session, analysisJobRequest(input, template.version, source));
    }
    if (started.kind === 'unreachable') return failed(INSTANCE_ASK_TEXT.unreachable);
    if (started.kind === 'refused') {
      return failed(
        started.code === undefined ? INSTANCE_ASK_TEXT.refused : instanceFailureText(started.code),
      );
    }
    const job: PendingJob = {
      jobId: started.jobId,
      source,
      includedPose: input.pose !== undefined,
    };
    remember(activityId, job);
    // A cancel pressed while the job was being queued is sent now.
    if (cancelledEarly.delete(activityId)) await cancelJob(session, job.jobId);
    return follow(activityId, job, session, view, signal);
  }

  return {
    ...(options.ride === undefined ? {} : { ride: options.ride }),

    connected: () => options.connected(),

    availableSources(): readonly InstanceJobSource[] {
      // ⚠️ `instance-hosted` is not offered yet: its consent (#1104 B1) is not
      // approved, and a path is not shipped ahead of its disclosure (ADR 0029).
      return options.connected() ? ['instance-local'] : [];
    },

    pendingJob: (activityId) => readPending().has(activityId),

    async ask(activityId, source, view, signal) {
      if (!options.connected()) return failed(INSTANCE_ASK_TEXT['no-instance']);
      followed.delete(activityId);
      cancelledEarly.delete(activityId);
      starting.add(activityId);
      try {
        return await askNow(activityId, source, view, signal);
      } finally {
        starting.delete(activityId);
        cancelledEarly.delete(activityId);
      }
    },

    async followAgain(activityId, view, signal) {
      const job = readPending().get(activityId);
      if (job === undefined) return DETACHED;
      const session = await options.session();
      if (session.kind === 'closed') return failed(session.text);
      return follow(activityId, job, session, view, signal);
    },

    async cancel(activityId) {
      const job = readPending().get(activityId);
      if (job === undefined) {
        // Still being queued: the cancel is sent as soon as the instance names the job.
        if (starting.has(activityId)) cancelledEarly.add(activityId);
        return;
      }
      const session = await options.session();
      if (session.kind === 'closed') return;
      await cancelJob(session, job.jobId);
    },
  };
}
