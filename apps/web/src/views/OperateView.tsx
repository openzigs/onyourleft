// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type {
  OperatePort,
  OperateStanding,
  OperatorLogEntry,
  OperatorLogRead,
} from '../instance/operate-port';
import { hrefFor, routeById } from '../shell/routes';

/**
 * **Operate** (#2603, epic #2601): the owner-only area of the app for running
 * the instance this device is signed in to. Its first content is the operator
 * log (#2602); the sections later sub-issues fill are listed, not yet drawn.
 *
 * ## Shown to the owner only
 *
 * The route is not in the navigation. It is reached from the Instance screen,
 * whose link to it is drawn only when {@link OperatePort.standing} says this
 * device's account is the instance's owner. Anybody who opens its address
 * anyway is told only that their own account is not the owner — which the
 * instance's own `not_found` already told them — and the log is never asked
 * for: the standing read is the one request made. The instance checks every
 * Operate route itself; this page only declines to draw what it would refuse.
 *
 * ## What is shown is read back
 *
 * Every row comes from the instance's answer to {@link OperatePort.log}, a
 * page at a time, newest first, with *Show older entries* while the instance
 * says there is more (as `ModerationView` pages, #961). Nothing on this page
 * writes to the log.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** What this area is for, and who sees it. */
export const OPERATE_PURPOSE =
  'This is where you run your instance from the app. Only the instance’s owner sees it: the ' +
  'instance refuses everyone else, the deputy moderator included.';

/** The sections later work fills (#2604–#2614), named so the owner knows what is coming. */
export const OPERATE_SECTIONS_TO_COME: readonly string[] = [
  'Status',
  'Accounts',
  'Backups',
  'AI backend',
  'Rooms',
  'Instance keys',
  'Recent errors',
];

export const OPERATE_NO_PORT =
  'This app cannot reach an instance’s Operate area here, because this browser has no local ' +
  'store to keep a sign-in in.';

/** What a device that may not see the area is told — about its own account only. */
export const OPERATE_STANDING_TEXT: Readonly<Record<Exclude<OperateStanding, 'owner'>, string>> = {
  'not-owner':
    'Your account is not this instance’s owner. Only the account its operator names as owner ' +
    'can use this page.',
  'signed-out':
    'This device is not signed in to an instance. Connect from the instance screen first.',
  unreachable: 'The instance did not answer, so there is nothing to show.',
  'no-keys':
    'This page is reached only over the sealed connection to your instance, and this device ' +
    'cannot make one now. It needs the instance’s card, and a copy of the app loaded from a ' +
    'website cannot seal. An instance with no OYL_INSTANCE_SECRET_KEY has no Operate area.',
};

/** Said in place of the log when the owner's read of it did not come. */
export const OPERATOR_LOG_UNREADABLE_TEXT =
  'The operator log could not be read from the instance, so it is not shown here.';

/** Said under the log when *Show older entries* did not come. */
export const OPERATOR_LOG_MORE_UNREADABLE_TEXT =
  'The next page of the log could not be read from the instance. Try again.';

/** The instance's names for its actions, in words (`apps/instance` §`OPERATOR_ACTIONS`). */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  migrate: 'Database migrated',
  backup: 'Backup taken',
  restore: 'Restored from a backup',
  room_open: 'Room opened',
  model_key_set: 'Hosted model key set',
  model_key_clear: 'Hosted model key cleared',
  instance_key_init: 'Instance keys made',
  instance_key_rotate: 'Encryption key rotated',
  instance_key_rotate_identity: 'Identity key rotated',
  instance_key_reset: 'Instance keys reset',
  load_accounts_add: 'Load-test accounts added',
  load_accounts_erase: 'Load-test accounts erased',
  account_erase: 'Account erased',
};

/** An action in words; one a newer instance added is shown by its own name. */
export function operatorActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action.replaceAll('_', ' ');
}

const SOURCE_TEXT = {
  app: 'from the app',
  cli: 'from the command line on the host',
} as const;

/** A moment, in UTC, so the screen says the same thing wherever it is read. */
function when(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** What the page holds: being read, a standing that sees nothing, or the owner's log. */
type Shown =
  | { readonly kind: 'reading' }
  | { readonly kind: 'not-shown'; readonly standing: Exclude<OperateStanding, 'owner'> }
  | { readonly kind: 'owner'; readonly log: OperatorLogRead };

function LogEntry({ entry }: { readonly entry: OperatorLogEntry }): JSX.Element {
  return (
    <li>
      <strong>{operatorActionLabel(entry.action)}</strong>, {when(entry.at)},{' '}
      {SOURCE_TEXT[entry.source]}: {entry.outcome}
      {entry.detail === null ? null : (
        <>
          {' '}
          (<code>{entry.detail}</code>)
        </>
      )}
      .
    </li>
  );
}

function OperatorLog({
  log,
  moreFailed,
  onMore,
}: {
  readonly log: OperatorLogRead;
  readonly moreFailed: boolean;
  readonly onMore: (cursor: string) => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-log">
      <h2 id="oyl-operate-log">Operator log</h2>
      <p>Every operator action, from this app or the host’s command line, newest first.</p>
      {log.kind !== 'page' ? (
        <StatusMessage tone="warning" label="Not read">
          {OPERATOR_LOG_UNREADABLE_TEXT}
        </StatusMessage>
      ) : log.entries.length === 0 ? (
        <p className="oyl-muted">Nothing has been logged yet.</p>
      ) : (
        <ol className="oyl-operate__log">
          {log.entries.map((entry) => (
            <LogEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
      {log.kind === 'page' && log.next !== null ? (
        <>
          {moreFailed ? (
            <StatusMessage tone="warning" label="Not read" live>
              {OPERATOR_LOG_MORE_UNREADABLE_TEXT}
            </StatusMessage>
          ) : null}
          <p>
            <Button
              variant="secondary"
              unavailable={busy}
              onClick={() => {
                const cursor = log.next;
                if (busy || cursor === null) return;
                setBusy(true);
                void onMore(cursor).finally(() => {
                  setBusy(false);
                });
              }}
            >
              Show older entries
            </Button>
          </p>
        </>
      ) : null}
    </section>
  );
}

export function OperateView({ port }: { readonly port?: OperatePort | undefined }): JSX.Element {
  const [shown, setShown] = useState<Shown>({ kind: 'reading' });
  const [moreFailed, setMoreFailed] = useState(false);
  /** Counts the reads begun: a page asked for under an older read is dropped. */
  const generation = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    if (port === undefined) return;
    generation.current += 1;
    const standing = await port.standing();
    // The standing read is the only request made for anybody but the owner.
    if (standing !== 'owner') {
      setShown({ kind: 'not-shown', standing });
      return;
    }
    const log = await port.log();
    setMoreFailed(false);
    setShown(
      log.kind === 'page' || log.kind === 'unreachable'
        ? { kind: 'owner', log }
        : { kind: 'not-shown', standing: log.kind },
    );
  }, [port]);

  useEffect(() => {
    void read();
  }, [read]);

  /** Append the next page to what is shown, or say it did not come. */
  async function more(cursor: string): Promise<void> {
    if (port === undefined) return;
    const askedUnder = generation.current;
    const next = await port.log(cursor);
    if (generation.current !== askedUnder) return;
    setMoreFailed(next.kind !== 'page');
    if (next.kind !== 'page') return;
    setShown((current) => {
      if (current.kind !== 'owner' || current.log.kind !== 'page') return current;
      if (current.log.next !== cursor) return current;
      return {
        kind: 'owner',
        log: {
          kind: 'page',
          entries: [...current.log.entries, ...next.entries],
          next: next.next,
        },
      };
    });
  }

  if (port === undefined) {
    return (
      <StatusMessage tone="warning" label="No local store">
        {OPERATE_NO_PORT}
      </StatusMessage>
    );
  }
  if (shown.kind === 'reading') return <p className="oyl-muted">Reading the instance…</p>;
  if (shown.kind === 'not-shown') {
    return (
      <>
        <StatusMessage tone="info" label="Not available">
          {OPERATE_STANDING_TEXT[shown.standing]}
        </StatusMessage>
        <p>
          <a href={hrefFor(routeById('instance'))}>Go to the instance screen</a>
        </p>
      </>
    );
  }
  return (
    <div className="oyl-operate">
      <p>{OPERATE_PURPOSE}</p>
      <OperatorLog
        log={shown.log}
        moreFailed={moreFailed}
        onMore={async (cursor) => more(cursor)}
      />
      <section className="oyl-panel" aria-labelledby="oyl-operate-to-come">
        <h2 id="oyl-operate-to-come">Still to come</h2>
        <p>These sections will be added here:</p>
        <ul>
          {OPERATE_SECTIONS_TO_COME.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
