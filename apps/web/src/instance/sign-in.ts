// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The client half of signing in to an instance with the device key (#772),
 * and of adding this device to an athlete another device already signed in as
 * (#773).
 *
 * ## What this module does NOT do: talk to the network
 *
 * It names no `fetch`. It takes an {@link InstanceTransport} and a
 * {@link InstanceAccountStorage}, and #777's `instance-port.ts` §`createInstancePort`
 * supplies the production transport — `instance-transport.ts`, the one module
 * `privacy/no-network.test.ts` permits to call an instance — in the same pull
 * request as #778 changed every promise about what leaves the device. This
 * module is what they wire rather than a second place that sends.
 *
 * ## The order of things
 *
 * 1. **The local athlete exists first.** `ensureLocalAthlete`
 *    (`local-athlete.ts`) writes the athlete row, and the device key is an
 *    athlete's, so the key is only asked for once that row is there (#184's
 *    rule, and #772's criterion).
 * 2. **The device key signs; it never leaves.** The key is ADR 0014's
 *    non-extractable `CryptoKey` behind `@onyourleft/store`'s
 *    `ensureDeviceSigningKey`, and this module holds only its `sign` function.
 *    Linking (#773) signs with THIS device's own key — no key is copied from
 *    another device, and `exportKey` is never called on a private key here.
 * 3. **The statement is `@onyourleft/domain`'s**, so the bytes the browser
 *    signs are the bytes the instance verifies (ADR 0014 D-8).
 * 4. **The instance's athlete id is kept on the device**, beside the origin it
 *    belongs to, and is read back from storage — not from this call's result —
 *    on the next launch.
 */

import {
  AUTH_PURPOSE,
  base32UnpaddedDecode,
  deviceStatementBytes,
  LINK_PURPOSE,
  toHex,
  unixSeconds,
  type DevicePurpose,
  type InstanceKeyTrust,
  type SigningKey,
} from '@onyourleft/domain';

/** One JSON request to an instance: the status and the parsed body. */
export interface InstanceTransport {
  post(
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

/** What this device remembers about the instance it signed in to. */
export interface InstanceAccount {
  readonly origin: string;
  /** The athlete id the INSTANCE gave, which is not the local athlete's. */
  readonly instanceAthleteId: string;
  /**
   * The instance identity key's whole fingerprint, 52 base32 characters, as
   * the card the rider scanned or pasted wrote it (#1190, ADR 0047 D-6) — or
   * absent: a device that signed in with only an address holds no pin and uses
   * no sealed route (D-14 Q1). Changed only by the rider confirming a new card.
   */
  readonly pin?: string;
  /** The highest key serial and its id this device has verified, and when it first saw each statement (D-5). */
  readonly keyTrust?: InstanceKeyTrust;
  /**
   * The fingerprint the pinned key ENDORSED for its successor (D-5, D-14 Q8):
   * the app stops sealing and asks for a card carrying exactly this one.
   */
  readonly expectedFingerprint?: string;
}

/** A 52-character base32 fingerprint that decodes to 32 bytes, or `undefined`. */
function fingerprintField(value: unknown): string | undefined {
  return typeof value === 'string' && base32UnpaddedDecode(value, 32) !== undefined
    ? value
    : undefined;
}

const isWholeSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** The stored trust, or `undefined` when it is not one this build wrote. */
function trustField(value: unknown): InstanceKeyTrust | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { highestSerial, highestKeyId, firstVerified } = value as Record<string, unknown>;
  if (!(highestSerial === null || isWholeSeconds(highestSerial))) return undefined;
  if (!(highestKeyId === null || typeof highestKeyId === 'string')) return undefined;
  if (typeof firstVerified !== 'object' || firstVerified === null) return undefined;
  const seen: Record<string, { at: number; notAfter: number }> = {};
  for (const [id, entry] of Object.entries(firstVerified)) {
    const { at, notAfter } = (entry ?? {}) as Record<string, unknown>;
    if (!isWholeSeconds(at) || !isWholeSeconds(notAfter)) return undefined;
    seen[id] = { at, notAfter };
  }
  return { highestSerial, highestKeyId, firstVerified: seen };
}

/** Keep `account` on this device, in place of whatever was kept before. */
export function writeInstanceAccount(
  storage: InstanceAccountStorage,
  account: InstanceAccount,
): void {
  storage.setItem(INSTANCE_ACCOUNT_STORAGE_KEY, JSON.stringify(account));
}

/** What this module needs of `localStorage`. */
export interface InstanceAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The one key the account is kept under. */
export const INSTANCE_ACCOUNT_STORAGE_KEY = 'oyl.instance.account.v1';

/** The account this device signed in with, or `undefined` — never a guess. */
export function readInstanceAccount(storage: InstanceAccountStorage): InstanceAccount | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(INSTANCE_ACCOUNT_STORAGE_KEY) ?? 'null');
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { origin, instanceAthleteId, pin, keyTrust, expectedFingerprint } = parsed as Record<
    string,
    unknown
  >;
  if (typeof origin !== 'string' || typeof instanceAthleteId !== 'string') return undefined;
  const heldPin = fingerprintField(pin);
  const trust = trustField(keyTrust);
  const expected = fingerprintField(expectedFingerprint);
  return {
    origin,
    instanceAthleteId,
    ...(heldPin === undefined ? {} : { pin: heldPin }),
    ...(heldPin === undefined || trust === undefined ? {} : { keyTrust: trust }),
    ...(heldPin === undefined || expected === undefined ? {} : { expectedFingerprint: expected }),
  };
}

/** Why signing in did not work: the instance's own error code, or a transport failure. */
export class InstanceSignInError extends Error {
  override readonly name = 'InstanceSignInError';
  constructor(readonly code: string) {
    super(`The instance refused: ${code}.`);
  }
}

export interface SignInDependencies {
  /** The instance's origin, exactly as the instance states it. */
  readonly origin: string;
  /** Plaintext: the challenge, and signing a key the instance already holds in. */
  readonly transport: InstanceTransport;
  /**
   * SEALED to the instance's key and signed by this device's (#1192, ADR 0047
   * D-7): registering a key the instance has not seen, and linking, go here and
   * nowhere else. Absent — no card, or a copy of the app loaded from a
   * website (D-11) — a new key is refused `sealed_required` and a link is not
   * attempted.
   */
  readonly sealed?: InstanceTransport;
  readonly storage: InstanceAccountStorage;
  /** Makes sure the local athlete row exists — `ensureLocalAthlete`, bound. */
  readonly ensureLocalAthlete: () => Promise<unknown>;
  /** This device's signing key — `ensureDeviceSigningKey`, bound. Asked for only after the athlete. */
  readonly signingKey: () => Promise<SigningKey>;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /**
   * The pin to keep with the account, from a card this sign-in was verified
   * against (#1190). Without it a same-origin pin already held is kept; a new
   * origin's account holds none.
   */
  readonly pin?: { readonly fingerprint: string; readonly keyTrust: InstanceKeyTrust };
}

export interface SignedIn {
  readonly sessionToken: string;
  readonly instanceAthleteId: string;
  readonly registered: boolean;
  /** Only on the sign-in that registered: the rider must be shown these once. */
  readonly recoveryCodes?: readonly string[];
}

const codeOf = (body: unknown): string => {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === 'string' ? code : 'unknown';
};

/** A challenge from the instance, signed for `purpose` by this device's key. */
async function signedStatement(
  dependencies: SignInDependencies,
  key: SigningKey,
  purpose: DevicePurpose,
): Promise<Record<string, string | number>> {
  const publicKey = toHex(key.publicKey);
  const challenge = await dependencies.transport.post('/v1/auth/challenge', { publicKey });
  const nonce = (challenge.body as { nonce?: unknown } | null)?.nonce;
  if (challenge.status !== 200 || typeof nonce !== 'string') {
    throw new InstanceSignInError(codeOf(challenge.body));
  }
  const now = dependencies.now ?? (() => Date.now());
  const statement = {
    purpose,
    instanceOrigin: dependencies.origin,
    nonce,
    publicKey,
    issuedAt: unixSeconds(Math.floor(now() / 1000)),
  };
  return { ...statement, signature: toHex(await key.sign(deviceStatementBytes(statement))) };
}

/** Sign this device in to an instance, registering it there if the instance has never seen its key. */
export async function signInToInstance(
  dependencies: SignInDependencies,
  registration: { readonly displayName?: string } = {},
): Promise<SignedIn> {
  await dependencies.ensureLocalAthlete();
  const key = await dependencies.signingKey();
  const statement = await signedStatement(dependencies, key, AUTH_PURPOSE);
  // Sealed whenever this device can seal, so a registration's recovery codes
  // cross the edge only as ciphertext; in plaintext only a key the instance
  // already holds signs in (ADR 0047 D-7, until phase 2).
  const session = dependencies.sealed ?? dependencies.transport;
  const answer = await session.post('/v1/auth/session', {
    ...statement,
    ...(registration.displayName === undefined ? {} : { displayName: registration.displayName }),
  });
  const body = answer.body as Partial<Record<string, unknown>> | null;
  if (
    answer.status !== 200 ||
    typeof body?.sessionToken !== 'string' ||
    typeof body.athleteId !== 'string'
  ) {
    throw new InstanceSignInError(codeOf(answer.body));
  }
  const held = readInstanceAccount(dependencies.storage);
  const kept =
    dependencies.pin !== undefined
      ? { pin: dependencies.pin.fingerprint, keyTrust: dependencies.pin.keyTrust }
      : held?.origin === dependencies.origin && held.pin !== undefined
        ? {
            pin: held.pin,
            ...(held.keyTrust === undefined ? {} : { keyTrust: held.keyTrust }),
            ...(held.expectedFingerprint === undefined
              ? {}
              : { expectedFingerprint: held.expectedFingerprint }),
          }
        : {};
  writeInstanceAccount(dependencies.storage, {
    origin: dependencies.origin,
    instanceAthleteId: body.athleteId,
    ...kept,
  });
  return {
    sessionToken: body.sessionToken,
    instanceAthleteId: body.athleteId,
    registered: body.registered === true,
    ...(Array.isArray(body.recoveryCodes)
      ? { recoveryCodes: body.recoveryCodes.filter((code) => typeof code === 'string') }
      : {}),
  };
}

/**
 * Add THIS device to the athlete whose other device showed `linkCode` (#773),
 * then sign in. The key that signs is this device's own; nothing is copied.
 */
export async function linkThisDevice(
  dependencies: SignInDependencies & { readonly sealed: InstanceTransport },
  linkCode: string,
): Promise<SignedIn> {
  await dependencies.ensureLocalAthlete();
  const key = await dependencies.signingKey();
  const statement = await signedStatement(dependencies, key, LINK_PURPOSE);
  // Sealed-only (#1192): the code crosses the edge only as ciphertext.
  const answer = await dependencies.sealed.post('/v1/auth/link', { ...statement, linkCode });
  if (answer.status !== 200) throw new InstanceSignInError(codeOf(answer.body));
  return signInToInstance(dependencies);
}
