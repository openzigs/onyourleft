// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Operate** (#2603, epic #2601): what the owner-only Operate area may ask of
 * the instance this device is signed in to, and the one production
 * implementation of it.
 *
 * Every request here goes through `instance-transport.ts`, the ONE module this
 * client sends instance traffic through (#777, ADR 0036 D-3 (a)), SEALED over
 * the session `instance-port.ts` keeps (ADR 0047 D-7): every Operate route on
 * the instance is `sealed: 'only'` (#2602), so a device that cannot seal asks
 * nothing and is told why. No new network module was added for this area.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method of
 * {@link OperatePort} (WIRE003) and every export of this file (WIRE002), and
 * `main.tsx` is the only production code that names {@link createOperatePort}.
 *
 * ## Who is the owner, and how the app finds out
 *
 * The instance names its owner by device key (`OYL_INSTANCE_OWNER_KEY`), and
 * its session read, `GET /v1/auth/account`, says `moderatorRole: 'owner'` to
 * that athlete alone (#775). The deputy is a moderator and NOT the operator
 * (ADR 0046 D-9 Q9, the owner's ruling of 2026-11-14 on #2601), so
 * {@link OperatePort.standing} is `owner` for `'owner'` and nothing else.
 * That is only what the app DRAWS: the instance checks every Operate route
 * itself and answers anybody else `not_found`, as though it were not there.
 *
 * ⚠️ As for Moderation (#957's review), a status alone is not the instance's
 * answer: a proxy's own `404` or `403` is `unreachable`, never "not the owner".
 *
 * ## Nothing secret, nothing that could be a place
 *
 * The log's `detail` is checked here against the instance's own closed grammar
 * (`apps/instance` §`OPERATOR_DETAIL`: words, each optionally `=` a whole
 * number) before it can reach the screen, so a row carrying free text — a key,
 * a token, a coordinate — is not shown at all: the page reads as unreadable.
 * A backup record (#2606) is held the same way: its error is a name or Node's
 * code, its snapshot a `snapshot-<time>` directory NAME, every other field a
 * count or a closed word. The one sentence of the instance's that reaches the
 * screen, a refused "back up now", is held to plain prose with no decimal and
 * no long unbroken word ({@link SENTENCE}), or replaced with the app's own.
 *
 * ## Restore is not here
 *
 * The port can read the backups and ask for one. It has no restore, because
 * the instance has none to call: restore is destructive, stops the instance,
 * and stays on the operator's CLI (#2607). The Operate area shows its steps.
 */

import {
  heldSealedSession,
  type HeldSealedSession,
  type SealingDependencies,
} from './instance-port';
import { MAXIMUM_SEALED_CALL_MILLISECONDS, type InstanceAnswer } from './instance-transport';

/**
 * Whether this device's account is its instance's owner (#2603).
 *
 * - `owner`: the instance says `moderatorRole: 'owner'` over a sealed session.
 * - `not-owner`: any other account the instance answered for, the deputy
 *   included, or one refused before any route (pending, suspended).
 * - `signed-out`: no sign-in on this device, or the instance refused it.
 * - `unreachable`: nothing that was the instance's own answer came back.
 * - `no-keys`: this device cannot seal now — no instance card, a copy of the
 *   app loaded from a website (ADR 0047 D-11), keys refused — or the instance
 *   holds no keys and so offers no Operate area at all (#2602).
 */
export type OperateStanding = 'owner' | 'not-owner' | 'signed-out' | 'unreachable' | 'no-keys';

/** Where an operator log entry was taken. */
export type OperatorLogSource = 'app' | 'cli' | 'admin_tunnel' | 'admin_loopback';

const SOURCES: readonly string[] = ['app', 'cli', 'admin_tunnel', 'admin_loopback'];

/** One entry of the operator log, as the instance pages it (#2602). */
export interface OperatorLogEntry {
  readonly id: number;
  /** When, as ISO 8601 in UTC. */
  readonly at: string;
  /**
   * Taken in the app's Operate area, with the operator's CLI on the host, or
   * on the instance's own admin pages through the tunnel or on the server
   * machine (#2641, ADR 0069 D-8).
   */
  readonly source: OperatorLogSource;
  /** The instance's own name for the action — `backup`, `room_open`, … */
  readonly action: string;
  /** Closed words, each optionally `=` a whole number — or `null`. */
  readonly detail: string | null;
  readonly outcome: 'done' | 'refused' | 'failed';
}

/** One page of the operator log, NEWEST first, and the cursor for the next — `null` at the end. */
export interface OperatorLogPage {
  readonly kind: 'page';
  readonly entries: readonly OperatorLogEntry[];
  readonly next: string | null;
}

/** A page of the log, or why there is none: a standing other than `owner`. */
export type OperatorLogRead =
  OperatorLogPage | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** How many entries one page asks for: a short page, well under the transport's 256 KiB. */
export const OPERATOR_LOG_PAGE = 25;

/** One disk the instance's data is on (#2604). */
export interface OperateDisk {
  readonly holds: 'database' | 'blobs' | 'database_and_blobs';
  readonly freeBytes: number;
  readonly totalBytes: number;
  /** Under a tenth free, as the instance judged it. */
  readonly low: boolean;
}

/** The newest backup's record (#2606): `null` until one is recorded. */
export interface OperateLastBackup {
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly offBox: 'copied' | 'failed' | 'not-configured';
  /** The backup service's interval, in seconds. */
  readonly intervalSeconds: number;
}

/** The instance keys' state, by the instance's own name for it. */
export type OperateKeysState =
  'ready' | 'no-secret' | 'no-origin' | 'no-keys' | 'unreadable' | 'busy';

/** What `GET /v1/operate/status` says (#2604): counts and names, nothing secret. */
export interface OperateStatus {
  readonly kind: 'status';
  /** Whether `GET /ready` would say ready, and each of its checks. */
  readonly ready: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly migrations: 'at-head' | 'migrating' | 'behind' | 'ahead' | 'unknown';
    readonly rooms: boolean;
  };
  readonly version: string;
  /** The deployed commit, 40 lower-case hex, or `null` when the operator named none. */
  readonly commit: string | null;
  /** The instance runs this repository's own source, so its commit may be compared with `main`. */
  readonly upstream: boolean;
  readonly registration: 'open' | 'approval' | 'invite' | 'closed';
  readonly uptimeSeconds: number;
  readonly disk: readonly OperateDisk[];
  readonly lastBackup: OperateLastBackup | null;
  readonly tunnel:
    | { readonly state: 'unknown' | 'not_ready' }
    | { readonly state: 'ready'; readonly connections: number };
  readonly counts: {
    readonly athletes: {
      readonly active: number;
      readonly pending: number;
      readonly suspended: number;
    };
    readonly roomsOpen: number;
    readonly analysis: { readonly queued: number; readonly running: number };
  };
  readonly keys: OperateKeysState;
}

/** The instance's status, or why there is none: a standing other than `owner`. */
export type OperateStatusRead =
  OperateStatus | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** Why the local model is off, by the instance's own code (`apps/instance` §`AnalysisModelOffCode`). */
export const LOCAL_MODEL_STATES = [
  'on',
  'not-set',
  'not-a-url',
  'not-base-url',
  'not-local',
  'tls-by-name',
  'no-model',
  'bad-model',
  'bad-reasoning',
] as const;
export type LocalModelState = (typeof LOCAL_MODEL_STATES)[number];

/** The operator's analysis settings, as `GET /v1/operate/analysis` says them (#2609). Never a key. */
export interface OperateAnalysis {
  readonly kind: 'analysis';
  readonly local: {
    /** The local server's base URL: what a job is built with while `on`. */
    readonly url: string | null;
    readonly model: string | null;
    readonly reasoningTokens: number | null;
    /** Whether the instance offers the local model to riders at all. */
    readonly offered: boolean;
    /** Whether riders other than the owner may use it (ADR 0046 D-9). */
    readonly othersMayUse: boolean;
    /** Where the model's settings come from: this app, the instance's `.env`, or nowhere. */
    readonly setIn: 'app' | 'env' | 'none';
    readonly state: LocalModelState;
  };
  readonly hosted: {
    readonly offered: boolean;
    readonly operatorKey: 'none' | 'held' | 'held-unreadable';
    readonly operatorKeyOrigin: string | null;
  };
}

/** The settings, or why there are none: a standing other than `owner`. */
export type OperateAnalysisRead =
  OperateAnalysis | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** What a save may change: a field left out is unchanged, `null` returns it to its fallback. */
export interface OperateAnalysisChange {
  readonly localModel?: string | null;
  readonly offerLocal?: boolean | null;
  readonly offerHosted?: boolean | null;
  readonly othersLocal?: boolean | null;
}

/** What a save did: the instance's settings after it, refused naming the fields, or a standing. */
export type OperateAnalysisSave =
  | OperateAnalysis
  | { readonly kind: 'refused'; readonly fields: readonly string[] }
  | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** How much of a model is in GPU memory (#2610): of a loaded model only, never guessed. */
export type GpuFit = 'all' | 'part' | 'none' | 'not-loaded' | 'not-reported' | 'not-known';

/** One model the local server offers (#2610). */
export interface LocalModel {
  readonly name: string;
  readonly sizeBytes: number | null;
  readonly parameters: string | null;
  readonly quantisation: string | null;
  readonly tools: 'listed' | 'not-listed' | 'not-reported';
  readonly gpu: GpuFit;
  /** For `part`, the whole percent in GPU memory. */
  readonly gpuPercent: number | null;
}

/** What the local server is, or why it could not be read (#2610). */
export type LocalServerState =
  'ollama' | 'openai-compatible' | 'no-address' | 'not-local' | 'unresolved' | 'unreachable';

export interface LocalModels {
  readonly kind: 'models';
  readonly state: LocalServerState;
  readonly version: string | null;
  readonly models: readonly LocalModel[];
}

export type LocalModelsRead = LocalModels | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** How a tool check went (#2610), by the instance's own word. */
export const TOOL_CHECK_OUTCOMES = [
  'tools-ok',
  'no-tool-call',
  'does-not-support-tools',
  'server-error',
  'not-local',
  'out-of-time',
  'stopped',
  'no-address',
  'busy',
] as const;
export type ToolCheckOutcome = (typeof TOOL_CHECK_OUTCOMES)[number];

export type ToolCheckRead =
  | { readonly kind: 'checked'; readonly outcome: ToolCheckOutcome }
  | { readonly kind: Exclude<OperateStanding, 'owner'> };

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'withheld',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** One analysis job as the owner is shown it (#2610): never which rider, nor what it said. */
export interface OperateJob {
  readonly kind: 'write-up' | 're-plan';
  readonly source: 'local' | 'hosted';
  readonly status: JobStatus;
  readonly failure: string | null;
  /** ISO 8601, UTC. */
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly whose: 'own' | 'other';
}

export interface OperateJobs {
  readonly kind: 'jobs';
  readonly counts: Readonly<Record<JobStatus, number>>;
  readonly failures: readonly { readonly code: string | null; readonly count: number }[];
  readonly recent: readonly OperateJob[];
}

export type OperateJobsRead = OperateJobs | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** One backup run's record (#2606), as `GET /v1/operate/backups` writes it. */
export type OperateBackup =
  | {
      readonly outcome: 'done';
      readonly id: number;
      /** When the run started, ISO 8601, UTC. */
      readonly at: string;
      /** Whole seconds since then, by the instance's clock. */
      readonly ageSeconds: number;
      /** The snapshot directory's NAME, `snapshot-<time>`: never the folder it is in. */
      readonly snapshot: string;
      readonly rows: number;
      readonly blobs: number;
      readonly sizeBytes: number;
      readonly offBox: 'copied' | 'failed' | 'not-configured';
      /** The backup service's interval, or `null` for a one-off such as the pre-deploy snapshot. */
      readonly intervalSeconds: number | null;
      /** Made because the owner asked for it. */
      readonly requested: boolean;
    }
  | {
      readonly outcome: 'failed';
      readonly id: number;
      readonly at: string;
      readonly ageSeconds: number;
      /** The error's name or Node's code (`ENOSPC`), never its message. */
      readonly error: string;
      readonly intervalSeconds: number | null;
      readonly requested: boolean;
    };

/** The backups, NEWEST first, and the "back up now" still waiting, if any. */
export interface OperateBackups {
  readonly kind: 'backups';
  readonly records: readonly OperateBackup[];
  /** When the waiting "back up now" was asked, ISO 8601 — or `null`. */
  readonly pendingSince: string | null;
}

/** The backups, or why there are none: a standing other than `owner`. */
export type OperateBackupsRead =
  OperateBackups | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** What "back up now" did (#2606). */
export type OperateBackUpNow =
  | { readonly kind: 'requested'; readonly requestedAt: string }
  /** `too_many`: one already waits, or one was made in the last 15 minutes. The instance's sentence. */
  | { readonly kind: 'refused'; readonly sentence: string }
  | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** One problem line (#2614): when, the line exactly as logged, and its fields. */
export interface OperateProblem {
  /** ISO 8601, UTC. */
  readonly at: string;
  /** The JSON line exactly as the instance's standard output got it. */
  readonly line: string;
  /** The line's fields: each a number, a boolean, `null` or a short string, as the instance's redaction keeps them. */
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

/** The instance's recent problems, newest first, since it last started (#2614). */
export interface OperateProblems {
  readonly kind: 'problems';
  /** When the instance last started, ISO 8601, UTC. */
  readonly since: string;
  readonly lines: readonly OperateProblem[];
}

/** The problems, or why there are none: a standing other than `owner`. */
export type OperateProblemsRead =
  OperateProblems | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** What the Operate area may ask. */
export interface OperatePort {
  /** The instance's status, read-only (#2604): one sealed request. */
  status(): Promise<OperateStatusRead>;
  /** Whether this device's account is the instance's owner — one sealed request, or none. */
  standing(): Promise<OperateStanding>;
  /** One page of the operator log, newest first: the first, or the one after `cursor`. */
  log(cursor?: string): Promise<OperatorLogRead>;
  /** The operator's analysis settings (#2609). */
  analysis(): Promise<OperateAnalysisRead>;
  /** Save the fields `change` names (#2609): the settings as the instance holds them after. */
  setAnalysis(change: OperateAnalysisChange): Promise<OperateAnalysisSave>;
  /** Every field back to the instance's `.env` (#2609). */
  clearAnalysis(): Promise<OperateAnalysisRead>;
  /** What the local model server offers (#2610). */
  localModels(): Promise<LocalModelsRead>;
  /** Whether `model` on the local server calls tools (#2610). */
  checkModel(model: string): Promise<ToolCheckRead>;
  /** The analysis queue and the newest jobs (#2610). */
  jobs(): Promise<OperateJobsRead>;
  /** The backups the `backup` service recorded, newest first (#2606): read-only. */
  backups(): Promise<OperateBackupsRead>;
  /** Ask the `backup` service for a snapshot now (#2606): it takes it within 30 seconds. */
  backUpNow(): Promise<OperateBackUpNow>;
  /** The instance's recent problem lines (#2614): read-only, and memory only on the instance. */
  problems(): Promise<OperateProblemsRead>;
}

/** Every Operate route is sealed and signed by the owner's device key, so the port needs what a sealed call needs. */
export type OperatePortDependencies = SealingDependencies;

/** A cursor as the instance's `pagination.ts` writes one: base64url, and short. */
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

/** An action's name as the instance writes it: a newer instance may add one this build does not know. */
const ACTION = /^[a-z][a-z0-9_]{0,63}$/;

/** `apps/instance` §`OPERATOR_DETAIL`, the same grammar: no space, no sign, no decimal point. */
const DETAIL = /^[a-z][a-z0-9_]{0,31}(=[0-9]{1,9})?(,[a-z][a-z0-9_]{0,31}(=[0-9]{1,9})?){0,5}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorCode(answer: InstanceAnswer): unknown {
  return record(record(answer.body)?.error)?.code;
}

/** `value` as an ISO 8601 moment in UTC, as `Date` writes one — or `undefined`. */
function isoMoment(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  const written = new Date(ms).toISOString();
  return written === value ? written : undefined;
}

function entryFrom(value: unknown): OperatorLogEntry | undefined {
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    typeof row.id !== 'number' ||
    !Number.isSafeInteger(row.id) ||
    row.id < 1 ||
    at === undefined ||
    typeof row.source !== 'string' ||
    !SOURCES.includes(row.source) ||
    typeof row.action !== 'string' ||
    !ACTION.test(row.action) ||
    !(row.detail === null || (typeof row.detail === 'string' && DETAIL.test(row.detail))) ||
    (row.outcome !== 'done' && row.outcome !== 'refused' && row.outcome !== 'failed')
  ) {
    return undefined;
  }
  return {
    id: row.id,
    at,
    source: row.source as OperatorLogSource,
    action: row.action,
    detail: row.detail,
    outcome: row.outcome,
  };
}

/** A page as the instance writes one, or `undefined` when any part of it is not. */
function pageFrom(answer: InstanceAnswer): OperatorLogPage | undefined {
  const body = record(answer.body);
  const list = body?.entries;
  const next = body?.cursor;
  if (!Array.isArray(list)) return undefined;
  if (!(next === null || (typeof next === 'string' && CURSOR.test(next)))) return undefined;
  const entries = list.map(entryFrom);
  if (entries.some((entry) => entry === undefined)) return undefined;
  return { kind: 'page', entries: entries as OperatorLogEntry[], next };
}

/** A whole number no smaller than zero. */
function whole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

const COMMIT = /^[0-9a-f]{40}$/;
/** A version as `package.json` writes one. */
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;

function diskFrom(value: unknown): OperateDisk | undefined {
  const row = record(value);
  if (
    row === undefined ||
    !oneOf(row.holds, ['database', 'blobs', 'database_and_blobs'] as const) ||
    !whole(row.freeBytes) ||
    !whole(row.totalBytes) ||
    typeof row.low !== 'boolean'
  ) {
    return undefined;
  }
  return { holds: row.holds, freeBytes: row.freeBytes, totalBytes: row.totalBytes, low: row.low };
}

/** `null`, a backup record, or `undefined` when it is neither. */
function lastBackupFrom(value: unknown): OperateLastBackup | null | undefined {
  if (value === null) return null;
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    at === undefined ||
    !oneOf(row.offBox, ['copied', 'failed', 'not-configured'] as const) ||
    !whole(row.intervalSeconds)
  ) {
    return undefined;
  }
  return { at, offBox: row.offBox, intervalSeconds: row.intervalSeconds };
}

/** A run's error as the instance records it: a name or Node's code, never a message. */
const ERROR_NAME = /^[A-Za-z0-9_]{1,64}$/;

/** A snapshot directory's name as `backup` makes one: `snapshot-` and the time, `:` and `.` as `-`. */
const SNAPSHOT = /^snapshot-[0-9A-Za-z-]{1,40}$/;

/** A whole number no smaller than zero, or `null`. */
function wholeOrNull(value: unknown): value is number | null {
  return value === null || whole(value);
}

function backupFrom(value: unknown): OperateBackup | undefined {
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    at === undefined ||
    !whole(row.id) ||
    row.id < 1 ||
    !whole(row.ageSeconds) ||
    !wholeOrNull(row.intervalSeconds) ||
    typeof row.requested !== 'boolean'
  ) {
    return undefined;
  }
  const common = {
    id: row.id,
    at,
    ageSeconds: row.ageSeconds,
    intervalSeconds: row.intervalSeconds,
    requested: row.requested,
  };
  if (row.outcome === 'failed') {
    if (typeof row.error !== 'string' || !ERROR_NAME.test(row.error)) return undefined;
    return { outcome: 'failed', ...common, error: row.error };
  }
  if (
    row.outcome !== 'done' ||
    typeof row.snapshot !== 'string' ||
    !SNAPSHOT.test(row.snapshot) ||
    !whole(row.rows) ||
    !whole(row.blobs) ||
    !whole(row.sizeBytes) ||
    !oneOf(row.offBox, ['copied', 'failed', 'not-configured'] as const)
  ) {
    return undefined;
  }
  return {
    outcome: 'done',
    ...common,
    snapshot: row.snapshot,
    rows: row.rows,
    blobs: row.blobs,
    sizeBytes: row.sizeBytes,
    offBox: row.offBox,
  };
}

/** The backups as the instance writes them, or `undefined` when any part is not. */
function backupsFrom(answer: InstanceAnswer): OperateBackups | undefined {
  const body = record(answer.body);
  if (body === undefined || !Array.isArray(body.backups)) return undefined;
  let pendingSince: string | null = null;
  if (body.pending !== null) {
    const asked = isoMoment(record(body.pending)?.requestedAt);
    if (asked === undefined) return undefined;
    pendingSince = asked;
  }
  const records = body.backups.map(backupFrom);
  if (records.some((each) => each === undefined)) return undefined;
  return { kind: 'backups', records: records as OperateBackup[], pendingSince };
}

/**
 * A sentence of the instance's that may be shown as it is: plain prose, no
 * decimal number (a coordinate is one) and no word longer than 24 characters
 * (a key or a token is one).
 */
const SENTENCE = /^[A-Za-z0-9 .,:;’'()-]{1,300}$/;

function sentenceFrom(answer: InstanceAnswer): string | undefined {
  const message = record(record(answer.body)?.error)?.message;
  if (typeof message !== 'string' || !SENTENCE.test(message)) return undefined;
  if (/[0-9][.,][0-9]/.test(message)) return undefined;
  if (message.split(' ').some((word) => word.length > 24)) return undefined;
  return message;
}

/** The longest line the instance's redaction could write: its keys are a closed list of short values. */
const MAXIMUM_PROBLEM_LINE = 4096;

/** The longest string the instance's redaction keeps (`apps/instance` §`log.ts`). */
const MAXIMUM_LOGGED_STRING = 120;

/** A line's fields, held to what the instance's redaction keeps — or `undefined`. */
function problemFields(
  line: string,
): Readonly<Record<string, string | number | boolean | null>> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const fields = record(parsed);
  if (fields === undefined || typeof fields.event !== 'string') return undefined;
  const kept: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[A-Za-z]{1,32}$/.test(key)) return undefined;
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= MAXIMUM_LOGGED_STRING)
    ) {
      kept[key] = value;
    } else {
      return undefined;
    }
  }
  return kept;
}

function problemsFrom(answer: InstanceAnswer): OperateProblems | undefined {
  const body = record(answer.body);
  const since = isoMoment(body?.since);
  if (body === undefined || since === undefined || !Array.isArray(body.lines)) return undefined;
  const lines: OperateProblem[] = [];
  for (const each of body.lines as unknown[]) {
    const row = record(each);
    const at = isoMoment(row?.at);
    const line = row?.line;
    if (at === undefined || typeof line !== 'string' || line.length > MAXIMUM_PROBLEM_LINE) {
      return undefined;
    }
    const fields = problemFields(line);
    if (fields === undefined) return undefined;
    lines.push({ at, line, fields });
  }
  return { kind: 'problems', since, lines };
}

/** Said for a refused "back up now" when the instance's own sentence may not be shown. */
const BACK_UP_REFUSED_TEXT =
  'The instance refused: a backup is already waiting, or one was made a short while ago.';

/**
 * The status as the instance writes it, or `undefined` when any part is not —
 * so nothing but closed names, numbers and the commit's hex reaches the screen.
 */
function statusFrom(answer: InstanceAnswer): OperateStatus | undefined {
  const body = record(answer.body);
  const checks = record(body?.checks);
  const tunnel = record(body?.tunnel);
  const counts = record(body?.counts);
  const athletes = record(counts?.athletes);
  const analysis = record(counts?.analysis);
  if (
    body === undefined ||
    checks === undefined ||
    tunnel === undefined ||
    counts === undefined ||
    athletes === undefined ||
    analysis === undefined ||
    !Array.isArray(body.disk)
  ) {
    return undefined;
  }
  const disk = body.disk.map(diskFrom);
  const lastBackup = lastBackupFrom(body.lastBackup);
  if (
    typeof body.ready !== 'boolean' ||
    typeof checks.database !== 'boolean' ||
    !oneOf(checks.migrations, ['at-head', 'migrating', 'behind', 'ahead', 'unknown'] as const) ||
    typeof checks.rooms !== 'boolean' ||
    typeof body.version !== 'string' ||
    !VERSION.test(body.version) ||
    !(body.commit === null || (typeof body.commit === 'string' && COMMIT.test(body.commit))) ||
    typeof body.upstream !== 'boolean' ||
    !oneOf(body.registration, ['open', 'approval', 'invite', 'closed'] as const) ||
    !whole(body.uptimeSeconds) ||
    disk.some((each) => each === undefined) ||
    lastBackup === undefined ||
    !oneOf(tunnel.state, ['unknown', 'ready', 'not_ready'] as const) ||
    !whole(athletes.active) ||
    !whole(athletes.pending) ||
    !whole(athletes.suspended) ||
    !whole(counts.roomsOpen) ||
    !whole(analysis.queued) ||
    !whole(analysis.running) ||
    !oneOf(body.keys, ['ready', 'no-secret', 'no-origin', 'no-keys', 'unreadable', 'busy'] as const)
  ) {
    return undefined;
  }
  let shownTunnel: OperateStatus['tunnel'];
  if (tunnel.state === 'ready') {
    if (!whole(tunnel.connections)) return undefined;
    shownTunnel = { state: 'ready', connections: tunnel.connections };
  } else {
    shownTunnel = { state: tunnel.state };
  }
  return {
    kind: 'status',
    ready: body.ready,
    checks: { database: checks.database, migrations: checks.migrations, rooms: checks.rooms },
    version: body.version,
    commit: body.commit,
    upstream: body.upstream,
    registration: body.registration,
    uptimeSeconds: body.uptimeSeconds,
    disk: disk as OperateDisk[],
    lastBackup,
    tunnel: shownTunnel,
    counts: {
      athletes: {
        active: athletes.active,
        pending: athletes.pending,
        suspended: athletes.suspended,
      },
      roomsOpen: counts.roomsOpen,
      analysis: { queued: analysis.queued, running: analysis.running },
    },
    keys: body.keys,
  };
}

/**
 * How long the app waits for the models read (#2610): the instance gives the
 * server 15 s (`apps/instance` §`LOCAL_SERVER_READ_MS`), and the sealed round
 * trip is on top of that.
 */
export const LOCAL_MODELS_WAIT_MILLISECONDS = 25_000;

/**
 * How long the app waits for a tool check (#2610): the longest one sealed
 * call may wait, 60 s. The instance's own budget is 50 s inside it
 * (`apps/instance` §`TOOL_CHECK_MILLISECONDS`), most of it the server loading
 * the model, so the round trip has the rest.
 */
export const TOOL_CHECK_WAIT_MILLISECONDS = MAXIMUM_SEALED_CALL_MILLISECONDS;

/** A model's name as the instance's settings accept one (`apps/instance` §`MODEL_NAME`). */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
/** A base URL: `http:` or `https:`, short, and nothing a screen would run. */
const BASE_URL = /^https?:\/\/[^\s<>"']{1,500}$/;
/** A base URL with any `user:password@` taken out: the screen never draws a secret. */
function withoutUserinfo(url: string): string {
  return url.replace(/^(https?:\/\/)[^/?#]*@/, '$1');
}
/** An origin, as `hosted-key.ts` §`hostedOriginOf` writes one. */
const ORIGIN = /^https:\/\/[^\s/<>"']{1,253}$/;
const LABEL = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/;
/** A failure code as `apps/instance` §`JOB_FAILURES` writes one. */
const FAILURE = /^[a-z][a-z_-]{0,39}$/;

const nullableText = (value: unknown, shape: RegExp): value is string | null =>
  value === null || (typeof value === 'string' && shape.test(value));

/** The settings as the instance writes them, or `undefined` when any part is not. */
function analysisFrom(answer: InstanceAnswer): OperateAnalysis | undefined {
  const body = record(answer.body);
  const local = record(body?.local);
  const hosted = record(body?.hosted);
  if (
    local === undefined ||
    hosted === undefined ||
    !nullableText(local.url, BASE_URL) ||
    !nullableText(local.model, MODEL_NAME) ||
    !(local.reasoningTokens === null || whole(local.reasoningTokens)) ||
    typeof local.offered !== 'boolean' ||
    typeof local.othersMayUse !== 'boolean' ||
    !oneOf(local.setIn, ['app', 'env', 'none'] as const) ||
    !oneOf(local.state, LOCAL_MODEL_STATES) ||
    typeof hosted.offered !== 'boolean' ||
    !oneOf(hosted.operatorKey, ['none', 'held', 'held-unreadable'] as const) ||
    !nullableText(hosted.operatorKeyOrigin, ORIGIN)
  ) {
    return undefined;
  }
  return {
    kind: 'analysis',
    local: {
      url: local.url === null ? null : withoutUserinfo(local.url),
      model: local.model,
      reasoningTokens: local.reasoningTokens,
      offered: local.offered,
      othersMayUse: local.othersMayUse,
      setIn: local.setIn,
      state: local.state,
    },
    hosted: {
      offered: hosted.offered,
      operatorKey: hosted.operatorKey,
      operatorKeyOrigin: hosted.operatorKeyOrigin,
    },
  };
}

function modelFrom(value: unknown): LocalModel | undefined {
  const row = record(value);
  if (
    row === undefined ||
    typeof row.name !== 'string' ||
    !MODEL_NAME.test(row.name) ||
    !(row.sizeBytes === null || whole(row.sizeBytes)) ||
    !nullableText(row.parameters, LABEL) ||
    !nullableText(row.quantisation, LABEL) ||
    !oneOf(row.tools, ['listed', 'not-listed', 'not-reported'] as const) ||
    !oneOf(row.gpu, ['all', 'part', 'none', 'not-loaded', 'not-reported', 'not-known'] as const) ||
    !(row.gpuPercent === null || (whole(row.gpuPercent) && row.gpuPercent <= 100))
  ) {
    return undefined;
  }
  return {
    name: row.name,
    sizeBytes: row.sizeBytes,
    parameters: row.parameters,
    quantisation: row.quantisation,
    tools: row.tools,
    gpu: row.gpu,
    gpuPercent: row.gpuPercent,
  };
}

function modelsFrom(answer: InstanceAnswer): LocalModels | undefined {
  const body = record(answer.body);
  if (
    body === undefined ||
    !oneOf(body.state, [
      'ollama',
      'openai-compatible',
      'no-address',
      'not-local',
      'unresolved',
      'unreachable',
    ] as const) ||
    !nullableText(body.version, LABEL) ||
    !Array.isArray(body.models)
  ) {
    return undefined;
  }
  const models = body.models.map(modelFrom);
  if (models.some((each) => each === undefined)) return undefined;
  return {
    kind: 'models',
    state: body.state,
    version: body.version,
    models: models as LocalModel[],
  };
}

function jobFrom(value: unknown): OperateJob | undefined {
  const row = record(value);
  const createdAt = isoMoment(row?.createdAt);
  const endedAt = row?.endedAt === null ? null : isoMoment(row?.endedAt);
  if (
    row === undefined ||
    !oneOf(row.kind, ['write-up', 're-plan'] as const) ||
    !oneOf(row.source, ['local', 'hosted'] as const) ||
    !oneOf(row.status, JOB_STATUSES) ||
    !nullableText(row.failure, FAILURE) ||
    createdAt === undefined ||
    endedAt === undefined ||
    !oneOf(row.whose, ['own', 'other'] as const)
  ) {
    return undefined;
  }
  return {
    kind: row.kind,
    source: row.source,
    status: row.status,
    failure: row.failure,
    createdAt,
    endedAt,
    whose: row.whose,
  };
}

function jobsFrom(answer: InstanceAnswer): OperateJobs | undefined {
  const body = record(answer.body);
  const counts = record(body?.counts);
  if (
    counts === undefined ||
    !JOB_STATUSES.every((status) => whole(counts[status])) ||
    !Array.isArray(body?.failures) ||
    !Array.isArray(body.recent)
  ) {
    return undefined;
  }
  const failures = body.failures.map((value: unknown) => {
    const row = record(value);
    return row !== undefined && nullableText(row.code, FAILURE) && whole(row.count)
      ? { code: row.code, count: row.count }
      : undefined;
  });
  const recent = body.recent.map(jobFrom);
  if (failures.some((each) => each === undefined) || recent.some((each) => each === undefined)) {
    return undefined;
  }
  return {
    kind: 'jobs',
    counts: Object.fromEntries(JOB_STATUSES.map((status) => [status, counts[status]])) as Record<
      JobStatus,
      number
    >,
    failures: failures as { code: string | null; count: number }[],
    recent: recent as OperateJob[],
  };
}

/** The field names a `validation_failed` names, each a field of the request and nothing else. */
function refusedFields(answer: InstanceAnswer): readonly string[] | undefined {
  if (answer.status !== 400 || errorCode(answer) !== 'validation_failed') return undefined;
  const fields = record(record(answer.body)?.error)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .map((each: unknown) => record(each)?.field)
    .filter(
      (field): field is string => typeof field === 'string' && /^[A-Za-z]{1,32}$/.test(field),
    );
}

/**
 * Whether an answer is the INSTANCE saying this account is not its owner — the
 * status AND its own code. An Operate route answers anybody but the owner as a
 * route that does not exist; an account pending approval or suspended is
 * refused about itself before any route.
 */
function isNotTheOwner(answer: InstanceAnswer): boolean {
  const code = errorCode(answer);
  if (answer.status === 404) return code === 'not_found';
  if (answer.status === 403) return code === 'registration_pending' || code === 'account_suspended';
  return false;
}

/** What a closed sealed session means here. */
function closedStanding(
  closed: Extract<HeldSealedSession, { kind: 'closed' }>,
): Exclude<OperateStanding, 'owner' | 'not-owner' | 'unreachable'> {
  return closed.why === 'signed-out' ? 'signed-out' : 'no-keys';
}

/** The production {@link OperatePort}: `main.tsx` builds it, and nothing else in the client. */
export function createOperatePort(dependencies: OperatePortDependencies): OperatePort {
  const sealedSession = heldSealedSession(dependencies);

  /** An owner's answer read by `parse`, or the standing the instance's answer says. */
  function standingOr<T>(
    answer: InstanceAnswer,
    parse: (answer: InstanceAnswer) => T | undefined,
  ): T | { readonly kind: Exclude<OperateStanding, 'owner'> } {
    if (answer.status === 401) return { kind: 'signed-out' };
    if (answer.status === 200) return parse(answer) ?? { kind: 'unreachable' };
    if (isNotTheOwner(answer)) return { kind: 'not-owner' };
    // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
    if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
    return { kind: 'unreachable' };
  }

  /** One sealed Operate request as the owner, its answer read by `parse`. */
  async function ownerRead<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: Readonly<Record<string, unknown>> | undefined,
    parse: (answer: InstanceAnswer) => T | undefined,
    timeoutMilliseconds?: number,
  ): Promise<T | { readonly kind: Exclude<OperateStanding, 'owner'> }> {
    try {
      const session = await sealedSession();
      if (session.kind === 'closed') return { kind: closedStanding(session) };
      const answer = await session.sealed.call(method, path, {
        token: session.token,
        ...(body === undefined ? {} : { body }),
        ...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
      });
      return standingOr(answer, parse);
    } catch {
      return { kind: 'unreachable' };
    }
  }

  return {
    standing: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return closedStanding(session);
        const answer = await session.sealed.call('GET', '/v1/auth/account', {
          token: session.token,
        });
        if (answer.status === 401) return 'signed-out';
        if (answer.status === 200) {
          return record(answer.body)?.moderatorRole === 'owner' ? 'owner' : 'not-owner';
        }
        return isNotTheOwner(answer) ? 'not-owner' : 'unreachable';
      } catch {
        return 'unreachable';
      }
    },

    status: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/status', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return statusFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    analysis: () => ownerRead('GET', '/v1/operate/analysis', undefined, analysisFrom),

    setAnalysis: async (change) => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('POST', '/v1/operate/analysis', {
          token: session.token,
          body: { ...change },
        });
        const refused = refusedFields(answer);
        if (refused !== undefined) return { kind: 'refused', fields: refused };
        return standingOr(answer, analysisFrom);
      } catch {
        return { kind: 'unreachable' };
      }
    },

    clearAnalysis: () => ownerRead('DELETE', '/v1/operate/analysis', undefined, analysisFrom),

    localModels: () =>
      ownerRead(
        'GET',
        '/v1/operate/analysis/models',
        undefined,
        modelsFrom,
        LOCAL_MODELS_WAIT_MILLISECONDS,
      ),

    checkModel: (model) => {
      // A name the instance would refuse is sent nowhere.
      if (!MODEL_NAME.test(model)) return Promise.resolve({ kind: 'unreachable' as const });
      return ownerRead(
        'POST',
        '/v1/operate/analysis/check',
        { model },
        (answer) => {
          const outcome = record(answer.body)?.outcome;
          return oneOf(outcome, TOOL_CHECK_OUTCOMES) ? { kind: 'checked', outcome } : undefined;
        },
        TOOL_CHECK_WAIT_MILLISECONDS,
      );
    },

    jobs: () => ownerRead('GET', '/v1/operate/analysis/jobs', undefined, jobsFrom),

    log: async (cursor) => {
      // A cursor the instance could not have written is sent nowhere.
      if (cursor !== undefined && !CURSOR.test(cursor)) return { kind: 'unreachable' };
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/log', {
          token: session.token,
          query: {
            limit: String(OPERATOR_LOG_PAGE),
            ...(cursor === undefined ? {} : { cursor }),
          },
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return pageFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    backups: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/backups', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return backupsFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    problems: () => ownerRead('GET', '/v1/operate/logs', undefined, problemsFrom),

    backUpNow: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('POST', '/v1/operate/backups', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 202) {
          const requestedAt = isoMoment(record(answer.body)?.requestedAt);
          return requestedAt === undefined
            ? { kind: 'unreachable' }
            : { kind: 'requested', requestedAt };
        }
        if (answer.status === 429 && errorCode(answer) === 'too_many') {
          return { kind: 'refused', sentence: sentenceFrom(answer) ?? BACK_UP_REFUSED_TEXT };
        }
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },
  };
}
