// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the running instance needs beyond the HTTP handler's own settings
 * (`config.ts`): where its data is, who it is, and how its rooms are served
 * (#780, #791). Read once at start-up and refused whole if any of it is wrong,
 * as `config.ts` is. ⚠️ The registration mode, the moderators and the client
 * address — header and trusted proxies — are `config.ts`'s, not this file's
 * (#891): one reader for each variable — and, like it, never from `process.env` itself: `serve.ts`
 * reads every variable by name, so `scripts/check-env-example.sh` sees each.
 */

import { readSecretKey, SECRET_KEY_MALFORMED } from './analysis/hosted-key.ts';
import { DEFAULT_HEARTBEAT_MS, MAXIMUM_HEARTBEAT_MS } from './analysis/jobs.ts';
import { DEFAULT_MAXIMUM_BUFFERED_BYTES, DEFAULT_PING_INTERVAL_MS } from './room/node/room-host.ts';

export interface RawServerConfig {
  readonly database?: string | undefined;
  readonly blobs?: string | undefined;
  readonly origin?: string | undefined;
  readonly roomWorkers?: string | undefined;
  readonly compression?: string | undefined;
  readonly metrics?: string | undefined;
  readonly pingIntervalMs?: string | undefined;
  readonly metricsToken?: string | undefined;
  readonly secretKey?: string | undefined;
  readonly analysisHeartbeatMs?: string | undefined;
}

export interface ServerConfig {
  /** The SQLite file. */
  readonly databasePath: string;
  /** The blob directory: backed up with the database (#791). */
  readonly blobsPath: string;
  /**
   * This instance's public origin, as a device signs it (`https://ride.example`).
   * `null` serves no account at all: every identity route answers `unavailable`.
   */
  readonly origin: string | null;
  readonly roomWorkers: number;
  /** `permessage-deflate` on room sockets: OFF unless the operator says so (ruling Q16). */
  readonly compression: boolean;
  /** `GET /metrics`: off unless the operator says so (#791). */
  readonly metrics: boolean;
  readonly maxBufferedBytes: number;
  readonly pingIntervalMs: number;
  /** The bearer token `/metrics` requires. Set whenever `metrics` is on. */
  readonly metricsToken: string | undefined;
  /**
   * `OYL_INSTANCE_SECRET_KEY`'s 32 bytes: what the hosted model key is sealed
   * under (#1097, `analysis/hosted-key.ts`), or `undefined` when it is unset.
   */
  readonly secretKey: Uint8Array | undefined;
  /**
   * How often a quiet analysis job stream writes a heartbeat (#1095): 25 s
   * unless the operator sets another, `0` for none — ONLY for #1105's control,
   * which measures the tunnel cutting a stream that has none.
   */
  readonly analysisHeartbeatMs: number;
}

export type ServerConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

export const DEFAULT_DATABASE_PATH = 'data/instance.sqlite';
export const DEFAULT_BLOBS_PATH = 'data/blobs';

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

function onOff(value: string | undefined, name: string, problems: string[]): boolean {
  if (!present(value)) return false;
  const text = value.trim().toLowerCase();
  if (text === 'on') return true;
  if (text === 'off') return false;
  problems.push(`${name} must be on or off.`);
  return false;
}

/**
 * @param cores how many cores the box has (`os.availableParallelism()`): the
 * default number of room workers, one per core (spike 0013 §4.1).
 */
export function readServerConfig(raw: RawServerConfig, cores: number): ServerConfigResult {
  const problems: string[] = [];

  let origin: string | null = null;
  if (present(raw.origin)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(raw.origin.trim());
    } catch {
      parsed = undefined;
    }
    const local = parsed?.hostname === '127.0.0.1' || parsed?.hostname === 'localhost';
    if (
      parsed === undefined ||
      !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local)) ||
      parsed.origin !== raw.origin.trim().replace(/\/$/, '')
    ) {
      problems.push(
        'OYL_INSTANCE_ORIGIN must be an origin alone (https://ride.example), https: unless it is this machine.',
      );
    } else {
      origin = parsed.origin;
    }
  }

  let roomWorkers = Math.max(1, Math.floor(cores));
  if (present(raw.roomWorkers)) {
    const text = raw.roomWorkers.trim();
    const value = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > 256) {
      problems.push('OYL_INSTANCE_ROOM_WORKERS must be a whole number from 1 to 256.');
    } else {
      roomWorkers = value;
    }
  }

  const compression = onOff(raw.compression, 'OYL_INSTANCE_WS_COMPRESSION', problems);
  const metrics = onOff(raw.metrics, 'OYL_INSTANCE_METRICS', problems);

  let pingIntervalMs = DEFAULT_PING_INTERVAL_MS;
  if (present(raw.pingIntervalMs)) {
    const text = raw.pingIntervalMs.trim();
    const value = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(value) || (value !== 0 && value < 1_000) || value > 600_000) {
      problems.push(
        'OYL_INSTANCE_PING_INTERVAL_MS must be 0 (no ping) or a whole number of milliseconds from 1000 to 600000.',
      );
    } else {
      pingIntervalMs = value;
    }
  }

  let analysisHeartbeatMs = DEFAULT_HEARTBEAT_MS;
  if (present(raw.analysisHeartbeatMs)) {
    const text = raw.analysisHeartbeatMs.trim();
    const value = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
    if (
      !Number.isInteger(value) ||
      (value !== 0 && value < 1_000) ||
      value > MAXIMUM_HEARTBEAT_MS
    ) {
      problems.push(
        `OYL_INSTANCE_ANALYSIS_HEARTBEAT_MS must be 0 (no heartbeat) or a whole number of milliseconds from 1000 to ${String(MAXIMUM_HEARTBEAT_MS)}: a slower heartbeat is too close to the tunnel's idle cut.`,
      );
    } else {
      analysisHeartbeatMs = value;
    }
  }

  let metricsToken: string | undefined;
  if (present(raw.metricsToken)) {
    const text = raw.metricsToken.trim();
    if (/^[A-Za-z0-9._~-]{32,256}$/.test(text)) metricsToken = text;
    else {
      problems.push(
        'OYL_INSTANCE_METRICS_TOKEN must be at least 32 letters, digits, dots, dashes, underscores or tildes.',
      );
    }
  }
  if (metrics && metricsToken === undefined && !problems.some((p) => p.includes('METRICS_TOKEN'))) {
    problems.push(
      'OYL_INSTANCE_METRICS=on needs OYL_INSTANCE_METRICS_TOKEN: /metrics answers only a request that carries it.',
    );
  }

  // The key-encryption key for a hosted model key (#1097). Unset is not a
  // problem — no key can then be read, and the instance says so if one is held.
  const secret = readSecretKey(raw.secretKey);
  if (secret.kind === 'malformed') problems.push(SECRET_KEY_MALFORMED);

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      databasePath: present(raw.database) ? raw.database.trim() : DEFAULT_DATABASE_PATH,
      blobsPath: present(raw.blobs) ? raw.blobs.trim() : DEFAULT_BLOBS_PATH,
      origin,
      roomWorkers,
      compression,
      metrics,
      maxBufferedBytes: DEFAULT_MAXIMUM_BUFFERED_BYTES,
      pingIntervalMs,
      metricsToken,
      secretKey: secret.kind === 'ok' ? secret.bytes : undefined,
      analysisHeartbeatMs,
    },
  };
}
