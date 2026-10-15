// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a moderator decided about this rider's account, and why** (#910):
 * the statements of reasons the instance keeps (DSA Art. 17), read back on
 * the Instance screen — by a rider who can sign in, AND by one who cannot
 * because they were suspended.
 *
 * A suspended rider's sessions end at once, so the token this device holds
 * answers `401`, and signing in again is refused `account_suspended`. So
 * {@link StatementsPort.read} asks with the held session first and, when it is
 * refused, opens the rider's way-out session (`POST /v1/auth/leave-session`,
 * signed with this device's key, #898) and asks with that. That session
 * reaches the export, the deletion and these statements and nothing else
 * (`apps/instance` §`choke-point.test.ts`), and this module never keeps it.
 *
 * Every request goes through `instance-transport.ts`, the ONE module this
 * client sends instance traffic through (#777, ADR 0036 D-3 (a)), and only to
 * the instance this device connected to. A `*-port.ts`: `check:wiring`
 * watches {@link StatementsPort} and {@link createStatementsPort}.
 */

import { heldInstanceSession, type InstanceStorage } from './instance-port';
import { instanceHttp, type InstanceSend } from './instance-transport';
import { openLeaveSession, readInstanceAccount } from './sign-in';
import type { SigningKey } from '@onyourleft/domain';

/** One statement of reasons, as the rider reads it. */
export interface RiderStatement {
  readonly statementId: number;
  /** Unix seconds. */
  readonly at: number;
  /** The instance's name for what was done: `suspend`, `hide_display_name`, `hide_item`. */
  readonly restriction: string;
  /** Unix seconds, or `null` for no end date. */
  readonly endsAt: number | null;
  readonly facts: string;
  readonly decidedOn: 'notice' | 'report' | 'own_initiative';
  readonly legalGround: string | null;
  readonly termsGround: string | null;
  readonly notifierNamed: string | null;
  readonly moderatorConflict: boolean;
  /** Where to write to ask the instance to look again, or `null` when it published none. */
  readonly contactEmail: string | null;
}

export type StatementsRead =
  | { readonly kind: 'statements'; readonly statements: readonly RiderStatement[] }
  | { readonly kind: 'not-connected' }
  | { readonly kind: 'unreachable' };

export interface StatementsPort {
  /** The statements about this rider's account, newest first — suspended or not. */
  read(): Promise<StatementsRead>;
}

export interface StatementsPortDependencies {
  readonly storage: InstanceStorage;
  /** `ensureLocalAthlete`, bound: asked before the key, as a sign-in asks. */
  readonly ensureLocalAthlete: () => Promise<unknown>;
  /** `ensureDeviceSigningKey`, bound: signs the way-out session. */
  readonly signingKey: () => Promise<SigningKey>;
  readonly send?: InstanceSend | undefined;
  /** Unix milliseconds. */
  readonly now?: () => number;
}

/** The longest fields the instance keeps (`apps/instance` §`statements.ts`). */
const LIMITS = { facts: 2000, ground: 1000, notifier: 200, email: 254 };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Text as the instance keeps it, `null` where it may be, or `undefined` when it is neither. */
function textOf(value: unknown, maximum: number, nullable: boolean): string | null | undefined {
  if (value === null) return nullable ? null : undefined;
  if (typeof value !== 'string' || [...value].length > maximum) return undefined;
  return value;
}

function statementFrom(value: unknown): RiderStatement | undefined {
  const row = record(value);
  const redress = record(row?.redress);
  const facts = textOf(row?.facts, LIMITS.facts, false);
  const legalGround = textOf(row?.legalGround, LIMITS.ground, true);
  const termsGround = textOf(row?.termsGround, LIMITS.ground, true);
  const notifierNamed = textOf(row?.notifierNamed, LIMITS.notifier, true);
  const contactEmail = textOf(redress?.contactEmail, LIMITS.email, true);
  if (
    row === undefined ||
    !(typeof row.statementId === 'number' && Number.isSafeInteger(row.statementId)) ||
    !isTime(row.at) ||
    typeof row.restriction !== 'string' ||
    !/^[a-z_]{1,64}$/.test(row.restriction) ||
    !(row.endsAt === null || isTime(row.endsAt)) ||
    typeof facts !== 'string' ||
    (row.decidedOn !== 'notice' &&
      row.decidedOn !== 'report' &&
      row.decidedOn !== 'own_initiative') ||
    legalGround === undefined ||
    termsGround === undefined ||
    notifierNamed === undefined ||
    contactEmail === undefined ||
    typeof row.moderatorConflict !== 'boolean'
  ) {
    return undefined;
  }
  return {
    statementId: row.statementId,
    at: row.at,
    restriction: row.restriction,
    endsAt: row.endsAt,
    facts,
    decidedOn: row.decidedOn,
    legalGround,
    termsGround,
    notifierNamed,
    moderatorConflict: row.moderatorConflict,
    contactEmail,
  };
}

/** The statements in an answer, or `undefined` when it is not every one of them. */
function statementsIn(body: unknown): readonly RiderStatement[] | undefined {
  const list = record(body)?.statements;
  if (!Array.isArray(list)) return undefined;
  const read = list.map(statementFrom);
  return read.some((each) => each === undefined) ? undefined : (read as RiderStatement[]);
}

/** The production {@link StatementsPort}: `main.tsx` builds it, and nothing else in the client. */
export function createStatementsPort(dependencies: StatementsPortDependencies): StatementsPort {
  return {
    read: async () => {
      const account = readInstanceAccount(dependencies.storage);
      if (account === undefined) return { kind: 'not-connected' };
      try {
        const http = instanceHttp(account.origin, dependencies.send);
        const held = heldInstanceSession(dependencies.storage, dependencies.send);
        if (held !== undefined) {
          const answer = await http.call('GET', '/v1/statements', { token: held.token });
          if (answer.status === 200) {
            const statements = statementsIn(answer.body);
            return statements === undefined
              ? { kind: 'unreachable' }
              : { kind: 'statements', statements };
          }
          // Anything but the rider's own session being refused is no answer.
          if (answer.status !== 401 && answer.status !== 403) return { kind: 'unreachable' };
        }
        // The held session is gone or refused: a suspended rider's way out.
        const token = await openLeaveSession({
          origin: account.origin,
          transport: { post: async (path, body) => http.call('POST', path, { body }) },
          storage: dependencies.storage,
          ensureLocalAthlete: dependencies.ensureLocalAthlete,
          signingKey: dependencies.signingKey,
          ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
        });
        const answer = await http.call('GET', '/v1/statements', { token });
        const statements = answer.status === 200 ? statementsIn(answer.body) : undefined;
        return statements === undefined
          ? { kind: 'unreachable' }
          : { kind: 'statements', statements };
      } catch {
        // Not suspended after all (the session simply lapsed), refused, or no
        // answer: there is nothing this screen can read.
        return { kind: 'unreachable' };
      }
    },
  };
}
