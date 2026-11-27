// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The scoring harness for AI bot races and AI pacer rides** — #2838.
 *
 * Run by hand, on the machine that has the model or beside it, **before any
 * change to a prompt, a schema or the model for the bots or the pacer**, and
 * never by a gate: CI has no model.
 *
 *     node tools/model-tactics-spike/run-harness.mjs all
 *     node tools/model-tactics-spike/run-harness.mjs bots --race climb
 *     node tools/model-tactics-spike/run-harness.mjs pacer --host <ssh host>
 *
 * - `bots` rides the six fixed races (`bot-races.ts`), `pacer` the scripted
 *   ride (`pacer-ride.ts`), `all` both.
 * - The model is Ollama on this machine's loopback, or with `--host` on the
 *   loopback of a machine reached over SSH (`model-call.ts`). `--url` names
 *   another loopback port, and `--model` another model than
 *   {@link HARNESS_MODEL}.
 * - `--race <name>[,<name>]` rides only the races named, for a quick look
 *   while tuning, and `--seconds <n>` each for at most that long.
 * - `--record <file>` also writes every answer of the run to `<file>`, and
 *   `--replay <file>` rides from such a file with no model: how the recorded
 *   answers under `recorded/`, which `harness.test.ts` scores, were made.
 *   Recorded answers hold the model's text, so they are never a results file.
 * - `--results <directory>` writes the results there and not under the
 *   tool's `results/scores/`. A replay writes results only with it.
 *
 * It sends **the instance's own prompt and request** (`production.ts`),
 * scores what came back (`bot-score.ts`, `pacer-score.ts`), prints the
 * scores, writes one results file a run for each of the two, numbers only
 * (`results.ts`), and **exits 1 below a pass mark**, 0 at or above it, and 2
 * for a command it cannot read.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { missingValue, option } from '../options';

import { BOT_RACES, rideBotRace } from './bot-races';
import { BOT_PASS_MARK, botRaceShortfalls, scoreBotRace, type Shortfall } from './bot-score';
import { ollamaAsk, recordedAsk, recording, type Ask, type ModelCall } from './model-call';
import { ridePacerScript } from './pacer-ride';
import { intentsCalledFor, PACER_PASS_MARK, pacerShortfalls, scorePacerRide } from './pacer-score';
import type { Production } from './production';
import { resultFileName, resultFileText, type BotRaceResult, type HarnessResult } from './results';

/** The model a run asks unless `--model` names another: the one the owner's instance runs (2026-11-14). */
export const HARNESS_MODEL = 'gemma4:12b';

/** Ollama's own loopback address. */
const OLLAMA_LOOPBACK = 'http://127.0.0.1:11434';

/** Where results are written, beside the spike's own (a path, not a `new URL`, which the trainer walk reads as an import). */
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'results', 'scores');

const USAGE =
  'usage: run-harness.mjs bots|pacer|all [--host <ssh host> | --url <loopback origin>] [--model <name>] [--race <name>[,<name>]] [--seconds <n>] [--record <file> | --replay <file>] [--results <directory>]\n';

/** What a caller may set for a run: the clock, and where lines are printed. */
export interface HarnessOptions {
  readonly now?: () => Date;
  readonly print?: (line: string) => void;
}

const shortfallLine = (short: readonly Shortfall[]): string =>
  short.length === 0
    ? 'pass'
    : `BELOW THE PASS MARK: ${short
        .map((each) => `${each.mark} ${String(each.scored)} (asked ${String(each.asked)})`)
        .join(', ')}`;

/** Ride and score the bot races named, or all six. */
async function bots(
  ask: Ask,
  model: string,
  production: Production,
  only: readonly string[] | undefined,
  mostSeconds: number | undefined,
  measuredAt: () => string,
  print: (line: string) => void,
): Promise<HarnessResult> {
  const races: BotRaceResult[] = [];
  for (const race of BOT_RACES) {
    if (only !== undefined && !only.includes(race.name)) continue;
    const run = await rideBotRace(race, { ask, model, prompt: production.tactics }, mostSeconds);
    const score = scoreBotRace(run);
    const shortfalls = botRaceShortfalls(score, run.hasClimb);
    races.push({
      race: race.name,
      seed: race.seed,
      passed: shortfalls.length === 0,
      shortfalls,
      score,
    });
    print(
      `bots ${race.name}: ${String(score.botsMoved)} of ${String(score.bots)} bots moved (${String(score.botsToldToMove)} told to), longest quiet run ${String(score.longestQuietRunS)} s, ${String(score.attacksOnClimbsByClimbers)} climber attacks on a climb, ${String(score.sprintersKicked)} of ${String(score.sprinters)} sprinters kicked, ${String(score.blownBots)} blown, ${String(score.leadChanges)} lead changes; ${String(score.decisions)} of ${String(score.answers)} answers decisions, ${String(score.lateAnswers)} late, median ${String(score.answerMs.median)} ms, ${String(score.promptTokens.median)} tokens in, ${String(score.outputTokens.median)} out: ${shortfallLine(shortfalls)}`,
    );
  }
  return {
    kind: 'bots',
    promptVersion: production.tactics.TACTICS_PROMPT_VERSION,
    model,
    measuredAt: measuredAt(),
    passed: races.every((race) => race.passed),
    passMark: BOT_PASS_MARK,
    races,
  };
}

/** Ride and score the pacer's script. */
async function pacer(
  ask: Ask,
  model: string,
  production: Production,
  measuredAt: () => string,
  print: (line: string) => void,
): Promise<HarnessResult> {
  const run = await ridePacerScript({ ask, model, prompt: production.pacer });
  const score = scorePacerRide(run);
  const shortfalls = pacerShortfalls(score);
  // Each ask in closed words, so a ride can be read without the lines: where
  // the rider was, what that called for, what the device rode and why, and
  // what became of the answer and its line.
  for (const step of run.steps) {
    const { ground } = step;
    const called = intentsCalledFor(ground);
    print(
      `pacer ${String(step.askedAtS).padStart(5)} s: ${ground.riderPlace ?? 'no-place'} ${ground.gapTrend ?? 'no-trend'}${ground.riderInDraft ? ' in-draft' : ''} ${ground.terrain}: called for ${called.join('|')}, rode ${step.ridden} (${step.reason})${called.includes(step.ridden) ? '' : ' (NOT CALLED FOR)'}, ${step.outcome}, line ${step.line}`,
    );
  }
  print(
    `pacer: ${String(score.intentsCalledFor)} of ${String(score.decisions)} decisions rode what the gap called for, ${String(score.easedWithRiderAhead)} eased with the rider ahead; ${String(score.distinctLines)} distinct of ${String(score.linesWritten)} lines written, ${String(score.repeatedLines)} repeated, ${String(score.linesShown)} shown, ${String(score.linesHiddenRepeat)} hidden as repeats, ${String(score.linesHiddenAgainst)} hidden as against the intent, ${String(score.linesVoided)} void answers; ${String(score.applied)} of ${String(score.answers)} answers applied, ${String(score.lateAnswers)} late, median ${String(score.answerMs.median)} ms, ${String(score.promptTokens.median)} tokens in, ${String(score.outputTokens.median)} out: ${shortfallLine(shortfalls)}`,
  );
  return {
    kind: 'pacer',
    promptVersion: production.pacer.PACER_PROMPT_VERSION,
    model,
    measuredAt: measuredAt(),
    passed: shortfalls.length === 0,
    passMark: PACER_PASS_MARK,
    shortfalls,
    score,
  };
}

/**
 * The answers of a recorded run, read from `file`: JSON Lines, one call a
 * line, as `--record` writes them.
 *
 * @throws {Error} for a file that is not one.
 */
export async function recordedCalls(file: string): Promise<readonly ModelCall[]> {
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.trim() !== '');
  return lines.map((line) => {
    let call: unknown;
    try {
      call = JSON.parse(line);
    } catch {
      call = undefined;
    }
    if (
      typeof call !== 'object' ||
      call === null ||
      typeof (call as { latencyMs?: unknown }).latencyMs !== 'number'
    ) {
      throw new Error('--replay takes a file --record wrote');
    }
    return call as ModelCall;
  });
}

/** `calls` as `--record` writes them: JSON Lines, one call a line. */
export function recordedText(calls: readonly ModelCall[]): string {
  return calls.map((call) => `${JSON.stringify(call)}\n`).join('');
}

/**
 * Run the harness. Returns the exit code: 0 at or above every pass mark, 1
 * below one, 2 for a command it cannot read.
 */
export async function main(
  args: readonly string[],
  production: Production,
  options: HarnessOptions = {},
): Promise<number> {
  const print =
    options.print ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  const [withoutHost, host] = option(args, '--host');
  const [withoutUrl, url] = option(withoutHost, '--url');
  const [withoutModel, modelArg] = option(withoutUrl, '--model');
  const [withoutRace, raceArg] = option(withoutModel, '--race');
  const race = raceArg?.split(',');
  const [withoutRecord, record] = option(withoutRace, '--record');
  const [withoutReplay, replay] = option(withoutRecord, '--replay');
  const [withoutResults, resultsArg] = option(withoutReplay, '--results');
  const [rest, secondsArg] = option(withoutResults, '--seconds');
  const mostSeconds = secondsArg === undefined ? undefined : Number(secondsArg);
  const [command, ...extra] = rest;
  const known = command === 'bots' || command === 'pacer' || command === 'all';
  const flags = [
    '--host',
    '--url',
    '--model',
    '--race',
    '--record',
    '--replay',
    '--results',
    '--seconds',
  ];
  if (
    !known ||
    missingValue(args, flags) !== undefined ||
    extra.length > 0 ||
    (mostSeconds !== undefined && !(Number.isInteger(mostSeconds) && mostSeconds > 0)) ||
    (host !== undefined && url !== undefined) ||
    (record !== undefined && replay !== undefined) ||
    (race !== undefined && !race.every((name) => BOT_RACES.some((each) => each.name === name)))
  ) {
    print(USAGE + `races: ${BOT_RACES.map((each) => each.name).join(', ')}`);
    return 2;
  }
  const model = modelArg ?? HARNESS_MODEL;
  let source: Ask;
  try {
    source =
      replay !== undefined
        ? recordedAsk(await recordedCalls(replay))
        : ollamaAsk(
            host !== undefined
              ? { kind: 'ssh', host }
              : { kind: 'loopback', origin: url ?? OLLAMA_LOOPBACK },
          );
  } catch (error) {
    print(error instanceof Error ? error.message : 'the model could not be set up');
    return 2;
  }
  // Load the model before anything is timed, as the instance's warm-up does
  // for a race: one token of an answer to one word, which is not scored.
  if (replay === undefined) {
    await source({
      model,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { num_predict: 1 },
      messages: [{ role: 'user', content: 'Ready?' }],
    });
  }
  const kept = recording(source);
  const now = options.now ?? ((): Date => new Date());
  const measuredAt = (): string =>
    now()
      .toISOString()
      .replace(/\.\d+Z$/u, 'Z');
  const results: HarnessResult[] = [];
  if (command !== 'pacer') {
    results.push(await bots(kept.ask, model, production, race, mostSeconds, measuredAt, print));
  }
  if (command !== 'bots') results.push(await pacer(kept.ask, model, production, measuredAt, print));
  // A replay is a run already written down: it writes results only where it is told to.
  const directory = resultsArg ?? (replay === undefined ? RESULTS : undefined);
  if (directory !== undefined) {
    await mkdir(directory, { recursive: true });
    for (const result of results) {
      const text = resultFileText(result);
      const file = join(directory, resultFileName(result));
      await writeFile(file, text);
      print(`wrote ${file}`);
    }
  }
  if (record !== undefined) await writeFile(record, recordedText(kept.calls));
  const passed = results.every((result) => result.passed);
  print(passed ? 'PASS' : 'FAIL: below the pass mark');
  return passed ? 0 : 1;
}
