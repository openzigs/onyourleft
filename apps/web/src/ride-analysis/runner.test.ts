// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The analysis runner (#811), driven against a scripted {@link ModelStepPort}
 * and a clock the test moves by hand, so every deadline and budget below is
 * reached exactly rather than waited for.
 */

import { ANALYSIS_READ_TIMEOUT_MILLISECONDS } from '@onyourleft/mobile';
import { describe, expect, it } from 'vitest';

import type { UntrustedText } from '../camera/model-answer';
import type { RideAnalysisInput, SectionSummary } from './input';
import type { ModelStepPort, StepReply, StepRequest } from './model-step-port';
import {
  PROSE_TEMPERATURE,
  RUN_BUDGET_MILLISECONDS,
  RUN_FAILURE_TEXT,
  RUN_TOKEN_BUDGET,
  runAnalysis,
  STRUCTURED_TEMPERATURE,
  type RunFailure,
  type RunnerClock,
  type RunOutcome,
} from './runner';
import { ANALYSIS_TEMPLATES, CURRENT_ANALYSIS_TEMPLATE, type AnalysisTemplate } from './template';

// --- Fixtures -----------------------------------------------------------------

function section(index: number): SectionSummary {
  return {
    index,
    kind: 'flat',
    minutes: 10,
    metrics: { power: { coverage: 1, mean: 180 + index, max: 300 } },
  };
}

function rideWith(sections: number, pose = false): RideAnalysisInput {
  return {
    templateVersion: '1',
    ride: { movingMinutes: 10 * sections, distanceKilometres: 5 * sections },
    rider: { massKilograms: 70, thresholdPower: 250 },
    whole: { power: { coverage: 1, mean: 185, max: 300 } },
    sections: Array.from({ length: sections }, (_, position) => section(position + 1)),
    ...(pose
      ? {
          pose: {
            source: 'tablet' as const,
            posed: 300,
            noRider: 0,
            unreadable: 0,
            differences: { torso: 1.5 },
          },
        }
      : {}),
  };
}

const WIDEST_METRICS = {
  power: { coverage: 0.99, mean: 1234, max: 1999 },
  heartRate: { coverage: 0.99, mean: 188, max: 199 },
  cadence: { coverage: 0.99, mean: 101, max: 199 },
  wattsPerKilogram: { mean: 17.53, max: 28.39 },
};

/** `template.test.ts`' widest section: every optional field, every figure at its longest. */
function widestSection(index: number): SectionSummary {
  return {
    index,
    kind: 'descent',
    minutes: 1234.5,
    distanceKilometres: 123.45,
    meanGradientPercent: -12.3,
    elevationGainMetres: 1234,
    laps: { first: 10 + index, last: 20 + index },
    metrics: WIDEST_METRICS,
  };
}

const untrusted = (text: string): UntrustedText => text as UntrustedText;

/** A reply that meets section `index`'s contract. */
function note(index: number, notes = `Section ${String(index)} was steady.`): AnswerStep {
  return { answer: JSON.stringify({ section: index, notes }) };
}

const POSITION_NOTE: AnswerStep = { answer: JSON.stringify({ notes: 'Posture held steady.' }) };
const GOOD_SUMMARY: AnswerStep = { answer: 'A steady ride, evenly paced from start to finish.' };
/** A summary the screen withholds: a figure with the sign for a unit of angle. */
const ANGLED_SUMMARY: AnswerStep = {
  answer: 'Your knee reached 142° at the bottom of the stroke.',
};

// --- The clock and the port -----------------------------------------------------

interface ManualClock extends RunnerClock {
  advance(milliseconds: number): void;
}

function manualClock(): ManualClock {
  let now = 0;
  const waits: { at: number; live: boolean; resolve: () => void }[] = [];
  return {
    now: () => now,
    delay(milliseconds) {
      let resolve: () => void = () => undefined;
      const elapsed = new Promise<void>((settle) => {
        resolve = settle;
      });
      const wait = { at: now + milliseconds, live: true, resolve };
      waits.push(wait);
      return {
        elapsed,
        cancel: () => {
          wait.live = false;
        },
      };
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const wait of waits) {
        if (wait.live && wait.at <= now) {
          wait.live = false;
          wait.resolve();
        }
      }
    },
  };
}

/** One scripted step. */
type Step =
  /** Answers `answer` after `takes` milliseconds of the clock, ending as `finish`. */
  | {
      readonly answer: string;
      readonly finish?: 'stop' | 'length' | 'other';
      readonly takes?: number;
    }
  /** Fails with a transport failure. */
  | { readonly failure: 'unreachable' | 'failed-on-machine' }
  /** Moves the clock on by `advance` and never answers. */
  | { readonly hangs: true; readonly advance: number }
  /** Answers only when the test calls `release`. */
  | { readonly late: LateReply };

type AnswerStep = Extract<Step, { readonly answer: string }>;

interface LateReply {
  release(reply: StepReply): void;
  readonly asked: Promise<AbortSignal>;
}

interface ScriptedLateReply extends LateReply {
  readonly promise: Promise<StepReply>;
  notify(signal: AbortSignal): void;
}

function lateReply(): ScriptedLateReply {
  let release: (reply: StepReply) => void = () => undefined;
  let asked: (signal: AbortSignal) => void = () => undefined;
  const promise = new Promise<StepReply>((settle) => {
    release = settle;
  });
  const askedPromise = new Promise<AbortSignal>((settle) => {
    asked = settle;
  });
  const late = {
    release: (reply: StepReply) => {
      release(reply);
    },
    asked: askedPromise,
    promise,
    notify: (signal: AbortSignal) => {
      asked(signal);
    },
  };
  return late;
}

interface ScriptedPort extends ModelStepPort {
  readonly requests: StepRequest[];
  readonly signals: AbortSignal[];
}

function scriptedPort(clock: ManualClock, script: readonly Step[]): ScriptedPort {
  const remaining = [...script];
  const requests: StepRequest[] = [];
  const signals: AbortSignal[] = [];
  return {
    requests,
    signals,
    runModelStep(step, signal) {
      requests.push(step);
      signals.push(signal);
      const next = remaining.shift();
      if (next === undefined) {
        throw new Error(`the script has no step for request ${String(requests.length)}`);
      }
      if ('answer' in next) {
        clock.advance(next.takes ?? 1_000);
        return Promise.resolve({
          kind: 'answered',
          text: untrusted(next.answer),
          finish: next.finish ?? 'stop',
        });
      }
      if ('failure' in next) {
        return Promise.resolve({ kind: 'failed', failure: next.failure });
      }
      if ('hangs' in next) {
        clock.advance(next.advance);
        return new Promise<StepReply>(() => undefined);
      }
      const late = next.late as ScriptedLateReply;
      late.notify(signal);
      return late.promise;
    },
  };
}

async function run(
  input: RideAnalysisInput,
  script: readonly Step[],
  template?: AnalysisTemplate,
  /** Cancel the run once this many steps have been asked, rather than scripting the rest. */
  stopAfter?: number,
): Promise<{ outcome: RunOutcome; port: ScriptedPort }> {
  const clock = manualClock();
  const cancel = new AbortController();
  const scripted = scriptedPort(clock, script);
  const port: ScriptedPort = {
    requests: scripted.requests,
    signals: scripted.signals,
    runModelStep: (step, signal) => {
      const reply = scripted.runModelStep(step, signal);
      if (stopAfter !== undefined && scripted.requests.length >= stopAfter) {
        cancel.abort();
      }
      return reply;
    },
  };
  const outcome = await runAnalysis(input, {
    port,
    clock,
    signal: cancel.signal,
    ...(template === undefined ? {} : { template }),
  });
  return { outcome, port };
}

function failedAs(outcome: RunOutcome): RunFailure | undefined {
  return outcome.kind === 'failed' ? outcome.why : undefined;
}

function withBounds(
  kind: 'section' | 'summary',
  bounds: Partial<AnalysisTemplate['steps'][0]['bounds']>,
): AnalysisTemplate {
  const [sectionStep, positionStep, summaryStep, rewriteStep] = CURRENT_ANALYSIS_TEMPLATE.steps;
  return {
    ...CURRENT_ANALYSIS_TEMPLATE,
    steps: [
      kind === 'section'
        ? { ...sectionStep, bounds: { ...sectionStep.bounds, ...bounds } }
        : sectionStep,
      positionStep,
      kind === 'summary'
        ? { ...summaryStep, bounds: { ...summaryStep.bounds, ...bounds } }
        : summaryStep,
      rewriteStep,
    ],
  };
}

// --- The order of the steps --------------------------------------------------------

describe('the steps the runner issues', () => {
  it('issues exactly the template’s steps, in order, and writes the summary', async () => {
    const { outcome, port } = await run(rideWith(3, true), [
      note(1),
      note(2),
      note(3),
      POSITION_NOTE,
      GOOD_SUMMARY,
    ]);
    expect(port.requests.map((request) => request.kind)).toStrictEqual([
      'section',
      'section',
      'section',
      'position',
      'summary',
    ]);
    expect(port.requests.slice(0, 3).map((request) => request.user)).toStrictEqual(
      [1, 2, 3].map(
        (index) => CURRENT_ANALYSIS_TEMPLATE.steps[0].prompt(rideWith(3, true), index).user,
      ),
    );
    expect(outcome).toStrictEqual({
      kind: 'written',
      writeUp: GOOD_SUMMARY.answer,
      templateVersion: CURRENT_ANALYSIS_TEMPLATE.version,
      missingSections: [],
    });
  });

  it('skips the position step when the input carries no pose summary', async () => {
    const { port } = await run(rideWith(1), [note(1), GOOD_SUMMARY]);
    expect(port.requests.map((request) => request.kind)).toStrictEqual(['section', 'summary']);
  });

  it('sends each step its own bounds, its schema and a low temperature', async () => {
    const { port } = await run(rideWith(1, true), [note(1), POSITION_NOTE, GOOD_SUMMARY]);
    const [sectionRequest, positionRequest, summaryRequest] = port.requests;
    const [sectionStep, positionStep, summaryStep] = CURRENT_ANALYSIS_TEMPLATE.steps;
    expect(sectionRequest?.maximumTokens).toBe(sectionStep.bounds.maximumTokens);
    expect(sectionRequest?.replySchema?.name).toBe('section_notes');
    expect(sectionRequest?.temperature).toBe(STRUCTURED_TEMPERATURE);
    expect(positionRequest?.maximumTokens).toBe(positionStep.bounds.maximumTokens);
    expect(positionRequest?.replySchema?.name).toBe('position_notes');
    expect(summaryRequest?.maximumTokens).toBe(summaryStep.bounds.maximumTokens);
    expect(summaryRequest?.replySchema).toBeUndefined();
    expect(summaryRequest?.temperature).toBe(PROSE_TEMPERATURE);
    for (const temperature of [STRUCTURED_TEMPERATURE, PROSE_TEMPERATURE]) {
      expect(temperature).toBeGreaterThanOrEqual(0);
      expect(temperature).toBeLessThanOrEqual(0.2);
    }
  });
});

// --- Only validated output reaches a later prompt ------------------------------------

describe('what a later prompt carries', () => {
  it('carries a validated note, and never a raw reply’s words outside it', async () => {
    const { outcome, port } = await run(rideWith(2, true), [
      // JSON keeps the LAST of two keys of one name, so this is accepted with
      // "fine" as its notes, and the marker is in the reply and nowhere else.
      { answer: '{"section":1,"notes":"MARKER-DUPLICATE","notes":"Section one was fine."}' },
      // Not JSON: re-asked, then repaired.
      { answer: 'MARKER-INVALID here is what I think' },
      note(2, 'Section two was harder.'),
      { answer: '{"notes":"MARKER-POSITION","notes":"Position held."}' },
      GOOD_SUMMARY,
    ]);
    expect(outcome.kind).toBe('written');
    const later = port.requests.slice(1).map((request) => `${request.system}\n${request.user}`);
    for (const prompt of later) {
      expect(prompt).not.toContain('MARKER');
    }
    const summary = port.requests.at(-1);
    expect(summary?.kind).toBe('summary');
    expect(summary?.user).toContain('Section one was fine.');
    expect(summary?.user).toContain('Section two was harder.');
    expect(summary?.user).toContain('Position held.');
  });
});

// --- The parse-repair retry and the section failures ---------------------------------

describe('a structured reply that is not the contract', () => {
  it('is re-asked once with the error and the schema, and the repaired reply is used', async () => {
    const { outcome, port } = await run(rideWith(1), [
      { answer: 'not json at all' },
      note(1),
      GOOD_SUMMARY,
    ]);
    expect(outcome.kind).toBe('written');
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([]);
    const [first, repair] = port.requests;
    expect(repair?.kind).toBe('section');
    expect(repair?.user.startsWith(first?.user ?? '')).toBe(true);
    expect(repair?.user).toContain('it was not one JSON object');
    expect(repair?.user).toContain('in exactly the form and schema asked for above');
    expect(repair?.replySchema).toStrictEqual(first?.replySchema);
    expect(repair?.user).not.toContain('not json at all');
  });

  it('names the wrong form, rather than invalid JSON, when the reply parsed', async () => {
    const { port } = await run(rideWith(1), [note(2), note(1), GOOD_SUMMARY]);
    expect(port.requests[1]?.user).toContain(
      'its fields, its section number or its notes were not as asked',
    );
    expect(port.requests[1]?.user).not.toContain('not one JSON object');
  });

  it.each<[string, Step]>([
    ['invalid JSON', { answer: '{"section": 1, "notes": ' }],
    ['the wrong section index', note(2)],
    ['notes over their bound', note(1, 'x'.repeat(601))],
  ])('leaves a section out after %s twice, and tells the summary', async (_, bad) => {
    const { outcome, port } = await run(rideWith(2), [bad, bad, note(2), GOOD_SUMMARY]);
    expect(port.requests.map((request) => request.kind)).toStrictEqual([
      'section',
      'section',
      'section',
      'summary',
    ]);
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([1]);
    expect(port.requests.at(-1)?.user).toContain('No notes could be written for section 1.');
  });

  it('does not re-ask a reply that was cut off at its length, and leaves the section out', async () => {
    const { outcome, port } = await run(rideWith(2), [
      { ...note(1), finish: 'length' },
      note(2),
      GOOD_SUMMARY,
    ]);
    expect(port.requests.map((request) => request.kind)).toStrictEqual([
      'section',
      'section',
      'summary',
    ]);
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([1]);
  });

  it('reads a port that rejects, against its contract, as a failed step', async () => {
    const clock = manualClock();
    const scripted = scriptedPort(clock, [note(2), GOOD_SUMMARY]);
    let first = true;
    const port: ModelStepPort = {
      runModelStep: (step, signal) => {
        if (first) {
          first = false;
          return Promise.reject(new Error('a transport with a defect'));
        }
        return scripted.runModelStep(step, signal);
      },
    };
    const outcome = await runAnalysis(rideWith(2), {
      port,
      clock,
      signal: new AbortController().signal,
    });
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([1]);
  });

  it('rejects on a defect in this client rather than reading it as a failed run', async () => {
    const [sectionStep, ...rest] = CURRENT_ANALYSIS_TEMPLATE.steps;
    const broken: AnalysisTemplate = {
      ...CURRENT_ANALYSIS_TEMPLATE,
      steps: [
        {
          ...sectionStep,
          prompt: () => {
            throw new RangeError('a builder with a defect');
          },
        },
        ...rest,
      ],
    };
    await expect(run(rideWith(1), [], broken)).rejects.toThrow('a builder with a defect');
  });

  it('does not re-ask after a transport failure', async () => {
    const { outcome, port } = await run(rideWith(2), [
      { failure: 'unreachable' },
      note(2),
      GOOD_SUMMARY,
    ]);
    expect(port.requests).toHaveLength(3);
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([1]);
  });

  it('leaves a failed position step out without failing the run', async () => {
    const { outcome, port } = await run(rideWith(1, true), [
      note(1),
      { answer: 'no' },
      { answer: 'still no' },
      GOOD_SUMMARY,
    ]);
    expect(outcome.kind).toBe('written');
    expect(port.requests.at(-1)?.user).not.toContain('Position, over the whole');
  });

  it('fails as too-few-sections when more than half fail, and asks for no summary', async () => {
    const { outcome, port } = await run(rideWith(3), [
      { failure: 'unreachable' },
      { failure: 'unreachable' },
      note(3),
    ]);
    expect(failedAs(outcome)).toBe('too-few-sections');
    expect(port.requests.map((request) => request.kind)).not.toContain('summary');
  });

  it('writes the summary when exactly half fail', async () => {
    const { outcome } = await run(rideWith(2), [{ failure: 'unreachable' }, note(2), GOOD_SUMMARY]);
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([1]);
  });
});

// --- The summary, the screen and the rewrite -------------------------------------------

describe('the summary and the screen', () => {
  it('asks for one rewrite, told the rule and not the words, and writes it when it passes', async () => {
    const { outcome, port } = await run(rideWith(1), [note(1), ANGLED_SUMMARY, GOOD_SUMMARY]);
    expect(port.requests.map((request) => request.kind)).toStrictEqual([
      'section',
      'summary',
      'rewrite',
    ]);
    const rewrite = port.requests[2];
    expect(rewrite?.user).toContain('the symbol for a unit of angle');
    expect(rewrite?.user).not.toContain('142');
    expect(rewrite?.maximumTokens).toBe(CURRENT_ANALYSIS_TEMPLATE.steps[3].bounds.maximumTokens);
    expect(outcome.kind === 'written' && outcome.writeUp).toBe(GOOD_SUMMARY.answer);
  });

  it('tells the rewrite about a sideways body, in the template’s own name for it', async () => {
    const { port } = await run(rideWith(1), [
      note(1),
      { answer: 'Your hips rocked to the left on every climb.' },
      GOOD_SUMMARY,
    ]);
    expect(port.requests[2]?.user).toContain('toward one side, across the bicycle');
  });

  it('tells the rewrite about a unit of angle named in words', async () => {
    const { port } = await run(rideWith(1), [
      note(1),
      { answer: 'Your knee bent 30 degrees more by the end.' },
      GOOD_SUMMARY,
    ]);
    expect(port.requests[2]?.user).toContain('it named a unit of angle');
  });

  it('asks for the rewrite with no rule named when the summary broke none of them', async () => {
    const { outcome, port } = await run(rideWith(1), [note(1), { answer: '   ' }, GOOD_SUMMARY]);
    expect(port.requests[2]?.kind).toBe('rewrite');
    expect(port.requests[2]?.user).toContain('because it broke the rules above');
    expect(outcome.kind).toBe('written');
  });

  it('withholds the run when the rewrite fails the screen too', async () => {
    const { outcome, port } = await run(rideWith(1), [note(1), ANGLED_SUMMARY, ANGLED_SUMMARY]);
    expect(port.requests).toHaveLength(3);
    expect(failedAs(outcome)).toBe('withheld-by-screen');
  });

  it('withholds the run when the rewrite does not answer', async () => {
    const { outcome } = await run(rideWith(1), [
      note(1),
      ANGLED_SUMMARY,
      { failure: 'failed-on-machine' },
    ]);
    expect(failedAs(outcome)).toBe('withheld-by-screen');
  });

  it.each<[string, Step]>([
    ['a transport failure', { failure: 'unreachable' }],
    ['a reply cut off at its length', { ...GOOD_SUMMARY, finish: 'length' }],
  ])('fails as no-summary after %s', async (_, bad) => {
    const { outcome, port } = await run(rideWith(1), [note(1), bad]);
    expect(port.requests).toHaveLength(2);
    expect(failedAs(outcome)).toBe('no-summary');
  });
});

// --- Input and token bounds ------------------------------------------------------------------

describe('the input and token bounds', () => {
  it('fails the summary without sending it when its prompt is over the bound', async () => {
    const { outcome, port } = await run(
      rideWith(1),
      [note(1)],
      withBounds('summary', { maximumInputCharacters: 100 }),
    );
    expect(port.requests.map((request) => request.kind)).toStrictEqual(['section']);
    expect(failedAs(outcome)).toBe('no-summary');
  });

  it('sends the repair for the widest section, inside its input bound', async () => {
    const [sectionStep] = CURRENT_ANALYSIS_TEMPLATE.steps;
    const widest: RideAnalysisInput = {
      ...rideWith(8),
      ride: { movingMinutes: 2880.0, distanceKilometres: 1234.56 },
      rider: { massKilograms: 123.4, thresholdPower: 456 },
      whole: WIDEST_METRICS,
      sections: Array.from({ length: 8 }, (_, position) => widestSection(position + 1)),
    };
    // A reply that parses and has the wrong form: the longer of the two repair sentences.
    const { port } = await run(widest, [note(9), note(8)], undefined, 2);
    const repair = port.requests[1];
    expect(repair?.user).toContain('its fields, its section number or its notes were not as asked');
    expect((repair?.system.length ?? 0) + (repair?.user.length ?? 0)).toBeLessThanOrEqual(
      sectionStep.bounds.maximumInputCharacters,
    );
  });

  it('stops as out-of-tokens before asking past the run’s token budget', async () => {
    const { outcome, port } = await run(
      rideWith(2),
      [note(1), note(2)],
      withBounds('section', { maximumTokens: RUN_TOKEN_BUDGET / 2 + 1 }),
    );
    expect(port.requests).toHaveLength(1);
    expect(failedAs(outcome)).toBe('out-of-tokens');
  });

  it('has room for every template’s worst case: each JSON step asked twice', () => {
    for (const template of ANALYSIS_TEMPLATES) {
      const [sectionStep, positionStep, summaryStep, rewriteStep] = template.steps;
      const worst =
        8 * 2 * sectionStep.bounds.maximumTokens +
        2 * positionStep.bounds.maximumTokens +
        summaryStep.bounds.maximumTokens +
        rewriteStep.bounds.maximumTokens;
      expect(worst).toBeLessThanOrEqual(RUN_TOKEN_BUDGET);
    }
  });
});

// --- Deadlines -------------------------------------------------------------------------------

describe('the deadlines', () => {
  it('gives up on a step past its own deadline, aborts it and leaves the section out', async () => {
    const [sectionStep] = CURRENT_ANALYSIS_TEMPLATE.steps;
    const { outcome, port } = await run(rideWith(2), [
      { hangs: true, advance: sectionStep.bounds.deadlineMilliseconds },
      note(2),
      GOOD_SUMMARY,
    ]);
    expect(port.signals[0]?.aborted).toBe(true);
    expect(port.requests).toHaveLength(3);
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([1]);
  });

  it('waits a step up to its deadline and no less', async () => {
    const [sectionStep] = CURRENT_ANALYSIS_TEMPLATE.steps;
    const { outcome } = await run(rideWith(1), [
      { ...note(1), takes: sectionStep.bounds.deadlineMilliseconds - 1 },
      GOOD_SUMMARY,
    ]);
    expect(outcome.kind === 'written' && outcome.missingSections).toStrictEqual([]);
  });

  it('stops as out-of-time when the run’s budget cuts a step short, not as that step failing', async () => {
    // The summary is the last step, so nothing after it could notice the
    // budget instead: a cut summary read as a failed step would say no-summary.
    const { outcome, port } = await run(rideWith(1), [
      { ...note(1), takes: RUN_BUDGET_MILLISECONDS - 10_000 },
      { hangs: true, advance: 10_000 },
    ]);
    expect(port.requests.map((request) => request.kind)).toStrictEqual(['section', 'summary']);
    expect(port.signals[1]?.aborted).toBe(true);
    expect(failedAs(outcome)).toBe('out-of-time');
  });

  it('stops as out-of-time, issuing nothing, once the budget is spent', async () => {
    const { outcome, port } = await run(rideWith(2), [
      { ...note(1), takes: RUN_BUDGET_MILLISECONDS },
      note(2),
    ]);
    expect(port.requests).toHaveLength(1);
    expect(failedAs(outcome)).toBe('out-of-time');
  });

  it('sets every step’s deadline within the native transport’s read timeout, and the run’s beyond any one step', () => {
    for (const template of ANALYSIS_TEMPLATES) {
      for (const step of template.steps) {
        expect(step.bounds.deadlineMilliseconds).toBeGreaterThan(0);
        // ⚠️ Equal, for the summary and the rewrite (#810 set 120 s against
        // this very timeout). Either one ending first is a failed step.
        expect(step.bounds.deadlineMilliseconds).toBeLessThanOrEqual(
          ANALYSIS_READ_TIMEOUT_MILLISECONDS,
        );
        expect(step.bounds.deadlineMilliseconds).toBeLessThan(RUN_BUDGET_MILLISECONDS);
      }
    }
  });
});

// --- Cancellation ---------------------------------------------------------------------------

describe('cancellation', () => {
  it('settles cancelled, issues no further step and discards a reply that arrives late', async () => {
    const clock = manualClock();
    const late = lateReply();
    const port = scriptedPort(clock, [note(1), { late }, note(3), GOOD_SUMMARY]);
    const run = new AbortController();
    const settled = runAnalysis(rideWith(3), { port, clock, signal: run.signal });
    const stepSignal = await late.asked;
    run.abort();
    const outcome = await settled;
    expect(failedAs(outcome)).toBe('cancelled');
    expect(stepSignal.aborted).toBe(true);
    late.release({ kind: 'answered', text: untrusted(note(2).answer), finish: 'stop' });
    await Promise.resolve();
    expect(port.requests).toHaveLength(2);
  });

  it('issues nothing at all for a run cancelled before it starts', async () => {
    const clock = manualClock();
    const port = scriptedPort(clock, [note(1)]);
    const run = new AbortController();
    run.abort();
    const outcome = await runAnalysis(rideWith(1), { port, clock, signal: run.signal });
    expect(failedAs(outcome)).toBe('cancelled');
    expect(port.requests).toHaveLength(0);
  });

  // From four turns on, the abort lands after the run has settled — the
  // outcome was handed over before the rider cancelled, and what to do with it
  // is the caller's (#804). Eight is there to show the boundary exists, so the
  // four above are not passing because every run here ends cancelled.
  it.each([
    [0, 'cancelled'],
    [1, 'cancelled'],
    [2, 'cancelled'],
    [3, 'cancelled'],
    [8, 'written'],
  ] as const)(
    'discards the last step’s reply when the run is cancelled %i turns after it arrives',
    async (turns, expected) => {
      // No step follows the summary on a ride with no sections, so nothing
      // later would notice the cancellation: only the runner's own check does.
      const clock = manualClock();
      const run = new AbortController();
      const port: ModelStepPort = {
        runModelStep: () => {
          let later = Promise.resolve();
          for (let turn = 0; turn < turns; turn += 1) {
            later = later.then(() => undefined);
          }
          void later.then(() => {
            run.abort();
          });
          return Promise.resolve({
            kind: 'answered',
            text: untrusted(GOOD_SUMMARY.answer),
            finish: 'stop',
          });
        },
      };
      const outcome = await runAnalysis(rideWith(0), { port, clock, signal: run.signal });
      expect(outcome.kind === 'written' ? 'written' : outcome.why).toBe(expected);
    },
  );
});

// --- What a failure says ---------------------------------------------------------------------

describe('what a failed run says', () => {
  it('has a fixed sentence for every failure, carrying no address, model name or key', () => {
    const failures: readonly RunFailure[] = [
      'cancelled',
      'out-of-time',
      'out-of-tokens',
      'too-few-sections',
      'no-summary',
      'withheld-by-screen',
    ];
    expect(Object.keys(RUN_FAILURE_TEXT).sort()).toStrictEqual([...failures].sort());
    for (const sentence of Object.values(RUN_FAILURE_TEXT)) {
      expect(sentence).toMatch(/nothing was kept/);
      expect(sentence).not.toMatch(/https?:|\d+\.\d+\.\d+|:\d{2,5}\b|\bkey\b|\bsk-/i);
    }
  });

  it('carries none of the model’s words in a failed outcome', async () => {
    const { outcome } = await run(rideWith(1), [
      note(1),
      { answer: 'MARKER 142° first' },
      { answer: 'MARKER 142° again' },
    ]);
    expect(failedAs(outcome)).toBe('withheld-by-screen');
    expect(JSON.stringify(outcome)).not.toContain('MARKER');
  });
});
