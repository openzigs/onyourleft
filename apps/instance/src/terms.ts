// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The terms of service an instance publishes** (#909): `GET /terms`, from a
 * file the OPERATOR names, with the date the version in force took effect.
 *
 * ## The operator's own, or none
 *
 * The project's terms (`docs/moderation/terms-of-service.md`, a draft pending
 * the owner's approval) are a starting point and never a default: an
 * instance publishes no terms until its operator sets both
 *
 * - **`OYL_INSTANCE_TERMS_FILE`** — the file the terms are in, read once at
 *   start-up (`serve.ts`). Where it holds a line that is `<!-- terms -->` alone, only
 *   what follows it is published, so the project's draft, with its notes for
 *   the owner above that line, can be published as it stands once approved.
 * - **`OYL_INSTANCE_TERMS_VERSION`** — the date that version took effect,
 *   `YYYY-MM-DD`. ⚠️ **Changing it is how riders are told** (DSA Art.
 *   14(2)): `GET /instance` names it, and the app says so on the Instance
 *   screen until the rider has read the new terms. A correction that changes
 *   nothing that matters keeps the date.
 *
 * One without the other, a file that cannot be read, or a file too large or
 * holding a control character, is a refusal to start: terms an operator
 * believes they published, and did not, are worse than none.
 *
 * ## What is rendered
 *
 * Plain words, so a page needs no script and no third party: `#`, `##` and
 * `###` headings, paragraphs, `-` and `1.` lists, `**bold**` and `` `code` ``.
 * Everything else is text. Every character goes through `html.ts`
 * §`escapeHtml` before any of that is recognised.
 */

import { escapeHtml, htmlPage } from './html.ts';

/** The terms an instance publishes. */
export interface TermsSettings {
  /** The terms, as Markdown of the subset above. */
  readonly text: string;
  /** The date the version in force took effect, `YYYY-MM-DD`. */
  readonly version: string;
}

export interface RawTermsSettings {
  /** The file's contents, as `serve.ts` read them. */
  readonly termsText?: string | undefined;
  /** `OYL_INSTANCE_TERMS_VERSION`. */
  readonly termsVersion?: string | undefined;
  /** `OYL_INSTANCE_TERMS_FILE` was set, and could not be read. */
  readonly termsFileUnreadable?: boolean | undefined;
}

/** The terms page's path, which the app's About and the legal page link to. */
export const TERMS_PAGE_PATH = '/terms';

/** What marks the start of the published part of a terms file. */
export const TERMS_MARKER = '<!-- terms -->';

/** The longest terms an instance publishes, in characters. */
export const MAXIMUM_TERMS_LENGTH = 200_000;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const VERSION = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== '';

/** Read the settings; every problem is pushed onto `problems`, as `readConfig` collects them. */
export function readTermsSettings(raw: RawTermsSettings, problems: string[]): TermsSettings | null {
  if (raw.termsFileUnreadable === true) {
    problems.push('OYL_INSTANCE_TERMS_FILE is set, and the file could not be read.');
    return null;
  }
  const hasText = present(raw.termsText);
  const hasVersion = present(raw.termsVersion);
  if (!hasText && !hasVersion) return null;
  if (!hasText || !hasVersion) {
    problems.push(
      'Set OYL_INSTANCE_TERMS_FILE and OYL_INSTANCE_TERMS_VERSION together: the terms, and the date they took effect.',
    );
    return null;
  }
  const version = raw.termsVersion.trim();
  if (!VERSION.test(version)) {
    problems.push('OYL_INSTANCE_TERMS_VERSION must be a date, written YYYY-MM-DD.');
    return null;
  }
  // The marker is a line of its own: one quoted inside the notes above it
  // (as the project's draft quotes it) is not it.
  const marked = /^<!-- terms -->[ \t]*$/m.exec(raw.termsText);
  const text = (
    marked === null ? raw.termsText : raw.termsText.slice(marked.index + marked[0].length)
  ).trim();
  if (text === '' || [...text].length > MAXIMUM_TERMS_LENGTH || CONTROL.test(text)) {
    problems.push(
      `OYL_INSTANCE_TERMS_FILE must hold terms of at most ${String(MAXIMUM_TERMS_LENGTH)} characters, with no control character.`,
    );
    return null;
  }
  return { text, version };
}

/** `**bold**` and `` `code` `` in text that is already escaped. */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** The terms, as the markup of a page body. Every character is escaped first. */
export function renderTerms(text: string): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | undefined;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) out.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== undefined) {
      out.push(
        `<${list.kind}>${list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join('')}</${list.kind}>`,
      );
    }
    list = undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    const bullet = /^- (.+)$/.exec(line);
    const numbered = /^\d{1,3}\. (.+)$/.exec(line);
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      const level = String((heading[1] as string).length);
      out.push(`<h${level}>${inline(escapeHtml(heading[2] as string))}</h${level}>`);
    } else if (bullet !== null || numbered !== null) {
      flushParagraph();
      const kind = bullet !== null ? 'ul' : 'ol';
      if (list?.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((bullet ?? numbered)?.[1] as string);
    } else if (list !== undefined && /^\s+\S/.test(line)) {
      // A list item's next line, indented under it.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ''} ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return out.join('\n');
}

/** The terms page's heading when the terms give none. */
export const TERMS_PAGE_HEADING = 'Terms of service';

/** The terms page, for an instance called `instanceName`. */
export function termsPage(terms: TermsSettings | null, instanceName: string | null): string {
  const title = `${TERMS_PAGE_HEADING} — ${instanceName ?? 'On Your Left instance'}`;
  if (terms === null) {
    return htmlPage(
      title,
      `<h1>${escapeHtml(TERMS_PAGE_HEADING)}</h1>
<p>This instance has published no terms of service. The legal page (<a href="/legal">/legal</a>) says how to contact the person who runs it.</p>`,
    );
  }
  const body = renderTerms(terms.text);
  const heading = body.startsWith('<h1>') ? '' : `<h1>${escapeHtml(TERMS_PAGE_HEADING)}</h1>\n`;
  const [first, ...rest] = body.split('\n');
  const since = `<p><strong>In force since ${escapeHtml(terms.version)}.</strong></p>`;
  return htmlPage(
    title,
    heading === '' ? [first, since, ...rest].join('\n') : `${heading}${since}\n${body}`,
  );
}
