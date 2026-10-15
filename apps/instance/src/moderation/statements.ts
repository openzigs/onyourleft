// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Statements of reasons** (#910): what a moderator must say when they
 * restrict a rider, and what the rider is shown.
 *
 * DSA Art. 17(1): a *"clear and specific statement of reasons"* for (a) a
 * restriction of visibility, (c) suspending the service and (d) suspending
 * the account. Art. 17(3)(a)–(f) lists what it contains; the templates are
 * `docs/moderation/statement-of-reasons.md`. So a restricting action
 * ({@link RESTRICTIONS}) is refused without the structured fields
 * ({@link readStatementFields}), and they are stored with the log entry in
 * one transaction (`sql-store.ts` §`moderate`).
 *
 * | Art. 17(3) | Where it comes from |
 * | --- | --- |
 * | (a) what was restricted, where, for how long | the action, the instance, `endsAt` |
 * | (b) the facts, and what it was decided on | `facts`, `decidedOn` |
 * | (c) automated means | none are used: the read says so, always |
 * | (d) the law relied on | `legalGround` |
 * | (e) the terms relied on | `termsGround` — at least one of (d) and (e) |
 * | (f) redress | the instance's settings, when the statement is read |
 *
 * ## What a statement never carries
 *
 * - **The notifier**, unless the moderator names them because the rider
 *   cannot see why without it (recital 54): `notifierNamed` is empty by
 *   default, and neither a notice's nor a report's notifier is ever copied in.
 * - **A coordinate** (ADR 0004 decision D): a field that looks like one —
 *   two decimal numbers with four or more places, or degrees — is refused,
 *   and the refusal names the field and the rule, never the value.
 */

import type { FieldProblem } from '../errors.ts';
import type { LegalSettings } from '../legal.ts';
import type { Appeal, Statement, StatementFields } from '../store/sql-store.ts';

/** The actions that restrict a rider, and so need a statement (Art. 17(1)). */
export const RESTRICTIONS: ReadonlySet<string> = new Set([
  'suspend',
  'hide_display_name',
  'hide_item',
]);

/** The longest facts a statement may give, in characters. */
export const MAXIMUM_FACTS_LENGTH = 2000;
/** The longest legal or terms ground, in characters. */
export const MAXIMUM_GROUND_LENGTH = 1000;
/** The longest notifier's name, in characters. */
export const MAXIMUM_NOTIFIER_NAMED_LENGTH = 200;

const DECIDED_ON = ['notice', 'report', 'own_initiative'] as const;

/**
 * Whether `text` looks like it names a coordinate: a latitude and longitude
 * in decimal degrees (two numbers with four or more decimal places beside
 * each other), or degrees written with a degree sign.
 */
export function namesACoordinate(text: string): boolean {
  return /-?\d{1,3}\.\d{4,}\s*[,;/ ]\s*-?\d{1,3}\.\d{4,}/.test(text) || /\d{1,3}\s*°/.test(text);
}

/** Control characters other than a line break or a tab. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** The statement a moderator sent, checked; or every problem with it, by field and never by value. */
export function readStatementFields(
  value: unknown,
  now: number,
):
  | { readonly ok: true; readonly fields: StatementFields }
  | { readonly ok: false; readonly fields: readonly FieldProblem[] } {
  const problems: FieldProblem[] = [];
  const problem = (field: string, text: string): void => {
    problems.push({ field: `statement.${field}`, problem: text });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      fields: [{ field: 'statement', problem: 'a restriction needs a statement of reasons' }],
    };
  }
  const given = value as Record<string, unknown>;
  const text = (field: string, maximum: number, required: boolean): string | null => {
    const raw = given[field];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      if (required) problem(field, 'must not be empty');
      return null;
    }
    if (typeof raw !== 'string') {
      problem(field, 'must be a string');
      return null;
    }
    const trimmed = raw.trim();
    if ([...trimmed].length > maximum) {
      problem(field, `must be at most ${String(maximum)} characters`);
    } else if (CONTROL.test(trimmed)) {
      problem(field, 'must not contain a control character');
    } else if (namesACoordinate(trimmed)) {
      problem(field, 'must not name a coordinate (ADR 0004 decision D)');
    } else {
      return trimmed;
    }
    return null;
  };
  const facts = text('facts', MAXIMUM_FACTS_LENGTH, true);
  const legalGround = text('legalGround', MAXIMUM_GROUND_LENGTH, false);
  const termsGround = text('termsGround', MAXIMUM_GROUND_LENGTH, false);
  const notifierNamed = text('notifierNamed', MAXIMUM_NOTIFIER_NAMED_LENGTH, false);
  const decidedOn = given.decidedOn;
  if (!(DECIDED_ON as readonly unknown[]).includes(decidedOn)) {
    problem('decidedOn', 'must be notice, report or own_initiative');
  }
  if (
    legalGround === null &&
    termsGround === null &&
    !problems.some(
      (each) => each.field === 'statement.legalGround' || each.field === 'statement.termsGround',
    )
  ) {
    problem('legalGround', 'give the law relied on, the terms relied on, or both');
  }
  const conflict = given.moderatorConflict;
  if (conflict !== undefined && typeof conflict !== 'boolean') {
    problem('moderatorConflict', 'must be true or false');
  }
  const endsAt = given.endsAt;
  if (
    endsAt !== undefined &&
    endsAt !== null &&
    !(Number.isSafeInteger(endsAt) && (endsAt as number) > Math.floor(now / 1000))
  ) {
    problem('endsAt', 'must be a time in the future, in Unix seconds, or null for no end');
  }
  if (problems.length > 0 || facts === null) return { ok: false, fields: problems };
  return {
    ok: true,
    fields: {
      facts,
      decidedOn: decidedOn as StatementFields['decidedOn'],
      legalGround,
      termsGround,
      notifierNamed,
      moderatorConflict: conflict === true,
      endsAt: typeof endsAt === 'number' ? endsAt : null,
    },
  };
}

/** The longest grounds an appeal may give, in characters (#911). */
export const MAXIMUM_APPEAL_GROUNDS_LENGTH = 2000;

/**
 * An appeal's grounds, checked (#911): what the rider says is wrong with the
 * decision. Bounded, no control character, and — as a statement — no
 * coordinate, refused by the rule and never by the value.
 */
export function readAppealGrounds(
  value: unknown,
):
  | { readonly ok: true; readonly grounds: string }
  | { readonly ok: false; readonly problem: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, problem: 'must not be empty' };
  }
  const grounds = value.trim();
  if ([...grounds].length > MAXIMUM_APPEAL_GROUNDS_LENGTH) {
    return {
      ok: false,
      problem: `must be at most ${String(MAXIMUM_APPEAL_GROUNDS_LENGTH)} characters`,
    };
  }
  if (CONTROL.test(grounds)) return { ok: false, problem: 'must not contain a control character' };
  if (namesACoordinate(grounds)) {
    return { ok: false, problem: 'must not name a coordinate (ADR 0004 decision D)' };
  }
  return { ok: true, grounds };
}

/** An appeal as the rider reads it with the statement it appeals (#911). */
export interface AppealView {
  readonly appealId: number;
  readonly filedAt: number;
  readonly grounds: string;
  readonly outcome: 'upheld' | 'reversed' | null;
  readonly decision: string | null;
  readonly moderatorConflict: boolean | null;
  readonly decidedAt: number | null;
}

export function appealView(appeal: Appeal): AppealView {
  return {
    appealId: appeal.id,
    filedAt: appeal.filedAt,
    grounds: appeal.grounds,
    outcome: appeal.outcome,
    decision: appeal.decision,
    moderatorConflict: appeal.moderatorConflict,
    decidedAt: appeal.decidedAt,
  };
}

/** A statement as the affected rider reads it: every Art. 17(3) part, redress included. */
export interface StatementView {
  readonly statementId: number;
  /** Unix seconds. */
  readonly at: number;
  readonly restriction: string;
  /** Unix seconds, or `null` for no end date. */
  readonly endsAt: number | null;
  readonly facts: string;
  readonly decidedOn: StatementFields['decidedOn'];
  readonly legalGround: string | null;
  readonly termsGround: string | null;
  readonly notifierNamed: string | null;
  readonly moderatorConflict: boolean;
  /** (c): always `false` — no automated means are used to find content or to decide. */
  readonly automated: false;
  /** The rider's appeal against it (#911), or `null` when they have not appealed. */
  readonly appeal: AppealView | null;
  /** (f): how to ask the instance to look again, and the other routes. */
  readonly redress: {
    /** The appeal route on this instance (#911): always open to the rider, until they have used it. */
    readonly appeal: true;
    /** Where to write to ask the instance to look again, or `null` when the operator published none. */
    readonly contactEmail: string | null;
    /** Out-of-court dispute settlement (Art. 21): not offered unless the owner or a lawyer decides it applies. */
    readonly outOfCourt: false;
    /** A court: always open (recital 55). */
    readonly court: true;
  };
}

export function statementView(
  statement: Statement,
  legal: LegalSettings,
  appeal: Appeal | undefined,
): StatementView {
  return {
    statementId: statement.logId,
    at: statement.at,
    restriction: statement.restriction,
    endsAt: statement.endsAt,
    facts: statement.facts,
    decidedOn: statement.decidedOn,
    legalGround: statement.legalGround,
    termsGround: statement.termsGround,
    notifierNamed: statement.notifierNamed,
    moderatorConflict: statement.moderatorConflict,
    automated: false,
    appeal: appeal === undefined ? null : appealView(appeal),
    redress: { appeal: true, contactEmail: legal.contactEmail, outOfCourt: false, court: true },
  };
}
