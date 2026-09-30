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
  deviceStatementBytes,
  LINK_PURPOSE,
  toHex,
  unixSeconds,
  type DevicePurpose,
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
  const { origin, instanceAthleteId } = parsed as Record<string, unknown>;
  return typeof origin === 'string' && typeof instanceAthleteId === 'string'
    ? { origin, instanceAthleteId }
    : undefined;
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
  readonly transport: InstanceTransport;
  readonly storage: InstanceAccountStorage;
  /** Makes sure the local athlete row exists — `ensureLocalAthlete`, bound. */
  readonly ensureLocalAthlete: () => Promise<unknown>;
  /** This device's signing key — `ensureDeviceSigningKey`, bound. Asked for only after the athlete. */
  readonly signingKey: () => Promise<SigningKey>;
  /** Unix milliseconds. */
  readonly now?: () => number;
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
  const answer = await dependencies.transport.post('/v1/auth/session', {
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
  const account: InstanceAccount = {
    origin: dependencies.origin,
    instanceAthleteId: body.athleteId,
  };
  dependencies.storage.setItem(INSTANCE_ACCOUNT_STORAGE_KEY, JSON.stringify(account));
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
  dependencies: SignInDependencies,
  linkCode: string,
): Promise<SignedIn> {
  await dependencies.ensureLocalAthlete();
  const key = await dependencies.signingKey();
  const statement = await signedStatement(dependencies, key, LINK_PURPOSE);
  const answer = await dependencies.transport.post('/v1/auth/link', { ...statement, linkCode });
  if (answer.status !== 200) throw new InstanceSignInError(codeOf(answer.body));
  return signInToInstance(dependencies);
}
