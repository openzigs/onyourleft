// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The setup wizard's markup** (#2784, ADR 0080 D-1, D-7): the locked page,
 * each step's page in its frame, and the page that says the setup is done.
 * Pure, as `admin/pages.ts` is: data in, HTML out, nothing read from a store,
 * a clock or the network — so `apps/web/src/a11y/setup-pages.a11y.test.ts`
 * audits exactly what `setup.ts` serves by calling these.
 *
 * - The admin pages' frame, and their stylesheet with the setup's own rules
 *   after it (`style.ts`), linked at `/setup/setup.css` — inline on the
 *   finished page only, which answers after that address has gone — and no
 *   script at all: every step works with a keyboard and plain forms. A page
 *   that waits for the tablet or the backup service never loads itself again
 *   (WCAG 2.2.1, technique F41: a reload drops a selection of the code beside
 *   the QR and sends a screen reader back to the top); it carries a button
 *   that loads it again when the owner presses it.
 * - A skip link, one `h1`, and the banner, navigation and main landmarks; the
 *   progress bar marks the current step `aria-current="step"`, a done one with
 *   a tick and words, never by colour alone.
 * - Plain words for a non-technical owner: an environment variable or a
 *   command appears only inside a collapsed block for whoever wants it.
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
  BACKUPS_EXPERT_LINES,
  BACKUPS_FOLDERS_TEXT,
  BACKUPS_LAST_COPIED_TEXT,
  BACKUPS_LAST_COPY_FAILED_TEXT,
  BACKUPS_LAST_FAILED_TEXT,
  BACKUPS_LAST_NOT_CONFIGURED_TEXT,
  BACKUPS_LAST_RAN_TEXT,
  BACKUPS_NONE_YET_TEXT,
  BACKUPS_STEP_LEAD,
  BACKUPS_TOO_SOON_TEXT,
  BACKUPS_WAITING_TEXT,
  CLAIM_ADDRESS_LEAD,
  CLAIM_CODE_LEAD,
  CLAIM_EXPIRED_TEXT,
  CLAIM_LEAD,
  CLAIM_NO_BUTTON,
  CLAIM_NO_CARD_TEXT,
  CLAIM_NO_TEXT,
  CLAIM_NOT_CONFIRMED_TEXT,
  CLAIM_PENDING_LABEL,
  CLAIM_PENDING_LEAD,
  CLAIM_REACH_TEXT,
  CLAIM_SCANNED_BUTTON,
  CLAIM_SHOW_BUTTON,
  CLAIM_TABLET_CHECK_LEAD,
  CLAIM_WAITING_TEXT,
  CLAIM_YES_BUTTON,
  CLAIMED_NEXT_TEXT,
  CLAIMED_TEXT,
  CLAIMED_WRONG_TEXT,
  codeWorksOnceText,
  FINISH_BUTTON,
  FINISH_CLOSE_TEXT,
  FINISH_LEAD,
  FINISHED_HEADING,
  FINISHED_TEXT,
  INVITE_CHECK_AGAIN_LINK,
  INVITE_CODE_LEAD,
  INVITE_MAKE_BUTTON,
  INVITE_NO_OWNER_TEXT,
  INVITE_NOT_INVITE_MODE_TEXT,
  INVITE_REACH_TEXT,
  INVITE_STEP_LEAD,
  INVITE_TAKEN_TEXT,
  KIT_DOWNLOAD_BUTTON,
  KIT_KEEP_TEXT,
  KIT_NONE_TEXT,
  KIT_ONCE_TEXT,
  KIT_STEP_LEAD,
  KIT_TAKEN_TEXT,
  OFFBOX_RULE_TEXT,
  PASSKEY_STEP_LATER,
  PASSKEY_STEP_LEAD,
  passkeyStepHow,
  REACH_CHECKED_TEXT,
  ranAgoText,
  REGISTRATION_SAVE_BUTTON,
  REGISTRATION_STEP_LEAD,
  REGISTRATION_STEP_LEGEND,
  SETUP_CHECK_NOW_BUTTON,
  SETUP_CODE_LABEL,
  SETUP_CODE_REFUSED_TEXT,
  SETUP_EXAMPLE_ADDRESS_EXPERT_LINES,
  SETUP_EXAMPLE_ADDRESS_HEADING,
  SETUP_EXAMPLE_ADDRESS_TEXT,
  SETUP_EXPERT_SUMMARY,
  SETUP_FORM_REFUSED_TEXT,
  SETUP_LOCKED_LEAD,
  SETUP_NEW_CODE_TEXT,
  SETUP_NEXT_BUTTON,
  SETUP_REGISTRATION_MODE_TEXT,
  SETUP_SESSION_TEXT,
  SETUP_STEP_NAMES,
  SETUP_STEP_SHORT_NAMES,
  SETUP_STEPS_LABEL,
  SETUP_TITLE,
  SETUP_TOO_MANY_TEXT,
  SETUP_WRONG_ADDRESS_TEXT,
  setupStepNumberText,
  setupSummaryLines,
  type OperateRegistrationMode,
  type ReachPath,
  type SetupSummary,
} from '@onyourleft/operate-text';

import { adminPage, card, cardCodePart, WORDMARK } from '../admin/pages.ts';
import { escapeHtml } from '../html.ts';
import { SETUP_STEPS, SETUP_STYLESHEET, stepPath, type SetupStep } from './setup-routes.ts';
import { SETUP_STYLE } from './style.ts';

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

/** A page's title: its heading, then the setup's, once — never the setup's twice. */
const titleOf = (heading: string): string =>
  heading === SETUP_TITLE ? SETUP_TITLE : `${heading} — ${SETUP_TITLE}`;

/** A setup page with no session, in the same column, aligned as every step's page is. */
function signedOutPage(name: string | null, heading: string, body: string): string {
  return adminPage(
    titleOf(heading),
    `<h1>${escapeHtml(heading)}</h1>\n${body}`,
    banner(name, false),
    false,
    false,
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
<div class="narrow">
${card(`<form method="post" action="/setup/sign-in">
<label for="code">${escapeHtml(SETUP_CODE_LABEL)}</label>
${problem}<input type="text" id="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required${refused ? ' aria-describedby="code-problem"' : ''}>
<button type="submit">Open the setup</button>
</form>`)}</div>
<p class="hint">${escapeHtml(SETUP_NEW_CODE_TEXT)}</p>`,
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

/**
 * The page every setup address answers with while the instance's address is
 * still the template's example (#2855): the setup has not opened, why, and
 * what to set — one plain sentence, and the setting's name for whoever wants
 * it. No form, so no code is typed and no session is opened: a claim code, an
 * invite or an emergency kit drawn now would name an address that is not this
 * instance's. It names the example address nowhere: the owner's own goes there.
 */
export function exampleAddressPage(name: string | null): string {
  const expert = SETUP_EXAMPLE_ADDRESS_EXPERT_LINES.map(
    (line) => `<li>${escapeHtml(line)}</li>`,
  ).join('\n');
  return signedOutPage(
    name,
    SETUP_EXAMPLE_ADDRESS_HEADING,
    `<p class="problem">${escapeHtml(SETUP_EXAMPLE_ADDRESS_TEXT)}</p>
${expertDetails(`<ul>\n${expert}\n</ul>`)}`,
  );
}

/** The stylesheet the finished page carries inline: `/setup/setup.css`, whole. */
export const FINISHED_PAGE_STYLE = SETUP_STYLE;

/**
 * The page the finished setup answers with, once (ADR 0080 D-7): after it,
 * `/setup` is `not_found` — `/setup/setup.css` with it — so this page carries
 * its stylesheet inline, {@link FINISHED_PAGE_STYLE}, and its response allows
 * exactly that sheet by its hash (`setup.ts`).
 */
export function finishedPage(name: string | null): string {
  return adminPage(
    titleOf(FINISHED_HEADING),
    `<h1>${escapeHtml(FINISHED_HEADING)}</h1>\n<p>${escapeHtml(FINISHED_TEXT)}</p>`,
    banner(name, false),
    false,
    false,
    null,
    `<style>${FINISHED_PAGE_STYLE}</style>\n`,
  );
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

/** A collapsed block of commands and settings names, for whoever wants them. */
function expertDetails(inner: string): string {
  return `<details>
<summary>${escapeHtml(SETUP_EXPERT_SUMMARY)}</summary>
${inner}
</details>`;
}

/**
 * The progress bar: every step in one row, each the same box whether it is a
 * link or not. A step before the furthest reached is done and carries a tick
 * (read as "done"); the current one is marked `aria-current="step"`; a step
 * not reached yet is not a link. The mark is never colour alone. Each step's
 * name starts with its number, "Step 5: Who may join", because the number is
 * all a narrow screen shows of it (WCAG 2.5.3, label in name).
 */
function stepsNav(frame: SetupFrame): string {
  const reached = SETUP_STEPS.indexOf(frame.reached);
  const items = SETUP_STEPS.map((step, index) => {
    const done = index < reached;
    const mark = `<span class="step-mark" aria-hidden="true">${done ? '✓' : String(index + 1)}</span>`;
    const said = `<span class="visually-hidden">${escapeHtml(setupStepNumberText(index + 1, done))} </span>`;
    const name = `<span class="step-name">${escapeHtml(SETUP_STEP_SHORT_NAMES[step])}</span>`;
    const inner = `${mark}${said}${name}`;
    if (step === frame.step) {
      return `<li><a class="step" href="${stepPath(step)}" aria-current="step">${inner}</a></li>`;
    }
    return index <= reached
      ? `<li><a class="step" href="${stepPath(step)}">${inner}</a></li>`
      : `<li><span class="step">${inner}</span></li>`;
  }).join('\n');
  return `<nav class="steps" aria-label="${escapeHtml(SETUP_STEPS_LABEL)}">
<ol>
${items}
</ol>
</nav>
`;
}

/** What a step's page carries besides its body. */
export interface StepPageOptions {
  /** The form that moves on to the next step. */
  readonly next: boolean;
}

/**
 * A step's page: the banner and the progress bar, the step's name as the one
 * `h1`, its `body`, and — with `next` — the form that moves on.
 */
export function stepPage(frame: SetupFrame, body: string, options: StepPageOptions): string {
  const before = `<a class="skip" href="#main">Skip to the page</a>
<header class="shell">
<div class="shell-inner">
<p class="brand">${WORDMARK} <span class="name">${escapeHtml(instanceName(frame.name))}</span></p>
${stepsNav(frame)}</div>
</header>
`;
  const heading = SETUP_STEP_NAMES[frame.step];
  const moveOn = options.next
    ? `${buttonForm('/setup/next', frame.csrf, SETUP_NEXT_BUTTON, { from: frame.step })}\n`
    : '';
  return adminPage(
    titleOf(heading),
    `<h1>${escapeHtml(heading)}</h1>
${body.trimEnd()}
${moveOn}<p class="hint">${escapeHtml(SETUP_SESSION_TEXT)}</p>`,
    before,
    false,
    false,
    SETUP_STYLESHEET,
  );
}

/**
 * A button that loads `path` again, for a page that waits for something outside
 * this browser: a `GET` form, so no script, and pressed only by the owner.
 */
const checkAgain = (path: string, label: string): string =>
  `<form method="get" action="${escapeHtml(path)}" aria-label="${escapeHtml(label)}"><button type="submit">${escapeHtml(label)}</button></form>`;

/** A link that checks again now. */
const checkNow = (path: string, text: string): string =>
  `<a href="${escapeHtml(path)}">${escapeHtml(text)}</a>`;

// --- claim

/**
 * Where the tablet reaches this server, and what it needs before it can
 * (#2855): said before the claim code is shown, and beside it.
 */
export interface ReachView {
  /** `OYL_INSTANCE_ORIGIN`: the address the card names, and so the one the tablet uses. */
  readonly origin: string;
  readonly path: ReachPath;
  /**
   * What this computer could check by itself: the tunnel connected or not, or
   * `null` when it cannot tell — on a tailnet it never can, and says nothing.
   */
  readonly checked: 'connected' | 'not-connected' | null;
}

/**
 * The address, what the tablet needs first, and how to check it from the
 * tablet: `<origin>/health`, which answers anybody. The address is the
 * operator's own setting, escaped; it is shown on this loopback page only.
 */
function reachPart(reach: ReachView): string {
  const checked =
    reach.checked === null
      ? ''
      : reach.checked === 'connected'
        ? `\n<p class="notice" role="status">${escapeHtml(REACH_CHECKED_TEXT.connected)}</p>`
        : `\n<p class="problem">${escapeHtml(REACH_CHECKED_TEXT['not-connected'])}</p>`;
  return card(`<p>${escapeHtml(CLAIM_ADDRESS_LEAD)} <code>${escapeHtml(reach.origin)}</code></p>
<p class="warning">${escapeHtml(CLAIM_REACH_TEXT[reach.path])}</p>
<p>${escapeHtml(CLAIM_TABLET_CHECK_LEAD)} <code>${escapeHtml(`${reach.origin}/health`)}</code></p>${checked}`);
}

/** What the claim step shows. */
export type ClaimView =
  /** The instance has an owner. */
  | { readonly kind: 'claimed' }
  /** A tablet redeemed the code: its six-digit comparison number (ADR 0080 D-5). */
  | { readonly kind: 'pending'; readonly comparisonCode: string }
  /**
   * No claim in flight: the button that shows a code, or why there is none.
   * `expired`: the code this session was shown has just run out (#2825).
   */
  | {
      readonly kind: 'open';
      readonly card: boolean;
      readonly notConfirmed: boolean;
      readonly reach: ReachView;
      readonly expired: boolean;
    }
  /** A code minted and not yet scanned: the card and it, as a QR and as text, and the wait. */
  | {
      readonly kind: 'code';
      readonly card: string;
      readonly code: string;
      /** ISO 8601, UTC. */
      readonly expiresAt: string;
      /** How long the code has left, in seconds. */
      readonly secondsLeft: number;
      readonly reach: ReachView;
    };

export function claimBody(view: ClaimView, csrf: string): string {
  switch (view.kind) {
    case 'claimed':
      return `<p class="notice" role="status">${escapeHtml(CLAIMED_TEXT)}</p>
<p>${escapeHtml(CLAIMED_NEXT_TEXT)}</p>
<p class="hint">${escapeHtml(CLAIMED_WRONG_TEXT)}</p>`;
    case 'pending':
      return card(`<p>${escapeHtml(CLAIM_PENDING_LEAD)}</p>
<p>${escapeHtml(CLAIM_PENDING_LABEL)}:</p>
<p class="compare"><strong>${escapeHtml(view.comparisonCode.slice(0, 3))}</strong> <strong>${escapeHtml(view.comparisonCode.slice(3))}</strong></p>
${buttonForm('/setup/claim/confirm', csrf, CLAIM_YES_BUTTON, { comparison: view.comparisonCode })}
${buttonForm('/setup/claim/discard', csrf, CLAIM_NO_BUTTON, {}, 'secondary')}
<p class="hint">${escapeHtml(CLAIM_NO_TEXT)}</p>`);
    case 'open': {
      // One sentence at most: a claim that could not be confirmed says more than a code that ran out.
      const problem = view.notConfirmed
        ? CLAIM_NOT_CONFIRMED_TEXT
        : view.expired
          ? CLAIM_EXPIRED_TEXT
          : null;
      return `${problem === null ? '' : `<p class="problem" role="alert">${escapeHtml(problem)}</p>\n`}<p>${escapeHtml(CLAIM_LEAD)}</p>
${reachPart(view.reach)}${view.card ? buttonForm('/setup/claim/code', csrf, CLAIM_SHOW_BUTTON) : `<p class="problem">${escapeHtml(CLAIM_NO_CARD_TEXT)}</p>`}`;
    }
    case 'code':
      return `${cardCodePart(
        { purpose: 'claim', card: view.card, code: view.code, expiresAt: view.expiresAt },
        { lead: CLAIM_CODE_LEAD, until: codeWorksOnceText(view.secondsLeft) },
      )}<p class="notice">${escapeHtml(CLAIM_WAITING_TEXT)}</p>
${checkAgain('/setup/claim', CLAIM_SCANNED_BUTTON)}
${reachPart(view.reach)}`;
  }
}

// --- passkey

export function passkeyBody(adminAddress: string): string {
  const steps = passkeyStepHow(adminAddress)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('\n');
  return `<p>${escapeHtml(PASSKEY_STEP_LEAD)}</p>
<p>${escapeHtml(PASSKEY_STEP_LATER)}</p>
${expertDetails(`<ol>\n${steps}\n</ol>`)}`;
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
  /** ISO 8601, UTC: the `time` element's `datetime`, never what the page says. */
  readonly at: string;
  /** How long ago it ran, in seconds, by the server's clock: what the page says (#2825). */
  readonly secondsAgo: number;
  readonly outcome: 'done' | 'failed';
  readonly offBox: 'copied' | 'failed' | 'not-configured' | null;
}

export interface BackupsStepView {
  /** The newest record, or `null`: none yet. */
  readonly last: BackupStepRecord | null;
  /** A "back up now" waits for the backup service: the page says so, with the button that checks again. */
  readonly waiting: boolean;
  /** What the last "back up now" here came to. */
  readonly notice: 'asked' | 'too-soon' | null;
}

/** The last backup's outcome, in the box its tone draws: a success only when both folders worked. */
function lastBackupResult(last: BackupStepRecord): string {
  if (last.outcome === 'failed') {
    return `<p class="problem">${escapeHtml(BACKUPS_LAST_FAILED_TEXT)}</p>`;
  }
  if (last.offBox === 'copied') {
    return `<p class="notice" role="status">${escapeHtml(BACKUPS_LAST_COPIED_TEXT)}</p>`;
  }
  const text =
    last.offBox === 'failed' ? BACKUPS_LAST_COPY_FAILED_TEXT : BACKUPS_LAST_NOT_CONFIGURED_TEXT;
  return `<p class="warning">${escapeHtml(text)}</p>`;
}

export function backupsBody(view: BackupsStepView, csrf: string): string {
  const button = buttonForm('/setup/backups/now', csrf, BACK_UP_NOW_STEP_BUTTON);
  // While a backup waits, the wait is the whole state: no "none yet", no button.
  const state = view.waiting
    ? `<p class="notice">${escapeHtml(BACKUPS_WAITING_TEXT)}</p>\n${checkAgain('/setup/backups', SETUP_CHECK_NOW_BUTTON)}`
    : view.last === null
      ? `<p>${escapeHtml(BACKUPS_NONE_YET_TEXT)}</p>\n${button}`
      : `<p>${escapeHtml(BACKUPS_LAST_RAN_TEXT)} <time datetime="${escapeHtml(view.last.at)}">${escapeHtml(ranAgoText(view.last.secondsAgo))}</time>.</p>
${lastBackupResult(view.last)}
${button}`;
  const tooSoon =
    view.notice === 'too-soon' && !view.waiting
      ? `<p class="problem" role="alert">${escapeHtml(BACKUPS_TOO_SOON_TEXT)}</p>\n`
      : '';
  const expert = BACKUPS_EXPERT_LINES.map((line) => `<li>${escapeHtml(line)}</li>`).join('\n');
  return `<p>${escapeHtml(BACKUPS_STEP_LEAD)}</p>
${tooSoon}${card(state)}<p>${escapeHtml(BACKUPS_FOLDERS_TEXT)}</p>
<p class="warning">${escapeHtml(OFFBOX_RULE_TEXT)}</p>
${expertDetails(`<ul>\n${expert}\n</ul>`)}`;
}

// --- registration

export interface RegistrationStepView {
  /** The mode a new rider meets now: the choice already checked. */
  readonly mode: OperateRegistrationMode;
}

/**
 * Who may join: the four modes in the setup's own words, and ONE button that
 * saves the choice and moves on — a choice is never left behind unsaved.
 */
export function registrationBody(view: RegistrationStepView, csrf: string): string {
  const choices = (Object.keys(SETUP_REGISTRATION_MODE_TEXT) as OperateRegistrationMode[])
    .map((mode) => {
      const id = `mode-${mode}`;
      const text = SETUP_REGISTRATION_MODE_TEXT[mode];
      return `<div class="choice"><input type="radio" id="${id}" name="mode" value="${mode}"${mode === view.mode ? ' checked' : ''} aria-describedby="${id}-meaning"><label for="${id}">${escapeHtml(text.short)}</label></div>
<p class="hint" id="${id}-meaning">${escapeHtml(text.meaning)}</p>`;
    })
    .join('\n');
  return `<p>${escapeHtml(REGISTRATION_STEP_LEAD)}</p>
<form method="post" action="/setup/registration/mode" aria-label="${escapeHtml(REGISTRATION_STEP_LEGEND)}">${csrfField(csrf)}
<fieldset>
<legend>${escapeHtml(REGISTRATION_STEP_LEGEND)}</legend>
${choices}
</fieldset>
<button type="submit">${escapeHtml(REGISTRATION_SAVE_BUTTON)}</button>
</form>`;
}

// --- invite

export type InviteView =
  | { readonly kind: 'offer'; readonly inviteMode: boolean; readonly reach: ReachPath }
  | { readonly kind: 'taken' }
  | { readonly kind: 'no-owner' }
  | { readonly kind: 'no-card' }
  | {
      readonly kind: 'code';
      readonly card: string;
      readonly code: string;
      readonly expiresAt: string;
      /** How long the invite has left, in seconds. */
      readonly secondsLeft: number;
      readonly inviteMode: boolean;
      /** What the rider's device needs first (#2855). */
      readonly reach: ReachPath;
    };

export function inviteBody(view: InviteView, csrf: string): string {
  const notInvite = (inviteMode: boolean): string =>
    inviteMode ? '' : `<p class="hint">${escapeHtml(INVITE_NOT_INVITE_MODE_TEXT)}</p>`;
  // #2855: the rider's device needs the same way in as the owner's tablet did.
  const needs = (reach: ReachPath): string =>
    `<p class="warning">${escapeHtml(INVITE_REACH_TEXT[reach])}</p>`;
  switch (view.kind) {
    case 'offer':
      return `<p>${escapeHtml(INVITE_STEP_LEAD)}</p>
${needs(view.reach)}
${buttonForm('/setup/invite/code', csrf, INVITE_MAKE_BUTTON)}
${notInvite(view.inviteMode)}`;
    case 'taken':
      return `<p class="notice" role="status">${escapeHtml(INVITE_TAKEN_TEXT)}</p>`;
    case 'no-owner':
      // An instruction, not a fault: the tablet has one more thing to do.
      return `<p>${escapeHtml(INVITE_STEP_LEAD)}</p>
<p class="notice">${escapeHtml(INVITE_NO_OWNER_TEXT)} ${checkNow('/setup/invite', INVITE_CHECK_AGAIN_LINK)}.</p>`;
    case 'no-card':
      return `<p>${escapeHtml(INVITE_STEP_LEAD)}</p>\n<p class="problem">${escapeHtml(CLAIM_NO_CARD_TEXT)}</p>`;
    case 'code':
      return `${cardCodePart(
        { purpose: 'invite', card: view.card, code: view.code, expiresAt: view.expiresAt },
        { lead: INVITE_CODE_LEAD, until: codeWorksOnceText(view.secondsLeft) },
      )}${needs(view.reach)}
${notInvite(view.inviteMode)}`;
  }
}

// --- finish

/** Where the server stands, in plain words (`setupSummaryLines`), and the button that finishes. */
export function finishBody(summary: SetupSummary, csrf: string): string {
  const lines = setupSummaryLines(summary)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('\n');
  return `<p>${escapeHtml(FINISH_LEAD)}</p>
<ul class="summary">
${lines}
</ul>
<p>${escapeHtml(FINISH_CLOSE_TEXT)}</p>
${buttonForm('/setup/finish/done', csrf, FINISH_BUTTON)}`;
}
