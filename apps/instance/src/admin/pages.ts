// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The admin pages' markup** (#2645, ADR 0069 D-6): the frame, the shell
 * every signed-in page is drawn in, the sign-in page, Status and the operator
 * log. Pure: data in, HTML out — nothing here reads a store, a clock or the
 * network, so `apps/web/src/a11y/admin-pages.a11y.test.ts` audits exactly
 * what `admin.ts` serves by calling these, and the app's Status panel and
 * this Status page can be drawn from one fixture and compared.
 *
 * - Everything put into a page goes through `html.ts` §`escapeHtml`, the
 *   instance's name included.
 * - No inline style and no script: the stylesheet is `/admin/admin.css`
 *   (`style.ts`), and every page works with no script at all.
 * - A skip link, one `h1`, and the banner, navigation and main landmarks.
 * - **Status' words are `@onyourleft/operate-text`'s alone** (ADR 0069 D-7):
 *   {@link statusBody} draws {@link statusRows}, as the app's
 *   `OperateStatusPanel` does, and says nothing of its own.
 * - **A log entry is shown only if it is in the log's closed vocabulary**
 *   (`store/sql-store.ts` §`OPERATOR_DETAILS`, the grammar the app's
 *   `instance/operate-port.ts` holds it to): an action, a source and an
 *   outcome the instance writes, and a `detail` that fits THAT action's
 *   words. Any other row says it could not be shown, and shows nothing of
 *   itself — so a row that somehow held a key or a coordinate is not drawn.
 *
 * Nothing here renders a token, a code, a key or a coordinate.
 *
 * ⚠️ The log's action labels are the app's (`apps/web/src/views/OperateView.tsx`
 * §`ACTION_LABEL`), restated: `apps/instance` may not import `apps/web`.
 * Moving them to `packages/operate-text` is a relicensing (ADR 0069 D-7), so
 * it is not done here.
 */

import {
  COMPARE_WITH_MAIN_LABEL,
  compareWithMainUrl,
  DOCKER_DESKTOP_DISK_TEXT,
  momentText,
  STATUS_NOT_READY_TEXT,
  STATUS_PURPOSE_TEXT,
  STATUS_READY_TEXT,
  STATUS_UNREADABLE_TEXT,
  statusRows,
  type OperateRow,
  type OperateStatusAnswer,
} from '@onyourleft/operate-text';

import { escapeHtml } from '../html.ts';
import {
  OPERATOR_ACTIONS,
  operatorDetailFits,
  type OperatorAction,
  type OperatorSource,
} from '../store/sql-store.ts';
import { sectionLinks } from './admin-routes.ts';

/** The frame: the stylesheet linked, never inline. `body` is markup the caller escaped. */
export function adminPage(title: string, body: string, before = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/admin/admin.css">
</head>
<body>
${before}<main id="main">
${body}
</main>
</body>
</html>
`;
}

/** What the shell says of the instance and the session it is drawn for. */
export interface ShellView {
  /** What the operator calls the instance, or `null`. */
  readonly name: string | null;
  /** The page's own path, so its link is marked current. */
  readonly path: string;
  /** How the session was opened. */
  readonly strength: 'code' | 'passkey';
  /** Which listener it was opened on. */
  readonly listener: 'tunnel' | 'loopback';
  /** The session's synchronizer token, for the Sign out form. */
  readonly csrf: string;
}

const STRENGTH_TEXT: Readonly<Record<ShellView['strength'], string>> = {
  code: 'a one-time code',
  passkey: 'a passkey',
};

const LISTENER_TEXT: Readonly<Record<ShellView['listener'], string>> = {
  tunnel: 'through the tunnel',
  loopback: 'on the server machine',
};

const instanceName = (name: string | null): string => (name === null ? 'This instance' : name);

/**
 * A signed-in page: a skip link, the banner (the instance's name, how the
 * session was opened and on which listener, the section links and Sign out),
 * and `main` with the page's one `h1`. `body` is markup the caller escaped.
 */
export function shellPage(view: ShellView, heading: string, body: string): string {
  const links = sectionLinks()
    .map(({ section, path }) => {
      const current = path === view.path ? ' aria-current="page"' : '';
      return `<li><a href="${escapeHtml(path)}"${current}>${escapeHtml(section)}</a></li>`;
    })
    .join('\n');
  const banner = `<a class="skip" href="#main">Skip to the page</a>
<header class="shell">
<p class="name">${escapeHtml(instanceName(view.name))}</p>
<p>Signed in as the instance’s owner with ${STRENGTH_TEXT[view.strength]}, ${LISTENER_TEXT[view.listener]}.</p>
<nav class="sections" aria-label="Admin sections">
<ul>
${links}
</ul>
</nav>
<form method="post" action="/admin/sign-out">
<input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
<button type="submit">Sign out</button>
</form>
</header>
`;
  return adminPage(
    `${heading} — ${instanceName(view.name)}`,
    `<h1>${escapeHtml(heading)}</h1>
${body}
<p class="hint">This session ends after 15 minutes without use, and 2 hours after you signed in.</p>`,
    banner,
  );
}

/** The sign-in page, with or without the sentence that a code was not accepted. */
export function signInPage(name: string | null, problem: boolean): string {
  const described = problem ? ' aria-describedby="code-problem"' : '';
  const title = name === null ? 'this instance' : name;
  return adminPage(
    'Sign in',
    `<h1>Sign in to the admin pages of ${escapeHtml(title)}</h1>
<p>Only the instance’s owner can sign in. On the server machine, run <code>node src/operator/cli.ts admin-code</code> (in the home deployment, <code>docker compose exec instance node src/operator/cli.ts admin-code</code>) and type the code it prints. A code works once, for 10 minutes.</p>
<form method="post" action="/admin/sign-in">
<label for="code">One-time code</label>
${problem ? '<p class="problem" id="code-problem">That code was not accepted. A code works once, for 10 minutes: mint a new one on the server machine.</p>\n' : ''}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${described}>
<button type="submit">Sign in</button>
</form>`,
  );
}

function fact(row: OperateRow): string {
  const value = row.code ? `<code>${escapeHtml(row.value)}</code>` : escapeHtml(row.value);
  const warning =
    row.warning === null
      ? ''
      : `<p class="warning"><strong>${escapeHtml(row.warning.label)}:</strong> ${escapeHtml(row.warning.text)}</p>`;
  return `<div><dt>${escapeHtml(row.label)}</dt><dd>${value}${warning}</dd></div>`;
}

/**
 * Status' body: what `GET /v1/operate/status` answered, as operate-text's
 * rows, or the sentence that it could not be read. `now` is Unix
 * milliseconds, for the last backup's age.
 */
export function statusBody(status: OperateStatusAnswer | undefined, now: number): string {
  const purpose = `<p class="hint">${escapeHtml(STATUS_PURPOSE_TEXT)}</p>
<p class="hint">${escapeHtml(DOCKER_DESKTOP_DISK_TEXT)}</p>`;
  if (status === undefined) {
    return `<p class="problem">${escapeHtml(STATUS_UNREADABLE_TEXT)}</p>\n${purpose}`;
  }
  const ready = status.ready
    ? `<p>${escapeHtml(STATUS_READY_TEXT)}</p>`
    : `<p class="warning"><strong>Not ready:</strong> ${escapeHtml(STATUS_NOT_READY_TEXT)}</p>`;
  // A link the owner opens: the instance asks GitHub nothing (#2601's decision 3).
  const url = compareWithMainUrl(status);
  const compare =
    url === undefined
      ? ''
      : `<p><a href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(COMPARE_WITH_MAIN_LABEL)}</a></p>\n`;
  const facts = statusRows(status, now).map(fact).join('\n');
  return `${ready}
${compare}<dl class="facts">
${facts}
</dl>
${purpose}`;
}

/** One operator log entry as `GET /v1/operate/log` answers it, before it is checked. */
export interface LogEntryAnswer {
  readonly id: unknown;
  readonly at: unknown;
  readonly source: unknown;
  readonly action: unknown;
  readonly detail: unknown;
  readonly outcome: unknown;
}

/** What the log page draws: a page of entries and whether there is an older one. */
export type LogView =
  | {
      readonly kind: 'page';
      readonly entries: readonly LogEntryAnswer[];
      /** The route's cursor for the next, older page, or `null` at the oldest. */
      readonly older: string | null;
      /** Whether this is the newest page, which has no link back to it. */
      readonly newest: boolean;
    }
  /** The route did not answer with a page. */
  | { readonly kind: 'unreadable' }
  /** The browser sent a cursor this instance did not write. */
  | { readonly kind: 'bad-cursor' };

/** The app's words for each action (`OperateView.tsx` §`ACTION_LABEL`). */
const ACTION_LABEL: Readonly<Record<OperatorAction, string>> = {
  migrate: 'Database migrated',
  backup: 'Backup taken',
  backup_requested: 'Backup asked for',
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
  analysis_settings_set: 'AI settings changed',
  analysis_settings_cleared: 'AI settings returned to .env',
  analysis_model_checked: 'Model checked for tool calling',
  admin_code_minted: 'Admin sign-in code made',
  admin_sign_in: 'Signed in to the admin pages',
  admin_refused: 'Admin sign-in attempts refused',
};

/** The app's words for each source (`OperateView.tsx` §`SOURCE_TEXT`). */
const SOURCE_TEXT: Readonly<Record<OperatorSource, string>> = {
  app: 'from the app',
  cli: 'from the command line on the host',
  admin_tunnel: 'from the admin pages, through the tunnel',
  admin_loopback: 'from the admin pages, on the server machine',
};

const OUTCOMES: readonly unknown[] = ['done', 'refused', 'failed'];

/** Said in place of an entry that is not in the log's closed vocabulary. */
export const LOG_ENTRY_NOT_SHOWN_TEXT =
  'This entry could not be shown: it is not written in the log’s own words, so nothing of it is drawn here.';

/** Said in place of the log when the owner's read of it did not come (the app's words). */
export const LOG_UNREADABLE_TEXT =
  'The operator log could not be read from the instance, so it is not shown here.';

const isAction = (value: unknown): value is OperatorAction =>
  typeof value === 'string' && (OPERATOR_ACTIONS as readonly string[]).includes(value);

const isSource = (value: unknown): value is OperatorSource =>
  typeof value === 'string' && Object.hasOwn(SOURCE_TEXT, value);

/** `value` as an ISO 8601 moment in UTC, exactly as `Date` writes one — or `undefined`. */
function isoMoment(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString() === value ? value : undefined;
}

/** One entry's line, or the sentence that it could not be shown. */
function entryLine(entry: LogEntryAnswer): string {
  const at = isoMoment(entry.at);
  const { action, source, detail, outcome } = entry;
  const fits =
    at !== undefined &&
    isAction(action) &&
    isSource(source) &&
    OUTCOMES.includes(outcome) &&
    (detail === null || (typeof detail === 'string' && operatorDetailFits(action, detail)));
  if (!fits) return `<li>${escapeHtml(LOG_ENTRY_NOT_SHOWN_TEXT)}</li>`;
  const said = detail === null ? '' : ` (<code>${escapeHtml(detail)}</code>)`;
  return `<li><strong>${escapeHtml(ACTION_LABEL[action])}</strong>, ${escapeHtml(momentText(at))}, ${escapeHtml(SOURCE_TEXT[source])}: ${escapeHtml(outcome as string)}${said}.</li>`;
}

/** The log page's body: a page of entries, newest first, and the links to older and newest. */
export function logBody(view: LogView): string {
  const newest = '<a href="/admin/log">Newest entries</a>';
  if (view.kind === 'unreadable') {
    return `<p class="problem">${escapeHtml(LOG_UNREADABLE_TEXT)}</p>`;
  }
  if (view.kind === 'bad-cursor') {
    return `<p class="problem">That page of the log could not be read: the address does not name a page this instance wrote.</p>\n<p>${newest}</p>`;
  }
  const intro =
    '<p>Every action taken as the instance’s operator, newest first. Nothing here can be changed.</p>';
  if (view.entries.length === 0) {
    return `${intro}\n<p>${view.newest ? 'Nothing has been logged yet.' : 'There are no older entries.'}</p>${view.newest ? '' : `\n<p>${newest}</p>`}`;
  }
  const links = [
    ...(view.older === null
      ? []
      : [`<a href="/admin/log?cursor=${encodeURIComponent(view.older)}">Older entries</a>`]),
    ...(view.newest ? [] : [newest]),
  ];
  return `${intro}
<ol class="log">
${view.entries.map(entryLine).join('\n')}
</ol>
${links.length === 0 ? '<p>These are the oldest entries.</p>' : `<p>${links.join(' · ')}</p>`}`;
}
