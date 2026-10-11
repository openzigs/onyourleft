// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The round-trip measurement's device (#1235) — `replan-round-trip.ts` is the
 * command. Exported apart from it so `replan-round-trip.test.ts` can run the
 * same code against an instance on this machine with a scripted model.
 *
 * A throwaway device signs in, starts an analysis job (#1095), follows its
 * event stream to `result`, and writes down when each thing happened — over
 * the sealed transport (ADR 0047) or, for the control, in plaintext against
 * an instance that holds no keys.
 *
 * ⚠️ **It measures the job that exists, which is a ride write-up.** No
 * re-plan job type is built (#1243, #1244 wait on this measurement), so the
 * input is a synthetic ride in `RideAnalysisInput`'s shape and the agent is
 * the write-up agent. What transfers to a re-plan is the cost of one model
 * call, of the transport and of the sealing — not the number of steps.
 *
 * Nothing here is a real ride: {@link syntheticInput} is arithmetic.
 */

import { webcrypto } from 'node:crypto';
import { loadavg } from 'node:os';

import {
  AUTH_PURPOSE,
  deviceStatementBytes,
  fromHex,
  PAD_MINIMUM_BYTES,
  SEALED_END_KIND,
  SEALED_PATH,
  sealRequest,
  SIGNATURE_ALGORITHM,
  toHex,
  utf8Decode,
  utf8Encode,
  type DevicePurpose,
  type SealedInstanceKey,
  type SealedRequest,
  type SigningKey,
} from '@onyourleft/domain';

import { instanceHpkePrimitives } from '../src/auth/crypto.ts';
import { sha256 } from '../src/sealed/sealed.ts';

/**
 * A ride made of round numbers, in `RideAnalysisInput`'s shape (#809). Nobody
 * rode it.
 *
 * ⚠️ **Every run's differs** (`variant` moves its powers and heart rate by a
 * few units). A model server keeps the prompt it last evaluated, so thirty
 * byte-identical jobs would each skip evaluating their input and measure a
 * job no rider ever sends twice. The template and the tool list before the
 * input are the same in every real job too, and stay cached, as they would.
 */
export function syntheticInput(variant: number): Record<string, unknown> {
  const shift = variant % 40;
  return {
    templateVersion: '2',
    ride: { movingMinutes: 45, distanceKilometres: 22.5 },
    rider: { massKilograms: 75, thresholdPower: 250 },
    whole: {
      power: { coverage: 1, mean: 160 + shift, max: 320 + shift },
      heartRate: { coverage: 1, mean: 125 + shift, max: 165 },
    },
    sections: [
      {
        index: 1,
        kind: 'flat',
        minutes: 15,
        distanceKilometres: 8,
        metrics: { power: { coverage: 1, mean: 130 + shift, max: 220 } },
      },
      {
        index: 2,
        kind: 'climb',
        minutes: 20,
        distanceKilometres: 6.5,
        meanGradientPercent: 4,
        elevationGainMetres: 260,
        metrics: { power: { coverage: 1, mean: 200 + shift, max: 320 + shift } },
      },
      {
        index: 3,
        kind: 'descent',
        minutes: 10,
        distanceKilometres: 8,
        metrics: { power: { coverage: 1, mean: 120 + shift, max: 250 } },
      },
    ],
  };
}

export type Transport = 'sealed' | 'plaintext';

/** One event of a job's stream, as the device had it: decrypted, at `atMs` after the run began. */
export interface TimedEvent {
  readonly atMs: number;
  readonly kind: string;
  /** A `progress` event's step, and its tool when it reports one. */
  readonly step?: number;
  readonly tool?: string;
}

/** One model step as the device can see it: from a step's `progress` to the next event. */
export interface StepTiming {
  readonly step: number;
  /** The model call, plus the first tool it asked for or the screening of its text. */
  readonly ms: number;
  /** The tools this step called, by name. */
  readonly tools: readonly string[];
}

export interface RunRecord {
  readonly run: number;
  readonly cold: boolean;
  /**
   * How the job ended: `succeeded`, `failed`, `withheld`, `cancelled`, or here
   * `timed-out` or `connection-lost` (the stream broke before its result;
   * `failure` is then the socket's own code).
   */
  readonly status: string;
  readonly failure?: string;
  /** From before the start request is sealed to the result decrypted on the device. */
  readonly totalMs: number;
  /** Building every envelope this run sent (start, stream, read). 0 in plaintext. */
  readonly sealMs: number;
  /** Opening every reply and event this run received. 0 in plaintext. */
  readonly openMs: number;
  /** The start request: sent to its 202 read. Both directions and the handler. */
  readonly startMs: number;
  /** From the 202 to the first event of the stream: the stream request, and the queue. */
  readonly firstEventMs: number;
  readonly steps: readonly StepTiming[];
  /** From the last step's text to the `result` event: the whole-text screen and the save. */
  readonly afterLastStepMs: number;
  /**
   * The job's own `endedAt − createdAt`, on the instance's clock. `null` when
   * the read failed.
   */
  readonly serverMs: number | null;
  /**
   * `createdAt − sent` and `received − endedAt`. ⚠️ They compare the device's
   * clock with the instance's: read them only when both are one machine's
   * clock, and never across a network.
   */
  readonly upMs: number | null;
  readonly downMs: number | null;
  readonly sections: number;
  readonly withdrawn: number;
  readonly writeUpCharacters: number;
}

/** The steps of a run, from its events: each `progress` without a tool opens one. */
export function stepsOf(events: readonly TimedEvent[]): StepTiming[] {
  const steps: StepTiming[] = [];
  for (const [index, event] of events.entries()) {
    if (event.kind !== 'progress' || event.step === undefined || event.tool !== undefined) continue;
    const next = events[index + 1];
    if (next === undefined) continue;
    const tools: string[] = [];
    for (const later of events.slice(index + 1)) {
      if (later.kind !== 'progress' || later.step !== event.step) break;
      if (later.tool !== undefined) tools.push(later.tool);
    }
    steps.push({ step: event.step, ms: next.atMs - event.atMs, tools });
  }
  return steps;
}

export interface Summary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly min: number;
}

/**
 * Nearest-rank percentiles: the value at `ceil(p × n)`, counted from one. With
 * 30 samples the p95 is the 29th smallest. `null` over nothing, never a zero.
 */
export function summarise(samples: readonly number[]): Summary | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    n: sorted.length,
    p50: round(rank(0.5)),
    p95: round(rank(0.95)),
    max: round(sorted.at(-1) ?? 0),
    min: round(sorted[0] ?? 0),
  };
}

export interface MeasureOptions {
  /** Where the instance is reached: `https://rides.example.org`, or `http://127.0.0.1:8787`. */
  readonly url: string;
  /** The origin the instance states (`OYL_INSTANCE_ORIGIN`); the URL's own unless given. */
  readonly origin?: string;
  readonly transport: Transport;
  /** Warm runs, after one unmeasured run that loads the model. */
  readonly runs: number;
  /** Runs that each follow {@link MeasureOptions.unload}. */
  readonly coldRuns: number;
  /** Unloads the model, before each cold run. Without it no cold run is made. */
  readonly unload?: () => Promise<void>;
  /** A new account after this many starts: the instance allows 12 an hour to each. */
  readonly startsPerAccount: number;
  /** How long one run may take before it is recorded `timed-out` and cancelled. */
  readonly runTimeoutMs: number;
  readonly log?: (line: string) => void;
}

export interface MeasureReport {
  readonly startedAt: string;
  readonly url: string;
  readonly transport: Transport;
  /**
   * The one-minute load average of the machine THIS ran on, before and after.
   * It says how busy the instance was only when the two are one machine.
   */
  readonly deviceLoadAverage: { readonly before: number; readonly after: number };
  readonly warmUp: RunRecord | null;
  readonly warm: readonly RunRecord[];
  readonly cold: readonly RunRecord[];
  /** Over the warm runs that ended `succeeded`. */
  readonly summary: {
    readonly totalMs: Summary | null;
    readonly sealMs: Summary | null;
    readonly openMs: Summary | null;
    readonly startMs: Summary | null;
    readonly firstEventMs: Summary | null;
    readonly stepMs: Summary | null;
    readonly stepsPerRun: Summary | null;
    readonly afterLastStepMs: Summary | null;
    readonly serverMs: Summary | null;
    readonly upMs: Summary | null;
    readonly downMs: Summary | null;
  };
  /** Over the cold runs that ended `succeeded`. */
  readonly coldTotalMs: Summary | null;
  readonly coldFirstStepMs: Summary | null;
  /** How every run ended, warm and cold. */
  readonly statuses: Readonly<Record<string, number>>;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

/** One device and its session, speaking one transport, counting what sealing cost it. */
interface Device {
  call(method: string, path: string, body?: unknown): Promise<Answer>;
  /** Follow an event stream; `onEvent` returns `true` to stop. */
  stream(
    path: string,
    onEvent: (kind: string, data: string) => boolean,
    signal: AbortSignal,
  ): Promise<void>;
  /** Milliseconds spent sealing and opening since the last call of this. */
  takeCrypto(): { sealMs: number; openMs: number };
}

function codeOf(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/** What broke a stream: the socket's code (`ECONNRESET`) where there is one. */
function lostReason(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : 'unknown';
}

/** Every complete block (`\n\n`-ended) of an event stream, as it arrives. */
async function* blocks(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (response.body === null) return;
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      for (let end = pending.indexOf('\n\n'); end >= 0; end = pending.indexOf('\n\n')) {
        yield pending.slice(0, end);
        pending = pending.slice(end + 2);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function field(block: string, name: string): string | undefined {
  const line = block.split('\n').find((each) => each.startsWith(`${name}: `));
  return line?.slice(name.length + 2);
}

async function signedInDevice(
  url: string,
  origin: string,
  transport: Transport,
  displayName: string,
): Promise<Device> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as unknown as webcrypto.CryptoKeyPair;
  const publicKey = toHex(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)));
  const sign = async (bytes: Uint8Array): Promise<Uint8Array> =>
    new Uint8Array(
      await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(bytes)),
    );
  const signer: SigningKey = {
    algorithm: SIGNATURE_ALGORITHM,
    publicKey: fromHex(publicKey, 'the public key'),
    sign,
  };

  // Set once the device has a session; read by every call made after it.
  const session: { token: string | undefined } = { token: undefined };
  let sealMs = 0;
  let openMs = 0;
  let instanceKey: SealedInstanceKey | undefined;

  const seal = async (
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ sealed: SealedRequest; response: Response }> => {
    if (instanceKey === undefined) {
      const served = (await (await fetch(`${url}/v1/instance/keys`)).json()) as {
        statements?: { statement: { keyId: string; encryptionKey: string } }[];
      };
      const newest = served.statements?.at(-1)?.statement;
      if (newest === undefined) {
        throw new Error(
          'the instance serves no encryption key: it has no OYL_INSTANCE_SECRET_KEY, so it cannot be measured sealed',
        );
      }
      instanceKey = {
        keyId: newest.keyId,
        publicKey: fromHex(newest.encryptionKey, 'the encryption key', 32),
      };
    }
    const before = performance.now();
    const sealed = await sealRequest({
      primitives: instanceHpkePrimitives,
      sha256,
      instanceOrigin: origin,
      instanceKey,
      sessionToken: session.token ?? null,
      method,
      path,
      body: body === undefined ? null : utf8Encode(JSON.stringify(body)),
      issuedAt: Math.floor(Date.now() / 1000),
      signer,
      minimumPadding: PAD_MINIMUM_BYTES,
    });
    const envelope = JSON.stringify(sealed.envelope);
    sealMs += performance.now() - before;
    const response = await fetch(`${url}${SEALED_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(session.token === undefined ? {} : { authorization: `Bearer ${session.token}` }),
      },
      body: envelope,
    });
    return { sealed, response };
  };

  const plain = (method: string, path: string, body: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(session.token === undefined ? {} : { authorization: `Bearer ${session.token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    if (transport === 'plaintext') {
      const response = await plain(method, path, body);
      const text = await response.text();
      return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
    }
    const { sealed, response } = await seal(method, path, body);
    const raw = await response.text();
    if (response.status !== 200) {
      return { status: response.status, body: raw === '' ? null : (JSON.parse(raw) as unknown) };
    }
    const before = performance.now();
    const reply = await sealed.openReply(JSON.parse(raw) as unknown);
    const text = utf8Decode(reply.body) ?? '';
    openMs += performance.now() - before;
    return { status: reply.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  const stream: Device['stream'] = async (path, onEvent, signal) => {
    if (transport === 'plaintext') {
      const response = await fetch(`${url}${path}`, {
        headers: { authorization: `Bearer ${session.token ?? ''}` },
        signal,
      });
      if (response.status !== 200) throw new Error(`the stream was refused: ${response.status}`);
      for await (const block of blocks(response, signal)) {
        const kind = field(block, 'event');
        if (kind === undefined) continue;
        if (onEvent(kind, field(block, 'data') ?? '')) return;
      }
      return;
    }
    const { sealed, response } = await seal('GET', path, undefined);
    if (response.status !== 200) {
      throw new Error(`the sealed stream was refused: ${response.status}`);
    }
    const opener = sealed.streamOpener();
    for await (const block of blocks(response, signal)) {
      const frame = field(block, 'data');
      if (frame === undefined) continue;
      const before = performance.now();
      const event = await opener.open(frame);
      const data = utf8Decode(event.data) ?? '';
      openMs += performance.now() - before;
      if (event.kind === SEALED_END_KIND) return;
      if (onEvent(event.kind, data)) return;
    }
  };

  // The challenge is plaintext on every instance; a new key's session is
  // sealed on one that holds keys (#1192).
  const challenge = (await (
    await fetch(`${url}/v1/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    })
  ).json()) as { nonce?: string };
  if (typeof challenge.nonce !== 'string') throw new Error('the instance gave no challenge');
  const statement = {
    purpose: AUTH_PURPOSE as DevicePurpose,
    instanceOrigin: origin,
    nonce: challenge.nonce,
    publicKey,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const answer = await call('POST', '/v1/auth/session', {
    ...statement,
    signature: toHex(await sign(deviceStatementBytes(statement))),
    displayName,
  });
  const sessionToken = (answer.body as { sessionToken?: unknown } | null)?.sessionToken;
  if (answer.status !== 200 || typeof sessionToken !== 'string') {
    throw new Error(
      `signing in was refused: ${codeOf(answer.body) ?? String(answer.status)} (the instance must admit a new device: registration open, or the account approved)`,
    );
  }
  session.token = sessionToken;
  sealMs = 0;
  openMs = 0;

  return {
    call,
    stream,
    takeCrypto: () => {
      const taken = { sealMs, openMs };
      sealMs = 0;
      openMs = 0;
      return taken;
    },
  };
}

/** One job, start to decrypted result, timed. */
async function oneRun(
  device: Device,
  run: number,
  cold: boolean,
  timeoutMs: number,
  variant: number,
): Promise<RunRecord> {
  device.takeCrypto();
  const began = performance.now();
  const sentWall = Date.now();
  const started = await device.call('POST', '/v1/analysis/jobs', {
    input: syntheticInput(variant),
    templateVersion: '1',
    source: 'instance-local',
  });
  const startMs = performance.now() - began;
  const jobId = (started.body as { jobId?: unknown } | null)?.jobId;
  if (started.status !== 202 || typeof jobId !== 'string') {
    throw new Error(`the job was refused: ${codeOf(started.body) ?? String(started.status)}`);
  }

  const events: TimedEvent[] = [];
  let result: { status?: string; failure?: string; writeUp?: string } | undefined;
  let resultAt = 0;
  let receivedWall = 0;
  const timeout = AbortSignal.timeout(timeoutMs);
  let lost: string | undefined;
  try {
    await device.stream(
      `/v1/analysis/jobs/${jobId}/events`,
      (kind, data) => {
        const atMs = performance.now() - began;
        const parsed = JSON.parse(data) as { step?: number; tool?: string };
        events.push({
          atMs,
          kind,
          ...(typeof parsed.step === 'number' ? { step: parsed.step } : {}),
          ...(typeof parsed.tool === 'string' ? { tool: parsed.tool } : {}),
        });
        if (kind !== 'result') return false;
        result = parsed as typeof result;
        resultAt = atMs;
        receivedWall = Date.now();
        return true;
      },
      timeout,
    );
  } catch (error) {
    // A stream cut on the way is a finding, not a reason to lose every run before it.
    if (!timeout.aborted) lost = lostReason(error);
  }
  if (result === undefined) {
    await device.call('POST', `/v1/analysis/jobs/${jobId}/cancel`).catch(() => undefined);
    resultAt = performance.now() - began;
  }

  const read = await device.call('GET', `/v1/analysis/jobs/${jobId}`).catch(() => undefined);
  const job = read?.status === 200 ? (read.body as { createdAt?: number; endedAt?: number }) : {};
  const timed =
    result !== undefined && typeof job.createdAt === 'number' && typeof job.endedAt === 'number'
      ? { createdAt: job.createdAt, endedAt: job.endedAt }
      : undefined;
  const { sealMs, openMs } = device.takeCrypto();
  const steps = stepsOf(events);
  const lastStepEnd = events.findLast((event) => event.kind === 'progress');
  const afterLast =
    lastStepEnd === undefined ? 0 : resultAt - (events[events.indexOf(lastStepEnd) + 1]?.atMs ?? 0);
  return {
    run,
    cold,
    status: result?.status ?? (lost === undefined ? 'timed-out' : 'connection-lost'),
    ...(result?.failure === undefined ? {} : { failure: result.failure }),
    ...(result === undefined && lost !== undefined ? { failure: lost } : {}),
    totalMs: resultAt,
    sealMs,
    openMs,
    startMs,
    firstEventMs: (events[0]?.atMs ?? resultAt) - startMs,
    steps,
    afterLastStepMs: afterLast,
    serverMs: timed === undefined ? null : timed.endedAt - timed.createdAt,
    upMs: timed === undefined ? null : timed.createdAt - sentWall,
    downMs: timed === undefined ? null : receivedWall - timed.endedAt,
    sections: events.filter((event) => event.kind === 'section').length,
    withdrawn: events.filter((event) => event.kind === 'withdrawn').length,
    writeUpCharacters: result?.writeUp?.length ?? 0,
  };
}

function known(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

export async function measure(options: MeasureOptions): Promise<MeasureReport> {
  const url = new URL(options.url).origin;
  const origin = options.origin ?? url;
  const log = options.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const loadBefore = loadavg()[0] ?? 0;

  let device: Device | undefined;
  let starts = 0;
  let accounts = 0;
  let jobs = 0;
  const next = async (run: number, cold: boolean): Promise<RunRecord> => {
    if (device === undefined || starts >= options.startsPerAccount) {
      accounts += 1;
      device = await signedInDevice(url, origin, options.transport, `Measure ${String(accounts)}`);
      starts = 0;
    }
    starts += 1;
    jobs += 1;
    const record = await oneRun(device, run, cold, options.runTimeoutMs, jobs);
    log(
      `${cold ? 'cold' : 'warm'} ${String(run)}: ${record.status} in ${record.totalMs.toFixed(0)} ms, ${String(record.steps.length)} steps`,
    );
    return record;
  };

  // One run nobody counts: it loads the model, so the first warm run is warm.
  const warmUp = options.runs > 0 ? await next(0, false) : null;
  const warm: RunRecord[] = [];
  for (let run = 1; run <= options.runs; run += 1) warm.push(await next(run, false));
  const cold: RunRecord[] = [];
  if (options.unload !== undefined) {
    for (let run = 1; run <= options.coldRuns; run += 1) {
      await options.unload();
      cold.push(await next(run, true));
    }
  }

  const good = warm.filter((record) => record.status === 'succeeded');
  const goodCold = cold.filter((record) => record.status === 'succeeded');
  const statuses: Record<string, number> = {};
  for (const record of [...warm, ...cold]) {
    const key = record.failure === undefined ? record.status : `${record.status}:${record.failure}`;
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  return {
    startedAt,
    url,
    transport: options.transport,
    deviceLoadAverage: { before: loadBefore, after: loadavg()[0] ?? 0 },
    warmUp,
    warm,
    cold,
    summary: {
      totalMs: summarise(good.map((record) => record.totalMs)),
      sealMs: summarise(good.map((record) => record.sealMs)),
      openMs: summarise(good.map((record) => record.openMs)),
      startMs: summarise(good.map((record) => record.startMs)),
      firstEventMs: summarise(good.map((record) => record.firstEventMs)),
      stepMs: summarise(good.flatMap((record) => record.steps.map((step) => step.ms))),
      stepsPerRun: summarise(good.map((record) => record.steps.length)),
      afterLastStepMs: summarise(good.map((record) => record.afterLastStepMs)),
      serverMs: summarise(known(good.map((record) => record.serverMs))),
      upMs: summarise(known(good.map((record) => record.upMs))),
      downMs: summarise(known(good.map((record) => record.downMs))),
    },
    coldTotalMs: summarise(goodCold.map((record) => record.totalMs)),
    coldFirstStepMs: summarise(known(goodCold.map((record) => record.steps[0]?.ms ?? null))),
    statuses,
  };
}
