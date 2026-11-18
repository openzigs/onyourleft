// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The setup wizard's markup** (#2784, ADR 0080 D-1, D-7): the locked page,
 * each step's page in its frame, and the page that says the setup is done.
 * Pure, as `admin/pages.ts` is: data in, HTML out, nothing read from a store,
 * a clock or the network — so `apps/web/src/a11y/admin-pages.a11y.test.ts`
 * audits exactly what `setup.ts` serves by calling these.
 *
 * - The admin pages' frame and stylesheet (`admin/pages.ts` §`adminPage`,
 *   `admin/style.ts`), linked at `/setup/setup.css`, and no script at all:
 *   every step works with a keyboard and plain forms.
 * - A skip link, one `h1`, and the banner, navigation and main landmarks; the
 *   steps list marks the current step `aria-current="step"`.
 * - Every word is `@onyourleft/operate-text`'s (`setup.ts`), and everything
 *   put into a page goes through `html.ts` §`escapeHtml`.
 *
 * ⚠️ **Nothing here renders the setup code, a secret, a session token or a
 * coordinate.** The exceptions are ADR 0080's own: the claim code and the
 * invite beside the card, as a QR and as text (`admin/pages.ts`
 * §`cardCodePart`), and the claim's six-digit comparison number (D-5) — each
 * on this loopback page only.
 */

import {
  BACK_UP_NOW_STEP_BUTTON,
  BACKUPS_FOLDERS_TEXT,
  BACKUPS_LAST_AT_TEXT,
  BACKUPS_LAST_COPIED_TEXT,
  BACKUPS_LAST_COPY_FAILED_TEXT,
  BACKUPS_LAST_FAILED_TEXT,
  BACKUPS_LAST_NOT_CONFIGURED_TEXT,
  BACKUPS_NONE_YET_TEXT,
  BACKUPS_READ_AGAIN_LINK,
  BACKUPS_STEP_LEAD,
  BACKUPS_TOO_SOON_TEXT,
  BACKUPS_WAITING_TEXT,
  CLAIM_AFTER_SCAN_TEXT,
  CLAIM_COMPARE_LINK,
  CLAIM_LEAD,
  CLAIM_NO_BUTTON,
  CLAIM_NO_CARD_TEXT,
  CLAIM_NO_TEXT,
  CLAIM_NOT_CONFIRMED_TEXT,
  CLAIM_PENDING_LABEL,
  CLAIM_PENDING_LEAD,
  CLAIM_SHOW_BUTTON,
  CLAIM_YES_BUTTON,
  CLAIMED_TEXT,
  FINISH_BUTTON,
  FINISH_LEAD,
  FINISH_NOTHING_TEXT,
  FINISHED_HEADING,
  FINISHED_TEXT,
  INVITE_MAKE_BUTTON,
  INVITE_NO_OWNER_TEXT,
  INVITE_NOT_INVITE_MODE_TEXT,
  INVITE_STEP_LEAD,
  INVITE_TAKEN_TEXT,
  KIT_DOWNLOAD_BUTTON,
  KIT_KEEP_TEXT,
  KIT_NONE_TEXT,
  KIT_ONCE_TEXT,
  KIT_STEP_LEAD,
  KIT_TAKEN_TEXT,
  momentText,
  OFFBOX_RULE_TEXT,
  PASSKEY_STEP_LEAD,
  PASSKEY_STEP_SKIP,
  passkeyStepHow,
  REGISTRATION_FROM_ENV_TEXT,
  REGISTRATION_FROM_SETUP_TEXT,
  REGISTRATION_MODE_TEXT,
  REGISTRATION_NOW_TEXT,
  REGISTRATION_SAVE_BUTTON,
  REGISTRATION_SAVED_TEXT,
  REGISTRATION_STEP_LEAD,
  REGISTRATION_STEP_LEGEND,
  SETUP_CODE_LABEL,
  SETUP_CODE_REFUSED_TEXT,
  SETUP_FORM_REFUSED_TEXT,
  SETUP_LOCKED_LEAD,
  SETUP_NEW_CODE_TEXT,
  SETUP_NEXT_BUTTON,
  SETUP_SESSION_TEXT,
  SETUP_STEP_NAMES,
  SETUP_STEPS_LABEL,
  SETUP_TITLE,
  SETUP_TOO_MANY_TEXT,
  SETUP_WRONG_ADDRESS_TEXT,
  type OperateRegistrationMode,
} from '@onyourleft/operate-text';

import { adminPage, card, cardCodePart, WORDMARK } from '../admin/pages.ts';
import { escapeHtml } from '../html.ts';
import { SETUP_STEPS, SETUP_STYLESHEET, stepPath, type SetupStep } from './setup-routes.ts';

const instanceName = (name: string | null): string => (name === null ? 'this instance' : name);

/** The banner every setup page carries: the mark, and the instance's name. */
function banner(name: string | null, skip: boolean): string {
  return `${skip ? '<a class="skip" href="#main">Skip to the page</a>\n' : ''}<header class="shell">
<div class="shell-inner">
<p class="brand">${WORDMARK} <span class="name">${escapeHtml(instanceName(name))}</span></p>
</div>
</header>
`;
}

/** A setup page with no session: the narrow column of the admin sign-in. */
function signedOutPage(name: string | null, heading: string, body: string): string {
  return adminPage(
    `${heading} — ${SETUP_TITLE}`,
    `<h1>${escapeHtml(heading)}</h1>\n${body}`,
    banner(name, false),
    false,
    true,
    SETUP_STYLESHEET,
  );
}

/** What the locked page says above its form. */
export type LockedNotice = 'code-refused' | 'too-many' | null;

/**
 * The locked page (ADR 0080 D-1, D-2): where the code is, and its one form.
 * It carries no secret: the tunnel can reach this page on Docker Desktop.
 */
export function lockedPage(name: string | null, notice: LockedNotice): string {
  const refused = notice === 'code-refused';
  const problem = refused
    ? `<p class="problem" id="code-problem" role="alert">${escapeHtml(SETUP_CODE_REFUSED_TEXT)}</p>\n`
    : notice === 'too-many'
      ? `<p class="problem" role="alert">${escapeHtml(SETUP_TOO_MANY_TEXT)}</p>\n`
      : '';
  return signedOutPage(
    name,
    SETUP_TITLE,
    `<p>${escapeHtml(SETUP_LOCKED_LEAD)}</p>
${card(`<form method="post" action="/setup/sign-in">
<label for="code">${escapeHtml(SETUP_CODE_LABEL)}</label>
${problem}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${refused ? ' aria-describedby="code-problem"' : ''}>
<button type="submit">Open the setup</button>
</form>`)}<p class="hint">${escapeHtml(SETUP_NEW_CODE_TEXT)}</p>`,
  );
}

/** The page for a `Host` that is not `localhost:<port>` (DNS rebinding; ADR 0080 D-1). */
export function wrongAddressPage(address: string): string {
  return signedOutPage(
    null,
    'Open the setup page at its own address',
    `<p>${escapeHtml(SETUP_WRONG_ADDRESS_TEXT)} <a href="${escapeHtml(address)}">${escapeHtml(address)}</a></p>`,
  );
}

/** A form refused before anything was read: the wrong origin, or no session's token. */
export function formRefusedPage(): string {
  return signedOutPage(
    null,
    'That form was not accepted',
    `<p>${escapeHtml(SETUP_FORM_REFUSED_TEXT)} <a href="/setup">Go back to the setup page</a>.</p>`,
  );
}

/** A short page with one heading, a sentence and the way back. */
export function messagePage(heading: string, text: string): string {
  return signedOutPage(
    null,
    heading,
    `<p>${escapeHtml(text)}</p>\n<p><a href="/setup">Go back to the setup page</a>.</p>`,
  );
}

/** The page the finished setup answers with, once (ADR 0080 D-7): after it, `/setup` is `not_found`. */
export function finishedPage(name: string | null): string {
  return signedOutPage(name, FINISHED_HEADING, `<p>${escapeHtml(FINISHED_TEXT)}</p>`);
}

/** A step's frame: where the browser is, how far the setup has come, and its token. */
export interface SetupFrame {
  readonly name: string | null;
  /** The step this page is. */
  readonly step: SetupStep;
  /** The furthest step the setup has reached: the steps after it are not links. */
  readonly reached: SetupStep;
  /** The session's synchronizer token, for each form. */
  readonly csrf: string;
}

const csrfField = (csrf: string): string =>
  `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;

/** A form of one button, posting the session's token and `fields`. */
function buttonForm(
  action: string,
  csrf: string,
  label: string,
  fields: Readonly<Record<string, string>> = {},
  tone: 'primary' | 'secondary' = 'primary',
): string {
  const hidden = Object.entries(fields)
    .map(
      ([field, value]) =>
        `<input type="hidden" name="${escapeHtml(field)}" value="${escapeHtml(value)}">`,
    )
    .join('');
  // Named, as every form on a page of several must be (`a11y/audit.ts` §`landmarks-are-distinguishable`).
  return `<form method="post" action="${escapeHtml(action)}" aria-label="${escapeHtml(label)}">${csrfField(csrf)}${hidden}<button type="submit"${tone === 'secondary' ? ' class="secondary"' : ''}>${escapeHtml(label)}</button></form>`;
}

/** The steps, in order: a link to each the setup has reached, the current one marked. */
function stepsNav(frame: SetupFrame): string {
  const reached = SETUP_STEPS.indexOf(frame.reached);
  const items = SETUP_STEPS.map((step, index) => {
    const label = escapeHtml(SETUP_STEP_NAMES[step]);
    if (step === frame.step) {
      return `<li><a href="${stepPath(step)}" aria-current="step">${label}</a></li>`;
    }
    return index <= reached
      ? `<li><a href="${stepPath(step)}">${label}</a></li>`
      : `<li>${label}</li>`;
  }).join('\n');
  return `<nav class="sections" aria-label="${escapeHtml(SETUP_STEPS_LABEL)}">
<ol>
${items}
</ol>
</nav>
`;
}

/**
 * A step's page: the banner and the steps list, the step's name as the one
 * `h1`, its `body`, and — with `next` — the form that moves on.
 */
export function stepPage(frame: SetupFrame, body: string, next: boolean): string {
  const before = `<a class="skip" href="#main">Skip to the page</a>
<header class="shell">
<div class="shell-inner">
<p class="brand">${WORDMARK} <span class="name">${escapeHtml(instanceName(frame.name))}</span></p>
${stepsNav(frame)}</div>
</header>
`;
  const heading = SETUP_STEP_NAMES[frame.step];
  const moveOn = next
    ? `${buttonForm('/setup/next', frame.csrf, SETUP_NEXT_BUTTON, { from: frame.step })}\n`
    : '';
  return adminPage(
    `${heading} — ${SETUP_TITLE}`,
    `<h1>${escapeHtml(heading)}</h1>
${body.trimEnd()}
${moveOn}<p class="hint">${escapeHtml(SETUP_SESSION_TEXT)}</p>`,
    before,
    false,
    false,
    SETUP_STYLESHEET,
  );
}

// --- claim

/** What the claim step shows. */
export type ClaimView =
  /** The instance has an owner. */
  | { readonly kind: 'claimed' }
  /** A tablet redeemed the code: its six-digit comparison number (ADR 0080 D-5). */
  | { readonly kind: 'pending'; readonly comparisonCode: string }
  /** No claim in flight: the button that shows a code, or why there is none. */
  | { readonly kind: 'open'; readonly card: boolean; readonly notConfirmed: boolean }
  /** A code just minted: the card and it, as a QR and as text. */
  | {
      readonly kind: 'code';
      readonly card: string;
      readonly code: string;
      /** ISO 8601, UTC. */
      readonly expiresAt: string;
    };

/** Six digits as two groups of three, for reading aloud. */
const grouped = (digits: string): string => `${digits.slice(0, 3)} ${digits.slice(3)}`;

export function claimBody(view: ClaimView, csrf: string): string {
  switch (view.kind) {
    case 'claimed':
      return `<p class="notice" role="status">${escapeHtml(CLAIMED_TEXT)}</p>`;
    case 'pending':
      return card(`<p>${escapeHtml(CLAIM_PENDING_LEAD)}</p>
<p class="figure"><span class="label">${escapeHtml(CLAIM_PENDING_LABEL)}:</span> <strong>${escapeHtml(grouped(view.comparisonCode))}</strong></p>
${buttonForm('/setup/claim/confirm', csrf, CLAIM_YES_BUTTON, { comparison: view.comparisonCode })}
${buttonForm('/setup/claim/discard', csrf, CLAIM_NO_BUTTON, {}, 'secondary')}
<p class="hint">${escapeHtml(CLAIM_NO_TEXT)}</p>`);
    case 'open':
      return `${view.notConfirmed ? `<p class="problem" role="alert">${escapeHtml(CLAIM_NOT_CONFIRMED_TEXT)}</p>\n` : ''}<p>${escapeHtml(CLAIM_LEAD)}</p>
${view.card ? buttonForm('/setup/claim/code', csrf, CLAIM_SHOW_BUTTON) : `<p class="problem">${escapeHtml(CLAIM_NO_CARD_TEXT)}</p>`}`;
    case 'code':
      return `${cardCodePart({ purpose: 'claim', card: view.card, code: view.code, expiresAt: view.expiresAt })}<p>${escapeHtml(CLAIM_AFTER_SCAN_TEXT)} <a href="/setup/claim">${escapeHtml(CLAIM_COMPARE_LINK)}</a>.</p>`;
  }
}

// --- passkey

export function passkeyBody(adminAddress: string): string {
  const steps = passkeyStepHow(adminAddress)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('\n');
  return `<p>${escapeHtml(PASSKEY_STEP_LEAD)}</p>
<ol>
${steps}
</ol>
<p>${escapeHtml(PASSKEY_STEP_SKIP)}</p>`;
}

// --- the emergency kit

/** Whether this session may download the kit, has, or there is none. */
export type KitView = 'offer' | 'taken' | 'none';

export function secretsBody(view: KitView, csrf: string): string {
  if (view === 'none') return `<p>${escapeHtml(KIT_NONE_TEXT)}</p>`;
  const action =
    view === 'offer'
      ? `${buttonForm('/setup/secrets/kit', csrf, KIT_DOWNLOAD_BUTTON)}\n<p class="hint">${escapeHtml(KIT_ONCE_TEXT)}</p>`
      : `<p class="notice" role="status">${escapeHtml(KIT_TAKEN_TEXT)}</p>`;
  return `<p>${escapeHtml(KIT_STEP_LEAD)}</p>
<p class="warning">${escapeHtml(KIT_KEEP_TEXT)}</p>
${action}`;
}

// --- backups

/** The newest backup, as the backups step reads it from its record. */
export interface BackupStepRecord {
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly outcome: 'done' | 'failed';
  readonly offBox: 'copied' | 'failed' | 'not-configured' | null;
}

export interface BackupsStepView {
  /** The newest record, or `null`: none yet. */
  readonly last: BackupStepRecord | null;
  /** A "back up now" waits for the backup service. */
  readonly waiting: boolean;
  /** What the last "back up now" here came to. */
  readonly notice: 'asked' | 'too-soon' | null;
}

function lastBackupText(last: BackupStepRecord): string {
  if (last.outcome === 'failed') return BACKUPS_LAST_FAILED_TEXT;
  if (last.offBox === 'copied') return BACKUPS_LAST_COPIED_TEXT;
  if (last.offBox === 'failed') return BACKUPS_LAST_COPY_FAILED_TEXT;
  return BACKUPS_LAST_NOT_CONFIGURED_TEXT;
}

export function backupsBody(view: BackupsStepView, csrf: string): string {
  const state =
    view.last === null
      ? `<p>${escapeHtml(BACKUPS_NONE_YET_TEXT)}</p>`
      : `<p>${escapeHtml(BACKUPS_LAST_AT_TEXT)} <time datetime="${escapeHtml(view.last.at)}">${escapeHtml(momentText(view.last.at))}</time>. ${escapeHtml(lastBackupText(view.last))}</p>`;
  const notice =
    view.notice === 'too-soon'
      ? `<p class="problem" role="alert">${escapeHtml(BACKUPS_TOO_SOON_TEXT)}</p>\n`
      : view.waiting
        ? `<p class="notice" role="status">${escapeHtml(BACKUPS_WAITING_TEXT)} <a href="/setup/backups">${escapeHtml(BACKUPS_READ_AGAIN_LINK)}</a>.</p>\n`
        : '';
  return `<p>${escapeHtml(BACKUPS_STEP_LEAD)}</p>
${notice}${card(`${state}
${view.waiting ? '' : buttonForm('/setup/backups/now', csrf, BACK_UP_NOW_STEP_BUTTON)}`)}<p>${escapeHtml(BACKUPS_FOLDERS_TEXT)}</p>
<p class="warning">${escapeHtml(OFFBOX_RULE_TEXT)}</p>`;
}

// --- registration

export interface RegistrationStepView {
  /** The mode a new rider meets now. */
  readonly mode: OperateRegistrationMode;
  /** Where it is set: here (the database), or `.env`. */
  readonly from: 'setup' | 'env';
  readonly saved: boolean;
}

export function registrationBody(view: RegistrationStepView, csrf: string): string {
  const choices = (Object.keys(REGISTRATION_MODE_TEXT) as OperateRegistrationMode[])
    .map((mode) => {
      const id = `mode-${mode}`;
      const text = REGISTRATION_MODE_TEXT[mode];
      return `<div><input type="radio" id="${id}" name="mode" value="${mode}"${mode === view.mode ? ' checked' : ''} aria-describedby="${id}-meaning"> <label for="${id}">${escapeHtml(text.short)}</label>
<p class="hint" id="${id}-meaning">${escapeHtml(text.meaning)}</p></div>`;
    })
    .join('\n');
  return `${view.saved ? `<p class="notice" role="status">${escapeHtml(REGISTRATION_SAVED_TEXT)}</p>\n` : ''}<p>${escapeHtml(REGISTRATION_STEP_LEAD)}</p>
<p>${escapeHtml(REGISTRATION_NOW_TEXT)} ${escapeHtml(REGISTRATION_MODE_TEXT[view.mode].short)}. ${escapeHtml(view.from === 'setup' ? REGISTRATION_FROM_SETUP_TEXT : REGISTRATION_FROM_ENV_TEXT)}</p>
${card(`<form method="post" action="/setup/registration/mode" aria-label="${escapeHtml(REGISTRATION_STEP_LEGEND)}">${csrfField(csrf)}
<fieldset>
<legend>${escapeHtml(REGISTRATION_STEP_LEGEND)}</legend>
${choices}
</fieldset>
<button type="submit">${escapeHtml(REGISTRATION_SAVE_BUTTON)}</button>
</form>`)}`;
}

// --- invite

export type InviteView =
  | { readonly kind: 'offer'; readonly inviteMode: boolean }
  | { readonly kind: 'taken' }
  | { readonly kind: 'no-owner' }
  | { readonly kind: 'no-card' }
  | {
      readonly kind: 'code';
      readonly card: string;
      readonly code: string;
      readonly expiresAt: string;
      readonly inviteMode: boolean;
    };

export function inviteBody(view: InviteView, csrf: string): string {
  const notInvite = (inviteMode: boolean): string =>
    inviteMode ? '' : `<p class="hint">${escapeHtml(INVITE_NOT_INVITE_MODE_TEXT)}</p>`;
  switch (view.kind) {
    case 'offer':
      return `<p>${escapeHtml(INVITE_STEP_LEAD)}</p>
${buttonForm('/setup/invite/code', csrf, INVITE_MAKE_BUTTON)}
${notInvite(view.inviteMode)}`;
    case 'taken':
      return `<p class="notice" role="status">${escapeHtml(INVITE_TAKEN_TEXT)}</p>`;
    case 'no-owner':
      return `<p>${escapeHtml(INVITE_STEP_LEAD)}</p>\n<p class="problem">${escapeHtml(INVITE_NO_OWNER_TEXT)}</p>`;
    case 'no-card':
      return `<p>${escapeHtml(INVITE_STEP_LEAD)}</p>\n<p class="problem">${escapeHtml(CLAIM_NO_CARD_TEXT)}</p>`;
    case 'code':
      return `${cardCodePart({ purpose: 'invite', card: view.card, code: view.code, expiresAt: view.expiresAt })}${notInvite(view.inviteMode)}`;
  }
}

// --- finish

/** `changes`: what this setup session changed, oldest first, each in the operator log's words. */
export function finishBody(changes: readonly string[], csrf: string): string {
  const list =
    changes.length === 0
      ? `<p>${escapeHtml(FINISH_NOTHING_TEXT)}</p>`
      : `<ul>\n${changes.map((change) => `<li>${escapeHtml(change)}</li>`).join('\n')}\n</ul>`;
  return `<p>${escapeHtml(FINISH_LEAD)}</p>
${list}
${buttonForm('/setup/finish/done', csrf, FINISH_BUTTON)}`;
}
