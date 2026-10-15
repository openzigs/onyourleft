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
 * reaches the export, the deletion, these statements and an appeal against
 * one of them (#911) and nothing else (`apps/instance`
 * §`choke-point.test.ts`), and this module never keeps it.
 *
 * {@link StatementsPort.appeal} asks the instance to look at a decision again
 * (#911, OSA s.21(4)(d)) by the same two sessions, so a suspended rider can
 * appeal without being able to sign in to anything else.
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
  /** The rider's appeal against it (#911), or `null` when they have not appealed. */
  readonly appeal: RiderAppeal | null;
}

/** An appeal, as the rider reads it with the decision it appeals (#911). */
export interface RiderAppeal {
  /** Unix seconds. */
  readonly filedAt: number;
  readonly grounds: string;
  /** `null` until a moderator decides it. */
  readonly outcome: 'upheld' | 'reversed' | null;
  /** What the moderator told the rider, once decided. */
  readonly decision: string | null;
  /** The moderator who decided it took the decision appealed, and declared it. */
  readonly moderatorConflict: boolean;
  readonly decidedAt: number | null;
}

/** What appealing did (#911). */
export type AppealOutcome =
  { readonly kind: 'filed' } | { readonly kind: 'refused'; readonly text: string };

/** The longest grounds the instance takes (`apps/instance` §`statements.ts`). */
export const MAXIMUM_APPEAL_GROUNDS = 2000;

/** What the rider is told when an appeal is not filed. ⚠️ Draft wording awaiting the owner's approval. */
export const APPEAL_REFUSAL_TEXT = {
  grounds: `Say why the decision is wrong, in at most ${String(MAXIMUM_APPEAL_GROUNDS)} characters, with no place or coordinate in it.`,
  already: 'You have already appealed this decision. The moderator decides each appeal once.',
  'no-answer': 'The instance did not answer, so the appeal was not sent. Try again later.',
} as const;

export type StatementsRead =
  | { readonly kind: 'statements'; readonly statements: readonly RiderStatement[] }
  | { readonly kind: 'not-connected' }
  | { readonly kind: 'unreachable' };

export interface StatementsPort {
  /** The statements about this rider's account, newest first — suspended or not. */
  read(): Promise<StatementsRead>;
  /** Appeal the decision `statementId` explains, with the rider's grounds (#911). */
  appeal(statementId: number, grounds: string): Promise<AppealOutcome>;
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
  const appeal = row?.appeal === null ? null : appealFrom(row?.appeal);
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
    appeal === undefined ||
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
    appeal,
  };
}

function appealFrom(value: unknown): RiderAppeal | undefined {
  const row = record(value);
  const grounds = textOf(row?.grounds, MAXIMUM_APPEAL_GROUNDS, false);
  const decision = textOf(row?.decision, MAXIMUM_APPEAL_GROUNDS, true);
  const outcome = row?.outcome;
  if (
    row === undefined ||
    !isTime(row.filedAt) ||
    typeof grounds !== 'string' ||
    decision === undefined ||
    !(outcome === null || outcome === 'upheld' || outcome === 'reversed') ||
    !(row.moderatorConflict === null || typeof row.moderatorConflict === 'boolean') ||
    !(row.decidedAt === null || isTime(row.decidedAt))
  ) {
    return undefined;
  }
  return {
    filedAt: row.filedAt,
    grounds,
    outcome,
    decision,
    moderatorConflict: row.moderatorConflict === true,
    decidedAt: row.decidedAt,
  };
}

/** The statements in an answer, or `undefined` when it is not every one of them. */
function statementsIn(body: unknown): readonly RiderStatement[] | undefined {
  const list = record(body)?.statements;
  if (!Array.isArray(list)) return undefined;
  const read = list.map(statementFrom);
  return read.some((each) => each === undefined) ? undefined : (read as RiderStatement[]);
}

/** The instance's own error code in an answer, or `undefined`. */
function codeOf(body: unknown): unknown {
  return record(record(body)?.error)?.code;
}

/** The production {@link StatementsPort}: `main.tsx` builds it, and nothing else in the client. */
export function createStatementsPort(dependencies: StatementsPortDependencies): StatementsPort {
  /**
   * One request with the session this device holds, and — when the instance
   * refuses that session — once more with a way-out session it opens. Answers
   * `undefined` when there is no instance; throws when there is no answer.
   */
  async function withSession(
    request: (
      http: ReturnType<typeof instanceHttp>,
      token: string,
    ) => Promise<{ readonly status: number; readonly body: unknown }>,
  ): Promise<{ readonly status: number; readonly body: unknown } | undefined> {
    const account = readInstanceAccount(dependencies.storage);
    if (account === undefined) return undefined;
    const http = instanceHttp(account.origin, dependencies.send);
    const held = heldInstanceSession(dependencies.storage, dependencies.send);
    if (held !== undefined) {
      const answer = await request(http, held.token);
      // Anything but the rider's own session being refused is the answer.
      if (answer.status !== 401 && answer.status !== 403) return answer;
      if (answer.status === 403 && codeOf(answer.body) !== 'account_suspended') return answer;
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
    return request(http, token);
  }

  return {
    read: async () => {
      try {
        const answer = await withSession((http, token) =>
          http.call('GET', '/v1/statements', { token }),
        );
        if (answer === undefined) return { kind: 'not-connected' };
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

    appeal: async (statementId, grounds) => {
      const trimmed = grounds.trim();
      if (
        !Number.isSafeInteger(statementId) ||
        statementId < 1 ||
        trimmed === '' ||
        [...trimmed].length > MAXIMUM_APPEAL_GROUNDS
      ) {
        return { kind: 'refused', text: APPEAL_REFUSAL_TEXT.grounds };
      }
      try {
        const answer = await withSession((http, token) =>
          http.call('POST', `/v1/statements/${String(statementId)}/appeal`, {
            token,
            body: { grounds: trimmed },
          }),
        );
        if (answer?.status === 200) return { kind: 'filed' };
        switch (codeOf(answer?.body)) {
          case 'validation_failed':
            return { kind: 'refused', text: APPEAL_REFUSAL_TEXT.grounds };
          case 'already_appealed':
            return { kind: 'refused', text: APPEAL_REFUSAL_TEXT.already };
          default:
            return { kind: 'refused', text: APPEAL_REFUSAL_TEXT['no-answer'] };
        }
      } catch {
        return { kind: 'refused', text: APPEAL_REFUSAL_TEXT['no-answer'] };
      }
    },
  };
}
