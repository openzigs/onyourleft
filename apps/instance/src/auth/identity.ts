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
 * A key the instance has never seen **registers** a new athlete, as the
 * instance's registration mode allows (#775), and the answer carries the ten
 * recovery codes, once (ruling Q1):
 *
 * - `approval` — **the default** (rulings Q5 and Q13): the athlete is created
 *   `pending`, with a session that reaches their own account and nothing
 *   else, until the owner or the deputy approves or refuses them;
 * - `invite` — only with a moderator's single-use invitation, spent in the
 *   same transaction that registers;
 * - `open` — active at once;
 * - `closed` — `registration_closed`.
 *
 * A key the operator named as the owner's or the deputy's registers active in
 * every mode, or approval-required registration could never approve its
 * first rider — and a PENDING account signing in with one (the key was named
 * after the account registered) is activated there and then, and logged,
 * because no moderator may approve a moderator (#891's review). New registrations are limited per client address
 * (`rate-limit.ts` §`addressKey`), and a refused or suspended athlete's every
 * key is refused at sign-in.
 *
 * ## What is stored
 *
 * The SHA-256 of every secret the instance hands out — session tokens,
 * recovery codes, link codes, email-recovery tokens — and never the secret.
 * Tickets and rate-limit counts live in memory (`tickets.ts`,
 * `rate-limit.ts`). A copy of the database authenticates nobody.
 *
 * ## More than one device — #773
 *
 * A signed-in device mints a **link code** (5 minutes, single use); the new
 * device, holding its OWN new key, signs a LINK statement and presents the
 * code, and its key is added. Every device lost: a recovery code, or — only
 * where the operator enabled it — an emailed link, adds a key the same way
 * with a RECOVER statement. A revoked key's records stay valid: verification
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

import { DEFAULT_REGISTRATION, type RegistrationMode } from '../config.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import {
  DEFAULT_PUBLIC_ROOM_THRESHOLDS,
  publicRoomEligibility,
  type Eligibility,
  type PublicRoomThresholds,
} from '../moderation/eligibility.ts';
import {
  createModeration,
  type Moderation,
  type ModerationLimits,
  type Moderators,
} from '../moderation/moderation.ts';
import type { Admit } from '../room/core/room.ts';
import {
  InviteRefusedError,
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
import { HIDDEN_DISPLAY_NAME, publicAthlete, type PublicAthlete } from './public-athlete.ts';
import { addressKey, createRateLimiter, type RateLimit } from './rate-limit.ts';
import { createTicketBook, type MintedTicket } from './tickets.ts';

/** A challenge's life: #772's "+60 s". */
export const CHALLENGE_LIFETIME_SECONDS = 60;
/** A session's life. */
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
/** A link code's life: #773's "≤ 5 minutes". */
export const LINK_CODE_LIFETIME_SECONDS = 5 * 60;
/** An emailed recovery link's life. */
export const EMAIL_RECOVERY_LIFETIME_SECONDS = 30 * 60;
/** An invitation's life (#775). */
export const INVITE_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
/** How many recovery codes a new athlete is shown (ruling Q1). */
export const RECOVERY_CODE_COUNT = 10;
/** The name a new athlete has until they choose one — and what others see of a hidden one (#83). */
export const DEFAULT_DISPLAY_NAME = HIDDEN_DISPLAY_NAME;

/** The limits, all per minute unless named otherwise. */
export interface IdentityLimits {
  readonly challengePerKey: RateLimit;
  readonly challengePerAddress: RateLimit;
  /** How many times a display name may change in {@link renameWindowSeconds}. */
  readonly renamesPerWindow: number;
  readonly renameWindowSeconds: number;
  readonly emailRecoveryPerAddress: RateLimit;
  /** New accounts per client address (#775). */
  readonly registrationPerAddress: RateLimit;
}

export const DEFAULT_LIMITS: IdentityLimits = {
  challengePerKey: { limit: 10, windowMs: 60_000 },
  challengePerAddress: { limit: 60, windowMs: 60_000 },
  renamesPerWindow: 3,
  renameWindowSeconds: 24 * 60 * 60,
  emailRecoveryPerAddress: { limit: 3, windowMs: 60 * 60_000 },
  registrationPerAddress: { limit: 3, windowMs: 60 * 60_000 },
};

/**
 * How an emailed recovery link reaches a rider. The instance has no mail
 * transport of its own; an operator who enables email recovery supplies one.
 */
export interface RecoveryMailer {
  send(address: string, token: string): Promise<void>;
}

export interface IdentityOptions {
  readonly store: SqlStore;
  /** This instance's origin, as a device signs it: `https://ride.example`. */
  readonly origin: string;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /** How this instance takes new riders (#775). Unset is `approval`. */
  readonly registration?: RegistrationMode;
  /** Public-room eligibility's thresholds (#775). */
  readonly publicRooms?: PublicRoomThresholds;
  /** Email recovery: absent unless the operator enabled it (ruling Q1). */
  readonly emailRecovery?: RecoveryMailer;
  readonly limits?: IdentityLimits;
  /** The device keys of the owner and the deputy, who moderate (#83, ruling Q13). */
  readonly moderators?: Moderators;
  readonly moderationLimits?: ModerationLimits;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

/** Who a request is, once its session has been checked. */
export interface Caller {
  readonly athleteId: string;
  readonly deviceKey: string;
  readonly tokenSha256: string;
  /**
   * `pending` for an athlete awaiting approval (#775): the handler lets such a
   * caller reach only the routes that declare `admitsPending`.
   */
  readonly standing: 'active' | 'pending';
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
  /** `pending` until a moderator approves an approval-required registration (#775). */
  readonly registrationState: string;
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

/** What an athlete sees of their own account (#775). */
export interface Account {
  readonly athleteId: string;
  readonly displayName: string;
  readonly registrationState: string;
  readonly adultConfirmedAt: number | null;
  readonly moderatorRole: 'owner' | 'deputy' | null;
  readonly publicRooms: Eligibility;
}

/** What a registration may carry beyond the signed statement. */
export interface RegistrationFields {
  readonly displayName?: unknown;
  readonly recoveryEmail?: unknown;
  /** `invite` mode: a moderator's invitation. */
  readonly inviteCode?: unknown;
  /** `true` when the rider confirms they are 18 or over (ruling Q5). */
  readonly confirmsAdult?: unknown;
}

export interface Identity {
  readonly origin: string;
  /** Blocking, reporting and the moderators' tools (#83), over the same store and clock. */
  readonly moderation: Moderation;
  readonly emailRecoveryEnabled: boolean;
  challenge(
    publicKey: unknown,
    address: string | null,
  ): Promise<Outcome<{ nonce: string; expiresAt: number }>>;
  signIn(
    statement: unknown,
    registration: RegistrationFields,
    address?: string | null,
  ): Promise<Outcome<SessionGranted>>;
  /** The caller behind an `Authorization` header, or `undefined`. */
  authenticate(authorization: string | null): Promise<Caller | undefined>;
  signOut(caller: Caller): Promise<void>;
  me(caller: Caller): Promise<Outcome<PublicAthlete>>;
  /** The caller's own account: registration, 18+ confirmation, role, eligibility (#775). */
  account(caller: Caller): Promise<Outcome<Account>>;
  /** Record the caller's confirmation that they are 18 or over (#775). */
  confirmAdult(caller: Caller, confirmed: unknown): Promise<Outcome<Account>>;
  /** A moderator mints a single-use invitation, logged (#775). */
  mintInvite(
    caller: Caller,
    reason: unknown,
  ): Promise<Outcome<{ inviteCode: string; expiresAt: number }>>;
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
  const registration = options.registration ?? DEFAULT_REGISTRATION;
  const publicRooms = options.publicRooms ?? DEFAULT_PUBLIC_ROOM_THRESHOLDS;
  // ⚠️ In memory, like every limit below and unlike the report limit
  // (`moderation.ts`, counted from the store): a restart — or, under the
  // Durable Object adapter, an eviction — hands every address a fresh
  // allowance (#891's review). Counting registrations from the database would
  // mean storing each rider's address beside their account, which this
  // instance deliberately never does (`log.ts`); what bounds identities is
  // approval, which a restart does not reset. `docs/moderation.md` says so.
  const registrations = createRateLimiter(limits.registrationPerAddress, now);
  const mailer = options.emailRecovery;
  const perKey = createRateLimiter(limits.challengePerKey, now);
  const perAddress = createRateLimiter(limits.challengePerAddress, now);
  const emailPerAddress = createRateLimiter(limits.emailRecoveryPerAddress, now);
  const tickets = createTicketBook(now);
  const moderation = createModeration({
    store,
    now,
    ...(options.moderators === undefined ? {} : { moderators: options.moderators }),
    ...(options.moderationLimits === undefined ? {} : { limits: options.moderationLimits }),
  });

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
    // The per-key limit counts only a challenge spent by a valid signature
    // (#861's review): a public key is not secret, so counting every challenge
    // let anybody lock its holder out.
    perKey.count(claimed.publicKey);
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

  /** Whether `publicKey` is one the operator named as a moderator's. */
  function moderatorKey(publicKey: string): boolean {
    const named = options.moderators ?? {};
    return publicKey === named.owner || publicKey === named.deputy;
  }

  async function account(athleteId: string): Promise<Account | undefined> {
    const athlete = await store.getAthlete(athleteId);
    if (athlete === undefined) return undefined;
    return {
      athleteId: athlete.id,
      displayName: athlete.displayName,
      registrationState: athlete.registrationState,
      adultConfirmedAt: athlete.adultConfirmedAt,
      moderatorRole: (await moderation.roleOf(athlete.id)) ?? null,
      publicRooms: publicRoomEligibility(
        { ...athlete, completedRides: await store.countActivityRecords(athlete.id) },
        publicRooms,
        seconds(),
      ),
    };
  }

  async function register(
    publicKey: string,
    fields: RegistrationFields,
    address: string | null,
  ): Promise<Outcome<SessionGranted>> {
    const moderator = moderatorKey(publicKey);
    if (!moderator && registration === 'closed') return refuse('registration_closed');
    const invited = !moderator && registration === 'invite';
    if (invited && typeof fields.inviteCode !== 'string') {
      return invalid('inviteCode', 'this instance registers riders by invitation only');
    }
    if (fields.confirmsAdult !== undefined && typeof fields.confirmsAdult !== 'boolean') {
      return invalid('confirmsAdult', 'must be true or false');
    }
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
      if (typeof fields.recoveryEmail !== 'string' || !EMAIL.test(fields.recoveryEmail.trim())) {
        return invalid('recoveryEmail', 'must be an email address');
      }
      recoveryEmail = fields.recoveryEmail.trim().toLowerCase();
    }
    // Counted per client address, only for a NEW account (#775). An address
    // the adapter could not give shares one bucket: failing closed slows
    // registration, where one busy client could otherwise open the door.
    if (!registrations.allow(address === null ? 'unknown' : addressKey(address))) {
      return refuse('rate_limited');
    }
    const athleteId = randomHex(16);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, readableCode);
    const at = seconds();
    const registrationState = !moderator && registration === 'approval' ? 'pending' : 'active';
    try {
      await store.registerAthlete({
        athlete: { id: athleteId, displayName, createdAt: at, registrationState },
        key: { publicKey, athleteId, addedAt: at, revokedAt: null },
        recoveryCodeSha256s: await Promise.all(
          recoveryCodes.map((code) => sha256Hex(normalisedCode(code))),
        ),
        ...(recoveryEmail === undefined ? {} : { recoveryEmail }),
        ...(fields.confirmsAdult === true ? { adultConfirmedAt: at } : {}),
        ...(invited
          ? { inviteCodeSha256: await sha256Hex(normalisedCode(fields.inviteCode as string)) }
          : {}),
      });
    } catch (error) {
      if (error instanceof InviteRefusedError) return refuse(takeRefusal(error.outcome, 'code'));
      throw error;
    }
    const session = await openSession({ athleteId, publicKey });
    return {
      ok: true,
      value: {
        ...session,
        athleteId,
        displayName,
        registered: true,
        registrationState,
        recoveryCodes,
      },
    };
  }

  return {
    origin,
    moderation,
    emailRecoveryEnabled: mailer !== undefined,

    async challenge(publicKey, address) {
      if (!isPublicKey(publicKey))
        return invalid('publicKey', 'must be 64 lowercase hex characters');
      // Both limits are counted, so a caller over one does not escape the other.
      // Per key, only challenges a valid signature spent are counted (`proven`),
      // so a stranger asking for a key's challenges cannot lock its holder
      // out. Per address, an address the adapter did not know is NOT one
      // shared bucket (#861's review): the per-key limit still holds for it.
      const keyAllowed = perKey.peek(publicKey);
      const addressAllowed = address === null || perAddress.allow(addressKey(address));
      if (!keyAllowed || !addressAllowed) return refuse('rate_limited');
      const at = seconds();
      await store.pruneChallenges(at - CHALLENGE_LIFETIME_SECONDS);
      const nonce = randomHex(32);
      const expiresAt = at + CHALLENGE_LIFETIME_SECONDS;
      await store.putChallenge({ nonce, publicKey, expiresAt });
      return { ok: true, value: { nonce, expiresAt } };
    },

    async signIn(statement, fields, address = null) {
      const proof = await proven(statement, AUTH_PURPOSE);
      if (!proof.ok) return proof;
      const key = await store.findDeviceKey(proof.value);
      if (key === undefined) return register(proof.value, fields, address);
      if (key.revokedAt !== null) return refuse('key_revoked');
      const athlete = await store.getAthlete(key.athleteId);
      if (athlete === undefined) return refuse('unauthenticated');
      // Every key the athlete holds is refused, not only the one that was
      // named in a report: a ban that binds one key is worthless (ADR 0028
      // D-6.2, #775). Told to the athlete themselves, and to nobody else.
      if (athlete.suspendedAt !== null) return refuse('account_suspended');
      if (athlete.registrationState === 'refused') return refuse('registration_refused');
      let registrationState = athlete.registrationState;
      // The owner signed in before the operator set their key, so registered
      // pending — and nobody may approve a moderator, so nothing could ever
      // let them in (#891's review). A key the operator now names activates
      // its pending account at sign-in, logged like any moderator action.
      if (registrationState === 'pending' && moderatorKey(proof.value)) {
        const activated = await store.moderate({
          action: 'activate_moderator_key',
          actorAthleteId: athlete.id,
          targetAthleteId: athlete.id,
          reportId: null,
          reason: 'Signed in with a device key the operator named as a moderator’s.',
          at: seconds(),
        });
        if (activated.outcome === 'applied') registrationState = 'active';
      }
      const session = await openSession(key);
      return {
        ok: true,
        value: {
          ...session,
          athleteId: athlete.id,
          displayName: athlete.displayName,
          registered: false,
          registrationState,
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
      // A suspension revokes every session as it happens (`sql-store.ts`
      // §`moderate`); this is the same rule read again, per request.
      const athlete = await store.getAthlete(session.athleteId);
      if (athlete === undefined || athlete.suspendedAt !== null) return undefined;
      if (athlete.registrationState !== 'active' && athlete.registrationState !== 'pending') {
        return undefined;
      }
      return {
        athleteId: session.athleteId,
        deviceKey: session.deviceKey,
        tokenSha256,
        standing: athlete.registrationState === 'pending' ? 'pending' : 'active',
      };
    },

    async signOut(caller) {
      await store.revokeSession(caller.athleteId, caller.tokenSha256, seconds());
    },

    async me(caller) {
      const athlete = await store.getAthlete(caller.athleteId);
      // The athlete's own name, even where a moderator hid it from others.
      return athlete === undefined
        ? refuse('not_found')
        : { ok: true, value: { athleteId: athlete.id, displayName: athlete.displayName } };
    },

    async account(caller) {
      const held = await account(caller.athleteId);
      return held === undefined ? refuse('not_found') : { ok: true, value: held };
    },

    async confirmAdult(caller, confirmed) {
      // Only `true`: a confirmation is a statement the rider makes, and there
      // is nothing to un-state — the first date is kept. No birth date is asked.
      if (confirmed !== true) return invalid('confirmed', 'must be true');
      await store.confirmAdult(caller.athleteId, seconds());
      const held = await account(caller.athleteId);
      return held === undefined ? refuse('not_found') : { ok: true, value: held };
    },

    async mintInvite(caller, reason) {
      if (typeof reason !== 'string' || reason.trim() === '') {
        return invalid('reason', 'must not be empty');
      }
      const inviteCode = readableCode();
      const at = seconds();
      const expiresAt = at + INVITE_LIFETIME_SECONDS;
      await store.mintInviteCode(
        {
          codeSha256: await sha256Hex(normalisedCode(inviteCode)),
          athleteId: caller.athleteId,
          expiresAt,
        },
        { reason: reason.trim(), at },
      );
      return { ok: true, value: { inviteCode, expiresAt } };
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
      const at = seconds();
      const recent = (await store.listDisplayNameChanges(caller.athleteId)).filter(
        (change) => change.changedAt > at - limits.renameWindowSeconds,
      );
      if (recent.length >= limits.renamesPerWindow) return refuse('rate_limited');
      if (!(await store.renameAthlete(caller.athleteId, checked.name, at)))
        return refuse('not_found');
      return { ok: true, value: { athleteId: caller.athleteId, displayName: checked.name } };
    },

    async ticket(caller, roomId, declaredMass) {
      if (typeof declaredMass !== 'number' || !declaredMassAdmissible(declaredMass)) {
        return invalid('declaredMassKilograms', 'must be a mass a room admits, in kilograms');
      }
      const room = await store.getRoom(roomId);
      if (room === undefined) return refuse('not_found');
      if (room.visibility === 'public') {
        const held = await account(caller.athleteId);
        if (held === undefined || !held.publicRooms.eligible) return refuse('not_eligible');
      }
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
      const keys = await store.listDeviceKeys(caller.athleteId);
      const target = keys.find((key) => key.publicKey === publicKey);
      if (target === undefined) return refuse('not_found');
      const live = keys.filter((key) => key.revokedAt === null);
      if (target.revokedAt === null && live.length === 1) {
        // The last key: refused unless the athlete shows they hold a code that
        // would let them back in. The code is checked, not spent.
        if (typeof recoveryCode !== 'string') return refuse('last_device');
        const hash = await sha256Hex(normalisedCode(recoveryCode));
        const held = (await store.listRecoveryCodes(caller.athleteId)).some(
          (code) => code.codeSha256 === hash && code.usedAt === null,
        );
        if (!held) return refuse('last_device');
      }
      await store.revokeDeviceKey(caller.athleteId, publicKey, seconds());
      return { ok: true, value: null };
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
      if (typeof address !== 'string' || !EMAIL.test(address.trim())) {
        return invalid('address', 'must be an email address');
      }
      const normalised = address.trim().toLowerCase();
      const clientAllowed = client === null || perAddress.allow(addressKey(client));
      if (!emailPerAddress.allow(normalised) || !clientAllowed) {
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
  };
}
