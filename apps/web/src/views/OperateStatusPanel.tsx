// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  COMPARE_WITH_MAIN_LABEL,
  compareWithMainUrl,
  DOCKER_DESKTOP_DISK_TEXT,
  STATUS_NOT_READY_TEXT,
  STATUS_PURPOSE_TEXT,
  STATUS_READY_TEXT,
  STATUS_UNREADABLE_TEXT,
  statusRows,
  type OperateRow,
} from '@onyourleft/operate-text';
import type { JSX } from 'react';

import { ButtonLink } from '../design/Button';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import type { OperateStatus, OperateStatusRead } from '../instance/operate-port';

/**
 * **Status** (#2604, epic #2601): the first section of the owner's Operate
 * area, read-only, from `GET /v1/operate/status`. Every value on it is a
 * count, a closed name or the deployed commit, checked by the port before it
 * gets here (`instance/operate-port.ts` §`statusFrom`): nothing secret,
 * nobody's name or id, no path on the host.
 *
 * ## One set of words, the app's and the admin pages'
 *
 * Since #2644 (ADR 0069 D-7) every sentence and every row this section draws
 * is `@onyourleft/operate-text`'s: {@link statusRows} turns the port's checked
 * answer into rows of label and value, and this file only draws them, so the
 * instance's admin Status page (#2645) cannot say anything else.
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

/**
 * Re-exported so the names this panel's tests read are the ones they read
 * before #2644; the declarations are the package's alone
 * (`operate-text-moved.test.ts`).
 */
export {
  bytesText,
  compareWithMainUrl,
  DOCKER_DESKTOP_DISK_TEXT,
  durationText,
  NOT_RECORDED,
  STATUS_UNREADABLE_TEXT,
  TUNNEL_NOT_KNOWN,
} from '@onyourleft/operate-text';

function Fact({ row }: { readonly row: OperateRow }): JSX.Element {
  return (
    <div>
      <dt>{row.label}</dt>
      <dd>
        {row.code ? <code>{row.value}</code> : row.value}
        {row.warning === null ? null : (
          <StatusMessage tone="warning" label={row.warning.label}>
            {row.warning.text}
          </StatusMessage>
        )}
      </dd>
    </div>
  );
}

function Shown({
  status,
  now,
  timeZone,
}: {
  readonly status: OperateStatus;
  readonly now: number;
  readonly timeZone: string;
}): JSX.Element {
  const compare = compareWithMainUrl(status);
  return (
    <>
      {status.ready ? (
        <p>{STATUS_READY_TEXT}</p>
      ) : (
        <StatusMessage tone="warning" label="Not ready">
          {STATUS_NOT_READY_TEXT}
        </StatusMessage>
      )}
      {/* Its one control first, then what is deployed: a phone's fold is 783 px
          and the facts run past it, and a section may lay out at most 130 px of
          prose before its first control (#666, `controls-first.browser.spec.ts`). */}
      {compare === undefined ? null : (
        <p>
          <ButtonLink variant="secondary" external href={compare}>
            {COMPARE_WITH_MAIN_LABEL}
          </ButtonLink>
        </p>
      )}
      <dl className="oyl-operate__status">
        {statusRows(status, now, timeZone).map((row) => (
          <Fact key={row.label} row={row} />
        ))}
      </dl>
    </>
  );
}

/** The Status section: the instance's state, or a sentence saying it could not be read. */
export function OperateStatusPanel({
  status,
  now = Date.now,
  timeZone,
}: {
  readonly status: OperateStatusRead;
  /** Unix milliseconds, for the last backup's age. */
  readonly now?: () => number;
  /** The IANA zone its moments are drawn in, named (#2917): the device's, from `OperateView`. */
  readonly timeZone: string;
}): JSX.Element {
  return (
    <section className="oyl-panel" aria-labelledby="oyl-operate-status">
      <SectionHeading
        level={2}
        id="oyl-operate-status"
        help={
          <>
            <p>{STATUS_PURPOSE_TEXT}</p>
            <p>{DOCKER_DESKTOP_DISK_TEXT}</p>
          </>
        }
      >
        Status
      </SectionHeading>
      {status.kind === 'status' ? (
        <Shown status={status} now={now()} timeZone={timeZone} />
      ) : (
        <StatusMessage tone="warning" label="Not read" live>
          {STATUS_UNREADABLE_TEXT}
        </StatusMessage>
      )}
    </section>
  );
}
