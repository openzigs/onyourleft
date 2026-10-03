// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import { StatusMessage } from '../design/StatusMessage';
import {
  isConflict,
  MAXIMUM_MODERATION_REASON,
  type AccountAction,
  type ModerationLogEntry,
  type ModerationOutcome,
  type ModerationPort,
  type ModerationRead,
  type OpenReport,
  type PendingRegistration,
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

interface Choice {
  readonly label: string;
  readonly run: (reason: string) => Promise<ModerationOutcome>;
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
  const [outcome, setOutcome] = useState<ModerationOutcome | undefined>(undefined);

  async function run(choice: Choice): Promise<void> {
    setBusy(true);
    setOutcome(undefined);
    onDone.starting();
    const answer = await choice.run(reason);
    setBusy(false);
    // A success is said by the page rather than here: the row this was pressed
    // on may leave the screen once the queue is read again. A refusal is said
    // here, beside what was pressed.
    if (answer.kind === 'done') setReason('');
    else setOutcome(answer);
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
            setOutcome(undefined);
          }}
        />
      </p>
      <p className="oyl-ride__actions">
        {choices.map((choice) => (
          <Button
            key={choice.label}
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void run(choice);
            }}
          >
            {choice.label}
          </Button>
        ))}
      </p>
      {outcome === undefined || outcome.kind === 'done' ? null : (
        <StatusMessage tone="warning" label="Not done" live>
          {outcome.text}
        </StatusMessage>
      )}
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
          { label: 'Suspend', run: act('suspend') },
          { label: 'Lift the suspension', run: act('unsuspend') },
          { label: 'Hide the display name', run: act('hide_display_name') },
        ]}
      />
    </section>
  );
}

function Log({
  me,
  entries,
}: {
  readonly me: string;
  readonly entries: readonly ModerationLogEntry[] | undefined;
}): JSX.Element {
  // Newest first: the instance keeps it oldest first.
  const newestFirst = entries === undefined ? undefined : [...entries].reverse();
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
        <ol className="oyl-moderation__list oyl-moderation__log" reversed>
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

  const read = useCallback(async (): Promise<void> => {
    if (port === undefined) return;
    setState(await port.read());
  }, [port]);

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
      {last?.kind === 'done' ? (
        <StatusMessage tone="success" live>
          {ACTION_DONE_TEXT}
        </StatusMessage>
      ) : null}
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
      <AnAccount port={port} onDone={onDone} />
      <Log me={state.me} entries={state.log} />
    </div>
  );
}
