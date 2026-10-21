// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import {
  MAXIMUM_APPEAL_GROUNDS,
  type RiderAppeal,
  type RiderStatement,
  type StatementsPort,
} from '../instance/statements-port';

/**
 * **Decisions about your account** (#910): every statement of reasons the
 * rider's instance keeps about them, on the Instance screen — whether the
 * device is signed in or, because the account was suspended, cannot be
 * (`instance/statements-port.ts` opens the way-out session for that).
 *
 * Each statement is laid out in DSA Art. 17(3)'s parts and the wording of
 * `docs/moderation/statement-of-reasons.md`: what was done and for how long,
 * why and what it was decided on, that no automated means were used, the law
 * or the terms relied on, and what the rider can do about it. A device with
 * no statement shows nothing: there is nothing to explain.
 *
 * A SUSPENDED rider is also offered their data (#1517): the instance's
 * export of the account to save, and the account's deletion there —
 * suspension never stops a rider getting or erasing their own data. Neither
 * touches the rides on this device (ADR 0036 D-3 (b)).
 *
 * ⚠️ Draft wording awaiting the owner's approval.
 */

/** The section's heading. */
export const STATEMENTS_HEADING = 'Decisions about your account';

/** What was done, as a heading, by the instance's name for it. */
export const RESTRICTION_TEXT: Readonly<Record<string, string>> = {
  suspend: 'Your account was suspended',
  hide_display_name: 'Your display name was hidden',
  hide_item: 'Something you shared was hidden',
  // #1384: ⚠️ a draft label for the owner's approval.
  remove_from_room: 'You were removed from a room',
};

/** What it was decided on. */
export const DECIDED_ON_TEXT = {
  report: 'We acted on a report from another rider.',
  notice: 'We acted on a notice sent to us.',
  own_initiative: 'We found it ourselves.',
} as const;

export const NO_AUTOMATED_MEANS_TEXT =
  'No automated means were used to find this or to decide: a person, the moderator, read it and decided.';

export const CONFLICT_TEXT =
  'This decision was taken by the moderator in a matter that involves them. They declare that ' +
  'conflict of interest here, and the decision is logged.';

export const NOTHING_DELETED_TEXT =
  'Nothing was deleted: your rides are still on this device, and on the instance.';

export const COURT_TEXT =
  'You can also take the decision to a court under the law of your country. Out-of-court ' +
  'dispute settlement is not available for this decision.';

/** The appeal's own words (#911). */
export const APPEAL_TEXT = {
  label: 'Ask us to look again: why is the decision wrong?',
  send: 'Send the appeal',
  sent: 'Your appeal was sent. The moderator will decide it and you will read the answer here.',
  waiting: 'The moderator has not decided it yet.',
  upheld: 'The decision stands.',
  reversed: 'The decision was reversed.',
  conflict:
    'The moderator who decided your appeal took the decision you appealed. They declare that ' +
    'conflict of interest here, and it is logged.',
} as const;

/** A suspended rider's own data on the instance (#1517). ⚠️ Draft wording awaiting the owner's approval. */
export const YOUR_DATA_TEXT = {
  heading: 'Your data on this instance',
  intro:
    'Being suspended does not stop you taking your data out of this instance or deleting your ' +
    'account on it. Neither touches the rides on this device.',
  save: 'Prepare a copy of your data',
  link: 'Save the copy (a JSON file)',
  file: 'onyourleft-instance-account.json',
  unreadable: 'The instance did not answer, so nothing was saved. Try again later.',
  erase: 'Delete my account on this instance',
  confirm:
    'This deletes your account and everything this instance holds about you, and cannot be ' +
    'undone. It cannot reach a copy anyone already saved, or another instance. The moderation ' +
    'log is kept. The rides on this device stay here.',
  confirmErase: 'Delete it',
  keep: 'Keep my account',
  erased:
    'Your account on this instance was deleted, and this device is no longer signed in to it. ' +
    'Your rides are still on this device.',
} as const;

/** A moment, in UTC, so the screen says the same thing wherever it is read. */
function when(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** An appeal already filed, and what came of it (#911). */
function AppealStatus({ appeal }: { readonly appeal: RiderAppeal }): JSX.Element {
  return (
    <div className="oyl-statement__appeal">
      <p>
        You appealed on {when(appeal.filedAt)}.{' '}
        {appeal.outcome === null
          ? APPEAL_TEXT.waiting
          : `It was decided on ${when(appeal.decidedAt ?? appeal.filedAt)}. ${
              appeal.outcome === 'upheld' ? APPEAL_TEXT.upheld : APPEAL_TEXT.reversed
            }`}
      </p>
      <p className="oyl-moderation__quoted">Your grounds: {appeal.grounds}</p>
      {appeal.decision === null ? null : (
        <p className="oyl-moderation__quoted">The moderator’s answer: {appeal.decision}</p>
      )}
      {appeal.outcome !== null && appeal.moderatorConflict ? <p>{APPEAL_TEXT.conflict}</p> : null}
    </div>
  );
}

/** Appealing one decision (#911): the grounds, and the one button that sends them. */
function AppealForm({
  port,
  statementId,
  onFiled,
}: {
  readonly port: StatementsPort;
  readonly statementId: number;
  readonly onFiled: () => void;
}): JSX.Element {
  const id = useId();
  const [grounds, setGrounds] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  return (
    <div className="oyl-statement__appeal">
      <p>
        <label htmlFor={id}>{APPEAL_TEXT.label}</label>
        <textarea
          className="oyl-input"
          id={id}
          maxLength={MAXIMUM_APPEAL_GROUNDS}
          value={grounds}
          onChange={(event) => {
            setGrounds(event.target.value);
          }}
        />
      </p>
      <Button
        variant="secondary"
        unavailable={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void port.appeal(statementId, grounds).then((outcome) => {
            setBusy(false);
            if (outcome.kind === 'filed') {
              setRefusal(undefined);
              onFiled();
            } else {
              setRefusal(outcome.text);
            }
          });
        }}
      >
        {APPEAL_TEXT.send}
      </Button>
      {refusal === undefined ? null : (
        <StatusMessage tone="warning" label="Not sent" live>
          {refusal}
        </StatusMessage>
      )}
    </div>
  );
}

function OneStatement({
  statement,
  port,
  onFiled,
}: {
  readonly statement: RiderStatement;
  readonly port: StatementsPort;
  readonly onFiled: () => void;
}): JSX.Element {
  return (
    <li>
      <h3>
        {RESTRICTION_TEXT[statement.restriction] ?? statement.restriction}, {when(statement.at)}
      </h3>
      <p>
        {statement.endsAt === null
          ? 'It has no end date.'
          : `It ends on ${when(statement.endsAt)}.`}{' '}
        It applies everywhere on this instance. {NOTHING_DELETED_TEXT}
      </p>
      <p className="oyl-moderation__quoted">Why: {statement.facts}</p>
      <p>
        {DECIDED_ON_TEXT[statement.decidedOn]}{' '}
        {statement.notifierNamed === null
          ? ''
          : `It was sent by ${statement.notifierNamed}, named because you could not see why without it.`}
      </p>
      {statement.moderatorConflict ? <p>{CONFLICT_TEXT}</p> : null}
      <p>{NO_AUTOMATED_MEANS_TEXT}</p>
      {statement.legalGround === null ? null : (
        <p className="oyl-moderation__quoted">The law we relied on: {statement.legalGround}</p>
      )}
      {statement.termsGround === null ? null : (
        <p className="oyl-moderation__quoted">The terms we relied on: {statement.termsGround}</p>
      )}
      <p>
        {statement.contactEmail === null ? (
          'You can appeal below. The person who runs this instance has not published a contact address.'
        ) : (
          <>
            You can appeal below, or write to{' '}
            <a href={`mailto:${statement.contactEmail}`}>{statement.contactEmail}</a>.
          </>
        )}{' '}
        {COURT_TEXT}
      </p>
      {statement.appeal === null ? (
        <AppealForm port={port} statementId={statement.statementId} onFiled={onFiled} />
      ) : (
        <AppealStatus appeal={statement.appeal} />
      )}
    </li>
  );
}

/** Saving the instance's copy of the account, and deleting it there (#1517). */
function YourData({ port }: { readonly port: StatementsPort }): JSX.Element {
  const [href, setHref] = useState<string | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [erased, setErased] = useState(false);
  useEffect(
    () => () => {
      if (href !== undefined) URL.revokeObjectURL(href);
    },
    [href],
  );
  if (erased) {
    return (
      <StatusMessage tone="success" live>
        {YOUR_DATA_TEXT.erased}
      </StatusMessage>
    );
  }
  return (
    <div className="oyl-statement__appeal">
      <h3>{YOUR_DATA_TEXT.heading}</h3>
      <p>{YOUR_DATA_TEXT.intro}</p>
      <Button
        variant="secondary"
        unavailable={busy}
        onClick={() => {
          if (busy) return;
          setBusy(true);
          void port.exportAccount().then((text) => {
            setBusy(false);
            setUnreadable(text === undefined);
            setHref(
              text === undefined
                ? undefined
                : URL.createObjectURL(new Blob([text], { type: 'application/json' })),
            );
          });
        }}
      >
        {YOUR_DATA_TEXT.save}
      </Button>
      {href === undefined ? null : (
        <p>
          <a href={href} download={YOUR_DATA_TEXT.file}>
            {YOUR_DATA_TEXT.link}
          </a>
        </p>
      )}
      {unreadable ? (
        <StatusMessage tone="warning" label="Not saved" live>
          {YOUR_DATA_TEXT.unreadable}
        </StatusMessage>
      ) : null}
      {confirming ? (
        <>
          <p>{YOUR_DATA_TEXT.confirm}</p>
          <Button
            variant="danger"
            unavailable={busy}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              void port.eraseAccount().then((outcome) => {
                setBusy(false);
                if (outcome.kind === 'erased') {
                  setErased(true);
                } else {
                  setRefusal(outcome.text);
                }
              });
            }}
          >
            {YOUR_DATA_TEXT.confirmErase}
          </Button>{' '}
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(false);
              setRefusal(undefined);
            }}
          >
            {YOUR_DATA_TEXT.keep}
          </Button>
        </>
      ) : (
        <p>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {YOUR_DATA_TEXT.erase}
          </Button>
        </p>
      )}
      {refusal === undefined ? null : (
        <StatusMessage tone="warning" label="Not deleted" live>
          {refusal}
        </StatusMessage>
      )}
    </div>
  );
}

export function StatementsPanel({ port }: { readonly port: StatementsPort }): JSX.Element | null {
  const [statements, setStatements] = useState<readonly RiderStatement[]>([]);
  const [sent, setSent] = useState(false);
  const read = useCallback(async (): Promise<void> => {
    const answer = await port.read();
    if (answer.kind === 'statements') setStatements(answer.statements);
  }, [port]);
  useEffect(() => {
    void read();
  }, [read]);
  if (statements.length === 0) return null;
  return (
    <section className="oyl-panel" aria-labelledby="oyl-instance-statements">
      <h2 id="oyl-instance-statements">{STATEMENTS_HEADING}</h2>
      {sent ? (
        <StatusMessage tone="success" live>
          {APPEAL_TEXT.sent}
        </StatusMessage>
      ) : null}
      <ul className="oyl-moderation__list">
        {statements.map((statement) => (
          <OneStatement
            key={statement.statementId}
            statement={statement}
            port={port}
            onFiled={() => {
              setSent(true);
              void read();
            }}
          />
        ))}
      </ul>
      {statements.some((statement) => statement.restriction === 'suspend') ? (
        <YourData port={port} />
      ) : null}
    </section>
  );
}
