// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Identity on an instance (#772, #773, #774): an athlete is **a set of device
 * keys**, and nothing else proves who they are. There is no password, anywhere
 * (ruling Q12).
 *
 * ## Signing in — #772
 *
 * ```text
 * POST /auth/challenge {publicKey}                 → {nonce, expiresAt}      60 s, single use
 * POST /auth/session   {statement…, signature}     → {sessionToken, …}      the token shown once
 * POST /rooms/{id}/ticket (Authorization: Bearer)  → {ticket, expiresAt}    30 s, one room, one hello
 * ```
 *
 * The device signs `@onyourleft/domain`'s {@link deviceStatementBytes}: the
 * purpose, this instance's origin, the nonce, its public key and when it
 * signed. What is refused, each with its own code, in the order it is checked:
 *
 * 1. `wrong_purpose` — the statement is not a sign-in (an activity record's
 *    signature, or a LINK or RECOVER statement, which add keys).
 * 2. `wrong_instance` — the statement names another instance's origin.
 * 3. `challenge_unknown`, `challenge_used`, `challenge_expired` — the nonce was
 *    never issued to this key, was already spent, or is past its 60 s. The
 *    nonce is spent HERE, before the signature is checked, so a replay of a
 *    whole request that once succeeded is `challenge_used`.
 * 4. `bad_signature` — the key did not sign these bytes.
 * 5. `key_revoked` — it did, and the key has been revoked (#773).
 *
 * A key the instance has never seen **registers** a new athlete when the
 * instance's registration is open, and the answer carries the ten recovery
 * codes, once (ruling Q1). #775 owns the other registration modes.
 *
 * ## What is stored
 *
 * The SHA-256 of every secret the instance hands out — session tokens,
 * recovery codes, link codes, email-recovery and address-confirmation
 * tokens — and never the secret.
 * Tickets and rate-limit counts live in memory (`tickets.ts`,
 * `rate-limit.ts`). A copy of the database authenticates nobody.
 *
 * ## More than one device — #773
 *
 * A signed-in device mints a **link code** (5 minutes, single use); the new
 * device, holding its OWN new key, signs a LINK statement and presents the
 * code, and its key is added. Every device lost: a recovery code, or — only
 * where the operator enabled it — an emailed link, adds a key the same way
 * with a RECOVER statement. ⚠️ An address given for email recovery is bound
 * only once the athlete follows the single-use, 24-hour link mailed to it,
 * from a device signed in as them (#865): until then it recovers nothing, and
 * giving an address answers the same whether or not somebody holds it.
 * Revoking the last key and renaming are refused by the STORE, in the
 * transaction that writes (#867). A revoked key's records stay valid: verification
 * is by the record and the key in it (ADR 0014 D-6), never by the key's
 * status here.
 */

import {
  AUTH_PURPOSE,
  checkDisplayName,
  deviceStatementBytes,
  LINK_PURPOSE,
  RECOVER_PURPOSE,
  type DevicePurpose,
  type DisplayNameProblem,
} from '@onyourleft/domain';
import { declaredMassAdmissible } from '@onyourleft/physics';

import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { Admit } from '../room/core/room.ts';
import {
  OwnershipConflictError,
  type DeviceKey,
  type SqlStore,
  type Take,
} from '../store/sql-store.ts';
import {
  isPublicKey,
  isSignature,
  randomHex,
  randomToken,
  sha256Hex,
  verifyEd25519,
} from './crypto.ts';
import { publicAthlete, type PublicAthlete } from './public-athlete.ts';
import { createRateLimiter, type RateLimit } from './rate-limit.ts';
import { createTicketBook, type MintedTicket } from './tickets.ts';

/** A challenge's life: #772's "+60 s". */
export const CHALLENGE_LIFETIME_SECONDS = 60;
/** A session's life. */
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/** A link code's life: #773's "≤ 5 minutes". */
export const LINK_CODE_LIFETIME_SECONDS = 5 * 60;
/** An emailed recovery link's life. */
export const EMAIL_RECOVERY_LIFETIME_SECONDS = 30 * 60;
/** The life of the link that confirms a recovery address (#865). */
export const EMAIL_CONFIRMATION_LIFETIME_SECONDS = 24 * 60 * 60;
/** How many recovery codes a new athlete is shown (ruling Q1). */
export const RECOVERY_CODE_COUNT = 10;
/** The name a new athlete has until they choose one. */
export const DEFAULT_DISPLAY_NAME = 'Rider';

/** The limits, all per minute unless named otherwise. */
export interface IdentityLimits {
  readonly challengePerKey: RateLimit;
  readonly challengePerAddress: RateLimit;
  /** How many times a display name may change in {@link renameWindowSeconds}. */
  readonly renamesPerWindow: number;
  readonly renameWindowSeconds: number;
  readonly emailRecoveryPerAddress: RateLimit;
  /**
   * Confirmation mail (#865, #883), three limits and one exception — see
   * {@link IdentityLimits.confirmationsPerAthleteAddress}. How many times one
   * athlete may give an address, whatever the address: over it the answer is
   * `rate_limited`, which says nothing about who holds the address.
   */
  readonly confirmationRequestsPerAthlete: RateLimit;
  /**
   * How many links one athlete may have mailed to one address. Keyed by the
   * PAIR, so one athlete cannot use up another's share: Mallory asking for
   * Anna's address as often as she likes leaves Anna's own requests untouched.
   */
  readonly confirmationsPerAthleteAddress: RateLimit;
  /**
   * How many links one address may be sent in a window by the ordinary path:
   * whoever asks, however many accounts they hold.
   */
  readonly confirmationsPerAddress: RateLimit;
  /**
   * How many links over {@link confirmationsPerAddress} one address may be
   * sent in a window, as an athlete's FIRST link to it (#883, #889's B2).
   *
   * ⚠️ **The hard ceiling per address is `confirmationsPerAddress.limit +
   * firstLinksPerAddress.limit` a window, and nothing exceeds it**: not a
   * loop of fresh registrations each giving the address, and not a loop of
   * email-less accounts each giving it once. Until #889's re-review the
   * first-link exception had no ceiling of its own, so every new account —
   * and registration mints one per request — mailed the address once more.
   *
   * Why the exception is kept at all: without it a stranger spending the
   * ordinary share at the top of every window would silently starve the
   * address's owner, which is the harm #865 removes. It is granted only to an
   * athlete whose account is at least one {@link confirmationsPerAddress}
   * window old, so a registration never takes it (its account is new by
   * definition) and nor does an account made to flood with.
   *
   * The trade, stated: an attacker who holds `firstLinksPerAddress.limit`
   * accounts aged a window or more, and spends them together with the
   * ordinary share at the top of each window, still starves the owner — who
   * is delayed until a window in which they ask first. What the exception
   * buys is that starving the owner costs aged accounts rather than nothing;
   * what it costs is at most `firstLinksPerAddress.limit` more mails an
   * address a window.
   */
  readonly firstLinksPerAddress: RateLimit;
}

export const DEFAULT_LIMITS: IdentityLimits = {
  challengePerKey: { limit: 10, windowMs: 60_000 },
  challengePerAddress: { limit: 60, windowMs: 60_000 },
  renamesPerWindow: 3,
  renameWindowSeconds: 24 * 60 * 60,
  emailRecoveryPerAddress: { limit: 3, windowMs: 60 * 60_000 },
  confirmationRequestsPerAthlete: { limit: 5, windowMs: 60 * 60_000 },
  confirmationsPerAthleteAddress: { limit: 3, windowMs: 60 * 60_000 },
  confirmationsPerAddress: { limit: 10, windowMs: 60 * 60_000 },
  firstLinksPerAddress: { limit: 3, windowMs: 60 * 60_000 },
};

/**
 * How an emailed link reaches a rider. The instance has no mail transport of
 * its own; an operator who enables email recovery supplies one.
 */
export interface RecoveryMailer {
  /** A recovery link: the token goes in `POST /v1/auth/recover`'s `emailToken`. */
  send(address: string, token: string): Promise<void>;
  /**
   * The link that confirms `address` is the athlete's (#865): the token goes
   * in `POST /v1/auth/recovery-email/confirm`, from the athlete's signed-in
   * device. Until it does, the address recovers nothing.
   */
  confirm(address: string, token: string): Promise<void>;
}

export interface IdentityOptions {
  readonly store: SqlStore;
  /** This instance's origin, as a device signs it: `https://ride.example`. */
  readonly origin: string;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /** #775 adds approval-required and invite-only. */
  readonly registration?: 'open' | 'closed';
  /** Email recovery: absent unless the operator enabled it (ruling Q1). */
  readonly emailRecovery?: RecoveryMailer;
  readonly limits?: IdentityLimits;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/** Who a request is, once its session has been checked. */
export interface Caller {
  readonly athleteId: string;
  readonly deviceKey: string;
  readonly tokenSha256: string;
}

/** What a device sends to prove it holds a key. */
export interface SignedStatement {
  readonly purpose: string;
  readonly instanceOrigin: string;
  readonly nonce: string;
  readonly publicKey: string;
  readonly issuedAt: number;
  readonly signature: string;
}

export interface SessionGranted {
  readonly sessionToken: string;
  /** Unix seconds. */
  readonly expiresAt: number;
  readonly athleteId: string;
  readonly displayName: string;
  readonly registered: boolean;
  /** Only when this sign-in registered the athlete: shown once, and never again. */
  readonly recoveryCodes?: readonly string[];
}

export interface DeviceView {
  readonly publicKey: string;
  readonly addedAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  /** Whether this is the device asking. */
  readonly thisDevice: boolean;
}

export interface Identity {
  readonly origin: string;
  readonly emailRecoveryEnabled: boolean;
  challenge(
    publicKey: unknown,
    address: string | null,
  ): Promise<Outcome<{ nonce: string; expiresAt: number }>>;
  signIn(
    statement: unknown,
    registration: { readonly displayName?: unknown; readonly recoveryEmail?: unknown },
  ): Promise<Outcome<SessionGranted>>;
  /** The caller behind an `Authorization` header, or `undefined`. */
  authenticate(authorization: string | null): Promise<Caller | undefined>;
  signOut(caller: Caller): Promise<void>;
  me(caller: Caller): Promise<Outcome<PublicAthlete>>;
  profile(athleteId: string): Promise<Outcome<PublicAthlete>>;
  rename(caller: Caller, displayName: unknown): Promise<Outcome<PublicAthlete>>;
  ticket(caller: Caller, roomId: string, declaredMass: unknown): Promise<Outcome<MintedTicket>>;
  /** The room core's admission for one room. */
  admitterFor(roomId: string): Admit;
  devices(caller: Caller): Promise<readonly DeviceView[]>;
  revokeDevice(caller: Caller, publicKey: string, recoveryCode: unknown): Promise<Outcome<null>>;
  mintLinkCode(caller: Caller): Promise<Outcome<{ linkCode: string; expiresAt: number }>>;
  link(statement: unknown, linkCode: unknown): Promise<Outcome<{ athleteId: string }>>;
  recover(
    statement: unknown,
    proof: { readonly recoveryCode?: unknown; readonly emailToken?: unknown },
  ): Promise<Outcome<{ athleteId: string }>>;
  requestEmailRecovery(address: unknown, client: string | null): Promise<Outcome<null>>;
  /** Give an address for recovery: mails a link to confirm it, and binds nothing (#865). */
  setRecoveryEmail(caller: Caller, address: unknown): Promise<Outcome<null>>;
  /** Follow that link, signed in as the athlete who gave the address (#865). */
  confirmRecoveryEmail(caller: Caller, token: unknown): Promise<Outcome<null>>;
}

const refuse = (code: ErrorCode, fields?: readonly FieldProblem[]): Outcome<never> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };

const invalid = (field: string, problem: string): Outcome<never> =>
  refuse('validation_failed', [{ field, problem }]);

const NAME_PROBLEMS: Record<DisplayNameProblem, string> = {
  'not-text': 'must be text',
  control: 'must not contain a control character',
  bidi: 'must not contain a bidirectional formatting character',
  invisible: 'must not contain an invisible character',
  empty: 'must not be empty',
  'too-long': 'must be at most 32 characters',
};

/** A secret as the rider types it, normalised before it is hashed. */
function normalisedCode(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, '');
}

/**
 * Sixteen characters from a 31-letter alphabet with no 0, o, 1, i or l,
 * grouped in fours for reading: 79 bits. Drawn by rejection, so no letter is
 * likelier than another.
 */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function readableCode(): string {
  const ceiling = 256 - (256 % CODE_ALPHABET.length);
  let code = '';
  while (code.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < ceiling && code.length < 16) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return code.match(/.{4}/g)?.join('-') ?? code;
}

function takeRefusal(outcome: Take<object>['outcome'], prefix: 'challenge' | 'code'): ErrorCode {
  if (outcome === 'used') return prefix === 'challenge' ? 'challenge_used' : 'code_used';
  if (outcome === 'expired') return prefix === 'challenge' ? 'challenge_expired' : 'code_expired';
  return prefix === 'challenge' ? 'challenge_unknown' : 'code_unknown';
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function createIdentity(options: IdentityOptions): Identity {
  const { store, origin } = options;
  const now = options.now ?? (() => Date.now());
  const seconds = (): number => Math.floor(now() / 1000);
  const limits = options.limits ?? DEFAULT_LIMITS;
  const registration = options.registration ?? 'open';
  const mailer = options.emailRecovery;
  const perKey = createRateLimiter(limits.challengePerKey, now);
  const perAddress = createRateLimiter(limits.challengePerAddress, now);
  const emailPerAddress = createRateLimiter(limits.emailRecoveryPerAddress, now);
  const confirmationRequests = createRateLimiter(limits.confirmationRequestsPerAthlete, now);
  const confirmationsPerPair = createRateLimiter(limits.confirmationsPerAthleteAddress, now);
  const confirmationsPerAddress = createRateLimiter(limits.confirmationsPerAddress, now);
  const firstLinksPerAddress = createRateLimiter(limits.firstLinksPerAddress, now);
  const tickets = createTicketBook(now, () => randomToken(32));

  /** Check a statement for `purpose`, spend its nonce, and verify it. Answers the key. */
  async function proven(statement: unknown, purpose: DevicePurpose): Promise<Outcome<string>> {
    if (typeof statement !== 'object' || statement === null)
      return invalid('body', 'must be an object');
    const claimed = statement as Partial<Record<keyof SignedStatement, unknown>>;
    if (typeof claimed.purpose !== 'string') return invalid('purpose', 'must be a string');
    if (claimed.purpose !== purpose) return refuse('wrong_purpose');
    if (typeof claimed.instanceOrigin !== 'string')
      return invalid('instanceOrigin', 'must be a string');
    if (claimed.instanceOrigin !== origin) return refuse('wrong_instance');
    if (typeof claimed.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(claimed.nonce)) {
      return invalid('nonce', 'must be the 64 hex characters the challenge gave');
    }
    if (!isPublicKey(claimed.publicKey))
      return invalid('publicKey', 'must be 64 lowercase hex characters');
    if (!Number.isSafeInteger(claimed.issuedAt))
      return invalid('issuedAt', 'must be whole Unix seconds');
    if (!isSignature(claimed.signature))
      return invalid('signature', 'must be 128 lowercase hex characters');

    const taken = await store.takeChallenge(claimed.nonce, seconds());
    if (taken.outcome !== 'taken') return refuse(takeRefusal(taken.outcome, 'challenge'));
    if (taken.publicKey !== claimed.publicKey) return refuse('challenge_unknown');

    const bytes = deviceStatementBytes({
      purpose,
      instanceOrigin: origin,
      nonce: claimed.nonce,
      publicKey: claimed.publicKey,
      issuedAt: claimed.issuedAt as number,
    });
    if (!(await verifyEd25519(claimed.publicKey, bytes, claimed.signature))) {
      return refuse('bad_signature');
    }
    return { ok: true, value: claimed.publicKey };
  }

  /**
   * Whether a key is already registered here. Asked BEFORE a link code or a
   * recovery code is spent (#861): a refusal that used one up cost a rider a
   * code for nothing.
   */
  async function keyInUse(publicKey: string): Promise<boolean> {
    return (await store.findDeviceKey(publicKey)) !== undefined;
  }

  /** Add a key a device proved it holds to `athleteId`. */
  async function addKey(
    athleteId: string,
    publicKey: string,
  ): Promise<Outcome<{ athleteId: string }>> {
    try {
      await store.putDeviceKey({ publicKey, athleteId, addedAt: seconds(), revokedAt: null });
    } catch (error) {
      // The store checks ownership in its own transaction, so a key linked
      // twice at once is refused there; it is the same refusal, not a 500.
      if (error instanceof OwnershipConflictError) return refuse('key_in_use');
      throw error;
    }
    return { ok: true, value: { athleteId } };
  }

  async function openSession(
    key: Pick<DeviceKey, 'athleteId' | 'publicKey'>,
  ): Promise<{ sessionToken: string; expiresAt: number }> {
    const sessionToken = randomToken(32);
    const at = seconds();
    const expiresAt = at + SESSION_LIFETIME_SECONDS;
    await store.putSession({
      tokenSha256: await sha256Hex(sessionToken),
      athleteId: key.athleteId,
      deviceKey: key.publicKey,
      expiresAt,
      revokedAt: null,
    });
    await store.touchDeviceKey(key.athleteId, key.publicKey, at);
    return { sessionToken, expiresAt };
  }

  /**
   * A confirmation for an address an athlete gave (#865): the token to mail,
   * and what the store keeps of it. `undefined` when no mail may go, so that
   * giving somebody's address again and again cannot flood their mailbox —
   * and the answer is the same either way. Counted per (athlete, address), so
   * one athlete cannot spend another's share, and per address in all, with
   * one exception that has a hard ceiling of its own (#883, #889's B2):
   * {@link IdentityLimits.firstLinksPerAddress} says who gets it, why, and
   * what it costs. `createdAt` is the athlete's, in Unix seconds.
   */
  async function confirmationFor(
    athleteId: string,
    address: string,
    createdAt: number,
  ): Promise<
    { token: string; tokenSha256: string; address: string; expiresAt: number } | undefined
  > {
    // A newline cannot be in an athlete id (hex) or an address (EMAIL), so
    // no two pairs share a key.
    const pairCount = confirmationsPerPair.take(`${athleteId}\n${address}`);
    if (pairCount > limits.confirmationsPerAthleteAddress.limit) return undefined;
    if (!confirmationsPerAddress.allow(address)) {
      // Over the ordinary share: only an established athlete's first link
      // of the window, and only while the address's exceptions last.
      const established = createdAt * 1000 <= now() - limits.confirmationsPerAddress.windowMs;
      if (pairCount !== 1 || !established) return undefined;
      if (!firstLinksPerAddress.allow(address)) return undefined;
    }
    const token = randomToken(32);
    return {
      token,
      tokenSha256: await sha256Hex(token),
      address,
      expiresAt: seconds() + EMAIL_CONFIRMATION_LIFETIME_SECONDS,
    };
  }

  /** A valid address, normalised, or the refusal. */
  function addressOf(value: unknown, field: string): Outcome<string> {
    if (typeof value !== 'string' || !EMAIL.test(value.trim())) {
      return invalid(field, 'must be an email address');
    }
    return { ok: true, value: value.trim().toLowerCase() };
  }

  async function register(
    publicKey: string,
    fields: { readonly displayName?: unknown; readonly recoveryEmail?: unknown },
  ): Promise<Outcome<SessionGranted>> {
    if (registration !== 'open') return refuse('registration_closed');
    let displayName = DEFAULT_DISPLAY_NAME;
    if (fields.displayName !== undefined) {
      if (typeof fields.displayName !== 'string') return invalid('displayName', 'must be a string');
      const checked = checkDisplayName(fields.displayName);
      if (!checked.ok) return invalid('displayName', NAME_PROBLEMS[checked.problem]);
      displayName = checked.name;
    }
    let recoveryEmail: string | undefined;
    if (fields.recoveryEmail !== undefined) {
      if (mailer === undefined) {
        return invalid('recoveryEmail', 'this instance does not offer email recovery');
      }
      const address = addressOf(fields.recoveryEmail, 'recoveryEmail');
      if (!address.ok) return address;
      recoveryEmail = address.value;
    }
    const athleteId = randomHex(16);
    const at = seconds();
    // Not bound: confirmed later, by whoever reads the mailbox (#865). So the
    // answer cannot depend on whether somebody already holds the address.
    const confirmation =
      recoveryEmail === undefined ? undefined : await confirmationFor(athleteId, recoveryEmail, at);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, readableCode);
    await store.registerAthlete({
      athlete: { id: athleteId, displayName, createdAt: at, registrationState: 'active' },
      key: { publicKey, athleteId, addedAt: at, revokedAt: null },
      recoveryCodeSha256s: await Promise.all(
        recoveryCodes.map((code) => sha256Hex(normalisedCode(code))),
      ),
      ...(confirmation === undefined
        ? {}
        : {
            recoveryEmailConfirmation: {
              tokenSha256: confirmation.tokenSha256,
              address: confirmation.address,
              expiresAt: confirmation.expiresAt,
            },
          }),
    });
    const session = await openSession({ athleteId, publicKey });
    if (confirmation !== undefined && mailer !== undefined) {
      // The athlete exists and their recovery codes are about to be shown for
      // the only time: a mail transport that fails must not turn that into an
      // error. They can give the address again from a signed-in device.
      await mailer.confirm(confirmation.address, confirmation.token).catch(() => undefined);
    }
    return {
      ok: true,
      value: { ...session, athleteId, displayName, registered: true, recoveryCodes },
    };
  }

  return {
    origin,
    emailRecoveryEnabled: mailer !== undefined,

    async challenge(publicKey, address) {
      if (!isPublicKey(publicKey))
        return invalid('publicKey', 'must be 64 lowercase hex characters');
      // Both limits are counted, so a caller over one does not escape the other.
      const keyAllowed = perKey.allow(publicKey);
      const addressAllowed = perAddress.allow(address ?? 'unknown');
      if (!keyAllowed || !addressAllowed) return refuse('rate_limited');
      const at = seconds();
      await store.pruneChallenges(at - CHALLENGE_LIFETIME_SECONDS);
      const nonce = randomHex(32);
      const expiresAt = at + CHALLENGE_LIFETIME_SECONDS;
      await store.putChallenge({ nonce, publicKey, expiresAt });
      return { ok: true, value: { nonce, expiresAt } };
    },

    async signIn(statement, fields) {
      const proof = await proven(statement, AUTH_PURPOSE);
      if (!proof.ok) return proof;
      const key = await store.findDeviceKey(proof.value);
      if (key === undefined) return register(proof.value, fields);
      if (key.revokedAt !== null) return refuse('key_revoked');
      const athlete = await store.getAthlete(key.athleteId);
      if (athlete === undefined) return refuse('unauthenticated');
      const session = await openSession(key);
      return {
        ok: true,
        value: {
          ...session,
          athleteId: athlete.id,
          displayName: athlete.displayName,
          registered: false,
        },
      };
    },

    async authenticate(authorization) {
      const match =
        authorization === null ? null : /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(authorization);
      if (match === null) return undefined;
      const tokenSha256 = await sha256Hex(match[1] as string);
      const session = await store.findSession(tokenSha256);
      if (session === undefined || session.revokedAt !== null || session.expiresAt <= seconds()) {
        return undefined;
      }
      const key = await store.findDeviceKey(session.deviceKey);
      if (key === undefined || key.revokedAt !== null || key.athleteId !== session.athleteId) {
        return undefined;
      }
      return { athleteId: session.athleteId, deviceKey: session.deviceKey, tokenSha256 };
    },

    async signOut(caller) {
      await store.revokeSession(caller.athleteId, caller.tokenSha256, seconds());
    },

    async me(caller) {
      const athlete = await store.getAthlete(caller.athleteId);
      return athlete === undefined
        ? refuse('not_found')
        : { ok: true, value: publicAthlete(athlete) };
    },

    async profile(athleteId) {
      const athlete = await store.getAthlete(athleteId);
      return athlete === undefined
        ? refuse('not_found')
        : { ok: true, value: publicAthlete(athlete) };
    },

    async rename(caller, displayName) {
      if (typeof displayName !== 'string') return invalid('displayName', 'must be a string');
      const checked = checkDisplayName(displayName);
      if (!checked.ok) return invalid('displayName', NAME_PROBLEMS[checked.problem]);
      // The limit is counted by the store, in the transaction that writes
      // (#867): counted here, two renames at once could each see room.
      const outcome = await store.renameAthlete(caller.athleteId, checked.name, seconds(), {
        count: limits.renamesPerWindow,
        windowSeconds: limits.renameWindowSeconds,
      });
      if (outcome !== 'renamed') return refuse(outcome);
      return { ok: true, value: { athleteId: caller.athleteId, displayName: checked.name } };
    },

    async ticket(caller, roomId, declaredMass) {
      if (typeof declaredMass !== 'number' || !declaredMassAdmissible(declaredMass)) {
        return invalid('declaredMassKilograms', 'must be a mass a room admits, in kilograms');
      }
      if ((await store.getRoom(roomId)) === undefined) return refuse('not_found');
      return {
        ok: true,
        value: tickets.mint(roomId, {
          athleteId: caller.athleteId,
          declaredMassKilograms: declaredMass,
        }),
      };
    },

    admitterFor: (roomId) => tickets.admitterFor(roomId),

    async devices(caller) {
      return (await store.listDeviceKeys(caller.athleteId)).map((key) => ({
        publicKey: key.publicKey,
        addedAt: key.addedAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
        thisDevice: key.publicKey === caller.deviceKey,
      }));
    },

    async revokeDevice(caller, publicKey, recoveryCode) {
      // The last key is refused unless the athlete shows a code that would
      // let them back in; the code is checked, not spent. ⚠️ The STORE checks
      // it, in the transaction that revokes (#867): counting the live keys
      // here and revoking in a second call let two sessions revoking the last
      // two keys at once each see two, and leave the athlete with none.
      const proof =
        typeof recoveryCode === 'string' ? await sha256Hex(normalisedCode(recoveryCode)) : null;
      const outcome = await store.revokeDeviceKey(caller.athleteId, publicKey, seconds(), proof);
      return outcome === 'revoked' ? { ok: true, value: null } : refuse(outcome);
    },

    async mintLinkCode(caller) {
      const linkCode = readableCode();
      const expiresAt = seconds() + LINK_CODE_LIFETIME_SECONDS;
      await store.putLinkCode({
        codeSha256: await sha256Hex(normalisedCode(linkCode)),
        athleteId: caller.athleteId,
        mintedByKey: caller.deviceKey,
        expiresAt,
      });
      return { ok: true, value: { linkCode, expiresAt } };
    },

    async link(statement, linkCode) {
      if (typeof linkCode !== 'string') return invalid('linkCode', 'must be a string');
      const proof = await proven(statement, LINK_PURPOSE);
      if (!proof.ok) return proof;
      if (await keyInUse(proof.value)) return refuse('key_in_use');
      const taken = await store.takeLinkCode(await sha256Hex(normalisedCode(linkCode)), seconds());
      if (taken.outcome !== 'taken') return refuse(takeRefusal(taken.outcome, 'code'));
      return addKey(taken.athleteId, proof.value);
    },

    async recover(statement, proof) {
      const byEmail = proof.emailToken !== undefined;
      if (byEmail && mailer === undefined) return refuse('not_found');
      const secret = byEmail ? proof.emailToken : proof.recoveryCode;
      if (typeof secret !== 'string') {
        return invalid(byEmail ? 'emailToken' : 'recoveryCode', 'must be a string');
      }
      const key = await proven(statement, RECOVER_PURPOSE);
      if (!key.ok) return key;
      if (await keyInUse(key.value)) return refuse('key_in_use');
      const taken = byEmail
        ? await store.takeEmailRecoveryToken(await sha256Hex(secret), seconds())
        : await store.takeRecoveryCode(await sha256Hex(normalisedCode(secret)), seconds());
      if (taken.outcome !== 'taken') return refuse(takeRefusal(taken.outcome, 'code'));
      return addKey(taken.athleteId, key.value);
    },

    async requestEmailRecovery(address, client) {
      if (mailer === undefined) return refuse('not_found');
      const given = addressOf(address, 'address');
      if (!given.ok) return given;
      const normalised = given.value;
      if (!emailPerAddress.allow(normalised) || !perAddress.allow(client ?? 'unknown')) {
        return refuse('rate_limited');
      }
      // The same answer whether or not the address is known, so it cannot be
      // used to find out who rides here.
      const held = await store.findRecoveryEmail(normalised);
      if (held !== undefined) {
        const token = randomToken(32);
        await store.putEmailRecoveryToken({
          tokenSha256: await sha256Hex(token),
          athleteId: held.athleteId,
          expiresAt: seconds() + EMAIL_RECOVERY_LIFETIME_SECONDS,
        });
        await mailer.send(held.address, token);
      }
      return { ok: true, value: null };
    },

    async setRecoveryEmail(caller, address) {
      if (mailer === undefined) return refuse('not_found');
      const given = addressOf(address, 'address');
      if (!given.ok) return given;
      // Per caller first (#883): an athlete asking for a new address every
      // time would otherwise have the instance mail anyone, as often as it
      // liked. The refusal depends on the caller's count alone.
      if (!confirmationRequests.allow(caller.athleteId)) return refuse('rate_limited');
      // The same answer whether or not somebody holds the address (#865): a
      // link goes to it either way, and only following it binds anything.
      // The account's age decides the first-link exception (#889's B2); an
      // athlete the store no longer holds is treated as new, so gets none.
      const createdAt = (await store.getAthlete(caller.athleteId))?.createdAt ?? seconds();
      const confirmation = await confirmationFor(caller.athleteId, given.value, createdAt);
      if (confirmation !== undefined) {
        // Mailed FIRST, and the row written only once it went (#883): a
        // transport that fails is `internal`, and leaves no link in the store
        // that nobody was sent — nor replaces the athlete's earlier one.
        // Registration swallows the same failure instead, because there the
        // athlete's recovery codes are about to be shown for the only time.
        try {
          await mailer.confirm(confirmation.address, confirmation.token);
        } catch {
          return refuse('internal');
        }
        // Replaces this athlete's earlier unconfirmed link, if any, so the
        // table holds at most one pending confirmation an athlete (#883).
        // ⚠️ The other direction is NOT covered: if this write fails after
        // the mail went, the address holds a link the store never kept —
        // following it answers `code_unknown`, binds nothing, and this route
        // answers 500 (the handler's `internal`). The athlete's earlier link,
        // if any, still stands, and giving the address again mails a fresh one.
        await store.putEmailConfirmation({
          tokenSha256: confirmation.tokenSha256,
          athleteId: caller.athleteId,
          address: confirmation.address,
          expiresAt: confirmation.expiresAt,
        });
      }
      return { ok: true, value: null };
    },

    async confirmRecoveryEmail(caller, token) {
      if (mailer === undefined) return refuse('not_found');
      if (typeof token !== 'string') return invalid('token', 'must be a string');
      // Signed in as the athlete who gave the address, and nobody else: a
      // stranger who gives YOUR address cannot have you bind it to THEIR
      // account by following the link they caused to be sent (#865). The
      // store scopes the token to the caller, so theirs is `code_unknown`.
      const taken = await store.confirmRecoveryEmail(
        caller.athleteId,
        await sha256Hex(token),
        seconds(),
      );
      if (taken.outcome === 'taken') return { ok: true, value: null };
      // Only the reader of the mailbox holds the token, so telling them the
      // address is another account's tells nobody else anything.
      if (taken.outcome === 'held') return refuse('address_in_use');
      return refuse(takeRefusal(taken.outcome, 'code'));
    },
  };
}
