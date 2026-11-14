// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Operate** (#2603, epic #2601): what the owner-only Operate area may ask of
 * the instance this device is signed in to, and the one production
 * implementation of it.
 *
 * Every request here goes through `instance-transport.ts`, the ONE module this
 * client sends instance traffic through (#777, ADR 0036 D-3 (a)), SEALED over
 * the session `instance-port.ts` keeps (ADR 0047 D-7): every Operate route on
 * the instance is `sealed: 'only'` (#2602), so a device that cannot seal asks
 * nothing and is told why. No new network module was added for this area.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method of
 * {@link OperatePort} (WIRE003) and every export of this file (WIRE002), and
 * `main.tsx` is the only production code that names {@link createOperatePort}.
 *
 * ## Who is the owner, and how the app finds out
 *
 * The instance names its owner by device key (`OYL_INSTANCE_OWNER_KEY`), and
 * its session read, `GET /v1/auth/account`, says `moderatorRole: 'owner'` to
 * that athlete alone (#775). The deputy is a moderator and NOT the operator
 * (ADR 0046 D-9 Q9, the owner's ruling of 2026-11-14 on #2601), so
 * {@link OperatePort.standing} is `owner` for `'owner'` and nothing else.
 * That is only what the app DRAWS: the instance checks every Operate route
 * itself and answers anybody else `not_found`, as though it were not there.
 *
 * ⚠️ As for Moderation (#957's review), a status alone is not the instance's
 * answer: a proxy's own `404` or `403` is `unreachable`, never "not the owner".
 *
 * ## Nothing secret, nothing that could be a place
 *
 * The log's `detail` is checked here against the instance's own closed grammar
 * (`apps/instance` §`OPERATOR_DETAIL`: words, each optionally `=` a whole
 * number) before it can reach the screen, so a row carrying free text — a key,
 * a token, a coordinate — is not shown at all: the page reads as unreadable.
 */

import {
  heldSealedSession,
  type HeldSealedSession,
  type SealingDependencies,
} from './instance-port';
import type { InstanceAnswer } from './instance-transport';

/**
 * Whether this device's account is its instance's owner (#2603).
 *
 * - `owner`: the instance says `moderatorRole: 'owner'` over a sealed session.
 * - `not-owner`: any other account the instance answered for, the deputy
 *   included, or one refused before any route (pending, suspended).
 * - `signed-out`: no sign-in on this device, or the instance refused it.
 * - `unreachable`: nothing that was the instance's own answer came back.
 * - `no-keys`: this device cannot seal now — no instance card, a copy of the
 *   app loaded from a website (ADR 0047 D-11), keys refused — or the instance
 *   holds no keys and so offers no Operate area at all (#2602).
 */
export type OperateStanding = 'owner' | 'not-owner' | 'signed-out' | 'unreachable' | 'no-keys';

/** One entry of the operator log, as the instance pages it (#2602). */
export interface OperatorLogEntry {
  readonly id: number;
  /** When, as ISO 8601 in UTC. */
  readonly at: string;
  /** Taken in the app's Operate area, or with the operator's CLI on the host. */
  readonly source: 'app' | 'cli';
  /** The instance's own name for the action — `backup`, `room_open`, … */
  readonly action: string;
  /** Closed words, each optionally `=` a whole number — or `null`. */
  readonly detail: string | null;
  readonly outcome: 'done' | 'refused' | 'failed';
}

/** One page of the operator log, NEWEST first, and the cursor for the next — `null` at the end. */
export interface OperatorLogPage {
  readonly kind: 'page';
  readonly entries: readonly OperatorLogEntry[];
  readonly next: string | null;
}

/** A page of the log, or why there is none: a standing other than `owner`. */
export type OperatorLogRead =
  OperatorLogPage | { readonly kind: Exclude<OperateStanding, 'owner'> };

/** How many entries one page asks for: a short page, well under the transport's 256 KiB. */
export const OPERATOR_LOG_PAGE = 25;

/** What the Operate area may ask. */
export interface OperatePort {
  /** Whether this device's account is the instance's owner — one sealed request, or none. */
  standing(): Promise<OperateStanding>;
  /** One page of the operator log, newest first: the first, or the one after `cursor`. */
  log(cursor?: string): Promise<OperatorLogRead>;
}

/** Every Operate route is sealed and signed by the owner's device key, so the port needs what a sealed call needs. */
export type OperatePortDependencies = SealingDependencies;

/** A cursor as the instance's `pagination.ts` writes one: base64url, and short. */
const CURSOR = /^[A-Za-z0-9_-]{1,1024}$/;

/** An action's name as the instance writes it: a newer instance may add one this build does not know. */
const ACTION = /^[a-z][a-z0-9_]{0,63}$/;

/** `apps/instance` §`OPERATOR_DETAIL`, the same grammar: no space, no sign, no decimal point. */
const DETAIL = /^[a-z][a-z0-9_]{0,31}(=[0-9]{1,9})?(,[a-z][a-z0-9_]{0,31}(=[0-9]{1,9})?){0,5}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorCode(answer: InstanceAnswer): unknown {
  return record(record(answer.body)?.error)?.code;
}

/** `value` as an ISO 8601 moment in UTC, as `Date` writes one — or `undefined`. */
function isoMoment(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  const written = new Date(ms).toISOString();
  return written === value ? written : undefined;
}

function entryFrom(value: unknown): OperatorLogEntry | undefined {
  const row = record(value);
  const at = isoMoment(row?.at);
  if (
    row === undefined ||
    typeof row.id !== 'number' ||
    !Number.isSafeInteger(row.id) ||
    row.id < 1 ||
    at === undefined ||
    (row.source !== 'app' && row.source !== 'cli') ||
    typeof row.action !== 'string' ||
    !ACTION.test(row.action) ||
    !(row.detail === null || (typeof row.detail === 'string' && DETAIL.test(row.detail))) ||
    (row.outcome !== 'done' && row.outcome !== 'refused' && row.outcome !== 'failed')
  ) {
    return undefined;
  }
  return {
    id: row.id,
    at,
    source: row.source,
    action: row.action,
    detail: row.detail,
    outcome: row.outcome,
  };
}

/** A page as the instance writes one, or `undefined` when any part of it is not. */
function pageFrom(answer: InstanceAnswer): OperatorLogPage | undefined {
  const body = record(answer.body);
  const list = body?.entries;
  const next = body?.cursor;
  if (!Array.isArray(list)) return undefined;
  if (!(next === null || (typeof next === 'string' && CURSOR.test(next)))) return undefined;
  const entries = list.map(entryFrom);
  if (entries.some((entry) => entry === undefined)) return undefined;
  return { kind: 'page', entries: entries as OperatorLogEntry[], next };
}

/**
 * Whether an answer is the INSTANCE saying this account is not its owner — the
 * status AND its own code. An Operate route answers anybody but the owner as a
 * route that does not exist; an account pending approval or suspended is
 * refused about itself before any route.
 */
function isNotTheOwner(answer: InstanceAnswer): boolean {
  const code = errorCode(answer);
  if (answer.status === 404) return code === 'not_found';
  if (answer.status === 403) return code === 'registration_pending' || code === 'account_suspended';
  return false;
}

/** What a closed sealed session means here. */
function closedStanding(
  closed: Extract<HeldSealedSession, { kind: 'closed' }>,
): Exclude<OperateStanding, 'owner' | 'not-owner' | 'unreachable'> {
  return closed.why === 'signed-out' ? 'signed-out' : 'no-keys';
}

/** The production {@link OperatePort}: `main.tsx` builds it, and nothing else in the client. */
export function createOperatePort(dependencies: OperatePortDependencies): OperatePort {
  const sealedSession = heldSealedSession(dependencies);

  return {
    standing: async () => {
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return closedStanding(session);
        const answer = await session.sealed.call('GET', '/v1/auth/account', {
          token: session.token,
        });
        if (answer.status === 401) return 'signed-out';
        if (answer.status === 200) {
          return record(answer.body)?.moderatorRole === 'owner' ? 'owner' : 'not-owner';
        }
        return isNotTheOwner(answer) ? 'not-owner' : 'unreachable';
      } catch {
        return 'unreachable';
      }
    },

    log: async (cursor) => {
      // A cursor the instance could not have written is sent nowhere.
      if (cursor !== undefined && !CURSOR.test(cursor)) return { kind: 'unreachable' };
      try {
        const session = await sealedSession();
        if (session.kind === 'closed') return { kind: closedStanding(session) };
        const answer = await session.sealed.call('GET', '/v1/operate/log', {
          token: session.token,
          query: {
            limit: String(OPERATOR_LOG_PAGE),
            ...(cursor === undefined ? {} : { cursor }),
          },
        });
        if (answer.status === 401) return { kind: 'signed-out' };
        if (answer.status === 200) return pageFrom(answer) ?? { kind: 'unreachable' };
        if (isNotTheOwner(answer)) return { kind: 'not-owner' };
        // #2602: an instance with no OYL_INSTANCE_SECRET_KEY offers no Operate area.
        if (errorCode(answer) === 'unavailable') return { kind: 'no-keys' };
        return { kind: 'unreachable' };
      } catch {
        return { kind: 'unreachable' };
      }
    },
  };
}
