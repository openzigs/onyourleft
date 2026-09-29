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
 * ⚠️ **Neither set is a refusal to start, not a default.** An instance that does
 * not know which source it is would have to offer the repository's `main`,
 * which is not the source of what is running — the one answer §13 does not
 * accept. Failing at start-up is the only place that is cheap.
 */

/** This repository. The same URL `apps/web/src/privacy/policy.ts` §`REPOSITORY` names. */
export const REPOSITORY = 'https://github.com/openzigs/onyourleft';

/** Where the instance listens when nothing is set. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8787;

/** The largest request body the instance reads, in bytes, before answering `payload_too_large`. */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

/** The longest name an operator may give their instance, in characters. */
export const MAXIMUM_INSTANCE_NAME_LENGTH = 64;

/** The raw values, as the environment gives them. */
export interface RawConfig {
  readonly host?: string | undefined;
  readonly port?: string | undefined;
  readonly commit?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly name?: string | undefined;
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

  let name: string | null = null;
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
      name = value;
    }
  }

  if (problems.length > 0 || sourceUrl === undefined) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    config: { host, port, commit, sourceUrl, bodyLimitBytes: DEFAULT_BODY_LIMIT_BYTES, name },
  };
}
