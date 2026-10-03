// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One short line per section, as something a test can count — #1013.
 *
 * The owner's ruling of 2026-10-02 (#993) gave every SCREEN one line under its
 * title and put the rest behind an ⓘ. #1013 is the same ruling one level down:
 * a section of a screen — everything from one `h2`, `h3` or `h4` to the next —
 * keeps **at most one short line** of explanation where a rider reads it, and
 * the rest is one press away, behind the section's ⓘ
 * (`design/SectionHelp.tsx`) — since #1031 the one place; the "More about"
 * disclosure that was the other (`design/MoreAbout.tsx`) is gone.
 *
 * ## What counts as an explanation
 *
 * A paragraph (`p`, or a `div` with prose of its own) that is drawn — not in
 * a closed `<details>`, not `hidden` — and is NOT one of the things the
 * ruling keeps on the screen whatever their length, each recognised by what it is rather than by its words:
 *
 * - **kept-visible text** (`[data-oyl-kept-visible]`): safety, privacy and
 *   consent, which `kept-visible.a11y.test.tsx` holds out of any disclosure;
 * - **a status message** (`.oyl-status`, `[role=status]`, `[role=alert]`): it
 *   says what HAS happened, and #605's ruling is that it is never tucked;
 * - **an empty state** (`[data-oyl-empty-state]`), which is the section's
 *   content while there is nothing else, with its one action, and a table's
 *   own empty body (`.oyl-table-empty`, `design/ChartSlot.tsx`);
 * - **a route's notes** (`.oyl-note`, #993);
 * - text that belongs to a control or a datum: a label, a legend, a list item,
 *   a table cell, a definition, a button or a summary — and a paragraph that
 *   only lays out a control (it says nothing outside its links, buttons and
 *   labels, and the separators between them), or that something is
 *   `aria-labelledby` (a list's caption);
 * - a field's hint: a paragraph a form field is `aria-describedby` (#1023).
 *   It is the field's instruction, one line under it — WCAG 2.2 SC 3.3.2 wants
 *   it there rather than behind a disclosure — and it belongs to the field as
 *   its label does. Only a FIELD's description counts: a paragraph a button or
 *   a region is described by is still prose;
 * - a paragraph that does not end as a sentence does — a caption or a reading
 *   like "0:00 elapsed · 0:00 moving" — unless the last thing in it is a link
 *   ("…on the <a>trainer game screen</a>"), which is a sentence whose last
 *   words are pressable, and counts (#1023).
 *
 * ## Where explanation can be, and where it is not looked for
 *
 * #1023 widened the walk to the two places #1022's review found it blind:
 *
 * - **a `div` with prose of its own** — text written straight into it, not
 *   inside a child, that ends as a sentence does — is read as a paragraph is.
 *   A `div` whose text is all in its children is a wrapper, and the children
 *   are read on their own;
 * - **a paragraph ending in a link**, above.
 *
 * And it deliberately does not look in a **list item** (`li`): a list on these
 * screens is a set of facts or limits read item by item — the four Web
 * Bluetooth constraints, a route's steps — and #1013's ruling is about a
 * section's running prose, not about how many items a list has. Prose in a
 * `span`, a `section` or any other element directly is not read either: none
 * of the views writes any, and the ruling's unit is a drawn paragraph.
 *
 * Everything else under a heading is explanation, and the rule is that a
 * section has at most one such paragraph, of at most
 * {@link SECTION_LINE_CHARACTERS} characters.
 *
 * ## Why characters, here
 *
 * jsdom lays nothing out, so this cannot count lines; the browser gate counts
 * the line under a screen's title in line boxes (`controls-first.browser.spec`).
 * {@link SECTION_LINE_CHARACTERS} is about one line of the body face across a
 * Settings card on the tablet, and two on a 390 px phone — the same allowance
 * #993 gave the screen's own line.
 *
 * ## What it cannot judge
 *
 * Whether a short line is the RIGHT line, and whether what went behind the ⓘ
 * still reads. Those are review questions. And a paragraph that is a reading
 * of the rider's own data (a route's distance, a segment's efforts) looks like
 * prose to it: those are listed by name, with a reason, where the walk meets
 * them — `section-lines.a11y.test.tsx` §`READINGS`.
 */

/** The most characters the one line a section keeps may have. */
export const SECTION_LINE_CHARACTERS = 110;

/** The headings that open a section. An `h1` is the screen's, and #993's. */
const SECTION_HEADINGS = new Set(['H2', 'H3', 'H4']);

/**
 * What a paragraph may sit inside and not count as explanation. The order is
 * the one in this file's header.
 */
export const NOT_EXPLANATION = [
  '[data-oyl-kept-visible]',
  '.oyl-status',
  '[role="status"]',
  '[role="alert"]',
  '[data-oyl-empty-state]',
  '.oyl-table-empty',
  '.oyl-note',
  'label',
  'legend',
  'li',
  'td',
  'th',
  'dt',
  'dd',
  'button',
  'summary',
].join(', ');

/** One section's drawn explanation. */
export interface SectionProse {
  /** The heading's text. */
  readonly heading: string;
  /** Every drawn explanatory paragraph under it, normalised, in order. */
  readonly paragraphs: readonly string[];
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** What a paragraph may hold and still be a control's rather than prose. */
const CONTROLS = 'a, button, label, input, select, textarea, output, summary';

/**
 * Whether a paragraph reads as prose: it holds no form control, it says
 * something outside the links, buttons and labels it holds (a paragraph that is
 * only a link is a control laid out in a paragraph), and it ends as a sentence
 * does. A caption like "Rides on this device, newest first" and a reading like
 * "0:00 elapsed · 0:00 moving" end without one.
 */
function isProse(paragraph: Element): boolean {
  if (paragraph.querySelector('input, select, textarea') !== null) return false;
  // A paragraph another element is labelled by is that element's caption — a
  // list's "newest first", say — and belongs to the data it names.
  if (paragraph.id !== '' && labelsSomething(paragraph)) return false;
  // A paragraph a form field is described by is that field's hint — its
  // instruction, under it (WCAG 2.2 SC 3.3.2, #1023) — and belongs to the
  // field, as its label does.
  if (paragraph.id !== '' && describesAField(paragraph)) return false;
  const copy = paragraph.cloneNode(true) as Element;
  for (const control of copy.querySelectorAll(CONTROLS)) control.remove();
  // Separators between links ("Your rides · Import or export files") are not
  // words: a paragraph is prose only if a word of its own is left.
  if (!/\p{L}/u.test(copy.textContent ?? '')) return false;
  return /[.!?…:]$/u.test(normalise(paragraph.textContent ?? '')) || endsInLink(paragraph);
}

/**
 * Whether the last thing drawn in `paragraph` is a link — #1023. "Read how
 * it works on the <a>About screen</a>" ends in a word, not a full stop, and
 * was not counted; a paragraph that says something of its own and ends in a
 * link is a sentence whose last words are pressable.
 */
function endsInLink(paragraph: Element): boolean {
  let last: Node | null = paragraph.lastChild;
  while (last !== null && last.nodeType === 3 && normalise(last.textContent ?? '') === '') {
    last = last.previousSibling;
  }
  return last !== null && last.nodeType === 1 && (last as Element).tagName === 'A';
}

/**
 * The text a `div` holds of its own — its direct text nodes — #1023. Prose
 * written straight into a `div` is drawn exactly as a paragraph is, and
 * counted as one; a `div` whose text is all inside its children is a wrapper,
 * and its children are read on their own.
 */
function ownText(element: Element): string {
  return normalise(
    [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? '')
      .join(' '),
  );
}

/** Whether anything in the document is labelled by `element`'s id. */
function labelsSomething(element: Element): boolean {
  return [...element.ownerDocument.querySelectorAll('[aria-labelledby]')].some((labelled) =>
    (labelled.getAttribute('aria-labelledby') ?? '').split(/\s+/).includes(element.id),
  );
}

/** Whether a form field in the document is `aria-describedby` `element`. */
function describesAField(element: Element): boolean {
  return [
    ...element.ownerDocument.querySelectorAll(
      'input[aria-describedby], select[aria-describedby], textarea[aria-describedby]',
    ),
  ].some((field) =>
    (field.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(element.id),
  );
}

/** Whether `element` is drawn: no closed `<details>` and no `hidden` above it. */
export function drawn(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (at.hasAttribute('hidden')) return false;
    const parent = at.parentElement;
    // A closed disclosure draws its own summary and nothing else.
    if (parent?.tagName === 'DETAILS' && !parent.hasAttribute('open') && at.tagName !== 'SUMMARY') {
      return false;
    }
  }
  return true;
}

/**
 * Every section under `root` that is drawn, with its drawn explanation. A
 * section is a heading and everything after it in document order up to the
 * next heading of any level from `h2` to `h4`; text before the first is the
 * screen's own line and is not a section's.
 */
export function sectionProse(root: Element): SectionProse[] {
  const sections: { heading: string; paragraphs: string[] }[] = [];
  let current: { heading: string; paragraphs: string[] } | undefined;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node as Element;
    if (SECTION_HEADINGS.has(element.tagName)) {
      if (!drawn(element)) continue;
      current = { heading: normalise(element.textContent ?? ''), paragraphs: [] };
      sections.push(current);
      continue;
    }
    if (current === undefined) continue;
    const prose =
      element.tagName === 'P' || (element.tagName === 'DIV' && /[.!?…:]$/u.test(ownText(element)));
    if (!prose) continue;
    if (!drawn(element) || element.closest(NOT_EXPLANATION) !== null) continue;
    if (!isProse(element)) continue;
    current.paragraphs.push(normalise(element.textContent ?? ''));
  }
  return sections;
}

/** What breaks the rule in one section, or nothing. */
export function sectionLineFaults(section: SectionProse): string[] {
  const faults: string[] = [];
  if (section.paragraphs.length > 1) {
    faults.push(
      `“${section.heading}” keeps ${String(section.paragraphs.length)} paragraphs of explanation ` +
        `on the screen, where the ruling is one line: ` +
        section.paragraphs.map((text) => `“${text.slice(0, 70)}”`).join(', '),
    );
  }
  for (const text of section.paragraphs) {
    if (text.length > SECTION_LINE_CHARACTERS) {
      faults.push(
        `“${section.heading}” keeps a line of ${String(text.length)} characters, more than ` +
          `${String(SECTION_LINE_CHARACTERS)}: “${text.slice(0, 90)}…”`,
      );
    }
  }
  return faults;
}
