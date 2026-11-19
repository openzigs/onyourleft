// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838: the scoring harness, end to end with **recorded answers** and no
 * model: the instance's own prompt modules loaded as `run-harness.mjs` loads
 * them, the shipped race and the shipped pacer director ridden from answers
 * gemma4:12b gave on the owner's PC (`recorded/`: the bots' of 2026-11-18,
 * the pacer's of 2026-11-19 under `pacer-6`), the scores of each, the results
 * file, and the exit code.
 *
 * `apps/instance` is imported by a computed path, as
 * `src/game/lap-race/model-tactics-port.test.ts` does it: it is not a
 * dependency of the client.
 *
 * ## The recorded answers, and when they go red
 *
 * `recorded/bots-flat-tactics-7.jsonl` is the first twelve answers of the
 * `flat` race and `recorded/pacer-pacer-6.jsonl` the whole scripted ride, as
 * `--record` wrote them. The scores below are what those answers come to
 * through the code as it stands. **A change to the bots' code, the pacer's
 * rules, a race or the script moves them**, and that is the point: record
 * again on a machine with the model and write the new numbers down beside
 * the reason.
 *
 *     node tools/model-tactics-spike/run-harness.mjs bots --race flat --record <file>
 *     node tools/model-tactics-spike/run-harness.mjs pacer --record <file>
 *
 * Only the flat race is held to exact numbers: a climb reaches `Math.atan`
 * in the physics, which is not the same to the last bit on every machine
 * (`model-race-replay.test.ts` §`GOLDEN_RACES`).
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  modelRacingStyles,
  readModelPacerInput,
  readModelTacticsInput,
  type ModelPacerInput,
  type ModelTacticsInput,
} from '@onyourleft/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BOT_RACES, rideBotRace, type BotRace } from './bot-races';
import { main, recordedCalls, recordedText } from './main';
import { recording, type Ask, type ModelCall } from './model-call';
import { PACER_SCRIPT, ridePacerScript } from './pacer-ride';
import { PRODUCTION_MODULES, productionFrom, type Production } from './production';
import type { HarnessResult } from './results';

const INSTANCE = (file: string): string =>
  new URL(`../../../../instance/src/analysis/${file}`, import.meta.url).href;
const RECORDED = (file: string): string =>
  fileURLToPath(new URL(`./recorded/${file}`, import.meta.url));

const FLAT = BOT_RACES.find((race) => race.name === 'flat') as BotRace;

let production: Production;
let scratch: string;

beforeAll(async () => {
  production = productionFrom({
    tactics: (await import(/* @vite-ignore */ INSTANCE(PRODUCTION_MODULES.tactics))) as unknown,
    pacer: (await import(/* @vite-ignore */ INSTANCE(PRODUCTION_MODULES.pacer))) as unknown,
  });
  scratch = mkdtempSync(join(tmpdir(), 'oyl-harness-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Run the harness as `run-harness.mjs` does, its results under a fresh directory. */
async function run(args: readonly string[]): Promise<{
  readonly code: number;
  readonly printed: readonly string[];
  readonly results: readonly HarnessResult[];
  readonly text: string;
}> {
  const directory = mkdtempSync(join(scratch, 'results-'));
  const printed: string[] = [];
  const code = await main([...args, '--results', directory], production, {
    now: () => new Date('2026-11-19T03:00:00.123Z'),
    print: (line) => printed.push(line),
  });
  const texts = readdirSync(directory)
    .sort()
    .map((file) => readFileSync(join(directory, file), 'utf8'));
  return {
    code,
    printed,
    results: texts.map((text) => JSON.parse(text) as HarnessResult),
    text: texts.join('\n'),
  };
}

interface ChatBody {
  readonly model: string;
  readonly think: boolean;
  readonly tools?: unknown;
  readonly options: { readonly seed?: number; readonly temperature: number };
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}

describe('the instance’s own prompt and request', () => {
  it('are the modules the harness sends, and name their versions', () => {
    expect(production.tactics.TACTICS_PROMPT_VERSION).toMatch(/^tactics-\d+$/u);
    expect(production.pacer.PACER_PROMPT_VERSION).toMatch(/^pacer-\d+$/u);
  });

  it('refuses a module that no longer exports what the harness sends', () => {
    expect(() =>
      productionFrom({ tactics: { TACTICS_PROMPT_VERSION: 'tactics-9' }, pacer: production.pacer }),
    ).toThrow(/tacticsRequest/u);
    expect(() => productionFrom({ tactics: production.tactics, pacer: undefined })).toThrow(
      /PACER_PROMPT_VERSION/u,
    );
  });
});

describe('a bot race, ridden with the instance’s request', () => {
  it('sends the instance’s body with the race’s seed, and nothing else changed', async () => {
    const bodies: ChatBody[] = [];
    const ask: Ask = (body) => {
      bodies.push(body as unknown as ChatBody);
      return Promise.resolve({ text: undefined, latencyMs: 1_000 });
    };
    await rideBotRace(FLAT, { ask, model: 'a-model', prompt: production.tactics }, 12);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const [first, second] = bodies as [ChatBody, ChatBody];
    // Fixed seeds, in the harness only: the instance's own request carries none.
    expect(first.options.seed).toBe(FLAT.seed * 1_000 + 1);
    expect(second.options.seed).toBe(FLAT.seed * 1_000 + 2);
    const input = JSON.parse(first.messages[1]?.content ?? '') as ModelTacticsInput;
    expect(readModelTacticsInput(input).ok).toBe(true);
    expect(input.bots).toHaveLength(7);
    // The field is the one the race's own seed deals, every time.
    expect(input.bots.map((view) => view.style)).toEqual(modelRacingStyles(FLAT.seed, 7));
    const own = production.tactics.tacticsRequest('a-model', input) as unknown as ChatBody;
    expect(own.options.seed).toBeUndefined();
    expect(first).toEqual({ ...own, options: { ...own.options, seed: first.options.seed } });
    expect(first.tools).toBeUndefined();
    expect(first.messages[0]?.role).toBe('system');
  });

  it('rides an answer from the race time it would have arrived, and never a late one', async () => {
    const attack = (input: ModelTacticsInput): string =>
      JSON.stringify({
        bots: input.bots.map((view) => ({ bot: view.bot, move: 'attack', effort: 'all-out' })),
      });
    const answering =
      (latencyMs: number): Ask =>
      (body) =>
        Promise.resolve({
          text: attack(
            JSON.parse(
              (body as unknown as ChatBody).messages[1]?.content ?? '',
            ) as ModelTacticsInput,
          ),
          latencyMs,
        });
    const rider = { model: 'a-model', prompt: production.tactics };
    const prompt = await rideBotRace(FLAT, { ...rider, ask: answering(2_000) }, 12);
    // Asked at 4 s, arrived at 6 s: nobody attacks before, everybody after.
    const attacking = prompt.samples.map(
      (sample) => sample.tactics.filter((tactic) => tactic === 'attack').length,
    );
    expect(attacking.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(attacking[7]).toBe(7);
    expect(prompt.log[0]).toMatchObject({
      askedAtMs: 4_000,
      arrivedAtMs: 6_000,
      outcome: 'decision',
    });
    // The same answer 9 s after its ask is past the race's limit: never ridden.
    const late = await rideBotRace(FLAT, { ...rider, ask: answering(9_000) }, 20);
    expect(late.log[0]).toMatchObject({ askedAtMs: 4_000, outcome: 'late' });
    expect(
      late.samples.some((sample) => sample.tactics.filter((t) => t === 'attack').length === 7),
    ).toBe(false);
  });

  it('reads a text that is no decision as the instance does: invalid, and nothing ridden', async () => {
    const ask: Ask = () => Promise.resolve({ text: '{"bots":"all of them"}', latencyMs: 1_000 });
    const ridden = await rideBotRace(
      FLAT,
      { ask, model: 'a-model', prompt: production.tactics },
      8,
    );
    expect(ridden.log[0]).toMatchObject({ outcome: 'invalid', reason: 'tactics_invalid' });
  });
});

describe('the flat race from recorded answers', () => {
  let ridden: Awaited<ReturnType<typeof run>>;

  beforeAll(async () => {
    ridden = await run([
      'bots',
      '--race',
      'flat',
      '--seconds',
      '60',
      '--replay',
      RECORDED('bots-flat-tactics-7.jsonl'),
    ]);
  });

  it('scores the first minute as recorded', () => {
    expect(ridden.results).toHaveLength(1);
    const [result] = ridden.results as [HarnessResult];
    if (result.kind !== 'bots') throw new Error('a bots result');
    expect(result).toMatchObject({
      promptVersion: production.tactics.TACTICS_PROMPT_VERSION,
      model: 'gemma4:12b',
      measuredAt: '2026-11-19T03:00:00Z',
    });
    expect(result.races.map((race) => [race.race, race.seed])).toEqual([['flat', 11]]);
    expect(result.races[0]?.score).toEqual(FLAT_FIRST_MINUTE);
  });

  it('exits 0: six of seven bots moved, with no quiet second, and every answer was a decision', () => {
    expect(ridden.code).toBe(0);
    const [result] = ridden.results as [HarnessResult];
    expect(result.passed).toBe(true);
    if (result.kind !== 'bots') throw new Error('a bots result');
    expect(result.races[0]).toMatchObject({ passed: true, shortfalls: [] });
    expect(ridden.printed[0]).toMatch(/^bots flat: 6 of 7 bots moved \(4 told to\), .*: pass$/u);
    expect(ridden.printed.at(-1)).toBe('PASS');
  });

  it('exits 1 for a race that got no answer: the seeded race is not what was asked', async () => {
    const silent = await run([
      'bots',
      '--race',
      'flat',
      '--seconds',
      '20',
      '--replay',
      replayFile('no-answers.jsonl', []),
    ]);
    expect(silent.code).toBe(1);
    const [result] = silent.results as [HarnessResult];
    if (result.kind !== 'bots') throw new Error('a bots result');
    expect(result.passed).toBe(false);
    expect(result.races[0]?.score).toMatchObject({ seconds: 20, decisions: 0 });
    expect(result.races[0]?.score.failedAnswers).toBeGreaterThan(0);
    expect(result.races[0]?.shortfalls).toContainEqual({
      mark: 'decisionShare',
      scored: 0,
      asked: 0.9,
    });
    expect(silent.printed.at(-1)).toBe('FAIL: below the pass mark');
  });

  it('writes a results file of numbers only: no move the model wrote, no race state', () => {
    expect(ridden.text).not.toMatch(/sit-in|flyer|"bots":\s*\[|riderGapM/u);
  });
});

/** What `recorded/bots-flat-tactics-7.jsonl` comes to over the flat race's first minute. */
const FLAT_FIRST_MINUTE = {
  bots: 7,
  seconds: 60,
  scoredFromS: 8,
  botsMoved: 6,
  botsToldToMove: 4,
  climbers: 1,
  attacksOnClimbsByClimbers: 0,
  sprinters: 2,
  sprintersKicked: 0,
  longestQuietRunS: 0,
  blownBots: 0,
  leadChanges: 13,
  answers: 12,
  decisions: 12,
  lateAnswers: 0,
  invalidAnswers: 0,
  failedAnswers: 0,
  answerMs: { median: 3_555, p90: 4_420, most: 4_447 },
  promptTokens: { median: 2_353, p90: 2_359, most: 2_362 },
  outputTokens: { median: 72, p90: 107, most: 107 },
};

/** A pacer's line for the `at`th ask: sixty-four of them, no two alike, and none that names a move. */
function line(at: number): string {
  const starts = ['Lovely', 'Tidy', 'Smooth', 'Bright', 'Calm', 'Sharp', 'Crisp', 'Neat'];
  const ends = [
    'pedalling there.',
    'rhythm today.',
    'legs on show.',
    'riding from you.',
    'work on the pedals.',
    'spin right now.',
    'effort so far.',
    'line through here.',
  ];
  return `${starts[at % 8] as string} ${ends[Math.floor(at / 8) % 8] as string}`;
}

/** A model that answers the pacer's `at`th ask with `answer(at)`, 1.4 s later. */
function pacerModel(
  answer: (at: number) => Readonly<Record<string, unknown>> = (at) => ({ say: line(at) }),
): {
  readonly ask: Ask;
  readonly bodies: ChatBody[];
} {
  const bodies: ChatBody[] = [];
  return {
    bodies,
    ask: (body) => {
      bodies.push(body as unknown as ChatBody);
      return Promise.resolve({
        text: JSON.stringify(answer(bodies.length)),
        latencyMs: 1_400,
        promptTokens: 1_500,
        outputTokens: 40,
      });
    },
  };
}

/** `calls` as a file `--replay` reads. */
function replayFile(name: string, calls: readonly ModelCall[]): string {
  const file = join(scratch, name);
  writeFileSync(file, recordedText(calls));
  return file;
}

/** Ride the script with `model`, then score it from its recorded answers as `main` does. */
async function scored(
  name: string,
  model: ReturnType<typeof pacerModel>,
): Promise<{ readonly ridden: Awaited<ReturnType<typeof run>>; readonly result: PacerResult }> {
  const kept = recording(model.ask);
  await ridePacerScript({ ask: kept.ask, model: 'a-model', prompt: production.pacer });
  const ridden = await run(['pacer', '--replay', replayFile(name, kept.calls)]);
  const [result] = ridden.results as [HarnessResult];
  if (result.kind !== 'pacer') throw new Error('a pacer result');
  return { ridden, result };
}

type PacerResult = Extract<HarnessResult, { kind: 'pacer' }>;

describe('the scripted pacer ride, ridden with the instance’s request', () => {
  it('sends the instance’s body with the script’s seed, and states the instance would read', async () => {
    const model = pacerModel();
    // The state each ask was built from, as the instance's request is handed it.
    const inputs: ModelPacerInput[] = [];
    const ridden = await ridePacerScript({
      ask: model.ask,
      model: 'a-model',
      prompt: {
        pacerRequest: (name, input) => {
          inputs.push(input);
          return production.pacer.pacerRequest(name, input);
        },
      },
    });
    // One ask every five seconds of the five minutes.
    expect(ridden.steps.map((step) => step.askedAtS)).toEqual(
      Array.from({ length: 60 }, (_, at) => at * 5),
    );
    const [first, second] = model.bodies as [ChatBody, ChatBody];
    expect(first.options.seed).toBe(PACER_SCRIPT.seed * 1_000);
    expect(second.options.seed).toBe(PACER_SCRIPT.seed * 1_000 + 1);
    const input = inputs[1] as ModelPacerInput;
    expect(readModelPacerInput(input).ok).toBe(true);
    const own = production.pacer.pacerRequest('a-model', input) as unknown as ChatBody;
    expect(own.options.seed).toBeUndefined();
    expect(second).toEqual({ ...own, options: { ...own.options, seed: second.options.seed } });
    expect(second.tools).toBeUndefined();
    // The rider's sensors, the pacer's own last line and the device's decision are in the state, as on a ride.
    expect(input).toMatchObject({
      cadenceRpm: 88,
      heartRateBpm: 132,
      recentLines: [line(1)],
      intent: 'hold',
      reason: 'rider-level',
    });
  });

  it('puts the rider in every place the script names', async () => {
    const ridden = await ridePacerScript({
      ask: pacerModel().ask,
      model: 'a-model',
      prompt: production.pacer,
    });
    const seen = new Set(
      ridden.steps.map(
        ({ ground }) =>
          `${String(ground.riderPlace)} ${String(ground.gapTrend)} ${ground.terrain}${ground.riderInDraft ? ' in-draft' : ''}`,
      ),
    );
    for (const place of [
      'level steady none in-draft',
      'behind rider-losing none',
      'behind rider-gaining none',
      'ahead rider-gaining none',
      'ahead steady none',
      'ahead rider-losing none',
      'level steady before-climb in-draft',
      'level steady descent in-draft',
    ]) {
      expect([...seen]).toContain(place);
    }
  });

  it('rides the device’s decision at every place, the gap’s call, and never an ease with the rider ahead', async () => {
    const ridden = await ridePacerScript({
      ask: pacerModel().ask,
      model: 'a-model',
      prompt: production.pacer,
    });
    const at = (askedAtS: number): string => {
      const found = ridden.steps.find((step) => step.askedAtS === askedAtS);
      return `${String(found?.ridden)} ${String(found?.reason)}`;
    };
    expect([at(10), at(45), at(110), at(195), at(240), at(275)]).toEqual([
      'hold rider-level',
      'ease rider-behind',
      'lift rider-ahead',
      'ease before-climb',
      'hold rider-level',
      'lift descent',
    ]);
    expect(
      ridden.steps.filter((step) => step.ground.riderPlace === 'ahead').map((step) => step.ridden),
    ).not.toContain('ease');
  });

  it('passes a model that writes a new line each time: exit 0', async () => {
    const { ridden, result } = await scored('new-lines.jsonl', pacerModel());
    expect(ridden.printed.at(-1)).toBe('PASS');
    expect(ridden.code).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.shortfalls).toEqual([]);
    expect(result.score).toMatchObject({
      answers: 60,
      applied: 60,
      intentsCalledFor: 60,
      easedWithRiderAhead: 0,
      linesShown: 60,
      linesWritten: 60,
      distinctLines: 60,
      repeatedLines: 0,
      linesHiddenRepeat: 0,
      linesHiddenAgainst: 0,
      linesVoided: 0,
      answerMs: { median: 1_400, p90: 1_400, most: 1_400 },
    });
  });

  it('voids a model that still names its intent, and the device rides the gap’s call all the same: exit 1', async () => {
    const { ridden, result } = await scored(
      'names-intent.jsonl',
      pacerModel((at) => ({ plan: 'rolling', intent: 'ease', say: line(at) })),
    );
    expect(ridden.code).toBe(1);
    expect(result.score).toMatchObject({
      answers: 60,
      applied: 0,
      invalidAnswers: 60,
      intentsCalledFor: 60,
      easedWithRiderAhead: 0,
      linesShown: 0,
      linesVoided: 60,
    });
    expect(result.shortfalls.map((short) => short.mark)).toEqual([
      'distinctLineShare',
      'voidedLineShare',
      'appliedShare',
    ]);
  });

  it('hides a line said again and a line against the intent, and fails a model that says them: exit 1', async () => {
    const { ridden, result } = await scored(
      'one-line.jsonl',
      pacerModel(() => ({ say: 'I am easing off so you can catch me.' })),
    );
    expect(ridden.code).toBe(1);
    const { score } = result;
    // Shown once where the device eased, hidden after as a repeat, and hidden as against wherever it held or lifted.
    expect(score.linesShown).toBe(1);
    expect(score.linesHiddenRepeat).toBeGreaterThan(0);
    expect(score.linesHiddenAgainst).toBeGreaterThan(0);
    expect(score.linesShown + score.linesHiddenRepeat + score.linesHiddenAgainst).toBe(60);
    expect(score.linesWritten).toBe(score.linesShown + score.linesHiddenRepeat);
    expect(score.distinctLines).toBe(1);
    expect(result.shortfalls.map((short) => short.mark)).toEqual([
      'distinctLineShare',
      'voidedLineShare',
    ]);
  });

  it('counts a line the screen stops or a key the answer may not carry as voided, and an answer past the limit as late', async () => {
    let asked = 0;
    const ask: Ask = () => {
      asked += 1;
      return Promise.resolve(
        asked === 2
          ? { text: JSON.stringify({ say: 'Ride for 20 minutes.' }), latencyMs: 1_000 }
          : asked === 3
            ? { text: JSON.stringify({ say: '' }), latencyMs: 6_000 }
            : asked === 4
              ? { text: undefined, latencyMs: 1_000 }
              : asked === 5
                ? { text: JSON.stringify({ watts: 300, say: 'Good.' }), latencyMs: 1_000 }
                : asked === 6
                  ? { text: 'not an answer', latencyMs: 1_000 }
                  : { text: JSON.stringify({ say: '' }), latencyMs: 1_000 },
      );
    };
    const ridden = await ridePacerScript({ ask, model: 'a-model', prompt: production.pacer });
    expect(ridden.steps.slice(0, 6).map((step) => [step.outcome, step.line])).toEqual([
      ['applied', 'none'],
      ['invalid', 'voided'],
      ['late', 'none'],
      ['failed', 'none'],
      ['invalid', 'voided'],
      ['invalid', 'none'],
    ]);
    // Each was ridden as the device decided, whatever the answer.
    expect(ridden.steps.slice(0, 6).map((step) => step.ridden)).toEqual(
      Array.from({ length: 6 }, () => 'hold'),
    );
  });
});

describe('the scripted pacer ride from recorded answers', () => {
  let ridden: Awaited<ReturnType<typeof run>>;

  beforeAll(async () => {
    ridden = await run(['pacer', '--replay', RECORDED('pacer-pacer-6.jsonl')]);
  });

  it('scores the ride as recorded', () => {
    const [result] = ridden.results as [HarnessResult];
    if (result.kind !== 'pacer') throw new Error('a pacer result');
    expect(result.promptVersion).toBe(production.pacer.PACER_PROMPT_VERSION);
    expect(result.score).toEqual({
      answers: 60,
      applied: 59,
      lateAnswers: 0,
      invalidAnswers: 1,
      failedAnswers: 0,
      intentsCalledFor: 60,
      easedWithRiderAhead: 0,
      linesShown: 58,
      linesWritten: 59,
      distinctLines: 57,
      repeatedLines: 2,
      linesHiddenRepeat: 1,
      linesHiddenAgainst: 0,
      linesVoided: 1,
      answerMs: { median: 3_234, p90: 3_761, most: 4_416 },
      promptTokens: { median: 1_848, p90: 1_872, most: 1_886 },
      outputTokens: { median: 25, p90: 27, most: 28 },
    });
  });

  it('exits 0: every mark is met', () => {
    expect(ridden.code).toBe(0);
    const [result] = ridden.results as [HarnessResult];
    if (result.kind !== 'pacer') throw new Error('a pacer result');
    expect(result.shortfalls).toEqual([]);
  });

  it('writes a results file of numbers only: none of the model’s lines', async () => {
    const calls = await recordedCalls(RECORDED('pacer-pacer-6.jsonl'));
    const lines = calls.map((call) => (JSON.parse(call.text ?? '{}') as { say: string }).say);
    expect(lines.filter((said) => said.length > 10).length).toBeGreaterThan(50);
    for (const said of lines) expect(ridden.text).not.toContain(said);
    expect(ridden.text).not.toMatch(/"say"|riderGapM/u);
  });

  it('prints each ask in closed words, and never a line', () => {
    const asks = ridden.printed.filter((printed) => /^pacer +\d+ s:/u.test(printed));
    expect(asks).toHaveLength(60);
    expect(asks[8]).toBe(
      'pacer    40 s: behind rider-losing none: called for ease, rode ease (rider-behind), applied, line shown',
    );
    // The line the screen stopped named a distance; the device rode its decision all the same.
    expect(asks[39]).toBe(
      'pacer   195 s: level steady in-draft before-climb: called for ease, rode ease (before-climb), invalid, line voided',
    );
    expect(asks.filter((printed) => printed.includes('(NOT CALLED FOR)'))).toHaveLength(0);
  });
});

describe('a command the harness cannot read', () => {
  it.each([
    [['ride']],
    [[]],
    [['bots', '--race', 'alpe']],
    [['bots', '--seconds', 'soon']],
    [['pacer', '--host', 'pc', '--url', 'http://127.0.0.1:11434']],
    [['pacer', '--record', 'a', '--replay', 'b']],
    [['pacer', 'extra']],
    // A prompt is never sent off the machine that has the model.
    [['pacer', '--url', 'http://models.example:11434']],
    [['pacer', '--host', '-oProxyCommand=x']],
  ])('exits 2 for %j, and asks no model', async (args) => {
    const ridden = await run(args);
    expect(ridden.code).toBe(2);
    expect(ridden.results).toEqual([]);
  });

  it('exits 2 for a replay file --record did not write', async () => {
    const file = join(scratch, 'not-a-recording.jsonl');
    writeFileSync(file, '{"calls":[]}\n');
    const ridden = await run(['pacer', '--replay', file]);
    expect(ridden.code).toBe(2);
    expect(ridden.printed).toEqual(['--replay takes a file --record wrote']);
  });
});
