// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The automated accessibility checks, and the tab-order model they rest on.
 *
 * #48's third and fourth acceptance criteria: every interactive control is
 * reachable and operable by keyboard alone, and automated checks run **on every
 * route** in CI and fail the build on a violation. `routes.a11y.test.tsx` is
 * what runs this against each route; this file is the rule set.
 *
 * ## Why the rules are written here rather than delegated to a checker
 *
 * Three reasons, in the order they decided it:
 *
 * 1. **The obvious library is MPL-2.0.** CLAUDE.md §3 records that MPL-2.0 is
 *    *not ruled on yet* in this repository and is
 *    [#24](https://github.com/openzigs/onyourleft/issues/24)'s to decide.
 *    Writing a gate against an API whose licence has not been ruled on means
 *    either pre-empting that decision or unwinding the gate afterwards.
 * 2. **Its highest-value rule does not run under a headless DOM anyway.**
 *    Colour contrast needs layout and resolved custom properties, and jsdom
 *    supplies neither, so that rule is inert wherever it is installed here.
 *    Criterion 6 is met at the tokens instead — see `design/contrast.ts`.
 * 3. **A rule set nobody can see is a rule set nobody maintains.** Every rule
 *    below has a unit test in `audit.a11y.test.ts` that feeds it a violating
 *    fixture and requires it to fire. A checker that silently stopped matching
 *    would be indistinguishable from a clean tree; these cannot be.
 *
 * This is a **narrower** check than a full WCAG audit and says so. It catches
 * the structural, machine-decidable failures — an unnamed control, a control
 * that cannot be reached by keyboard, a broken heading order, a dangling ARIA
 * reference. It does not and cannot judge whether a name is *good*. Manual
 * review still has a job.
 *
 * ## What jsdom cannot tell us, stated rather than assumed
 *
 * jsdom performs no layout and this suite loads no stylesheet, so an element
 * hidden by a CSS rule is invisible to {@link tabbableElements}. The shell
 * therefore hides nothing with CSS alone: the skip link is moved off-screen
 * with a transform and stays focusable, and everything genuinely hidden uses
 * the `hidden` attribute or is simply not rendered. That is a constraint on the
 * markup, and it is the constraint that keeps this check honest.
 */

/** One failure, named by rule so a fix can be routed without reading the DOM. */
export interface AccessibilityViolation {
  /** The rule id, stable enough to grep for in a CI log. */
  readonly rule: string;
  /** What is wrong and why it matters, in the terms a fixer needs. */
  readonly message: string;
  /** A truncated `outerHTML`, so the log names the element and not just the rule. */
  readonly html: string;
}

/**
 * Elements that are interactive by their tag alone, and are focusable without
 * a `tabindex`.
 */
const NATIVELY_INTERACTIVE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);

/**
 * ARIA roles that promise a control.
 *
 * A `div` carrying one of these is claiming to be operable, and the promise is
 * only kept if it is also focusable and named — which is what
 * `interactive-role-is-focusable` and `control-has-accessible-name` check. This
 * is the shape of the "pairing button that does nothing" failure #48 exists to
 * prevent, one layer down.
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'option',
  'slider',
  'spinbutton',
  'textbox',
  'combobox',
]);

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]',
  '[tabindex]',
].join(',');

function snippet(element: Element): string {
  const html = element.outerHTML;
  return html.length > 160 ? `${html.slice(0, 157)}…` : html;
}

function isDisabled(element: Element): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

/** Whether this element, or anything above it, is hidden from assistive technology. */
export function isHiddenFromAssistiveTechnology(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {
      return true;
    }
    if (node.getAttribute('style')?.replaceAll(' ', '').includes('display:none') === true) {
      return true;
    }
  }
  return false;
}

/**
 * The keyboard tab order of a document, in order.
 *
 * Only `tabindex="0"` and the natively focusable elements appear. A positive
 * `tabindex` would reorder the sequence, so rather than model that here it is
 * simply banned by `no-positive-tabindex` — WCAG's own advice, and the reason
 * this function can return document order and be right.
 */
export function tabbableElements(root: Document | Element): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  return candidates.filter((element) => {
    if (isDisabled(element) || isHiddenFromAssistiveTechnology(element)) {
      return false;
    }
    if (element.tagName === 'INPUT' && element.getAttribute('type') === 'hidden') {
      return false;
    }
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) {
      return false;
    }
    return true;
  });
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * A deliberately partial accessible-name computation.
 *
 * It implements the first branches of the ARIA name algorithm —
 * `aria-labelledby`, `aria-label`, a `<label>` for a form control, the element's
 * own text, `alt`, `title` — and nothing beyond. That is enough to answer the
 * only question the rules ask, which is whether a name exists at all.
 *
 * Text inside an `aria-hidden` descendant is excluded, because a screen reader
 * excludes it too: a button whose entire visible label is a decorative glyph
 * marked `aria-hidden` is an unnamed button, and reading `textContent` would
 * have called it named.
 */
export function accessibleName(element: Element): string {
  const doc = element.ownerDocument;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const parts = labelledBy
      .split(/\s+/)
      .filter((id) => id !== '')
      .map((id) => textOf(doc.getElementById(id) ?? doc.createElement('span')));
    const joined = parts.join(' ').trim();
    if (joined !== '') {
      return joined;
    }
  }

  const label = element.getAttribute('aria-label')?.trim();
  if (label !== undefined && label !== '') {
    return label;
  }

  if (element.tagName === 'IMG' || element.tagName === 'AREA') {
    return (element.getAttribute('alt') ?? '').trim();
  }

  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
    const id = element.getAttribute('id');
    const forLabel = id === null ? null : doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel !== null) {
      return textOf(forLabel);
    }
    const wrapping = element.closest('label');
    if (wrapping !== null) {
      return textOf(wrapping);
    }
    const value = element.getAttribute('value')?.trim();
    if (
      element.tagName === 'INPUT' &&
      ['submit', 'reset'].includes(element.getAttribute('type') ?? '') &&
      value !== undefined &&
      value !== ''
    ) {
      return value;
    }
  }

  const visible = visibleTextOf(element);
  if (visible !== '') {
    return visible;
  }

  return (element.getAttribute('title') ?? '').trim();
}

/** `textContent`, minus every subtree a screen reader would skip. */
function visibleTextOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) {
    hidden.remove();
  }
  return textOf(clone);
}

function roleOf(element: Element): string | null {
  return element.getAttribute('role');
}

/**
 * The name of a landmark, which — unlike a button's — is never taken from its
 * contents.
 *
 * ARIA does not permit name-from-content for `navigation`, `complementary`,
 * `region` or `form`, and the distinction is load-bearing rather than pedantic:
 * {@link accessibleName} falls through to the element's text, so a second
 * unlabelled `<nav>` containing a link called "About" would be reported as
 * named "about" and the landmark rule would pass over the exact markup it
 * exists to catch. This was caught by the rule's own fixture, which is what
 * that fixture is for.
 */
function landmarkName(element: Element): string {
  const doc = element.ownerDocument;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    const joined = labelledBy
      .split(/\s+/)
      .filter((id) => id !== '')
      .map((id) => {
        const target = doc.getElementById(id);
        return target === null ? '' : textOf(target);
      })
      .join(' ')
      .trim();
    if (joined !== '') {
      return joined;
    }
  }
  return (element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '').trim();
}

/** Every element that claims to be a control, native or ARIA. */
function interactiveElements(root: Document | Element): Element[] {
  return [...root.querySelectorAll('*')].filter((element) => {
    if (NATIVELY_INTERACTIVE.has(element.tagName)) {
      return true;
    }
    if (element.tagName === 'A' && element.hasAttribute('href')) {
      return true;
    }
    const role = roleOf(element);
    return role !== null && INTERACTIVE_ROLES.has(role);
  });
}

type Rule = (doc: Document) => AccessibilityViolation[];

const htmlHasLang: Rule = (doc) => {
  const lang = doc.documentElement.getAttribute('lang')?.trim() ?? '';
  return lang === ''
    ? [
        {
          rule: 'html-has-lang',
          message:
            'The document has no `lang`, so a screen reader announces every word with the ' +
            "reader's default pronunciation rules rather than the page's language.",
          html: '<html>',
        },
      ]
    : [];
};

const pageHasOneMain: Rule = (doc) => {
  const mains = [...doc.querySelectorAll('main, [role="main"]')].filter(
    (element) => !isHiddenFromAssistiveTechnology(element),
  );
  if (mains.length === 1) {
    return [];
  }
  return [
    {
      rule: 'page-has-one-main',
      message:
        mains.length === 0
          ? 'No `main` landmark. "Skip to content" and every screen-reader landmark jump have ' +
            'nowhere to land.'
          : `${String(mains.length)} \`main\` landmarks. A landmark that appears twice cannot be jumped to.`,
      html: mains[0] === undefined ? '<body>' : snippet(mains[0]),
    },
  ];
};

const pageHasOneH1: Rule = (doc) => {
  const headings = [...doc.querySelectorAll('h1')].filter(
    (element) => !isHiddenFromAssistiveTechnology(element),
  );
  if (headings.length === 1) {
    return [];
  }
  return [
    {
      rule: 'page-has-one-h1',
      message:
        headings.length === 0
          ? 'No `h1`. The view has no title for a screen-reader user to orient by after navigation.'
          : `${String(headings.length)} \`h1\` elements. Which one names the view is then ambiguous.`,
      html: headings[0] === undefined ? '<body>' : snippet(headings[0]),
    },
  ];
};

const headingOrder: Rule = (doc) => {
  const violations: AccessibilityViolation[] = [];
  let previous = 0;
  for (const heading of doc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (isHiddenFromAssistiveTechnology(heading)) {
      continue;
    }
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    if (previous === 0) {
      // The FIRST heading is checked too, against an implied level 0, so a page
      // whose outline starts at `h3` fails. It used to be exempt, which meant a
      // document could open two levels down and this rule said nothing —
      // `page-has-one-h1` does not catch it either, because a page may carry
      // its one `h1` further down and still open at `h3`. A reader jumping by
      // heading hears a subsection with no section above it.
      if (level > 1) {
        violations.push({
          rule: 'heading-order',
          message:
            `The first heading is a level ${String(level)}. An outline starts at \`h1\`; ` +
            'opening below it reads to a screen-reader user as a section that is missing ' +
            'everything above it.',
          html: snippet(heading),
        });
      }
    } else if (level > previous + 1) {
      violations.push({
        rule: 'heading-order',
        message:
          `A level ${String(level)} heading follows a level ${String(previous)} one. ` +
          'A skipped level reads to a screen-reader user as a missing section.',
        html: snippet(heading),
      });
    }
    if (textOf(heading) === '' && accessibleName(heading) === '') {
      violations.push({
        rule: 'heading-order',
        message: 'An empty heading. It appears in the heading list with nothing to announce.',
        html: snippet(heading),
      });
    }
    previous = level;
  }
  return violations;
};

const controlHasAccessibleName: Rule = (doc) =>
  interactiveElements(doc)
    .filter((element) => !isHiddenFromAssistiveTechnology(element))
    .filter((element) => accessibleName(element) === '')
    .map((element) => ({
      rule: 'control-has-accessible-name',
      message:
        'A control with no accessible name. It is announced as its role alone — "button", ' +
        '"link" — which tells a screen-reader user nothing about what it does.',
      html: snippet(element),
    }));

const imageHasAlt: Rule = (doc) =>
  [...doc.querySelectorAll('img')]
    .filter((image) => !image.hasAttribute('alt'))
    .map((image) => ({
      rule: 'image-has-alt',
      message:
        'An `img` with no `alt`. A missing attribute is not the same as `alt=""`: the first ' +
        'makes a reader announce the file name, the second correctly says nothing.',
      html: snippet(image),
    }));

const linkHasHref: Rule = (doc) =>
  [...doc.querySelectorAll('a')]
    .filter((link) => !link.hasAttribute('href'))
    .filter((link) => !isHiddenFromAssistiveTechnology(link))
    .map((link) => ({
      rule: 'link-has-href',
      message:
        'An `a` with no `href`. It is not focusable and not activatable by keyboard, so it is ' +
        'a link only to a sighted mouse user.',
      html: snippet(link),
    }));

const noPositiveTabindex: Rule = (doc) =>
  [...doc.querySelectorAll('[tabindex]')]
    .filter((element) => Number.parseInt(element.getAttribute('tabindex') ?? '0', 10) > 0)
    .map((element) => ({
      rule: 'no-positive-tabindex',
      message:
        'A positive `tabindex` reorders the whole page against its reading order, and every ' +
        'later control has to be renumbered to stay consistent.',
      html: snippet(element),
    }));

const interactiveRoleIsFocusable: Rule = (doc) => {
  const tabbable = new Set<Element>(tabbableElements(doc));
  return interactiveElements(doc)
    .filter((element) => !isHiddenFromAssistiveTechnology(element))
    .filter((element) => !isDisabled(element))
    .filter((element) => !tabbable.has(element))
    .map((element) => ({
      rule: 'interactive-role-is-focusable',
      message:
        'A control that cannot be reached by keyboard. This is the exact shape of a pairing ' +
        'button that works for a mouse and silently does not exist for anyone else.',
      html: snippet(element),
    }));
};

const ariaHiddenNotFocusable: Rule = (doc) =>
  [...doc.querySelectorAll('[aria-hidden="true"]')]
    .flatMap((hidden) => [
      ...(hidden.matches(FOCUSABLE_SELECTOR) ? [hidden] : []),
      ...hidden.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ])
    .filter((element) => {
      const tabindex = element.getAttribute('tabindex');
      return (tabindex === null || Number.parseInt(tabindex, 10) >= 0) && !isDisabled(element);
    })
    .map((element) => ({
      rule: 'aria-hidden-not-focusable',
      message:
        'A focusable element inside an `aria-hidden` subtree. Keyboard focus lands on something ' +
        'a screen reader refuses to announce, which is the worst of both.',
      html: snippet(element),
    }));

/**
 * Elements whose implicit role **prohibits a name**.
 *
 * ARIA lists `generic`, `paragraph`, `caption`, `code`, `deletion`,
 * `emphasis`, `insertion`, `mark`, `presentation`, `strong`, `subscript`,
 * `superscript`, `term` and `time` as name-prohibited: `aria-label` and
 * `aria-labelledby` on one of them are *ignored*, and browsers and screen
 * readers differ about how completely. So the label is not a small
 * over-specification; it is text nobody may hear.
 *
 * The tags below are the ones that carry a name-prohibited role by default and
 * that this app actually renders. An explicit `role` takes over the mapping, so
 * an element that declares one is left to the other rules.
 */
const NAME_PROHIBITED_TAGS = new Set([
  'span',
  'div',
  'p',
  'code',
  'em',
  'strong',
  'small',
  'b',
  'i',
  'mark',
  'del',
  'ins',
  'sub',
  'sup',
  'time',
  'caption',
]);

/**
 * A name on an element that cannot carry one.
 *
 * Found in #49's review: the ride screen's metric value was a `<span>` with an
 * `aria-label` giving the number *and* what it meant — the whole of criterion
 * 3's "unavailable, not frozen" for anyone listening — on the one element type
 * that is entitled to drop it. Use visually hidden text, or give the element a
 * role that takes a name.
 */
const nameOnProhibitedRole: Rule = (doc) =>
  [...doc.querySelectorAll('[aria-label], [aria-labelledby]')]
    .filter((element) => !element.hasAttribute('role'))
    .filter((element) => NAME_PROHIBITED_TAGS.has(element.tagName.toLowerCase()))
    .filter((element) => !element.matches(FOCUSABLE_SELECTOR))
    .map((element) => ({
      rule: 'name-on-prohibited-role',
      message:
        `\`${element.tagName.toLowerCase()}\` has no role of its own, so it is \`generic\` — a ` +
        'role ARIA forbids a name on. The label is ignored, and whatever it was saying is said ' +
        'nowhere. Use visually hidden text instead.',
      html: snippet(element),
    }));

const ariaReferenceResolves: Rule = (doc) => {
  const violations: AccessibilityViolation[] = [];
  for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
    for (const element of doc.querySelectorAll(`[${attribute}]`)) {
      const ids = (element.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '');
      for (const id of ids) {
        if (doc.getElementById(id) === null) {
          violations.push({
            rule: 'aria-reference-resolves',
            message:
              `\`${attribute}\` points at "${id}", which is not in the document. The reference ` +
              'is silently ignored, so the element is left with whatever name it had by accident.',
            html: snippet(element),
          });
        }
      }
    }
  }
  return violations;
};

const uniqueIds: Rule = (doc) => {
  const seen = new Set<string>();
  const violations: AccessibilityViolation[] = [];
  for (const element of doc.querySelectorAll('[id]')) {
    const id = element.getAttribute('id') ?? '';
    if (seen.has(id)) {
      violations.push({
        rule: 'unique-id',
        message:
          `The id "${id}" appears more than once. Every ARIA reference and every \`label[for]\` ` +
          'resolves to the first one, so the second is unlabelled however it is marked up.',
        html: snippet(element),
      });
    }
    seen.add(id);
  }
  return violations;
};

const listStructure: Rule = (doc) =>
  [...doc.querySelectorAll('ul, ol')]
    .flatMap((list) => [...list.children])
    .filter((child) => !['LI', 'SCRIPT', 'TEMPLATE'].includes(child.tagName))
    .map((child) => ({
      rule: 'list-structure',
      message:
        'A non-`li` child of a list. A reader announces "list, N items" from the `li` count, so ' +
        'anything else is both uncounted and unreachable by list navigation.',
      html: snippet(child),
    }));

const landmarksAreDistinguishable: Rule = (doc) => {
  const violations: AccessibilityViolation[] = [];
  for (const tag of ['nav', 'aside', 'section', 'form']) {
    const landmarks = [...doc.querySelectorAll(tag)].filter(
      (element) => !isHiddenFromAssistiveTechnology(element),
    );
    if (landmarks.length < 2) {
      continue;
    }
    const names = landmarks.map((element) => landmarkName(element).toLowerCase());
    landmarks.forEach((element, index) => {
      const name = names[index] ?? '';
      if (name === '' || names.indexOf(name) !== index) {
        violations.push({
          rule: 'landmarks-are-distinguishable',
          message:
            `There is more than one \`${tag}\` and this one is ${name === '' ? 'unnamed' : `named "${name}" like another`}. ` +
            'A landmark list with two identical entries is a list you cannot navigate by.',
          html: snippet(element),
        });
      }
    });
  }
  return violations;
};

/**
 * Every rule, in the order a failure is most useful to read.
 *
 * Exported so `audit.a11y.test.ts` can assert that each one is exercised — a rule
 * added here without a test that proves it fires is caught by that assertion
 * rather than by nobody.
 */
export const ACCESSIBILITY_RULES: readonly (readonly [string, Rule])[] = [
  ['html-has-lang', htmlHasLang],
  ['page-has-one-main', pageHasOneMain],
  ['page-has-one-h1', pageHasOneH1],
  ['heading-order', headingOrder],
  ['control-has-accessible-name', controlHasAccessibleName],
  ['interactive-role-is-focusable', interactiveRoleIsFocusable],
  ['no-positive-tabindex', noPositiveTabindex],
  ['link-has-href', linkHasHref],
  ['image-has-alt', imageHasAlt],
  ['aria-hidden-not-focusable', ariaHiddenNotFocusable],
  ['name-on-prohibited-role', nameOnProhibitedRole],
  ['aria-reference-resolves', ariaReferenceResolves],
  ['unique-id', uniqueIds],
  ['list-structure', listStructure],
  ['landmarks-are-distinguishable', landmarksAreDistinguishable],
];

/** Run every rule against a rendered document. Empty means clean. */
export function auditAccessibility(doc: Document): AccessibilityViolation[] {
  return ACCESSIBILITY_RULES.flatMap(([, rule]) => rule(doc));
}

/** A one-line-per-violation report, for a test failure message worth reading. */
export function formatViolations(violations: readonly AccessibilityViolation[]): string {
  return violations
    .map((violation) => `  [${violation.rule}] ${violation.message}\n    ${violation.html}`)
    .join('\n');
}
