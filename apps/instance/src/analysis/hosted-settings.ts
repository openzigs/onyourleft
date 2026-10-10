// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A rider's own hosted model key, and their own hosted consent** — #1199,
 * ADR 0046 D-9 as the owner ruled it on 2026-10-09.
 *
 * *"Operator key is not shared with riders. If it is hosted they need to
 * bring their own key."* D-9's Share mode is withdrawn, so there is no
 * operator's switch and no shared key: a hosted job runs on the athlete's own
 * key (`hosted-key.ts` §`ownHostedKeyState`), and only while their own
 * consent names the origin that key goes to (Q10, `source.ts`).
 *
 * ## What this holds
 *
 * - **The key**: sealed under `OYL_INSTANCE_SECRET_KEY` exactly as the
 *   operator's one key is (`hosted-key.ts` §`sealHostedKey`, the athlete, the
 *   URL and the model bound in), one an athlete, never read back to anybody:
 *   {@link HostedStatus} carries the URL and the model and never the key.
 *   With no secret there is nothing to seal it under, so it is refused
 *   `unavailable` before it is read, and never stored in clear.
 * - **The consent**: the ORIGIN it names (`hosted-key.ts` §`hostedOriginOf`)
 *   and when. A key stored at ANOTHER origin withdraws it, in the store's
 *   own transaction (`sql-store.ts` §`putAthleteHostedKey`); a key rotated at
 *   the same origin keeps it.
 *
 * ⚠️ **Every route that reaches this is sealed-only** (ADR 0047 D-7, D-13;
 * `sealed/phase-one.ts`): a pasted key is accepted from anywhere, but only
 * sealed to the instance's key and signed by a device key, so no plaintext
 * key route exists and ADR 0046's home-network-only rule (Q11) is not built.
 * The device pads a request that carries a key (`pastedKey`, D-9's 1 KiB).
 *
 * The wording a rider reads — the consent itself, and that the operator
 * could technically read a key they bring (ruling 5) — is the app's and
 * #1104's; nothing here is a sentence a rider is shown.
 */

import type { Caller } from '../auth/identity.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { SqlStore } from '../store/sql-store.ts';
import {
  hostedKeyFrom,
  hostedModelFrom,
  hostedOriginOf,
  hostedUrlFrom,
  sealHostedKey,
  type SecretKey,
} from './hosted-key.ts';

/**
 * What the instance says when it has no `OYL_INSTANCE_SECRET_KEY` to seal a
 * key under. Fixed: it names no key, URL or model.
 */
export const HOSTED_KEY_NEEDS_SECRET =
  'This instance cannot hold a hosted model key: its operator has not set OYL_INSTANCE_SECRET_KEY. Nothing was stored.';

/** What a rider may read back of their own hosted settings. Never the key. */
export interface HostedStatus {
  readonly key: {
    readonly url: string;
    readonly model: string;
    /** Unix seconds. */
    readonly setAt: number;
    /**
     * `app` for a key the rider stored themselves; `operator-command` for the
     * operator's one key (`operator model-key set`), which serves only the
     * operator's own jobs and is cleared only by that command.
     */
    readonly setBy: 'app' | 'operator-command';
  } | null;
  readonly consent: {
    readonly origin: string;
    /** Unix seconds. */
    readonly recordedAt: number;
  } | null;
}

export type HostedOutcome =
  | { readonly ok: true; readonly value: HostedStatus }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly fields?: readonly FieldProblem[];
      /** A fixed sentence in place of the code's own ({@link HOSTED_KEY_NEEDS_SECRET}). */
      readonly message?: string;
    };

export interface HostedSettings {
  status(caller: Caller): Promise<HostedStatus>;
  /** Store the caller's own key: `{ url, model, key }`. */
  setKey(caller: Caller, body: Readonly<Record<string, unknown>>): Promise<HostedOutcome>;
  /** Clear the key the caller stored, scrubbed. Never the operator's one key. */
  clearKey(caller: Caller): Promise<HostedStatus>;
  /** Record the caller's consent naming an endpoint: `{ endpoint }`. */
  recordConsent(caller: Caller, body: Readonly<Record<string, unknown>>): Promise<HostedOutcome>;
  /** Withdraw the caller's consent. */
  withdrawConsent(caller: Caller): Promise<HostedStatus>;
}

export interface HostedSettingsOptions {
  readonly store: Pick<
    SqlStore,
    | 'putAthleteHostedKey'
    | 'getAthleteHostedKey'
    | 'clearAthleteHostedKey'
    | 'getHostedModelKey'
    | 'putHostedConsent'
    | 'getHostedConsent'
    | 'clearHostedConsent'
  >;
  /** The instance's secret, or `undefined` when it has none. */
  readonly secret: () => Promise<SecretKey | undefined>;
  /** Unix milliseconds. */
  readonly now: () => number;
}

const KEY_FIELDS = ['url', 'model', 'key'] as const;
const CONSENT_FIELDS = ['endpoint'] as const;

/** A problem for every field not in `allowed`, or not a string among `allowed`. */
function shapeProblems(
  body: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field))
      problems.push({ field, problem: 'is not a field of this request' });
  }
  for (const field of allowed) {
    if (typeof body[field] !== 'string') problems.push({ field, problem: 'must be a string' });
  }
  return problems;
}

export function createHostedSettings(options: HostedSettingsOptions): HostedSettings {
  const { store } = options;

  async function status(athleteId: string): Promise<HostedStatus> {
    const own = await store.getAthleteHostedKey(athleteId);
    const operators = own === undefined ? await store.getHostedModelKey() : undefined;
    const consent = await store.getHostedConsent(athleteId);
    const key =
      own !== undefined
        ? { url: own.url, model: own.model, setAt: own.setAt, setBy: 'app' as const }
        : operators?.athleteId === athleteId
          ? {
              url: operators.url,
              model: operators.model,
              setAt: operators.setAt,
              setBy: 'operator-command' as const,
            }
          : null;
    return {
      key,
      consent:
        consent === undefined ? null : { origin: consent.origin, recordedAt: consent.recordedAt },
    };
  }

  return {
    status: (caller) => status(caller.athleteId),

    async setKey(caller, body) {
      // No secret, nothing to seal under: refused before the key is so much as read.
      const secret = await options.secret();
      if (secret === undefined) {
        return { ok: false, code: 'unavailable', message: HOSTED_KEY_NEEDS_SECRET };
      }
      const problems = shapeProblems(body, KEY_FIELDS);
      if (problems.length > 0) return { ok: false, code: 'validation_failed', fields: problems };
      const url = hostedUrlFrom(body.url as string);
      const model = hostedModelFrom(body.model as string);
      const key = hostedKeyFrom(body.key as string);
      if (!url.ok) problems.push({ field: 'url', problem: url.problem.replace('--url ', '') });
      if (model === undefined) {
        problems.push({ field: 'model', problem: 'must be printable characters, no spaces' });
      }
      // Never echoes the key: a problem names the field and the rule.
      if (key === undefined) {
        problems.push({ field: 'key', problem: 'must be one line of printable characters' });
      }
      if (!url.ok || model === undefined || key === undefined) {
        return { ok: false, code: 'validation_failed', fields: problems };
      }
      const sealed = await sealHostedKey(secret, {
        athleteId: caller.athleteId,
        url: url.url.href,
        model,
        key,
      });
      const put = await store.putAthleteHostedKey(caller.athleteId, {
        url: url.url.href,
        model,
        ...sealed,
        setAt: Math.floor(options.now() / 1000),
      });
      if (put.outcome === 'no-athlete') return { ok: false, code: 'not_found' };
      return { ok: true, value: await status(caller.athleteId) };
    },

    async clearKey(caller) {
      await store.clearAthleteHostedKey(caller.athleteId);
      return status(caller.athleteId);
    },

    async recordConsent(caller, body) {
      const problems = shapeProblems(body, CONSENT_FIELDS);
      if (problems.length > 0) return { ok: false, code: 'validation_failed', fields: problems };
      const origin = hostedOriginOf(body.endpoint as string);
      if (origin === undefined) {
        return {
          ok: false,
          code: 'validation_failed',
          fields: [{ field: 'endpoint', problem: 'must be an https: URL with no user name' }],
        };
      }
      const put = await store.putHostedConsent({
        athleteId: caller.athleteId,
        origin,
        recordedAt: Math.floor(options.now() / 1000),
      });
      if (put.outcome === 'no-athlete') return { ok: false, code: 'not_found' };
      return { ok: true, value: await status(caller.athleteId) };
    },

    async withdrawConsent(caller) {
      await store.clearHostedConsent(caller.athleteId);
      return status(caller.athleteId);
    },
  };
}
