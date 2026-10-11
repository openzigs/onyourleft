// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's one hosted model key** — #1097, ADR 0046 D-9.
 *
 * The owner's ruling 5 on #1092 *"REPLACES ruling 3's 'single-rider only'"*:
 * *"The instance also hosts group rides and races, so it will have other
 * riders' accounts."* So holding a key never stops another rider registering.
 * The same ruling keeps how a key is held: *"Every key is encrypted at rest,
 * never logged, and never in a backup in clear."*
 *
 * ## Encrypted at rest
 *
 * AES-256-GCM through WebCrypto (`crypto.subtle`, which the core may name:
 * ADR 0037 D-2). The key-encryption key is the operator's secret,
 * `OYL_INSTANCE_SECRET_KEY` — 32 bytes, base64 — imported non-extractable.
 * Every seal draws a FRESH 12-byte nonce, and the store keeps the nonce and
 * the ciphertext (`store/migrations/0014-hosted-model-key.ts`); the plaintext
 * is never a column, so `operator backup`'s `VACUUM INTO` copies ciphertext
 * and nothing else.
 *
 * ⚠️ **The athlete, the URL and the model are the cipher's additional
 * data.** They are stored in clear beside the ciphertext — `model-key status`
 * prints the URL and the model — so somebody able to write the database could
 * otherwise point the held key at a host of their choosing, or at another
 * athlete. Bound in here, an edited row makes the key unreadable rather than
 * sent somewhere new or used for somebody else.
 *
 * ## A key that cannot be read is a state, never a crash
 *
 * A restore onto a box with a different secret, or no secret at all, leaves a
 * row this instance cannot open. {@link hostedKeyState} says so —
 * `unreadable` or `no-secret` — and the instance logs
 * {@link HOSTED_KEY_UNREADABLE} and carries on with its local model, or none.
 *
 * ## Whose analysis it serves: the operator's own, and nobody else's
 *
 * The key is held FOR the operator — ADR 0046's Q9 ruling, *"the athlete
 * whose device holds `OYL_INSTANCE_OWNER_KEY`, the key that already makes
 * them moderator"* — and `operator model-key set` looks that athlete up. The
 * owner's ruling of 2026-10-09 withdrew D-9's Share mode (*"Operator key is
 * not shared with riders. If it is hosted they need to bring their own
 * key"*), so it serves the operator's own jobs only, as their own key
 * ({@link ownHostedKeyState}); every other rider brings theirs (#1199,
 * `hosted-settings.ts`), sealed the same way. Every hosted job also needs the
 * athlete's own consent naming the origin (Q10, `source.ts`). The key stays
 * with the athlete it was set for: changing `OYL_INSTANCE_OWNER_KEY` does
 * not move it — the operator clears it and sets it again.
 */

import type { HeldHostedModelKey, SqlStore } from '../store/sql-store.ts';

/** How long the operator's secret is: AES-256. */
export const SECRET_KEY_BYTES = 32;

/** GCM's nonce: 96 bits, as NIST SP 800-38D recommends. */
const IV_BYTES = 12;

/** The longest key accepted. A provider's key is a few hundred characters at most. */
export const MAXIMUM_HOSTED_KEY_LENGTH = 1024;

/** What the instance logs when a held key will not open with its secret. */
export const HOSTED_KEY_UNREADABLE = 'the hosted key cannot be read with this secret';

/** What the instance logs when a key is held and `OYL_INSTANCE_SECRET_KEY` is not set. */
export const HOSTED_KEY_NO_SECRET = 'a hosted key is held and no secret is set to read it';

/** What the cipher binds beside the key: the format, and where the key may go. */
const ADDITIONAL_DATA_PREFIX = 'oyl-hosted-model-key-v1';

/** The operator's secret, as the environment gave it. */
export type SecretKeyText =
  | { readonly kind: 'unset' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'ok'; readonly bytes: Uint8Array };

/** The sentence an operator reads for a secret that is not 32 bytes of base64. */
export const SECRET_KEY_MALFORMED =
  'OYL_INSTANCE_SECRET_KEY must be 32 bytes, base64: `openssl rand -base64 32` makes one.';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** `OYL_INSTANCE_SECRET_KEY`: unset, malformed, or its 32 bytes. Never echoes it. */
export function readSecretKey(text: string | undefined): SecretKeyText {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') return { kind: 'unset' };
  if (trimmed.length % 4 !== 0 || !BASE64.test(trimmed)) return { kind: 'malformed' };
  const binary = atob(trimmed);
  if (binary.length !== SECRET_KEY_BYTES) return { kind: 'malformed' };
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { kind: 'ok', bytes };
}

/** WebCrypto's key type, named without a DOM library or Node's own types. */
export type SecretKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** The secret as a non-extractable AES-GCM key. */
export function importSecretKey(bytes: Uint8Array): Promise<SecretKey> {
  return crypto.subtle.importKey('raw', bytes.slice(), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * The hosted service's base URL, or why it is refused. **`https:` only**, and
 * — unlike the local model's — NOT held to the local-address rule: it is
 * hosted by definition. No credentials in it, and no fragment.
 */
export function hostedUrlFrom(
  text: string,
): { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly problem: string } {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, problem: '--url is not a URL.' };
  }
  if (url.protocol !== 'https:') return { ok: false, problem: '--url must be https:.' };
  if (url.username !== '' || url.password !== '') {
    return { ok: false, problem: '--url must not carry a user name or a password.' };
  }
  if (url.hash !== '' || url.search !== '') {
    return { ok: false, problem: '--url must not carry a query or a fragment.' };
  }
  return { ok: true, url };
}

/**
 * The key as typed on standard input, or `undefined` when it is not one: one
 * line, with its line ending taken off, no other whitespace or control
 * character, and not longer than {@link MAXIMUM_HOSTED_KEY_LENGTH}.
 */
export function hostedKeyFrom(input: string): string | undefined {
  const key = input.replace(/\r?\n$/, '');
  if (key === '' || key.length > MAXIMUM_HOSTED_KEY_LENGTH) return undefined;
  // Printable ASCII and nothing else: no space, no control character.
  if (!/^[\x21-\x7e]+$/.test(key)) return undefined;
  return key;
}

function additionalData(athleteId: string, url: string, model: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${ADDITIONAL_DATA_PREFIX}\0${athleteId}\0${url}\0${model}`);
}

/** Seal a key held for `athleteId`, for `url` and `model`, under a fresh nonce. */
export async function sealHostedKey(
  secret: SecretKey,
  held: {
    readonly athleteId: string;
    readonly url: string;
    readonly model: string;
    readonly key: string;
  },
): Promise<{ readonly iv: Uint8Array; readonly ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(held.athleteId, held.url, held.model) },
    secret,
    new TextEncoder().encode(held.key),
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/** The key a sealed row holds, or `undefined` when this secret cannot open it. */
export async function openHostedKey(
  secret: SecretKey,
  sealed: Pick<HeldHostedModelKey, 'athleteId' | 'url' | 'model' | 'iv' | 'ciphertext'>,
): Promise<string | undefined> {
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: sealed.iv.slice(),
        additionalData: additionalData(sealed.athleteId, sealed.url, sealed.model),
      },
      secret,
      sealed.ciphertext.slice(),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    return undefined;
  }
}

/** What the instance can do with its hosted key. Only `held` carries the key. */
export type HostedKeyState =
  | { readonly kind: 'none' }
  /** A key is held and there is no secret to open it with. */
  | { readonly kind: 'no-secret'; readonly url: string; readonly model: string }
  /** A key is held and this secret does not open it: {@link HOSTED_KEY_UNREADABLE}. */
  | { readonly kind: 'unreadable'; readonly url: string; readonly model: string }
  | {
      readonly kind: 'held';
      readonly url: string;
      readonly model: string;
      readonly athleteId: string;
      readonly key: string;
    };

/** The held key, opened with `secret` if it can be. Never throws for a key it cannot read. */
export async function hostedKeyState(
  store: Pick<SqlStore, 'getHostedModelKey'>,
  secret: SecretKey | undefined,
): Promise<HostedKeyState> {
  return opened(await store.getHostedModelKey(), secret);
}

/** A sealed row, opened with `secret` if it can be. */
async function opened(
  held: HeldHostedModelKey | undefined,
  secret: SecretKey | undefined,
): Promise<HostedKeyState> {
  if (held === undefined) return { kind: 'none' };
  if (secret === undefined) return { kind: 'no-secret', url: held.url, model: held.model };
  const key = await openHostedKey(secret, held);
  if (key === undefined) return { kind: 'unreadable', url: held.url, model: held.model };
  return { kind: 'held', url: held.url, model: held.model, athleteId: held.athleteId, key };
}

/** The longest model name accepted: the operator command's own bound. */
export const MAXIMUM_HOSTED_MODEL_NAME = 200;

/** The model's name, trimmed, or `undefined`: printable characters, no spaces, at most 200. */
export function hostedModelFrom(text: string): string | undefined {
  const model = text.trim();
  if (model === '' || model.length > MAXIMUM_HOSTED_MODEL_NAME) return undefined;
  if (!/^[\x21-\x7e]+$/.test(model)) return undefined;
  return model;
}

/**
 * The ORIGIN a hosted URL or origin names — `https://host[:port]`, as
 * `new URL(…).origin` writes it — or `undefined` when it is not one
 * {@link hostedUrlFrom} accepts. Both sides of a consent check go through this
 * (#1197's review), so a consent given as a full URL, or with a trailing
 * slash, names the same origin as a key whose URL has a path.
 */
export function hostedOriginOf(text: string): string | undefined {
  const url = hostedUrlFrom(text);
  return url.ok ? url.url.origin : undefined;
}

/**
 * `athleteId`'s OWN hosted key, opened with `secret` if it can be (#1199): the
 * key the rider stored, or else the instance's one key when it is held for
 * THIS athlete — the operator's own key for their own account, which the
 * owner's ruling of 2026-10-09 counts as a rider bringing their own. Never
 * another athlete's key: *"Operator key is not shared with riders."* A rider
 * with no key of their own is `none`, whoever else holds one.
 */
export async function ownHostedKeyState(
  store: Pick<SqlStore, 'getAthleteHostedKey' | 'getHostedModelKey'>,
  secret: SecretKey | undefined,
  athleteId: string,
): Promise<HostedKeyState> {
  const own = await store.getAthleteHostedKey(athleteId);
  if (own !== undefined) return opened(own, secret);
  const operators = await store.getHostedModelKey();
  return opened(operators?.athleteId === athleteId ? operators : undefined, secret);
}
