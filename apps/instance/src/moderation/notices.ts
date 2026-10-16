// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A notice of illegal content, from anybody** (#907): the form on the
 * instance's notice page, what it accepts, and the page itself.
 *
 * #83's report is a SIGNED-IN rider reporting a rider id. DSA Art. 16(1) asks
 * for a mechanism for *"any individual or entity"*, and OSA s.20(2) and (5)
 * for users and *"affected persons"*, who are not users. So this takes a
 * notice with no account, from a page that works with no app and no script.
 *
 * ## What a notice carries — Art. 16(2)
 *
 * | Art. 16(2) | Field | Required |
 * | --- | --- | --- |
 * | (a) the reasons | `explanation` | yes |
 * | (b) the exact electronic location | `items`, one identifier a line (`@onyourleft/domain` §`moderation-item.ts`), and `location` in words | one of the two |
 * | (c) name and email | `name`, `email` | **never** for a notice of illegal content — recital 50 *"allow, but not require"*, and never for the CSAM offences |
 * | (d) the bona fide statement | `bona_fide` | no: Art. 16(2) makes the mechanism able to carry it, not a condition of acting |
 *
 * ## The intimate image content report — OSA s.20A
 *
 * A separate choice (`kind=intimate_image`) carrying s.20A(2)'s declarations:
 * (a) the content is intimate image content, (b) the report is made by the
 * person in it or on their behalf, (c) it is made in good faith and is true
 * — three ticks — (d) enough to identify the content, the items or the
 * location, and (e) contact details: the email. ⚠️ **All five are required
 * for this kind**, because they are what s.20A(2) says such a report IS; a
 * notifier who will not give them can still send a notice of illegal content.
 *
 * ## What is never kept or logged
 *
 * No client address is stored: the per-address limit is in memory
 * (`auth/identity.ts`), and the cap across the instance is counted from the
 * notices' own times. Nothing a notifier types reaches the log: the handler
 * logs a route's PATTERN, its status and its time (`log.ts` §`redacted`),
 * and `notices.test.ts` sends a notice and reads the log back for every
 * field's value.
 */

import { parseModerationItem } from '@onyourleft/domain';
import { escapeHtml, htmlPage } from '../html.ts';
import type { NewNotice } from '../store/sql-store.ts';

/** The longest explanation a notice may give, in characters. */
export const MAXIMUM_EXPLANATION_LENGTH = 5000;
/** The longest location in words, in characters. */
export const MAXIMUM_LOCATION_LENGTH = 1000;
/** The most items one notice may name (recital 50: one notice, several items). */
export const MAXIMUM_NOTICE_ITEMS = 20;
/** The longest name a notifier may give, in characters. */
export const MAXIMUM_NOTIFIER_NAME_LENGTH = 200;
/** The longest email address, in characters (RFC 5321's path limit). */
export const MAXIMUM_EMAIL_LENGTH = 254;

/** The page's path, which the app links to (#907) and the legal page names (#908). */
export const NOTICE_PAGE_PATH = '/report';

/** The form's fields, by name. */
export type NoticeField =
  | 'kind'
  | 'explanation'
  | 'items'
  | 'location'
  | 'name'
  | 'email'
  | 'bona_fide'
  | 'declare_intimate'
  | 'declare_subject'
  | 'declare_true';

/** What a notifier typed, as the page echoes it back when it asks for a correction. */
export type NoticeValues = Readonly<Partial<Record<NoticeField, string>>>;

/** One problem with one field, in words the notifier reads. */
export interface NoticeProblem {
  readonly field: NoticeField;
  readonly text: string;
}

export type NoticeForm =
  | { readonly ok: true; readonly notice: Omit<NewNotice, 'receivedAt'> }
  | {
      readonly ok: false;
      readonly problems: readonly NoticeProblem[];
      readonly values: NoticeValues;
    };

/** Control characters other than a line break or a tab, which no field may carry. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/;
/**
 * An address in the plain grammar: no `?`, `&`, `%`, quote or angle bracket, so
 * it can never carry `mailto:` parameters (`?bcc=`, `&body=`) into the link a
 * moderator clicks to reply.
 */
const EMAIL = /^[A-Za-z0-9.!#$*+/=^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const length = (text: string): number => [...text].length;

/**
 * The form as a notice, or every problem with it — each named by its field,
 * never by what was typed (a problem's text is shown on the page beside the
 * field, which already shows the value).
 */
export function readNoticeForm(form: URLSearchParams): NoticeForm {
  const value = (field: NoticeField): string => (form.get(field) ?? '').trim();
  const ticked = (field: NoticeField): boolean => form.get(field) !== null;
  const values: Partial<Record<NoticeField, string>> = {};
  for (const field of [
    'kind',
    'explanation',
    'items',
    'location',
    'name',
    'email',
  ] as const satisfies readonly NoticeField[]) {
    values[field] = value(field);
  }
  for (const field of [
    'bona_fide',
    'declare_intimate',
    'declare_subject',
    'declare_true',
  ] as const satisfies readonly NoticeField[]) {
    if (ticked(field)) values[field] = 'on';
  }
  const problems: NoticeProblem[] = [];
  const problem = (field: NoticeField, text: string): void => {
    problems.push({ field, text });
  };

  const kindText = value('kind');
  const kind =
    kindText === 'illegal_content' || kindText === 'intimate_image' ? kindText : undefined;
  if (kind === undefined) problem('kind', 'Choose what you are reporting.');

  const explanation = value('explanation');
  if (explanation === '') {
    problem('explanation', 'Say why you think it is illegal.');
  } else if (length(explanation) > MAXIMUM_EXPLANATION_LENGTH) {
    problem(
      'explanation',
      `Shorten this to ${String(MAXIMUM_EXPLANATION_LENGTH)} characters or fewer.`,
    );
  } else if (CONTROL.test(explanation)) {
    problem('explanation', 'This contains a character the form cannot take. Retype it.');
  }

  const lines = value('items')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const items = [...new Set(lines)];
  if (items.length > MAXIMUM_NOTICE_ITEMS) {
    problem('items', `Name ${String(MAXIMUM_NOTICE_ITEMS)} items or fewer in one report.`);
  } else if (items.some((line) => parseModerationItem(line) === undefined)) {
    problem(
      'items',
      'One or more lines is not an identifier from the app. Put one identifier on each line, or describe where it is below instead.',
    );
  }

  const location = value('location');
  if (length(location) > MAXIMUM_LOCATION_LENGTH) {
    problem('location', `Shorten this to ${String(MAXIMUM_LOCATION_LENGTH)} characters or fewer.`);
  } else if (CONTROL.test(location)) {
    problem('location', 'This contains a character the form cannot take. Retype it.');
  }
  if (items.length === 0 && location === '') {
    problem('items', 'Say where the content is: paste an identifier from the app, or describe it.');
  }

  const name = value('name');
  if (length(name) > MAXIMUM_NOTIFIER_NAME_LENGTH || CONTROL.test(name)) {
    problem(
      'name',
      `Give a name of ${String(MAXIMUM_NOTIFIER_NAME_LENGTH)} characters or fewer, or leave it empty.`,
    );
  }

  const email = value('email');
  if (email !== '' && (length(email) > MAXIMUM_EMAIL_LENGTH || !EMAIL.test(email))) {
    problem('email', 'Give an email address like name@example.com, or leave it empty.');
  }

  if (kind === 'intimate_image') {
    if (!ticked('declare_intimate')) {
      problem('declare_intimate', 'An intimate image report needs this statement.');
    }
    if (!ticked('declare_subject')) {
      problem('declare_subject', 'An intimate image report needs this statement.');
    }
    if (!ticked('declare_true')) {
      problem('declare_true', 'An intimate image report needs this statement.');
    }
    if (email === '') {
      problem('email', 'An intimate image report needs an email address, so we can reply.');
    }
  }

  if (problems.length > 0 || kind === undefined) return { ok: false, problems, values };
  return {
    ok: true,
    notice: {
      kind,
      explanation,
      items,
      location: location === '' ? null : location,
      notifierName: name === '' ? null : name,
      notifierEmail: email === '' ? null : email,
      bonaFide: ticked('bona_fide'),
    },
  };
}

/** What the page shows. */
export type NoticePage =
  | {
      readonly kind: 'form';
      readonly values?: NoticeValues;
      readonly problems?: readonly NoticeProblem[];
    }
  | {
      readonly kind: 'received';
      readonly reference: number;
      /** Unix seconds. */
      readonly receivedAt: number;
      readonly emailGiven: boolean;
    }
  | { readonly kind: 'too-many' };

/** A field's id on the page. */
const idOf = (field: NoticeField): string => `notice-${field.replaceAll('_', '-')}`;

/** Where a problem's link in the summary goes: the field, or for the kind its first choice. */
const anchorOf = (field: NoticeField): string =>
  field === 'kind' ? 'notice-kind-illegal' : idOf(field);

/** When, in words a person reads anywhere: UTC, to the minute. */
function utcText(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' at ')} UTC`;
}

/** The page's heading, which is also its title. */
export const NOTICE_PAGE_HEADING = 'Report content you think is illegal';

/** The page, for an instance called `instanceName` (or unnamed). */
export function noticePage(page: NoticePage, instanceName: string | null): string {
  const on = instanceName === null ? 'this instance' : `the instance ${instanceName}`;
  const title = `${NOTICE_PAGE_HEADING} — ${instanceName ?? 'On Your Left instance'}`;
  if (page.kind === 'received') {
    return htmlPage(
      title,
      `<h1>Report received</h1>
<p role="status">We received your report on ${escapeHtml(utcText(page.receivedAt))}. Its reference is <strong>${String(page.reference)}</strong>. Keep it if you want to ask about the report.</p>
<p>${
        page.emailGiven
          ? 'The person who runs this instance will write to the email address you gave to confirm they received it, and again to tell you what they decided and what you can do if you disagree.'
          : 'You did not give an email address, so we cannot tell you what we decide. The report is read all the same.'
      }</p>
<p>A person reads every report. No automated means are used to decide.</p>
<p><a href="${NOTICE_PAGE_PATH}">Send another report</a></p>`,
    );
  }
  if (page.kind === 'too-many') {
    return htmlPage(
      title,
      `<h1>${escapeHtml(NOTICE_PAGE_HEADING)}</h1>
<p role="alert">This instance has received too many reports in the last hour, from your connection or from everybody. Nothing you typed was kept. Wait an hour and send it again.</p>
<p><a href="${NOTICE_PAGE_PATH}">Back to the form</a></p>`,
    );
  }
  const values = page.values ?? {};
  const problems = page.problems ?? [];
  const problemOf = (field: NoticeField): string | undefined =>
    problems.find((each) => each.field === field)?.text;
  /** The attributes a field carries: invalid when it has a problem, described by its hint and problem. */
  const described = (field: NoticeField, hint: boolean | string): string => {
    const ids = [
      hint === true ? `${idOf(field)}-hint` : hint === false ? '' : hint,
      problemOf(field) === undefined ? '' : `${idOf(field)}-problem`,
    ]
      .filter((id) => id !== '')
      .join(' ');
    return `${ids === '' ? '' : ` aria-describedby="${ids}"`}${problemOf(field) === undefined ? '' : ' aria-invalid="true"'}`;
  };
  const problemLine = (field: NoticeField): string => {
    const text = problemOf(field);
    return text === undefined
      ? ''
      : `<p class="problem" id="${idOf(field)}-problem">${escapeHtml(text)}</p>`;
  };
  const text = (field: NoticeField): string => escapeHtml(values[field] ?? '');
  const checked = (field: NoticeField): string => (values[field] === 'on' ? ' checked' : '');
  const kind = values.kind ?? 'illegal_content';
  const box = (field: NoticeField, label: string): string =>
    `<div class="choice"><input type="checkbox" id="${idOf(field)}" name="${field}"${checked(field)}${described(field, false)}><label for="${idOf(field)}">${escapeHtml(label)}</label>${problemLine(field)}</div>`;

  const summary =
    problems.length === 0
      ? ''
      : `<div class="summary" role="alert" aria-labelledby="notice-summary-heading">
<h2 id="notice-summary-heading">The report was not sent. Correct ${problems.length === 1 ? 'this' : 'these'} and send it again:</h2>
<ul>${problems.map((each) => `<li><a href="#${anchorOf(each.field)}">${escapeHtml(each.text)}</a></li>`).join('')}</ul>
</div>`;

  return htmlPage(
    title,
    `<h1>${escapeHtml(NOTICE_PAGE_HEADING)}</h1>
<p>Anybody can use this page to tell the person who runs ${escapeHtml(on)} about content on it that they think is illegal. You do not need an account.</p>
${summary}
<form method="post" action="${NOTICE_PAGE_PATH}">
<fieldset${problemOf('kind') === undefined ? '' : ` aria-describedby="${idOf('kind')}-problem"`}>
<legend>What are you reporting?</legend>
<div class="choice"><input type="radio" id="notice-kind-illegal" name="kind" value="illegal_content"${kind === 'illegal_content' ? ' checked' : ''}><label for="notice-kind-illegal">Content I think is illegal</label></div>
<div class="choice"><input type="radio" id="notice-kind-intimate" name="kind" value="intimate_image"${kind === 'intimate_image' ? ' checked' : ''}><label for="notice-kind-intimate">An intimate image of me, or of someone I act for, shared without consent (an intimate image content report under section 20A of the UK Online Safety Act)</label></div>
${problemLine('kind')}
</fieldset>

<label for="${idOf('items')}">Which items</label>
<p class="hint" id="${idOf('items')}-hint">Paste the identifier the app shows beside each item, one on each line — for example a room, its route or a row of a race’s result. Up to ${String(MAXIMUM_NOTICE_ITEMS)}.</p>
${problemLine('items')}
<textarea id="${idOf('items')}" name="items" rows="3" spellcheck="false" autocapitalize="off"${described('items', true)}>${text('items')}</textarea>

<label for="${idOf('location')}">Where it is, in your own words (if you have no identifier)</label>
${problemLine('location')}
<textarea id="${idOf('location')}" name="location" rows="3" maxlength="${String(MAXIMUM_LOCATION_LENGTH)}"${described('location', false)}>${text('location')}</textarea>

<label for="${idOf('explanation')}">Why you think it is illegal</label>
<p class="hint" id="${idOf('explanation')}-hint">Explain what the content is and why you think it breaks the law. Do not copy the content itself here.</p>
${problemLine('explanation')}
<textarea id="${idOf('explanation')}" name="explanation" rows="6" maxlength="${String(MAXIMUM_EXPLANATION_LENGTH)}"${described('explanation', true)}>${text('explanation')}</textarea>

<fieldset>
<legend>Who you are (you do not have to say)</legend>
<p class="hint" id="notice-who-hint">If you give an email address, we will tell you we received the report and what we decide. You never need to give your name or email to report child sexual abuse material.</p>
<label for="${idOf('name')}">Your name</label>
${problemLine('name')}
<input type="text" id="${idOf('name')}" name="name" autocomplete="name" maxlength="${String(MAXIMUM_NOTIFIER_NAME_LENGTH)}" value="${text('name')}"${described('name', 'notice-who-hint')}>
<label for="${idOf('email')}">Your email address</label>
${problemLine('email')}
<input type="email" id="${idOf('email')}" name="email" autocomplete="email" maxlength="${String(MAXIMUM_EMAIL_LENGTH)}" value="${text('email')}"${described('email', 'notice-who-hint')}>
</fieldset>

<fieldset>
<legend>Your statement</legend>
${box('bona_fide', 'I believe in good faith that what I have written in this report is accurate and complete.')}
</fieldset>

<fieldset aria-describedby="notice-intimate-hint">
<legend>Only for an intimate image report</legend>
<p class="hint" id="notice-intimate-hint">An intimate image report needs all three statements and an email address.</p>
${box('declare_intimate', 'The content is an intimate image.')}
${box('declare_subject', 'I am the person shown in it, or I am making this report on their behalf.')}
${box('declare_true', 'I am making this report in good faith, and what it says is true.')}
</fieldset>

<button type="submit">Send the report</button>
</form>
<p>A person reads every report. No automated means are used to decide. What you type here is kept with the report and shown only to the person who moderates this instance.</p>`,
  );
}
