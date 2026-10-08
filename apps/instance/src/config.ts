// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What an operator configures, read once at start-up and refused whole if any
 * of it is wrong (#767).
 *
 * This module never reads `process.env` itself: `main.ts` does, by name, so
 * `scripts/check-env-example.sh` (ENV001) sees every variable the instance
 * reads and fails when `.env.example` does not list one. A config reader that
 * took `process.env` whole would hide every name from that rule.
 *
 * ## The source offer — AGPL-3.0 §13, ADR 0036 D-6
 *
 * `GET /source` answers with the URL of the exact source of the running build.
 * Two ways to say what that is, and one of them is required:
 *
 * - **`OYL_INSTANCE_COMMIT`**, the full commit this build was made from. The URL
 *   is then this repository's tree at that commit. The Dockerfile requires it
 *   as a build argument.
 * - **`OYL_INSTANCE_SOURCE_URL`**, for an operator who MODIFIED their instance
 *   and therefore owes the offer for their own source (D-6's last bullet). It
 *   wins over the default, and it must be `https:`.
 *
 * ## Registration and moderation — #775, #83
 *
 * - **`OYL_INSTANCE_REGISTRATION`**: `open`, `approval`, `invite` or `closed`.
 *   Case does not matter. ⚠️ **Unset is `closed`** (#891's merge review): an
 *   instance somebody starts without reading this registers nobody, as main's
 *   instance did before the modes existed. The PROJECT's instance registers by
 *   `approval` — the owner's rulings (#16, Q5 and Q13, 2026-09-28) are about
 *   it — and its image sets that (`Dockerfile`).
 * - **`OYL_INSTANCE_OWNER_KEY`** and **`OYL_INSTANCE_DEPUTY_KEY`**: the two
 *   moderators' device keys, 64 lowercase hex characters each (ruling Q13).
 * - **`OYL_INSTANCE_PUBLIC_ROOM_MIN_ACCOUNT_DAYS`** and
 *   **`OYL_INSTANCE_PUBLIC_ROOM_MIN_RIDES`**: public-room eligibility's
 *   thresholds (`moderation/eligibility.ts`).
 * - **`OYL_INSTANCE_CLIENT_ADDRESS_HEADER`**: the header a proxy the operator
 *   runs puts the rider's address in (`cf-connecting-ip` behind a Cloudflare
 *   Tunnel). Believed only from a trusted proxy: `client-address.ts`.
 * - **`OYL_INSTANCE_TRUSTED_PROXIES`**: the proxies that header is believed
 *   from, as exact addresses separated by commas. Loopback is always trusted;
 *   unset means loopback alone (#891's review).
 *
 * ⚠️ **Neither set is a refusal to start, not a default.** An instance that does
 * not know which source it is would have to offer the repository's `main`,
 * which is not the source of what is running — the one answer §13 does not
 * accept. Failing at start-up is the only place that is cheap.
 */

import { isAddress, normalisedAddress } from './client-address.ts';
import { configuredHostProblem } from './history/address.ts';
import {
  DEFAULT_DOCUMENT_PREFIX,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_QUERY_PREFIX,
  type EmbeddingSettings,
} from './history/embedder.ts';
import {
  DEFAULT_PUBLIC_ROOM_THRESHOLDS,
  type PublicRoomThresholds,
} from './moderation/eligibility.ts';
import type { Moderators } from './moderation/moderation.ts';

/** This repository. The same URL `apps/web/src/privacy/policy.ts` §`REPOSITORY` names. */
export const REPOSITORY = 'https://github.com/openzigs/onyourleft';

/** Where the instance listens when nothing is set. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

/** The largest request body the instance reads, in bytes, before answering `payload_too_large`. */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/** How an instance takes new riders (#775). */
export type RegistrationMode = 'open' | 'approval' | 'invite' | 'closed';

export const REGISTRATION_MODES: readonly RegistrationMode[] = [
  'open',
  'approval',
  'invite',
  'closed',
];

/** The mode an instance registers in when the operator sets none: nobody new (#891's merge review). */
export const DEFAULT_REGISTRATION: RegistrationMode = 'closed';

/** The longest name an operator may give their instance, in characters. */
export const MAXIMUM_INSTANCE_NAME_LENGTH = 64;

/** The raw values, as the environment gives them. */
export interface RawConfig {
  readonly host?: string | undefined;
  readonly port?: string | undefined;
  readonly commit?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly registration?: string | undefined;
  readonly ownerKey?: string | undefined;
  readonly deputyKey?: string | undefined;
  readonly publicRoomMinAccountDays?: string | undefined;
  readonly publicRoomMinRides?: string | undefined;
  readonly clientAddressHeader?: string | undefined;
  readonly trustedProxies?: string | undefined;
  readonly embeddingUrl?: string | undefined;
  readonly embeddingModel?: string | undefined;
  readonly embeddingDocumentPrefix?: string | undefined;
  readonly embeddingQueryPrefix?: string | undefined;
  readonly analysisModelUrl?: string | undefined;
  readonly analysisModel?: string | undefined;
  readonly name?: string | undefined;
}

/**
 * The history index (#835, ADR 0040): on, with the embedding model's settings,
 * or off and why. ⚠️ **Off is never a refusal to start** (D-6): the rest of the
 * instance does not depend on it, so a missing or refused address turns the
 * index off and the instance says so in its log.
 */
export type HistorySettings =
  | { readonly kind: 'on'; readonly embedding: EmbeddingSettings }
  | {
      readonly kind: 'off';
      /** Which refusal, short enough for the log to carry (`log.ts`). */
      readonly code: HistoryOffCode;
      /** The sentence an operator reads. */
      readonly reason: string;
    };

/** Why the history index is off. */
export type HistoryOffCode =
  'not-set' | 'not-a-url' | 'not-origin' | 'not-local' | 'bad-model' | 'bad-prefix';

/**
 * The analysis model (#1096, ADR 0046 D-9 source 1): an OpenAI-compatible
 * server at a LOCAL address, and the model the operator pulled — or off, and
 * why. Like the history index, off is never a refusal to start.
 */
export type AnalysisModelSettings =
  | {
      readonly kind: 'on';
      /** The OpenAI-compatible base URL: `http://ollama:11434/v1`. */
      readonly baseUrl: URL;
      /** The model the operator pulled. There is no default (ADR 0031 D-4). */
      readonly model: string;
    }
  | {
      readonly kind: 'off';
      readonly code: AnalysisModelOffCode;
      readonly reason: string;
    };

/** Why the analysis model is off. */
export type AnalysisModelOffCode =
  'not-set' | 'not-a-url' | 'not-base-url' | 'not-local' | 'no-model' | 'bad-model';

/** A configuration the instance can start with. */
export interface Config {
  readonly host: string;
  readonly port: number;
  /** The full commit of this build, when known. */
  readonly commit: string | null;
  /** The URL `GET /source` answers with. */
  readonly sourceUrl: string;
  readonly bodyLimitBytes: number;
  readonly registration: RegistrationMode;
  /** The moderators' device keys (#83, #775). */
  readonly moderators: Moderators;
  readonly publicRooms: PublicRoomThresholds;
  /** The header a local proxy puts the client's address in, lower case, or `null`. */
  readonly clientAddressHeader: string | null;
  /**
   * The proxies the header is believed from besides loopback, each as
   * `client-address.ts` §`normalisedAddress` writes it. Empty: loopback only.
   */
  readonly trustedProxies: readonly string[];
  /** The history index's embedding model, or why there is none (#835). */
  readonly history: HistorySettings;
  /** The analysis agent's model, or why there is none (#1096). */
  readonly analysis: AnalysisModelSettings;
  /**
   * What the operator calls this instance, which a rider's app shows once it
   * is connected (#777) — or `null`, and the app then names the instance by
   * its address. Never invented here: a default name would be a name no
   * operator chose.
   */
  readonly name: string | null;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly problems: readonly string[] };

const COMMIT = /^[0-9a-f]{40}$/;
const DEVICE_KEY = /^[0-9a-f]{64}$/;
const HEADER = /^[a-z0-9-]{1,64}$/;

/** A character a rider's screen should never be handed in a name. */
const UNSHOWABLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

/** Read and check a configuration. Every problem is reported, not only the first. */
export function readConfig(raw: RawConfig): ConfigResult {
  const problems: string[] = [];

  const host = present(raw.host) ? raw.host.trim() : DEFAULT_HOST;

  let port = DEFAULT_PORT;
  if (present(raw.port)) {
    const value = /^[0-9]+$/.test(raw.port.trim()) ? Number(raw.port.trim()) : Number.NaN;
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      problems.push('OYL_INSTANCE_PORT must be a whole number from 0 to 65535.');
    } else {
      port = value;
    }
  }

  let commit: string | null = null;
  if (present(raw.commit)) {
    const value = raw.commit.trim();
    if (COMMIT.test(value)) {
      commit = value;
    } else {
      problems.push('OYL_INSTANCE_COMMIT must be a full 40-character lower-case commit id.');
    }
  }

  let sourceUrl: string | undefined;
  if (present(raw.sourceUrl)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(raw.sourceUrl.trim());
    } catch {
      parsed = undefined;
    }
    if (parsed?.protocol === 'https:') {
      sourceUrl = parsed.href;
    } else {
      problems.push('OYL_INSTANCE_SOURCE_URL must be an https: URL.');
    }
  } else if (commit !== null) {
    sourceUrl = `${REPOSITORY}/tree/${commit}`;
  } else if (!present(raw.commit)) {
    problems.push(
      'Set OYL_INSTANCE_COMMIT to the commit this build was made from, or ' +
        'OYL_INSTANCE_SOURCE_URL to where its source is: AGPL-3.0 §13 requires the ' +
        'instance to offer the source of what is running (ADR 0036 D-6).',
    );
  }

  let registration = DEFAULT_REGISTRATION;
  if (present(raw.registration)) {
    const value = raw.registration.trim().toLowerCase();
    if ((REGISTRATION_MODES as readonly string[]).includes(value)) {
      registration = value as RegistrationMode;
    } else {
      problems.push('OYL_INSTANCE_REGISTRATION must be one of open, approval, invite or closed.');
    }
  }

  const moderators: { owner?: string; deputy?: string } = {};
  for (const [role, name, value] of [
    ['owner', 'OYL_INSTANCE_OWNER_KEY', raw.ownerKey],
    ['deputy', 'OYL_INSTANCE_DEPUTY_KEY', raw.deputyKey],
  ] as const) {
    if (!present(value)) continue;
    if (DEVICE_KEY.test(value.trim())) {
      moderators[role] = value.trim();
    } else {
      problems.push(`${name} must be a device key: 64 lower-case hex characters.`);
    }
  }
  if (moderators.owner !== undefined && moderators.owner === moderators.deputy) {
    problems.push('OYL_INSTANCE_OWNER_KEY and OYL_INSTANCE_DEPUTY_KEY must be two different keys.');
  }

  const whole = (value: string | undefined, name: string, fallback: number): number => {
    if (!present(value)) return fallback;
    const trimmed = value.trim();
    if (/^[0-9]{1,6}$/.test(trimmed)) return Number(trimmed);
    problems.push(`${name} must be a whole number from 0 to 999999.`);
    return fallback;
  };
  const publicRooms: PublicRoomThresholds = {
    minimumAccountDays: whole(
      raw.publicRoomMinAccountDays,
      'OYL_INSTANCE_PUBLIC_ROOM_MIN_ACCOUNT_DAYS',
      DEFAULT_PUBLIC_ROOM_THRESHOLDS.minimumAccountDays,
    ),
    minimumCompletedRides: whole(
      raw.publicRoomMinRides,
      'OYL_INSTANCE_PUBLIC_ROOM_MIN_RIDES',
      DEFAULT_PUBLIC_ROOM_THRESHOLDS.minimumCompletedRides,
    ),
  };

  let clientAddressHeader: string | null = null;
  if (present(raw.clientAddressHeader)) {
    const value = raw.clientAddressHeader.trim().toLowerCase();
    if (HEADER.test(value)) {
      clientAddressHeader = value;
    } else {
      problems.push('OYL_INSTANCE_CLIENT_ADDRESS_HEADER must be a header name.');
    }
  }

  const trustedProxies: string[] = [];
  if (present(raw.trustedProxies)) {
    for (const entry of raw.trustedProxies.split(',').map((each) => each.trim())) {
      if (isAddress(entry)) {
        trustedProxies.push(normalisedAddress(entry));
      } else {
        problems.push(
          'OYL_INSTANCE_TRUSTED_PROXIES must be IP addresses separated by commas, each written exactly as the connection reports it.',
        );
        break;
      }
    }
  }

  let instanceName: string | null = null;
  if (present(raw.name)) {
    const value = raw.name.trim();
    // Shown to riders, so no control, bidirectional or invisible character —
    // the rule a display name has (`@onyourleft/domain` §`checkDisplayName`),
    // applied to the one other name the app renders from an instance.
    if ([...value].length > MAXIMUM_INSTANCE_NAME_LENGTH || UNSHOWABLE.test(value)) {
      problems.push(
        `OYL_INSTANCE_NAME must be at most ${String(MAXIMUM_INSTANCE_NAME_LENGTH)} characters, with no control, bidirectional or invisible character.`,
      );
    } else {
      instanceName = value;
    }
  }

  if (problems.length > 0 || sourceUrl === undefined) {
    return { ok: false, problems };
  }
  const history = readHistorySettings(raw);
  const analysis = readAnalysisModelSettings(raw);
  return {
    ok: true,
    config: {
      host,
      port,
      commit,
      sourceUrl,
      bodyLimitBytes: DEFAULT_BODY_LIMIT_BYTES,
      registration,
      moderators,
      publicRooms,
      clientAddressHeader,
      trustedProxies,
      history,
      analysis,
      name: instanceName,
    },
  };
}

/** A model name as Ollama spells one: `name`, `name:tag`, `namespace/name:tag`. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * The history index's settings (#835, ADR 0040 D-5, D-6), read from
 * `OYL_INSTANCE_EMBEDDING_URL`, `…_MODEL`, `…_DOCUMENT_PREFIX` and
 * `…_QUERY_PREFIX`.
 *
 * - **No address, no index.** Nothing is defaulted: the instance does not
 *   assume a model server is running anywhere.
 * - **The address is local or refused** (D-6): its host must be loopback, a
 *   private address or a single-label name (`address.ts`
 *   §`configuredHostProblem`), it must be `http:` or `https:`, and it names the
 *   server's origin only — no path, no query, no credentials. Every connection
 *   checks where the name resolved to as well (`embedder.ts`).
 * - **The model defaults to `nomic-embed-text`** (the owner's ruling, D-5), and
 *   its prefixes to that model's own. For any other model the prefixes default
 *   to none, because another model's convention is its own. A prefix that is
 *   set is used exactly as it is set, spaces included; set to nothing (as a
 *   copied `.env.example` leaves it) it is unset.
 */
export function readHistorySettings(raw: RawConfig): HistorySettings {
  const off = (code: HistoryOffCode, reason: string): HistorySettings => ({
    kind: 'off',
    code,
    reason,
  });
  if (!present(raw.embeddingUrl)) {
    return off(
      'not-set',
      'OYL_INSTANCE_EMBEDDING_URL is not set, so no embedding model is configured.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw.embeddingUrl.trim());
  } catch {
    return off('not-a-url', 'OYL_INSTANCE_EMBEDDING_URL is not a URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return off('not-a-url', 'OYL_INSTANCE_EMBEDDING_URL must be an http: or https: URL.');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return off(
      'not-origin',
      'OYL_INSTANCE_EMBEDDING_URL must be the model server’s address alone.',
    );
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return off(
      'not-origin',
      'OYL_INSTANCE_EMBEDDING_URL must be the model server’s address, with no path.',
    );
  }
  const hostProblem = configuredHostProblem(url.hostname);
  if (hostProblem !== undefined) {
    return off(
      'not-local',
      `OYL_INSTANCE_EMBEDDING_URL was refused because ${hostProblem}: the embedding model must be on this machine or its private network (ADR 0040 D-6).`,
    );
  }
  const model = present(raw.embeddingModel) ? raw.embeddingModel.trim() : DEFAULT_EMBEDDING_MODEL;
  if (!MODEL_NAME.test(model)) {
    return off(
      'bad-model',
      'OYL_INSTANCE_EMBEDDING_MODEL must be a model name, such as name or name:tag.',
    );
  }
  const isDefault = model === DEFAULT_EMBEDDING_MODEL;
  const documentPrefix = present(raw.embeddingDocumentPrefix)
    ? raw.embeddingDocumentPrefix
    : isDefault
      ? DEFAULT_DOCUMENT_PREFIX
      : '';
  const queryPrefix = present(raw.embeddingQueryPrefix)
    ? raw.embeddingQueryPrefix
    : isDefault
      ? DEFAULT_QUERY_PREFIX
      : '';
  for (const [name, prefix] of [
    ['OYL_INSTANCE_EMBEDDING_DOCUMENT_PREFIX', documentPrefix],
    ['OYL_INSTANCE_EMBEDDING_QUERY_PREFIX', queryPrefix],
  ] as const) {
    if (prefix.length > 100 || CONTROL.test(prefix)) {
      return off(
        'bad-prefix',
        `${name} must be at most 100 characters, with no control character.`,
      );
    }
  }
  return {
    kind: 'on',
    embedding: { endpoint: new URL(url.origin), model, documentPrefix, queryPrefix },
  };
}

/**
 * The analysis model's settings (#1096, ADR 0046 D-9 source 1), read from
 * `OYL_INSTANCE_ANALYSIS_MODEL_URL` and `OYL_INSTANCE_ANALYSIS_MODEL`.
 *
 * - **No address, no analysis.** Nothing is defaulted.
 * - **The address is local or refused**, by the history index's own rule
 *   (`history/address.ts` §`configuredHostProblem`, ADR 0040 D-6): loopback,
 *   a private, link-local, shared or unique-local literal, or a single-label
 *   (Compose) name. A public name and `.local` are refused here; where a name
 *   resolves to is checked again on every request (`analysis/model.ts`).
 * - **It is a base URL**: `http:` or `https:`, no credentials, query or
 *   fragment. A path is kept (`/v1`), because an OpenAI-compatible server is
 *   addressed by one.
 * - **The model has NO default**, and no model is named in source or the
 *   documentation (ADR 0031 D-4): an address with no model is off, saying so.
 */
export function readAnalysisModelSettings(raw: RawConfig): AnalysisModelSettings {
  const off = (code: AnalysisModelOffCode, reason: string): AnalysisModelSettings => ({
    kind: 'off',
    code,
    reason,
  });
  if (!present(raw.analysisModelUrl)) {
    return off(
      'not-set',
      'OYL_INSTANCE_ANALYSIS_MODEL_URL is not set, so no analysis model is configured.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw.analysisModelUrl.trim());
  } catch {
    return off('not-a-url', 'OYL_INSTANCE_ANALYSIS_MODEL_URL is not a URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return off('not-a-url', 'OYL_INSTANCE_ANALYSIS_MODEL_URL must be an http: or https: URL.');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return off(
      'not-base-url',
      'OYL_INSTANCE_ANALYSIS_MODEL_URL must be the server’s base URL alone, with no credentials, query or fragment.',
    );
  }
  const hostProblem = configuredHostProblem(url.hostname);
  if (hostProblem !== undefined) {
    return off(
      'not-local',
      `OYL_INSTANCE_ANALYSIS_MODEL_URL was refused because ${hostProblem}: the analysis model must be on this machine or its private network (ADR 0046 D-9, ADR 0040 D-6).`,
    );
  }
  if (!present(raw.analysisModel)) {
    return off(
      'no-model',
      'OYL_INSTANCE_ANALYSIS_MODEL is not set: name the model you pulled. There is no default.',
    );
  }
  const model = raw.analysisModel.trim();
  if (!MODEL_NAME.test(model)) {
    return off(
      'bad-model',
      'OYL_INSTANCE_ANALYSIS_MODEL must be a model name, such as name or name:tag.',
    );
  }
  const baseUrl = new URL(url.href.replace(/\/+$/, ''));
  return { kind: 'on', baseUrl, model };
}

/**
 * What `createIdentity` takes from the configuration (#775): the registration
 * mode, the moderators and the public-room thresholds. One function, so the
 * entry point that opens the store (#780) and the test that starts an
 * instance with nothing configured hand the identity the same settings.
 */
export function identitySettings(config: Config): {
  readonly registration: RegistrationMode;
  readonly moderators: Moderators;
  readonly publicRooms: PublicRoomThresholds;
} {
  return {
    registration: config.registration,
    moderators: config.moderators,
    publicRooms: config.publicRooms,
  };
}
