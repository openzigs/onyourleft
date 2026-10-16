// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { PairingCode } from '../camera/PairingCode';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { KeptVisible } from '../design/KeptVisible';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import {
  INVITE_CARD_CAUTION,
  isConflict,
  MODERATION_REFUSAL_TEXT,
  MAXIMUM_MODERATION_REASON,
  type InviteOutcome,
  type AccountAction,
  type ModerationList,
  type ModerationLogEntry,
  type ModerationOutcome,
  type ModerationPort,
  type ModerationRead,
  type OpenReport,
  type PendingRegistration,
  type ReceivedNotice,
  type OpenAppeal,
  type StatementInput,
  type SuspendedAccount,
  MAXIMUM_STATEMENT_FACTS,
  MAXIMUM_STATEMENT_GROUND,
} from '../instance/moderation-port';
import { hrefFor, routeById } from '../shell/routes';

/**
 * An address safe to put in a `mailto:` link: nothing in it can add a
 * parameter (`?bcc=`, `&body=`). An address stored before the instance
 * tightened its grammar that fails this is shown as text, never as a link.
 */
const LINKABLE_EMAIL = /^[A-Za-z0-9.!#$*+/=^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * The Moderation screen (#955): the instance's moderator approves and refuses
 * accounts awaiting approval, decides reports, suspends and lifts suspensions,
 * hides display names, and reads the moderation log.
 *
 * ## Shown to the moderator only
 *
 * The route is not in the navigation. It is reached from the Instance screen,
 * whose link to it is drawn only when {@link ModerationPort.standing} says this
 * device's account is the instance's moderator; and anybody who opens its
 * address anyway is told only that their own account is not a moderator —
 * which the instance's own `not_found` already told them, and which says
 * nothing about anybody else.
 *
 * ## What is shown is read back
 *
 * After every action the queues and the log are read from the instance again,
 * never edited in place, so a row leaves the screen because the instance says
 * it has gone. That includes an action the instance REFUSED (#957's review):
 * a refusal can be logged — acting on a moderator is written as
 * `refused_<action>` — and a log not read again would not show it. What the
 * last action did stays on the page when that read-back fails, so a moderator
 * is not left to press again not knowing it was done.
 *
 * ## Nothing here says whether an account exists — #891, #899
 *
 * Every action that changes nothing says {@link NOTHING_CHANGED_TEXT}'s one
 * sentence (`instance/moderation-port.ts`), whatever the instance's reason.
 *
 * ## Two lists a page at a time — #961
 *
 * The suspended accounts and the log are shown a page at a time, newest first,
 * each with a *Show more* control while the instance says there is more. A
 * page is appended to what is shown; an action reads everything back from the
 * first page again.
 *
 * ## A report about you — #905
 *
 * Declared a conflict. While the instance names another moderator, no control
 * is drawn on it, because the instance would refuse this one deciding it.
 * When it names this moderator alone (the project's instance), the one choice
 * is to dismiss it, the reason being their declaration of the conflict, as
 * the owner's procedure says (`docs/moderation/notice-and-action.md`); the
 * instance logs it as `dismiss_own_report`. Suspending or hiding themselves
 * is never offered.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval**,
 * as the Instance screen's is (#880).
 */

/** Every action here is logged, and the log outlives an erased account. Kept visible. */
export const MODERATION_IS_LOGGED =
  'Everything you do here is written to the instance’s moderation log with your account, the ' +
  'reason you give and the time. Nobody can change or delete the log, and it is kept when an ' +
  'account is erased.';

/** Every sentence this route must never tuck away — #666. */
export const MODERATION_KEPT_VISIBLE: readonly string[] = [MODERATION_IS_LOGGED];

/** Said on a report about the moderator reading it, with another moderator to decide it — #905. */
export const REPORT_CONFLICT_TEXT =
  'This report is about you, so it is a conflict and you may not decide it. It stays open in ' +
  'this queue.';

/** Said on a report about the only moderator, who decides it themselves — #905. */
export const REPORT_OWN_CONFLICT_TEXT =
  'This report is about you, and you are this instance’s only moderator, so nobody else can ' +
  'decide it. If you dismiss it, say in the reason that it was about you and why you dismissed ' +
  'it. The log records it as a report about you that you decided yourself.';

export const MODERATION_NO_PORT =
  'This app cannot moderate an instance here, because this browser has no local store to keep ' +
  'a sign-in in.';

/** What a rider who does not moderate their instance is told — about themselves only. */
export const MODERATION_STANDING_TEXT = {
  'not-connected': 'This device is not connected to an instance.',
  'not-moderator':
    'Your account is not a moderator of the instance this device is connected to. Only the ' +
    'account its operator names as moderator can use this page.',
  'signed-out':
    'The instance no longer accepts this device’s sign-in. Connect again from the instance screen.',
  unreachable: 'The instance did not answer, so there is nothing to show.',
} as const;

export const ACTION_DONE_TEXT = 'Done, and written to the moderation log.';

/** Said in place of the log when the instance gave the queues and not the log. */
export const MODERATION_LOG_UNREADABLE_TEXT =
  'The moderation log could not be read from the instance, so it is not shown here. The ' +
  'queues above are as the instance gave them.';

/** Said in place of the suspended accounts when the instance gave the queues and not them (#961). */
export const SUSPENDED_UNREADABLE_TEXT =
  'The suspended accounts could not be read from the instance, so they are not shown here. You ' +
  'can still lift a suspension by the account’s id, below.';

/** Said in place of the appeals when the instance gave the queues and not them (#911). */
export const APPEALS_UNREADABLE_TEXT =
  'The appeals could not be read from the instance, so they are not shown here. The queues ' +
  'above are as the instance gave them.';

/**
 * The Appeals section's one short line (#911, #1013). ⚠️ No ⓘ: each appeal
 * is read before it is decided, so its controls follow its words, and a
 * section that tucks its explanation is held to 130 px of prose above its
 * first control (`controls-first.browser.spec.ts`).
 */
export const APPEALS_SHORT_TEXT =
  'Reverse lifts the restriction at once. Your answer is shown to the rider and logged.';

/**
 * Said on an appeal against the moderator's own decision (#911): the owner's
 * ruling of 2026-09-30 — decide it, declare it, log it.
 */
export const APPEAL_CONFLICT_TEXT =
  'You took this decision. You may decide the appeal, and the rider is told that you had a ' +
  'conflict of interest; it is logged with your decision.';

/** What each restriction is called on an appeal. */
const APPEALED: Readonly<Record<string, string>> = {
  suspend: 'a suspension',
  hide_display_name: 'a hidden display name',
};

/** Said in place of the notices when the instance gave the queues and not them (#907). */
export const NOTICES_UNREADABLE_TEXT =
  'The notices could not be read from the instance, so they are not shown here. The queues ' +
  'above are as the instance gave them.';

/**
 * The Notices section's one short line (#907, #912, #1013): the owner's
 * ruling of 2026-10-15 — a receipt is confirmed by hand, and recorded here.
 * ⚠️ No ⓘ since #912: each notice is read before its steps are recorded, and
 * a section that tucks its explanation is held to 130 px of prose above its
 * first control (`controls-first.browser.spec.ts`).
 */
export const NOTICES_SHORT_TEXT =
  'The instance sends no email: reply by hand to any address given, then record it here.';

/** Said on an intimate image content report (OSA s.10(3A)). */
export const INTIMATE_IMAGE_DEADLINE_TEXT =
  'An intimate image content report (UK Online Safety Act, section 20A): the content must be ' +
  'taken down within 48 hours of when it was received.';

/** Said under a list when its next page could not be read (#961). */
export const MORE_UNREADABLE_TEXT =
  'The next page could not be read from the instance. What is shown above is unchanged.';

/** What each logged action is called on this screen. */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  approve_registration: 'Approved an account',
  refuse_registration: 'Refused an account',
  suspend: 'Suspended an account',
  unsuspend: 'Lifted a suspension',
  hide_display_name: 'Hid a display name',
  hide_item: 'Hid an item',
  dismiss_report: 'Dismissed a report',
  dismiss_own_report: 'Dismissed a report about themselves, as the only moderator',
  activate_moderator_key: 'A moderator’s key activated its own account',
  mint_invite: 'Made an invitation',
  uphold_appeal: 'Upheld a decision on appeal',
  reverse_appeal: 'Reversed a decision on appeal',
};

/** A logged action as a phrase — an unknown one as the instance's own word. */
export function actionLabel(action: string): string {
  const refused = /^refused_(.+)$/.exec(action);
  if (refused !== null) {
    const inner = ACTION_LABEL[refused[1] ?? ''] ?? refused[1] ?? action;
    return `Refused, and changed nothing: ${inner.charAt(0).toLowerCase()}${inner.slice(1)}`;
  }
  return ACTION_LABEL[action] ?? action;
}

/** A moment, in UTC, so the screen says the same thing wherever it is read. */
function when(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** What a decision tells the page: that one is under way, and what it came to. */
interface Done {
  readonly starting: () => void;
  readonly finished: (outcome: ModerationOutcome) => Promise<void>;
}

/**
 * The question a choice asks before it acts — #962. Suspending an account and
 * hiding a display name are asked in `ConfirmDialog`, as Activities' delete is.
 */
interface Confirmation {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

interface Choice {
  readonly label: string;
  readonly run: (reason: string, statement?: StatementInput) => Promise<ModerationOutcome>;
  /** Asked first when present; the action runs only once it is confirmed. */
  readonly confirm?: Confirmation;
  /**
   * The choice restricts a rider, so its confirmation asks for the statement
   * of reasons they are shown (#910) — starting from what it is decided on.
   */
  readonly statement?: { readonly decidedOn: StatementInput['decidedOn'] };
}

/** What the statement's own fields are called on the screen (#910). */
export const STATEMENT_TEXT = {
  legend: 'Statement of reasons. The rider is shown this, and not the reason above.',
  facts: 'What they did: the facts you relied on',
  decidedOn: 'Decided on',
  report: 'A report from a rider',
  notice: 'A notice',
  ownInitiative: 'Your own finding',
  legal: 'The law it breaks, and why (if it is illegal)',
  terms: 'The terms it breaks, and why (if it breaks them)',
  conflict: 'This involves me: declare a conflict of interest',
  hint: 'Give the law, the terms or both. Never write a place or a coordinate.',
} as const;

/** An empty statement, decided on `decidedOn`. */
const blankStatement = (decidedOn: StatementInput['decidedOn']): StatementInput => ({
  facts: '',
  decidedOn,
  legalGround: '',
  termsGround: '',
  moderatorConflict: false,
});

/** The statement's fields, inside a restriction's confirmation (#910). */
function StatementFields({
  value,
  onChange,
}: {
  readonly value: StatementInput;
  readonly onChange: (next: StatementInput) => void;
}): JSX.Element {
  const id = useId();
  const set = (patch: Partial<StatementInput>): void => {
    onChange({ ...value, ...patch });
  };
  return (
    <fieldset className="oyl-moderation__statement">
      <legend>{STATEMENT_TEXT.legend}</legend>
      <p id={`${id}-hint`}>{STATEMENT_TEXT.hint}</p>
      <p>
        <label htmlFor={`${id}-facts`}>{STATEMENT_TEXT.facts}</label>
        <textarea
          className="oyl-input"
          id={`${id}-facts`}
          maxLength={MAXIMUM_STATEMENT_FACTS}
          aria-describedby={`${id}-hint`}
          value={value.facts}
          onChange={(event) => {
            set({ facts: event.target.value });
          }}
        />
      </p>
      <fieldset>
        <legend>{STATEMENT_TEXT.decidedOn}</legend>
        {(
          [
            ['report', STATEMENT_TEXT.report],
            ['notice', STATEMENT_TEXT.notice],
            ['own_initiative', STATEMENT_TEXT.ownInitiative],
          ] as const
        ).map(([choice, label]) => (
          <p key={choice}>
            <input
              type="radio"
              id={`${id}-${choice}`}
              name={`${id}-decided-on`}
              checked={value.decidedOn === choice}
              onChange={() => {
                set({ decidedOn: choice });
              }}
            />{' '}
            <label htmlFor={`${id}-${choice}`}>{label}</label>
          </p>
        ))}
      </fieldset>
      <p>
        <label htmlFor={`${id}-legal`}>{STATEMENT_TEXT.legal}</label>
        <textarea
          className="oyl-input"
          id={`${id}-legal`}
          maxLength={MAXIMUM_STATEMENT_GROUND}
          value={value.legalGround}
          onChange={(event) => {
            set({ legalGround: event.target.value });
          }}
        />
      </p>
      <p>
        <label htmlFor={`${id}-terms`}>{STATEMENT_TEXT.terms}</label>
        <textarea
          className="oyl-input"
          id={`${id}-terms`}
          maxLength={MAXIMUM_STATEMENT_GROUND}
          value={value.termsGround}
          onChange={(event) => {
            set({ termsGround: event.target.value });
          }}
        />
      </p>
      <p>
        <input
          type="checkbox"
          id={`${id}-conflict`}
          checked={value.moderatorConflict}
          onChange={(event) => {
            set({ moderatorConflict: event.target.checked });
          }}
        />{' '}
        <label htmlFor={`${id}-conflict`}>{STATEMENT_TEXT.conflict}</label>
      </p>
    </fieldset>
  );
}

/** The way out of every moderation confirmation. */
export const MODERATION_CANCEL_LABEL = 'Change nothing';

/** That the confirmed action is logged — the last sentence of every confirmation. */
const LOGGED_SENTENCE =
  'It is written to the moderation log with your account and the reason you gave.';

/** #962: what suspending `athleteId` is confirmed with. */
export function suspendConfirmation(athleteId: string): Confirmation {
  return {
    title: athleteId.trim() === '' ? 'Suspend this account?' : `Suspend account ${athleteId}?`,
    body:
      'Until you lift the suspension, the account cannot use this instance except to take its ' +
      `data out or delete itself. ${LOGGED_SENTENCE}`,
    confirmLabel: 'Suspend it',
  };
}

/** #962: what hiding `athleteId`'s display name is confirmed with. */
export function hideNameConfirmation(athleteId: string): Confirmation {
  return {
    title:
      athleteId.trim() === ''
        ? 'Hide this account’s display name?'
        : `Hide the display name of account ${athleteId}?`,
    body: `Other riders will no longer see the name this account chose. ${LOGGED_SENTENCE}`,
    confirmLabel: 'Hide the name',
  };
}

/** A reason box and the actions it goes with, and what the last one did. */
function Decide({
  label,
  choices,
  onDone,
}: {
  readonly label: string;
  readonly choices: readonly Choice[];
  readonly onDone: Done;
}): JSX.Element {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  /** The choice whose confirmation is open — #962. */
  const [confirming, setConfirming] = useState<Choice | undefined>(undefined);
  /** The statement of reasons a restriction's confirmation is writing — #910. */
  const [statement, setStatement] = useState<StatementInput>(blankStatement('own_initiative'));

  async function run(choice: Choice): Promise<void> {
    setBusy(true);
    onDone.starting();
    const answer = await choice.run(reason, choice.statement === undefined ? undefined : statement);
    setBusy(false);
    // What it came to — done OR refused — is said by the page rather than
    // here (#960): the row this was pressed on may leave the screen once the
    // queue is read again, and a refusal said inside it would go with it.
    if (answer.kind === 'done') setReason('');
    // Read back either way: a refused action can be logged too.
    await onDone.finished(answer);
  }

  return (
    <div className="oyl-moderation__decide">
      <p className="oyl-moderation__reason">
        <label htmlFor={reasonId}>{label}</label>{' '}
        <input
          className="oyl-input"
          id={reasonId}
          maxLength={MAXIMUM_MODERATION_REASON}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </p>
      <p className="oyl-ride__actions">
        {choices.map((choice) => (
          <Button
            key={choice.label}
            variant="secondary"
            // `aria-disabled` rather than `disabled` while an action runs, so
            // focus handed back by a closing confirmation lands on it rather
            // than falling to the page; `run` refuses the press.
            unavailable={busy}
            onClick={() => {
              if (busy) return;
              if (choice.confirm === undefined) {
                void run(choice);
                return;
              }
              if (choice.statement !== undefined) {
                setStatement(blankStatement(choice.statement.decidedOn));
              }
              setConfirming(choice);
            }}
          >
            {choice.label}
          </Button>
        ))}
      </p>
      <ConfirmDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        title={confirming?.confirm?.title ?? ''}
        confirmLabel={confirming?.confirm?.confirmLabel ?? ''}
        cancelLabel={MODERATION_CANCEL_LABEL}
        onConfirm={() => {
          if (confirming !== undefined) void run(confirming);
        }}
      >
        <p>{confirming?.confirm?.body}</p>
        {confirming?.statement === undefined ? null : (
          <StatementFields value={statement} onChange={setStatement} />
        )}
      </ConfirmDialog>
    </div>
  );
}

function Registrations({
  port,
  registrations,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly registrations: readonly PendingRegistration[];
  readonly onDone: Done;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-pending">
      <h2 id="oyl-moderation-pending">Waiting for approval</h2>
      {registrations.length === 0 ? (
        <p className="oyl-muted">Nobody is waiting for approval.</p>
      ) : (
        <ul className="oyl-moderation__list oyl-moderation__pending">
          {registrations.map((each) => (
            <li key={each.athleteId}>
              <h3>{each.displayName}</h3>
              <p>
                Account <code>{each.athleteId}</code>, asked {when(each.createdAt)}.{' '}
                {each.adultConfirmed
                  ? 'They have confirmed they are 18 or over.'
                  : 'They have not confirmed they are 18 or over.'}
              </p>
              <Decide
                label={`Reason for approving or refusing ${each.displayName}`}
                onDone={onDone}
                choices={[
                  {
                    label: 'Approve',
                    run: async (reason) =>
                      port.decideRegistration(each.athleteId, 'approve', reason),
                  },
                  {
                    label: 'Refuse',
                    run: async (reason) =>
                      port.decideRegistration(each.athleteId, 'refuse', reason),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reports({
  port,
  me,
  soleModerator,
  reports,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly me: string;
  readonly soleModerator: boolean;
  readonly reports: readonly OpenReport[];
  readonly onDone: Done;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-reports">
      <h2 id="oyl-moderation-reports">Reports</h2>
      {reports.length === 0 ? (
        <p className="oyl-muted">No report is open.</p>
      ) : (
        <ul className="oyl-moderation__list oyl-moderation__reports">
          {reports.map((report) => (
            <li key={report.reportId}>
              <h3>Report {report.reportId}</h3>
              <p>
                About account <code>{report.targetAthleteId}</code>
                {isConflict(report, me) ? ' (you)' : ''}, from account{' '}
                <code>{report.reporterAthleteId}</code>, made {when(report.createdAt)}.
              </p>
              <p className="oyl-moderation__quoted">Their reason: {report.reason}</p>
              {isConflict(report, me) && soleModerator ? (
                <>
                  <StatusMessage tone="warning" label="A conflict">
                    {REPORT_OWN_CONFLICT_TEXT}
                  </StatusMessage>
                  <Decide
                    label={`Your declaration, for dismissing report ${String(report.reportId)}`}
                    onDone={onDone}
                    choices={[
                      {
                        label: 'Dismiss',
                        run: async (reason) => port.dismissReport(report.reportId, reason),
                      },
                    ]}
                  />
                </>
              ) : isConflict(report, me) ? (
                <StatusMessage tone="warning" label="A conflict">
                  {REPORT_CONFLICT_TEXT}
                </StatusMessage>
              ) : (
                <Decide
                  label={`Reason for deciding report ${String(report.reportId)}`}
                  onDone={onDone}
                  choices={[
                    {
                      label: 'Dismiss',
                      run: async (reason) => port.dismissReport(report.reportId, reason),
                    },
                    {
                      label: 'Suspend the account',
                      confirm: suspendConfirmation(report.targetAthleteId),
                      statement: { decidedOn: 'report' },
                      run: async (reason, statement) =>
                        port.actOnAccount(
                          report.targetAthleteId,
                          'suspend',
                          reason,
                          report.reportId,
                          statement,
                        ),
                    },
                    {
                      label: 'Hide its display name',
                      confirm: hideNameConfirmation(report.targetAthleteId),
                      statement: { decidedOn: 'report' },
                      run: async (reason, statement) =>
                        port.actOnAccount(
                          report.targetAthleteId,
                          'hide_display_name',
                          reason,
                          report.reportId,
                          statement,
                        ),
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Appeals({
  port,
  me,
  appeals,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly me: string;
  readonly appeals: readonly OpenAppeal[] | undefined;
  readonly onDone: Done;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-appeals">
      <h2 id="oyl-moderation-appeals">Appeals</h2>
      <p>{APPEALS_SHORT_TEXT}</p>
      {appeals === undefined ? (
        <StatusMessage tone="warning" label="Not shown">
          {APPEALS_UNREADABLE_TEXT}
        </StatusMessage>
      ) : appeals.length === 0 ? (
        <p className="oyl-muted">No appeal is open.</p>
      ) : (
        <ul className="oyl-moderation__list oyl-moderation__appeals">
          {appeals.map((appeal) => (
            <li key={appeal.appealId}>
              <h3>Appeal {appeal.appealId}</h3>
              <p>
                Against {APPEALED[appeal.restriction] ?? appeal.restriction} on account{' '}
                <code>{appeal.appellantAthleteId}</code>, made {when(appeal.filedAt)}.
              </p>
              <p className="oyl-moderation__quoted">The statement said: {appeal.facts}</p>
              <p className="oyl-moderation__quoted">Their grounds: {appeal.grounds}</p>
              {appeal.decidedBy === me ? (
                <StatusMessage tone="warning" label="A conflict">
                  {APPEAL_CONFLICT_TEXT}
                </StatusMessage>
              ) : null}
              <Decide
                label={`Your answer to the rider, for appeal ${String(appeal.appealId)}`}
                onDone={onDone}
                choices={[
                  {
                    label: 'Uphold',
                    run: async (decision) => port.decideAppeal(appeal.appealId, 'upheld', decision),
                  },
                  {
                    label: 'Reverse',
                    run: async (decision) =>
                      port.decideAppeal(appeal.appealId, 'reversed', decision),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The steps a moderator records on a notice, as the screen names them (#912). */
export const NOTICE_STEP_TEXT = {
  acknowledge: 'I have confirmed receipt',
  decide: 'Record the decision',
  told: 'I have told them the decision',
  decisionLabel: 'The decision, as you tell the notifier',
  logLabel: 'Log entry of the action taken, if any',
} as const;

/** What has been recorded on a notice so far (#912). */
function noticeProgress(notice: ReceivedNotice): string {
  const parts = [
    notice.acknowledgedAt === null
      ? undefined
      : `Receipt confirmed ${when(notice.acknowledgedAt)}.`,
    notice.decidedAt === null
      ? 'Not decided yet.'
      : `Decided ${when(notice.decidedAt)}${
          notice.logId === null ? '' : `, log entry ${String(notice.logId)}`
        }.`,
    notice.notifierToldAt === null ? undefined : `Notifier told ${when(notice.notifierToldAt)}.`,
  ];
  return parts.filter((part) => part !== undefined).join(' ');
}

/** The steps still open on a notice, and the controls that record them (#912). */
function NoticeSteps({
  port,
  notice,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly notice: ReceivedNotice;
  readonly onDone: Done;
}): JSX.Element | null {
  const id = useId();
  const [decision, setDecision] = useState('');
  const [logEntry, setLogEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const contact = notice.notifierEmail !== null;
  async function record(step: Parameters<ModerationPort['recordNoticeStep']>[1]): Promise<void> {
    if (busy) return;
    setBusy(true);
    onDone.starting();
    const typed = logEntry.trim();
    const answer =
      step === 'decided'
        ? await port.recordNoticeStep(
            notice.noticeId,
            step,
            decision,
            typed === '' ? undefined : Number(typed),
          )
        : await port.recordNoticeStep(notice.noticeId, step);
    setBusy(false);
    if (answer.kind === 'done') {
      setDecision('');
      setLogEntry('');
    }
    await onDone.finished(answer);
  }
  const acknowledge = contact && notice.acknowledgedAt === null;
  const decide = notice.decidedAt === null;
  const tell = contact && notice.decidedAt !== null && notice.notifierToldAt === null;
  if (!acknowledge && !decide && !tell) return null;
  return (
    <div className="oyl-moderation__decide">
      {decide ? (
        <>
          <p className="oyl-moderation__reason">
            <label htmlFor={`${id}-decision`}>{NOTICE_STEP_TEXT.decisionLabel}</label>{' '}
            <input
              className="oyl-input"
              id={`${id}-decision`}
              maxLength={MAXIMUM_MODERATION_REASON * 2}
              value={decision}
              onChange={(event) => {
                setDecision(event.target.value);
              }}
            />
          </p>
          <p className="oyl-moderation__reason">
            <label htmlFor={`${id}-log`}>{NOTICE_STEP_TEXT.logLabel}</label>{' '}
            <input
              className="oyl-input"
              id={`${id}-log`}
              inputMode="numeric"
              value={logEntry}
              onChange={(event) => {
                setLogEntry(event.target.value);
              }}
            />
          </p>
        </>
      ) : null}
      <p className="oyl-ride__actions">
        {acknowledge ? (
          <Button
            variant="secondary"
            unavailable={busy}
            onClick={() => void record('acknowledged')}
          >
            {NOTICE_STEP_TEXT.acknowledge}
          </Button>
        ) : null}
        {decide ? (
          <Button variant="secondary" unavailable={busy} onClick={() => void record('decided')}>
            {NOTICE_STEP_TEXT.decide}
          </Button>
        ) : null}
        {tell ? (
          <Button
            variant="secondary"
            unavailable={busy}
            onClick={() => void record('notifier_told')}
          >
            {NOTICE_STEP_TEXT.told}
          </Button>
        ) : null}
      </p>
    </div>
  );
}

/** What the record's link is called, and what the saved file is called (#912). */
export const RECORD_TEXT = {
  heading: 'The record',
  save: 'Prepare the record',
  link: 'Save the record (a JSON file)',
  file: 'moderation-record.json',
  unreadable: 'The record could not be read from the instance. Nothing was saved.',
  help:
    'Every notice and appeal, with when it was received, acknowledged, decided and told, the ' +
    'decision and the log entry of any action. It holds no name, address or words of a notifier, ' +
    'and no rider’s grounds.',
} as const;

/** Saving the record of every notice and appeal (#912). */
function RecordExport({ port }: { readonly port: ModerationPort }): JSX.Element {
  const [href, setHref] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      if (href !== undefined) URL.revokeObjectURL(href);
    },
    [href],
  );
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-record">
      <SectionHeading level={2} id="oyl-moderation-record" help={<p>{RECORD_TEXT.help}</p>}>
        {RECORD_TEXT.heading}
      </SectionHeading>
      <Button
        variant="secondary"
        unavailable={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void port.exportRecord().then((text) => {
            setBusy(false);
            setFailed(text === undefined);
            setHref(
              text === undefined
                ? undefined
                : URL.createObjectURL(new Blob([text], { type: 'application/json' })),
            );
          });
        }}
      >
        {RECORD_TEXT.save}
      </Button>
      {href === undefined ? null : (
        <p>
          <a href={href} download={RECORD_TEXT.file}>
            {RECORD_TEXT.link}
          </a>
        </p>
      )}
      {failed ? (
        <StatusMessage tone="warning" label="Not saved" live>
          {RECORD_TEXT.unreadable}
        </StatusMessage>
      ) : null}
    </section>
  );
}

function Notices({
  port,
  notices,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly notices: readonly ReceivedNotice[] | undefined;
  readonly onDone: Done;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-notices">
      <h2 id="oyl-moderation-notices">Notices</h2>
      <p>{NOTICES_SHORT_TEXT}</p>
      {notices === undefined ? (
        <StatusMessage tone="warning" label="Not shown">
          {NOTICES_UNREADABLE_TEXT}
        </StatusMessage>
      ) : notices.length === 0 ? (
        <p className="oyl-muted">No notice has been received.</p>
      ) : (
        <ul className="oyl-moderation__list oyl-moderation__notices">
          {notices.map((notice) => (
            <li key={notice.noticeId}>
              <h3>Notice {notice.noticeId}</h3>
              <p>Received {when(notice.receivedAt)}.</p>
              {notice.kind === 'intimate_image' ? (
                <StatusMessage tone="warning" label="48 hours">
                  {INTIMATE_IMAGE_DEADLINE_TEXT}
                </StatusMessage>
              ) : null}
              {notice.items.length === 0 ? null : (
                <>
                  <p>The items it names:</p>
                  <ul>
                    {notice.items.map((item) => (
                      <li key={item}>
                        <code>{item}</code>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {notice.location === null ? null : (
                <p className="oyl-moderation__quoted">Where, in their words: {notice.location}</p>
              )}
              <p className="oyl-moderation__quoted">
                Why they think it is illegal: {notice.explanation}
              </p>
              <p>
                {notice.notifierName === null
                  ? 'They gave no name.'
                  : `From ${notice.notifierName}.`}{' '}
                {notice.notifierEmail === null ? (
                  'They gave no email address, so they cannot be told what you decide.'
                ) : (
                  <>
                    Write to them at{' '}
                    {LINKABLE_EMAIL.test(notice.notifierEmail) ? (
                      <a href={`mailto:${notice.notifierEmail}`}>{notice.notifierEmail}</a>
                    ) : (
                      notice.notifierEmail
                    )}
                    .
                  </>
                )}{' '}
                {notice.bonaFide
                  ? 'They stated in good faith that it is accurate and complete.'
                  : 'They did not make the good-faith statement.'}
              </p>
              <p>{noticeProgress(notice)}</p>
              {notice.decision === null ? null : (
                <p className="oyl-moderation__quoted">The decision: {notice.decision}</p>
              )}
              <NoticeSteps port={port} notice={notice} onDone={onDone} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** *Show more* under a paged list (#961), and what it says when the page did not come. */
function More({
  label,
  next,
  failed,
  onMore,
}: {
  readonly label: string;
  readonly next: string | null;
  readonly failed: boolean;
  readonly onMore: (cursor: string) => Promise<void>;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  if (next === null) return null;
  return (
    <>
      {failed ? (
        <StatusMessage tone="warning" label="Not read" live>
          {MORE_UNREADABLE_TEXT}
        </StatusMessage>
      ) : null}
      <p>
        <Button
          variant="secondary"
          unavailable={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            void onMore(next).finally(() => {
              setBusy(false);
            });
          }}
        >
          {label}
        </Button>
      </p>
    </>
  );
}

function Suspended({
  port,
  suspended,
  moreFailed,
  onMore,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly suspended: ModerationList<SuspendedAccount> | undefined;
  readonly moreFailed: boolean;
  readonly onMore: (cursor: string) => Promise<void>;
  readonly onDone: Done;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-suspended">
      <h2 id="oyl-moderation-suspended">Suspended accounts</h2>
      {suspended === undefined ? (
        <StatusMessage tone="warning" label="Not read">
          {SUSPENDED_UNREADABLE_TEXT}
        </StatusMessage>
      ) : suspended.items.length === 0 ? (
        <p className="oyl-muted">No account is suspended.</p>
      ) : (
        <>
          <ul className="oyl-moderation__list oyl-moderation__suspended">
            {suspended.items.map((each) => (
              <li key={each.athleteId}>
                <h3>{each.displayName}</h3>
                <p>
                  Account <code>{each.athleteId}</code>, suspended {when(each.suspendedAt)}.
                </p>
                <Decide
                  label={`Reason for lifting the suspension of ${each.displayName}`}
                  onDone={onDone}
                  choices={[
                    {
                      label: 'Lift the suspension',
                      run: async (reason) => port.actOnAccount(each.athleteId, 'unsuspend', reason),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
          <More
            label="Show more suspended accounts"
            next={suspended.next}
            failed={moreFailed}
            onMore={onMore}
          />
        </>
      )}
    </section>
  );
}

function AnAccount({
  port,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly onDone: Done;
}): JSX.Element {
  const idId = useId();
  const [athleteId, setAthleteId] = useState('');
  const act =
    (action: AccountAction) =>
    async (reason: string, statement?: StatementInput): Promise<ModerationOutcome> =>
      port.actOnAccount(athleteId, action, reason, undefined, statement);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-account">
      <h2 id="oyl-moderation-account">An account</h2>
      <p>Suspend an account, lift its suspension, or hide its display name, by its id.</p>
      <p className="oyl-moderation__reason">
        <label htmlFor={idId}>Account id</label>{' '}
        <input
          className="oyl-input"
          id={idId}
          autoComplete="off"
          spellCheck={false}
          maxLength={128}
          value={athleteId}
          onChange={(event) => {
            setAthleteId(event.target.value);
          }}
        />
      </p>
      <Decide
        label="Reason for the log"
        onDone={onDone}
        choices={[
          {
            label: 'Suspend',
            run: act('suspend'),
            confirm: suspendConfirmation(athleteId),
            statement: { decidedOn: 'own_initiative' },
          },
          { label: 'Lift the suspension', run: act('unsuspend') },
          {
            label: 'Hide the display name',
            run: act('hide_display_name'),
            confirm: hideNameConfirmation(athleteId),
            statement: { decidedOn: 'own_initiative' },
          },
        ]}
      />
    </section>
  );
}

/** The item section's words (#913). */
export const ITEM_TEXT = {
  heading: 'An item',
  lead: 'Hide one room, its route, or a row of a race’s result, by the reference the app shows.',
  label: 'The item’s reference',
  hide: 'Hide the item',
} as const;

/** #962, #913: what hiding `item` is confirmed with. */
export function hideItemConfirmation(item: string): Confirmation {
  return {
    title: item.trim() === '' ? 'Hide this item?' : `Hide ${item.trim()}?`,
    body:
      'Other riders will no longer see it; the rider whose item it is still does, and nothing is ' +
      `deleted. ${LOGGED_SENTENCE}`,
    confirmLabel: 'Hide it',
  };
}

/** Hiding one item by its reference (#913). */
function AnItem({
  port,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly onDone: Done;
}): JSX.Element {
  const id = useId();
  const [item, setItem] = useState('');
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-item">
      <h2 id="oyl-moderation-item">{ITEM_TEXT.heading}</h2>
      <p>{ITEM_TEXT.lead}</p>
      <p className="oyl-moderation__reason">
        <label htmlFor={id}>{ITEM_TEXT.label}</label>{' '}
        <input
          className="oyl-input"
          id={id}
          autoComplete="off"
          spellCheck={false}
          maxLength={160}
          value={item}
          onChange={(event) => {
            setItem(event.target.value);
          }}
        />
      </p>
      <Decide
        label="Reason for the log"
        onDone={onDone}
        choices={[
          {
            label: ITEM_TEXT.hide,
            confirm: hideItemConfirmation(item),
            statement: { decidedOn: 'notice' },
            run: async (reason, statement) =>
              statement === undefined
                ? { kind: 'refused', text: MODERATION_REFUSAL_TEXT.statement }
                : port.hideItem(item, reason, statement),
          },
        ]}
      />
    </section>
  );
}

/** What an invitation's QR code is for: its accessible name (#1190). */
export const INVITE_PICTURE_LABEL = 'Invitation and the instance’s card, for the new rider';

/**
 * Inviting a rider (#1190, ADR 0047 D-6 source 3): the code and THIS device's
 * card as one line and one QR code, and the caution that the card is only as
 * trustworthy as the channel the invitation travels through.
 */
function Invite({ port }: { readonly port: ModerationPort }): JSX.Element {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InviteOutcome | undefined>(undefined);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-invite">
      <h2 id="oyl-moderation-invite">Invite a rider</h2>
      <p className="oyl-moderation__reason">
        <label htmlFor={reasonId}>Reason for the log</label>{' '}
        <input
          className="oyl-input"
          id={reasonId}
          maxLength={MAXIMUM_MODERATION_REASON}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void port.mintInvite(reason).then((minted) => {
            setBusy(false);
            setOutcome(minted);
          });
        }}
      >
        Make an invitation
      </Button>
      {outcome === undefined ? null : outcome.kind === 'refused' ? (
        <StatusMessage tone="warning" label="No invitation" live>
          {outcome.text}
        </StatusMessage>
      ) : (
        <div>
          <KeptVisible>
            <StatusMessage tone="warning" label="Before you send it">
              {INVITE_CARD_CAUTION}
            </StatusMessage>
          </KeptVisible>
          <p>
            Send the new rider this line. It works once, until{' '}
            {new Date(outcome.expiresAt * 1000).toISOString().slice(0, 10)}.
          </p>
          <p>
            <code className="oyl-instance__card">{outcome.invite}</code>
          </p>
          <PairingCode code={outcome.invite} label={INVITE_PICTURE_LABEL} />
        </div>
      )}
    </section>
  );
}

function Log({
  me,
  log,
  moreFailed,
  onMore,
}: {
  readonly me: string;
  readonly log: ModerationList<ModerationLogEntry> | undefined;
  readonly moreFailed: boolean;
  readonly onMore: (cursor: string) => Promise<void>;
}): JSX.Element {
  // Newest first, as the instance pages it (#961).
  const newestFirst = log?.items;
  const who = (id: string): JSX.Element => (id === me ? <>you</> : <code>{id}</code>);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-moderation-log">
      <h2 id="oyl-moderation-log">Moderation log</h2>
      <p>Every moderator action on this instance, newest first. This page cannot change it.</p>
      {newestFirst === undefined ? (
        <StatusMessage tone="warning" label="Not read">
          {MODERATION_LOG_UNREADABLE_TEXT}
        </StatusMessage>
      ) : newestFirst.length === 0 ? (
        <p className="oyl-muted">Nothing has been logged yet.</p>
      ) : (
        <ol className="oyl-moderation__list oyl-moderation__log">
          {newestFirst.map((entry) => (
            <li key={entry.logId}>
              <strong>{actionLabel(entry.action)}</strong>, {when(entry.at)}, by{' '}
              {who(entry.actorAthleteId)}
              {entry.targetAthleteId === null ? null : <>; account {who(entry.targetAthleteId)}</>}
              {entry.reportId === null ? null : <>; report {entry.reportId}</>}. Reason:{' '}
              {entry.reason}
            </li>
          ))}
        </ol>
      )}
      {log === undefined || log.items.length === 0 ? null : (
        <More label="Show older entries" next={log.next} failed={moreFailed} onMore={onMore} />
      )}
    </section>
  );
}

export function ModerationView({
  port,
}: {
  readonly port?: ModerationPort | undefined;
}): JSX.Element {
  const [state, setState] = useState<ModerationRead | undefined>(undefined);
  /** What the last action on this page came to, until the next one starts. */
  const [last, setLast] = useState<ModerationOutcome | undefined>(undefined);
  /** Whether the last *Show more* on each list failed (#961). */
  const [moreFailed, setMoreFailed] = useState({ log: false, suspended: false });
  /**
   * Counts the reads begun: a page asked for under one read is dropped when
   * another has begun since, because it is the next page of a list no longer
   * shown — the read-back after an action starts both lists again.
   */
  const generation = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    if (port === undefined) return;
    generation.current += 1;
    const read = await port.read();
    setMoreFailed({ log: false, suspended: false });
    setState(read);
  }, [port]);

  /** Append the next page of one list to what is shown, or say it did not come. */
  async function more(list: 'log' | 'suspended', cursor: string): Promise<void> {
    if (port === undefined) return;
    const askedUnder = generation.current;
    const next = list === 'log' ? await port.moreLog(cursor) : await port.moreSuspended(cursor);
    if (generation.current !== askedUnder) return;
    setMoreFailed((failed) => ({ ...failed, [list]: next === undefined }));
    if (next === undefined) return;
    setState((current) => {
      if (current?.kind !== 'moderator') return current;
      if (current[list]?.next !== cursor) return current;
      return list === 'log'
        ? {
            ...current,
            log: {
              items: [...(current.log?.items ?? []), ...(next.items as ModerationLogEntry[])],
              next: next.next,
            },
          }
        : {
            ...current,
            suspended: {
              items: [...(current.suspended?.items ?? []), ...(next.items as SuspendedAccount[])],
              next: next.next,
            },
          };
    });
  }

  useEffect(() => {
    void read();
  }, [read]);

  const onDone: Done = {
    starting: () => {
      setLast(undefined);
    },
    finished: async (outcome) => {
      setLast(outcome);
      await read();
    },
  };

  if (port === undefined) {
    return (
      <StatusMessage tone="warning" label="No local store">
        {MODERATION_NO_PORT}
      </StatusMessage>
    );
  }
  if (state === undefined) return <p className="oyl-muted">Reading the instance…</p>;
  if (state.kind !== 'moderator') {
    return (
      <>
        {/* The read-back after an action failed: what the action did is not
            lost with the queues, so it is not pressed again unknowingly. */}
        {last === undefined ? null : last.kind === 'done' ? (
          <StatusMessage tone="success" live>
            {ACTION_DONE_TEXT}
          </StatusMessage>
        ) : (
          <StatusMessage tone="warning" label="Not done" live>
            {last.text}
          </StatusMessage>
        )}
        {/* #1192: a moderator on a device that cannot seal is told why — a
            copy of the app loaded from a website, or no card (ADR 0047 D-11,
            D-14 Q1) — in the gate's own sentence. */}
        <StatusMessage tone="info" label="Not available">
          {state.kind === 'sealed-unavailable' ? state.text : MODERATION_STANDING_TEXT[state.kind]}
        </StatusMessage>
        <p>
          <a href={hrefFor(routeById('instance'))}>Go to the instance screen</a>
        </p>
      </>
    );
  }
  return (
    <div className="oyl-moderation">
      {/* #960: a refusal is said HERE, outside the row it was pressed on, as
          a success is — the read-back may remove that row, and a sentence
          inside it would leave with it, unseen. */}
      {last === undefined ? null : last.kind === 'done' ? (
        <StatusMessage tone="success" live>
          {ACTION_DONE_TEXT}
        </StatusMessage>
      ) : (
        <StatusMessage tone="warning" label="Not done" live>
          {last.text}
        </StatusMessage>
      )}
      {/* #1009, the owner's ruling: that every action is logged, names the
          moderator and outlives an erased account is read BEFORE acting, as
          consent text is, so it stands above the actions — not below them,
          where #993 first put it. Kept visible. `controls-first` allows it
          there by name (§`READ_BEFORE_ACTING`) and requires it there. */}
      <KeptVisible>
        <p className="oyl-note">{MODERATION_IS_LOGGED}</p>
      </KeptVisible>
      <Registrations port={port} registrations={state.registrations} onDone={onDone} />
      <Reports
        port={port}
        me={state.me}
        soleModerator={state.soleModerator}
        reports={state.reports}
        onDone={onDone}
      />
      <Appeals port={port} me={state.me} appeals={state.appeals} onDone={onDone} />
      <Notices port={port} notices={state.notices} onDone={onDone} />
      <RecordExport port={port} />
      <Suspended
        port={port}
        suspended={state.suspended}
        moreFailed={moreFailed.suspended}
        onMore={async (cursor) => more('suspended', cursor)}
        onDone={onDone}
      />
      <AnAccount port={port} onDone={onDone} />
      <AnItem port={port} onDone={onDone} />
      <Invite port={port} />
      <Log
        me={state.me}
        log={state.log}
        moreFailed={moreFailed.log}
        onMore={async (cursor) => more('log', cursor)}
      />
    </div>
  );
}
