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
 *   ⚠️ **Unset is `approval`** — the owner's ruling (#16, Q5 and Q13,
 *   2026-09-28) — so an instance somebody starts without reading this does not
 *   let anybody in unseen.
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

/** The mode an instance registers in when the operator sets none (#775, rulings Q5 and Q13). */
export const DEFAULT_REGISTRATION: RegistrationMode = 'approval';

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
}

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
}

export type ConfigResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly problems: readonly string[] };

const COMMIT = /^[0-9a-f]{40}$/;
const DEVICE_KEY = /^[0-9a-f]{64}$/;
const HEADER = /^[a-z0-9-]{1,64}$/;

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
    const value = raw.registration.trim();
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

  if (problems.length > 0 || sourceUrl === undefined) {
    return { ok: false, problems };
  }
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
    },
  };
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
