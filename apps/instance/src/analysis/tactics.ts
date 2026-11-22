// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Model-chosen lap-race bot tactics, on the rider's own instance** — #2709,
 * ADR 0071.
 *
 * A device racing "AI bots" sends one bot's ask (`@onyourleft/domain`
 * §`ModelTacticsInput`, built and checked on the device: the race as it
 * stands, and the bot with the menu of moves the device offers it; #2836, ADR
 * 0081) and gets back a reason word and one move from that menu, or a code —
 * and on any code, or any answer later than its own late limit, the bot rides
 * its seeded tactics (D-7). Nothing here is ever on the trainer's path: the
 * instance has no Bluetooth at all (D-8.1), and the answer names no power
 * (D-3.1).
 *
 * ## Every request, in order (D-5)
 *
 * 1. **The local model only** (D-5.1). The operator's settings, read on every
 *    request (`settings.ts`), must offer this athlete the local model — the
 *    local source on, a model named, and for anybody but the operator the
 *    switch for other riders on (D-5.5) — or `local_unavailable`, before
 *    anything else is read. **No hosted model plays the bots, on any key.**
 * 2. **The rider's own consent** (D-5.2): recorded on this instance, naming
 *    the local model ADDRESS the settings give now. A consent naming another
 *    address is none: changing the address withdraws every rider's consent
 *    (D-5.3). None, `tactics_consent_required`, before a model is called.
 * 3. **The race state** (D-3.4), read field by field: exactly the domain's
 *    shape, no key it does not name, no more than its length cap.
 * 4. **The model slot** (D-6.3, `tactics-hold.ts`): one model race per
 *    instance; another athlete's race holds it, `tactics_busy`.
 * 5. **One model call**: `tactics-prompt.ts`'s body to Ollama's `/api/chat`
 *    on the configured address — every address of its name local, checked on
 *    every request (`local-server.ts` §`askLocal`, ADR 0040 D-6) — with no
 *    tools, reasoning off, and a bounded wait. Then the answer is read field by
 *    field and capped in length (`@onyourleft/domain` §`readModelTacticsAnswer`):
 *    `tactics_invalid` for an answer that is no decision, `tactics_failed` for
 *    no answer at all. **The model's text is never kept, logged or returned**
 *    (D-3.5): only the pick read out of it.
 *
 * The athlete is always the session's (D-5.6): no field of any request names
 * one. Every route is sealed-only (`tactics-routes.ts`).
 *
 * ## One line a call (#2836, ADR 0081 D-5.2)
 *
 * Each bot decision writes one `tactics-call` line ({@link TacticsCallLine}):
 * the prompt's version, the model's name, how it ended, and what the model
 * server said the call cost — its load time, the tokens in and out, and the
 * time taken. **Numbers and closed words only**: never the model's text, never
 * a move, never anything of the race or the rider, and no place.
 * `log.ts` §`EVENT_KEYS` holds each key to the one shape written here.
 *
 * ## The AI pacer (#2712, ADR 0072)
 *
 * {@link Tactics.pace} is a decision for the bot pacer instead of the bots,
 * under ADR 0072, which applies ADR 0071's rules to it: **the same consent**
 * (it names a place, the instance and its local model address, and one
 * consent covers a model during either kind of ride, ADR 0072 D-1.3), **the
 * same slot and hold** (write-ups wait while a directed ride runs; `start`
 * and `end` claim and let it go), the same rate limit, the same one call with
 * no tools and reasoning off. The state is `@onyourleft/domain`
 * §`ModelPacerInput`, and the answer a plan, an intent and a line of
 * feedback screened by §`readModelPacerAnswer` — never a power.
 *
 * ## Warm-up (D-6.5)
 *
 * `start` claims the slot and sends one call of the same shape about a fixed
 * race (`tactics-prompt.ts` §`WARM_UP_INPUT`, nothing of the rider's), so the
 * model is loaded before the first real decision — spike 0039 measured a cold
 * load at about 11 s. It answers at once; the call runs on, bounded by
 * {@link TACTICS_WARM_UP_WAIT_MS}, and what it answers is dropped.
 */

import {
  readModelPacerAnswer,
  readModelPacerInput,
  readModelTacticsAnswer,
  readModelTacticsInput,
  type ModelTacticsPick,
  type PacerIntent,
  type PacerPlan,
} from '@onyourleft/domain';

import type { Caller, Outcome } from '../auth/identity.ts';
import { createRateLimiter, type RateLimit } from '../auth/rate-limit.ts';
import type { FieldProblem } from '../errors.ts';
import type { Resolver } from '../history/address.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { askLocal } from './local-server.ts';
import { pacerRequest } from './pacer-prompt.ts';
import type { EffectiveAnalysisSettings } from './settings.ts';
import { TACTICS_PROMPT_VERSION, tacticsRequest, WARM_UP_INPUT } from './tactics-prompt.ts';
import type { RaceHold } from './tactics-hold.ts';

/**
 * How long one decision may wait for the model: **10 s**.
 *
 * ## Provenance — the author's choice, against spike 0039's figures
 *
 * Spike 0039 measured a decision at a median 2.51 s and at most 4.15 s of
 * server time, and drafted a late limit of 5 s from the ask, applied by the
 * device (ADR 0071 D-7). Twice that leaves room for the tunnel's two legs, so
 * no answer the device would still apply is cut off here; past it the answer
 * is late anyway, and the request is closed so it stops waiting at the model
 * server behind a write-up (spike 0039 §4: 24 to 30 s). Since #2759 the
 * device's late limit is 8 s (ADR 0076 D-11), still under this, so this
 * still cuts off no answer the device would apply.
 */
export const TACTICS_ANSWER_WAIT_MS = 10_000;

/**
 * How long the warm-up call may run: **2 minutes**. A cold load took about
 * 11 s on the owner's PC (spike 0039 §1); a slower disk, or a write-up the
 * call queues behind (D-6.2), takes longer, and nothing waits on it.
 */
export const TACTICS_WARM_UP_WAIT_MS = 120_000;

/** The most the warm-up asks the model to write: one token. It is the load that matters. */
const WARM_UP_TOKENS = 1;

/**
 * How many decisions and starts one athlete may ask a minute: **90**, and one
 * decision at a time.
 *
 * ## Provenance — the author's choice
 *
 * Until #2836 it was 30: spike 0039 asked for the whole field every 4 s of
 * race time, 15 a minute, and 30 was twice that. Since ADR 0081 D-2.1 the
 * device asks about one bot at a time and no more often than once a second
 * (`@onyourleft/domain` §`MODEL_TACTICS_ASK_EVERY_MS`), which is 60 a minute
 * at most; 90 is that and half again, room for a start and for an AI pacer's
 * decisions, which share this count, and a client in a loop is still stopped
 * there. **One decision
 * at a time per athlete is unchanged**, and is what bounds the model's time:
 * only the athlete holding the slot reaches the model at all (D-6.3), and a
 * second call of theirs is refused while one is out.
 */
export const DEFAULT_TACTICS_DECISIONS: RateLimit = { limit: 90, windowMs: 60 * 1000 };

/** How one bot decision ended, for its log line: a closed list. */
export type TacticsCallState = 'decision' | 'invalid' | 'failed';

/**
 * One bot decision's log line (#2836, ADR 0081 D-5.2): numbers and closed
 * words only. The model server's own figures are kept only when it sent them
 * as numbers; a server that sends none writes a line without them.
 */
export interface TacticsCallLine {
  /** `tactics-prompt.ts` §`TACTICS_PROMPT_VERSION`. */
  readonly prompt: string;
  /** The model's name, as the operator set it. */
  readonly model: string;
  readonly state: TacticsCallState;
  /** The whole call as this instance timed it, ms. */
  readonly ms: number;
  /** The model server's load time, ms: above nought when it had to load the model. */
  readonly loadMs?: number;
  /** Tokens read (the prompt) and written (the answer). */
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  /** The model server's time reading the prompt and writing the answer, ms. */
  readonly promptEvalMs?: number;
  readonly evalMs?: number;
}

/** A model server's figure: a number from 0 up, or nothing. */
const figure = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Nanoseconds, as Ollama reports a duration, in whole milliseconds. */
const milliseconds = (nanoseconds: unknown): number | undefined => {
  const read = figure(nanoseconds);
  return read === undefined ? undefined : Math.round(read / 1_000_000);
};

/**
 * What an `/api/chat` body says the call cost: Ollama's `load_duration`,
 * `prompt_eval_count`, `eval_count`, `prompt_eval_duration` and
 * `eval_duration`. Each a number or left out; nothing else of the body is read.
 */
export function tacticsCallFigures(
  body: unknown,
): Pick<TacticsCallLine, 'loadMs' | 'tokensIn' | 'tokensOut' | 'promptEvalMs' | 'evalMs'> {
  if (typeof body !== 'object' || body === null) return {};
  const said = body as Readonly<Record<string, unknown>>;
  const read = {
    loadMs: milliseconds(said.load_duration),
    tokensIn: figure(said.prompt_eval_count),
    tokensOut: figure(said.eval_count),
    promptEvalMs: milliseconds(said.prompt_eval_duration),
    evalMs: milliseconds(said.eval_duration),
  };
  return Object.fromEntries(Object.entries(read).filter(([, value]) => value !== undefined));
}

/** The local model as the settings give it to one athlete now. */
export interface TacticsLocal {
  /**
   * Whether the local model is offered to this athlete: the source on and,
   * for anybody but the operator, the switch for other riders on.
   */
  readonly offered: boolean;
  /** The local model, when one is configured: its base URL (the address a consent names) and name. */
  readonly model: { readonly baseUrl: URL; readonly model: string } | undefined;
}

/**
 * The local model the operator's settings give one athlete now (#2609):
 * offered when the local source is on and — for anybody but the operator,
 * the athlete of `OYL_INSTANCE_OWNER_KEY` (Q9) — the switch for other riders
 * is on (ADR 0071 D-5.5, D-10 R-4). The model is the settings' local model,
 * the row over `.env`, when one is configured. Nothing hosted is ever read.
 */
export function tacticsLocalOf(
  settings: EffectiveAnalysisSettings,
  operator: boolean,
): TacticsLocal {
  const model = settings.local;
  return {
    offered: settings.offerLocal && (operator || settings.othersLocal),
    model: model.kind === 'on' ? { baseUrl: model.baseUrl, model: model.model } : undefined,
  };
}

export interface TacticsOptions {
  readonly store: Pick<SqlStore, 'putTacticsConsent' | 'getTacticsConsent' | 'clearTacticsConsent'>;
  /** This instance's own origin: the instance a consent names. */
  readonly origin: string;
  /** The operator's settings for `athleteId`, read on every request (#2609). */
  readonly local: (athleteId: string) => Promise<TacticsLocal>;
  readonly hold: RaceHold;
  /** Where a name resolves to: the address rule is checked on every call. */
  readonly resolve: Resolver;
  /** The platform's `fetch` unless a test hands its own. */
  readonly fetch?: typeof globalThis.fetch;
  /** Unix milliseconds. */
  readonly now: () => number;
  /** {@link DEFAULT_TACTICS_DECISIONS} unless a test's. */
  readonly decisions?: RateLimit;
  /** {@link TACTICS_ANSWER_WAIT_MS} unless a test's. */
  readonly answerWaitMs?: number;
  /** {@link TACTICS_WARM_UP_WAIT_MS} unless a test's. */
  readonly warmUpWaitMs?: number;
  /** Where each bot decision's line goes (#2836); nowhere unless given. */
  readonly logCall?: (line: TacticsCallLine) => void;
}

/** What `GET /v1/analysis/tactics` answers. */
export interface TacticsStatus {
  /** Whether this instance offers this athlete model races now. */
  readonly offered: boolean;
  /** The instance a consent names: this one. */
  readonly instance: string;
  /** The local model address a consent would name now, or `null` when none is offered. */
  readonly modelAddress: string | null;
  /** The athlete's recorded consent, whatever address it names, or `null`. */
  readonly consent: { readonly modelAddress: string; readonly recordedAt: number } | null;
  /** Whether a model race may run now: offered, and a consent naming the address it is at. */
  readonly consented: boolean;
}

export interface Tactics {
  status(caller: Caller): Promise<TacticsStatus>;
  /** Record the caller's consent naming this instance and its local model address now. */
  recordConsent(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<TacticsStatus>>;
  /** Withdraw it, and end the caller's hold: their next tactics request is refused. */
  withdrawConsent(caller: Caller): Promise<TacticsStatus>;
  /** A model race starts: claim the slot, and load the model. */
  start(caller: Caller): Promise<Outcome<{ readonly warming: boolean }>>;
  /** One bot's decision on the ask the body carries: a reason word and a move from its menu. */
  decide(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<ModelTacticsPick>>;
  /**
   * One AI-pacer decision on the pacer state the body carries (#2712, ADR
   * 0072): the same gates, consent, slot and call as {@link decide}, one
   * model call with no tools and reasoning off, and a plan, an intent and a
   * screened line back — never a power.
   */
  pace(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
  ): Promise<
    Outcome<{ readonly plan: PacerPlan; readonly intent: PacerIntent; readonly say: string }>
  >;
  /** The caller's model race ended: their hold ends, and held write-ups start. */
  end(caller: Caller): void;
  /** Resolves once every warm-up call out now has settled. */
  idle(): Promise<void>;
  /** Abort every call out now, warm-ups included, and send none after. */
  stop(): void;
}

const refused = (fields: readonly FieldProblem[]): Outcome<never> => ({
  ok: false,
  code: 'validation_failed',
  fields,
});

/** The answer's text, from an `/api/chat` body: `message.content`, or `undefined`. */
function contentOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const message = (body as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : undefined;
}

/** `text` as a URL's origin, or `undefined`. */
function originOf(text: string): string | undefined {
  try {
    return new URL(text).origin;
  } catch {
    return undefined;
  }
}

export function createTactics(options: TacticsOptions): Tactics {
  const { store, hold, now } = options;
  const answerWaitMs = options.answerWaitMs ?? TACTICS_ANSWER_WAIT_MS;
  const warmUpWaitMs = options.warmUpWaitMs ?? TACTICS_WARM_UP_WAIT_MS;
  const decisions = createRateLimiter(options.decisions ?? DEFAULT_TACTICS_DECISIONS, now);
  /** Athletes with a decision out now: one at a time. */
  const deciding = new Set<string>();
  /** Every warm-up out now. */
  const warming = new Set<Promise<void>>();
  /** Athletes with a warm-up out now: one at a time. */
  const warmingFor = new Set<string>();
  /** Aborted by {@link Tactics.stop}: every call out now, and none after. */
  const stopping = new AbortController();
  const server = {
    resolve: options.resolve,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };

  /** The local model for `athleteId` when it is offered to them, else `undefined`. */
  async function offeredModel(athleteId: string): Promise<TacticsLocal['model']> {
    const local = await options.local(athleteId);
    return local.offered ? local.model : undefined;
  }

  async function status(athleteId: string): Promise<TacticsStatus> {
    const model = await offeredModel(athleteId);
    const consent = await store.getTacticsConsent(athleteId);
    return {
      offered: model !== undefined,
      instance: options.origin,
      modelAddress: model?.baseUrl.href ?? null,
      consent:
        consent === undefined
          ? null
          : { modelAddress: consent.modelAddress, recordedAt: consent.recordedAt },
      consented: model !== undefined && consent?.modelAddress === model.baseUrl.href,
    };
  }

  /**
   * Steps 1 and 2 of the file comment: the model this athlete may race on
   * now, or the code they are refused with. Nothing is called before it.
   */
  async function gate(
    athleteId: string,
  ): Promise<
    | { readonly ok: true; readonly model: NonNullable<TacticsLocal['model']> }
    | { readonly ok: false; readonly code: 'local_unavailable' | 'tactics_consent_required' }
  > {
    const model = await offeredModel(athleteId);
    if (model === undefined) return { ok: false, code: 'local_unavailable' };
    const consent = await store.getTacticsConsent(athleteId);
    if (consent?.modelAddress !== model.baseUrl.href) {
      return { ok: false, code: 'tactics_consent_required' };
    }
    return { ok: true, model };
  }

  /** One `/api/chat` call: the body it answered, or `undefined` for none. Never throws. */
  async function call(
    model: NonNullable<TacticsLocal['model']>,
    body: Readonly<Record<string, unknown>>,
    waitMs: number,
  ): Promise<unknown> {
    if (stopping.signal.aborted) return undefined;
    const signal = AbortSignal.any([stopping.signal, AbortSignal.timeout(Math.max(1, waitMs))]);
    try {
      return await askLocal(
        new URL(model.baseUrl.origin),
        '/api/chat',
        { method: 'POST', body },
        server,
        signal,
      );
    } catch {
      // Refused address, unreachable, out of time or stopped: no answer. Its words are dropped.
      return undefined;
    }
  }

  /** One `/api/chat` call: the answer's text, or `undefined` for none. Never throws. */
  const ask = async (
    model: NonNullable<TacticsLocal['model']>,
    body: Readonly<Record<string, unknown>>,
    waitMs: number,
  ): Promise<string | undefined> => contentOf(await call(model, body, waitMs));

  function warmUp(athleteId: string, model: NonNullable<TacticsLocal['model']>): boolean {
    if (warmingFor.has(athleteId) || stopping.signal.aborted) return false;
    warmingFor.add(athleteId);
    const call = ask(
      model,
      tacticsRequest(model.model, WARM_UP_INPUT, WARM_UP_TOKENS),
      warmUpWaitMs,
    )
      .then(() => undefined)
      .finally(() => {
        warmingFor.delete(athleteId);
        warming.delete(call);
      });
    warming.add(call);
    return true;
  }

  return {
    status: (caller) => status(caller.athleteId),

    async recordConsent(caller, body) {
      const model = await offeredModel(caller.athleteId);
      if (model === undefined) return { ok: false, code: 'local_unavailable' };
      const problems: FieldProblem[] = [];
      for (const field of Object.keys(body)) {
        if (field !== 'instance' && field !== 'modelAddress') {
          problems.push({ field, problem: 'is not a field of this request' });
        }
      }
      const { instance, modelAddress } = body;
      if (typeof instance !== 'string' || originOf(instance) !== options.origin) {
        problems.push({ field: 'instance', problem: 'must be this instance' });
      }
      if (modelAddress !== model.baseUrl.href) {
        problems.push({
          field: 'modelAddress',
          problem: 'must be the local model address this instance names now',
        });
      }
      if (problems.length > 0) return refused(problems);
      const put = await store.putTacticsConsent({
        athleteId: caller.athleteId,
        modelAddress: model.baseUrl.href,
        recordedAt: Math.floor(now() / 1000),
      });
      if (put.outcome === 'no-athlete') return { ok: false, code: 'not_found' };
      return { ok: true, value: await status(caller.athleteId) };
    },

    async withdrawConsent(caller) {
      await store.clearTacticsConsent(caller.athleteId);
      hold.end(caller.athleteId);
      return status(caller.athleteId);
    },

    async start(caller) {
      const gated = await gate(caller.athleteId);
      if (!gated.ok) return gated;
      // A start reaches the model too (its warm-up), so it counts as a decision does.
      if (!decisions.allow(caller.athleteId)) return { ok: false, code: 'rate_limited' };
      if (hold.claim(caller.athleteId) === 'busy') return { ok: false, code: 'tactics_busy' };
      return { ok: true, value: { warming: warmUp(caller.athleteId, gated.model) } };
    },

    async decide(caller, body) {
      const gated = await gate(caller.athleteId);
      if (!gated.ok) return gated;
      for (const key of Object.keys(body)) {
        if (key !== 'input')
          return refused([{ field: key, problem: 'is not a field of this request' }]);
      }
      const input = readModelTacticsInput(body.input);
      if (!input.ok) return refused([input.problem]);
      if (deciding.has(caller.athleteId) || !decisions.allow(caller.athleteId)) {
        return { ok: false, code: 'rate_limited' };
      }
      if (hold.claim(caller.athleteId) === 'busy') return { ok: false, code: 'tactics_busy' };
      deciding.add(caller.athleteId);
      const askedAt = now();
      let answered: unknown;
      try {
        answered = await call(
          gated.model,
          tacticsRequest(gated.model.model, input.value),
          answerWaitMs,
        );
      } finally {
        deciding.delete(caller.athleteId);
        // An answer is the race's activity too: one that waited behind a write-up keeps its hold.
        hold.touch(caller.athleteId);
      }
      const text = contentOf(answered);
      // Read against the menu this ask offered, and no other move.
      const read =
        text === undefined ? undefined : readModelTacticsAnswer(text, input.value.you.menu);
      // #2836: one line a call. Figures and closed words; never the text, never the pick.
      options.logCall?.({
        prompt: TACTICS_PROMPT_VERSION,
        model: gated.model.model,
        state: read === undefined ? 'failed' : read.ok ? 'decision' : 'invalid',
        ms: Math.max(0, now() - askedAt),
        ...tacticsCallFigures(answered),
      });
      if (read === undefined) return { ok: false, code: 'tactics_failed' };
      return read.ok ? { ok: true, value: read.pick } : { ok: false, code: 'tactics_invalid' };
    },

    async pace(caller, body) {
      const gated = await gate(caller.athleteId);
      if (!gated.ok) return gated;
      for (const key of Object.keys(body)) {
        if (key !== 'input')
          return refused([{ field: key, problem: 'is not a field of this request' }]);
      }
      const input = readModelPacerInput(body.input);
      if (!input.ok) return refused([input.problem]);
      if (deciding.has(caller.athleteId) || !decisions.allow(caller.athleteId)) {
        return { ok: false, code: 'rate_limited' };
      }
      if (hold.claim(caller.athleteId) === 'busy') return { ok: false, code: 'tactics_busy' };
      deciding.add(caller.athleteId);
      let text: string | undefined;
      try {
        text = await ask(gated.model, pacerRequest(gated.model.model, input.value), answerWaitMs);
      } finally {
        deciding.delete(caller.athleteId);
        hold.touch(caller.athleteId);
      }
      if (text === undefined) return { ok: false, code: 'tactics_failed' };
      // Read field by field, and the line screened, before anything goes back (ADR 0072 D-3, D-4).
      const read = readModelPacerAnswer(text);
      return read.ok
        ? { ok: true, value: { ...read.direction, say: read.say } }
        : { ok: false, code: 'tactics_invalid' };
    },

    end(caller) {
      hold.end(caller.athleteId);
    },

    async idle() {
      while (warming.size > 0) await Promise.all([...warming]);
    },

    stop() {
      stopping.abort();
      hold.stop();
    },
  };
}
