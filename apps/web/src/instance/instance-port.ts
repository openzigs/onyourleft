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
 * **disconnecting removes both** — and nothing else: no ride, route or other
 * local row is touched, which `instance-port.test.ts` counts.
 *
 * ## What is shown comes from the instance
 *
 * {@link InstancePort.current} reads the athlete's display name
 * (`GET /v1/auth/session`), the instance's name (`GET /instance`) and where its
 * source is (`GET /source`, ADR 0036 D-6) from the instance every time, never
 * from what the form was given — so what the screen says after a reload is
 * what the instance says.
 */

import { checkDisplayName, type SigningKey } from '@onyourleft/domain';

import { ADDRESS_REFUSAL_TEXT, instanceAddress } from './address';
import {
  instanceHttp,
  InstanceUnreachableError,
  type InstanceHttp,
  type InstanceSend,
} from './instance-transport';
import {
  INSTANCE_ACCOUNT_STORAGE_KEY,
  InstanceSignInError,
  readInstanceAccount,
  signInToInstance,
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
    }
  /** The instance no longer accepts this device's session. */
  | { readonly kind: 'signed-out'; readonly origin: string }
  /** Nothing answered, or not as an instance does. */
  | { readonly kind: 'unreachable'; readonly origin: string };

export type ConnectOutcome =
  | {
      readonly kind: 'connected';
      /** Only when this sign-in registered the athlete: shown once, then never again. */
      readonly recoveryCodes?: readonly string[];
    }
  | { readonly kind: 'refused'; readonly text: string };

export type DevicesOutcome =
  | { readonly kind: 'listed'; readonly devices: readonly InstanceDevice[] }
  | { readonly kind: 'unavailable'; readonly text: string };

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
  connect(address: string, displayName: string): Promise<ConnectOutcome>;
  /** This athlete's devices on the instance (#773). */
  devices(): Promise<DevicesOutcome>;
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

export interface InstancePortDependencies {
  readonly storage: InstanceStorage;
  /** `ensureLocalAthlete`, bound: the athlete row exists before a key is asked for. */
  readonly ensureLocalAthlete: () => Promise<unknown>;
  /** `ensureDeviceSigningKey`, bound. */
  readonly signingKey: () => Promise<SigningKey>;
  /** Injected so a test needs no network. Defaults to the platform's `fetch`. */
  readonly send?: InstanceSend | undefined;
  /** Unix milliseconds. */
  readonly now?: () => number;
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
} as const;

/** What the rider is told when the device list cannot be read. */
export const DEVICES_UNAVAILABLE_TEXT = {
  'signed-out':
    'The instance no longer accepts this device’s sign-in. Disconnect and connect again.',
  'no-answer': 'The instance did not answer, so its list of your devices cannot be shown.',
} as const;

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

function refusalFor(error: unknown): string {
  if (error instanceof InstanceUnreachableError) return CONNECT_REFUSAL_TEXT['no-answer'];
  if (error instanceof InstanceSignInError) {
    switch (error.code) {
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
    },
  };
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

/** The production {@link InstancePort}: `main.tsx` builds it, and nothing else in the client. */
export function createInstancePort(dependencies: InstancePortDependencies): InstancePort {
  const { storage } = dependencies;

  /** The instance and the token this device holds, or `undefined` for neither. */
  const held = (): HeldInstanceSession | undefined =>
    heldInstanceSession(storage, dependencies.send);

  return {
    current: async () => {
      const connection = held();
      if (connection === undefined) return { kind: 'not-connected' };
      const { http, token } = connection;
      try {
        const [session, instance, source] = await Promise.all([
          http.call('GET', '/v1/auth/session', { token }),
          http.call('GET', '/instance'),
          http.call('GET', '/source'),
        ]);
        if (session.status === 401) return { kind: 'signed-out', origin: http.origin };
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
        };
      } catch {
        return { kind: 'unreachable', origin: http.origin };
      }
    },

    connect: async (address, displayName) => {
      const decision = instanceAddress(address);
      if (decision.kind === 'refused') {
        return { kind: 'refused', text: ADDRESS_REFUSAL_TEXT[decision.why] };
      }
      const typedName = displayName.trim();
      let name: string | undefined;
      if (typedName !== '') {
        const checked = checkDisplayName(typedName);
        if (!checked.ok) return { kind: 'refused', text: CONNECT_REFUSAL_TEXT['bad-name'] };
        name = checked.name;
      }
      try {
        const http = instanceHttp(decision.origin, dependencies.send);
        const signedIn = await signInToInstance(
          {
            origin: decision.origin,
            transport: { post: async (path, body) => http.call('POST', path, { body }) },
            storage,
            ensureLocalAthlete: dependencies.ensureLocalAthlete,
            signingKey: dependencies.signingKey,
            ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
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
        return { kind: 'refused', text: refusalFor(error) };
      }
    },

    devices: async () => {
      const connection = held();
      if (connection === undefined) {
        return { kind: 'unavailable', text: DEVICES_UNAVAILABLE_TEXT['signed-out'] };
      }
      try {
        const answer = await connection.http.call('GET', '/v1/auth/devices', {
          token: connection.token,
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

    disconnect: async () => {
      const connection = held();
      // The device forgets first, so a disconnect is complete here whatever the
      // instance does — and whether or not it answers at all.
      storage.removeItem(INSTANCE_SESSION_STORAGE_KEY);
      storage.removeItem(INSTANCE_ACCOUNT_STORAGE_KEY);
      if (connection === undefined) return;
      try {
        await connection.http.call('DELETE', '/v1/auth/session', { token: connection.token });
      } catch {
        // Best effort: the session ends on the instance when it expires.
      }
    },
  };
}
