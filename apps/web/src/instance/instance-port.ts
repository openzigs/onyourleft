// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Connecting this app to an instance** (#777): what the Connect screen may
 * ask, and the one production implementation of it.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method on
 * a port interface (WIRE003) and every export of this file (WIRE002). The
 * production implementation, {@link createInstancePort}, is exported from HERE
 * rather than from a module beside it, so that `main.tsx` is the only
 * production code that names it — and deleting that wiring is a red
 * `check:wiring`, not a screen that quietly says "not available".
 *
 * ## What the device keeps, and where — ADR 0020 D-2's question
 *
 * ADR 0020 D-2 put the unit preference on the ATHLETE row because it belongs
 * to the rider, travels with the account export and survives an erase and a
 * re-import. The same question asked of an instance connection gets the other
 * answer:
 *
 * - **The session token is a credential of THIS device's key** (#772: each
 *   device signs in with its own key, and a second device has its own
 *   session). On the athlete row it would travel in the account export (#35)
 *   and be restored onto another device — a leaked credential and a wrong
 *   one.
 * - **The address goes with the token**, because a token means nothing
 *   without the instance that issued it, and because a rider's other device
 *   connects by signing in with its own key, not by inheriting this one's.
 *
 * So both are kept in this device's `localStorage`, under
 * `sign-in.ts` §`INSTANCE_ACCOUNT_STORAGE_KEY` (the address and the instance's
 * athlete id) and {@link INSTANCE_SESSION_STORAGE_KEY} (the token, beside the
 * origin that issued it), and
 * **disconnecting removes both** — and the picture agreements
 * ({@link INSTANCE_AGREEMENT_STORAGE_KEYS}, #1106) — and nothing else: no ride, route or other
 * local row is touched, which `instance-port.test.ts` counts.
 *
 * ## What is shown comes from the instance
 *
 * {@link InstancePort.current} reads the athlete's display name
 * (`GET /v1/auth/session`, sealed since #1210), the instance's name
 * (`GET /instance`) and where its source is (`GET /source`, ADR 0036 D-6)
 * from the instance every time, never from what the form was given — so what
 * the screen says after a reload is what the instance says.
 */

import {
  checkDisplayName,
  NO_KEY_TRUST,
  parseInstanceCard,
  type HpkePrimitives,
  type SealedInstanceKey,
  type Sha256,
  type SignatureVerifier,
  type SigningKey,
} from '@onyourleft/domain';
import { webCryptoHpkePrimitives, webCryptoSha256, webCryptoVerifier } from '@onyourleft/store';

import type { AccountChangeEntry } from './account-change-notices';
import { ADDRESS_REFUSAL_TEXT, instanceAddress } from './address';
import {
  createInstanceClock,
  instanceHttp,
  InstanceUnreachableError,
  sealedInstance,
  type InstanceClock,
  type InstanceHttp,
  type InstanceSend,
  type SealedInstance,
} from './instance-transport';
import {
  cardFromPin,
  cardRefusalText,
  checkCard,
  codeWithCard,
  INSTANCE_KEY_TEXT,
  judgeWithReread,
  olderKeyText,
  readCodeWithCard,
  sealedBuildOffered,
  sealedKeyOf,
  sealedRouteGate,
  WEB_BUILD_TEXT,
  type LoadedFrom,
  type PinCrypto,
  type ServedKeysReader,
} from './instance-pin';
import {
  INSTANCE_ACCOUNT_STORAGE_KEY,
  InstanceSignInError,
  linkThisDevice,
  PIN_DIFFERS,
  readInstanceAccount,
  signInToInstance,
  writeInstanceAccount,
  type InstanceAccount,
  type InstanceTransport,
  type SignInDependencies,
} from './sign-in';

/**
 * Where this device keeps its session token for the instance it is connected
 * to — as `{ origin, token }`, never the token alone.
 *
 * ⚠️ **The token carries the origin that issued it** (#892's review). The
 * address and the token are two writes — `sign-in.ts` writes the account, then
 * `connect` writes the token — so a second write that failed (a full store's
 * `QuotaExceededError`) used to leave a NEW address beside an OLD token, and
 * {@link InstancePort.current} would have sent one instance's bearer token to
 * another. A token is used only for the origin it was issued by
 * ({@link sessionTokenFor}); any other pairing is no sign-in at all.
 */
export const INSTANCE_SESSION_STORAGE_KEY = 'oyl.instance.session.v1';

/** The token this device holds for `origin`, or `undefined` — never another origin's. */
function sessionTokenFor(storage: InstanceStorage, origin: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(INSTANCE_SESSION_STORAGE_KEY) ?? 'null');
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  return record.origin === origin && typeof record.token === 'string' && record.token !== ''
    ? record.token
    : undefined;
}

/** One of this athlete's device keys on the instance (#773). */
export interface InstanceDevice {
  readonly publicKey: string;
  /** Unix seconds. */
  readonly addedAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
  readonly thisDevice: boolean;
}

/** What the app knows about its instance, read from the instance. */
export type InstanceState =
  | { readonly kind: 'not-connected' }
  | {
      readonly kind: 'connected';
      readonly origin: string;
      /** The operator's name for the instance, or `null` when it has none. */
      readonly instanceName: string | null;
      /** The athlete's display name, as the instance holds it. */
      readonly displayName: string;
      /** Where the running instance's source is (AGPL-3.0 §13), or `null`. */
      readonly sourceUrl: string | null;
      /**
       * The date the instance's terms of service in force took effect (#909),
       * or `null` when it publishes none.
       */
      readonly termsVersion: string | null;
      /**
       * Those terms are not the ones this device last marked read for this
       * instance (#909, DSA Art. 14(2)): the Instance screen says they changed
       * until {@link InstancePort.markTermsRead} is told.
       */
      readonly termsUnread: boolean;
    }
  /** The instance no longer accepts this device's session. */
  | { readonly kind: 'signed-out'; readonly origin: string }
  /**
   * This device holds a sign-in it cannot read now (#1210, ADR 0047 D-7 phase
   * 2): the session is a sealed-only route on an instance that holds keys, and
   * this device has no card for it, is a copy a website served (D-11), or its
   * keys were refused or a new card is awaited. `text` says which; the card
   * the rider gives on this screen is what opens it again.
   */
  | { readonly kind: 'unreadable'; readonly origin: string; readonly text: string }
  /** Nothing answered, or not as an instance does. */
  | { readonly kind: 'unreachable'; readonly origin: string };

export type ConnectOutcome =
  | {
      readonly kind: 'connected';
      /** Only when this sign-in registered the athlete: shown once, then never again. */
      readonly recoveryCodes?: readonly string[];
    }
  | { readonly kind: 'refused'; readonly text: string };

/** What this device makes of its instance's keys now (#1190, ADR 0047 D-5, D-6). */
export type KeysOutcome =
  /** Signed in with only an address: no pin, so no sealed route (D-14 Q1). */
  | { readonly kind: 'no-card'; readonly text: string }
  /** The pinned key endorsed a new one: no sealed route until a card carrying `expected` (D-14 Q8). */
  | {
      readonly kind: 'needs-new-card';
      readonly text: string;
      readonly pinned: string;
      readonly expected: string;
    }
  /** The keys verify under the pin, and this is the key a sealed request would go to. */
  | { readonly kind: 'trusted'; readonly pinned: string; readonly serial: number }
  /** Refused, loudly, with the pin unchanged: a mismatch, an expired key, an older key. */
  | { readonly kind: 'refused'; readonly text: string; readonly pinned: string };

/** What happens to a card the rider offers on a device already signed in (#1190, D-6). */
export type CardOutcome =
  /** Kept: this device had no pin, and the instance's keys verify under the card. */
  | { readonly kind: 'pinned' }
  /** It differs from the pin: shown with both fingerprints, kept only on {@link InstancePort.confirmCard}. */
  | {
      readonly kind: 'confirm';
      readonly text: string;
      readonly pinned: string;
      readonly offered: string;
    }
  | { readonly kind: 'refused'; readonly text: string };

/** A link code for another device, with THIS device's card beside it (#773, D-6 source 2). */
export type LinkCodeOutcome =
  | {
      readonly kind: 'shown';
      /** The code and the card as one line: what the QR code carries. */
      readonly offer: string;
      /** The card, composed from this device's own pin. */
      readonly card: string;
      readonly linkCode: string;
      /** Unix seconds. */
      readonly expiresAt: number;
    }
  | { readonly kind: 'unavailable'; readonly text: string };

export type DevicesOutcome =
  | { readonly kind: 'listed'; readonly devices: readonly InstanceDevice[] }
  | { readonly kind: 'unavailable'; readonly text: string };

/**
 * This athlete's account-change log, as this device reads it (#1208, ADR 0047
 * D-8): every entry, and the notices — the entries another key made since
 * THIS device last acknowledged.
 */
export type AccountChangesOutcome =
  | {
      readonly kind: 'read';
      readonly changes: readonly AccountChangeEntry[];
      readonly notices: readonly AccountChangeEntry[];
      readonly acknowledgedThrough: number;
    }
  | { readonly kind: 'unavailable'; readonly text: string };

/** This device's mark, moved (#1208) — or why it was not. */
export type AcknowledgeOutcome =
  | { readonly kind: 'acknowledged'; readonly acknowledgedThrough: number }
  | { readonly kind: 'unavailable'; readonly text: string };

/** A key revoked (#1208) — or why it was not. */
export type RevokeOutcome =
  { readonly kind: 'revoked' } | { readonly kind: 'unavailable'; readonly text: string };

/**
 * The display name changed (#906 item 2), as the instance answered it — or
 * why it was not. The screen shows the name it reads back from
 * {@link InstancePort.current}, not this one.
 */
export type RenameOutcome =
  | { readonly kind: 'renamed'; readonly displayName: string }
  | { readonly kind: 'refused'; readonly text: string };

/** What the Connect screen may ask of an instance. */
export interface InstancePort {
  /** The connection this device holds, read back from the instance. */
  current(): Promise<InstanceState>;
  /**
   * Sign this device in to the instance at `address`, registering it there if
   * the instance has never seen its key. `displayName` is sent on every call
   * where it is not blank, and the instance KEEPS it only when this sign-in
   * registers the key — the instance cannot be asked whether it knows a key
   * before it is sent one, so the app cannot send the name only then (#892's
   * review). The policy and the screen say exactly this. An address
   * {@link instanceAddress} refuses sends nothing.
   */
  connect(address: string, displayName: string, card?: string): Promise<ConnectOutcome>;
  /**
   * Add THIS device to the athlete whose other device shows `offer` — a link
   * code and that device's card, one line (#773, #1190). The card is checked
   * against the instance's keys BEFORE anything is sent, and pinned.
   */
  link(offer: string): Promise<ConnectOutcome>;
  /** What this device makes of the instance's keys, judged against its pin (#1190). */
  keys(): Promise<KeysOutcome>;
  /** Offer a card on a device already signed in: pinned if it had none, else asked to confirm. */
  offerCard(card: string): Promise<CardOutcome>;
  /** The rider confirmed a card that differs from the pin: check it again, and replace the pin. */
  confirmCard(card: string): Promise<CardOutcome>;
  /** A link code for another device, shown with this device's card (#773, D-6). */
  linkCode(): Promise<LinkCodeOutcome>;
  /** This athlete's devices on the instance (#773). */
  devices(): Promise<DevicesOutcome>;
  /**
   * This athlete's account-change log and this device's notices (#1208),
   * sealed only: a copy of the app a website served sends nothing (D-11).
   */
  accountChanges(): Promise<AccountChangesOutcome>;
  /**
   * Mark the log seen through entry `through` — for THIS device only: the
   * instance moves the mark of the session's key and of no other (#1193).
   * Sealed only.
   */
  acknowledgeAccountChanges(through: number): Promise<AcknowledgeOutcome>;
  /**
   * Revoke one of this athlete's device keys (#773, #1208): its sessions end
   * and the link codes it made are void. Sealed only; never the last key,
   * which needs a recovery code this screen does not ask for.
   */
  revokeDevice(publicKey: string): Promise<RevokeOutcome>;
  /**
   * Change the name other riders see on the instance (#906 item 2): sealed,
   * `POST /v1/auth/display-name`. The instance keeps each earlier name, with
   * when it changed, for moderation; the screen says so beside the press. A
   * name `checkDisplayName` refuses is sent nowhere.
   */
  rename(displayName: string): Promise<RenameOutcome>;
  /**
   * The rider read the instance's terms of service in force since `version`
   * (#909): kept on this device for this instance, so the screen stops saying
   * they changed until the instance names another date.
   */
  markTermsRead(version: string): void;
  /**
   * Forget the instance on this device — the session token and the address —
   * and ask the instance to end the session. Touches nothing else.
   */
  disconnect(): Promise<void>;
}

/** What `localStorage` has to offer this module. */
export interface InstanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * What a sealed call needs of this device (#1192, ADR 0047 D-8, D-9, D-11):
 * the sign-in it holds, where this copy of the app was loaded from, and the
 * key that signs. Shared by the instance port and the moderation port.
 */
export interface SealingDependencies {
  readonly storage: InstanceStorage;
  /** Where this copy of the app was loaded from: a website's copy seals nothing (D-11). */
  readonly loadedFrom: LoadedFrom;
  /** `ensureDeviceSigningKey`, bound: the session's key, which signs every sealed request. */
  readonly signingKey: () => Promise<SigningKey>;
  /** Injected so a test needs no network. Defaults to the platform's `fetch`. */
  readonly send?: InstanceSend | undefined;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /** SHA-256 and Ed25519 verification for the pin (#1190). WebCrypto's unless a test says otherwise. */
  readonly sha256?: Sha256;
  readonly verifier?: SignatureVerifier;
  /** HPKE's primitives (#1191). WebCrypto's unless a test says otherwise. */
  readonly primitives?: HpkePrimitives<unknown>;
  /** The offset to each instance's clock (#1191, D-9): one per port unless a test hands its own. */
  readonly clock?: InstanceClock;
}

export interface InstancePortDependencies extends SealingDependencies {
  /** `ensureLocalAthlete`, bound: the athlete row exists before a key is asked for. */
  readonly ensureLocalAthlete: () => Promise<unknown>;
}

/**
 * What the rider is told when signing in did not work.
 *
 * ⚠️ **Draft wording awaiting the owner's approval** (#880).
 */
export const CONNECT_REFUSAL_TEXT = {
  'no-answer':
    'Nothing answered at that address. Check it, and check that the instance is running.',
  'not-an-instance': 'No On Your Left instance answered at that address.',
  unavailable: 'That instance is not taking sign-ins yet.',
  registration_closed: 'That instance is not taking new riders.',
  key_revoked:
    'This device was removed from your account on that instance. Add it again from another of ' +
    'your devices.',
  wrong_instance:
    'The instance answers to a different address. Type its address exactly as its operator ' +
    'gives it.',
  'bad-name':
    'A name other riders see must be 1 to 32 characters, with no control or invisible ' +
    'characters.',
  other: 'The instance refused to sign this device in.',
  /**
   * #1192, #1210 (ADR 0047 D-7, D-14 Q1): an instance holding keys signs in
   * and registers ONLY sealed, and this device had no card to seal with — so
   * since phase 2 it cannot sign in there at all. ⚠️ Draft wording for the
   * owner to approve in #1210's pull request (D-14 Q6).
   */
  sealed_required:
    'This instance signs riders in only with its card. Paste the card its operator gave you ' +
    'below, and connect again.',
  'bad-offer':
    'That is not a code from another device. It starts oyl-instance: and ends with a code like ' +
    'abcd-efgh-jkmn-pqrs; paste the whole line.',
  /**
   * #1207 (ADR 0047 D-6): the card carries a different key from the one this
   * device holds for the instance, and only the confirm-new-card step replaces
   * a pin. ⚠️ Draft wording for the owner to approve (D-14 Q6).
   */
  pin_differs:
    'That card has a different key from the one this device already has for this instance. ' +
    'Nothing was sent. If its operator told you the key changed, give the new card on the ' +
    'Instance screen and confirm it there.',
} as const;

/** What the link-code screen says when no code can be shown. Draft wording (#880). */
export const LINK_CODE_UNAVAILABLE_TEXT = {
  'signed-out':
    'The instance no longer accepts this device’s sign-in. Disconnect and connect again.',
  'no-answer': 'The instance did not answer, so no code could be made.',
} as const;

/** What the rider is told when the device list cannot be read. */
export const DEVICES_UNAVAILABLE_TEXT = {
  'signed-out':
    'The instance no longer accepts this device’s sign-in. Disconnect and connect again.',
  'no-answer': 'The instance did not answer, so its list of your devices cannot be shown.',
} as const;

/**
 * What the rider is told when the account-change log cannot be read or
 * marked, or a key cannot be revoked (#1208). ⚠️ Draft wording for the
 * owner's approval (ADR 0047 D-14 Q6).
 */
export const ACCOUNT_CHANGES_UNAVAILABLE_TEXT = {
  'signed-out': DEVICES_UNAVAILABLE_TEXT['signed-out'],
  'no-answer': 'The instance did not answer, so the changes made to your account cannot be shown.',
  'not-acknowledged': 'The instance did not answer, so these notices are still shown. Try again.',
  'last-device':
    'That is the last key on your account, so this screen cannot revoke it: it needs one of your recovery codes.',
  'not-revoked': 'The instance did not answer, so that key is not revoked. Try again.',
} as const;

/**
 * What the rider is told when their name on the instance was not changed
 * (#906 item 2). ⚠️ Draft wording for the owner's approval.
 */
export const RENAME_REFUSAL_TEXT = {
  'signed-out': DEVICES_UNAVAILABLE_TEXT['signed-out'],
  'bad-name': CONNECT_REFUSAL_TEXT['bad-name'],
  rate_limited:
    'Your name there has been changed too many times lately, so it is not changed. Try again tomorrow.',
  'no-answer': 'The instance did not answer, so your name there is not changed. Try again.',
} as const;

/** The longest recovery address this app will show: RFC 5321's 254. */
const MAXIMUM_SHOWN_ADDRESS = 254;

/** The longest instance name this app will show. `apps/instance` enforces the same. */
export const MAXIMUM_SHOWN_INSTANCE_NAME = 64;

const UNSHOWABLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u;

/** A name an instance sent, if it is one a rider's screen may be handed. */
function showable(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name === '' || [...name].length > maximum || UNSHOWABLE.test(name)) return null;
  return name;
}

/** An `https:` URL, or `null` — never a `javascript:` or any other scheme in an `href`. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function refusalFor(error: unknown, sealedRequired?: string): string {
  if (error instanceof InstanceUnreachableError) return CONNECT_REFUSAL_TEXT['no-answer'];
  if (error instanceof InstanceSignInError) {
    switch (error.code) {
      case 'sealed_required':
        return sealedRequired ?? CONNECT_REFUSAL_TEXT.sealed_required;
      case 'not_found':
      case 'method_not_allowed':
      case 'unknown':
        return CONNECT_REFUSAL_TEXT['not-an-instance'];
      case 'unavailable':
      case 'registration_closed':
      case 'key_revoked':
      case 'wrong_instance':
        return CONNECT_REFUSAL_TEXT[error.code];
      case 'validation_failed':
        return CONNECT_REFUSAL_TEXT['bad-name'];
      case PIN_DIFFERS:
        return CONNECT_REFUSAL_TEXT.pin_differs;
      default:
        return CONNECT_REFUSAL_TEXT.other;
    }
  }
  return CONNECT_REFUSAL_TEXT.other;
}

function deviceFrom(value: unknown): InstanceDevice | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const time = (field: unknown): number | null | undefined =>
    field === null ? null : typeof field === 'number' && Number.isFinite(field) ? field : undefined;
  const addedAt = time(row.addedAt);
  const lastUsedAt = time(row.lastUsedAt);
  const revokedAt = time(row.revokedAt);
  if (
    typeof row.publicKey !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.publicKey) ||
    typeof addedAt !== 'number' ||
    lastUsedAt === undefined ||
    revokedAt === undefined ||
    typeof row.thisDevice !== 'boolean'
  ) {
    return undefined;
  }
  return { publicKey: row.publicKey, addedAt, lastUsedAt, revokedAt, thisDevice: row.thisDevice };
}

const ACCOUNT_CHANGE_KINDS: readonly AccountChangeEntry['kind'][] = [
  'codes_replaced',
  'address_added',
  'address_cleared',
  'link_code_minted',
  'key_added',
  'key_revoked',
];
const ACCOUNT_CHANGE_VIA: readonly NonNullable<AccountChangeEntry['via']>[] = [
  'link_code',
  'recovery_code',
  'email_token',
];
const DEVICE_KEY = /^[0-9a-f]{64}$/;

/**
 * One entry of the log as the instance answered it, or `undefined` for one
 * this app will not read. An address that is not one a screen may be handed
 * is read as none: the notice then says the app was not told it.
 */
function accountChangeFrom(value: unknown): AccountChangeEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const whole = (field: unknown): field is number =>
    typeof field === 'number' && Number.isSafeInteger(field) && field >= 0;
  const key = (field: unknown): field is string =>
    typeof field === 'string' && DEVICE_KEY.test(field);
  const kind = ACCOUNT_CHANGE_KINDS.find((each) => each === row.kind);
  const via = row.via === null ? null : ACCOUNT_CHANGE_VIA.find((each) => each === row.via);
  if (
    !whole(row.id) ||
    !whole(row.at) ||
    kind === undefined ||
    via === undefined ||
    !key(row.actorKey) ||
    !(row.subjectKey === null || key(row.subjectKey)) ||
    !(row.subjectAddedAt === null || whole(row.subjectAddedAt)) ||
    !(row.address === null || typeof row.address === 'string')
  ) {
    return undefined;
  }
  return {
    id: row.id,
    at: row.at,
    kind,
    actorKey: row.actorKey,
    subjectKey: row.subjectKey,
    subjectAddedAt: row.subjectAddedAt,
    via,
    address: showable(row.address, MAXIMUM_SHOWN_ADDRESS),
  };
}

/** Every entry of a list the instance answered, or `undefined` if any is not one. */
export function accountChangesFrom(value: unknown): AccountChangeEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(accountChangeFrom);
  return entries.some((entry) => entry === undefined)
    ? undefined
    : (entries as AccountChangeEntry[]);
}

/**
 * What *Erase this device* forgets of the instance (#35, #777): the session
 * token and the address, and nothing else — and it sends nothing. An erase
 * mints this device a new key (ADR 0014 D-7), so a token for the old one
 * would be a sign-in as somebody this device no longer is. What the instance
 * holds is the instance's, and `transfer/erase-device.ts`
 * §`ERASE_CANNOT_REACH` says so before the rider presses anything.
 */
export function instanceEraser(storage: Pick<InstanceStorage, 'removeItem'> | undefined): {
  forget(): void;
} {
  return {
    forget: () => {
      storage?.removeItem(INSTANCE_SESSION_STORAGE_KEY);
      storage?.removeItem(INSTANCE_ACCOUNT_STORAGE_KEY);
      // #1106: what the rider agreed to send THIS instance names its address, so it goes too.
      for (const key of INSTANCE_AGREEMENT_STORAGE_KEYS) storage?.removeItem(key);
    },
  };
}

/**
 * The device's keys for what a rider agreed to have sent to ONE instance,
 * each holding that instance's address or a service's (#1106): the side
 * camera's switch, and under it the hosted service agreed to by name. Their
 * reader and writer is `camera/instance-pose.ts`; they are named here because
 * they hold an instance's address, which {@link instanceEraser} must forget
 * with the sign-in, and no module in this directory may import that one.
 */
export const INSTANCE_AGREEMENT_STORAGE_KEYS = [
  'oyl.side-analyser-instance.v1',
  'oyl.side-analyser-instance-hosted.v1',
  // #1251: which service a hosted write-up may be offered for on this instance
  // (`ride-analysis/hosted-settings.ts` §`HOSTED_OFFER_STORAGE_KEY`, its reader and writer).
  'oyl.instance-hosted-offer.v1',
  // #909: the terms of service this device last marked read, with the
  // instance's address ({@link TERMS_READ_STORAGE_KEY}).
  'oyl.instance-terms-read.v1',
] as const;

/** Where the terms this device last marked read are kept (#909): `{ origin, version }`. */
export const TERMS_READ_STORAGE_KEY = INSTANCE_AGREEMENT_STORAGE_KEYS[3];

/** A terms version as an instance names one: a date. */
const TERMS_VERSION = /^\d{4}-\d{2}-\d{2}$/;

/** The terms version this device last marked read for `origin`, or `undefined`. */
function termsReadFor(storage: InstanceStorage, origin: string): string | undefined {
  try {
    const held = JSON.parse(storage.getItem(TERMS_READ_STORAGE_KEY) ?? 'null') as {
      origin?: unknown;
      version?: unknown;
    } | null;
    return held?.origin === origin && typeof held.version === 'string' ? held.version : undefined;
  } catch {
    return undefined;
  }
}

/** The instance this device is signed in to, and the token it holds for it. */
export interface HeldInstanceSession {
  readonly http: InstanceHttp;
  readonly token: string;
}

/**
 * The instance and the token this device holds, or `undefined` for neither —
 * read from THIS device's storage every time, so a disconnect is seen at once.
 * The one reader of the pair: {@link createInstancePort} asks it, and so does a
 * room's port (`net/room-port.ts`, #782) when it mints a ticket.
 */
export function heldInstanceSession(
  storage: InstanceStorage,
  send?: InstanceSend,
): HeldInstanceSession | undefined {
  const account = readInstanceAccount(storage);
  const token = account === undefined ? undefined : sessionTokenFor(storage, account.origin);
  if (account === undefined || token === undefined) return undefined;
  try {
    return { http: instanceHttp(account.origin, send), token };
  } catch {
    // An address stored by an older build that this one refuses: nothing is sent to it.
    return undefined;
  }
}

/** A sealed call as {@link InstanceTransport}: POST, sealed, the inner answer opened. */
function sealedTransport(sealed: SealedInstance): InstanceTransport {
  return { post: async (path, body) => sealed.call('POST', path, { body }) };
}

/** What a device makes of its instance's keys, and the key to seal to when it trusts them. */
interface Judged {
  readonly outcome: KeysOutcome;
  readonly instanceKey?: SealedInstanceKey;
}

/**
 * Judge `account`'s instance's served keys under its pin (#1190), remember
 * what the judgement says to (the pin itself never moves here), and say what
 * a sealed call may seal to (#1192).
 */
async function judgeAccount(
  storage: InstanceStorage,
  account: InstanceAccount | undefined,
  dependencies: Pick<SealingDependencies, 'send'>,
  crypto: PinCrypto,
): Promise<Judged> {
  if (account?.pin === undefined) {
    return { outcome: { kind: 'no-card', text: INSTANCE_KEY_TEXT['needs-card'] } };
  }
  const pinned = account.pin;
  if (account.expectedFingerprint !== undefined) {
    return {
      outcome: {
        kind: 'needs-new-card',
        text: INSTANCE_KEY_TEXT['needs-new-card'],
        pinned,
        expected: account.expectedFingerprint,
      },
    };
  }
  let http: InstanceHttp;
  try {
    http = instanceHttp(account.origin, dependencies.send);
  } catch {
    return { outcome: { kind: 'refused', text: INSTANCE_KEY_TEXT.unreachable, pinned } };
  }
  const verdict = await judgeWithReread(
    servedKeysAt(http),
    account.origin,
    pinned,
    account.keyTrust ?? NO_KEY_TRUST,
    crypto,
  );
  if (verdict === 'unreachable') {
    return { outcome: { kind: 'refused', text: INSTANCE_KEY_TEXT.unreachable, pinned } };
  }
  // The verdict was judged against `pinned`: if the rider replaced the pin, or
  // another read found an endorsement, while the request was in flight, it says
  // nothing about what is held now, so nothing is written and nothing sealed
  // (#1207).
  const held = readInstanceAccount(storage);
  if (
    held?.origin !== account.origin ||
    held.pin !== pinned ||
    held.expectedFingerprint !== undefined
  ) {
    return { outcome: { kind: 'refused', text: INSTANCE_KEY_TEXT.unreachable, pinned } };
  }
  switch (verdict.kind) {
    case 'mismatch':
      return { outcome: { kind: 'refused', text: INSTANCE_KEY_TEXT.mismatch, pinned } };
    case 'new-card':
      writeInstanceAccount(storage, { ...held, expectedFingerprint: verdict.fingerprint });
      return {
        outcome: {
          kind: 'needs-new-card',
          text: INSTANCE_KEY_TEXT['needs-new-card'],
          pinned,
          expected: verdict.fingerprint,
        },
      };
    case 'older':
      writeInstanceAccount(storage, { ...held, keyTrust: verdict.trust });
      return {
        outcome: { kind: 'refused', text: olderKeyText(verdict.highestSerial), pinned },
      };
    case 'expired':
      writeInstanceAccount(storage, { ...held, keyTrust: verdict.trust });
      return { outcome: { kind: 'refused', text: INSTANCE_KEY_TEXT.expired, pinned } };
    case 'trusted':
      writeInstanceAccount(storage, { ...held, keyTrust: verdict.trust });
      return {
        outcome: { kind: 'trusted', pinned, serial: verdict.statement.serial },
        instanceKey: sealedKeyOf(verdict.statement),
      };
  }
}

/** The sign-in this device holds, sealed — or why a phase-1 feature is not offered now. */
export type HeldSealedSession =
  | {
      readonly kind: 'open';
      readonly sealed: SealedInstance;
      readonly token: string;
      readonly account: InstanceAccount;
    }
  | {
      readonly kind: 'closed';
      /** `signed-out`: no sign-in; `gate`: D-11 or no card (D-14 Q1, Q8); `keys`: the keys were refused. */
      readonly why: 'signed-out' | 'gate' | 'keys';
      readonly text: string;
    };

/** What {@link heldSealedSession} needs beyond the dependencies: the clock and the pin's crypto. */
interface SealingKit {
  readonly clock: InstanceClock;
  readonly crypto: PinCrypto;
}

function sealingKit(dependencies: SealingDependencies): SealingKit {
  return {
    clock: dependencies.clock ?? createInstanceClock(),
    crypto: {
      sha256: dependencies.sha256 ?? webCryptoSha256,
      verifier: dependencies.verifier ?? webCryptoVerifier,
      now: dependencies.now ?? (() => Date.now()),
    },
  };
}

/**
 * The instance this device is signed in to, as SEALED calls (#1192, ADR 0047
 * D-7, D-8, D-11): every phase-1 route goes through this and nothing else.
 * Closed — with the sentence to show — for a copy of the app loaded from a
 * website, a device with no card or waiting for a new one, and keys that do
 * not verify under the pin; nothing is sent then but the keys' read.
 */
async function sealedSessionOf(
  dependencies: SealingDependencies,
  kit: SealingKit,
): Promise<HeldSealedSession> {
  const account = readInstanceAccount(dependencies.storage);
  const held = heldInstanceSession(dependencies.storage, dependencies.send);
  if (account === undefined || held === undefined) {
    return { kind: 'closed', why: 'signed-out', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
  }
  const gate = sealedRouteGate(account, dependencies.loadedFrom);
  if (gate.kind !== 'open') return { kind: 'closed', why: 'gate', text: gate.text };
  const judged = await judgeAccount(dependencies.storage, account, dependencies, kit.crypto);
  if (judged.instanceKey === undefined) {
    const text = 'text' in judged.outcome ? judged.outcome.text : INSTANCE_KEY_TEXT.unreachable;
    return { kind: 'closed', why: 'keys', text };
  }
  return {
    kind: 'open',
    sealed: sealedInstance(
      account.origin,
      {
        instanceKey: judged.instanceKey,
        signingKey: await dependencies.signingKey(),
        primitives: dependencies.primitives ?? webCryptoHpkePrimitives,
        sha256: kit.crypto.sha256,
        clock: kit.clock,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      },
      dependencies.send,
    ),
    token: held.token,
    account,
  };
}

/**
 * {@link sealedSessionOf} for a port that is not the instance port — the
 * moderation port (#1192): one clock for the port's life.
 */
export function heldSealedSession(
  dependencies: SealingDependencies,
): () => Promise<HeldSealedSession> {
  const kit = sealingKit(dependencies);
  return () => sealedSessionOf(dependencies, kit);
}

/**
 * The sign-in this device holds, for a route ADR 0047 D-7 seals in phase 2
 * (#1210): the session, account, profile, block, report and room routes.
 *
 * - **A device that holds a pin** calls them SEALED, and only sealed: closed —
 *   with the sentence to show — for a copy a website served (D-11), a new card
 *   awaited (D-14 Q8) or keys refused, exactly as {@link heldSealedSession}.
 *   ⚠️ It never falls back to plaintext: whatever stands between the device
 *   and the instance could refuse the keys precisely to read the request.
 * - **A device that holds no pin** cannot seal (D-14 Q1: a device pins only
 *   from a card). It reads the instance's public keys first: an instance that
 *   serves them holds keys, so the session is closed — the card is needed —
 *   and NOTHING about the route is sent, not the room code a join would carry
 *   nor the token. One that serves none has no sealed routes (D-7), and the
 *   calls go in plaintext, as before phase 2. ⚠️ With no pin the device has
 *   nothing to judge the keys' answer by, so whatever stands in between could
 *   hide them; an instance holding keys still refuses a plaintext call
 *   `sealed_required` (`isSealedRequired`), and the caller says the card is
 *   needed.
 *
 * `sealedOrKeyless` is named so `sealed-routes.test.ts`'s scan reads it as a
 * sealed receiver: its one plaintext case is the device with no pin.
 */
export type HeldAccountSession =
  | {
      readonly kind: 'open';
      readonly sealedOrKeyless: Pick<InstanceHttp, 'origin' | 'call'>;
      readonly token: string;
      /** `true` when the calls are sealed; `false` for the device with no pin. */
      readonly sealed: boolean;
    }
  | {
      readonly kind: 'closed';
      readonly why: 'signed-out' | 'gate' | 'keys';
      readonly text: string;
    };

async function accountSessionOf(
  dependencies: SealingDependencies,
  kit: SealingKit,
): Promise<HeldAccountSession> {
  const account = readInstanceAccount(dependencies.storage);
  const held = heldInstanceSession(dependencies.storage, dependencies.send);
  if (account === undefined || held === undefined) {
    return { kind: 'closed', why: 'signed-out', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
  }
  if (account.pin === undefined) {
    if (servesKeys(await servedKeysAt(held.http)())) {
      const gate = sealedRouteGate(account, dependencies.loadedFrom);
      return {
        kind: 'closed',
        why: 'gate',
        text: gate.kind === 'open' ? INSTANCE_KEY_TEXT['needs-card'] : gate.text,
      };
    }
    return { kind: 'open', sealedOrKeyless: held.http, token: held.token, sealed: false };
  }
  const session = await sealedSessionOf(dependencies, kit);
  if (session.kind === 'closed') return session;
  return { kind: 'open', sealedOrKeyless: session.sealed, token: session.token, sealed: true };
}

/** {@link HeldAccountSession} for a port that is not the instance port: one clock for its life. */
export function heldAccountSession(
  dependencies: SealingDependencies,
): () => Promise<HeldAccountSession> {
  const kit = sealingKit(dependencies);
  return () => accountSessionOf(dependencies, kit);
}

/**
 * How this device reaches the instance it connected to WITHOUT a session
 * (#910, #1210): for `POST /v1/auth/leave-session`, which ADR 0047 D-7 seals
 * in phase 2 and which a suspended rider calls precisely because their
 * session is refused (`apps/instance` §`SESSIONLESS_PATHS`).
 *
 * - `sealed`: the device holds a pin and the keys verify under it — the call
 *   goes sealed and signed by this device's key, as signing in does.
 *   `instance` makes the calls the way-out session then reaches (#1382: the
 *   statements and their appeal), sealed with that session's token.
 * - `keyless`: the device holds no pin (D-14 Q1), so it cannot seal; the call
 *   goes in plaintext, as a sign-in from it does, and an instance holding
 *   keys refuses it `sealed_required`.
 * - `closed`: the device holds a pin but may not seal now — a copy a website
 *   served (D-11), a new card awaited, keys refused. ⚠️ Nothing is sent: a
 *   device with a pin never falls back to plaintext.
 */
export type SessionlessSealed =
  | {
      readonly kind: 'sealed';
      readonly sealed: InstanceTransport;
      readonly instance: SealedInstance;
    }
  | { readonly kind: 'keyless' }
  | { readonly kind: 'closed'; readonly text: string };

/** {@link SessionlessSealed} for a port that is not the instance port: one clock for its life. */
export function sessionlessSealed(
  dependencies: SealingDependencies,
): () => Promise<SessionlessSealed> {
  const kit = sealingKit(dependencies);
  return async () => {
    const account = readInstanceAccount(dependencies.storage);
    if (account === undefined) {
      return { kind: 'closed', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
    }
    if (account.pin === undefined) return { kind: 'keyless' };
    const gate = sealedRouteGate(account, dependencies.loadedFrom);
    if (gate.kind !== 'open') return { kind: 'closed', text: gate.text };
    const judged = await judgeAccount(dependencies.storage, account, dependencies, kit.crypto);
    if (judged.instanceKey === undefined) {
      const text = 'text' in judged.outcome ? judged.outcome.text : INSTANCE_KEY_TEXT.unreachable;
      return { kind: 'closed', text };
    }
    const instance = sealedInstance(
      account.origin,
      {
        instanceKey: judged.instanceKey,
        signingKey: await dependencies.signingKey(),
        primitives: dependencies.primitives ?? webCryptoHpkePrimitives,
        sha256: kit.crypto.sha256,
        clock: kit.clock,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      },
      dependencies.send,
    );
    return { kind: 'sealed', sealed: sealedTransport(instance), instance };
  };
}

/**
 * Whether an answer is an instance's `sealed_required` (#1210): a plaintext
 * call from a device with no pin, to an instance that holds keys.
 */
export function isSealedRequired(answer: { readonly status: number; readonly body: unknown }) {
  return (
    answer.status === 403 &&
    (answer.body as { error?: { code?: unknown } } | null)?.error?.code === 'sealed_required'
  );
}

/**
 * Whether `/v1/instance/keys` answered as an instance holding keys does: an
 * identity key. One with no operator secret answers `unavailable` (D-5).
 */
function servesKeys(body: unknown): boolean {
  return typeof (body as { identityKey?: unknown } | undefined)?.identityKey === 'string';
}

/** `GET /v1/instance/keys` at `http`: its body, or `undefined` when nothing usable answered. */
function servedKeysAt(http: InstanceHttp): ServedKeysReader {
  return async () => {
    try {
      const answer = await http.call('GET', '/v1/instance/keys');
      return answer.status === 200 ? answer.body : undefined;
    } catch {
      return undefined;
    }
  };
}

/**
 * {@link servedKeysAt} for a stored origin: an address this build refuses
 * (`instanceHttp` throws on one an older build stored) reads as no answer,
 * rather than throwing past the screen that asked (#1207).
 */
function servedKeysOf(origin: string, send: InstanceSend | undefined): ServedKeysReader {
  return async () => {
    let http: InstanceHttp;
    try {
      http = instanceHttp(origin, send);
    } catch {
      return undefined;
    }
    return servedKeysAt(http)();
  };
}

/**
 * The account and the token, copied out of `storage` into memory, so a
 * disconnect can forget them and still sign out with them (#1210).
 */
function rememberedSignIn(storage: InstanceStorage): InstanceStorage {
  const kept = new Map<string, string>();
  for (const key of [INSTANCE_ACCOUNT_STORAGE_KEY, INSTANCE_SESSION_STORAGE_KEY]) {
    const value = storage.getItem(key);
    if (value !== null) kept.set(key, value);
  }
  return {
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => void kept.set(key, value),
    removeItem: (key) => void kept.delete(key),
  };
}

/** The production {@link InstancePort}: `main.tsx` builds it, and nothing else in the client. */
export function createInstancePort(dependencies: InstancePortDependencies): InstancePort {
  const { storage } = dependencies;
  const kit = sealingKit(dependencies);
  const { crypto } = kit;

  /**
   * A sessionless sealed transport to `origin`, signed by this device's key
   * (#1192). The key is asked for at the first request, so after sign-in has
   * made sure the local athlete it belongs to exists.
   */
  const sealedFor = (origin: string, instanceKey: SealedInstanceKey): InstanceTransport => ({
    post: async (path, body) =>
      sealedTransport(
        sealedInstance(
          origin,
          {
            instanceKey,
            signingKey: await dependencies.signingKey(),
            primitives: dependencies.primitives ?? webCryptoHpkePrimitives,
            sha256: crypto.sha256,
            clock: kit.clock,
            ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
          },
          dependencies.send,
        ),
      ).post(path, body),
  });

  /** The terms an instance names, and whether this device has marked them read (#909). */
  const termsOf = (
    said: unknown,
    origin: string,
  ): { readonly termsVersion: string | null; readonly termsUnread: boolean } => {
    const termsVersion = typeof said === 'string' && TERMS_VERSION.test(said) ? said : null;
    return {
      termsVersion,
      termsUnread: termsVersion !== null && termsReadFor(storage, origin) !== termsVersion,
    };
  };

  /** What signing in to `origin` needs, over `http`. */
  const signIn = (origin: string, http: InstanceHttp): SignInDependencies => ({
    origin,
    transport: { post: async (path, body) => http.call('POST', path, { body }) },
    storage,
    ensureLocalAthlete: dependencies.ensureLocalAthlete,
    signingKey: dependencies.signingKey,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });

  /** The instance and the token this device holds, or `undefined` for neither. */
  const held = (): HeldInstanceSession | undefined =>
    heldInstanceSession(storage, dependencies.send);

  return {
    current: async () => {
      const connection = held();
      if (connection === undefined) return { kind: 'not-connected' };
      const { http } = connection;
      try {
        // #1210: who the session is, sealed — or in plaintext for a device
        // with no pin, which an instance holding keys refuses.
        const account = await accountSessionOf(dependencies, kit);
        if (account.kind === 'closed') {
          if (account.why === 'signed-out') return { kind: 'not-connected' };
          // The keys could not be read at all: nothing answered.
          if (account.text === INSTANCE_KEY_TEXT.unreachable) {
            return { kind: 'unreachable', origin: http.origin };
          }
          return { kind: 'unreadable', origin: http.origin, text: account.text };
        }
        const [session, instance, source] = await Promise.all([
          account.sealedOrKeyless.call('GET', '/v1/auth/session', { token: account.token }),
          http.call('GET', '/instance'),
          http.call('GET', '/source'),
        ]);
        if (session.status === 401) return { kind: 'signed-out', origin: http.origin };
        if (isSealedRequired(session)) {
          const gate = sealedRouteGate(readInstanceAccount(storage), dependencies.loadedFrom);
          return {
            kind: 'unreadable',
            origin: http.origin,
            text: gate.kind === 'open' ? INSTANCE_KEY_TEXT['needs-card'] : gate.text,
          };
        }
        const said = (session.body as { displayName?: unknown } | null)?.displayName;
        const displayName = checkDisplayName(typeof said === 'string' ? said : '');
        if (session.status !== 200 || !displayName.ok) {
          return { kind: 'unreachable', origin: http.origin };
        }
        return {
          kind: 'connected',
          origin: http.origin,
          instanceName:
            instance.status === 200
              ? showable(
                  (instance.body as { name?: unknown } | null)?.name,
                  MAXIMUM_SHOWN_INSTANCE_NAME,
                )
              : null,
          displayName: displayName.name,
          sourceUrl:
            source.status === 200 ? httpsUrl((source.body as { url?: unknown } | null)?.url) : null,
          ...termsOf(
            instance.status === 200
              ? (instance.body as { termsVersion?: unknown } | null)?.termsVersion
              : null,
            http.origin,
          ),
        };
      } catch {
        return { kind: 'unreachable', origin: http.origin };
      }
    },

    connect: async (address, displayName, card) => {
      const decision = instanceAddress(address);
      if (decision.kind === 'refused') {
        return { kind: 'refused', text: ADDRESS_REFUSAL_TEXT[decision.why] };
      }
      const cardText = card?.trim() ?? '';
      if (cardText !== '') {
        const parsed = parseInstanceCard(cardText, decision.origin);
        if (!parsed.ok) return { kind: 'refused', text: cardRefusalText(parsed.problem) };
      }
      const typedName = displayName.trim();
      let name: string | undefined;
      if (typedName !== '') {
        const checked = checkDisplayName(typedName);
        if (!checked.ok) return { kind: 'refused', text: CONNECT_REFUSAL_TEXT['bad-name'] };
        name = checked.name;
      }
      // What a `sealed_required` refusal means here (#1192): a copy of the app
      // that may not seal (D-11), or no card, or keys that would not seal.
      let sealedRequired = sealedBuildOffered(dependencies.loadedFrom)
        ? CONNECT_REFUSAL_TEXT.sealed_required
        : WEB_BUILD_TEXT;
      try {
        const http = instanceHttp(decision.origin, dependencies.send);
        // The card is checked BEFORE anything else is sent: a mismatch sends
        // nothing more and keeps nothing (D-6).
        let pin: SignInDependencies['pin'];
        let sealed: InstanceTransport | undefined;
        if (cardText !== '') {
          const checked = await checkCard(cardText, decision.origin, servedKeysAt(http), crypto);
          if (checked.kind === 'refused') return checked;
          pin = { fingerprint: checked.fingerprint, keyTrust: checked.keyTrust };
          if (checked.instanceKey === undefined) {
            sealedRequired = checked.sealingText ?? sealedRequired;
          } else if (sealedBuildOffered(dependencies.loadedFrom)) {
            sealed = sealedFor(decision.origin, checked.instanceKey);
          }
        }
        const signedIn = await signInToInstance(
          {
            ...signIn(decision.origin, http),
            ...(pin === undefined ? {} : { pin }),
            ...(sealed === undefined ? {} : { sealed }),
          },
          name === undefined ? {} : { displayName: name },
        );
        storage.setItem(
          INSTANCE_SESSION_STORAGE_KEY,
          JSON.stringify({ origin: decision.origin, token: signedIn.sessionToken }),
        );
        return {
          kind: 'connected',
          ...(signedIn.recoveryCodes === undefined
            ? {}
            : { recoveryCodes: signedIn.recoveryCodes }),
        };
      } catch (error) {
        return { kind: 'refused', text: refusalFor(error, sealedRequired) };
      }
    },

    link: async (offer) => {
      const read = readCodeWithCard(offer);
      if (read === undefined) return { kind: 'refused', text: CONNECT_REFUSAL_TEXT['bad-offer'] };
      const parsed = parseInstanceCard(read.card);
      if (!parsed.ok) return { kind: 'refused', text: cardRefusalText(parsed.problem) };
      const decision = instanceAddress(parsed.card.origin);
      if (decision.kind === 'refused') {
        return { kind: 'refused', text: ADDRESS_REFUSAL_TEXT[decision.why] };
      }
      if (decision.origin !== parsed.card.origin) {
        return { kind: 'refused', text: CONNECT_REFUSAL_TEXT['bad-offer'] };
      }
      // Linking is sealed-only (#1192): a copy of the app that may not seal sends nothing.
      if (!sealedBuildOffered(dependencies.loadedFrom)) {
        return { kind: 'refused', text: WEB_BUILD_TEXT };
      }
      try {
        const http = instanceHttp(decision.origin, dependencies.send);
        const checked = await checkCard(read.card, decision.origin, servedKeysAt(http), crypto);
        if (checked.kind === 'refused') return checked;
        if (checked.instanceKey === undefined) {
          return { kind: 'refused', text: checked.sealingText ?? INSTANCE_KEY_TEXT.unreachable };
        }
        const signedIn = await linkThisDevice(
          {
            ...signIn(decision.origin, http),
            pin: { fingerprint: checked.fingerprint, keyTrust: checked.keyTrust },
            sealed: sealedFor(decision.origin, checked.instanceKey),
          },
          read.code,
        );
        storage.setItem(
          INSTANCE_SESSION_STORAGE_KEY,
          JSON.stringify({ origin: decision.origin, token: signedIn.sessionToken }),
        );
        return { kind: 'connected' };
      } catch (error) {
        return { kind: 'refused', text: refusalFor(error) };
      }
    },

    keys: async () => {
      const account = readInstanceAccount(storage);
      if (account === undefined) {
        return { kind: 'no-card', text: INSTANCE_KEY_TEXT['needs-card'] };
      }
      return (await judgeAccount(storage, account, dependencies, crypto)).outcome;
    },

    offerCard: async (card) => {
      const account = readInstanceAccount(storage);
      if (account === undefined) {
        return { kind: 'refused', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
      }
      const parsed = parseInstanceCard(card, account.origin);
      if (!parsed.ok) return { kind: 'refused', text: cardRefusalText(parsed.problem) };
      const offered = parsed.card.fingerprintText;
      if (account.pin === offered && account.expectedFingerprint === undefined) {
        return { kind: 'pinned' };
      }
      if (account.expectedFingerprint !== undefined && offered !== account.expectedFingerprint) {
        return { kind: 'refused', text: INSTANCE_KEY_TEXT['not-the-endorsed-card'] };
      }
      const checked = await checkCard(
        card,
        account.origin,
        servedKeysOf(account.origin, dependencies.send),
        crypto,
        account.keyTrust ?? NO_KEY_TRUST,
      );
      if (checked.kind === 'refused') return checked;
      if (account.pin === undefined) {
        writeInstanceAccount(storage, {
          ...account,
          pin: checked.fingerprint,
          keyTrust: checked.keyTrust,
        });
        return { kind: 'pinned' };
      }
      // A card that differs from the pin is never kept here: the rider confirms it.
      return {
        kind: 'confirm',
        text: INSTANCE_KEY_TEXT['confirm-new-card'],
        pinned: account.pin,
        offered,
      };
    },

    confirmCard: async (card) => {
      const account = readInstanceAccount(storage);
      if (account === undefined) {
        return { kind: 'refused', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
      }
      const parsed = parseInstanceCard(card, account.origin);
      if (!parsed.ok) return { kind: 'refused', text: cardRefusalText(parsed.problem) };
      if (
        account.expectedFingerprint !== undefined &&
        parsed.card.fingerprintText !== account.expectedFingerprint
      ) {
        return { kind: 'refused', text: INSTANCE_KEY_TEXT['not-the-endorsed-card'] };
      }
      const checked = await checkCard(
        card,
        account.origin,
        servedKeysOf(account.origin, dependencies.send),
        crypto,
        account.keyTrust ?? NO_KEY_TRUST,
      );
      if (checked.kind === 'refused') return checked;
      writeInstanceAccount(storage, {
        origin: account.origin,
        instanceAthleteId: account.instanceAthleteId,
        pin: checked.fingerprint,
        keyTrust: checked.keyTrust,
      });
      return { kind: 'pinned' };
    },

    linkCode: async () => {
      const account = readInstanceAccount(storage);
      if (held() === undefined || account === undefined) {
        return { kind: 'unavailable', text: LINK_CODE_UNAVAILABLE_TEXT['signed-out'] };
      }
      // ⚠️ The card is composed HERE, from this device's own pin (D-6): never
      // from anything the instance answers below.
      const card = cardFromPin(account);
      if (card === undefined) {
        const gate = sealedRouteGate(account, dependencies.loadedFrom);
        return {
          kind: 'unavailable',
          text: gate.kind === 'open' ? INSTANCE_KEY_TEXT['needs-card'] : gate.text,
        };
      }
      try {
        // Sealed-only (#1192): the code crosses the edge only as ciphertext.
        const session = await sealedSessionOf(dependencies, kit);
        if (session.kind === 'closed') return { kind: 'unavailable', text: session.text };
        const answer = await session.sealed.call('POST', '/v1/auth/link-codes', {
          token: session.token,
          body: {},
        });
        if (answer.status === 401) {
          return { kind: 'unavailable', text: LINK_CODE_UNAVAILABLE_TEXT['signed-out'] };
        }
        const body = answer.body as { linkCode?: unknown; expiresAt?: unknown } | null;
        const linkCode = typeof body?.linkCode === 'string' ? body.linkCode.toLowerCase() : '';
        const expiresAt = body?.expiresAt;
        const offer = codeWithCard(card, linkCode);
        if (
          answer.status !== 200 ||
          readCodeWithCard(offer) === undefined ||
          typeof expiresAt !== 'number'
        ) {
          return { kind: 'unavailable', text: LINK_CODE_UNAVAILABLE_TEXT['no-answer'] };
        }
        return { kind: 'shown', offer, card, linkCode, expiresAt };
      } catch {
        return { kind: 'unavailable', text: LINK_CODE_UNAVAILABLE_TEXT['no-answer'] };
      }
    },

    devices: async () => {
      try {
        // Sealed-only (#1192): the list is read through the route D-9 names.
        const session = await sealedSessionOf(dependencies, kit);
        if (session.kind === 'closed') return { kind: 'unavailable', text: session.text };
        const answer = await session.sealed.call('GET', '/v1/auth/devices', {
          token: session.token,
        });
        if (answer.status === 401) {
          return { kind: 'unavailable', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
        }
        const rows = (answer.body as { devices?: unknown } | null)?.devices;
        if (answer.status !== 200 || !Array.isArray(rows)) {
          return { kind: 'unavailable', text: DEVICES_UNAVAILABLE_TEXT['no-answer'] };
        }
        const devices = rows.map(deviceFrom);
        if (devices.some((device) => device === undefined)) {
          return { kind: 'unavailable', text: DEVICES_UNAVAILABLE_TEXT['no-answer'] };
        }
        return { kind: 'listed', devices: devices as InstanceDevice[] };
      } catch {
        return { kind: 'unavailable', text: DEVICES_UNAVAILABLE_TEXT['no-answer'] };
      }
    },

    accountChanges: async () => {
      const unavailable = ACCOUNT_CHANGES_UNAVAILABLE_TEXT;
      try {
        // Sealed-only (#1193, #1208): a copy that may not seal sends nothing.
        const session = await sealedSessionOf(dependencies, kit);
        if (session.kind === 'closed') return { kind: 'unavailable', text: session.text };
        const answer = await session.sealed.call('GET', '/v1/auth/account-changes', {
          token: session.token,
        });
        if (answer.status === 401) return { kind: 'unavailable', text: unavailable['signed-out'] };
        const body = answer.body as Record<string, unknown> | null;
        const changes = accountChangesFrom(body?.changes);
        const notices = accountChangesFrom(body?.notices);
        const through = body?.acknowledgedThrough;
        if (
          answer.status !== 200 ||
          changes === undefined ||
          notices === undefined ||
          typeof through !== 'number' ||
          !Number.isSafeInteger(through)
        ) {
          return { kind: 'unavailable', text: unavailable['no-answer'] };
        }
        return { kind: 'read', changes, notices, acknowledgedThrough: through };
      } catch {
        return { kind: 'unavailable', text: unavailable['no-answer'] };
      }
    },

    acknowledgeAccountChanges: async (through) => {
      const unavailable = ACCOUNT_CHANGES_UNAVAILABLE_TEXT;
      if (!Number.isSafeInteger(through) || through < 0) {
        return { kind: 'unavailable', text: unavailable['not-acknowledged'] };
      }
      try {
        const session = await sealedSessionOf(dependencies, kit);
        if (session.kind === 'closed') return { kind: 'unavailable', text: session.text };
        // The instance moves the mark of the session's key, never one named here.
        const answer = await session.sealed.call('POST', '/v1/auth/account-changes/acknowledge', {
          token: session.token,
          body: { through },
        });
        if (answer.status === 401) return { kind: 'unavailable', text: unavailable['signed-out'] };
        const moved = (answer.body as { acknowledgedThrough?: unknown } | null)
          ?.acknowledgedThrough;
        if (answer.status !== 200 || typeof moved !== 'number' || !Number.isSafeInteger(moved)) {
          return { kind: 'unavailable', text: unavailable['not-acknowledged'] };
        }
        return { kind: 'acknowledged', acknowledgedThrough: moved };
      } catch {
        return { kind: 'unavailable', text: unavailable['not-acknowledged'] };
      }
    },

    revokeDevice: async (publicKey) => {
      const unavailable = ACCOUNT_CHANGES_UNAVAILABLE_TEXT;
      // ⚠️ The key is a path segment: anything but 64 hex characters is sent
      // nowhere, so no `..` or `?` can steer the call at another route.
      if (!DEVICE_KEY.test(publicKey))
        return { kind: 'unavailable', text: unavailable['not-revoked'] };
      try {
        const session = await sealedSessionOf(dependencies, kit);
        if (session.kind === 'closed') return { kind: 'unavailable', text: session.text };
        const answer = await session.sealed.call('POST', `/v1/auth/devices/${publicKey}/revoke`, {
          token: session.token,
          body: {},
        });
        if (answer.status === 204) return { kind: 'revoked' };
        if (answer.status === 401) return { kind: 'unavailable', text: unavailable['signed-out'] };
        const code = (answer.body as { error?: { code?: unknown } } | null)?.error?.code;
        return {
          kind: 'unavailable',
          text: code === 'last_device' ? unavailable['last-device'] : unavailable['not-revoked'],
        };
      } catch {
        return { kind: 'unavailable', text: unavailable['not-revoked'] };
      }
    },

    rename: async (displayName) => {
      // The instance's own rule, checked first: a name it would refuse is sent nowhere.
      const checked = checkDisplayName(displayName);
      if (!checked.ok) return { kind: 'refused', text: RENAME_REFUSAL_TEXT['bad-name'] };
      try {
        // Sealed-only (#1210): the name crosses the edge only as ciphertext.
        const session = await sealedSessionOf(dependencies, kit);
        if (session.kind === 'closed') return { kind: 'refused', text: session.text };
        const answer = await session.sealed.call('POST', '/v1/auth/display-name', {
          token: session.token,
          body: { displayName: checked.name },
        });
        if (answer.status === 401) {
          return { kind: 'refused', text: RENAME_REFUSAL_TEXT['signed-out'] };
        }
        const code = (answer.body as { error?: { code?: unknown } } | null)?.error?.code;
        if (code === 'rate_limited') {
          return { kind: 'refused', text: RENAME_REFUSAL_TEXT.rate_limited };
        }
        if (code === 'validation_failed') {
          return { kind: 'refused', text: RENAME_REFUSAL_TEXT['bad-name'] };
        }
        if (answer.status !== 200) {
          return { kind: 'refused', text: RENAME_REFUSAL_TEXT['no-answer'] };
        }
        // A 200 means the instance committed the rename: never tell the rider it
        // was not changed because the echoed name fails this app's rule (version
        // skew). The screen shows what the read-back says, not this value.
        const said = (answer.body as { displayName?: unknown } | null)?.displayName;
        const kept = checkDisplayName(typeof said === 'string' ? said : '');
        return { kind: 'renamed', displayName: kept.ok ? kept.name : checked.name };
      } catch {
        return { kind: 'refused', text: RENAME_REFUSAL_TEXT['no-answer'] };
      }
    },

    markTermsRead: (version) => {
      const origin = readInstanceAccount(storage)?.origin;
      if (origin === undefined || !TERMS_VERSION.test(version)) return;
      storage.setItem(TERMS_READ_STORAGE_KEY, JSON.stringify({ origin, version }));
    },

    disconnect: async () => {
      // What signing out needs, kept in memory: the device forgets first, so a
      // disconnect is complete here whatever the instance does — and whether
      // or not it answers at all.
      const remembered = rememberedSignIn(storage);
      storage.removeItem(INSTANCE_SESSION_STORAGE_KEY);
      storage.removeItem(INSTANCE_ACCOUNT_STORAGE_KEY);
      // #1106: what was agreed to is the signed-in rider's, not the next account's.
      for (const key of INSTANCE_AGREEMENT_STORAGE_KEYS) storage.removeItem(key);
      try {
        // #1210: signing out is sealed and device-signed, so the token alone
        // ends no session; a device with no pin signs out in plaintext.
        const session = await accountSessionOf({ ...dependencies, storage: remembered }, kit);
        if (session.kind === 'closed') return;
        await session.sealedOrKeyless.call('DELETE', '/v1/auth/session', {
          token: session.token,
        });
      } catch {
        // Best effort: the session ends on the instance when it expires.
      }
    },
  };
}
