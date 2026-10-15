// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type JSX } from 'react';

import type { RiderStatement, StatementsPort } from '../instance/statements-port';

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
 * ⚠️ Draft wording awaiting the owner's approval.
 */

/** The section's heading. */
export const STATEMENTS_HEADING = 'Decisions about your account';

/** What was done, as a heading, by the instance's name for it. */
export const RESTRICTION_TEXT: Readonly<Record<string, string>> = {
  suspend: 'Your account was suspended',
  hide_display_name: 'Your display name was hidden',
  hide_item: 'Something you shared was hidden',
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

/** A moment, in UTC, so the screen says the same thing wherever it is read. */
function when(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function OneStatement({ statement }: { readonly statement: RiderStatement }): JSX.Element {
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
          'To ask us to look again, write to the person who runs this instance. It has not published a contact address.'
        ) : (
          <>
            To ask us to look again, write to{' '}
            <a href={`mailto:${statement.contactEmail}`}>{statement.contactEmail}</a>.
          </>
        )}{' '}
        {COURT_TEXT}
      </p>
    </li>
  );
}

export function StatementsPanel({ port }: { readonly port: StatementsPort }): JSX.Element | null {
  const [statements, setStatements] = useState<readonly RiderStatement[]>([]);
  useEffect(() => {
    let cancelled = false;
    void port.read().then((read) => {
      if (!cancelled && read.kind === 'statements') setStatements(read.statements);
    });
    return () => {
      cancelled = true;
    };
  }, [port]);
  if (statements.length === 0) return null;
  return (
    <section className="oyl-panel" aria-labelledby="oyl-instance-statements">
      <h2 id="oyl-instance-statements">{STATEMENTS_HEADING}</h2>
      <ul className="oyl-moderation__list">
        {statements.map((statement) => (
          <OneStatement key={statement.statementId} statement={statement} />
        ))}
      </ul>
    </section>
  );
}
