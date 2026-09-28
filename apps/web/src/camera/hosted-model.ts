// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A hosted model on the rider's own key — the address, the model name and
 * the key they typed, and the words they read before any of it is used**
 * ([#518](https://github.com/openzigs/onyourleft/issues/518)).
 *
 * The owner's ruling, recorded in ADR 0029's 2026-09-28 amendment: *"a hosted
 * model on the rider's own key, with NUMBERS ONLY and never a picture"*, off by
 * default, separately consented, and not enabled by consenting to local
 * analysis. This file is the configuration half; `hosted-transport.ts` is the
 * request, and `session.ts` §`CameraController.askHostedModel` is where the
 * consent is checked before either is reached.
 *
 * ## A second endpoint, not a widening of the first
 *
 * `analysis-endpoint.ts` refuses every address off the rider's own network,
 * and it still does: that rule is what keeps a PICTURE on the rider's own
 * network, and this path is never sent one. So the hosted service is a
 * separate address, under a separate storage key, validated by
 * {@link hostedModelDecision} and nothing else — a hosted address typed into
 * the rider's-computer box is refused exactly as it was before #518.
 *
 * ## The key
 *
 * The rider's own, typed by them. It lives in this device's `localStorage`
 * under {@link HOSTED_MODEL_STORAGE_KEY} and in exactly three places in
 * memory: the row {@link readHostedModel} returns, the port
 * `hosted-transport.ts` builds from it, and the one `Authorization` header that
 * port writes. It is never put in a refusal, a failure, a log line or an
 * export, and nothing under `packages/store` can see it:
 *
 * - every refusal and failure sentence is a fixed table and none repeats what
 *   was typed — `hosted-model.test.ts` and `hosted-transport.test.ts` hold both
 *   with a key that would be easy to spot;
 * - `hosted-key.test.ts` scans the tree: the storage key is named in this file
 *   alone, `packages/store` names nothing hosted, and the account export run
 *   over a device holding a key does not contain it;
 * - an erase forgets it — {@link hostedModelEraser}.
 *
 * ⚠️ **`localStorage` is plaintext on the device.** That is ADR 0029 D-7's
 * *"stored on the device"*, and it is the same place the browser keeps every
 * other site's tokens. What the owner's *"in plaintext"* rules out is the key
 * reaching somewhere it was not put — a file, a store row, a message — and that
 * is what the tests above are about.
 *
 * ## No vendor
 *
 * ADR 0031 D-4's conditions 2 and 3: nothing here names, suggests or
 * pre-fills a service, the boxes start empty, and the request is the
 * OpenAI-compatible shape #387 already sends to a local model server. The
 * address is any `https:` origin, because a key must not cross a network in
 * the clear; there is no list of acceptable ones, and nothing here knows what
 * a valid key looks like beyond "printable and not absurdly long".
 */

import { COMPLETIONS_PATH, MAXIMUM_MODEL_NAME_LENGTH } from './analysis-endpoint';

/**
 * The consent screen's words, verbatim from ADR 0029's 2026-09-28 amendment.
 *
 * ⚠️ **Do not improve this.** `hosted-model.test.ts` reads the ADR and
 * compares, the way `consent.test.ts` pins D-5. D-7's own quoted wording is
 * about a photograph, and the owner ruled the hosted path is never sent one,
 * so these are the words that amendment ruled on for the path that was built.
 */
export const HOSTED_CONSENT: {
  readonly headline: string;
  readonly paragraphs: readonly string[];
  readonly notNeeded: string;
  readonly offUntilOn: string;
} = {
  headline: 'This sends questions to a service you have chosen, using your own key.',
  paragraphs: [
    'If you turn this on, each time you press the button below a question written into this app is ' +
      'sent to the address you entered, using the key you entered. That is a company or a computer ' +
      'that is not yours and not ours, and we cannot see what they do with it or how long they keep ' +
      'it. We cannot delete it for you afterwards. Like any service you connect to, it also sees ' +
      'your internet address.',
    'It is never sent a picture — not a photograph of you, and nothing made from one. Today it is ' +
      'sent only a test question, with no numbers from your rides. It is not sent your name, your ' +
      'rides, or where you were.',
    'Your key is kept on this device, is sent only to the address you entered, and is never put in ' +
      'a file this app exports.',
  ],
  notNeeded: 'You do not need this. Everything else in the app works without it.',
  offUntilOn:
    'This is off. It stays off until you turn it on, it is off again whenever the app is opened, ' +
    'and you can turn it off at any time.',
};

/** Where the rider's answer is kept: this device's `localStorage`, and nothing else. */
export type HostedModelStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This device's storage, or `undefined` where the browser refuses it. */
export function deviceHostedModelStorage(): HostedModelStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The one key this lives under.
 *
 * ⚠️ Named in this file and nowhere else in the tree — `hosted-key.test.ts`
 * fails otherwise, because a second module that could read this row is a
 * second module that could put the key somewhere.
 */
export const HOSTED_MODEL_STORAGE_KEY = 'oyl.hosted-model.v1';

/** The longest key accepted. Keys are tens to a few hundred characters. */
export const MAXIMUM_KEY_LENGTH = 512;

/** The rider's configured service. */
export interface HostedModel {
  /** The origin only — scheme, host and port. Always `https:`. */
  readonly address: string;
  /** The model name the rider typed. No default exists. */
  readonly model: string;
  /** The rider's own key. Never shown back, never logged, never exported. */
  readonly key: string;
}

/** Why an address, a model name or a key was refused. */
export type HostedModelRefusal =
  | 'no-address'
  | 'not-an-address'
  | 'not-https'
  | 'has-credentials'
  | 'has-query'
  | 'unexpected-path'
  | 'no-model'
  | 'model-too-long'
  | 'no-key'
  | 'key-too-long'
  | 'key-not-printable';

/**
 * One sentence per refusal.
 *
 * ⚠️ **None of them repeats what was typed**, and the three about the key
 * least of all: a refusal is rendered in a live region, which a screen reader
 * reads aloud in a room.
 */
export const HOSTED_MODEL_REFUSAL_TEXT: Readonly<Record<HostedModelRefusal, string>> = {
  'no-address': 'Enter the address of the service, starting with https://.',
  'not-an-address': 'That is not an address. It should start with https://.',
  'not-https':
    'The address has to start with https://, so that your key is not sent across the internet unencrypted.',
  'has-credentials':
    'The address has a name or password in it. Put your key in the key box instead.',
  'has-query': 'The address has a ? or # part. Enter only the service’s address.',
  'unexpected-path': 'Enter only the service’s address, without a path after it (/v1 is fine).',
  'no-model': 'Enter the name of the model the service should use. There is no default.',
  'model-too-long': 'That model name is too long.',
  'no-key': 'Enter your key for the service. This app has none of its own.',
  'key-too-long': 'That key is too long to be a key.',
  'key-not-printable':
    'That key has a space or a character a key cannot have in it. Paste it again without the spaces.',
};

/** What the rider typed. */
export interface HostedModelAnswers {
  readonly address: string;
  readonly model: string;
  readonly key: string;
}

/** The result of reading what the rider typed. */
export interface HostedModelDecision {
  readonly model: HostedModel | undefined;
  readonly refusal: HostedModelRefusal | undefined;
}

function refuse(refusal: HostedModelRefusal): HostedModelDecision {
  return { model: undefined, refusal };
}

/** The paths a rider might paste after the host, all meaning "this service". */
const ACCEPTED_PATHS: ReadonlySet<string> = new Set(['', '/v1', COMPLETIONS_PATH]);

/**
 * Visible ASCII and nothing else. A key is sent in a header, so a line break
 * would be a header of the rider's inventing and a space is a paste gone wrong.
 */
const PRINTABLE = /^[\x21-\x7e]+$/;

/**
 * Whether what the rider typed is a service this client may send to.
 *
 * The only constructor of a {@link HostedModel}, and {@link readHostedModel}
 * runs every stored row back through it — so a hand-edited row naming an
 * `http:` address is refused exactly as a typed one is.
 */
export function hostedModelDecision(answers: HostedModelAnswers): HostedModelDecision {
  const typed = answers.address.trim();
  if (typed === '') {
    return refuse('no-address');
  }
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return refuse('not-an-address');
  }
  if (url.protocol !== 'https:') {
    return refuse('not-https');
  }
  if (url.username !== '' || url.password !== '') {
    return refuse('has-credentials');
  }
  if (url.search !== '' || url.hash !== '' || typed.includes('?') || typed.includes('#')) {
    return refuse('has-query');
  }
  if (!ACCEPTED_PATHS.has(url.pathname.replace(/\/+$/, ''))) {
    return refuse('unexpected-path');
  }
  const model = answers.model.trim();
  if (model === '') {
    return refuse('no-model');
  }
  if (model.length > MAXIMUM_MODEL_NAME_LENGTH) {
    return refuse('model-too-long');
  }
  const key = answers.key.trim();
  if (key === '') {
    return refuse('no-key');
  }
  if (key.length > MAXIMUM_KEY_LENGTH) {
    return refuse('key-too-long');
  }
  if (!PRINTABLE.test(key)) {
    return refuse('key-not-printable');
  }
  return { model: { address: url.origin, model, key }, refusal: undefined };
}

/** The URL a request goes to. */
export function hostedCompletionsUrl(model: HostedModel): string {
  return `${model.address}${COMPLETIONS_PATH}`;
}

/**
 * The rider's configured service, or `undefined` — which is what an empty
 * device answers, what a malformed row answers, and what a row that is no
 * longer accepted answers.
 */
export function readHostedModel(
  storage: HostedModelStorage | undefined = deviceHostedModelStorage(),
): HostedModel | undefined {
  let raw: unknown;
  try {
    const text = storage?.getItem(HOSTED_MODEL_STORAGE_KEY) ?? null;
    raw = text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const { address, model, key } = raw as Record<string, unknown>;
  if (typeof address !== 'string' || typeof model !== 'string' || typeof key !== 'string') {
    return undefined;
  }
  return hostedModelDecision({ address, model, key }).model;
}

/** Stores the rider's service. `false` when this device would not keep it. */
export function writeHostedModel(
  model: HostedModel,
  storage: HostedModelStorage | undefined = deviceHostedModelStorage(),
): boolean {
  if (storage === undefined) {
    return false;
  }
  try {
    storage.setItem(
      HOSTED_MODEL_STORAGE_KEY,
      JSON.stringify({ address: model.address, model: model.model, key: model.key }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Forgets the rider's service and its key. Nothing is sent to it afterwards. */
export function forgetHostedModel(
  storage: HostedModelStorage | undefined = deviceHostedModelStorage(),
): void {
  try {
    storage?.removeItem(HOSTED_MODEL_STORAGE_KEY);
  } catch {
    // A device that will not forget cannot be made to.
  }
}

/**
 * What an erase calls to forget the key — `transfer/erase-device.ts`
 * §`eraseDevice`. The key is not a store row, so `deleteAthlete` cannot see it,
 * and an erase that said "this device now holds nothing" while a key to the
 * rider's paid account sat in `localStorage` would be a false sentence.
 */
export function hostedModelEraser(
  storage: HostedModelStorage | undefined = deviceHostedModelStorage(),
): { forget(): void } {
  return {
    forget: () => {
      forgetHostedModel(storage);
    },
  };
}
