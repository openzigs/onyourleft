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
 * built by `main.tsx` since #803 (`hosted-step.ts` §`hostedStepPort`), and
 * is offered only while the rider has turned the hosted model on since the
 * app was opened and a service is saved.
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
import type { ActivityId, AthleteId, RideWriteUpRecord } from '@onyourleft/store';

import type { ScreenedWriteUp } from '@onyourleft/analysis';
import type { HistoryPassage, HistorySource } from '@onyourleft/analysis';
import { maskForHosted, type MaskingGuard } from '@onyourleft/analysis';
import type { RideAnalysisInput } from '@onyourleft/analysis';
import { readRideInput, type RideInputStore } from './read-input';
import type {
  AskOutcome,
  AskProgress,
  HostedPreview,
  HostedPreviewStep,
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
} from '@onyourleft/analysis';
import { CURRENT_ANALYSIS_TEMPLATE, type AnalysisTemplate } from '@onyourleft/analysis';

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
export interface RideAnalysisStore extends RideInputStore {
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
  /**
   * The hosted model's step port, the same way (#803) — `undefined` unless
   * the hosted model is turned on and a service is saved. Absent where there
   * is no camera controller to hold that consent.
   */
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
  /**
   * The rider's masking guard, for the preview (#839) — the same reader the
   * hosted transport is handed in `main.tsx`, so the preview masks with what
   * the request will be masked with. Absent, there is no preview to show.
   */
  readonly hostedGuard?: () => Promise<MaskingGuard>;
  /**
   * The rider's instance, for their history (#835, ADR 0040 D-8) — looked up
   * again at every ask, `undefined` when no instance is connected. Absent or
   * `undefined`, a run has no history step and says nothing about one: a rider
   * with no instance loses nothing (ADR 0036 D-3(a)). ⚠️ `main.tsx` hands none
   * until #777's transport exists — see `history.ts` §"What this module does
   * NOT do".
   */
  readonly history?: () => HistorySource | undefined;
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

/**
 * What a written write-up says about the rider's history, when it has
 * something to say (#835, ADR 0040 D-8): the instance was asked and could not
 * be used, or the model's note on it could not be. Nothing is said when no
 * instance is connected, or the run was on a hosted model, which is never
 * sent history (D-9) — neither is a failure.
 */
export const HISTORY_NOTICE_TEXT = {
  unreachable:
    'Your instance could not be reached, so this write-up does not look back at your earlier rides.',
  failed:
    'The model could not compare this ride with your earlier rides, so this write-up leaves that out.',
} as const;

/** Why a preview shows nothing (#839). Nothing is sent either way. */
export type PreviewFailure = 'not-read' | 'not-masked';

/** What a preview that shows nothing says. */
export const PREVIEW_FAILURE_TEXT: Readonly<Record<PreviewFailure, string>> = {
  'not-read': 'This ride could not be read on this device, so there is nothing to show.',
  'not-masked':
    'Your list of words to mask, or your privacy zones, could not be read on this device, so nothing can be shown or sent.',
};

/**
 * Every step a run sends before any reply, in the order it sends them — a
 * note per section, then one on position when the template builds one. The
 * runner's own order (`runner.ts` §`runAnalysis`); `hosted-mask-reachable.test.ts`
 * holds the two equal by comparing this with what a real run sent.
 */
function stepsBeforeAnyReply(
  input: RideAnalysisInput,
  template: AnalysisTemplate,
): { readonly system: string; readonly user: string }[] {
  const [sectionStep, positionStep] = template.steps;
  const prompts = input.sections.map(({ index }) => sectionStep.prompt(input, index));
  const position = positionStep.prompt(input);
  return position === undefined ? prompts : [...prompts, position];
}

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

/** The post-ride ask. @see the file comment. */
export function createRideAnalysis(options: RideAnalysisOptions): RideAnalysisPort {
  const { store, athleteId: owner, clock } = options;
  const template = options.template ?? CURRENT_ANALYSIS_TEMPLATE;

  const portFor = (source: RideWriteUpSource): ModelStepPort | undefined =>
    source === 'computer' ? options.computer() : options.hosted?.();

  const pathOf = (source: RideWriteUpSource): CancelPath =>
    source === 'hosted' ? 'hosted' : options.nativeShell ? 'computer-shell' : 'computer-browser';

  /** The ride's input, or `undefined` when the ride cannot be read or is not this rider's. */
  const readInput = (activityId: ActivityId): Promise<RideAnalysisInput | undefined> =>
    readRideInput(store, owner, activityId, {
      templateVersion: template.version,
      cameraConsented: options.cameraConsented(),
    });

  /** Held for as long as this controller — the tab — is: the consent's own lifetime. */
  let previewSeen = false;

  return {
    availableSources(): readonly RideWriteUpSource[] {
      const order: readonly RideWriteUpSource[] = ['computer', 'hosted'];
      return order.filter((source) => portFor(source) !== undefined);
    },

    hostedPreviewSeen(): boolean {
      return previewSeen;
    },

    async previewHostedRequest(activityId: ActivityId): Promise<HostedPreview> {
      const input = await readInput(activityId);
      if (input === undefined) {
        return { kind: 'failed', text: PREVIEW_FAILURE_TEXT['not-read'] };
      }
      let guard: MaskingGuard;
      try {
        if (options.hostedGuard === undefined) {
          throw new Error('no guard');
        }
        guard = await options.hostedGuard();
      } catch {
        return { kind: 'failed', text: PREVIEW_FAILURE_TEXT['not-masked'] };
      }
      const steps: HostedPreviewStep[] = stepsBeforeAnyReply(input, template).map(
        (prompt, index) => ({
          step: index + 1,
          system: maskForHosted(prompt.system, guard),
          user: maskForHosted(prompt.user, guard),
        }),
      );
      previewSeen = true;
      // The summary step, after every step above — as the runner counts them.
      return { kind: 'shown', steps, total: steps.length + 1 };
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

      const input = await readInput(activityId);
      if (input === undefined) {
        return failed('not-read');
      }

      // The rider's history (#835), asked of their instance BEFORE the run so
      // the runner stays pure. Only for the rider's own computer: a hosted
      // model is never sent it until ADR 0040 D-9's disclosures change.
      const instance = source === 'computer' ? options.history?.() : undefined;
      let passages: readonly HistoryPassage[] = [];
      let historyNotice: string | undefined;
      if (instance !== undefined && template.history !== undefined) {
        const retrieved = await instance.retrieve({
          query: template.history.query(input),
          rideId: activityId,
          limit: template.history.passages,
          characters: template.history.characters,
        });
        if (retrieved.kind === 'passages') {
          passages = retrieved.passages;
        } else {
          historyNotice = HISTORY_NOTICE_TEXT.unreachable;
        }
      }
      // A cancel that landed while the instance was being asked is the
      // runner's to honour: its first step refuses to start.
      const outcome = await runAnalysis(input, {
        port,
        clock,
        signal,
        template,
        history: passages,
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
      if (outcome.history === 'failed') {
        historyNotice = HISTORY_NOTICE_TEXT.failed;
      }
      return historyNotice === undefined
        ? { kind: 'written' }
        : { kind: 'written', notice: historyNotice };
    },
  };
}
