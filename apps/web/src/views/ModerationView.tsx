// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { PairingCode } from '../camera/PairingCode';
import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { KeptVisible } from '../design/KeptVisible';
import { StatusMessage } from '../design/StatusMessage';
import {
  INVITE_CARD_CAUTION,
  isConflict,
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
  type SuspendedAccount,
} from '../instance/moderation-port';
import { hrefFor, routeById } from '../shell/routes';

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
 * Declared a conflict and left open: no control is drawn on it, because the
 * instance would refuse the moderator deciding it, and with one moderator
 * nobody else can.
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

/** Said on a report about the moderator reading it — #905. */
export const REPORT_CONFLICT_TEXT =
  'This report is about you, so it is a conflict and you may not decide it. It stays open in ' +
  'this queue.';

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
  dismiss_report: 'Dismissed a report',
  activate_moderator_key: 'A moderator’s key activated its own account',
  mint_invite: 'Made an invitation',
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
  readonly run: (reason: string) => Promise<ModerationOutcome>;
  /** Asked first when present; the action runs only once it is confirmed. */
  readonly confirm?: Confirmation;
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

  async function run(choice: Choice): Promise<void> {
    setBusy(true);
    onDone.starting();
    const answer = await choice.run(reason);
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
              if (choice.confirm === undefined) void run(choice);
              else setConfirming(choice);
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
  reports,
  onDone,
}: {
  readonly port: ModerationPort;
  readonly me: string;
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
              {isConflict(report, me) ? (
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
                      run: async (reason) =>
                        port.actOnAccount(
                          report.targetAthleteId,
                          'suspend',
                          reason,
                          report.reportId,
                        ),
                    },
                    {
                      label: 'Hide its display name',
                      confirm: hideNameConfirmation(report.targetAthleteId),
                      run: async (reason) =>
                        port.actOnAccount(
                          report.targetAthleteId,
                          'hide_display_name',
                          reason,
                          report.reportId,
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
    async (reason: string): Promise<ModerationOutcome> =>
      port.actOnAccount(athleteId, action, reason);
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
          { label: 'Suspend', run: act('suspend'), confirm: suspendConfirmation(athleteId) },
          { label: 'Lift the suspension', run: act('unsuspend') },
          {
            label: 'Hide the display name',
            run: act('hide_display_name'),
            confirm: hideNameConfirmation(athleteId),
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
        <StatusMessage tone="info" label="Not available">
          {MODERATION_STANDING_TEXT[state.kind]}
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
      <Reports port={port} me={state.me} reports={state.reports} onDone={onDone} />
      <Suspended
        port={port}
        suspended={state.suspended}
        moreFailed={moreFailed.suspended}
        onMore={async (cursor) => more('suspended', cursor)}
        onDone={onDone}
      />
      <AnAccount port={port} onDone={onDone} />
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
