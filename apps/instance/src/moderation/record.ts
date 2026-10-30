// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The record of each notice and complaint** (#912): received, acknowledged,
 * decided, notifier told, the decision, and the log entry of any action — the
 * operator's evidence of what they were told and what they did, and when (OSA
 * s.23; DSA Art. 16(4)–(6)).
 *
 * A notice's steps are recorded beside it (migration 0029), by the moderator,
 * because the instance sends no email (the owner's ruling of 2026-10-15): the
 * moderator acknowledges and tells the notifier by hand and records that they
 * did. An appeal — the complaint a rider makes about a decision (#911) —
 * carries its own steps: it is filed in the app, decided with its log entry,
 * and the rider is told in the app at once.
 *
 * ## The export
 *
 * {@link exportRecord} is what an operator can hand over. ⚠️ **It carries no
 * personal detail of a notifier**: not their name, not their address, and not
 * the explanation or the location they typed, which may hold either. It says
 * only WHETHER they gave a name and an address, because whether a receipt was
 * owed turns on that. Nor does it carry an appellant's grounds. It names a
 * rider only by an account id, which after erasure resolves to nobody — as the
 * moderation log does (`docs/moderation.md`).
 */

import type { Appeal, Notice, NoticeStep } from '../store/sql-store.ts';

/** A notice with the steps taken on it. */
export interface NoticeRecord {
  readonly noticeId: number;
  readonly receivedAt: number;
  readonly kind: Notice['kind'];
  readonly items: readonly string[];
  readonly notifierGaveName: boolean;
  readonly notifierGaveEmail: boolean;
  readonly acknowledgedAt: number | null;
  readonly decidedAt: number | null;
  readonly decision: string | null;
  readonly logId: number | null;
  readonly notifierToldAt: number | null;
}

/** An appeal, with its own steps. */
export interface AppealRecord {
  readonly appealId: number;
  readonly appellantAthleteId: string;
  readonly statementId: number;
  readonly filedAt: number;
  readonly decidedAt: number | null;
  readonly outcome: Appeal['outcome'];
  readonly decision: string | null;
  readonly logId: number | null;
  readonly moderatorConflict: boolean | null;
  /** The rider reads the decision in the app the moment it is made. */
  readonly appellantToldAt: number | null;
}

export interface ModerationRecord {
  readonly notices: readonly NoticeRecord[];
  readonly appeals: readonly AppealRecord[];
}

/** The steps taken on `noticeId`, by step. */
export function stepsOf(
  noticeId: number,
  steps: readonly NoticeStep[],
): Pick<NoticeRecord, 'acknowledgedAt' | 'decidedAt' | 'decision' | 'logId' | 'notifierToldAt'> {
  const of = (step: NoticeStep['step']) =>
    steps.find((each) => each.noticeId === noticeId && each.step === step);
  const decided = of('decided');
  return {
    acknowledgedAt: of('acknowledged')?.at ?? null,
    decidedAt: decided?.at ?? null,
    decision: decided?.decision ?? null,
    logId: decided?.logId ?? null,
    notifierToldAt: of('notifier_told')?.at ?? null,
  };
}

/** The record, with no personal detail of a notifier and no appellant's grounds. */
export function exportRecord(
  notices: readonly Notice[],
  steps: readonly NoticeStep[],
  appeals: readonly Appeal[],
): ModerationRecord {
  return {
    notices: notices.map((notice) => ({
      noticeId: notice.id,
      receivedAt: notice.receivedAt,
      kind: notice.kind,
      items: notice.items,
      notifierGaveName: notice.notifierName !== null,
      notifierGaveEmail: notice.notifierEmail !== null,
      ...stepsOf(notice.id, steps),
    })),
    appeals: appeals.map((appeal) => ({
      appealId: appeal.id,
      appellantAthleteId: appeal.appellantAthleteId,
      statementId: appeal.statementLogId,
      filedAt: appeal.filedAt,
      decidedAt: appeal.decidedAt,
      outcome: appeal.outcome,
      decision: appeal.decision,
      logId: appeal.decidedLogId,
      moderatorConflict: appeal.moderatorConflict,
      appellantToldAt: appeal.decidedAt,
    })),
  };
}
