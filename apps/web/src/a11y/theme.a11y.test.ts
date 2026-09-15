// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The join between the tokens the contrast suite checks and the stylesheet the
 * browser paints.
 *
 * Without this file, `contrast.a11y.test.ts` proves only that a TypeScript
 * object is compliant. `theme.css` could declare something else entirely and
 * every check would stay green — a write that reports success while the read
 * cannot see it, in the one place where the "read" is a person's eyes.
 *
 * So this reads the stylesheet as a file, extracts every `--oyl-color-*`
 * declaration, and requires the two sets to match **in both directions**: a
 * token with no custom property, and a custom property with no token, both
 * fail.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COLOUR_TOKENS, FONT_SIZE_TOKENS, SPACE_TOKENS } from '../design/tokens';

const themeCss = readFileSync(
  fileURLToPath(new URL('../design/theme.css', import.meta.url)),
  'utf8',
);

/** `--oyl-color-ink-muted: #4a5b5c;` → `['inkMuted', '#4a5b5c']`. */
function declarationsWithPrefix(prefix: string): Map<string, string> {
  const pattern = new RegExp(`--oyl-${prefix}-([a-z0-9-]+)\\s*:\\s*([^;]+);`, 'g');
  const found = new Map<string, string>();
  for (const match of themeCss.matchAll(pattern)) {
    const [, kebab, value] = match;
    if (kebab === undefined || value === undefined) {
      continue;
    }
    found.set(camelCase(kebab), value.trim());
  }
  return found;
}

function camelCase(kebab: string): string {
  return kebab.replaceAll(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

describe('theme.css and tokens.ts cannot drift', () => {
  it.each([
    ['color', COLOUR_TOKENS as Record<string, string>],
    ['space', SPACE_TOKENS as Record<string, string>],
    ['font-size', FONT_SIZE_TOKENS as Record<string, string>],
  ])('declares exactly the %s tokens, with the same values', (prefix, tokens) => {
    const declared = declarationsWithPrefix(prefix);
    expect(Object.fromEntries([...declared].sort())).toEqual(
      Object.fromEntries(Object.entries(tokens).sort()),
    );
  });
});

/**
 * Every place the stylesheet *reads* a custom property, whatever the prefix.
 *
 * Deliberately not scoped to a rule body: a `var()` inside `:root` would be one
 * token defined in terms of another, which is a use. What is not a use is a
 * declaration nothing ever reads, and that is what the check below looks for.
 */
const referenced = new Set(
  [...themeCss.matchAll(/var\(\s*(--oyl-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''),
);

/** `'inkMuted'` with prefix `'color'` → `'--oyl-color-ink-muted'`. */
function customProperty(prefix: string, token: string): string {
  return `--oyl-${prefix}-${token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * The gate #307's last criterion asks for: *"a token that can be set to a
 * nonsense value with the suite still green is not covered"*.
 *
 * ⚠️ This is the #236 defect in a new place, and it was already present when
 * #307 was written. `--oyl-font-size-xl` and `--oyl-space-xl` were both
 * declared in `:root`, both asserted by the test above to match `tokens.ts`
 * exactly — and neither was read by a single rule. The declaration is the
 * write, the `var()` is the read, and the suite was green while the read did
 * not exist. Every existing gate agreed the token was fine; the browser painted
 * nothing with it.
 */
describe('every token is painted by something', () => {
  it.each([
    ['color', COLOUR_TOKENS as Record<string, string>],
    ['space', SPACE_TOKENS as Record<string, string>],
    ['font-size', FONT_SIZE_TOKENS as Record<string, string>],
  ])('has a rule reading each %s token', (prefix, tokens) => {
    const unread = Object.keys(tokens)
      .map((token) => customProperty(prefix, token))
      .filter((property) => !referenced.has(property));
    expect(
      unread,
      'these custom properties are declared and no rule reads them. A token nothing paints ' +
        'with can hold any value at all and every other check in this suite stays green.',
    ).toEqual([]);
  });
});

describe('the stylesheet keeps the promises the checks depend on', () => {
  it('never removes a focus outline without replacing it', () => {
    // `outline: none` on `:focus-visible` is the single most common way a
    // design system becomes unusable by keyboard. The one `outline: none` in
    // the file is on `.oyl-main:focus`, whose `:focus-visible` rule directly
    // below restores it — a focus target that is moved to programmatically
    // should not draw a ring for a mouse user, and must for a keyboard one.
    const suppressions = [...themeCss.matchAll(/([^{}]+)\{[^{}]*outline:\s*none/g)].map((match) =>
      (match[1] ?? '').trim(),
    );
    expect(suppressions).toEqual(['.oyl-main:focus']);
    expect(themeCss).toContain('.oyl-main:focus-visible {\n  outline: 3px solid');
  });

  it('offsets the focus ring, which is what the contrast pair assumes', () => {
    // `tokens.ts` pairs `focus` with `canvas` and `surface` and not with
    // `accent`, on the grounds that the ring lands outside the control. That is
    // only true while `outline-offset` is positive.
    expect(themeCss).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*2px/);
  });

  it('keeps the skip link focusable rather than hiding it outright', () => {
    // `display: none` and `visibility: hidden` both remove an element from the
    // tab order, which would make the skip link unreachable by the only input
    // method that needs it.
    const skipLinkRule = /\.oyl-skip-link\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? '';
    expect(skipLinkRule).not.toContain('display: none');
    expect(skipLinkRule).not.toContain('visibility: hidden');
    expect(skipLinkRule).toContain('transform: translateY(-200%)');
  });

  it('honours a reduced-motion preference', () => {
    expect(themeCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('has something for the reduced-motion block to suppress', () => {
    // Until #307 that block guarded nothing: there was not one `transition` or
    // `animation` in the file. A preference honoured over an empty set is a
    // claim rather than a behaviour, and this is what stops it becoming one
    // again if the transitions are ever removed.
    expect(themeCss).toMatch(/\n\s*transition:/);
  });
});

/**
 * #307's fourth criterion: at least one capability beyond
 * `prefers-reduced-motion`, *"chosen for a real device rather than for
 * completeness"*.
 *
 * Each assertion below checks the block does the specific thing it exists for,
 * not merely that the `@media` line is present. A query that matches and then
 * changes nothing is the same shape as the unpainted token above.
 */
describe('the capability queries change something', () => {
  /** The body of an `@media` block, brace-matched rather than regex-matched. */
  function mediaBlock(condition: string): string {
    const start = themeCss.indexOf(`@media ${condition} {`);
    expect(start, `theme.css has no @media ${condition} block`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let index = themeCss.indexOf('{', start); index < themeCss.length; index += 1) {
      const character = themeCss[index];
      if (character === '{') depth += 1;
      if (character === '}') {
        depth -= 1;
        if (depth === 0) return themeCss.slice(start, index + 1);
      }
    }
    throw new Error(`the @media ${condition} block is never closed`);
  }

  it('hands a styled select back to the platform under forced colours', () => {
    // The styling and its revert are one change. `appearance: none` takes the
    // operating system's drawing of the control away, and a high-contrast user
    // whose replacement skin has also been flattened is left with a control
    // that has no affordance at all.
    const block = mediaBlock('(forced-colors: active)');
    expect(block).toContain('appearance: auto');
    expect(block).toContain('background-image: none');
  });

  it('collapses motion on a screen that cannot cheaply repaint', () => {
    const block = mediaBlock('(update: slow)');
    expect(block).toContain('transition-duration: 0.01ms !important');
    expect(block).toContain('animation-duration: 0.01ms !important');
  });
});

/**
 * #307's third criterion, and the ⚠️ attached to it: the native controls are
 * styled *"without replacing them"*.
 */
describe('the native select is styled and still native', () => {
  it('skins the closed control', () => {
    const rule = /\nselect \{([^}]*)\}/.exec(themeCss)?.[1] ?? '';
    expect(rule, 'theme.css has no rule for `select`').not.toBe('');
    expect(rule).toContain('border: 1px solid var(--oyl-color-border)');
    expect(rule).toContain('border-radius: var(--oyl-radius)');
    expect(rule).toContain('font: inherit');
  });

  it('reserves room for the chevron it draws, so an option cannot run under it', () => {
    // The two are one decision. A `background-image` chevron with no
    // `padding-right` is a control whose longest option is unreadable, which is
    // worse than the platform default this replaced.
    const rule = /\nselect \{([^}]*)\}/.exec(themeCss)?.[1] ?? '';
    expect(rule).toContain('background-image:');
    expect(rule).toMatch(/padding:[^;]*\s2rem\s/);
  });

  it('never reaches for the one property that would replace the control', () => {
    // `appearance: base-select` opts the element into a fully author-styled
    // control, popup included — which is a listbox built out of the select's
    // own parts, and #305 is the record of not building one. `appearance: none`
    // stops at the closed control's skin and leaves the popup, the keyboard
    // model and the accessibility tree to the platform.
    expect(themeCss).not.toContain('base-select');
    expect(themeCss).not.toContain('::picker(');
  });
});

// ⚠️ There is deliberately no automated trade-dress check here.
//
// ADR 0009 rule L1 bars another product's name, mark or get-up from this
// product, and #48's guidance states the check as "a grep of the diff … every
// hit must be prose in `docs/`, `README.md`, `CLAUDE.md`, an issue or an ADR".
// A test that asserted the absence of those names would have to *contain* them,
// and a test file under `apps/` is none of the five places a hit is allowed —
// so the automated version would itself be the violation.
//
// The right home for it is a rule in `scripts/check-repo-rules.sh`, which is
// not scanned by its own checks — that is how `SCOPE001` can hold the pattern
// for the protocol it bans without failing itself, and writing that sentence
// with the literal in it is what made SCOPE001 fail this very file once.
// Adding a rule there means adding fixture cases to
// `check-repo-rules.test.sh` too, and it enforces an ADR rather than anything
// in #48 — so it is left to the issue that owns ADR 0009's enforcement. The
// grep was run over this change by hand and is clean.
