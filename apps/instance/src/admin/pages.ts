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
 * Nothing here renders a token, a code, a key or a coordinate.
 *
 * ⚠️ The log's action labels are the app's (`apps/web/src/views/OperateView.tsx`
 * §`ACTION_LABEL`), restated: `apps/instance` may not import `apps/web`.
 * Moving them to `packages/operate-text` is a relicensing (ADR 0069 D-7), so
 * it is not done here.
 */

import {
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

/** The one script, linked on the pages with a passkey ceremony; never inline. */
export const PASSKEY_SCRIPT_TAG = '<script src="/admin/passkey.js" defer></script>\n';

/**
 * The frame: the stylesheet linked, never inline, and with `script` the
 * passkey script linked too. `body` and `before` are markup the caller escaped.
 */
export function adminPage(title: string, body: string, before = '', script = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/admin/admin.css">
${script ? PASSKEY_SCRIPT_TAG : ''}</head>
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
<p class="name">${escapeHtml(instanceName(view.name))}</p>
<p>Signed in as the instance’s owner with ${STRENGTH_TEXT[view.strength]}, ${LISTENER_TEXT[view.listener]}.${STRENGTH_LIMIT[view.strength]}</p>
<nav class="sections" aria-label="Admin sections">
<ul>
${links}
</ul>
</nav>
<form method="post" action="/admin/sign-out" aria-label="Sign out">
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
<h2>With a passkey</h2>
<form method="post" action="/admin/sign-in/passkey" data-passkey="sign-in" data-passkey-supported hidden>
<button type="submit">Sign in with a passkey</button>
<p data-passkey-status role="status"></p>
</form>
<p data-passkey-unsupported>This browser cannot use a passkey on this page, or the page’s script is blocked. Sign in with a one-time code instead.</p>
<h2>With a one-time code</h2>
<p>On the server machine, run <code>node src/operator/cli.ts admin-code</code> (in the home deployment, <code>docker compose exec instance node src/operator/cli.ts admin-code</code>) and type the code it prints. A code works once, for 10 minutes. A code session can read every page and add one passkey; it changes nothing else.</p>
<form method="post" action="/admin/sign-in">
<label for="code">One-time code</label>
${codeProblem ? '<p class="problem" id="code-problem">That code was not accepted. A code works once, for 10 minutes: mint a new one on the server machine.</p>\n' : ''}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${described}>
<button type="submit">Sign in</button>
</form>`,
    '',
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
      ? `<form method="post" action="/admin/passkeys/${escapeHtml(passkey.id)}/revoke" data-step-up="passkey_revoke" aria-label="Revoke ${label}">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="id" value="${escapeHtml(passkey.id)}">
<button type="submit">Revoke ${label}</button>
<p data-passkey-status role="status"></p>
</form>`
      : '';
    return `<li>
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
      : `<ul class="passkeys">\n${items.join('\n')}\n</ul>`;
  const add = byPasskey
    ? '<p>To add another passkey, sign in with a one-time code from the server machine: a code session can add one.</p>'
    : view.passkeys.length >= view.max
      ? `<p>You hold ${String(view.max)} passkeys, the most there may be. Revoke one before adding another.</p>`
      : `<h2>Add a passkey</h2>
<p>This adds one passkey for ${escapeHtml(view.rpId)}, then signs you out so you can sign in with it. Revoking a passkey needs a passkey sign-in.</p>
<form method="post" action="/admin/passkeys/add" data-passkey="enrol" data-passkey-supported hidden aria-label="Add a passkey">
<input type="hidden" name="csrf" value="${csrf}">
<label for="label">A name for this passkey</label>
<input type="text" id="label" name="label" maxlength="${String(view.labelLimit)}" autocomplete="off" required>
<button type="submit">Add a passkey</button>
<p data-passkey-status role="status"></p>
</form>
<p data-passkey-unsupported>This browser cannot use a passkey on this page, or the page’s script is blocked. You can keep using the admin pages with a one-time code, which reads every page and changes nothing.</p>`;
  // Each passkey's name is an h3 under this, so the headings go 1, 2, 3 (WCAG 1.3.1).
  return `<h2>Your passkeys</h2>
${list}
${add}`;
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
  admin_passkey_enrolled: 'Admin passkey added',
  admin_passkey_revoked: 'Admin passkey revoked',
  admin_passkey_confirmed: 'Admin passkey confirmed on the host',
  room_ended: 'Room ended',
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

/** A form that makes one change behind a fresh step-up: the session's token, its fields, its button. */
function stepUpForm(
  action: string,
  change: string,
  csrf: string,
  label: string,
  inside: string,
  button: string,
): string {
  return `<form method="post" action="${action}" data-step-up="${change}" aria-label="${escapeHtml(label)}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
${inside}<button type="submit">${escapeHtml(button)}</button>
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
    if (view.strength !== 'passkey') return `<li>${line}</li>`;
    const form = stepUpForm(
      '/admin/analysis/offer',
      'analysis_offer',
      view.csrf,
      label,
      `<input type="hidden" name="offer" value="${offer}">\n<input type="hidden" name="on" value="${on ? 'off' : 'on'}">\n`,
      on ? 'Turn off' : 'Turn on',
    );
    return `<li>${line}\n${form}</li>`;
  });
  const notice =
    view.notice?.about === 'offers'
      ? noticeHtml(view.notice.ok, OFFER_SAVED_TEXT, OFFER_FAILED_TEXT)
      : '';
  return `<h2>${escapeHtml(AI_OFFERS_HEADING)}</h2>
<ul class="offers">
${items.join('\n')}
</ul>
<p>${escapeHtml(HOSTED_OFFER_SENTENCE)}</p>
${notice}`;
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
  return `<h2>${escapeHtml(AI_PICK_HEADING)}</h2>
<p>${escapeHtml(MODEL_LOAD_WARNING)}</p>
${modelList(view, view.models)}${outcome}${save}${saved}<p><a href="/admin/analysis">${escapeHtml(READ_AGAIN_BUTTON)}</a></p>
`;
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
  return `<h2>${escapeHtml(ANALYSIS_ADDRESS_HEADING)}</h2>
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
${notice}`;
}

function jobsPart(jobs: OperateJobsAnswer | undefined): string {
  const heading = `<h2>${escapeHtml(AI_JOBS_HEADING)}</h2>\n`;
  if (jobs === undefined) {
    return `${heading}<p class="problem">${escapeHtml(JOBS_UNREADABLE_TEXT)}</p>\n`;
  }
  const counts = jobCountLines(jobs)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('\n');
  const recent =
    jobs.recent.length === 0
      ? `<p>${escapeHtml(NO_JOBS_TEXT)}</p>`
      : `<ol class="log jobs">\n${jobs.recent.map((job) => `<li>${escapeHtml(jobLine(job))}</li>`).join('\n')}\n</ol>`;
  return `${heading}<ul class="counts">
${counts}
</ul>
${recent}
`;
}

function returnPart(view: AnalysisView): string {
  const notice =
    view.notice?.about === 'return'
      ? noticeHtml(view.notice.ok, RETURNED_TEXT, RETURN_FAILED_TEXT)
      : '';
  const form =
    view.strength === 'passkey'
      ? `${stepUpForm('/admin/analysis/clear', 'analysis_clear', view.csrf, RETURN_BUTTON, '', RETURN_BUTTON)}\n`
      : '';
  return `<h2>${escapeHtml(AI_RETURN_HEADING)}</h2>
<p>${escapeHtml(RETURN_SENTENCE)}</p>
${form}${notice}`;
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
  return `${top}${offersPart(view, analysis)}<h2>${escapeHtml(AI_NOW_HEADING)}</h2>
<ul class="now">
${now}
</ul>
${modelsPart(view)}${addressPart(view, analysis)}<h2>${escapeHtml(AI_OWN_KEY_HEADING)}</h2>
<ul class="own-key">
<li>${escapeHtml(ownKeyText(analysis))}</li>
</ul>
<p>${escapeHtml(ANALYSIS_KEY_ELSEWHERE_TEXT)}</p>
${jobsPart(view.jobs)}${returnPart(view)}`;
}
