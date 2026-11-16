// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The AI pacer, asked of this device's instance** (#2712, ADR 0072): what
 * the trainer game may ask, and the one production implementation of it.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method
 * of {@link PacerPort} (WIRE003) and every export of this file (WIRE002), and
 * `main.tsx` is the only production code that names {@link createPacerPort}.
 *
 * ## What leaves, and what comes back
 *
 * Every call is SEALED, through `instance-transport.ts`, the one module this
 * client sends instance traffic through (ADR 0036 D-3 (a)), and every route
 * is sealed-only on the instance (ADR 0047 D-7):
 *
 * - **Status and consent**: `GET /v1/analysis/tactics`, and
 *   `POST` and `DELETE /v1/analysis/tactics/consent` — the same consent as AI bots, naming
 *   the rider's instance and its local model address (ADR 0072 D-1.3).
 * - **The ride's slot**: `POST /v1/analysis/tactics/start` and `end`, so
 *   write-ups on the instance wait while the ride runs (ADR 0071 D-6).
 * - **One decision**: `POST /v1/analysis/pacer/decide`, carrying
 *   `@onyourleft/domain` §`ModelPacerInput` — the pacer's W/kg, plan and
 *   intent, the rider's gap, W/kg and draft, the grade ahead, the metres to
 *   the finish, the seconds ridden. **No coordinate, no name, no date, no id.**
 *   Back: a plan, an intent and a line, **read again here** by
 *   §`readModelPacerAnswer`, so an instance that answered a power, a bad
 *   word or a field it should not have has answered nothing.
 *
 * ## Nothing for a rider with no instance
 *
 * {@link PacerPort.offered} reads this device's storage and nothing else, as
 * `ghost-port.ts` does. With no instance, or one this copy of the app cannot
 * seal to, it is `false`: the game offers no AI pacer and sends nothing. A
 * rider with no instance loses this and nothing else (ADR 0036 D-3 (a)).
 */

import {
  readModelPacerAnswer,
  type ModelPacerInput,
  type PacerDirection,
} from '@onyourleft/domain';

import { heldInstanceSession, heldSealedSession, type SealingDependencies } from './instance-port';
import { sealedRouteGate } from './instance-pin';
import { readInstanceAccount } from './sign-in';

/**
 * How long a decision may take on the wire: **10 s**, the instance's own
 * wait for the model (`apps/instance` §`TACTICS_ANSWER_WAIT_MS`). An answer
 * past 5 s is logged late and never ridden anyway (ADR 0072 D-7).
 */
export const PACER_DECISION_TIMEOUT_MILLISECONDS = 10_000;

/** What the instance says of the AI pacer for this rider, or why it could not be asked. */
export type PacerStatus =
  | {
      readonly kind: 'offered';
      /** The instance a consent names: this rider's. */
      readonly instance: string;
      /** The local model address a consent names now. */
      readonly modelAddress: string;
      /** Whether this rider's recorded consent names that address. */
      readonly consented: boolean;
    }
  /** The instance offers this rider no local model now. */
  | { readonly kind: 'not-offered' }
  /** The instance could not be asked, or answered something that is not a status. */
  | { readonly kind: 'unavailable' };

/** What one decision came to. */
export type PacerReply =
  | { readonly kind: 'answer'; readonly direction: PacerDirection; readonly say: string }
  /** The instance or this device read the model's answer as no decision. */
  | { readonly kind: 'invalid' }
  /** Refused before a model was called: no consent, not offered, busy, rate limited. */
  | { readonly kind: 'refused' }
  /** No answer: the model gave none in time, or the instance could not be reached. */
  | { readonly kind: 'failed' };

/** What the trainer game may ask of the instance for an AI pacer. */
export interface PacerPort {
  /** Whether to offer the AI pacer at all — from this device's storage, sending nothing. */
  offered(): boolean;
  /** The instance's answer for this rider now. */
  pacerStatus(): Promise<PacerStatus>;
  /** Record the rider's consent naming `status`'s instance and model address. The status after. */
  consentToPacer(status: Extract<PacerStatus, { kind: 'offered' }>): Promise<PacerStatus>;
  /** Withdraw it (ADR 0071 D-5.4): the next decision is refused. The status after. */
  withdrawPacerConsent(): Promise<PacerStatus>;
  /** A directed ride is starting: take the model slot, and warm the model. Never rejects. */
  startPacerRide(): Promise<boolean>;
  /** One decision on the ride as it stands. Never rejects. */
  decidePacer(input: ModelPacerInput): Promise<PacerReply>;
  /** The directed ride has ended: let the slot go. Never rejects. */
  endPacerRide(): Promise<void>;
}

export type PacerPortDependencies = SealingDependencies;

/** The status body as a {@link PacerStatus}, or `unavailable` for anything else. */
export function parsePacerStatus(body: unknown): PacerStatus {
  if (typeof body !== 'object' || body === null) return { kind: 'unavailable' };
  const { offered, instance, modelAddress, consented } = body as Record<string, unknown>;
  if (typeof offered !== 'boolean' || typeof consented !== 'boolean')
    return { kind: 'unavailable' };
  if (!offered) return { kind: 'not-offered' };
  if (typeof instance !== 'string' || typeof modelAddress !== 'string') {
    return { kind: 'unavailable' };
  }
  return { kind: 'offered', instance, modelAddress, consented };
}

/**
 * The codes an instance refuses a decision with before a model is called.
 * `rate_limited` is not one: it answers a re-ask while the instance still waits
 * on the previous one (a cold model load), which one slow answer must not turn
 * into the pacer being off for the rest of the ride.
 */
const REFUSALS: ReadonlySet<unknown> = new Set([
  'local_unavailable',
  'tactics_consent_required',
  'tactics_busy',
  'validation_failed',
]);

/** A decision's answer as a {@link PacerReply}: read again here, whatever the instance checked. */
export function parsePacerReply(status: number, body: unknown): PacerReply {
  if (status === 200) {
    const read = readModelPacerAnswer(JSON.stringify(body));
    return read.ok
      ? { kind: 'answer', direction: read.direction, say: read.say }
      : { kind: 'invalid' };
  }
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (code === 'tactics_invalid') return { kind: 'invalid' };
  return REFUSALS.has(code) ? { kind: 'refused' } : { kind: 'failed' };
}

/** The production {@link PacerPort}: `main.tsx` builds it, and nothing else in the client. */
export function createPacerPort(dependencies: PacerPortDependencies): PacerPort {
  const session = heldSealedSession(dependencies);

  async function status(): Promise<PacerStatus> {
    try {
      const held = await session();
      if (held.kind === 'closed') return { kind: 'unavailable' };
      const answer = await held.sealed.call('GET', '/v1/analysis/tactics', { token: held.token });
      return answer.status === 200 ? parsePacerStatus(answer.body) : { kind: 'unavailable' };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  return {
    offered: () => {
      const account = readInstanceAccount(dependencies.storage);
      if (account === undefined || heldInstanceSession(dependencies.storage) === undefined) {
        return false;
      }
      return sealedRouteGate(account, dependencies.loadedFrom).kind === 'open';
    },
    pacerStatus: status,
    consentToPacer: async (offered) => {
      try {
        const held = await session();
        if (held.kind === 'closed') return { kind: 'unavailable' };
        const answer = await held.sealed.call('POST', '/v1/analysis/tactics/consent', {
          token: held.token,
          body: { instance: offered.instance, modelAddress: offered.modelAddress },
        });
        return answer.status === 200 ? parsePacerStatus(answer.body) : { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },
    withdrawPacerConsent: async () => {
      try {
        const held = await session();
        if (held.kind === 'closed') return { kind: 'unavailable' };
        const answer = await held.sealed.call('DELETE', '/v1/analysis/tactics/consent', {
          token: held.token,
        });
        return answer.status === 200 ? parsePacerStatus(answer.body) : { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },
    startPacerRide: async () => {
      try {
        const held = await session();
        if (held.kind === 'closed') return false;
        const answer = await held.sealed.call('POST', '/v1/analysis/tactics/start', {
          token: held.token,
        });
        return answer.status === 202;
      } catch {
        return false;
      }
    },
    decidePacer: async (input) => {
      try {
        const held = await session();
        if (held.kind === 'closed') return { kind: 'failed' };
        const answer = await held.sealed.call('POST', '/v1/analysis/pacer/decide', {
          token: held.token,
          body: { input },
          timeoutMilliseconds: PACER_DECISION_TIMEOUT_MILLISECONDS,
        });
        return parsePacerReply(answer.status, answer.body);
      } catch {
        return { kind: 'failed' };
      }
    },
    endPacerRide: async () => {
      try {
        const held = await session();
        if (held.kind === 'closed') return;
        await held.sealed.call('POST', '/v1/analysis/tactics/end', { token: held.token });
      } catch {
        // The instance lets the slot go on its own lapse (ADR 0071 D-6.4).
      }
    },
  };
}
