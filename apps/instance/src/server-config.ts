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
import { isAddress, normalisedAddress } from './client-address.ts';
import { configuredHostProblem } from './history/address.ts';
import { DEFAULT_MAXIMUM_BUFFERED_BYTES, DEFAULT_PING_INTERVAL_MS } from './room/node/room-host.ts';
import type { DiscordSettings } from './voice/discord.ts';

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
  /** The file `OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE` names, as {@link readDiscordTokenFile} read it. */
  readonly discordBotTokenFile?: DiscordTokenFile | undefined;
  readonly discordGuildId?: string | undefined;
  readonly tunnelReadyUrl?: string | undefined;
  readonly adminPages?: string | undefined;
  readonly adminLoopbackPort?: string | undefined;
  readonly adminAddresses?: string | undefined;
}

/**
 * The Discord bot token's file, read once at start (#2146): never set, read,
 * or named and not readable. The token reaches the instance only this way —
 * from a file the deployment's secret store mounts (`deploy/home/compose.yaml`
 * mounts `secrets/` beside it), never from the environment, where every child
 * process and `docker inspect` would see it — and the instance never writes it.
 */
export type DiscordTokenFile =
  | { readonly kind: 'unset' }
  | { readonly kind: 'read'; readonly text: string }
  | { readonly kind: 'unreadable' };

/**
 * Reads the file `path` names with `read` (`serve.ts` passes `readFileSync`):
 * `unset` for no path. A read that throws is `unreadable`, and its error is
 * dropped, so nothing it said reaches a problem or a log.
 */
export function readDiscordTokenFile(
  path: string | undefined,
  read: (path: string) => string,
): DiscordTokenFile {
  if (!present(path)) return { kind: 'unset' };
  try {
    return { kind: 'read', text: read(path.trim()) };
  } catch {
    return { kind: 'unreadable' };
  }
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
  /**
   * The operator's own Discord bot and server, for a voice channel per private
   * room (#874, spike 0017 §3.5): `undefined` — voice off — unless both
   * `OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE` (#2146) and `OYL_INSTANCE_DISCORD_GUILD_ID` are set.
   */
  readonly discord: DiscordSettings | undefined;
  /**
   * `cloudflared`'s own `/ready` on the deployment's private network (#2604),
   * asked for the owner's Status — or `undefined`, and the tunnel's state is
   * "not known" and nothing is asked. Held to the history index's address
   * rule (`history/address.ts`): a private address or a single-label name.
   */
  readonly tunnelReadyUrl: URL | undefined;
  /**
   * The instance's own admin pages at `/admin` (#2641, ADR 0069 D-2): OFF
   * unless the operator sets `OYL_INSTANCE_ADMIN_PAGES=on`. A new login
   * surface on the internet is the operator's choice to open.
   */
  readonly adminPages: boolean;
  /**
   * `OYL_INSTANCE_ADMIN_LOOPBACK_PORT` (#2643, ADR 0069 D-5): the port of a
   * SECOND listener that serves `/admin` and nothing else, at
   * `http://localhost:<port>` — or `undefined`, and nothing listens. Off
   * unless set. The home compose file publishes it on the host's loopback
   * only. Since #2784 (ADR 0080 D-1) it no longer needs the admin pages on:
   * while the first-run setup is open the listener serves `/setup` with the
   * admin pages off, and `/admin` only ever with them on.
   */
  readonly adminLoopbackPort: number | undefined;
  /**
   * `OYL_INSTANCE_ADMIN_ADDRESSES` (#2643, ADR 0069 D-5): the only client
   * addresses a tunnel admin sign-in is taken from; empty, any.
   */
  readonly adminAddresses: readonly string[];
}

export type ServerConfigResult =
  | { readonly ok: true; readonly config: ServerConfig }
  | { readonly ok: false; readonly problems: readonly string[] };

export const DEFAULT_DATABASE_PATH = 'data/instance.sqlite';
export const DEFAULT_BLOBS_PATH = 'data/blobs';

/** What `OYL_INSTANCE_METRICS_TOKEN` must be; `setup/secrets.ts` holds a made one's file to it too (#2781). */
export const METRICS_TOKEN = /^[A-Za-z0-9._~-]{32,256}$/;

/**
 * The tailnet name `deploy/home/instance.env.example` and the guide write
 * where the owner's own goes (#2855). No tailnet has it: Tailscale gives each
 * one a name of its own.
 */
export const TEMPLATE_TAILNET = 'your-tailnet.ts.net';

/**
 * Whether `origin` — {@link ServerConfig.origin}, so already an origin alone —
 * is still the template's example address (#2855): a `.env` copied from
 * `instance.env.example` and never filled in. Such an origin has the right
 * SHAPE, which is all {@link readServerConfig} holds it to, and the instance
 * starts; but no device can reach it, and a card or an emergency kit drawn
 * for it names an address that is not this instance's. So `instance.ts` asks
 * this, and the first-run setup does not open while it is true.
 */
export function isTemplateOrigin(origin: string | null): boolean {
  if (origin === null) return false;
  const host = new URL(origin).hostname.replace(/\.$/, '');
  return host === TEMPLATE_TAILNET || host.endsWith(`.${TEMPLATE_TAILNET}`);
}

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
  const adminPages = onOff(raw.adminPages, 'OYL_INSTANCE_ADMIN_PAGES', problems);

  let adminLoopbackPort: number | undefined;
  if (present(raw.adminLoopbackPort)) {
    const text = raw.adminLoopbackPort.trim();
    const value = /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
      problems.push('OYL_INSTANCE_ADMIN_LOOPBACK_PORT must be a port number from 1 to 65535.');
    } else {
      adminLoopbackPort = value;
    }
  }

  const adminAddresses: string[] = [];
  if (present(raw.adminAddresses)) {
    for (const entry of raw.adminAddresses.split(',').map((each) => each.trim())) {
      if (isAddress(entry)) {
        adminAddresses.push(normalisedAddress(entry));
      } else {
        problems.push(
          'OYL_INSTANCE_ADMIN_ADDRESSES must be IP addresses separated by commas, each written exactly as the connection reports it.',
        );
        break;
      }
    }
  }

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
    if (METRICS_TOKEN.test(text)) metricsToken = text;
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

  // #874: voice is optional, so unset is OFF, not a problem — the reverse of
  // the source URL's rule (spike 0017 §3.5). Half of it set is a mistake, and
  // a problem names the variable, never what it holds: one of them is a secret.
  // #2146: the token comes from a file, never the environment. A file named
  // and not readable is a refusal, as the terms file's is (#909).
  let discord: DiscordSettings | undefined;
  const tokenFile = raw.discordBotTokenFile ?? { kind: 'unset' };
  const tokenText = tokenFile.kind === 'read' ? tokenFile.text : undefined;
  if (tokenFile.kind === 'unreadable') {
    problems.push(
      'OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE is set, and the file could not be read: mount it inside the container, readable by the user the instance runs as (docs/operating-an-instance.md, "Voice on Discord").',
    );
  } else if (present(tokenText) || present(raw.discordGuildId)) {
    const token = tokenText?.trim() ?? '';
    const guildId = raw.discordGuildId?.trim() ?? '';
    const before = problems.length;
    if (!/^[A-Za-z0-9._-]{20,200}$/.test(token)) {
      problems.push(
        "OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE must name a file holding your Discord bot's token, and nothing else (letters, digits, dots, dashes and underscores), whenever OYL_INSTANCE_DISCORD_GUILD_ID is set. Empty both to leave voice off.",
      );
    }
    if (!/^[0-9]{17,20}$/.test(guildId)) {
      problems.push(
        "OYL_INSTANCE_DISCORD_GUILD_ID must be your Discord server's id (17 to 20 digits) whenever OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE is set. Empty both to leave voice off.",
      );
    }
    if (problems.length === before) discord = { botToken: token, guildId };
  }

  // #2604: the tunnel's readiness, on the private network or not at all. A
  // problem names the variable and the rule, never the address.
  let tunnelReadyUrl: URL | undefined;
  if (present(raw.tunnelReadyUrl)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(raw.tunnelReadyUrl.trim());
    } catch {
      parsed = undefined;
    }
    if (
      parsed?.protocol !== 'http:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      problems.push(
        'OYL_INSTANCE_TUNNEL_READY_URL must be an http: URL with no credentials, query or fragment, such as http://172.30.88.10:20241/ready.',
      );
    } else {
      const hostProblem = configuredHostProblem(parsed.hostname);
      if (hostProblem === undefined) tunnelReadyUrl = parsed;
      else {
        problems.push(
          `OYL_INSTANCE_TUNNEL_READY_URL was refused because ${hostProblem}: the tunnel's metrics are asked on this machine's private network only.`,
        );
      }
    }
  }

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
      discord,
      tunnelReadyUrl,
      adminPages,
      adminLoopbackPort,
      adminAddresses,
    },
  };
}
