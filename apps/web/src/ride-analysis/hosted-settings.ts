// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A rider's own hosted model key and hosted consent, on their instance** —
 * [#1251](https://github.com/openzigs/onyourleft/issues/1251), the app half of
 * #1199.
 *
 * Every call goes through the sealed session the Connect screen keeps
 * (`instance-port.ts` §`heldSealedSession`, ADR 0047 D-7, D-13): the routes
 * are sealed-only on the instance, and there is no plaintext call here to fall
 * back to. With no sealed session nothing is sent and the session's own
 * sentence is shown. The call that carries the key says `pastedKey`, so it is
 * padded to 1 KiB (ADR 0046 D-9) and its length says nothing about the key's.
 *
 * ## The key is not kept here
 *
 * It is read from {@link HostedKeyAnswers}, put in one sealed request, and
 * dropped: no storage, no log, no sentence. The instance's answer never
 * carries it, and an answer that is not the settings' shape is refused whole.
 *
 * ## What this device remembers: only whether hosted may be OFFERED
 *
 * {@link HOSTED_OFFER_STORAGE_KEY} holds the instance's address and the
 * service's origin, and only while the instance last said it holds BOTH a key
 * and a consent naming that key's origin (#1251's third criterion). A ride's
 * page reads it ({@link readHostedOffer}) to decide whether to draw the
 * hosted press, because opening a ride's page sends nothing (ADR 0035 D-8).
 * It is a hint and never a permission: the instance checks the key, the
 * consent and the masking list again for every job, and a job it will not run
 * ends `hosted_unavailable`. It is forgotten with the sign-in
 * (`instance-port.ts` §`INSTANCE_AGREEMENT_STORAGE_KEYS`).
 *
 * ## The masking list goes with the consent, and with every hosted job
 *
 * The instance masks what it sends a service with ITS copy of the rider's
 * word list and privacy zones (`apps/instance` §`analysis/hosted.ts`), one
 * sync item of kind `masking`. {@link sendMaskingGuard} writes it — before a
 * consent is recorded, and again before every hosted job
 * (`instance-analysis.ts`), so a word the rider added a minute ago is masked.
 * ⚠️ It carries coordinates (the zones' centres): it travels sealed only, and
 * no failure here says a value.
 */

import type { MaskingGuard } from '@onyourleft/analysis';

import { INSTANCE_AGREEMENT_STORAGE_KEYS, type HeldSealedSession } from '../instance/instance-port';
import { InstanceUnreachableError, type SealedCallOptions } from '../instance/instance-transport';
import {
  HOSTED_ANSWER_REFUSAL_TEXT,
  HOSTED_CHANGE_UNKNOWN,
  HOSTED_MASKING_NOT_SENT,
  HOSTED_NOT_ACCEPTED,
  HOSTED_NOT_OFFERED,
  HOSTED_TEST_UNREADABLE,
  HOSTED_UNREADABLE,
  type HostedAnswerRefusal,
  type HostedTestResult,
} from './hosted-consent';
import type {
  HostedKeyAnswers,
  HostedSettings,
  HostedSettingsOutcome,
  HostedSettingsPort,
  HostedTestOutcome,
} from './hosted-settings-port';

/** The instance's routes for a rider's hosted key, consent and test question (#1199, #1251). */
export const HOSTED_SETTINGS_PATH = '/v1/analysis/hosted';
export const HOSTED_KEY_PATH = '/v1/analysis/hosted/key';
export const HOSTED_CONSENT_PATH = '/v1/analysis/hosted/consent';
export const HOSTED_TEST_PATH = '/v1/analysis/hosted/test';

/** The one `masking` item an athlete holds (`apps/instance` §`hosted.ts` §`MASKING_ITEM_KEY`). */
export const MASKING_ITEM_PATH = '/v1/sync/items/masking/guard';

/**
 * How long the app waits for the test question: the instance gives the
 * service 30 s (`apps/instance` §`hosted-test.ts`), so this is that and room
 * for the trip, inside the longest a sealed call may ask for.
 */
export const HOSTED_TEST_WAIT_MILLISECONDS = 45_000;

/** The most a rider may say a model spends reasoning (`apps/instance` §`model-turn.ts`). */
export const MAXIMUM_REASONING_TOKENS = 16_384;

/**
 * Where the offer is noted. @see the file comment. Named in `instance-port.ts`
 * because it holds an instance's address, which that module's eraser forgets
 * with the sign-in.
 */
export const HOSTED_OFFER_STORAGE_KEY = INSTANCE_AGREEMENT_STORAGE_KEYS[2];

export type HostedOfferStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The `https:` origin and host of `url`, or `undefined` for anything else. */
function httpsOrigin(url: unknown): { readonly origin: string; readonly host: string } | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
      ? { origin: parsed.origin, host: parsed.host }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The service a hosted write-up may be offered for on `instanceOrigin`, or
 * `undefined`: nothing noted, a note for another instance, or one that does
 * not parse. Reads storage; sends nothing.
 */
export function readHostedOffer(
  storage: HostedOfferStorage | undefined,
  instanceOrigin: string | undefined,
): string | undefined {
  if (storage === undefined || instanceOrigin === undefined) return undefined;
  try {
    const noted = JSON.parse(storage.getItem(HOSTED_OFFER_STORAGE_KEY) ?? 'null') as {
      instance?: unknown;
      endpoint?: unknown;
    } | null;
    if (noted === null || typeof noted !== 'object') return undefined;
    if (noted.instance !== instanceOrigin || typeof noted.endpoint !== 'string') return undefined;
    return httpsOrigin(noted.endpoint)?.origin === noted.endpoint ? noted.endpoint : undefined;
  } catch {
    return undefined;
  }
}

/** Note what `settings` allows offering on `instanceOrigin`, or forget the note. */
function noteHostedOffer(
  storage: HostedOfferStorage | undefined,
  instanceOrigin: string,
  settings: HostedSettings,
): void {
  if (storage === undefined) return;
  try {
    const endpoint =
      settings.key !== null && settings.consent?.origin === settings.key.origin
        ? settings.key.origin
        : undefined;
    if (endpoint === undefined) storage.removeItem(HOSTED_OFFER_STORAGE_KEY);
    else {
      storage.setItem(
        HOSTED_OFFER_STORAGE_KEY,
        JSON.stringify({ instance: instanceOrigin, endpoint }),
      );
    }
  } catch {
    // Storage refused: hosted is not offered, which sends nothing.
  }
}

/**
 * The instance's answer as settings, or `undefined` when ANY part of it is not
 * what `GET /v1/analysis/hosted` says. An instance is untrusted input: a name
 * shown in a consent must be one a ride could really be sent to.
 */
export function hostedSettingsFrom(body: unknown): HostedSettings | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const { key, consent } = body as { key?: unknown; consent?: unknown };
  if (key === undefined || consent === undefined) return undefined;
  let heldKey: HostedSettings['key'] = null;
  if (key !== null) {
    if (typeof key !== 'object') return undefined;
    const row = key as Record<string, unknown>;
    const service = httpsOrigin(row.url);
    const reasoning = row.reasoningTokens ?? null;
    if (
      service === undefined ||
      typeof row.model !== 'string' ||
      (row.setBy !== 'app' && row.setBy !== 'operator-command') ||
      (reasoning !== null && (typeof reasoning !== 'number' || !Number.isInteger(reasoning)))
    ) {
      return undefined;
    }
    heldKey = { ...service, model: row.model, reasoningTokens: reasoning, setBy: row.setBy };
  }
  let heldConsent: HostedSettings['consent'] = null;
  if (consent !== null) {
    if (typeof consent !== 'object') return undefined;
    const origin = (consent as Record<string, unknown>).origin;
    // The instance keeps a consent as an origin: anything else is not one.
    if (typeof origin !== 'string' || httpsOrigin(origin)?.origin !== origin) return undefined;
    heldConsent = { origin };
  }
  return { key: heldKey, consent: heldConsent };
}

/** Visible ASCII and nothing else: a key is sent in a header, and a space is a paste gone wrong. */
const PRINTABLE = /^[\x21-\x7e]+$/;

/** What a key request carries, or why what was typed is not sent. */
export function hostedKeyRequest(
  answers: HostedKeyAnswers,
):
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly refusal: HostedAnswerRefusal } {
  const refuse = (refusal: HostedAnswerRefusal) => ({ ok: false, refusal }) as const;
  const address = answers.address.trim();
  if (address === '') return refuse('no-address');
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return refuse('no-address');
  }
  if (url.protocol !== 'https:') return refuse('not-https');
  if (url.username !== '' || url.password !== '') return refuse('has-credentials');
  const model = answers.model.trim();
  if (model === '') return refuse('no-model');
  if (!PRINTABLE.test(model)) return refuse('model-has-spaces');
  const key = answers.key.trim();
  if (key === '') return refuse('no-key');
  if (!PRINTABLE.test(key)) return refuse('key-not-printable');
  const typed = answers.reasoningTokens.trim();
  let reasoningTokens: number | undefined;
  if (typed !== '') {
    reasoningTokens = /^\d{1,5}$/.test(typed) ? Number(typed) : Number.NaN;
    if (!(reasoningTokens >= 1 && reasoningTokens <= MAXIMUM_REASONING_TOKENS)) {
      return refuse('reasoning-not-a-count');
    }
  }
  return {
    ok: true,
    body: {
      url: url.href,
      model,
      key,
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    },
  };
}

/** What the masking item is sent through: the sealed instance of a held session, in production. */
export interface MaskingChannel {
  call(
    method: 'POST',
    path: string,
    options: SealedCallOptions,
  ): Promise<{ readonly status: number }>;
}

/**
 * Give the instance the rider's masking guard, as its one `masking` item.
 * `true` only when the instance said it holds it. Never throws: a guard that
 * cannot be read here, or a call that fails, is `false`, and the caller sends
 * a service nothing.
 */
export async function sendMaskingGuard(
  sealed: MaskingChannel,
  token: string,
  guard: () => Promise<MaskingGuard>,
): Promise<boolean> {
  try {
    const { words, zones } = await guard();
    const item = {
      words,
      zones: zones.map((zone) => ({
        label: zone.label,
        latitude: zone.centre.latitude,
        longitude: zone.centre.longitude,
        radius: zone.radius,
      })),
    };
    const answer = await sealed.call('POST', MASKING_ITEM_PATH, {
      token,
      body: { body: JSON.stringify(item) },
    });
    return answer.status === 200;
  } catch {
    return false;
  }
}

export interface HostedSettingsPortOptions {
  /** The sealed session this device holds, or why there is none (`heldSealedSession`). */
  readonly session: () => Promise<HeldSealedSession>;
  /** Where the offer is noted; `undefined` where the browser refuses storage. */
  readonly storage: HostedOfferStorage | undefined;
  /** The rider's masking guard, read from this device's store. Rejects when it cannot be read. */
  readonly guard: () => Promise<MaskingGuard>;
}

const TEST_RESULTS: readonly HostedTestResult[] = [
  'answered',
  'no-answer',
  'not-ready',
  'refused',
  'unreachable',
  'timed-out',
  'failed',
];

type OpenSession = Extract<HeldSealedSession, { readonly kind: 'open' }>;
interface Failed {
  readonly kind: 'failed';
  readonly text: string;
}

/** The production {@link HostedSettingsPort}: `main.tsx` builds it, and nothing else. */
export function createHostedSettingsPort(options: HostedSettingsPortOptions): HostedSettingsPort {
  const failed = (text: string): Failed => ({ kind: 'failed', text });

  /** The open session, or the sentence that says why there is none. */
  async function open(): Promise<OpenSession | Failed> {
    let held: HeldSealedSession;
    try {
      held = await options.session();
    } catch {
      return failed(HOSTED_UNREADABLE);
    }
    return held.kind === 'open' ? held : failed(held.text);
  }

  /** One sealed call whose answer is the settings; the offer is noted from it. */
  async function settingsCall(
    held: OpenSession,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    extra: Omit<SealedCallOptions, 'token'> = {},
  ): Promise<HostedSettingsOutcome> {
    // #1796: a change whose answer was lost may have been made — a call that
    // timed out after it left, an answer that cannot be read — so it is never
    // said to have changed nothing. A read changed nothing whatever happened.
    const unreadable = method === 'GET' ? HOSTED_UNREADABLE : HOSTED_CHANGE_UNKNOWN;
    let answer: { readonly status: number; readonly body: unknown };
    try {
      answer = await held.sealed.call(method, path, { token: held.token, ...extra });
    } catch (error) {
      if (!(error instanceof InstanceUnreachableError)) throw error;
      return failed(unreadable);
    }
    if (answer.status === 404 || answer.status === 503) return failed(HOSTED_NOT_OFFERED);
    if (answer.status === 400) return failed(HOSTED_NOT_ACCEPTED);
    const settings = answer.status === 200 ? hostedSettingsFrom(answer.body) : undefined;
    if (settings === undefined) return failed(unreadable);
    noteHostedOffer(options.storage, held.account.origin, settings);
    return { kind: 'held', settings };
  }

  return {
    async readHostedSettings() {
      const held = await open();
      if (held.kind === 'failed') return held;
      return settingsCall(held, 'GET', HOSTED_SETTINGS_PATH);
    },

    async storeHostedKey(answers) {
      const request = hostedKeyRequest(answers);
      if (!request.ok) return failed(HOSTED_ANSWER_REFUSAL_TEXT[request.refusal]);
      const held = await open();
      if (held.kind === 'failed') return held;
      return settingsCall(held, 'POST', HOSTED_KEY_PATH, { body: request.body, pastedKey: true });
    },

    async removeHostedKey() {
      const held = await open();
      if (held.kind === 'failed') return held;
      return settingsCall(held, 'DELETE', HOSTED_KEY_PATH);
    },

    async agreeToHostedService(endpoint) {
      const held = await open();
      if (held.kind === 'failed') return held;
      // The masking list first: no agreement is recorded that the instance could not mask for.
      if (!(await sendMaskingGuard(held.sealed, held.token, options.guard))) {
        return failed(HOSTED_MASKING_NOT_SENT);
      }
      return settingsCall(held, 'POST', HOSTED_CONSENT_PATH, { body: { endpoint } });
    },

    async withdrawHostedAgreement() {
      const held = await open();
      if (held.kind === 'failed') return held;
      return settingsCall(held, 'DELETE', HOSTED_CONSENT_PATH);
    },

    async sendHostedTestQuestion(): Promise<HostedTestOutcome> {
      const held = await open();
      if (held.kind === 'failed') return held;
      let answer: { readonly status: number; readonly body: unknown };
      try {
        answer = await held.sealed.call('POST', HOSTED_TEST_PATH, {
          token: held.token,
          timeoutMilliseconds: HOSTED_TEST_WAIT_MILLISECONDS,
        });
      } catch (error) {
        if (!(error instanceof InstanceUnreachableError)) throw error;
        return failed(HOSTED_TEST_UNREADABLE);
      }
      const body = answer.body as { result?: unknown; reasoned?: unknown } | null;
      const result = TEST_RESULTS.find((each) => each === body?.result);
      if (answer.status !== 200 || result === undefined) return failed(HOSTED_TEST_UNREADABLE);
      return { kind: 'tested', result, reasoned: body?.reasoned === true };
    },
  };
}
