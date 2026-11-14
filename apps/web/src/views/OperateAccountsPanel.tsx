// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { ButtonLink } from '../design/Button';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type { OperateStatus, OperateStatusRead } from '../instance/operate-port';
import { hrefFor, hrefForModerationSection, routeById } from '../shell/routes';

/**
 * **Accounts** (#2605, epic #2601): the second section of the owner's Operate
 * area. It points to what already exists rather than rebuilding it.
 *
 * - **Counts and links, no controls of its own.** How many accounts await
 *   approval and how many are suspended, from the same `GET /v1/operate/status`
 *   answer as Status (#2604), each with a link that opens the Moderation
 *   screen (#955) at that section — and, when the instance takes riders by
 *   invitation, at its invitation. Approving, refusing, lifting a suspension
 *   and making an invitation are done THERE, over the moderation routes; this
 *   section sends nothing (`OperateAccountsPanel.test.tsx` holds it to links).
 * - **The registration mode is shown, not changed** (the epic's decision 2,
 *   accepted by the owner on 2026-11-14): its name, one sentence on what it
 *   means (`docs/moderation.md` §"Who can join"), and the steps to change it
 *   on the host. No route changes it.
 *
 * Drawn for the owner only: `OperateView` draws nothing but the not-the-owner
 * sentence for anybody else, the deputy included, who keeps the Moderation
 * screen itself through the Instance screen.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

export type RegistrationMode = OperateStatus['registration'];

/**
 * Every registration mode, in words: the ONE table both Status's short line
 * and this section's sentence are read from. Keyed by the type the port
 * accepts, so a mode added there and not here is a type error, and
 * `OperateAccountsPanel.test.tsx` holds it to the instance's own
 * `REGISTRATION_MODES` (`apps/instance/src/config.ts`).
 */
export const REGISTRATION_MODE_TEXT: Readonly<
  Record<RegistrationMode, { readonly short: string; readonly meaning: string }>
> = {
  approval: {
    short: 'approval: a moderator approves each account',
    meaning:
      'A new rider’s account waits until a moderator approves it; until then other riders cannot see it.',
  },
  invite: {
    short: 'invite: only with an invite code',
    meaning:
      'A new rider joins only with a single-use invitation from a moderator, good for seven days.',
  },
  open: {
    short: 'open: anybody may join',
    meaning: 'Anybody who reaches the instance gets an active account at once.',
  },
  closed: {
    short: 'closed: nobody new may join',
    meaning: 'Nobody new can join.',
  },
};

/** The modes, in the order the steps name them. */
const MODES = Object.keys(REGISTRATION_MODE_TEXT) as RegistrationMode[];

/** What every mode has in common, behind the mode heading's ⓘ. */
export const MODERATORS_ALWAYS_JOIN =
  'In every mode, the keys named as owner and deputy sign in with an active account.';

/** Said in place of the counts when the owner's read of the status did not come. */
export const ACCOUNTS_UNREADABLE_TEXT =
  'The account counts could not be read from the instance, so they are not shown here.';

/** The section's one drawn line (#1013, `a11y/section-lines.ts`). */
export const ACCOUNTS_LINE = 'Approve, refuse and invite on the Moderation screen.';

/** What this section is for, behind its ⓘ. */
export const ACCOUNTS_PURPOSE =
  'Approving, refusing, lifting a suspension and inviting are done on the Moderation screen. ' +
  'This section counts the accounts and links there.';

function Counted({ status }: { readonly status: OperateStatus }): JSX.Element {
  const { pending, suspended } = status.counts.athletes;
  const mode = status.registration;
  return (
    <>
      <p>
        <strong>{`${String(pending)} awaiting approval`}</strong>
      </p>
      <p>
        <ButtonLink variant="secondary" href={hrefForModerationSection('approvals')}>
          Go to approvals
        </ButtonLink>
      </p>
      <p>
        <strong>{`${String(suspended)} suspended`}</strong>
      </p>
      <p>
        <ButtonLink variant="secondary" href={hrefForModerationSection('suspended')}>
          Go to suspended accounts
        </ButtonLink>
      </p>
      <SectionHeading level={3} help={<p>{MODERATORS_ALWAYS_JOIN}</p>}>
        {`Registration mode: ${mode}`}
      </SectionHeading>
      <p>{REGISTRATION_MODE_TEXT[mode].meaning}</p>
      {mode === 'invite' ? (
        <p>
          <ButtonLink variant="secondary" href={hrefForModerationSection('invite')}>
            Go to invitations
          </ButtonLink>
        </p>
      ) : null}
      <h3>Changing the mode</h3>
      <p>This app shows the mode and cannot change it. On the instance’s host:</p>
      <ol>
        <li>
          Open the <code>.env</code> file beside <code>compose.yaml</code>.
        </li>
        <li>
          Set <code>OYL_INSTANCE_REGISTRATION</code> to{' '}
          {MODES.map((each, index) => (
            <span key={each}>
              <code>{each}</code>
              {index === MODES.length - 1 ? '' : index === MODES.length - 2 ? ' or ' : ', '}
            </span>
          ))}
          .
        </li>
        <li>
          In that folder, run <code>docker compose up -d instance</code>, which starts the instance
          again with the new mode. <code>docker compose restart</code> does not read{' '}
          <code>.env</code> again.
        </li>
      </ol>
    </>
  );
}

/** The Accounts section: counts, the mode, and links to the Moderation screen. */
export function OperateAccountsPanel({
  status,
}: {
  readonly status: OperateStatusRead;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-accounts">
      <SectionHeading level={2} id="oyl-operate-accounts" help={<p>{ACCOUNTS_PURPOSE}</p>}>
        Accounts
      </SectionHeading>
      <p>{ACCOUNTS_LINE}</p>
      {status.kind === 'status' ? (
        <Counted status={status} />
      ) : (
        <>
          <StatusMessage tone="warning" label="Not read" live>
            {ACCOUNTS_UNREADABLE_TEXT}
          </StatusMessage>
          <p>
            <ButtonLink variant="secondary" href={hrefFor(routeById('moderation'))}>
              Go to the Moderation screen
            </ButtonLink>
          </p>
        </>
      )}
    </section>
  );
}
