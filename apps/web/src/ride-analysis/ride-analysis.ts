// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The post-ride ask: one press, one run, one saved write-up** —
 * [#804](https://github.com/openzigs/onyourleft/issues/804), epic #795.
 *
 * The controller between the ride page's press and the pieces #795 built: it
 * reads the ride, builds its input (`input.ts`, #809), runs the agent
 * (`runner.ts`, #811) through the step port of the source the rider chose,
 * and — only when the run ends `written` — saves the screened write-up
 * (#798) with the ride, **replacing** the one it had (#800; the owner's
 * ruling 7). Everything else leaves an earlier write-up exactly as it was.
 *
 * ## Nothing is sent without a press
 *
 * Constructing this reads nothing and sends nothing; neither does
 * {@link RideAnalysisPort.availableSources}, which only asks whether a port
 * COULD be built. The one path to a model is
 * {@link RideAnalysisPort.askForRideWriteUp}, and the one caller of that is
 * the button on a ride's page (`RideWriteUpControl.tsx`).
 * `own-computer-step.test.ts` §"sends nothing without a press" holds that no
 * other production module starts a run, and `ride-analysis.test.ts` counts
 * the transport's calls across saving a ride, saving a report and opening
 * the page.
 *
 * ## Which source, in which order
 *
 * The owner's ruling 7: the rider's own computer is offered first when both
 * it and a hosted model are set up. {@link RideAnalysisOptions.hosted} is
 * absent in production until #803 builds a hosted STEP port — the hosted
 * connection check (#518) sends a fixed question and cannot carry a ride —
 * so today the list is the computer or nothing.
 *
 * ## The pose summary goes only with camera consent
 *
 * The owner's ruling 5: camera consent is required only when pose data is
 * included. The consent is read at the press ({@link RideAnalysisOptions.cameraConsented})
 * and handed to `input.ts`, which leaves the summary out without it — so a
 * rider with no side-camera session, or one who has not agreed to the camera
 * since the app was opened, still gets a write-up, of the ride alone.
 *
 * ## Only screened text is saved
 *
 * {@link RideAnalysisStore.putRideWriteUp} takes a {@link ScreenedRideWriteUp},
 * whose text is the screen's brand: a string that did not come out of
 * `write-up-screen.ts` §`screenWriteUp` does not compile there.
 *
 * ## Reaches no trainer and no picture
 *
 * Every module in this directory is walked by `runner-safety.test.ts` (no
 * trainer) and `camera/no-picture-reachable.test.ts` (no picture). That is why
 * the step port arrives as a function rather than being built here: the one
 * `fetch` lives in `camera/analysis-transport.ts`, which builds pictures by
 * design, so `main.tsx` builds the port and hands it in.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  AthleteId,
  AthleteRecord,
  LapRecord,
  RideWriteUpRecord,
  RouteId,
  RouteRecord,
  SideCameraReportRecord,
  StreamSet,
} from '@onyourleft/store';

import type { SideSessionSummary } from '../camera/side-session-summary';
import type { ScreenedWriteUp } from '../camera/write-up-screen';
import { rideAnalysisInput, type RideAnalysisInput } from './input';
import type {
  AskOutcome,
  AskProgress,
  RideAnalysisPort,
  RideWriteUpSource,
} from './ride-analysis-port';
import {
  RUN_FAILURE_TEXT,
  runAnalysis,
  type RunFailure,
  type RunnerClock,
  type RunnerDelay,
  type RunOptions,
} from './runner';
import { CURRENT_ANALYSIS_TEMPLATE, type AnalysisTemplate } from './template';

/**
 * The step port, as the runner takes it. ⚠️ **Named through the runner, not
 * imported from `model-step-port.ts`**, and that is the point rather than a
 * way round a gate: `camera/analysis-safety.test.ts` holds that only the
 * runner, the port and its builder import a module that carries a model's
 * reply, and this module never sees one — it hands the port to the runner
 * and reads back only the run's outcome, whose write-up is already
 * screened. It writes to the store, so it must stay outside that set.
 */
type ModelStepPort = RunOptions['port'];

/** A write-up record whose text passed the screen (#798). */
export type ScreenedRideWriteUp = Omit<RideWriteUpRecord, 'text'> & {
  readonly text: ScreenedWriteUp;
};

/** What the ask reads and writes. `ActivityStore` satisfies it as it stands. */
export interface RideAnalysisStore {
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  getStreamSet(owner: AthleteId, id: ActivityId): Promise<StreamSet | undefined>;
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  listLaps(owner: AthleteId, id: ActivityId): Promise<LapRecord[]>;
  getRoute(owner: AthleteId, id: RouteId): Promise<RouteRecord | undefined>;
  getSideCameraReport(
    owner: AthleteId,
    id: ActivityId,
  ): Promise<SideCameraReportRecord | undefined>;
  /** Replaces the ride's write-up. Only ever handed screened text. */
  putRideWriteUp(record: ScreenedRideWriteUp): Promise<void>;
}

/** @see createRideAnalysis */
export interface RideAnalysisOptions {
  readonly store: RideAnalysisStore;
  readonly athleteId: AthleteId;
  /**
   * The step port to the rider's own computer, looked up again at every call
   * so switching it off stops the next ask — `undefined` when none is set up
   * and switched on. `camera/analysis-transport.ts` §`riderModelStepSource`.
   */
  readonly computer: () => ModelStepPort | undefined;
  /** The hosted model's step port, the same way. #803's; absent until then. */
  readonly hosted?: () => ModelStepPort | undefined;
  /**
   * Whether this is the Android shell, where a request to the rider's
   * computer cannot be aborted from the web side (spike 0016 §2.1) — which
   * changes what a cancel can honestly say.
   */
  readonly nativeShell: boolean;
  /** Whether the rider's camera consent covers the pose summary, read at the press (ruling 5). */
  readonly cameraConsented: () => boolean;
  readonly clock: RunnerClock;
  /** When a write-up is saved. */
  readonly now: () => UnixSeconds;
  /** {@link CURRENT_ANALYSIS_TEMPLATE} unless a test says otherwise. */
  readonly template?: AnalysisTemplate;
}

/** Why an ask ended with nothing saved, beyond a run's own failures. */
export type AskFailure =
  | RunFailure
  /** The source asked for is not set up and switched on any more. */
  | 'no-source'
  /** The ride could not be read, or is not this rider's. */
  | 'not-read'
  /** The run wrote a write-up and the store would not keep it. */
  | 'not-saved';

/** Where a cancelled run was going, which decides what a cancel may claim. */
export type CancelPath = 'computer-browser' | 'computer-shell' | 'hosted';

/**
 * What a cancel says, by path. ⚠️ **They differ on purpose**: in a browser a
 * cancel closes the connection, which stops generation on the common local
 * servers; inside the Android shell the native request cannot be aborted, so
 * the rider's computer may carry on; and a hosted service has already been
 * sent the ride's numbers by the time anything could be cancelled.
 */
export const CANCELLED_TEXT: Readonly<Record<CancelPath, string>> = {
  'computer-browser':
    'The write-up was cancelled and nothing was kept. The connection to your computer was closed, which stops most model servers.',
  'computer-shell':
    'The write-up was cancelled and nothing was kept. Your computer may carry on working on it for a while; whatever it answers is ignored.',
  hosted:
    'The write-up was cancelled and nothing was kept. The service you chose may already have this ride’s numbers, and may carry on for a while; whatever it answers is ignored.',
};

/**
 * What every other failure says: the runner's own sentence, or one of these.
 * Each says nothing was kept, because a rider who had a write-up still has
 * it. None carries a key, an address, a model name or a model's words.
 */
export const ASK_FAILURE_TEXT: Readonly<Record<Exclude<AskFailure, 'cancelled'>, string>> = {
  'out-of-time': RUN_FAILURE_TEXT['out-of-time'],
  'out-of-tokens': RUN_FAILURE_TEXT['out-of-tokens'],
  'too-few-sections': RUN_FAILURE_TEXT['too-few-sections'],
  'no-summary': RUN_FAILURE_TEXT['no-summary'],
  'withheld-by-screen': RUN_FAILURE_TEXT['withheld-by-screen'],
  'no-source':
    'That model is not set up and switched on any more, so nothing was sent and nothing was kept.',
  'not-read':
    'This ride could not be read on this device, so nothing was sent and nothing was kept.',
  'not-saved':
    'The write-up could not be saved on this device, so nothing was kept. Any earlier write-up of this ride is unchanged.',
};

/** The sentence for `why` on `path`. */
export function askFailureText(why: AskFailure, path: CancelPath): string {
  return why === 'cancelled' ? CANCELLED_TEXT[path] : ASK_FAILURE_TEXT[why];
}

/** The platform's clock and timer as the runner wants them. */
export function platformRunnerClock(): RunnerClock {
  return {
    now: () => globalThis.performance.now(),
    delay(milliseconds: number): RunnerDelay {
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
      const elapsed = new Promise<void>((resolve) => {
        timer = globalThis.setTimeout(resolve, milliseconds);
      });
      return {
        elapsed,
        cancel: () => {
          globalThis.clearTimeout(timer);
        },
      };
    },
  };
}

/** A pose summary as the input reads it, copied field by field from the stored one. */
function poseFrom(report: SideCameraReportRecord | undefined): SideSessionSummary | undefined {
  const pose = report?.pose;
  if (pose === null || pose === undefined) {
    return undefined;
  }
  return {
    source: pose.source,
    differences: { ...pose.differences },
    posed: pose.posed,
    noRider: pose.noRider,
    unreadable: pose.unreadable,
  };
}

/** The post-ride ask. @see the file comment. */
export function createRideAnalysis(options: RideAnalysisOptions): RideAnalysisPort {
  const { store, athleteId: owner, clock } = options;
  const template = options.template ?? CURRENT_ANALYSIS_TEMPLATE;

  const portFor = (source: RideWriteUpSource): ModelStepPort | undefined =>
    source === 'computer' ? options.computer() : options.hosted?.();

  const pathOf = (source: RideWriteUpSource): CancelPath =>
    source === 'hosted' ? 'hosted' : options.nativeShell ? 'computer-shell' : 'computer-browser';

  return {
    availableSources(): readonly RideWriteUpSource[] {
      const order: readonly RideWriteUpSource[] = ['computer', 'hosted'];
      return order.filter((source) => portFor(source) !== undefined);
    },

    async askForRideWriteUp(
      activityId: ActivityId,
      source: RideWriteUpSource,
      signal: AbortSignal,
      progress?: (progress: AskProgress) => void,
    ): Promise<AskOutcome> {
      const failed = (why: AskFailure): AskOutcome => ({
        kind: 'failed',
        text: askFailureText(why, pathOf(source)),
      });
      const port = portFor(source);
      if (port === undefined) {
        return failed('no-source');
      }
      if (signal.aborted) {
        return failed('cancelled');
      }

      let input: RideAnalysisInput;
      try {
        const ride = await store.getActivity(owner, activityId);
        if (ride === undefined) {
          return failed('not-read');
        }
        const [streams, athlete, laps, report, route] = await Promise.all([
          store.getStreamSet(owner, activityId),
          store.getAthlete(owner),
          store.listLaps(owner, activityId),
          store.getSideCameraReport(owner, activityId),
          ride.routeId === undefined ? undefined : store.getRoute(owner, ride.routeId),
        ]);
        const pose = poseFrom(report);
        input = rideAnalysisInput(ride, streams, athlete, {
          templateVersion: template.version,
          laps,
          ...(route === undefined ? {} : { route: route.profile }),
          ...(pose === undefined ? {} : { pose }),
          cameraConsented: options.cameraConsented(),
        });
      } catch {
        // Nothing of the error is read: the store's messages name records.
        return failed('not-read');
      }

      const outcome = await runAnalysis(input, {
        port,
        clock,
        signal,
        template,
        ...(progress === undefined ? {} : { progress }),
      });
      // A cancel that landed after the last reply is already `cancelled` here:
      // the runner checks the signal where it makes a `written` outcome.
      if (outcome.kind === 'failed') {
        return failed(outcome.why);
      }
      try {
        await store.putRideWriteUp({
          activityId,
          athleteId: owner,
          text: outcome.writeUp,
          templateId: template.id,
          templateVersion: outcome.templateVersion,
          source,
          includedPose: input.pose !== undefined,
          // The runner counts sections from one; the store from nought.
          missingSections: outcome.missingSections.map((section) => section - 1),
          writtenAt: options.now(),
        });
      } catch {
        return failed('not-saved');
      }
      return { kind: 'written' };
    },
  };
}
