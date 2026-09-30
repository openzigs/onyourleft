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

/**
 * Whether a control is unavailable to a user, however it says so.
 *
 * Used by the rules that *exempt* an unavailable control from an expectation —
 * it need not be focusable, and a focus that lands inside an `aria-hidden`
 * subtree matters less when it lands on something inert.
 *
 * ⚠️ **This is not the same question as {@link removedFromTabOrder}**, and
 * conflating the two is what #255 found. See that function.
 */
function isDisabled(element: Element): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true';
}

/**
 * Whether the browser takes this element out of the tab sequence.
 *
 * ⚠️ **Only the `disabled` *attribute* does that. `aria-disabled` does not, in
 * any browser** — that is the entire reason the attribute exists as a separate
 * thing to reach for. A control marked `aria-disabled` is still focusable and
 * is still announced, which is exactly what you want when a rider needs to
 * *find out* that a control is blocked and why: the native attribute deletes it
 * from the keyboard user's world, explanation and all.
 *
 * Until #255 {@link tabbableElements} used {@link isDisabled} here, so this
 * model said an `aria-disabled` button could not be tabbed to. That made the
 * model disagree with every browser, and it made the only correct fix for #255's
 * second defect look like a regression in the keyboard tests. It is the tab
 * order that is being modelled, so the attribute is what decides it.
 */
function removedFromTabOrder(element: Element): boolean {
  return element.hasAttribute('disabled');
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
 * Whether this is the summary of its parent `<details>` — the FIRST `<summary>`
 * child, which the HTML standard calls "the summary for its parent details".
 *
 * That one element is the disclosure's control: it is focusable with no
 * `tabindex`, it opens and closes the element, and it is rendered whether the
 * `<details>` is open or closed. Any other `<summary>` — a second one, or one
 * with no `<details>` parent — is ordinary content with no activation
 * behaviour, and is not in the HTML standard's list of focusable areas.
 */
function isDetailsSummary(element: Element): boolean {
  const parent = element.parentElement;
  if (element.tagName !== 'SUMMARY' || parent?.tagName !== 'DETAILS') {
    return false;
  }
  return [...parent.children].find((child) => child.tagName === 'SUMMARY') === element;
}

/**
 * A `<summary>` that is not its `<details>`' own and has no `tabindex`: it
 * matches `FOCUSABLE_SELECTOR` by tag, and no browser can focus it (#665).
 */
function isInertSummary(element: Element): boolean {
  return (
    element.tagName === 'SUMMARY' &&
    !isDetailsSummary(element) &&
    element.getAttribute('tabindex') === null
  );
}

/**
 * Whether a closed `<details>` somewhere above this element leaves it
 * unrendered (#665).
 *
 * A `<details>` without the `open` attribute renders its own first `<summary>`
 * and nothing else: the rest of its content is not laid out, so no browser can
 * tab to it. The walk goes all the way up, because a link inside an OPEN
 * `<details>` that is itself inside a closed one is not rendered either, and
 * nor is the summary of that inner `<details>`. The one exception at each level
 * is the closed element's own first summary — and anything inside that summary,
 * which is rendered with it.
 */
function collapsedByDetails(element: Element): boolean {
  for (let node: Element = element; node.parentElement !== null; node = node.parentElement) {
    const parent = node.parentElement;
    if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open') && !isDetailsSummary(node)) {
      return true;
    }
  }
  return false;
}

/**
 * The tab stops of a document, in order, with or without every `<details>`
 * taken as it is. `disclosed` answers "if the rider opened every disclosure",
 * which is the question `interactive-role-is-focusable` asks.
 */
function tabStops(root: Document | Element, disclosed: boolean): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  return candidates.filter((element) => {
    if (removedFromTabOrder(element) || isHiddenFromAssistiveTechnology(element)) {
      return false;
    }
    if (!disclosed && collapsedByDetails(element)) {
      return false;
    }
    if (element.tagName === 'INPUT' && element.getAttribute('type') === 'hidden') {
      return false;
    }
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) {
      return false;
    }
    return !isInertSummary(element);
  });
}

/**
 * The keyboard tab order of a document, in order.
 *
 * Only `tabindex="0"` and the natively focusable elements appear. A positive
 * `tabindex` would reorder the sequence, so rather than model that here it is
 * simply banned by `no-positive-tabindex` — WCAG's own advice, and the reason
 * this function can return document order and be right.
 *
 * Two rules sit beside #255's `aria-disabled` note in
 * {@link removedFromTabOrder}, and they have the same reason: it is the tab
 * order a real browser produces that is being modelled, and a model that
 * disagrees with the browser makes every keyboard test built on it describe a
 * page nobody can use, and pass.
 *
 * - **A closed `<details>` hides its content from the tab order (#665).**
 *   Everything inside a `<details>` without `open` is excluded except that
 *   element's own FIRST `<summary>` child (and what is inside it), however
 *   deeply nested — see {@link collapsedByDetails}. The content slot of a
 *   closed disclosure is not rendered, so no browser tabs into it. ⚠️ This is a
 *   TAB-ORDER question only: {@link isHiddenFromAssistiveTechnology} is
 *   deliberately unchanged, and `interactive-role-is-focusable` asks whether a
 *   control would be reachable once its disclosures are opened, because a link
 *   tucked in a closed `<details>` is reached by opening the summary first.
 * - **Only a `<details>`' first `<summary>` is focusable by its tag.** A second
 *   `<summary>`, or one outside any `<details>`, is ordinary content per the
 *   HTML standard's list of focusable areas, and is excluded unless it carries
 *   a `tabindex` of its own — see {@link isDetailsSummary}.
 * - **A named radio group is one stop (#698)** — the checked radio, or the
 *   first when none is checked — see {@link oneStopPerRadioGroup}. The others
 *   are reached by arrow key, which {@link keyboardReachableElements} answers.
 */
export function tabbableElements(root: Document | Element): HTMLElement[] {
  return oneStopPerRadioGroup(tabStops(root, false));
}

/**
 * Everything a keyboard can put focus on as the page is drawn: the tab stops,
 * and the radios an arrow key reaches from their group's stop (#698).
 *
 * The question "is this control reachable by keyboard?" is wider than "is it a
 * tab stop?" for exactly one kind of control. A radio that is not its group's
 * stop is never reached by Tab, and is reached by an arrow key from the one
 * that is — so it is reachable when, and only when, its group has a stop.
 *
 * ⚠️ **A grouped radio with `tabindex="-1"` is counted as UNREACHABLE (#864)**,
 * even when its group has a stop. The candidates are the tab stops, and a
 * negative `tabindex` takes an element out of them before the group is
 * considered — whether an arrow key would still land on it differs between
 * engines and is not modelled here. That is the conservative direction: a
 * control this answers "unreachable" for fails the audit rather than passing
 * it, so the cost of the simplification is a false finding, never a missed one.
 */
export function keyboardReachableElements(root: Document | Element): HTMLElement[] {
  const candidates = tabStops(root, false);
  const stops = oneStopPerRadioGroup(candidates);
  const radioStops = stops.filter(isGroupedRadio);
  return candidates.filter(
    (element) =>
      stops.includes(element) ||
      (isGroupedRadio(element) && radioStops.some((stop) => inSameRadioGroup(stop, element))),
  );
}

/**
 * A radio button in a radio group: HTML's "radio button group" needs a
 * non-empty `name`, so a radio with none is a group of one and is its own stop.
 */
function isGroupedRadio(element: Element): element is HTMLInputElement {
  return (
    element.tagName === 'INPUT' &&
    (element.getAttribute('type') ?? '').toLowerCase() === 'radio' &&
    (element.getAttribute('name') ?? '') !== ''
  );
}

/**
 * What puts two radios in one group, per the HTML standard: the same `name`,
 * the same form owner (or both none) and the same tree.
 */
function inSameRadioGroup(a: HTMLInputElement, b: HTMLInputElement): boolean {
  return a.name === b.name && a.form === b.form && a.getRootNode() === b.getRootNode();
}

/**
 * The group of a grouped radio: every radio in its tree it shares one with,
 * whatever the `root` a caller asked about, because a checked radio outside
 * that root still decides which of these is the stop.
 */
function radioGroupOf(radio: HTMLInputElement): HTMLInputElement[] {
  const tree = radio.getRootNode() as ParentNode;
  return [...tree.querySelectorAll<HTMLInputElement>('input')].filter(
    (other) => isGroupedRadio(other) && inSameRadioGroup(other, radio),
  );
}

/**
 * A named radio group is ONE tab stop, as a browser makes it (#698) — the
 * model used to list every radio, and Chromium stops once per group.
 *
 * This is Chromium's own rule (`RadioInputType::IsKeyboardFocusable`), which
 * the HTML standard leaves to the platform: a radio is a stop when it is
 * checked, or when nothing in its group is checked — and never when the stop
 * before it in the sequence is a radio of the same group, because Tab always
 * leaves the group. So with one radio checked, that radio is the stop and no
 * other; with none checked, the first radio the sequence meets is (the last,
 * going backwards, which a forward order does not model). A group whose radios
 * are split by some other control is met twice, and stops twice, as it does in
 * the browser.
 */
function oneStopPerRadioGroup(candidates: HTMLElement[]): HTMLElement[] {
  const stops: HTMLElement[] = [];
  for (const element of candidates) {
    if (isGroupedRadio(element)) {
      const group = radioGroupOf(element);
      if (!element.checked && group.some((radio) => radio.checked)) {
        continue;
      }
      const previous = stops.at(-1);
      if (
        previous !== undefined &&
        isGroupedRadio(previous) &&
        inSameRadioGroup(previous, element)
      ) {
        continue;
      }
    }
    stops.push(element);
  }
  return stops;
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
    if (isDetailsSummary(element)) {
      return true;
    }
    // Any other summary is text by its tag, and is a control only if it CLAIMS
    // to be one: `<summary role="button">` outside a `<details>` is as
    // unreachable as `<span role="button">`, so it falls through to its role.
    if (element.tagName !== 'SUMMARY' && NATIVELY_INTERACTIVE.has(element.tagName)) {
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
  // Reachable once every disclosure is opened: a control tucked in a closed
  // `<details>` is reached through its summary, and is not a keyboard trap.
  const tabbable = new Set<Element>(tabStops(doc, true));
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
    // The tab-order model's rule: a summary that is not its details' own is not
    // focusable, so it cannot put focus anywhere under `aria-hidden` either.
    .filter((element) => !isInertSummary(element))
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

/**
 * The landmark roles this rule compares, each with the tag that carries it
 * implicitly, and whether that tag is the landmark even with no name.
 *
 * HTML-AAM maps `nav` and `aside` to their landmark roles unconditionally, and
 * `section` and `form` only when they have an accessible name — so an unnamed
 * `nav` IS a navigation landmark and an unnamed `section` is no region (#864).
 */
const COMPARED_LANDMARKS: readonly (readonly [
  role: string,
  tag: string,
  landmarkWhenUnnamed: boolean,
])[] = [
  ['navigation', 'nav', true],
  ['complementary', 'aside', true],
  ['region', 'section', false],
  ['form', 'form', false],
];

function distinguishableViolation(
  element: Element,
  kind: string,
  name: string,
): AccessibilityViolation {
  return {
    rule: 'landmarks-are-distinguishable',
    message:
      `There is more than one ${kind} and this one is ${name === '' ? 'unnamed' : `named "${name}" like another`}. ` +
      'A landmark list with two identical entries is a list you cannot navigate by.',
    html: snippet(element),
  };
}

/**
 * Two landmarks of one role that a reader cannot tell apart.
 *
 * By TAG, as it always was: every `nav`, `aside`, `section` and `form`
 * against the others of its tag. And since #690 by ROLE as well:
 * `design/ScrollTable.tsx` makes every table a `div` with `role="region"`, and
 * two tables captioned alike were two region landmarks of one name that a
 * rule reading tags alone never saw. An element that declares a landmark role
 * on another tag is compared with the others of that role, and with every
 * element of the tag that carries it implicitly and IS that landmark — every
 * `nav` and `aside`, named or not, but only a NAMED `section` or `form`: an
 * unnamed `section` is not a region landmark at all (HTML-AAM), so it is not
 * held against one (#864).
 */
const landmarksAreDistinguishable: Rule = (doc) => {
  const violations: AccessibilityViolation[] = [];
  const visible = (element: Element): boolean => !isHiddenFromAssistiveTechnology(element);
  for (const [role, tag, landmarkWhenUnnamed] of COMPARED_LANDMARKS) {
    const landmarks = [...doc.querySelectorAll(tag)].filter(visible);
    const names = landmarks.map((element) => landmarkName(element).toLowerCase());
    if (landmarks.length >= 2) {
      landmarks.forEach((element, index) => {
        const name = names[index] ?? '';
        if (name === '' || names.indexOf(name) !== index) {
          violations.push(distinguishableViolation(element, `\`${tag}\``, name));
        }
      });
    }

    const declared = [...doc.querySelectorAll(`[role="${role}"]:not(${tag})`)].filter(visible);
    const implicitNames = names.filter((name) => name !== '');
    // ⚠️ Until #864 this counted NAMED implicit landmarks only, which is right
    // for `section` and `form` and wrong for `nav` and `aside`: an unnamed
    // `<nav>` beside an unnamed `<div role="navigation">` is two navigation
    // landmarks a reader cannot tell apart, and gave no violation.
    const implicitCount = landmarkWhenUnnamed ? landmarks.length : implicitNames.length;
    if (declared.length === 0 || declared.length + implicitCount < 2) {
      continue;
    }
    const declaredNames = declared.map((element) => landmarkName(element).toLowerCase());
    declared.forEach((element, index) => {
      const name = declaredNames[index] ?? '';
      if (name === '' || declaredNames.indexOf(name) !== index || implicitNames.includes(name)) {
        violations.push(distinguishableViolation(element, `\`${role}\` landmark`, name));
      }
    });
  }
  return violations;
};

/**
 * #660 — WCAG 2.2 SC 1.4.10 (Reflow). A data table may keep its columns on a
 * 320 px phone only inside a box of its own that scrolls, and a box that
 * scrolls must be reachable by keyboard: it takes focus, it has a role, it has
 * a name (#654's re-review). `design/ScrollTable.tsx` is that box.
 *
 * ⚠️ **Structural, not measured.** jsdom performs no layout, so this cannot
 * know whether a table overflows — it requires every table to be ready to.
 * `browser/reflow.browser.spec.ts` is the half that measures: it finds every
 * box that actually scrolls sideways in a real engine and requires the same
 * three things of it, which also covers a scroller that is not a table.
 *
 * The region must be the table's PARENT, so a page-wide region somewhere up
 * the tree cannot stand in for one around the table.
 */
const tableInScrollRegion: Rule = (doc) =>
  [...doc.querySelectorAll('table')]
    .filter((table) => !isHiddenFromAssistiveTechnology(table))
    .filter((table) => {
      const region = table.parentElement;
      return (
        region === null ||
        region.getAttribute('role') !== 'region' ||
        region.getAttribute('tabindex') !== '0' ||
        landmarkName(region) === ''
      );
    })
    .map((table) => ({
      rule: 'table-in-scroll-region',
      message:
        'A table that is not the child of a focusable, named scroll region. On a phone its ' +
        'columns either widen the whole page — SC 1.4.10 — or scroll inside a box a keyboard ' +
        'cannot reach. Render it with `design/ScrollTable.tsx`.',
      html: snippet(table),
    }));

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
  ['table-in-scroll-region', tableInScrollRegion],
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
