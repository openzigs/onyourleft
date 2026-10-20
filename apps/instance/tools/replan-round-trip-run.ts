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
 *
 * **A hosted model** ({@link MeasureOptions.hosted}) is measured the same way,
 * on a key of the measurer's own: each account stores it, consents to its
 * origin and pushes an empty masking item, the three things a hosted job is
 * refused without, and the key and the consent are cleared when the run ends,
 * however it ends.
 *
 * ⚠️ **What "sealed" is worth here.** The app seals only to a key judged
 * against an identity it pinned from the instance's card (ADR 0047 D-5, D-6).
 * This tool pins nothing and checks no statement: it seals to whatever
 * encryption key `/v1/instance/keys` at the URL serves. So a hosted run is
 * refused unless the URL is `https:` or loopback, and over `https:` the key
 * is sealed to whoever terminates TLS for that name — for a tunnel, the
 * tunnel's operator, the very party ADR 0047 seals against.
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
  /** Why the job could not be read back for its own times, when it could not: the socket's code. */
  readonly unread?: string;
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

/** The name of the one place the hosted key is read from: the environment, never the command line. */
export const HOSTED_KEY_VARIABLE = 'OYL_MEASURE_HOSTED_KEY';

/**
 * A hosted model on a key of the measurer's own (ADR 0046 D-9, #1199).
 *
 * ⚠️ **`key` is a secret.** It goes into exactly one place — the sealed body
 * of `POST /v1/analysis/hosted/key` — and into no log line, no error and no
 * part of the report.
 */
export interface HostedOptions {
  /** The service's `https:` OpenAI-compatible base URL. */
  readonly url: string;
  readonly model: string;
  readonly key: string;
}

/**
 * The command's `--hosted-url` and `--hosted-model`, with the key from
 * {@link HOSTED_KEY_VARIABLE} in `environment`: `undefined` when neither
 * option is given, and a refusal when only one is or the variable is unset.
 */
export function hostedFromCommand(
  url: string | undefined,
  model: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): HostedOptions | undefined {
  if (url === undefined && model === undefined) return undefined;
  if (url === undefined || model === undefined) {
    throw new Error('--hosted-url and --hosted-model go together: give both, or neither');
  }
  const key = environment[HOSTED_KEY_VARIABLE];
  if (key === undefined || key === '') {
    throw new Error(
      `${HOSTED_KEY_VARIABLE} is not set: a hosted model is measured on a key read from that environment variable and from nowhere else (never the command line)`,
    );
  }
  return { url, model, key };
}

/** `localhost`, 127.0.0.0/8 or `[::1]`, as `URL` writes a host: an address that does not leave this machine. */
function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/** The last line a hosted run writes when an account could not be read back as cleared. */
export const KEY_NOT_CLEARED =
  '⚠️ the hosted key could NOT be confirmed cleared from every account: revoke the key at its provider';

/** What an interrupted measurement rejects with when every account it took was cleared. */
export const INTERRUPTED = 'the measurement was interrupted; every account it took was cleared';

/**
 * Why `given` — a command line's arguments — cannot be run, or `undefined`:
 * an option that is not one of `known`, or a word that is no option's value.
 * Every option takes one value.
 *
 * ⚠️ **It names an option and never a value**: a mistaken `--hosted-key sk-…`
 * is refused without the key being written again, `--hosted-key-sk-…` is
 * named `--hosted-key` alone, and a name longer than every option's is not
 * repeated at all (#1270).
 */
export function refusedArguments(
  given: readonly string[],
  known: readonly string[],
): string | undefined {
  for (let index = 0; index < given.length; index += 1) {
    const word = given[index] ?? '';
    if (known.includes(word)) {
      index += 1;
      continue;
    }
    if (!word.startsWith('--')) return 'an argument that is no option’s value was given';
    const name = /^--[A-Za-z0-9-]*/.exec(word)?.[0] ?? '--';
    if (name.startsWith('--hosted-key')) {
      return `--hosted-key is not an option: the hosted key is read from ${HOSTED_KEY_VARIABLE} and never from the command line`;
    }
    // A name longer than every option's may be a value glued on with a hyphen.
    const longest = Math.max(0, ...known.map((option) => option.length));
    return name.length > longest
      ? 'an option this command does not have was given (its name is too long to repeat)'
      : `${name} is not an option of this command`;
  }
  return undefined;
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
  /**
   * Measure a hosted model instead of the instance's local one: every account
   * stores the key, records consent for the URL and pushes an empty masking
   * item, and every job asks for `instance-hosted`. Sealed only, and never
   * with {@link MeasureOptions.unload}: there is nothing of a hosted model to
   * unload, so a hosted measurement has no cold runs.
   */
  readonly hosted?: HostedOptions;
  /**
   * Stops the measurement (#1270): no run or account is begun after it, a key
   * being sent is waited for, every account that may hold one is cleared, and
   * the measurement rejects with {@link INTERRUPTED} — or with
   * {@link KEY_NOT_CLEARED} when an account could not be read back as cleared.
   */
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
}

/** The two sources a job may name (`src/analysis/source.ts`). */
export type MeasuredSource = 'instance-local' | 'instance-hosted';

export interface MeasureReport {
  readonly startedAt: string;
  readonly url: string;
  readonly transport: Transport;
  /** Which model every job of this report ran on. */
  readonly source: MeasuredSource;
  /**
   * For `instance-hosted`: the origin the requests went to and the model
   * asked for — never the key. `cleared` is whether EVERY account this run
   * stored the key on read back, afterwards, as holding no key and no consent.
   */
  readonly hosted?: { readonly origin: string; readonly model: string; readonly cleared: boolean };
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
export interface Device {
  call(method: string, path: string, body?: unknown): Promise<Answer>;
  /** Follow an event stream; `onEvent` returns `true` to stop. */
  stream(
    path: string,
    onEvent: (kind: string, data: string) => boolean,
    signal: AbortSignal,
  ): Promise<void>;
  /** Milliseconds spent sealing and opening since the last call of this. */
  takeCrypto(): { sealMs: number; openMs: number };
  /**
   * Body bytes sent and received by {@link Device.call} since the last call of
   * this (#1106): the sealed envelope and the sealed reply as they crossed the
   * wire, without HTTP's own headers.
   */
  takeBytes(): { sent: number; received: number };
}

function codeOf(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The socket's own code (`ECONNRESET`) when `error` is a connection that
 * broke, and `undefined` for anything else: a refused request, a frame that
 * will not open and an event that is not JSON are faults to stop on, not runs
 * to count.
 */
function socketCode(error: unknown): string | undefined {
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : undefined;
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

/**
 * A device signed in to `url`, over `transport`: a new key each time, or
 * `given` (#464's race load run brings one per rider).
 *
 * `refuseRedirects` makes every request fail on a redirect instead of
 * following it (#1270): a hosted run's key is in its sealed requests, and an
 * `https:` address that answered 307 to an `http:` one would carry them there
 * — and a redirected `/v1/instance/keys` would choose the key they are sealed to.
 */
export async function signedInDevice(
  url: string,
  origin: string,
  transport: Transport,
  displayName: string,
  given?: webcrypto.CryptoKeyPair,
  refuseRedirects = false,
): Promise<Device> {
  const redirect: RequestInit['redirect'] = refuseRedirects ? 'error' : 'follow';
  const pair =
    given ??
    ((await webcrypto.subtle.generateKey({ name: 'Ed25519' }, false, [
      'sign',
      'verify',
    ])) as unknown as webcrypto.CryptoKeyPair);
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
  let sentBytes = 0;
  let receivedBytes = 0;
  let instanceKey: SealedInstanceKey | undefined;

  const seal = async (
    method: string,
    path: string,
    body: unknown,
  ): Promise<{ sealed: SealedRequest; response: Response }> => {
    if (instanceKey === undefined) {
      const served = (await (await fetch(`${url}/v1/instance/keys`, { redirect })).json()) as {
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
    sentBytes += utf8Encode(envelope).length;
    const response = await fetch(`${url}${SEALED_PATH}`, {
      method: 'POST',
      redirect,
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
      redirect,
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
    receivedBytes += utf8Encode(raw).length;
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
        redirect,
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

  // The challenge is plaintext on every instance; every session is sealed on
  // one that holds keys (#1192, #1210).
  const challenge = (await (
    await fetch(`${url}/v1/auth/challenge`, {
      method: 'POST',
      redirect,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey }),
    })
  ).json()) as { nonce?: string; error?: { code?: unknown } };
  if (typeof challenge.nonce !== 'string') {
    // The code, when there is one, so a caller can wait out `rate_limited` (#464).
    const code = codeOf(challenge);
    throw new Error(
      code === undefined ? 'the instance gave no challenge' : `the challenge was refused: ${code}`,
    );
  }
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
  sentBytes = 0;
  receivedBytes = 0;

  return {
    call,
    stream,
    takeBytes: () => {
      const taken = { sent: sentBytes, received: receivedBytes };
      sentBytes = 0;
      receivedBytes = 0;
      return taken;
    },
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
  source: MeasuredSource,
): Promise<RunRecord> {
  device.takeCrypto();
  const began = performance.now();
  const sentWall = Date.now();
  const started = await device.call('POST', '/v1/analysis/jobs', {
    input: syntheticInput(variant),
    templateVersion: '1',
    source,
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
    if (!timeout.aborted) {
      lost = socketCode(error);
      if (lost === undefined) throw error;
    }
  }
  if (result === undefined) {
    await device.call('POST', `/v1/analysis/jobs/${jobId}/cancel`).catch(() => undefined);
    resultAt = performance.now() - began;
  }

  // The job's own times are a refinement: a read that fails costs them, and says so.
  let unread: string | undefined;
  const read = await device.call('GET', `/v1/analysis/jobs/${jobId}`).catch((error: unknown) => {
    unread = socketCode(error) ?? 'unknown';
    return undefined;
  });
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
    ...(unread === undefined ? {} : { unread }),
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

/** The body of the `masking` item a throwaway account pushes: no word and no zone, nobody's. */
const EMPTY_MASKING_ITEM = JSON.stringify({ words: [], zones: [] });

/**
 * What a hosted job needs of its account (`src/analysis/source.ts`): the key
 * stored, the consent naming the key's origin, and a masking item that reads.
 *
 * ⚠️ A refusal names the step, the instance's code and the fields at fault —
 * never the instance's sentence about them, so nothing that was sent can come
 * back into an error message.
 */
async function prepareHosted(device: Device, hosted: HostedOptions): Promise<void> {
  const steps: readonly (readonly [string, string, unknown])[] = [
    [
      'the hosted key',
      '/v1/analysis/hosted/key',
      { url: hosted.url, model: hosted.model, key: hosted.key },
    ],
    ['the hosted consent', '/v1/analysis/hosted/consent', { endpoint: hosted.url }],
    ['the masking item', '/v1/sync/items/masking/guard', { body: EMPTY_MASKING_ITEM }],
  ];
  for (const [what, path, body] of steps) {
    const answer = await device.call('POST', path, body);
    if (answer.status === 200) continue;
    const fields = (answer.body as { error?: { fields?: { field?: unknown }[] } } | null)?.error
      ?.fields;
    const named = (fields ?? []).map((each) => String(each.field)).join(', ');
    throw new Error(
      `${what} was refused: ${codeOf(answer.body) ?? String(answer.status)}${named === '' ? '' : ` (${named})`}`,
    );
  }
}

/** How many times an account's clean-up is tried before it is reported as not confirmed. */
const CLEAR_ATTEMPTS = 3;
/** The wait before the second clean-up attempt; each later one waits twice as long. */
const CLEAR_RETRY_MS = 500;

/**
 * Clear the key and withdraw the consent of every account that may hold one,
 * then read each back the way a device does. An account that does not read
 * back empty is tried again, {@link CLEAR_ATTEMPTS} times in all (#1270), and
 * is then reported as not confirmed.
 */
async function clearHosted(
  holding: readonly { readonly account: number; readonly device: Device }[],
  log: (line: string) => void,
): Promise<boolean> {
  let cleared = true;
  for (const { account, device } of holding) {
    let gone = false;
    for (let attempt = 1; attempt <= CLEAR_ATTEMPTS && !gone; attempt += 1) {
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, CLEAR_RETRY_MS * 2 ** (attempt - 2)));
      }
      await device.call('DELETE', '/v1/analysis/hosted/key').catch(() => undefined);
      await device.call('DELETE', '/v1/analysis/hosted/consent').catch(() => undefined);
      const read = await device.call('GET', '/v1/analysis/hosted').catch(() => undefined);
      const settings =
        read?.status === 200 ? (read.body as { key?: unknown; consent?: unknown } | null) : null;
      gone = settings?.key === null && settings.consent === null;
    }
    if (!gone) cleared = false;
    log(
      gone
        ? `account ${String(account)}: the hosted key and consent are cleared`
        : `account ${String(account)}: ⚠️ could NOT confirm the hosted key and consent are cleared — revoke the key at its provider`,
    );
  }
  return cleared;
}

function known(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

/**
 * `value` as a URL, or a refusal naming `option` (#1270). `URL`'s own error
 * quotes its input, and a key pasted after the wrong option would be written
 * out again with it.
 */
function parsedUrl(value: string, option: string): URL {
  const parsed = URL.parse(value);
  if (parsed === null) throw new Error(`${option} is not a URL`);
  return parsed;
}

export async function measure(options: MeasureOptions): Promise<MeasureReport> {
  const reached = parsedUrl(options.url, '--url');
  const url = reached.origin;
  const origin = options.origin ?? url;
  const log = options.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const loadBefore = loadavg()[0] ?? 0;
  const hosted = options.hosted;
  if (hosted !== undefined && options.transport !== 'sealed') {
    throw new Error(
      'a hosted model is measured over the sealed transport only: the instance takes a hosted key sealed and never in plaintext',
    );
  }
  if (hosted !== undefined && options.unload !== undefined) {
    throw new Error(
      'a hosted model has nothing to unload, so it has no cold runs: drop --unload (and --cold-runs)',
    );
  }
  if (hosted !== undefined && reached.protocol !== 'https:' && !isLoopback(reached.hostname)) {
    throw new Error(
      'a hosted model is measured through an https: or a loopback --url only: this tool seals the key to whatever encryption key that address serves, and over plain http: to another machine anything on the path can serve its own',
    );
  }
  const hostedOrigin =
    hosted === undefined ? undefined : parsedUrl(hosted.url, '--hosted-url').origin;
  const source: MeasuredSource = hosted === undefined ? 'instance-local' : 'instance-hosted';
  /** Every account that was, or was about to be, sent the key, and is not yet cleared. */
  const holding: { account: number; device: Device }[] = [];
  /** Whether every account cleared so far read back empty. */
  let cleared = true;
  /** The key being sent to an account, while it is: an interruption waits for it. */
  let preparing: Promise<void> | undefined;
  const signal = options.signal;
  // A call, not a field read: an await can change it, which narrowing would not see.
  const stopped = (): boolean => signal?.aborted === true;

  let device: Device | undefined;
  let starts = 0;
  let accounts = 0;
  let jobs = 0;
  const next = async (run: number, cold: boolean): Promise<RunRecord> => {
    // Nothing is begun once interrupted: no run, and no account sent the key.
    if (stopped()) throw new Error(INTERRUPTED);
    if (device === undefined || starts >= options.startsPerAccount) {
      // An account done with is cleared now, not when the whole run ends (#1270).
      cleared = (await clearHosted(holding.splice(0), log)) && cleared;
      accounts += 1;
      device = await signedInDevice(
        url,
        origin,
        options.transport,
        `Measure ${String(accounts)}`,
        undefined,
        hosted !== undefined,
      );
      starts = 0;
      if (hosted !== undefined) {
        if (stopped()) throw new Error(INTERRUPTED);
        // Listed before the key is sent: a set-up that fails half way is cleared too.
        holding.push({ account: accounts, device });
        preparing = prepareHosted(device, hosted);
        try {
          await preparing;
        } finally {
          preparing = undefined;
        }
      }
    }
    starts += 1;
    jobs += 1;
    const record = await oneRun(device, run, cold, options.runTimeoutMs, jobs, source);
    log(
      `${cold ? 'cold' : 'warm'} ${String(run)}: ${record.status}${record.failure === undefined ? '' : `:${record.failure}`} in ${record.totalMs.toFixed(0)} ms, ${String(record.steps.length)} steps`,
    );
    return record;
  };

  let warmUp: RunRecord | null = null;
  const warm: RunRecord[] = [];
  const cold: RunRecord[] = [];
  const runAll = async (): Promise<void> => {
    // One run nobody counts: it loads the model, so the first warm run is warm.
    if (options.runs > 0) warmUp = await next(0, false);
    for (let run = 1; run <= options.runs; run += 1) warm.push(await next(run, false));
    if (options.unload !== undefined) {
      for (let run = 1; run <= options.coldRuns; run += 1) {
        await options.unload();
        cold.push(await next(run, true));
      }
    }
  };
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(INTERRUPTED));
    if (stopped()) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  let failed: { readonly error: unknown } | undefined;
  try {
    // An interruption does not wait for the run in flight: that run may take minutes.
    await Promise.race([runAll(), interrupted]);
  } catch (error) {
    failed = { error };
  }
  if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  // A key on its way to an account is let arrive, so that it is cleared too.
  await preparing?.catch(() => undefined);
  // However the run ended, the key does not outlive it on the instance.
  cleared = (await clearHosted(holding.splice(0), log)) && cleared;
  if (failed !== undefined) {
    if (stopped() && !cleared) throw new Error(KEY_NOT_CLEARED);
    throw failed.error;
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
    source,
    ...(hosted === undefined || hostedOrigin === undefined
      ? {}
      : { hosted: { origin: hostedOrigin, model: hosted.model, cleared } }),
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
