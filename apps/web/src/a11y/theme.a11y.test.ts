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
