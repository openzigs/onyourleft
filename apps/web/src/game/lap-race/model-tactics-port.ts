// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a lap race with AI bots needs from the rider's instance** — #2710,
 * ADR 0071 D-5 to D-7, over #2709's six sealed routes
 * (`apps/instance` §`analysis/tactics-routes.ts`).
 *
 * A port, so `GameView` and the race name neither the instance nor a store:
 * `main.tsx` builds the one production port over the sealed session the
 * Connect screen keeps, and a test hands in a double. `check:wiring` watches
 * every method here (`WIRE003`).
 *
 * ## No network primitive here
 *
 * Every call goes through a {@link TacticsChannel}, which production fills
 * with `instance/instance-transport.ts` §`sealedInstance` — the ONE module the
 * client reaches an instance through (#777, ADR 0036 D-3 (a)), and the one
 * `privacy/no-network.test.ts` admits. The routes are sealed-only (ADR 0047
 * D-7), so a device with no sealed session sends nothing at all.
 *
 * ## What leaves
 *
 * A consent's `instance` and `modelAddress`, exactly as the status named them;
 * one bot's ask `model-race.ts` §`askLapRaceModel` built (#2836) and the
 * instance's own reader checked on the device (no coordinate, no name, no
 * date, no identifier); and the start and end of a race, which carry nothing.
 *
 * ## What arrives is untrusted
 *
 * A status is read field by field ({@link readTacticsStatus}): anything else
 * is `unreachable`, and the option is not offered. A decision's body is
 * handed on unread, as a reply the race checks again with
 * `@onyourleft/domain` §`readModelTacticsAnswer` (D-3.2). Every call settles
 * and never rejects.
 *
 * ⚠️ **Absent, there are no AI bots**, and nothing else changes: a rider with
 * no instance rides the seeded race (ADR 0036 D-3 (a), ADR 0071 D-1.4).
 */

import type { ModelTacticsInput } from '@onyourleft/domain';

import type { ModelTacticsReply } from './model-race';

/** One call's answer, as a sealed channel hands it over. */
export interface TacticsAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** What the tactics calls go through: a sealed instance and its session, in production. */
export interface TacticsChannel {
  call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { readonly token: string; readonly body?: Readonly<Record<string, unknown>> },
  ): Promise<TacticsAnswer>;
}

/** The session the calls run under, or none: no sign-in, a website's copy, keys that do not verify. */
export type TacticsSession =
  | { readonly kind: 'open'; readonly channel: TacticsChannel; readonly token: string }
  | { readonly kind: 'closed' };

/** Whether the rider's instance offers AI bots now, and what a consent names (ADR 0071 D-5.2). */
export type TacticsStatus =
  | {
      readonly kind: 'offered';
      /** The instance a consent names: the rider's own, as it names itself. */
      readonly instance: string;
      /** The address of its local model now: what a consent names, and voids when it changes. */
      readonly modelAddress: string;
      /** Whether the rider's recorded consent names that address now. */
      readonly consented: boolean;
    }
  /** The instance answered: no local model is offered to this rider. */
  | { readonly kind: 'not-offered' }
  /** No sealed session, no answer, or one this build cannot read. */
  | { readonly kind: 'unreachable' };

export interface ModelTacticsPort {
  /** `GET /v1/analysis/tactics`: asked when the lap race's setup is shown. */
  tacticsStatus(): Promise<TacticsStatus>;
  /** `POST /v1/analysis/tactics/consent`, naming what the status named: the status after. */
  recordTacticsConsent(consent: {
    readonly instance: string;
    readonly modelAddress: string;
  }): Promise<TacticsStatus>;
  /** `DELETE /v1/analysis/tactics/consent`: the status after. */
  withdrawTacticsConsent(): Promise<TacticsStatus>;
  /** `POST /v1/analysis/tactics/start`: the race takes the model slot and warms the model. */
  startTacticsRace(): Promise<ModelTacticsReply>;
  /** `POST /v1/analysis/tactics/decide` on one bot's ask (#2836). */
  decideTactics(input: ModelTacticsInput): Promise<ModelTacticsReply>;
  /** `POST /v1/analysis/tactics/end`: the slot let go. Settles; says nothing. */
  endTacticsRace(): Promise<void>;
}

/** A refusal code the instance names: a short identifier. Anything else is read as no code. */
const CODE = /^[a-z][a-z0-9_-]{0,63}$/;

/** The longest instance name or model address read, characters: far over any URL a rider sets. */
const MOST_NAME_CHARACTERS = 2_048;

const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MOST_NAME_CHARACTERS;

/** A status body, read field by field. */
export function readTacticsStatus(answer: TacticsAnswer): TacticsStatus {
  if (answer.status !== 200) return { kind: 'unreachable' };
  const body = answer.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'unreachable' };
  }
  const { offered, instance, modelAddress, consented } = body as Readonly<Record<string, unknown>>;
  if (typeof offered !== 'boolean' || typeof consented !== 'boolean') {
    return { kind: 'unreachable' };
  }
  if (!offered) return { kind: 'not-offered' };
  if (!isName(instance) || !isName(modelAddress)) return { kind: 'unreachable' };
  return { kind: 'offered', instance, modelAddress, consented };
}

function replyOf(answer: TacticsAnswer, ok: number): ModelTacticsReply {
  if (answer.status === ok) return { kind: 'answer', body: answer.body };
  const code = (answer.body as { error?: { code?: unknown } } | null)?.error?.code;
  return { kind: 'refused', ...(typeof code === 'string' && CODE.test(code) ? { code } : {}) };
}

/** What {@link createModelTacticsPort} is built over. */
export interface ModelTacticsPortDependencies {
  /** The sealed session the calls run under now: asked for each call, so a disconnect is seen at the next. */
  readonly session: () => Promise<TacticsSession>;
}

/** The production {@link ModelTacticsPort}. See the file comment. */
export function createModelTacticsPort(
  dependencies: ModelTacticsPortDependencies,
): ModelTacticsPort {
  /** One call, or `undefined` with no session or no answer. Never rejects. */
  const call = async (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<TacticsAnswer | undefined> => {
    try {
      const session = await dependencies.session();
      if (session.kind !== 'open') return undefined;
      return await session.channel.call(method, path, {
        token: session.token,
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      return undefined;
    }
  };
  const status = async (answer: Promise<TacticsAnswer | undefined>): Promise<TacticsStatus> => {
    const got = await answer;
    return got === undefined ? { kind: 'unreachable' } : readTacticsStatus(got);
  };
  const reply = async (
    answer: Promise<TacticsAnswer | undefined>,
    ok: number,
  ): Promise<ModelTacticsReply> => {
    const got = await answer;
    return got === undefined ? { kind: 'unreachable' } : replyOf(got, ok);
  };
  return {
    tacticsStatus: () => status(call('GET', '/v1/analysis/tactics')),
    recordTacticsConsent: (consent) =>
      status(
        call('POST', '/v1/analysis/tactics/consent', {
          instance: consent.instance,
          modelAddress: consent.modelAddress,
        }),
      ),
    withdrawTacticsConsent: () => status(call('DELETE', '/v1/analysis/tactics/consent')),
    startTacticsRace: () => reply(call('POST', '/v1/analysis/tactics/start'), 202),
    decideTactics: (input) => reply(call('POST', '/v1/analysis/tactics/decide', { input }), 200),
    endTacticsRace: async () => {
      await call('POST', '/v1/analysis/tactics/end');
    },
  };
}
