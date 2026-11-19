// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Status** (#2604): what the owner's Operate area shows about the running
 * instance, read-only — how long it has been up, its disks, its tunnel, its
 * keys — gathered from sources `instance.ts` hands it.
 *
 * ## Nothing secret, nothing of the host's
 *
 * Every source here answers a NUMBER or a closed name, and is built from only
 * what it needs: the disk from the two directories the operator set (their
 * paths never leave this file), the tunnel from `OYL_INSTANCE_TUNNEL_READY_URL`
 * alone, the keys from their state's name. None is handed a secret, a token or
 * a key's value, so none can return one — `operate/status.test.ts` hands them
 * every secret the instance holds, as marker strings, and reads the body.
 *
 * ## The tunnel: asked only when the operator said where
 *
 * The epic's decision 4 (the owner's ruling of 2026-11-14 on #2601): with
 * `OYL_INSTANCE_TUNNEL_READY_URL` unset the state is `unknown` and NOTHING is
 * asked. Set, it is `cloudflared`'s `/ready` on the deployment's own network,
 * whose port is never published. That address was held to the history
 * index's rule as configured (`server-config.ts`), and is held to it again on
 * every request as connected (`history/address.ts` §`localAddressesOnly`): a
 * name is resolved, every address it has must be private, and the request
 * goes to the address that was checked. No redirect is followed.
 */

import { localAddressesOnly, type Resolver } from '../history/address.ts';
import { InstanceKeysUnavailable, type InstanceKeys } from '../keys/instance-keys.ts';
import type { InstanceKeysProblem } from '../keys/instance-keys.ts';
import type { RemotePath } from '../config.ts';
import type { ServerConfig } from '../server-config.ts';

/** One disk's space, in bytes. */
export interface DiskSpace {
  /** What the instance holds on it: its database, its blobs, or both. */
  readonly holds: 'database' | 'blobs' | 'database_and_blobs';
  /** What an unprivileged process may still write. */
  readonly freeBytes: number;
  readonly totalBytes: number;
  /** Under {@link LOW_DISK_FRACTION} of it free. */
  readonly low: boolean;
}

/** A disk with less than a tenth of it free is shown with a warning (#2604). */
export const LOW_DISK_FRACTION = 0.1;

/** The tunnel's readiness as `cloudflared` answers it, or `unknown` when nobody said where to ask. */
export type TunnelState =
  | { readonly state: 'unknown' }
  | { readonly state: 'ready'; readonly connections: number }
  | { readonly state: 'not_ready' };

/** The instance's keys: usable, or why not, by the name `instance-keys.ts` gives it. */
export type KeysState = 'ready' | InstanceKeysProblem;

/** What `Operate.status` reads beyond the store. */
export interface StatusSources {
  /** Unix milliseconds. */
  readonly now: () => number;
  /** When this process started, Unix milliseconds. */
  readonly startedAt: number;
  /** Every disk the instance's data is on — one when the blobs share the database's. */
  disk(): Promise<readonly DiskSpace[]>;
  tunnel(): Promise<TunnelState>;
  keys(): Promise<KeysState>;
}

/**
 * The two calls the disk reading makes: Node's `statfs` and `stat`, which
 * `instance.ts` hands in — this file loads no Node builtin (ADR 0037 D-2) —
 * or a test's, which says what a disk holds.
 */
export interface DiskProbe {
  statfs(
    path: string,
  ): Promise<{ readonly bavail: number; readonly blocks: number; readonly bsize: number }>;
  /** The device a path is on. */
  device(path: string): Promise<number>;
}

/** How long the tunnel is waited for, its name's lookup included, before it is `not_ready`. */
const TUNNEL_WAIT_MS = 2_000;

/** The directory a file is in: everything before its last separator. */
function directoryOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? '.' : cut === 0 ? path.slice(0, 1) : path.slice(0, cut);
}

/** A disk's space from `statfs`, or `undefined` when it cannot be read or makes no sense. */
async function spaceOf(
  probe: DiskProbe,
  path: string,
  holds: DiskSpace['holds'],
): Promise<DiskSpace | undefined> {
  try {
    const read = await probe.statfs(path);
    const freeBytes = read.bavail * read.bsize;
    const totalBytes = read.blocks * read.bsize;
    if (!Number.isSafeInteger(freeBytes) || !Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
      return undefined;
    }
    return { holds, freeBytes, totalBytes, low: freeBytes < totalBytes * LOW_DISK_FRACTION };
  } catch {
    return undefined;
  }
}

/**
 * The disks under the database's directory and the blob directory: one entry
 * when both are on one device, two when they are not, and none that could not
 * be read. A path is never in what this returns.
 */
export function diskSpace(
  paths: { readonly databasePath: string; readonly blobsPath: string },
  probe: DiskProbe,
): () => Promise<readonly DiskSpace[]> {
  const database = directoryOf(paths.databasePath);
  return async () => {
    let shared: boolean;
    try {
      shared = (await probe.device(database)) === (await probe.device(paths.blobsPath));
    } catch {
      // A blob directory not made yet: the database's disk is still read.
      shared = false;
    }
    if (shared) {
      const both = await spaceOf(probe, database, 'database_and_blobs');
      return both === undefined ? [] : [both];
    }
    const found = [
      await spaceOf(probe, database, 'database'),
      await spaceOf(probe, paths.blobsPath, 'blobs'),
    ];
    return found.filter((each): each is DiskSpace => each !== undefined);
  };
}

/**
 * The tunnel's readiness: `unknown`, asking nothing, with no address; else
 * `cloudflared`'s `/ready` at the address it resolves to, checked private.
 * `200` with a whole number of `readyConnections` is `ready`; anything else —
 * a `503`, a refusal, a public address, no answer — is `not_ready`.
 */
export function tunnelReadiness(options: {
  readonly url: URL | undefined;
  readonly resolve: Resolver;
  readonly fetch: typeof globalThis.fetch;
  /** The one deadline over the lookup, the request and its body: {@link TUNNEL_WAIT_MS} unless a test's. */
  readonly waitMs?: number;
}): () => Promise<TunnelState> {
  const { url, resolve, fetch } = options;
  const waitMs = options.waitMs ?? TUNNEL_WAIT_MS;

  async function ask(at: URL, deadline: AbortSignal): Promise<TunnelState> {
    const checked = await localAddressesOnly(at.hostname, resolve);
    if (!checked.ok || deadline.aborted) return { state: 'not_ready' };
    const target = new URL(at.href);
    target.hostname = checked.address.includes(':') ? `[${checked.address}]` : checked.address;
    const answer = await fetch(target, { redirect: 'manual', signal: deadline });
    if (answer.status !== 200) {
      await answer.body?.cancel();
      return { state: 'not_ready' };
    }
    const body = (await answer.json()) as { readyConnections?: unknown } | null;
    const connections = body?.readyConnections;
    return typeof connections === 'number' && Number.isSafeInteger(connections) && connections > 0
      ? { state: 'ready', connections }
      : { state: 'not_ready' };
  }

  return async () => {
    if (url === undefined) return { state: 'unknown' };
    // #2622's review: ONE deadline, started before the name is looked up, so
    // a resolver that hangs — the tunnel's container being recreated, a
    // search domain retried upstream — cannot hold the owner's page past it.
    // A lookup still running when it passes is left to finish unread.
    const deadline = AbortSignal.timeout(waitMs);
    const expired = new Promise<TunnelState>((settle) => {
      deadline.addEventListener('abort', () => settle({ state: 'not_ready' }), { once: true });
    });
    const asked = ask(url, deadline).catch((): TunnelState => ({ state: 'not_ready' }));
    return Promise.race([asked, expired]);
  };
}

/** The keys' state by name: `ready` when they can be shown, else why not. */
export function keysState(keys: Pick<InstanceKeys, 'show'>): () => Promise<KeysState> {
  return async () => {
    try {
      await keys.show();
      return 'ready';
    } catch (error) {
      return error instanceof InstanceKeysUnavailable ? error.code : 'unreadable';
    }
  };
}

/**
 * Every source Status reads, as `instance.ts` builds them. Handed only the
 * three settings it reads — never the secret key, the metrics token or the
 * Discord bot's token, which the same `ServerConfig` holds.
 */
export function statusSources(options: {
  readonly server: Pick<ServerConfig, 'databasePath' | 'blobsPath' | 'tunnelReadyUrl'>;
  /**
   * `OYL_INSTANCE_REMOTE_PATH` (#2859): on the tailnet or Funnel no
   * `cloudflared` runs, so its address — which the home template sets
   * whatever the path — is not asked, and the tunnel is `unknown`, never
   * `not_ready` on a healthy install.
   */
  readonly remotePath: RemotePath | null;
  readonly keys: Pick<InstanceKeys, 'show'>;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly startedAt: number;
  readonly resolve: Resolver;
  readonly fetch: typeof globalThis.fetch;
  readonly disk: DiskProbe;
}): StatusSources {
  const { server } = options;
  return {
    now: options.now,
    startedAt: options.startedAt,
    disk: diskSpace(
      { databasePath: server.databasePath, blobsPath: server.blobsPath },
      options.disk,
    ),
    tunnel: tunnelReadiness({
      url:
        options.remotePath === 'tailnet' || options.remotePath === 'funnel'
          ? undefined
          : server.tunnelReadyUrl,
      resolve: options.resolve,
      fetch: options.fetch,
    }),
    keys: keysState(options.keys),
  };
}
