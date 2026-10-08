// SPDX-License-Identifier: Apache-2.0

/**
 * **The analysis runner: a template's steps, in order, against a model port**
 * — [#811](https://github.com/openzigs/onyourleft/issues/811), epic #795.
 *
 * Pure orchestration. It builds each step's prompt with the template (#810),
 * sends it through a {@link ModelStepPort}, validates what comes back, and
 * ends in a {@link ScreenedWriteUp} (#798) or a named failure. It has no
 * transport, reads no clock (time is a {@link RunnerClock} it is handed, so
 * every budget test is deterministic) and saves nothing: a caller keeps a
 * write-up only when the outcome is `written` (#804), so any failure leaves a
 * write-up saved earlier exactly as it was.
 *
 * ## The app decides every step (#810)
 *
 * The chain is fixed: a note per section, a note on position when the input
 * carries a pose summary, a note on the rider's history when the template has
 * that step and there are passages (#835), a summary, and — only when the
 * summary fails the screen — one rewrite. Per-step success compounds (at 95 % a step, eight
 * steps land about two thirds of the time), so a failed section does not sink
 * the run: see §"The policy for a weak model".
 *
 * ## What a prompt may carry
 *
 * The template's builders take the {@link RideAnalysisInput} and earlier steps'
 * **validated** notes, and nothing else. A reply is `UntrustedText`; it reaches
 * a later prompt only as the `notes` of a {@link SectionNote} or
 * {@link PositionNote} the template's acceptors made. The parse-repair re-ask
 * names what was wrong in a fixed sentence and never echoes the reply.
 *
 * ## Every step is bounded three ways
 *
 * - **Input.** A prompt longer than its step's `maximumInputCharacters` is not
 *   sent: context windows are small and truncation is silent (#795
 *   §Research), so an oversized prompt would be cut without an error.
 * - **Tokens.** Each step asks for its own `maximumTokens`, and the run stops
 *   before it would ask for more than {@link RUN_TOKEN_BUDGET} in all.
 * - **Time.** Each step waits at most its own `deadlineMilliseconds`, and never
 *   past the run's {@link RUN_BUDGET_MILLISECONDS}. A reply that ends for
 *   `length` is a failed step, not a short answer.
 *
 * ## The policy for a weak model
 *
 * - A section or position step whose reply is not the contract is asked
 *   **once** more, with the error; only when that fails too is the step
 *   failed. A reply cut off, a step past its deadline and a transport failure
 *   are failed at once — asking again would meet the same wall.
 * - A failed section is **left out**, and the summary is told which. When more
 *   than half the sections fail, the run fails as `too-few-sections`.
 * - The summary goes through the screen (#798). If it is withheld, one
 *   `rewrite` step (ADR 0035 D-4) is told which RULES were broken — never the
 *   text — and if that is withheld too the run fails as `withheld-by-screen`.
 * - A run over its time budget stops as `out-of-time`, over its token budget
 *   as `out-of-tokens`; nothing partial is returned.
 *
 * ## Cancellation
 *
 * Aborting the run's signal settles it `cancelled` at once and issues no
 * further step. The step in flight is aborted too: in a browser that closes
 * the connection, which stops generation on the common local servers. ⚠️
 * **Inside the Android shell the request cannot be aborted from the web side**
 * (spike 0016 §2.1), so the rider's computer may carry on; whatever it
 * answers is discarded, and {@link RUN_FAILURE_TEXT} says so.
 */

import type { UntrustedText } from './screen/model-answer';
import {
  passedScreen,
  screenWriteUp,
  type ScreenReason,
  type ScreenedWriteUp,
} from './screen/write-up-screen';
import type { HistoryPassage } from './history';
import type { RideAnalysisInput } from './input';
import type { ModelStepPort, StepReply } from './model-step-port';
import { sealStep } from './sealed-step';
import {
  acceptHistoryNote,
  acceptPositionNote,
  acceptSectionNote,
  CURRENT_ANALYSIS_TEMPLATE,
  type AnalysisStepBounds,
  type AnalysisStepKind,
  type AnalysisTemplate,
  type EarlierNotes,
  type HistoryNote,
  type PositionNote,
  type ScreenRule,
  type SectionNote,
  type StepPrompt,
} from './template/template';

// --- Budgets ------------------------------------------------------------------

/**
 * The longest a whole run may take: ten minutes.
 *
 * Version 1's steps at their deadlines come to 13 minutes with no retry (eight
 * sections and a position at 60 s, a summary and a rewrite at 120 s), and 22
 * with every JSON step asked twice. A model that slow is not one a rider waits
 * for at the end of a ride, and one that does a section in 30 s — a slow model
 * on a laptop's processor — finishes the whole chain in about seven. So a run
 * is given up on at ten, and nothing partial is kept.
 */
export const RUN_BUDGET_MILLISECONDS = 10 * 60_000;

/**
 * The most `max_tokens` a run may ask for, all its steps together: 10 100.
 *
 * Version 1 asks for at most 9 248 — eight sections and a position at 400
 * each, every one asked twice, and a summary and a rewrite at 1 024 —
 * (`runner.test.ts` computes it from the template). Version 2 adds the
 * history step (#835), at 400 asked twice: 10 048. The budget was 10 000
 * until then and is raised by exactly that step's worst case, rounded up, so
 * it still never cuts a run of either version short and still says so the day
 * a template's worst case passes it.
 */
export const RUN_TOKEN_BUDGET = 10_100;

/**
 * `temperature` for a step whose reply is JSON: 0.1. Structured output from a
 * small model breaks more often the more it is allowed to vary (#795
 * §Research recommends 0–0.2), and the notes are a reading of numbers, not
 * prose anybody asked to be surprising.
 */
export const STRUCTURED_TEMPERATURE = 0.1;

/**
 * `temperature` for the summary and the rewrite: 0.2, the top of the same
 * range. Prose a rider reads, but still a reading of the same numbers, and the
 * screen is likelier to withhold a model that is allowed to wander.
 */
export const PROSE_TEMPERATURE = 0.2;

// --- The clock ------------------------------------------------------------------

/** A wait the runner can stop. */
export interface RunnerDelay {
  /** Resolves when the time has passed. Never rejects. */
  readonly elapsed: Promise<void>;
  /** Stop waiting; `elapsed` then never resolves. Idempotent. */
  cancel(): void;
}

/** Time, handed in, so the runner reads no clock of its own. */
export interface RunnerClock {
  /** Milliseconds on a clock that only moves forward. */
  now(): number;
  /** A wait of `milliseconds`. */
  delay(milliseconds: number): RunnerDelay;
}

// --- Outcomes -------------------------------------------------------------------

/** Why a run ended with nothing to keep. */
export type RunFailure =
  /** The rider, or the screen that asked, cancelled the run. */
  | 'cancelled'
  /** The run passed {@link RUN_BUDGET_MILLISECONDS}. */
  | 'out-of-time'
  /** The run would have passed {@link RUN_TOKEN_BUDGET}. */
  | 'out-of-tokens'
  /** More than half the section steps failed. */
  | 'too-few-sections'
  /** The summary step, or its rewrite, failed: no answer, a reply cut off, or its prompt over its bound. */
  | 'no-summary'
  /** The summary and its one rewrite were both withheld by the screen (#798). */
  | 'withheld-by-screen';

/**
 * What a rider is told for each {@link RunFailure}: a fixed table, and none
 * of its sentences carries model text, an address, a model name or a key
 * (ADR 0029 D-8). Each says that nothing was kept, because a rider who had a
 * write-up before still has it.
 */
export const RUN_FAILURE_TEXT: Readonly<Record<RunFailure, string>> = {
  cancelled:
    'The write-up was cancelled and nothing was kept. A model that was still working on it may carry on for a while; whatever it answers is ignored.',
  'out-of-time':
    'The model took too long, so the write-up was stopped and nothing was kept. A smaller or faster model may finish in time.',
  'out-of-tokens':
    'The write-up would have asked the model for more text than this app allows, so it was stopped and nothing was kept.',
  'too-few-sections':
    'The model could not describe enough of the ride’s sections, so the write-up was stopped and nothing was kept. A larger model may do better.',
  'no-summary':
    'The model did not finish the write-up, so nothing was kept. Check that it is running, then try again.',
  // ⚠️ Neutral about WHICH check, on purpose (#804, carried from #826's
  // review): it used to say the write-up "broke this app’s rules about what
  // may be said about a body, twice", which is untrue of a summary withheld
  // only for being empty, too long or holding a control character. A rewrite
  // that never answered is not this failure at all — it is `no-summary`.
  'withheld-by-screen':
    'The model’s write-up did not pass this app’s checks on what may be shown, even after it was asked to rewrite it, so it is not shown and nothing was kept.',
};

/** How a run ended. */
export type RunOutcome =
  | {
      readonly kind: 'written';
      readonly writeUp: ScreenedWriteUp;
      readonly templateVersion: string;
      /** The 1-based indexes of the sections the write-up leaves out, in the input's order. */
      readonly missingSections: readonly number[];
      /**
       * The history step (#835): `used` when its note reached the summary,
       * `failed` when it ran and its reply was not accepted, `none` when it
       * did not run.
       */
      readonly history: 'used' | 'failed' | 'none';
    }
  | { readonly kind: 'failed'; readonly why: RunFailure };

/**
 * Where a run is, as a step number and the steps planned — and nothing else:
 * no step kind, no prompt and no reply (#804). `total` is the sections, the
 * position step when the input has a pose summary, the history step when
 * there are passages (#835), and the summary. A re-ask
 * and the rewrite are not new steps: they report the step they repair.
 */
export interface RunProgress {
  readonly step: number;
  readonly total: number;
}

/** What {@link runAnalysis} is given besides the input. */
export interface RunOptions {
  readonly port: ModelStepPort;
  readonly clock: RunnerClock;
  /** Aborting it cancels the run. */
  readonly signal: AbortSignal;
  /** The template to run: {@link CURRENT_ANALYSIS_TEMPLATE} unless a test says otherwise. */
  readonly template?: AnalysisTemplate;
  /** Told as each planned step starts. @see RunProgress */
  readonly progress?: (progress: RunProgress) => void;
  /**
   * Passages of the rider's history (#835), as `history.ts` accepted them.
   * The template's history step runs only when there is at least one and the
   * template has such a step; it is the ONLY step they reach.
   */
  readonly history?: readonly HistoryPassage[];
}

// --- The parse-repair re-ask ----------------------------------------------------

/** What was wrong with a structured reply, in the runner's own words. */
type ContractError = 'not-json' | 'wrong-form';

/**
 * The sentence a re-ask carries for each error. Fixed, and naming nothing the
 * model wrote: the reply is untrusted, and handing it back would put it in a
 * prompt.
 */
const REPAIR_TEXT: Readonly<Record<ContractError, string>> = {
  'not-json': 'Your last reply could not be used: it was not one JSON object.',
  'wrong-form':
    'Your last reply could not be used: its fields, its section number or its notes were not as asked.',
};

/**
 * What every re-ask ends with. The schema itself goes with the re-ask as the
 * step's `response_format` hint, and the prompt above already spells the form
 * out — so it is pointed at rather than pasted again: the widest section's
 * prompt leaves under 400 characters of its bound, and the schema as text
 * would take about 200 of them (`runner.test.ts` sends that repair and
 * measures it).
 */
const REPAIR_ASK = 'Reply again with JSON only, in exactly the form and schema asked for above.';

function contractError(text: string): ContractError {
  try {
    JSON.parse(text.trim());
    return 'wrong-form';
  } catch {
    return 'not-json';
  }
}

/** The same prompt and schema, with what was wrong appended. */
function repairPrompt(prompt: StepPrompt, error: ContractError): StepPrompt {
  return { ...prompt, user: `${prompt.user}\n${REPAIR_TEXT[error]} ${REPAIR_ASK}` };
}

// --- The screen's findings, as the template names them ---------------------------

/**
 * The template's rule for each of the screen's reasons, or `undefined` for a
 * reason no rule names (an empty or overlong write-up). The template keeps
 * names of its own on purpose (`template.ts` §`ScreenRule`).
 */
function ruleFor(reason: ScreenReason): ScreenRule | undefined {
  switch (reason) {
    case 'angle-sign':
      return 'angle-sign';
    case 'angle-word':
      return 'angle-word';
    case 'body-sideways':
      return 'body-across';
    default:
      return undefined;
  }
}

// --- The run --------------------------------------------------------------------

/** Why a run stopped before it could finish. */
class Stopped extends Error {
  // A declared field rather than a parameter property: the instance runs this
  // package under Node's type stripping (#1098), which has no parameter
  // properties (`erasableSyntaxOnly`).
  readonly why: RunFailure;
  constructor(why: RunFailure) {
    super(why);
    this.why = why;
  }
}

/** A step's result: its reply's text, or that it failed. */
type StepResult = { readonly text: UntrustedText } | undefined;

/**
 * Run `template` over `input`. Every way a run can fail is a
 * {@link RunOutcome}; it rejects only on a defect in this client (a prompt
 * builder handed a section the input does not have).
 */
export async function runAnalysis(
  input: RideAnalysisInput,
  options: RunOptions,
): Promise<RunOutcome> {
  const { port, clock, signal } = options;
  const template = options.template ?? CURRENT_ANALYSIS_TEMPLATE;
  const runEndsAt = clock.now() + RUN_BUDGET_MILLISECONDS;
  let tokensAskedFor = 0;
  let stepsStarted = 0;
  // Known before the first step: the position step runs exactly when the
  // template builds it a prompt, which it does exactly when there is a pose
  // summary; the history step exactly when it builds one, over passages.
  const historyPrompt =
    template.history === undefined
      ? undefined
      : template.history.prompt(input, options.history ?? []);
  const total =
    input.sections.length +
    (input.pose === undefined ? 0 : 1) +
    (historyPrompt === undefined ? 0 : 1) +
    1;
  /** Report the next planned step. Nothing of the step is said. */
  const starting = (): void => {
    stepsStarted += 1;
    options.progress?.({ step: Math.min(stepsStarted, total), total });
  };

  /** Send one prompt and wait for its reply, within every bound. */
  const ask = async (
    kind: AnalysisStepKind,
    prompt: StepPrompt,
    bounds: AnalysisStepBounds,
    temperature: number,
  ): Promise<StepResult> => {
    if (signal.aborted) {
      throw new Stopped('cancelled');
    }
    const remaining = runEndsAt - clock.now();
    if (remaining <= 0) {
      throw new Stopped('out-of-time');
    }
    if (prompt.system.length + prompt.user.length > bounds.maximumInputCharacters) {
      return undefined;
    }
    if (tokensAskedFor + bounds.maximumTokens > RUN_TOKEN_BUDGET) {
      throw new Stopped('out-of-tokens');
    }
    tokensAskedFor += bounds.maximumTokens;

    // Sealed (#803): the hosted path sends only a step made here, from the
    // template's prompt, and refuses anything else by identity.
    const request = sealStep({
      kind,
      system: prompt.system,
      user: prompt.user,
      ...(prompt.replySchema === undefined ? {} : { replySchema: prompt.replySchema }),
      maximumTokens: bounds.maximumTokens,
      temperature,
    });
    const cutByTheRun = remaining < bounds.deadlineMilliseconds;
    const step = new AbortController();
    const timer = clock.delay(Math.min(bounds.deadlineMilliseconds, remaining));
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<'aborted'>((resolve) => {
      onAbort = () => {
        resolve('aborted');
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const replied = port.runModelStep(request, step.signal).then(
      (reply): StepReply => reply,
      (): StepReply => ({ kind: 'failed', failure: 'unreachable' }),
    );
    let settled: StepReply | 'aborted' | 'deadline';
    try {
      settled = await Promise.race([
        replied,
        aborted,
        timer.elapsed.then(() => 'deadline' as const),
      ]);
    } finally {
      timer.cancel();
      signal.removeEventListener('abort', onAbort);
    }
    // A reply that won the race against a cancellation is not checked here:
    // the next step's first line refuses to start, and the last step's reply
    // is refused where the outcome is made (§`written`).
    if (settled === 'aborted') {
      step.abort();
      throw new Stopped('cancelled');
    }
    if (settled === 'deadline') {
      step.abort();
      if (cutByTheRun) {
        throw new Stopped('out-of-time');
      }
      return undefined;
    }
    if (settled.kind === 'failed' || settled.finish === 'length') {
      return undefined;
    }
    return { text: settled.text };
  };

  /** A structured step, re-asked once with the error when its reply is not the contract. */
  const structured = async <Note>(
    kind: AnalysisStepKind,
    prompt: StepPrompt,
    bounds: AnalysisStepBounds,
    accept: (text: string) => Note | undefined,
  ): Promise<Note | undefined> => {
    starting();
    const first = await ask(kind, prompt, bounds, STRUCTURED_TEMPERATURE);
    if (first === undefined) {
      return undefined;
    }
    const accepted = accept(first.text);
    if (accepted !== undefined) {
      return accepted;
    }
    const second = await ask(
      kind,
      repairPrompt(prompt, contractError(first.text)),
      bounds,
      STRUCTURED_TEMPERATURE,
    );
    return second === undefined ? undefined : accept(second.text);
  };

  try {
    const [sectionStep, positionStep, summaryStep, rewriteStep] = template.steps;

    const sections: SectionNote[] = [];
    const failedSections: number[] = [];
    for (const { index } of input.sections) {
      const note = await structured(
        'section',
        sectionStep.prompt(input, index),
        sectionStep.bounds,
        (text) => acceptSectionNote(text, index),
      );
      if (note === undefined) {
        failedSections.push(index);
      } else {
        sections.push(note);
      }
    }
    if (failedSections.length * 2 > input.sections.length) {
      return { kind: 'failed', why: 'too-few-sections' };
    }

    const positionPrompt = positionStep.prompt(input);
    const position: PositionNote | undefined =
      positionPrompt === undefined
        ? undefined
        : await structured('position', positionPrompt, positionStep.bounds, acceptPositionNote);

    // The ONE step a passage of the rider's history reaches (ADR 0040 D-8).
    // What the summary is shown of it is the note, accepted and screened.
    const history: HistoryNote | undefined =
      historyPrompt === undefined || template.history === undefined
        ? undefined
        : await structured('history', historyPrompt, template.history.bounds, acceptHistoryNote);
    const historyRan: 'used' | 'failed' | 'none' =
      historyPrompt === undefined ? 'none' : history === undefined ? 'failed' : 'used';

    const earlier: EarlierNotes = {
      sections,
      ...(position === undefined ? {} : { position }),
      ...(history === undefined ? {} : { history }),
      failedSections,
    };
    // §`written`: a cancellation that landed after the last reply arrived, but
    // before the run settled, still wins: a caller that has cancelled must not be handed
    // something to keep.
    const written = (writeUp: ScreenedWriteUp): RunOutcome =>
      signal.aborted
        ? { kind: 'failed', why: 'cancelled' }
        : {
            kind: 'written',
            writeUp,
            templateVersion: template.version,
            missingSections: [...failedSections],
            history: historyRan,
          };

    starting();
    const summary = await ask(
      'summary',
      summaryStep.prompt(input, earlier),
      summaryStep.bounds,
      PROSE_TEMPERATURE,
    );
    if (summary === undefined) {
      return { kind: 'failed', why: 'no-summary' };
    }
    const screened = screenWriteUp(summary.text);
    if (passedScreen(screened)) {
      return written(screened);
    }

    const broken = [
      ...new Set(
        screened.withheld.map(ruleFor).filter((rule): rule is ScreenRule => rule !== undefined),
      ),
    ];
    const rewrite = await ask(
      'rewrite',
      rewriteStep.prompt(input, earlier, broken),
      rewriteStep.bounds,
      PROSE_TEMPERATURE,
    );
    // A rewrite that did not answer — a transport failure, its deadline, a
    // reply cut off, or its prompt over its bound — is the summary not
    // finishing, not the screen withholding anything (#804, from #826's review).
    if (rewrite === undefined) {
      return { kind: 'failed', why: 'no-summary' };
    }
    const rescreened = screenWriteUp(rewrite.text);
    return passedScreen(rescreened)
      ? written(rescreened)
      : { kind: 'failed', why: 'withheld-by-screen' };
  } catch (error) {
    if (error instanceof Stopped) {
      return { kind: 'failed', why: error.why };
    }
    throw error;
  }
}
