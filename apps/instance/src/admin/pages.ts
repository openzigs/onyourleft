// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The admin pages' markup** (#2645, ADR 0069 D-6): the frame, the shell
 * every signed-in page is drawn in, the sign-in page, Status, the operator
 * log, the owner's passkeys (#2642's page, drawn in the shell), and since
 * #2648 the AI backend, in operate-text's words as the app's panel is. Pure: data in, HTML out — nothing here reads a store, a clock or the
 * network, so `apps/web/src/a11y/admin-pages.a11y.test.ts` audits exactly
 * what `admin.ts` serves by calling these, and the app's Status panel and
 * this Status page can be drawn from one fixture and compared.
 *
 * - Everything put into a page goes through `html.ts` §`escapeHtml`, the
 *   instance's name included.
 * - No inline style and no inline script: the stylesheet is `/admin/admin.css`
 *   (`style.ts`), and every page reads with no script at all. The one script,
 *   `/admin/passkey.js` (`passkey-script.ts`), is LINKED on the two pages with
 *   a passkey ceremony — the sign-in and Passkeys — and on no other.
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
 * Nothing here renders a token, a code, a key or a coordinate — with one
 * exception, ADR 0080 D-3 and D-7's: {@link cardCodePart} draws a claim or an
 * invite code beside the card, as a QR and as text, for a page on the
 * loopback listener only (#2783).
 *
 * ⚠️ The log's action labels are the app's (`apps/web/src/views/OperateView.tsx`
 * §`ACTION_LABEL`), restated: `apps/instance` may not import `apps/web`.
 * Moving them to `packages/operate-text` is a relicensing (ADR 0069 D-7), so
 * it is not done here.
 */

import {
  noProblemsText,
  PROBLEMS_HELD_TEXT,
  PROBLEMS_UNREADABLE_TEXT,
  problemSentence,
  problemsSinceText,
  RAW_LINE_LABEL,
  KEYS_CARD_TEXT,
  KEYS_CLI_COMMANDS,
  KEYS_CLI_TEXT,
  KEYS_FINGERPRINT_TEXT,
  KEYS_UNREADABLE_TEXT,
  keyFactRows,
  ROTATE_BUSY_TEXT,
  ROTATE_KEY_TEXT,
  ROTATE_NOT_DONE_TEXT,
  ROTATE_TYPE_TEXT,
  type OperateKeysWord,
  END_ROOM_CONFIRM_TEXT,
  END_ROOM_REASON_LABEL,
  endRoomTypeText,
  NO_ROOM_TEXT,
  ROOM_END_REASON_TEXT,
  ROOM_END_REASONS,
  ROOM_NOT_ENDED_TEXT,
  roomLine,
  ROOMS_LIST_TEXT,
  ROOMS_NAMES_ONLY_TEXT,
  ROOMS_UNREADABLE_TEXT,
  type OperateRoomKind,
  type OperateRoomPhase,
  type OperateRoomVisibility,
  BACK_UP_NOW_CONFIRM_TEXT,
  BACKUP_FAILED_TEXT,
  BACKUP_NOT_ASKED_TEXT,
  BACKUP_WAITING_TEXT,
  backupFactRows,
  backupLine,
  BACKUPS_LIST_TEXT,
  BACKUPS_UNREADABLE_TEXT,
  backupsStaleText,
  NO_BACKUP_TEXT,
  NO_SNAPSHOT_TO_RESTORE_TEXT,
  OFF_BOX_FAILED_TEXT,
  RESTORE_HEADING,
  RESTORE_ONE_OFF_TEXT,
  RESTORE_PREFACE_TEXT,
  RESTORE_WHY_TEXT,
  restoreSteps,
  type OperateBackupFacts,
  type OperateBackupLine,
  ACCOUNTS_UNREADABLE_TEXT,
  accountStandingLines,
  MODERATORS_ALWAYS_JOIN,
  REGISTRATION_CHANGE_HEADING,
  REGISTRATION_CHANGE_STEPS,
  REGISTRATION_MODE_TEXT,
  AI_JOBS_HEADING,
  AI_LINE,
  AI_NOW_HEADING,
  AI_OFFERS_HEADING,
  AI_OWN_KEY_HEADING,
  AI_PICK_HEADING,
  AI_PURPOSE,
  AI_RETURN_HEADING,
  AI_UNREADABLE_TEXT,
  aiNowLines,
  CHECK_BUTTON,
  CHECK_TEXT,
  CHECK_UNREADABLE_TEXT,
  HOSTED_OFFER_SENTENCE,
  jobCountLines,
  jobLine,
  JOBS_UNREADABLE_TEXT,
  MODEL_LOAD_WARNING,
  MODEL_SAVE_FAILED_TEXT,
  MODEL_SAVED_TEXT,
  modelLine,
  MODELS_LEGEND,
  MODELS_UNREADABLE_TEXT,
  NO_JOBS_TEXT,
  NO_MODELS_TEXT,
  OFFER_FAILED_TEXT,
  OFFER_HOSTED_LABEL,
  OFFER_LOCAL_LABEL,
  OFFER_OTHERS_LABEL,
  OFFER_SAVED_TEXT,
  ownKeyText,
  READ_AGAIN_BUTTON,
  RETURN_BUTTON,
  RETURN_FAILED_TEXT,
  RETURN_SENTENCE,
  RETURNED_TEXT,
  SAVE_BUTTON,
  SAVE_NEEDS_CHECK,
  SERVER_STATE_TEXT,
  type OperateAnalysisAnswer,
  type OperateJobsAnswer,
  type OperateLine,
  type OperateLocalModel,
  type OperateLocalModelsAnswer,
  type OperateToolCheckOutcome,
  COMPARE_WITH_MAIN_LABEL,
  compareWithMainUrl,
  DOCKER_DESKTOP_DISK_TEXT,
  momentText,
  STATUS_NOT_READY_TEXT,
  STATUS_PURPOSE_TEXT,
  STATUS_READY_TEXT,
  STATUS_UNREADABLE_TEXT,
  statusRows,
  withoutUserinfo,
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
import { cardWithCode, qrSvg } from './qr.ts';

/** The one script, linked on the pages with a passkey ceremony; never inline. */
export const PASSKEY_SCRIPT_TAG = '<script src="/admin/passkey.js" defer></script>\n';

/**
 * The frame: the stylesheet linked, never inline, and with `script` the
 * passkey script linked too. `body` and `before` are markup the caller escaped;
 * `signedOut` draws the narrower column of the sign-in page.
 */
export function adminPage(
  title: string,
  body: string,
  before = '',
  script = false,
  signedOut = false,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/admin/admin.css">
${script ? PASSKEY_SCRIPT_TAG : ''}</head>
<body${signedOut ? ' class="signed-out"' : ''}>
${before}<main id="main">
${body}
</main>
</body>
</html>
`;
}

/**
 * The On Your Left mark (#2771): the arrow and the name, drawn here rather
 * than served as the app's image, so the header needs no request of its own.
 * The arrow is decoration; the name is the text.
 */
const WORDMARK =
  '<span class="wordmark"><svg class="mark" viewBox="0 0 28 16" aria-hidden="true" focusable="false"><path d="M0 6h17V0l11 8-11 8v-6H0z"/></svg>On Your Left</span>';

/**
 * A part of a page drawn as a card; `danger` for a change that is hard to
 * undo, set apart. A `div`, not a `section`: an unnamed section is a landmark
 * to the audit (`a11y/audit.ts` §`landmarks-are-distinguishable`), and the
 * card's heading already says what it is.
 */
export function card(inner: string, tone: 'card' | 'danger' = 'card'): string {
  return `<div class="panel${tone === 'danger' ? ' danger' : ''}">\n${inner.trimEnd()}\n</div>\n`;
}

/**
 * A moment in a table's When column (#2771): operate-text's own words for it
 * (`2026-11-14 09:30 UTC`, the app panels' — ADR 0069 D-7), in a `<time>` that
 * carries the moment itself for a browser or a reader that wants it. A value
 * that is not a moment is drawn as words alone, escaped.
 */
export function readableMoment(iso: string): string {
  const words = escapeHtml(momentText(iso));
  return Number.isFinite(Date.parse(iso))
    ? `<time datetime="${escapeHtml(iso)}">${words}</time>`
    : words;
}

/**
 * A table inside its own focusable scroll region, named by its caption, as
 * the app's `design/ScrollTable.tsx` draws one (`a11y/audit.ts`
 * §`table-in-scroll-region`): on a phone the columns scroll in the box and
 * never widen the page. `id` names the caption, unique on its page; `rows`
 * are `<tr>` markup the caller escaped.
 */
function scrollTable(
  id: string,
  caption: string,
  heads: readonly string[],
  rows: readonly string[],
): string {
  return `<div class="scroll" role="region" aria-labelledby="${id}" tabindex="0">
<table>
<caption id="${id}">${escapeHtml(caption)}</caption>
<thead><tr>${heads.map((head) => `<th scope="col">${escapeHtml(head)}</th>`).join('')}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</div>
`;
}

/** An operate-text line that goes on from a first part drawn elsewhere: its leading ", " dropped. */
function restHtml(rest: OperateLine): string {
  const [first, ...others] = rest;
  return lineHtml(typeof first === 'string' ? [first.replace(/^, /, ''), ...others] : rest);
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

/** What a code session may do, said beside how it was opened (ADR 0069 Q-A). */
const STRENGTH_LIMIT: Readonly<Record<ShellView['strength'], string>> = {
  code: ' A one-time code’s session can read every page and add one passkey, and changes nothing else.',
  passkey: '',
};

const LISTENER_TEXT: Readonly<Record<ShellView['listener'], string>> = {
  tunnel: 'through the tunnel',
  loopback: 'on the server machine',
};

const instanceName = (name: string | null): string => (name === null ? 'This instance' : name);

/**
 * A signed-in page: a skip link, the banner (the instance's name, how the
 * session was opened and on which listener, the section links and Sign out),
 * and `main` with the page's one `h1`. `body` is markup the caller escaped;
 * `script` links the passkey script, for a page with a passkey ceremony.
 */
export function shellPage(view: ShellView, heading: string, body: string, script = false): string {
  const links = sectionLinks()
    .map(({ section, path }) => {
      const current = path === view.path ? ' aria-current="page"' : '';
      return `<li><a href="${escapeHtml(path)}"${current}>${escapeHtml(section)}</a></li>`;
    })
    .join('\n');
  const banner = `<a class="skip" href="#main">Skip to the page</a>
<header class="shell">
<div class="shell-inner">
<div class="bar">
<p class="brand">${WORDMARK} <span class="name">${escapeHtml(instanceName(view.name))}</span></p>
<form class="sign-out" method="post" action="/admin/sign-out" aria-label="Sign out">
<input type="hidden" name="csrf" value="${escapeHtml(view.csrf)}">
<button type="submit" class="secondary">Sign out</button>
</form>
</div>
<p class="session">Signed in as the instance’s owner with ${STRENGTH_TEXT[view.strength]}, ${LISTENER_TEXT[view.listener]}.${STRENGTH_LIMIT[view.strength]}</p>
<nav class="sections" aria-label="Admin sections">
<ul>
${links}
</ul>
</nav>
</div>
</header>
`;
  return adminPage(
    `${heading} — ${instanceName(view.name)}`,
    `<h1>${escapeHtml(heading)}</h1>
${body}
<p class="hint">This session ends after 15 minutes without use, and 2 hours after you signed in.</p>`,
    banner,
    script,
  );
}

/** What the sign-in page says above its forms. */
export type SignInNotice = 'code-refused' | 'passkey-refused' | 'enrolled' | null;

/**
 * The sign-in page (#2641, #2642): with a passkey, and with a one-time code,
 * and the notice a refusal or an enrolment left. The passkey form is drawn
 * `hidden` and shown by the linked script where the browser can use one.
 */
export function signInPage(name: string | null, notice: SignInNotice): string {
  const codeProblem = notice === 'code-refused';
  const described = codeProblem ? ' aria-describedby="code-problem"' : '';
  const title = name === null ? 'this instance' : name;
  const top =
    notice === 'enrolled'
      ? '<p class="notice" role="status">Your passkey was added, and the one-time code’s session has ended. Sign in with the passkey now. A new passkey can read every page and changes nothing until you confirm it on the server machine: <code>operator admin-passkeys confirm &lt;id&gt;</code>, with the id <code>operator admin-passkeys list</code> shows.</p>\n'
      : notice === 'passkey-refused'
        ? '<p class="problem" role="alert">That passkey was not accepted, so you are not signed in. Try again, or sign in with a one-time code.</p>\n'
        : '';
  return adminPage(
    'Sign in',
    `<h1>Sign in to the admin pages of ${escapeHtml(title)}</h1>
${top}<p>Only the instance’s owner can sign in.</p>
${card(`<h2>With a passkey</h2>
<form method="post" action="/admin/sign-in/passkey" data-passkey="sign-in" data-passkey-supported hidden>
<button type="submit">Sign in with a passkey</button>
<p data-passkey-status role="status"></p>
</form>
<p data-passkey-unsupported>This browser cannot use a passkey on this page, or the page’s script is blocked. Sign in with a one-time code instead.</p>`)}${card(`<h2>With a one-time code</h2>
<p>On the server machine, run <code>node src/operator/cli.ts admin-code</code> (in the home deployment, <code>docker compose exec instance node src/operator/cli.ts admin-code</code>) and type the code it prints. A code works once, for 10 minutes. A code session can read every page and add one passkey; it changes nothing else.</p>
<form method="post" action="/admin/sign-in">
<label for="code">One-time code</label>
${codeProblem ? '<p class="problem" id="code-problem">That code was not accepted. A code works once, for 10 minutes: mint a new one on the server machine.</p>\n' : ''}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${described}>
<button type="submit">Sign in</button>
</form>`)}`,
    `<header class="shell">
<div class="shell-inner">
<p class="brand">${WORDMARK}</p>
</div>
</header>
`,
    true,
    true,
  );
}

/** One of the owner's passkeys as the Passkeys page lists it. */
export interface PasskeyView {
  readonly id: string;
  readonly label: string;
  /** Unix seconds. */
  readonly enrolledAt: number;
  /** Unix seconds, or `null`: never. */
  readonly lastUsedAt: number | null;
  readonly rpId: string;
  /**
   * What it may do here: added under another owner key, added for another
   * RP ID, unconfirmed (reads only), or confirmed (reads and changes).
   */
  readonly standing: 'other-owner' | 'other-host' | 'unconfirmed' | 'confirmed';
}

/** What the Passkeys page draws. */
export interface PasskeysView {
  readonly passkeys: readonly PasskeyView[];
  /** This listener's RP ID. */
  readonly rpId: string;
  /** How the session was opened: a code session enrols, a passkey session revokes. */
  readonly strength: 'code' | 'passkey';
  /** The session's synchronizer token, for each form. */
  readonly csrf: string;
  /** The most passkeys there may be. */
  readonly max: number;
  /** The longest name a passkey may have, in characters. */
  readonly labelLimit: number;
}

/** A moment, in UTC: the same on every screen. */
const when = (seconds: number): string =>
  `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function standingText(passkey: PasskeyView): string {
  switch (passkey.standing) {
    case 'other-owner':
      return 'Not usable: it was added under another owner key than OYL_INSTANCE_OWNER_KEY names now. Revoke it.';
    case 'other-host':
      return `Not usable at this address: it was added for ${escapeHtml(passkey.rpId)}. Revoke it, and add one here.`;
    case 'unconfirmed':
      return `Can read, and change nothing until it is confirmed on the server machine: <code>operator admin-passkeys confirm ${escapeHtml(passkey.id)}</code>.`;
    case 'confirmed':
      return 'Can read and make changes, with a fresh check each time.';
  }
}

/**
 * The Passkeys page's body (#2642): each passkey, with a Revoke form in a
 * passkey session, and the Add form in a code session with room for one more.
 */
export function passkeysBody(view: PasskeysView): string {
  const csrf = escapeHtml(view.csrf);
  const byPasskey = view.strength === 'passkey';
  const items = view.passkeys.map((passkey) => {
    const label = escapeHtml(passkey.label);
    const revoke = byPasskey
      ? `<form class="apart" method="post" action="/admin/passkeys/${escapeHtml(passkey.id)}/revoke" data-step-up="passkey_revoke" aria-label="Revoke ${label}">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="id" value="${escapeHtml(passkey.id)}">
<button type="submit" class="danger">Revoke ${label}</button>
<p data-passkey-status role="status"></p>
</form>`
      : '';
    return `<li class="item">
<h3>${label}</h3>
<dl class="facts">
<div><dt>Id</dt><dd><code>${escapeHtml(passkey.id)}</code></dd></div>
<div><dt>Added</dt><dd>${when(passkey.enrolledAt)}</dd></div>
<div><dt>Last used</dt><dd>${passkey.lastUsedAt === null ? 'Never' : when(passkey.lastUsedAt)}</dd></div>
<div><dt>For</dt><dd>${escapeHtml(passkey.rpId)}</dd></div>
</dl>
<p>${standingText(passkey)}</p>
${revoke}
</li>`;
  });
  const list =
    items.length === 0
      ? '<p>There are no passkeys yet.</p>'
      : `<ul class="passkeys items">\n${items.join('\n')}\n</ul>`;
  const add = byPasskey
    ? '<p>To add another passkey, sign in with a one-time code from the server machine: a code session can add one.</p>'
    : view.passkeys.length >= view.max
      ? `<p>You hold ${String(view.max)} passkeys, the most there may be. Revoke one before adding another.</p>`
      : card(`<h2>Add a passkey</h2>
<p>This adds one passkey for ${escapeHtml(view.rpId)}, then signs you out so you can sign in with it. Revoking a passkey needs a passkey sign-in.</p>
<form method="post" action="/admin/passkeys/add" data-passkey="enrol" data-passkey-supported hidden aria-label="Add a passkey">
<input type="hidden" name="csrf" value="${csrf}">
<label for="label">A name for this passkey</label>
<input type="text" id="label" name="label" maxlength="${String(view.labelLimit)}" autocomplete="off" required>
<button type="submit">Add a passkey</button>
<p data-passkey-status role="status"></p>
</form>
<p data-passkey-unsupported>This browser cannot use a passkey on this page, or the page’s script is blocked. You can keep using the admin pages with a one-time code, which reads every page and changes nothing.</p>`);
  // Each passkey's name is an h3 under this, so the headings go 1, 2, 3 (WCAG 1.3.1).
  return `${card(`<h2>Your passkeys</h2>
${list}`)}${add}`;
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
${compare}${card(`<dl class="facts">
${facts}
</dl>`)}${purpose}`;
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
  admin_passkey_enrolled: 'Admin passkey added',
  admin_passkey_revoked: 'Admin passkey revoked',
  admin_passkey_confirmed: 'Admin passkey confirmed on the host',
  room_ended: 'Room ended',
  registration_decided: 'Registration decided',
  emergency_kit_downloaded: 'Emergency kit downloaded',
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

/** The log table's columns (#2771). */
const LOG_COLUMNS = ['When', 'Action', 'Source', 'Outcome', 'Detail'] as const;

/** One entry's row, or a row with the sentence that it could not be shown. */
function entryLine(entry: LogEntryAnswer): string {
  const at = isoMoment(entry.at);
  const { action, source, detail, outcome } = entry;
  const fits =
    at !== undefined &&
    isAction(action) &&
    isSource(source) &&
    OUTCOMES.includes(outcome) &&
    (detail === null || (typeof detail === 'string' && operatorDetailFits(action, detail)));
  if (!fits) {
    return `<tr><td colspan="${String(LOG_COLUMNS.length)}">${escapeHtml(LOG_ENTRY_NOT_SHOWN_TEXT)}</td></tr>`;
  }
  const said = detail === null ? '' : `<code>${escapeHtml(detail)}</code>`;
  return `<tr><td class="when">${readableMoment(at)}</td><td><strong>${escapeHtml(ACTION_LABEL[action])}</strong></td><td>${escapeHtml(SOURCE_TEXT[source])}</td><td>${escapeHtml(outcome as string)}</td><td>${said}</td></tr>`;
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
${card(`${scrollTable('log-caption', 'Operator log entries, newest first', LOG_COLUMNS, view.entries.map(entryLine))}${links.length === 0 ? '<p>These are the oldest entries.</p>' : `<p class="pager">${links.join(' · ')}</p>`}`)}`;
}

/** The change a form on the AI backend page makes, and the route it is dispatched to. */
export type AnalysisOffer = 'local' | 'others' | 'hosted';

/** What the last change on the AI backend page said, drawn under the part it changed. */
export type AnalysisNotice =
  | { readonly about: 'offers'; readonly ok: boolean }
  /** `outcome` is `null` when the check's answer did not come back. */
  | {
      readonly about: 'check';
      readonly model: string;
      readonly outcome: OperateToolCheckOutcome | null;
    }
  | { readonly about: 'model'; readonly ok: boolean }
  /** `problem` is the route's code for the address, when it named one of its own. */
  | { readonly about: 'address'; readonly ok: boolean; readonly problem: string | null }
  | { readonly about: 'return'; readonly ok: boolean };

/** What the AI backend page draws: the three reads, the session, and the last change's notice. */
export interface AnalysisView {
  readonly analysis: OperateAnalysisAnswer | undefined;
  readonly models: OperateLocalModelsAnswer | undefined;
  readonly jobs: OperateJobsAnswer | undefined;
  /** A code session reads; a passkey session is drawn the forms, each behind a step-up. */
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: AnalysisNotice | null;
}

/** Said in a code session in place of the forms (ADR 0069 Q-A). */
export const ANALYSIS_READS_ONLY_TEXT =
  'A one-time code’s session reads this page and changes nothing. Sign in with a passkey to make a change: each one asks your passkey again.';

/** Where the owner's own hosted key is set: never here (ADR 0047 D-13, ADR 0069 D-2). */
export const ANALYSIS_KEY_ELSEWHERE_TEXT =
  'A hosted key is never typed on these pages. Set, replace or remove yours in the app, on its “A hosted model service, on your own key” panel, or on the host with operator model-key set.';

export const ANALYSIS_ADDRESS_HEADING = 'Local server address';
export const ANALYSIS_ADDRESS_BUTTON = 'Save this address';

/** Beside the address field: what the instance holds it to (ADR 0040 D-6). */
export const ANALYSIS_ADDRESS_HINT =
  'The server’s base address, on this machine or its private network: the instance refuses any other, and checks a name again before every request to it.';

export const ANALYSIS_ADDRESS_SAVED_TEXT =
  'Saved. The instance now asks the server at the address above.';
export const ANALYSIS_ADDRESS_REFUSED_TEXT =
  'The instance did not take that address, so nothing was changed.';

/** The switches, in the order the app draws them, and their words. */
const OFFERS: readonly { readonly offer: AnalysisOffer; readonly label: string }[] = [
  { offer: 'local', label: OFFER_LOCAL_LABEL },
  { offer: 'others', label: OFFER_OTHERS_LABEL },
  { offer: 'hosted', label: OFFER_HOSTED_LABEL },
];

/** The codes the analysis routes refuse an address or a model with (`analysis/settings.ts`). */
const SAVE_PROBLEMS: readonly string[] = [
  'not-set',
  'not-a-url',
  'not-base-url',
  'not-local',
  'tls-by-name',
  'no-model',
  'bad-model',
  'bad-reasoning',
  'unresolved',
];

/** Whether `problem` is one of the routes' own codes for a refused field. */
export function isSaveProblem(problem: unknown): problem is string {
  return typeof problem === 'string' && SAVE_PROBLEMS.includes(problem);
}

/** One shared line, its machine names as code. */
function lineHtml(line: OperateLine): string {
  return line
    .map((part) =>
      typeof part === 'string' ? escapeHtml(part) : `<code>${escapeHtml(part.code)}</code>`,
    )
    .join('');
}

const noticeHtml = (ok: boolean, done: string, failed: string): string =>
  ok
    ? `<p class="notice" role="status">${escapeHtml(done)}</p>\n`
    : `<p class="problem" role="alert">${escapeHtml(failed)}</p>\n`;

/**
 * How a change's button is drawn (#2771), as the app's kinds are: `primary`
 * for the change the part is for, `secondary` for a switch, and `danger` for
 * a change that is hard to undo. `apart` sets a danger form off from the
 * reading content above it, where it is not in a danger card of its own.
 */
type Tone = 'primary' | 'secondary' | 'danger';

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  primary: '',
  secondary: ' class="secondary"',
  danger: ' class="danger"',
};

/** A form that makes one change behind a fresh step-up: the session's token, its fields, its button. */
function stepUpForm(
  action: string,
  change: string,
  csrf: string,
  label: string,
  inside: string,
  button: string,
  tone: Tone = 'primary',
  apart = false,
): string {
  return `<form${apart ? ' class="apart"' : ''} method="post" action="${action}" data-step-up="${change}" aria-label="${escapeHtml(label)}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${inside}<button type="submit"${TONE_CLASS[tone]}>${escapeHtml(button)}</button>
<p data-passkey-status role="status"></p>
</form>`;
}

function offersPart(view: AnalysisView, analysis: OperateAnalysisAnswer): string {
  const state: Readonly<Record<AnalysisOffer, boolean>> = {
    local: analysis.local.offered,
    others: analysis.local.othersMayUse,
    hosted: analysis.hosted.offered,
  };
  const items = OFFERS.map(({ offer, label }) => {
    const on = state[offer];
    const line = `<p><strong>${escapeHtml(label)}</strong>: ${on ? 'on' : 'off'}.</p>`;
    if (view.strength !== 'passkey') return `<li class="item">${line}</li>`;
    const form = stepUpForm(
      '/admin/analysis/offer',
      'analysis_offer',
      view.csrf,
      label,
      `<input type="hidden" name="offer" value="${offer}">\n<input type="hidden" name="on" value="${on ? 'off' : 'on'}">\n`,
      on ? 'Turn off' : 'Turn on',
      'secondary',
    );
    return `<li class="item">${line}\n${form}</li>`;
  });
  const notice =
    view.notice?.about === 'offers'
      ? noticeHtml(view.notice.ok, OFFER_SAVED_TEXT, OFFER_FAILED_TEXT)
      : '';
  return card(`<h2>${escapeHtml(AI_OFFERS_HEADING)}</h2>
<ul class="offers items">
${items.join('\n')}
</ul>
<p>${escapeHtml(HOSTED_OFFER_SENTENCE)}</p>
${notice}`);
}

/** The models, as a list or the check's form; or why there is no list. */
function modelList(view: AnalysisView, models: OperateLocalModelsAnswer | undefined): string {
  if (models === undefined) {
    return `<p class="problem">${escapeHtml(MODELS_UNREADABLE_TEXT)}</p>\n`;
  }
  if (models.state !== 'ollama' && models.state !== 'openai-compatible') {
    return `<p class="warning">${escapeHtml(SERVER_STATE_TEXT[models.state])}</p>\n`;
  }
  const namesOnly =
    models.state === 'openai-compatible'
      ? `<p>${escapeHtml(SERVER_STATE_TEXT['openai-compatible'])}</p>\n`
      : '';
  if (models.models.length === 0) return `${namesOnly}<p>${escapeHtml(NO_MODELS_TEXT)}</p>\n`;
  const checked = view.notice?.about === 'check' ? view.notice.model : undefined;
  const modelText = (model: OperateLocalModel): string =>
    `<code>${escapeHtml(model.name)}</code>: ${escapeHtml(modelLine(model))}`;
  if (view.strength !== 'passkey') {
    return `${namesOnly}<p>${escapeHtml(MODELS_LEGEND)}:</p>
<ul class="models">
${models.models.map((model) => `<li>${modelText(model)}</li>`).join('\n')}
</ul>
`;
  }
  const radios = models.models.map((model, index) => {
    const id = `model-${String(index)}`;
    const picked = checked === model.name ? ' checked' : '';
    // One radio of the group required makes the group required: no check with none picked.
    const required = index === 0 ? ' required' : '';
    return `<li><input type="radio" id="${id}" name="model" value="${escapeHtml(model.name)}"${required}${picked}> <label for="${id}">${modelText(model)}</label></li>`;
  });
  return `${namesOnly}${stepUpForm(
    '/admin/analysis/check',
    'analysis_check',
    view.csrf,
    CHECK_BUTTON,
    `<fieldset>
<legend>${escapeHtml(MODELS_LEGEND)}</legend>
<ul class="models">
${radios.join('\n')}
</ul>
</fieldset>
`,
    CHECK_BUTTON,
  )}
`;
}

/**
 * *Pick a local model*: the list, and under it how the last check went —
 * and *Save this model* for the model it checked, only when it called tools
 * (ADR 0046 D-7), as the app offers Save only after this session's check.
 */
function modelsPart(view: AnalysisView): string {
  const checked = view.notice?.about === 'check' ? view.notice : undefined;
  let outcome = '';
  let save = `<p class="hint">${escapeHtml(SAVE_NEEDS_CHECK)}</p>\n`;
  if (checked !== undefined) {
    outcome =
      checked.outcome === null
        ? `<p class="problem" role="alert">${escapeHtml(CHECK_UNREADABLE_TEXT)}</p>\n`
        : noticeOf(checked.outcome === 'tools-ok', CHECK_TEXT[checked.outcome]);
    if (checked.outcome === 'tools-ok' && view.strength === 'passkey') {
      save = `<p>Checked: <code>${escapeHtml(checked.model)}</code></p>
${stepUpForm(
  '/admin/analysis/model',
  'analysis_model',
  view.csrf,
  SAVE_BUTTON,
  `<input type="hidden" name="localModel" value="${escapeHtml(checked.model)}">\n`,
  SAVE_BUTTON,
)}
`;
    }
  }
  const saved =
    view.notice?.about === 'model'
      ? noticeOf(view.notice.ok, view.notice.ok ? MODEL_SAVED_TEXT : MODEL_SAVE_FAILED_TEXT)
      : '';
  return card(`<h2>${escapeHtml(AI_PICK_HEADING)}</h2>
<p>${escapeHtml(MODEL_LOAD_WARNING)}</p>
${modelList(view, view.models)}${outcome}${save}${saved}<p class="pager"><a href="/admin/analysis">${escapeHtml(READ_AGAIN_BUTTON)}</a></p>`);
}

/** A notice that is either good news or a problem, by `ok`, in one sentence. */
function noticeOf(ok: boolean, text: string): string {
  return noticeHtml(ok, text, text);
}

function addressPart(view: AnalysisView, analysis: OperateAnalysisAnswer): string {
  if (view.strength !== 'passkey') return '';
  const notice =
    view.notice?.about === 'address'
      ? view.notice.ok
        ? noticeOf(true, ANALYSIS_ADDRESS_SAVED_TEXT)
        : `<p class="problem" role="alert">${escapeHtml(ANALYSIS_ADDRESS_REFUSED_TEXT)}${
            view.notice.problem === null
              ? ''
              : ` The instance’s reason: <code>${escapeHtml(view.notice.problem)}</code>.`
          }</p>\n`
      : '';
  const value =
    analysis.local.url === null
      ? ''
      : ` value="${escapeHtml(withoutUserinfo(analysis.local.url))}"`;
  return card(`<h2>${escapeHtml(ANALYSIS_ADDRESS_HEADING)}</h2>
${stepUpForm(
  '/admin/analysis/address',
  'analysis_address',
  view.csrf,
  ANALYSIS_ADDRESS_HEADING,
  `<label for="localUrl">${escapeHtml(ANALYSIS_ADDRESS_HEADING)}</label>
<input type="url" id="localUrl" name="localUrl"${value} autocomplete="off" spellcheck="false" required aria-describedby="localUrl-hint">
<p class="hint" id="localUrl-hint">${escapeHtml(ANALYSIS_ADDRESS_HINT)}</p>
`,
  ANALYSIS_ADDRESS_BUTTON,
)}
${notice}`);
}

function jobsPart(jobs: OperateJobsAnswer | undefined): string {
  const heading = `<h2>${escapeHtml(AI_JOBS_HEADING)}</h2>\n`;
  if (jobs === undefined) {
    return card(`${heading}<p class="problem">${escapeHtml(JOBS_UNREADABLE_TEXT)}</p>`);
  }
  const counts = jobCountLines(jobs)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('\n');
  const recent =
    jobs.recent.length === 0
      ? `<p>${escapeHtml(NO_JOBS_TEXT)}</p>`
      : `<ol class="log jobs">\n${jobs.recent.map((job) => `<li>${escapeHtml(jobLine(job))}</li>`).join('\n')}\n</ol>`;
  return card(`${heading}<ul class="counts">
${counts}
</ul>
${recent}`);
}

function returnPart(view: AnalysisView): string {
  const notice =
    view.notice?.about === 'return'
      ? noticeHtml(view.notice.ok, RETURNED_TEXT, RETURN_FAILED_TEXT)
      : '';
  const form =
    view.strength === 'passkey'
      ? `${stepUpForm('/admin/analysis/clear', 'analysis_clear', view.csrf, RETURN_BUTTON, '', RETURN_BUTTON, 'danger')}\n`
      : '';
  return card(
    `<h2>${escapeHtml(AI_RETURN_HEADING)}</h2>
<p>${escapeHtml(RETURN_SENTENCE)}</p>
${form}${notice}`,
    view.strength === 'passkey' ? 'danger' : 'card',
  );
}

/**
 * The AI backend page's body (#2648): what the three analysis reads
 * answered, in the app panel's order and words (`@onyourleft/operate-text`),
 * and — in a passkey session — one form per change, each behind a fresh
 * step-up. There is no field for a hosted key, and none is ever drawn.
 */
export function analysisBody(view: AnalysisView): string {
  const top = `<p>${escapeHtml(AI_LINE)}</p>
<p class="hint">${escapeHtml(AI_PURPOSE)}</p>
${view.strength === 'passkey' ? '' : `<p>${escapeHtml(ANALYSIS_READS_ONLY_TEXT)}</p>\n`}`;
  const { analysis } = view;
  if (analysis === undefined) {
    return `${top}<p class="problem">${escapeHtml(AI_UNREADABLE_TEXT)}</p>`;
  }
  const now = aiNowLines(analysis, view.models?.version ?? null)
    .map((line) => `<li>${lineHtml(line)}</li>`)
    .join('\n');
  return `${top}${offersPart(view, analysis)}${card(`<h2>${escapeHtml(AI_NOW_HEADING)}</h2>
<ul class="now">
${now}
</ul>`)}${modelsPart(view)}${addressPart(view, analysis)}${card(`<h2>${escapeHtml(AI_OWN_KEY_HEADING)}</h2>
<ul class="own-key">
<li>${escapeHtml(ownKeyText(analysis))}</li>
</ul>
<p>${escapeHtml(ANALYSIS_KEY_ELSEWHERE_TEXT)}</p>`)}${jobsPart(view.jobs)}${returnPart(view)}`;
}

/**
 * One rider awaiting approval as `GET /v1/moderation/registrations` answers
 * them (#2646, ADR 0069 D-9): the four details the app's Moderation screen
 * shows, and nothing more.
 */
export interface RegistrationAnswer {
  readonly athleteId: string;
  readonly displayName: string;
  /** Unix seconds. */
  readonly createdAt: number;
  readonly adultConfirmed: boolean;
}

/** A registration decision, as its form names it. */
export type RegistrationDecision = 'approve' | 'refuse';

/** What the last decision on the Accounts page came to, read back after it. */
export interface AccountsNotice {
  readonly decision: RegistrationDecision;
  /** Whether the route answered done and the rider has left the queue, read back. */
  readonly ok: boolean;
  /** Why not, by the route's answer: no reason, no longer waiting, or no such rider. */
  readonly problem: 'reason' | 'not-waiting' | null;
}

/** What the Accounts page draws: the status read, the queue read, the session, and the last decision. */
export interface AccountsView {
  readonly status: OperateStatusAnswer | undefined;
  readonly registrations: readonly RegistrationAnswer[] | undefined;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: AccountsNotice | null;
  /** The longest reason a decision may carry, in characters: the moderation routes' own. */
  readonly reasonLimit: number;
}

/** The page's one line. */
export const ACCOUNTS_PAGE_LINE =
  'How many accounts are in each standing, how this instance takes new riders, and who is waiting for approval.';

/** Said where the app's panel links to its Moderation screen: what stays there. */
export const ACCOUNTS_ELSEWHERE_TEXT =
  'Lifting a suspension, inviting a rider and every other moderation step are done on the app’s Moderation screen.';

/** Said above the steps: the mode is shown here, and changed only on the host. */
export const ACCOUNTS_MODE_SHOWN_TEXT =
  'These pages show the mode and cannot change it. On the instance’s host:';

export const REGISTRATIONS_HEADING = 'Waiting for approval';
export const NO_REGISTRATIONS_TEXT = 'Nobody is waiting for approval.';
export const REGISTRATIONS_UNREADABLE_TEXT =
  'The riders waiting for approval could not be read from the instance, so none is shown here.';

/** Said in a code session in place of the decisions (ADR 0069 Q-A). */
export const ACCOUNTS_READS_ONLY_TEXT =
  'A one-time code’s session reads this page and changes nothing. Sign in with a passkey to approve or refuse a rider: each decision asks your passkey again.';

const DECISION_TEXT: Readonly<
  Record<
    RegistrationDecision,
    { readonly button: string; readonly done: string; readonly verb: string }
  >
> = {
  approve: { button: 'Approve', done: 'Approved.', verb: 'approving' },
  refuse: { button: 'Refuse', done: 'Refused.', verb: 'refusing' },
};

const NOTICE_PROBLEM_TEXT: Readonly<Record<NonNullable<AccountsNotice['problem']>, string>> = {
  reason: 'Nothing was changed: a decision needs a reason, of at most 1,000 characters.',
  'not-waiting': 'Nothing was changed: that rider is not waiting for approval any more.',
};

/** Said when the route answered and the queue read back does not show the decision. */
export const DECISION_NOT_SHOWN_TEXT =
  'The instance did not show the decision when the queue was read again, so it may not have been made.';

function accountsNotice(notice: AccountsNotice | null): string {
  if (notice === null) return '';
  if (notice.ok) {
    return `<p class="notice" role="status">${escapeHtml(DECISION_TEXT[notice.decision].done)}</p>\n`;
  }
  const text =
    notice.problem === null ? DECISION_NOT_SHOWN_TEXT : NOTICE_PROBLEM_TEXT[notice.problem];
  return `<p class="problem" role="alert">${escapeHtml(text)}</p>\n`;
}

function registrationItem(
  view: AccountsView,
  registration: RegistrationAnswer,
  index: number,
): string {
  const name = escapeHtml(registration.displayName);
  const adult = registration.adultConfirmed
    ? 'They have confirmed they are 18 or over.'
    : 'They have not confirmed they are 18 or over.';
  const forms =
    view.strength !== 'passkey'
      ? ''
      : (['approve', 'refuse'] as const)
          .map((decision) => {
            const id = `${decision}-reason-${String(index)}`;
            const words = DECISION_TEXT[decision];
            return stepUpForm(
              `/admin/accounts/${decision}`,
              `registration_${decision}`,
              view.csrf,
              `${words.button} ${registration.displayName}`,
              `<input type="hidden" name="athleteId" value="${escapeHtml(registration.athleteId)}">
<label for="${id}">Reason for ${words.verb} ${name}</label>
<input type="text" id="${id}" name="reason" maxlength="${String(view.reasonLimit)}" autocomplete="off" required>
`,
              words.button,
              decision === 'refuse' ? 'danger' : 'primary',
              decision === 'refuse',
            );
          })
          .join('\n');
  return `<li class="item">
<h3>${name}</h3>
<p>Account <code>${escapeHtml(registration.athleteId)}</code>, asked ${when(registration.createdAt)}. ${adult}</p>
${forms}
</li>`;
}

function registrationsPart(view: AccountsView): string {
  const heading = `<h2>${escapeHtml(REGISTRATIONS_HEADING)}</h2>\n`;
  const reads =
    view.strength === 'passkey' ? '' : `<p>${escapeHtml(ACCOUNTS_READS_ONLY_TEXT)}</p>\n`;
  const notice = accountsNotice(view.notice);
  if (view.registrations === undefined) {
    return card(
      `${heading}${notice}<p class="problem">${escapeHtml(REGISTRATIONS_UNREADABLE_TEXT)}</p>`,
    );
  }
  if (view.registrations.length === 0) {
    return card(`${heading}${notice}<p>${escapeHtml(NO_REGISTRATIONS_TEXT)}</p>`);
  }
  return card(`${heading}${notice}${reads}<ul class="registrations items">
${view.registrations.map((each, index) => registrationItem(view, each, index)).join('\n')}
</ul>`);
}

function modePart(status: OperateStatusAnswer): string {
  const mode = status.registration;
  const steps = REGISTRATION_CHANGE_STEPS.map((step) => `<li>${lineHtml(step)}</li>`).join('\n');
  return card(`<h2>Registration mode: ${escapeHtml(mode)}</h2>
<p>${escapeHtml(REGISTRATION_MODE_TEXT[mode].meaning)}</p>
<p class="hint">${escapeHtml(MODERATORS_ALWAYS_JOIN)}</p>
<h3>${escapeHtml(REGISTRATION_CHANGE_HEADING)}</h3>
<p>${escapeHtml(ACCOUNTS_MODE_SHOWN_TEXT)}</p>
<ol>
${steps}
</ol>`);
}

/**
 * A count's line as a tile (#2771): its leading figure set large above the
 * rest of the line, which reads, as text, exactly as the line does.
 */
function tile(line: string): string {
  const counted = /^(\d+) (.+)$/.exec(line);
  if (counted === null) return `<li>${escapeHtml(line)}</li>`;
  const [, figure = '', label = ''] = counted;
  return `<li><span class="figure">${figure}</span> <span class="label">${escapeHtml(label)}</span></li>`;
}

/**
 * The Accounts page's body (#2646, ADR 0069 D-9): the standings and the
 * registration mode from `GET /v1/operate/status`, in operate-text's words
 * as the app's panel draws them, and the queue from `GET
 * /v1/moderation/registrations` — each rider's four details, and in a
 * passkey session an Approve and a Refuse form, each with its reason and
 * behind a fresh step-up.
 */
export function accountsBody(view: AccountsView): string {
  const top = `<p>${escapeHtml(ACCOUNTS_PAGE_LINE)}</p>\n`;
  const elsewhere = `<p>${escapeHtml(ACCOUNTS_ELSEWHERE_TEXT)}</p>`;
  const counted =
    view.status === undefined
      ? `<p class="problem">${escapeHtml(ACCOUNTS_UNREADABLE_TEXT)}</p>\n`
      : `${card(`<h2>Standings</h2>
<ul class="tiles counts">
${accountStandingLines(view.status.counts.athletes).map(tile).join('\n')}
</ul>`)}${modePart(view.status)}`;
  return `${top}${counted}${registrationsPart(view)}${elsewhere}`;
}

/** One record as `GET /v1/operate/backups` answers it (#2647): its line's fields and its further facts. */
export type BackupRecordAnswer = OperateBackupLine & OperateBackupFacts & { readonly id: number };

/** What the last "back up now" came to, read back after it. */
export type BackupsNotice =
  /** The route took it; `ok` when the list read back shows it waiting. */
  | { readonly kind: 'asked'; readonly ok: boolean }
  /** `too_many`, with the route's own sentence. */
  | { readonly kind: 'refused'; readonly sentence: string }
  /** Any other answer. */
  | { readonly kind: 'not-asked' };

/** What the Backups page draws: the route's read, the session, and the last request's notice. */
export interface BackupsView {
  readonly backups:
    | { readonly records: readonly BackupRecordAnswer[]; readonly pendingSince: string | null }
    | undefined;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: BackupsNotice | null;
  /** Every record (`?all=1`), or the newest {@link BACKUPS_SHOWN} (#2771). */
  readonly all: boolean;
}

/** How many records the Backups page lists until the owner asks for every one (#2771). */
export const BACKUPS_SHOWN = 20;

/** The address of the Backups page with every record listed. */
export const BACKUPS_ALL_PATH = '/admin/backups?all=1';

/** Said in a code session in place of "back up now" (ADR 0069 Q-A). */
export const BACKUPS_READS_ONLY_TEXT =
  'A one-time code’s session reads this page and changes nothing. Sign in with a passkey to back up now: it asks your passkey again.';

/** Said when the route took the request and the list read back shows none waiting. */
export const BACKUP_NOT_SHOWN_TEXT =
  'The instance did not show the request waiting when the list was read again, so it may not have been taken.';

export const BACK_UP_NOW_BUTTON = 'Back up now';
export const BACKUPS_READ_AGAIN = 'Read the list again';

/** Said beside the restore steps: they are for the newest snapshot, and how to restore another. */
export const RESTORE_NEWEST_TEXT =
  'These are the steps for the newest snapshot. For an older one, put its directory’s name, shown in the list above, in place of this one’s in the second step.';

type Snapshot = Extract<BackupRecordAnswer, { readonly outcome: 'done' }>;

/** The Backups table's columns (#2771). */
const BACKUP_COLUMNS = ['When', 'Backup'] as const;

/** The control of a row's disclosure that holds its further facts (#2771). */
export const BACKUP_DETAILS_LABEL = 'Details';

/**
 * One record's row: when, its line from operate-text and any warning, and its
 * further facts in a closed `<details>` under them (#2771), so each backup
 * takes about one line until its facts are asked for. No script: the browser
 * opens and closes it.
 */
function backupItem(backup: BackupRecordAnswer): string {
  const { rest } = backupLine(backup);
  const warning =
    backup.outcome === 'failed'
      ? `<p class="warning"><strong>Failed:</strong> ${escapeHtml(BACKUP_FAILED_TEXT)}</p>\n`
      : backup.offBox === 'failed'
        ? `<p class="warning"><strong>Off-box copy failed:</strong> ${escapeHtml(OFF_BOX_FAILED_TEXT)}</p>\n`
        : '';
  return `<tr>
<td class="when">${readableMoment(backup.at)}</td>
<td><p>${restHtml(rest)}</p>
${warning}<details>
<summary>${escapeHtml(BACKUP_DETAILS_LABEL)}</summary>
<dl class="compact">
${backupFactRows(backup).map(fact).join('\n')}
</dl>
</details></td>
</tr>`;
}

/** The link under the table: to every record, or back to the newest; none when every one is shown anyway. */
function backupsPager(view: BackupsView, count: number): string {
  if (count <= BACKUPS_SHOWN) return '';
  return view.all
    ? `<p class="pager"><a href="/admin/backups">Show the newest ${String(BACKUPS_SHOWN)} only</a></p>\n`
    : `<p class="pager"><a href="${BACKUPS_ALL_PATH}">Show older backups (${String(count - BACKUPS_SHOWN)} more)</a></p>\n`;
}

function backUpNowPart(view: BackupsView, waiting: boolean): string {
  const notice =
    view.notice === null
      ? ''
      : view.notice.kind === 'asked'
        ? view.notice.ok
          ? ''
          : `<p class="problem" role="alert">${escapeHtml(BACKUP_NOT_SHOWN_TEXT)}</p>\n`
        : `<p class="problem" role="alert">${escapeHtml(
            view.notice.kind === 'refused' ? view.notice.sentence : BACKUP_NOT_ASKED_TEXT,
          )}</p>\n`;
  const heading = `<h2>${escapeHtml(BACK_UP_NOW_BUTTON)}</h2>\n`;
  if (waiting) {
    return card(`${heading}<p class="notice" role="status">${escapeHtml(BACKUP_WAITING_TEXT)}</p>
<p class="pager"><a href="/admin/backups">${escapeHtml(BACKUPS_READ_AGAIN)}</a></p>
${notice}`);
  }
  if (view.strength !== 'passkey')
    return card(`${heading}<p>${escapeHtml(BACKUPS_READS_ONLY_TEXT)}</p>\n${notice}`);
  return card(`${heading}<p>${escapeHtml(BACK_UP_NOW_CONFIRM_TEXT)}</p>
${stepUpForm('/admin/backups', 'backup_now', view.csrf, BACK_UP_NOW_BUTTON, '', BACK_UP_NOW_BUTTON)}
${notice}`);
}

function restorePart(snapshots: readonly Snapshot[]): string {
  const newest = snapshots[0];
  const steps =
    newest === undefined
      ? `<p>${escapeHtml(NO_SNAPSHOT_TO_RESTORE_TEXT)}</p>`
      : `<p>${escapeHtml(RESTORE_NEWEST_TEXT)}</p>
<p>Snapshot: <code>${escapeHtml(newest.snapshot)}</code></p>
<ol class="restore">
${restoreSteps(newest)
  .map((step) => `<li>${lineHtml(step)}</li>`)
  .join('\n')}
</ol>`;
  return card(`<h2>${escapeHtml(RESTORE_HEADING)}</h2>
<p>${escapeHtml(RESTORE_PREFACE_TEXT)}</p>
<p class="hint">${escapeHtml(RESTORE_WHY_TEXT)}</p>
<p class="hint">${escapeHtml(RESTORE_ONE_OFF_TEXT)}</p>
${steps}`);
}

/**
 * The Backups page's body (#2647): what `GET /v1/operate/backups` answered,
 * each record's line in the app panel's words (`@onyourleft/operate-text`)
 * with the route's further facts under it, "back up now" in a passkey session
 * behind a fresh step-up, and the restore steps as text — restore stays on
 * the CLI. No host path: a snapshot is named by its directory, and `/backups`
 * is the folder inside the `backup` service.
 */
export function backupsBody(view: BackupsView): string {
  if (view.backups === undefined) {
    return `<p class="problem">${escapeHtml(BACKUPS_UNREADABLE_TEXT)}</p>`;
  }
  const { records, pendingSince } = view.backups;
  const newest = records.find(
    (each): each is Snapshot => each.outcome === 'done' && each.intervalSeconds !== null,
  );
  const stale =
    newest !== undefined &&
    newest.intervalSeconds !== null &&
    newest.ageSeconds > 2 * newest.intervalSeconds
      ? `<p class="warning"><strong>Stale:</strong> ${escapeHtml(backupsStaleText(newest.ageSeconds, newest.intervalSeconds))}</p>\n`
      : '';
  const shown = view.all ? records : records.slice(0, BACKUPS_SHOWN);
  const list =
    records.length === 0
      ? `<p>${escapeHtml(NO_BACKUP_TEXT)}</p>\n`
      : scrollTable(
          'backups-caption',
          'Backups, newest first',
          BACKUP_COLUMNS,
          shown.map(backupItem),
        );
  const snapshots = records.filter((each): each is Snapshot => each.outcome === 'done');
  return `${backUpNowPart(view, pendingSince !== null)}${card(`<h2>Snapshots</h2>
<p>${escapeHtml(BACKUPS_LIST_TEXT)}</p>
${stale}${list}${backupsPager(view, records.length)}`)}${restorePart(snapshots)}`;
}

/** One open room as `GET /v1/operate/rooms` answers it (#2649): never a place, a speed or a power. */
export interface RoomAnswer {
  readonly roomId: string;
  readonly shortCode: string;
  readonly kind: OperateRoomKind;
  readonly visibility: OperateRoomVisibility;
  readonly phase: OperateRoomPhase;
  /** ISO 8601, UTC. */
  readonly openedAt: string;
  readonly host: string | null;
  readonly riders: readonly (string | null)[];
}

/** What the last End room came to, read back after it. */
export interface RoomsNotice {
  /** The route answered it ended and the room is gone from the list read back. */
  readonly ended: boolean;
}

/** What the Rooms page draws: the route's read, the session, and the last end's notice. */
export interface RoomsView {
  readonly rooms: readonly RoomAnswer[] | undefined;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: RoomsNotice | null;
}

/** Said in a code session in place of End room (ADR 0069 Q-A). */
export const ROOMS_READS_ONLY_TEXT =
  'A one-time code’s session reads this page and changes nothing. Sign in with a passkey to end a room: it asks your passkey again.';

export const ROOM_ENDED_TEXT = 'The room was ended.';

/** The Rooms table's columns (#2771). */
const ROOM_COLUMNS = ['Room', 'Details'] as const;
export const END_ROOM_BUTTON = 'End room';

/** One room's row: what it is, and the rest of its line from operate-text. */
function roomRow(room: RoomAnswer): string {
  const { kind, rest } = roomLine(room);
  return `<tr><td><strong>${escapeHtml(kind)}</strong></td><td>${restHtml(rest)}</td></tr>`;
}

/** One room's End room form, under the room's kind and code, in the danger card below the table. */
function roomEndForm(view: RoomsView, room: RoomAnswer, index: number): string {
  const { kind } = roomLine(room);
  const reasonId = `room-reason-${String(index)}`;
  const codeId = `room-code-${String(index)}`;
  const options = ROOM_END_REASONS.map(
    (reason) =>
      `<option value="${reason}"${reason === 'other' ? ' selected' : ''}>${escapeHtml(ROOM_END_REASON_TEXT[reason])}</option>`,
  ).join('\n');
  const form = stepUpForm(
    '/admin/rooms/end',
    'room_end',
    view.csrf,
    `${END_ROOM_BUTTON} ${room.shortCode}`,
    `<input type="hidden" name="roomId" value="${escapeHtml(room.roomId)}">
<label for="${reasonId}">${escapeHtml(END_ROOM_REASON_LABEL)}</label>
<select id="${reasonId}" name="reason">
${options}
</select>
<label for="${codeId}">${escapeHtml(endRoomTypeText(room.shortCode))}</label>
<input type="text" id="${codeId}" name="confirm" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" required>
`,
    END_ROOM_BUTTON,
    'danger',
  );
  return `<li class="item">\n<h3>${escapeHtml(kind)} <code>${escapeHtml(room.shortCode)}</code></h3>\n${form}\n</li>`;
}

/**
 * The Rooms page's body (#2649): every open room `GET /v1/operate/rooms`
 * answered, each in the app panel's words (`@onyourleft/operate-text`
 * §`roomLine`), and in a passkey session an End room form for each — the
 * reason, the room's short code typed, and a fresh step-up. Names only:
 * never a place, a distance, a speed, a power, a heart rate or an id of a
 * rider.
 */
export function roomsBody(view: RoomsView): string {
  const top = `<p>${escapeHtml(ROOMS_LIST_TEXT)}</p>
<p class="hint">${escapeHtml(ROOMS_NAMES_ONLY_TEXT)}</p>
`;
  const notice =
    view.notice === null
      ? ''
      : view.notice.ended
        ? `<p class="notice" role="status">${escapeHtml(ROOM_ENDED_TEXT)}</p>\n`
        : `<p class="problem" role="alert">${escapeHtml(ROOM_NOT_ENDED_TEXT)}</p>\n`;
  if (view.rooms === undefined) {
    return `${top}${notice}<p class="problem">${escapeHtml(ROOMS_UNREADABLE_TEXT)}</p>`;
  }
  if (view.rooms.length === 0) return `${top}${notice}<p>${escapeHtml(NO_ROOM_TEXT)}</p>`;
  const table = scrollTable('rooms-caption', 'Open rooms', ROOM_COLUMNS, view.rooms.map(roomRow));
  if (view.strength !== 'passkey') {
    return `${top}${notice}${card(`${table}<p>${escapeHtml(ROOMS_READS_ONLY_TEXT)}</p>`)}`;
  }
  return `${top}${notice}${card(table)}${card(
    `<h2>${escapeHtml(END_ROOM_BUTTON)}</h2>
<p>${escapeHtml(END_ROOM_CONFIRM_TEXT)}</p>
<ul class="items">
${view.rooms.map((room, index) => roomEndForm(view, room, index)).join('\n')}
</ul>`,
    'danger',
  )}`;
}

/** The keys' state as the Keys page draws it on either listener (#2650): never the card or the fingerprint. */
export interface KeysStateView {
  readonly state: OperateKeysWord;
  readonly current: {
    readonly serial: number;
    /** ISO 8601, UTC. */
    readonly createdAt: string;
    readonly rotatesAt: string;
  } | null;
  readonly olderHeld: number;
}

/**
 * The card and its fingerprint (ADR 0047 D-6): handed to the renderer on the
 * LOOPBACK listener only, whose page no edge can write. The tunnel's page is
 * drawn with `null`, so its renderer has nothing to format.
 */
export interface KeysCardView {
  /** `oyl-instance:<origin>#<52 characters>`, whole. */
  readonly card: string;
  /** 52 base32 characters, whole. */
  readonly fingerprint: string;
}

/** What the last rotation came to, read back after it. */
export type KeysNotice =
  /** The route rotated; `ok` when the keys read back name the new serial. */
  | { readonly kind: 'rotated'; readonly ok: boolean }
  /** The route's `busy`: the instance's own maintenance held the key lease. */
  | { readonly kind: 'busy' }
  /** Any other answer: a word that was not `rotate`, say. */
  | { readonly kind: 'not-rotated' };

/** What the Keys page draws. */
export interface KeysView {
  readonly keys: KeysStateView | undefined;
  /** The card and fingerprint on the loopback listener, when the keys are ready; `null` otherwise. */
  readonly card: KeysCardView | null;
  /** Drawn on the loopback listener, where the card may be shown. */
  readonly onServer: boolean;
  /**
   * Whether the emergency kit is offered (#2781, ADR 0080 D-4): on the
   * loopback listener, when a secret came from the secrets folder.
   */
  readonly kit: boolean;
  readonly strength: 'code' | 'passkey';
  readonly csrf: string;
  readonly notice: KeysNotice | null;
}

/**
 * Said through the tunnel in place of the card (#2650, ADR 0047 D-6, ADR 0069
 * D-2). Draft wording, for the owner's approval.
 */
export const KEYS_CARD_ON_SERVER_TEXT =
  'The card and its fingerprint are shown only on the server machine, where nothing between you and the instance can change them. Open this page there, or run operator instance-key show on the host, to read the card.';

/** Said in a code session in place of the rotation (ADR 0069 Q-A). */
export const KEYS_READS_ONLY_TEXT =
  'A one-time code’s session reads this page and changes nothing. Sign in with a passkey to rotate the encryption key: it asks your passkey again.';

export const ROTATED_TEXT = 'The encryption key was rotated.';
export const ROTATE_BUTTON = 'Rotate the encryption key';

function cardPart(shown: KeysCardView | null, onServer: boolean): string {
  if (shown === null) {
    return onServer ? '' : `<p class="notice">${escapeHtml(KEYS_CARD_ON_SERVER_TEXT)}</p>\n`;
  }
  return card(`<h2>The instance’s card</h2>
<p>${escapeHtml(KEYS_CARD_TEXT)}</p>
<p><code class="card">${escapeHtml(shown.card)}</code></p>
<p>${escapeHtml(KEYS_FINGERPRINT_TEXT)}</p>
<p><code class="fingerprint">${escapeHtml(shown.fingerprint)}</code></p>`);
}

/** What the emergency kit is, said beside its button (#2781). Draft wording, for the owner's approval. */
export const KIT_TEXT =
  'The emergency kit is one text file holding this instance’s secrets, its address and its card. Keep it in a password manager or on paper, never beside your backups: with it, a backup can be restored on a new machine and every device keeps trusting the instance. Without it, a restore makes new keys and every device has to connect again.';

export const KIT_BUTTON = 'Download the emergency kit';

/** Said in a code session in place of the kit's button (ADR 0069 Q-A). */
export const KIT_READS_ONLY_TEXT =
  'A one-time code’s session downloads nothing. Sign in with a passkey to download the emergency kit: it asks your passkey again.';

/** Said on the server machine when every secret is in `.env`. */
export const KIT_NONE_TEXT =
  'There is no emergency kit to download: every secret this instance uses is set in .env, so keep a copy of that file’s secret lines safe, away from your backups.';

/** The emergency kit's part of the Keys page: on the loopback listener only. */
function kitPart(view: KeysView): string {
  if (!view.onServer) return '';
  if (!view.kit)
    return card(`<h2>Emergency kit</h2>
<p>${escapeHtml(KIT_NONE_TEXT)}</p>`);
  const form =
    view.strength === 'passkey'
      ? stepUpForm(
          '/admin/keys/emergency-kit',
          'emergency_kit',
          view.csrf,
          KIT_BUTTON,
          '',
          KIT_BUTTON,
        )
      : `<p>${escapeHtml(KIT_READS_ONLY_TEXT)}</p>`;
  return card(`<h2>Emergency kit</h2>
<p>${escapeHtml(KIT_TEXT)}</p>
${form}`);
}

function rotatePart(view: KeysView): string {
  const notice =
    view.notice === null
      ? ''
      : view.notice.kind === 'rotated'
        ? view.notice.ok
          ? `<p class="notice" role="status">${escapeHtml(ROTATED_TEXT)}</p>\n`
          : `<p class="problem" role="alert">${escapeHtml(ROTATE_NOT_DONE_TEXT)}</p>\n`
        : `<p class="problem" role="alert">${escapeHtml(
            view.notice.kind === 'busy' ? ROTATE_BUSY_TEXT : ROTATE_NOT_DONE_TEXT,
          )}</p>\n`;
  const form =
    view.strength === 'passkey'
      ? `${stepUpForm(
          '/admin/keys/rotate',
          'key_rotate',
          view.csrf,
          ROTATE_BUTTON,
          `<label for="rotate-confirm">${escapeHtml(ROTATE_TYPE_TEXT)}</label>
<input type="text" id="rotate-confirm" name="confirm" maxlength="16" autocomplete="off" autocapitalize="none" spellcheck="false" required>
`,
          ROTATE_BUTTON,
          'danger',
        )}\n`
      : `<p>${escapeHtml(KEYS_READS_ONLY_TEXT)}</p>\n`;
  return card(
    `<h2>${escapeHtml(ROTATE_BUTTON)}</h2>
<p>${escapeHtml(ROTATE_KEY_TEXT)}</p>
${notice}${form}`,
    view.strength === 'passkey' ? 'danger' : 'card',
  );
}

/**
 * The Keys page's body (#2650, ADR 0047 D-4–D-6, ADR 0069 D-2, D-5): the
 * keys' state in the app panel's words (`@onyourleft/operate-text`
 * §`keyFactRows`), the card and its fingerprint whole on the loopback
 * listener and a sentence in their place through the tunnel, the routine
 * rotation in a passkey session behind the typed word and a fresh step-up,
 * and the commands that stay on the CLI.
 */
export function keysBody(view: KeysView): string {
  if (view.keys === undefined) {
    return `<p class="problem">${escapeHtml(KEYS_UNREADABLE_TEXT)}</p>`;
  }
  const cli = KEYS_CLI_COMMANDS.map(
    (each) => `<li>${escapeHtml(each.what)}: <code>${escapeHtml(each.command)}</code></li>`,
  ).join('\n');
  return `${card(`<dl class="facts">
${keyFactRows(view.keys).map(fact).join('\n')}
</dl>`)}${cardPart(view.keys.state === 'ready' ? view.card : null, view.onServer)}${kitPart(view)}${rotatePart(view)}${card(`<h2>On the host’s command line</h2>
<p>${escapeHtml(KEYS_CLI_TEXT)}</p>
<ul class="cli">
${cli}
</ul>`)}`;
}

/**
 * What a card-and-code QR is for (#2783, ADR 0080): the owner's claim code on
 * the setup wizard's claim step (D-3), or the one rider invite the setup
 * session may mint (D-7).
 */
export type CardCodePurpose = 'claim' | 'invite';

/**
 * A card and a single-use code to draw as one QR, with the same line beside
 * it. ⚠️ **Handed to the renderer on the LOOPBACK listener only**, as
 * {@link KeysCardView} is: the tunnel's pages are never drawn with one.
 */
export interface CardCodeView {
  readonly purpose: CardCodePurpose;
  /** `oyl-instance:<origin>#<52 characters>`, whole. */
  readonly card: string;
  /** The code as the instance minted it: four groups of four. */
  readonly code: string;
  /** When the code stops working: ISO 8601, UTC. */
  readonly expiresAt: string;
}

/**
 * Each purpose's heading, what to do, and the QR's accessible name. Draft
 * wording, for the owner's approval.
 */
export const CARD_CODE_TEXT: Readonly<
  Record<
    CardCodePurpose,
    { readonly heading: string; readonly lead: string; readonly label: string }
  >
> = {
  claim: {
    heading: 'Claim this instance with your tablet',
    lead: 'On the tablet you ride with, open On Your Left, go to Instance and scan this code with the app’s own scanner, not the camera app. It carries the instance’s card, so the tablet checks the instance’s key before it sends anything, and a code that makes that tablet this instance’s owner.',
    label: 'The instance’s card and a claim code, for the app’s scanner',
  },
  invite: {
    heading: 'Invite a rider',
    lead: 'Ask the rider to open On Your Left, go to Instance and scan this code with the app’s own scanner, not the camera app. It carries the instance’s card, so their app checks the instance’s key before it sends anything, and an invitation to join.',
    label: 'The instance’s card and an invitation, for the app’s scanner',
  },
};

/** Above the line beside the QR. Draft. */
export const CARD_CODE_LINE_TEXT =
  'Or paste this line into the app’s Instance screen. It is what the code carries, whole:';

/** When the code stops working, with the moment drawn by {@link readableMoment}. Draft. */
export const CARD_CODE_UNTIL_TEXT = 'It works once, until';

/**
 * A card and a single-use code as one QR, server-drawn SVG (`qr.ts`), with
 * the same line beside it as text a person can select and copy: the QR is
 * named for what it is for and described by that line, which is its
 * alternative. Throws unless the card is whole and the code is one the
 * instance mints (`qr.ts` §`cardWithCode`).
 */
export function cardCodePart(view: CardCodeView): string {
  const line = cardWithCode(view.card, view.code);
  const text = CARD_CODE_TEXT[view.purpose];
  const lineId = `${view.purpose}-code-line`;
  return card(`<h2>${escapeHtml(text.heading)}</h2>
<p>${escapeHtml(text.lead)}</p>
<figure class="qr-figure">
${qrSvg(line, text.label, lineId)}
<figcaption>
<p>${escapeHtml(CARD_CODE_LINE_TEXT)}</p>
<p><code class="card" id="${escapeHtml(lineId)}">${escapeHtml(line)}</code></p>
</figcaption>
</figure>
<p>${escapeHtml(CARD_CODE_UNTIL_TEXT)} ${readableMoment(view.expiresAt)}.</p>`);
}

/** One problem line as `GET /v1/operate/logs` answers it (#2651): already through the log's redaction. */
export interface ProblemAnswer {
  /** ISO 8601, UTC. */
  readonly at: string;
  /** The JSON line exactly as standard output got it. */
  readonly line: string;
}

/** What the Recent problems page draws: the route's read, or `undefined` when it did not come. */
export interface ProblemsView {
  readonly problems:
    { readonly since: string; readonly lines: readonly ProblemAnswer[] } | undefined;
}

/** The Recent problems table's columns (#2771). */
const PROBLEM_COLUMNS = ['When', 'Problem'] as const;

/** A line's fields, parsed as the app's port parses them: an object, or none. */
function fieldsOf(line: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The Recent problems page's body (#2651): what `GET /v1/operate/logs`
 * answered, newest first, each line in the app panel's words
 * (`@onyourleft/operate-text` §`problemSentence`) and, under a disclosure,
 * the line exactly as the route gave it — escaped by `html.ts`, with no
 * redaction of this page's own and no second source. Read-only.
 */
export function problemsBody(view: ProblemsView): string {
  const held = `<p class="hint">${escapeHtml(PROBLEMS_HELD_TEXT)}</p>`;
  if (view.problems === undefined) {
    return `<p class="problem">${escapeHtml(PROBLEMS_UNREADABLE_TEXT)}</p>\n${held}`;
  }
  const since = momentText(view.problems.since);
  if (view.problems.lines.length === 0) {
    return `<p>${escapeHtml(noProblemsText(since))}</p>\n${held}`;
  }
  const rows = view.problems.lines.map(
    (problem) => `<tr>
<td class="when">${readableMoment(problem.at)}</td>
<td><p>${escapeHtml(problemSentence(fieldsOf(problem.line)))}</p>
<details>
<summary>${escapeHtml(RAW_LINE_LABEL)}</summary>
<code>${escapeHtml(problem.line)}</code>
</details></td>
</tr>`,
  );
  return `<p>${escapeHtml(problemsSinceText(since))}</p>
${card(scrollTable('problems-caption', 'Problems, newest first', PROBLEM_COLUMNS, rows))}${held}`;
}
