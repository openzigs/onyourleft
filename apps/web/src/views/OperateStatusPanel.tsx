// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

import { ButtonLink } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { OperateDisk, OperateStatus, OperateStatusRead } from '../instance/operate-port';

/**
 * **Status** (#2604, epic #2601): the first section of the owner's Operate
 * area, read-only, from `GET /v1/operate/status`. Every value on it is a
 * count, a closed name or the deployed commit, checked by the port before it
 * gets here (`instance/operate-port.ts` §`statusFrom`): nothing secret,
 * nobody's name or id, no path on the host.
 *
 * ## Compared with main: a link, never a request
 *
 * The epic's decision 3, accepted by the owner on 2026-11-14: the deployed
 * commit is compared with this repository's `main` by GitHub's own compare
 * page, which the owner OPENS. Neither the app nor the instance asks GitHub
 * anything; the link is drawn only for a full 40-hex commit of an instance
 * running this repository's source, and opens outside the app
 * (`ButtonLink` §`external`). `privacy/no-network.test.ts` holds that no new
 * module sends anything.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

/** This repository, whose `main` a deployed commit is compared with. */
const REPOSITORY = 'https://github.com/openzigs/onyourleft';

const COMMIT = /^[0-9a-f]{40}$/;

/** GitHub's page comparing `commit` with `main`, or `undefined` when there is nothing to compare. */
export function compareWithMainUrl(
  status: Pick<OperateStatus, 'commit' | 'upstream'>,
): string | undefined {
  const { commit } = status;
  if (!status.upstream || commit === null || !COMMIT.test(commit)) return undefined;
  return `${REPOSITORY}/compare/${commit}...main`;
}

/** Said in place of the panel when the owner's read of it did not come. */
export const STATUS_UNREADABLE_TEXT =
  'The instance’s status could not be read, so it is not shown here.';

/** The last-backup field until a snapshot is recorded (#2606). */
export const NOT_RECORDED = 'not recorded';

/** The tunnel's state when the operator has not said where to ask (the epic's decision 4). */
export const TUNNEL_NOT_KNOWN = 'not known';

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** A length of time in its two largest units: "3 days 4 hours", "17 minutes". */
export function durationText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const rest = hours % 24;
    return rest === 0
      ? plural(days, 'day', 'days')
      : `${plural(days, 'day', 'days')} ${plural(rest, 'hour', 'hours')}`;
  }
  if (hours > 0) {
    const rest = minutes % 60;
    return rest === 0
      ? plural(hours, 'hour', 'hours')
      : `${plural(hours, 'hour', 'hours')} ${plural(rest, 'minute', 'minutes')}`;
  }
  if (minutes > 0) return plural(minutes, 'minute', 'minutes');
  return 'less than a minute';
}

/** Bytes in decimal units, as a disk's maker counts them: "412 GB", "1.5 TB". */
export function bytesText(bytes: number): string {
  const units: readonly [number, string][] = [
    [1e12, 'TB'],
    [1e9, 'GB'],
    [1e6, 'MB'],
    [1e3, 'kB'],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${unit}`;
    }
  }
  return `${String(bytes)} bytes`;
}

const HOLDS_TEXT: Readonly<Record<OperateDisk['holds'], string>> = {
  database: 'Disk holding the database',
  blobs: 'Disk holding the blobs',
  database_and_blobs: 'Disk holding the database and blobs',
};

const MIGRATIONS_TEXT: Readonly<Record<OperateStatus['checks']['migrations'], string>> = {
  'at-head': 'up to date',
  migrating: 'being migrated now',
  behind: 'behind this build: run migrate',
  ahead: 'ahead of this build',
  unknown: 'not known',
};

const REGISTRATION_TEXT: Readonly<Record<OperateStatus['registration'], string>> = {
  open: 'open: anybody may join',
  approval: 'approval: a moderator approves each account',
  invite: 'invite: only with an invite code',
  closed: 'closed: nobody new may join',
};

const KEYS_TEXT: Readonly<Record<OperateStatus['keys'], string>> = {
  ready: 'ready',
  'no-secret': 'no secret key set',
  'no-origin': 'no origin set',
  'no-keys': 'no keys made yet',
  unreadable: 'not readable with the secret key set',
  busy: 'busy: an operator command holds them',
};

const OFF_BOX_TEXT: Readonly<Record<NonNullable<OperateStatus['lastBackup']>['offBox'], string>> = {
  copied: 'its off-box copy succeeded',
  failed: 'its off-box copy FAILED',
  'not-configured': 'no off-box copy is set up',
};

function Fact({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Disk({ disk }: { readonly disk: OperateDisk }): JSX.Element {
  return (
    <Fact name={HOLDS_TEXT[disk.holds]}>
      {bytesText(disk.freeBytes)} free of {bytesText(disk.totalBytes)}
      {disk.low ? (
        <StatusMessage tone="warning" label="Low">
          Less than a tenth of this disk is free.
        </StatusMessage>
      ) : null}
    </Fact>
  );
}

function LastBackup({
  backup,
  now,
}: {
  readonly backup: OperateStatus['lastBackup'];
  readonly now: number;
}): JSX.Element {
  if (backup === null) return <Fact name="Last backup">{NOT_RECORDED}</Fact>;
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(backup.at)) / 1000));
  // Older than two of the backup service's intervals: at least one run was missed.
  const stale = ageSeconds > 2 * backup.intervalSeconds;
  return (
    <Fact name="Last backup">
      {`${backup.at.slice(0, 16).replace('T', ' ')} UTC`}, {durationText(ageSeconds)} ago;{' '}
      {OFF_BOX_TEXT[backup.offBox]}.
      {stale ? (
        <StatusMessage tone="warning" label="Stale">
          {`That is more than twice the backup interval of ${durationText(backup.intervalSeconds)}: a backup was missed.`}
        </StatusMessage>
      ) : null}
    </Fact>
  );
}

function tunnelText(tunnel: OperateStatus['tunnel']): string {
  if (tunnel.state === 'ready') {
    return `ready, ${plural(tunnel.connections, 'connection', 'connections')}`;
  }
  return tunnel.state === 'not_ready' ? 'not ready' : TUNNEL_NOT_KNOWN;
}

const okText = (ok: boolean): string => (ok ? 'ok' : 'not ok');

function Shown({
  status,
  now,
}: {
  readonly status: OperateStatus;
  readonly now: number;
}): JSX.Element {
  const compare = compareWithMainUrl(status);
  const { athletes, analysis } = status.counts;
  return (
    <>
      {status.ready ? (
        <p>The instance is up and ready for riders.</p>
      ) : (
        <StatusMessage tone="warning" label="Not ready">
          The instance is up but not ready for riders. The checks below say which failed.
        </StatusMessage>
      )}
      {/* What is deployed, and its one control, first: a phone's fold is 783 px
          and the facts below run past it (#666, `controls-first.browser.spec.ts`). */}
      <dl className="oyl-operate__status">
        <Fact name="Version">{status.version}</Fact>
        <Fact name="Deployed commit">
          {status.commit === null ? 'not named' : <code>{status.commit}</code>}
        </Fact>
      </dl>
      {compare === undefined ? null : (
        <p>
          <ButtonLink variant="secondary" external href={compare}>
            Compare with main
          </ButtonLink>
        </p>
      )}
      <dl className="oyl-operate__status">
        <Fact name="Database">{okText(status.checks.database)}</Fact>
        <Fact name="Migrations">{MIGRATIONS_TEXT[status.checks.migrations]}</Fact>
        <Fact name="Rooms">{okText(status.checks.rooms)}</Fact>
        <Fact name="Up for">{durationText(status.uptimeSeconds)}</Fact>
        {status.disk.length === 0 ? (
          <Fact name="Disk">not known</Fact>
        ) : (
          status.disk.map((disk) => <Disk key={disk.holds} disk={disk} />)
        )}
        <LastBackup backup={status.lastBackup} now={now} />
        <Fact name="Tunnel">{tunnelText(status.tunnel)}</Fact>
        <Fact name="Registration">{REGISTRATION_TEXT[status.registration]}</Fact>
        <Fact name="Accounts">
          {`${String(athletes.active)} active, ${String(athletes.pending)} awaiting approval, ${String(athletes.suspended)} suspended`}
        </Fact>
        <Fact name="Rooms open">{String(status.counts.roomsOpen)}</Fact>
        <Fact name="Analysis jobs">
          {`${String(analysis.queued)} waiting, ${String(analysis.running)} running`}
        </Fact>
        <Fact name="Instance keys">{KEYS_TEXT[status.keys]}</Fact>
      </dl>
    </>
  );
}

/** The Status section: the instance's state, or a sentence saying it could not be read. */
export function OperateStatusPanel({
  status,
  now = Date.now,
}: {
  readonly status: OperateStatusRead;
  /** Unix milliseconds, for the last backup's age. */
  readonly now?: () => number;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-status">
      <h2 id="oyl-operate-status">Status</h2>
      {status.kind === 'status' ? (
        <Shown status={status} now={now()} />
      ) : (
        <StatusMessage tone="warning" label="Not read" live>
          {STATUS_UNREADABLE_TEXT}
        </StatusMessage>
      )}
    </section>
  );
}
