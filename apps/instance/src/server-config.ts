// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the running instance needs beyond the HTTP handler's own settings
 * (`config.ts`): where its data is, who it is, and how its rooms are served
 * (#780, #791). Read once at start-up and refused whole if any of it is wrong,
 * as `config.ts` is — and, like it, never from `process.env` itself: `serve.ts`
 * reads every variable by name, so `scripts/check-env-example.sh` sees each.
 */

import { DEFAULT_MAXIMUM_BUFFERED_BYTES, DEFAULT_PING_INTERVAL_MS } from './room/node/room-host.ts';

export interface RawServerConfig {
  readonly database?: string | undefined;
  readonly blobs?: string | undefined;
  readonly origin?: string | undefined;
  readonly registration?: string | undefined;
  readonly roomWorkers?: string | undefined;
  readonly compression?: string | undefined;
  readonly metrics?: string | undefined;
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
  readonly registration: 'open' | 'closed';
  readonly roomWorkers: number;
  /** `permessage-deflate` on room sockets: OFF unless the operator says so (ruling Q16). */
  readonly compression: boolean;
  /** `GET /metrics`: off unless the operator says so (#791). */
  readonly metrics: boolean;
  readonly maxBufferedBytes: number;
  readonly pingIntervalMs: number;
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

  let registration: 'open' | 'closed' = 'closed';
  if (present(raw.registration)) {
    const text = raw.registration.trim().toLowerCase();
    if (text === 'open' || text === 'closed') registration = text;
    else problems.push('OYL_INSTANCE_REGISTRATION must be open or closed.');
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

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      databasePath: present(raw.database) ? raw.database.trim() : DEFAULT_DATABASE_PATH,
      blobsPath: present(raw.blobs) ? raw.blobs.trim() : DEFAULT_BLOBS_PATH,
      origin,
      registration,
      roomWorkers,
      compression,
      metrics,
      maxBufferedBytes: DEFAULT_MAXIMUM_BUFFERED_BYTES,
      pingIntervalMs: DEFAULT_PING_INTERVAL_MS,
    },
  };
}
