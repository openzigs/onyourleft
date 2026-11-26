// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the live measurements, run by hand from a development
 * machine and never by a gate. `run-live.mjs` loads this through Vite's module
 * runner, as `tools/basemap/run-compare.mjs` does, because the race step's
 * import graph reaches `.tsx` that Node will not strip.
 *
 *     node tools/model-tactics-spike/run-live.mjs bench --host <ssh host>
 *     node tools/model-tactics-spike/run-live.mjs race flat --host <ssh host>
 *     node tools/model-tactics-spike/run-live.mjs race hilly --host <ssh host>
 *     node tools/model-tactics-spike/run-live.mjs compare
 *
 * `--run <name>` reads and writes `results/<name>/` instead of `results/`:
 * #2708's tuned prompt is `--run 2708`, beside spike 0039's first run, and
 * #2720's prompt under ADR 0073's rules is `--run 2720`. `race` takes
 * `--seed <n>` to ride one seed, for a quick look while tuning. A race writes
 * the rules it rode under into each log (`rules`); `compare` replays each log
 * under its own, and a log that names none under ADR 0071's. A flag given
 * with no value is refused with exit 2 (#2715, `options.ts`), so a forgotten
 * `--run` name never writes over the first run's logs in `results/`.
 *
 * Ollama on the instance PC listens on 127.0.0.1 only and has no
 * authentication, so it is never exposed: each call runs `curl.exe` on that
 * machine over SSH, the body on standard input. The latency booked in race
 * time is the **server's** own `total_duration`, what an instance calling
 * Ollama on its own loopback waits; the SSH leg is logged beside it as
 * `wallMs` and left out.
 *
 * `bench` writes `results/latency.json`, unloading the model first so that
 * its cold row is a cold load (#2708). ⚠️ That unload (`keep_alive: 0`)
 * evicts `gemma4:12b`, **the model the instance writes its ride write-ups
 * with**: run `bench` only when no write-up is running on the instance, or
 * the write-up and the instance's next job pay a cold load (#2715). `race`
 * and `compare` unload nothing. `race` writes one decision log per
 * seed, `results/<circuit>-<seed>.json`, which `replay.test.ts` replays,
 * with a SHA-256 of the live run's whole trace (#2708); `compare` rides each
 * field seeded and from its log, with no network, and writes
 * `results/comparison.json`, the write-up's table: whether the replay's
 * outcome counts are the live run's, and, where the log carries the live
 * trace's digest, whether its whole trace is.
 *
 * Spike code: see `decision.ts`.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { MODEL_RULES_BEFORE_2720, type ModelRules } from './adapter';
import { decisionRequest, MODEL_TACTICS_MODEL } from './ollama';
import { modelInput } from './model-input';
import { fieldNumbers } from './compare';
import { parseModelDecision } from './decision';
import { missingValue, option } from './options';
import type { LoggedDecision } from './decision-log';
import {
  fieldTrace,
  NO_OUTCOMES,
  quietSeconds,
  rideField,
  SPIKE_CIRCUITS,
  SPIKE_RIDDEN_SECONDS,
  SPIKE_SEEDS,
  type FieldRun,
  type ModelCall,
  type SpikeCircuit,
} from './race';

/** Where the results are written, beside this file (a path, not a `new URL`, which the trainer walk reads as an import). */
const RESULTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'results');

/** The directory this run reads and writes, from `--run`: set by {@link main}. */
let RESULTS = `${RESULTS_ROOT}/`;

/** The SHA-256 of a field's whole trace: what a replay of its log must match to the bit. */
function traceDigest(run: FieldRun): string {
  return createHash('sha256').update(fieldTrace(run)).digest('hex');
}

/** What Ollama's `/api/chat` answers, in the fields read here. */
interface ChatAnswer {
  readonly message?: { readonly content?: string; readonly thinking?: string };
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
  readonly error?: string;
}

interface Timed {
  readonly answer: ChatAnswer | undefined;
  readonly wallMs: number;
  readonly failed?: string;
}

/** The SSH host of the instance PC, from `--host`: set by {@link main} before any call. */
let sshHost: string | undefined;

function host(): string {
  // A host that starts with `-` would be read by ssh as an option.
  if (sshHost === undefined || sshHost === '' || sshHost.startsWith('-')) {
    throw new Error('run-live.mjs needs --host <ssh host>');
  }
  return sshHost;
}

/** One `/api/chat` call on the instance PC, over SSH. */
function chat(body: Readonly<Record<string, unknown>>): Promise<Timed> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        host(),
        "curl.exe -s http://127.0.0.1:11434/api/chat -H 'Content-Type: application/json' --data-binary '@-'",
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.on('close', () => {
      const wallMs = performance.now() - started;
      try {
        resolve({ answer: JSON.parse(out) as ChatAnswer, wallMs });
      } catch {
        resolve({ answer: undefined, wallMs, failed: 'unreadable answer' });
      }
    });
    child.stdin.end(JSON.stringify(body));
  });
}

const ms = (nanoseconds: number | undefined): number | undefined =>
  nanoseconds === undefined ? undefined : Math.round(nanoseconds / 1e6);

/** A {@link ModelCall} from a timed answer. */
function modelCall(timed: Timed): ModelCall {
  const { answer } = timed;
  const serverMs = ms(answer?.total_duration);
  if (answer === undefined || answer.error !== undefined || serverMs === undefined) {
    return {
      text: undefined,
      latencyMs: timed.wallMs,
      failed: answer?.error ?? timed.failed ?? 'no answer',
      wallMs: Math.round(timed.wallMs),
    };
  }
  return {
    text: answer.message?.content ?? '',
    latencyMs: serverMs,
    promptTokens: answer.prompt_eval_count,
    outputTokens: answer.eval_count,
    serverMs,
    wallMs: Math.round(timed.wallMs),
  };
}

/** The input every bench call asks about: the flat field of seed 1, 60 s in. */
async function benchInput(): Promise<ReturnType<typeof modelInput>> {
  const run = await rideField('flat', 1, { kind: 'seeded' }, 60);
  const ride = run.last;
  return modelInput(
    ride.race,
    ride.bots,
    SPIKE_CIRCUITS.flat,
    ride.seed,
    ride.draft,
    200 / 75,
    quietSeconds(run.ticks, ride.race.atMs),
  );
}

/**
 * A write-up-sized job: about 6 000 tokens of synthetic ride notes in, up to
 * 1 200 out. Synthetic so that no rider's data is sent anywhere.
 */
function writeUpRequest(): Readonly<Record<string, unknown>> {
  const lines = Array.from(
    { length: 360 },
    (_, minute) =>
      `Minute ${String(minute)}: power ${String(180 + ((minute * 37) % 90))} W, cadence ${String(80 + ((minute * 13) % 15))} rpm, grade ${String(((minute * 7) % 9) - 4)} %.`,
  );
  return {
    model: MODEL_TACTICS_MODEL,
    stream: false,
    think: false,
    keep_alive: '30m',
    options: { temperature: 0.6, seed: 7, num_predict: 1200 },
    messages: [
      {
        role: 'system',
        content: 'You are a cycling coach. Write a detailed analysis of the ride.',
      },
      { role: 'user', content: lines.join('\n') },
    ],
  };
}

interface Sample {
  readonly serverMs: number | undefined;
  readonly wallMs: number;
  readonly promptTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly valid: boolean;
  readonly thinkingCharacters?: number;
}

function sample(timed: Timed, bots: number): Sample {
  const content = timed.answer?.message?.content ?? '';
  return {
    serverMs: ms(timed.answer?.total_duration),
    wallMs: Math.round(timed.wallMs),
    promptTokens: timed.answer?.prompt_eval_count,
    outputTokens: timed.answer?.eval_count,
    valid: parseModelDecision(content, bots).ok,
    thinkingCharacters: timed.answer?.message?.thinking?.length ?? 0,
  };
}

async function bench(): Promise<void> {
  const input = await benchInput();
  const bots = input.bots.length;
  const ask = (seed: number, think: boolean): Promise<Timed> =>
    chat({ ...decisionRequest(input, bots, seed), think });
  // Unload the model (Ollama's documented `keep_alive: 0` with no
  // messages), so that the first call loads it: a cold load, measured.
  await chat({ model: MODEL_TACTICS_MODEL, messages: [], keep_alive: 0 });
  const cold = await ask(0, false);
  const coldLoadMs = ms(cold.answer?.load_duration);
  const coldServerMs = ms(cold.answer?.total_duration);
  const alone: Sample[] = [];
  for (let at = 1; at <= 20; at += 1) alone.push(sample(await ask(at, false), bots));
  const thinking: Sample[] = [];
  for (let at = 1; at <= 3; at += 1) thinking.push(sample(await ask(at, true), bots));
  // Beside a write-up: two write-up jobs in turn, decision calls asked one
  // after another while each runs.
  const beside: Sample[] = [];
  const writeUps: { serverMs: number | undefined; wallMs: number }[] = [];
  for (let job = 0; job < 2; job += 1) {
    let running = true;
    const writeUp = chat(writeUpRequest()).then((timed) => {
      running = false;
      writeUps.push({
        serverMs: ms(timed.answer?.total_duration),
        wallMs: Math.round(timed.wallMs),
      });
    });
    // Let the write-up reach the server first.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    let seed = 100 + job * 50;
    while (running) {
      beside.push(sample(await ask(seed, false), bots));
      seed += 1;
    }
    await writeUp;
  }
  await mkdir(RESULTS, { recursive: true });
  await writeFile(
    `${RESULTS}latency.json`,
    `${JSON.stringify(
      {
        model: MODEL_TACTICS_MODEL,
        measuredOn: new Date().toISOString().slice(0, 10),
        promptCharacters: JSON.stringify(input).length,
        coldLoadMs,
        coldServerMs,
        alone,
        thinking,
        beside,
        writeUps,
      },
      null,
      2,
    )}\n`,
  );
}

/** A one-line look at a ridden field, for tuning: its shares of each move, and its outcomes. */
function summary(name: string, run: FieldRun): string {
  const numbers = fieldNumbers(run, 'rider');
  const t = numbers.tacticShare;
  const share = (value: number): string => `${(value * 100).toFixed(1)}%`;
  return `${name}: attack ${share(t.attack)} flyer ${share(t.flyer)} follow ${share(t.follow)} chase ${share(t.chase)} sit-in ${share(t['sit-in'])}; lead changes ${String(numbers.leadChanges)}, movers ${String(numbers.movers)}, blown ${String(numbers.blownBots)} (over CP ${String(numbers.blownOverCpTicks)}), on the rider's wheel ${String(numbers.onRiderWheelTicks)} ticks, ${String(numbers.riderTargets)} aimed at the rider; ${JSON.stringify(run.outcomes)}\n`;
}

async function race(circuit: SpikeCircuit, only: number | undefined): Promise<void> {
  await mkdir(RESULTS, { recursive: true });
  for (const seed of SPIKE_SEEDS) {
    if (only !== undefined && seed !== only) continue;
    let call = 0;
    const run = await rideField(circuit, seed, {
      kind: 'live',
      decide: async (input) => {
        call += 1;
        return modelCall(
          await chat(decisionRequest(input, input.bots.length, seed * 1_000 + call)),
        );
      },
    });
    await writeFile(
      `${RESULTS}${circuit}-${String(seed)}.json`,
      `${JSON.stringify(
        {
          model: MODEL_TACTICS_MODEL,
          circuit,
          seed,
          seconds: SPIKE_RIDDEN_SECONDS,
          rules: 'adr-0073' satisfies ModelRules,
          outcomes: run.outcomes,
          traceSha256: traceDigest(run),
          log: run.log,
        },
        null,
        2,
      )}\n`,
    );
    process.stderr.write(summary(`${circuit} ${String(seed)}`, run));
  }
}

/**
 * The comparison, with no network: each field ridden seeded and from its
 * recorded log; whether the replay's outcome counts are the live run's; and,
 * for a log that carries the live trace's digest, whether the replay's whole
 * trace is (`null` for spike 0039's first logs, which carry none).
 */
async function compare(): Promise<void> {
  const fields = [];
  for (const circuit of ['flat', 'hilly'] as const) {
    for (const seed of SPIKE_SEEDS) {
      const recorded = JSON.parse(
        await readFile(`${RESULTS}${circuit}-${String(seed)}.json`, 'utf8'),
      ) as {
        readonly log: readonly LoggedDecision[];
        readonly outcomes: Readonly<Record<string, number>>;
        readonly traceSha256?: string;
        readonly rules?: ModelRules;
      };
      const rules = recorded.rules ?? MODEL_RULES_BEFORE_2720;
      const seeded = await rideField(circuit, seed, { kind: 'seeded' });
      const model = await rideField(circuit, seed, { kind: 'log', log: recorded.log, rules });
      fields.push({
        circuit,
        seed,
        rules,
        // A log written before #2720 has no count for its two new outcomes, which were 0.
        outcomeCountsMatchLive:
          JSON.stringify(model.outcomes) ===
          JSON.stringify({ ...NO_OUTCOMES, ...recorded.outcomes }),
        traceMatchesLive:
          recorded.traceSha256 === undefined ? null : traceDigest(model) === recorded.traceSha256,
        outcomes: model.outcomes,
        seeded: fieldNumbers(seeded, 'rider'),
        model: fieldNumbers(model, 'rider'),
      });
    }
  }
  await writeFile(`${RESULTS}comparison.json`, `${JSON.stringify(fields, null, 2)}\n`);
}

/** Run `bench`, `race flat` / `race hilly`, or `compare`. Returns the exit code. */
export async function main(args: readonly string[]): Promise<number> {
  const missing = missingValue(args, ['--host', '--run', '--seed']);
  if (missing !== undefined) {
    process.stderr.write(`${missing} takes a value\n`);
    return 2;
  }
  const [withoutHost, hostArg] = option(args, '--host');
  sshHost = hostArg;
  const [withoutRun, run] = option(withoutHost, '--run');
  const [rest, seedArg] = option(withoutRun, '--seed');
  if (run !== undefined && !/^[a-z0-9-]+$/u.test(run)) {
    process.stderr.write('--run takes a name of lower-case letters, numbers and dashes\n');
    return 2;
  }
  RESULTS = run === undefined ? `${RESULTS_ROOT}/` : `${join(RESULTS_ROOT, run)}/`;
  const seed = seedArg === undefined ? undefined : Number(seedArg);
  if (seed !== undefined && !(SPIKE_SEEDS as readonly number[]).includes(seed)) {
    process.stderr.write(`--seed takes one of ${SPIKE_SEEDS.join(', ')}\n`);
    return 2;
  }
  const [command, circuit] = rest;
  if (command === 'bench') {
    await bench();
    return 0;
  }
  if (command === 'compare') {
    await compare();
    return 0;
  }
  if (command === 'race' && (circuit === 'flat' || circuit === 'hilly')) {
    await race(circuit, seed);
    return 0;
  }
  process.stderr.write(
    'usage: run-live.mjs bench --host <h> | race flat|hilly --host <h> [--seed <n>] | compare; each takes --run <name>\n',
  );
  return 2;
}
