// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tailwind CSS stays inside the tokens — #950, ADR 0042.
 *
 * The owner chose Tailwind v4 for the menus on the condition the issue states:
 * *"every utility colour is a token, and `contrast.a11y.test.ts` and
 * `theme.a11y.test.ts` keep gating it in both palettes"*. A utility framework
 * is a second way to write a colour, and a second way is exactly how a value
 * nobody measured reaches the screen — `bg-[#777]` is legal Tailwind, and so
 * are `duration-500` and `bg-ink/40`. So this file reads what Tailwind itself
 * reads and holds what it would ship:
 *
 * 1. **The theme is the tokens.** `design/tailwind.css`'s `@theme` names every
 *    colour, space and type token and nothing else, each as the `var(--oyl-…)`
 *    `theme.css` declares — both directions, so a token added to `tokens.ts`
 *    without a utility, and a utility with no token, both fail.
 * 2. **What ships names no value of its own.** The source is scanned with
 *    Tailwind's own scanner and compiled with its own compiler, and the CSS
 *    that comes out may not hold a colour literal, a `color-mix()`, a duration
 *    or an easing curve, or a `var()` that is not a token; and no arbitrary
 *    value (`[…]`) may have produced a rule at all. Since #950's review, no
 *    colour may be written in the `(--custom-property)` shorthand either
 *    (`tw:text-(--oyl-color-illo-sun)` is a token's `var()` that check 4
 *    cannot read as a pair), a `--tw-*` property is exempt only where Tailwind
 *    wrote it rather than the source, and no partial `opacity`, `filter` or
 *    blend may ship: each changes the contrast of whatever pair is under it.
 * 3. **Every `tw:` class is real.** A class that generates nothing — `tw:p-4`
 *    against a theme with no numeric spacing, `tw:bg-red-500`, a typo — is a
 *    silent no-op, and fails here.
 * 4. **The contrast gate reads a Tailwind colour.** Where one class list sets
 *    both an ink (`tw:text-…`) and a surface (`tw:bg-…`) for the same state,
 *    the pair must be one `tokens.ts` §`CONTRAST_REQUIREMENTS` declares — which
 *    `contrast.a11y.test.ts` then measures in both palettes.
 * 5. **Motion comes from the motion tokens** (#936, and #951's review on this
 *    issue): `duration-short`, `duration-medium` and `ease-standard` only, and
 *    no `delay-*` or `animate-*`.
 * 6. **No preflight and no layer.** `theme.css`'s base rules stay the base,
 *    and the utilities load after it everywhere a page is built.
 *
 * ⚠️ **What it cannot see.** A class assembled at run time from pieces
 * (`` `tw:bg-${tone}` ``) is not a string Tailwind can find either, so it ships
 * no CSS — Tailwind's own rule, and why `StatusMessage.tsx` spells every tone
 * out. A pair split across two class lists on one element (a base in one
 * constant, a hover in another) is not read as a pair by check 4; keep an
 * element's ink and surface in one string.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  COLOUR_TOKENS,
  CONTRAST_REQUIREMENTS,
  FONT_SIZE_TOKENS,
  SPACE_TOKENS,
  type ColourToken,
} from '../design/tokens';

import {
  DESIGN_DIRECTORY as DESIGN,
  TAILWIND_CSS_PATH,
  shippedUtilities,
  tailwindCompiler as compilerFor,
  type TailwindCompiler as Compiler,
} from './tailwind-shipped-testing';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const WEB = join(SRC, '..');
const tailwindCss = readFileSync(TAILWIND_CSS_PATH, 'utf8');
const themeCss = readFileSync(join(DESIGN, 'theme.css'), 'utf8');

/** The prefix every utility carries (ADR 0042 D-3). */
const PREFIX = 'tw:';

const kebab = (camel: string): string =>
  camel.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function withoutComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of the one `@theme` block, brace-matched. */
function themeBlock(css: string): { opening: string; body: string } {
  const stripped = withoutComments(css);
  const start = stripped.indexOf('@theme');
  if (start < 0) {
    throw new Error('tailwind.css has no @theme block');
  }
  const brace = stripped.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < stripped.length; index += 1) {
    if (stripped[index] === '{') depth += 1;
    if (stripped[index] === '}') depth -= 1;
    if (depth === 0) {
      return {
        opening: stripped.slice(start, brace).trim(),
        body: stripped.slice(brace + 1, index),
      };
    }
  }
  throw new Error('tailwind.css: the @theme block is never closed');
}

/** `--name: value;` pairs, in order. */
function declarationsIn(body: string): [string, string][] {
  return [...body.matchAll(/(--[a-z0-9*-]+)\s*:\s*([^;]+);/gi)].map(([, name, value]) => [
    name ?? '',
    (value ?? '').trim(),
  ]);
}

/**
 * What the `@theme` must say, from the tokens. `0` is the one length that is
 * not a token (nobody chooses it), and the radius and the motion defaults are
 * the `theme.css` properties they name.
 */
function expectedTheme(): Map<string, string> {
  const expected = new Map<string, string>([['--*', 'initial']]);
  for (const token of Object.keys(COLOUR_TOKENS)) {
    expected.set(`--color-${kebab(token)}`, `var(--oyl-color-${kebab(token)})`);
  }
  expected.set('--spacing-0', '0px');
  for (const token of Object.keys(SPACE_TOKENS)) {
    expected.set(`--spacing-${token}`, `var(--oyl-space-${token})`);
  }
  for (const token of Object.keys(FONT_SIZE_TOKENS)) {
    expected.set(`--text-${token}`, `var(--oyl-font-size-${token})`);
  }
  expected.set('--radius', 'var(--oyl-radius)');
  expected.set('--radius-card', 'var(--oyl-radius-card)');
  expected.set('--ease-standard', 'var(--oyl-motion-ease-standard)');
  expected.set('--default-transition-duration', 'var(--oyl-motion-short)');
  expected.set('--default-transition-timing-function', 'var(--oyl-motion-ease-standard)');
  return expected;
}

/** Every `--oyl-*` custom property `theme.css` declares, in any block. */
const DECLARED_TOKENS = new Set(
  [...withoutComments(themeCss).matchAll(/(--oyl-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);

/** CSS as Tailwind escapes a class into a selector: `tw:bg-ink` → `.tw\:bg-ink`. */
function selectorOf(className: string): string {
  return `.${className.replaceAll(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)}`;
}

/** Drop `@property` rules and `@layer properties`: Tailwind's own initial values. */
function withoutTailwindInternals(css: string): string {
  let out = css.replaceAll(/@property\s+--[a-z0-9-]+\s*\{[^}]*\}/g, '');
  const start = out.indexOf('@layer properties');
  if (start >= 0) {
    const brace = out.indexOf('{', start);
    const semicolon = out.indexOf(';', start);
    if (brace >= 0 && (semicolon < 0 || brace < semicolon)) {
      let depth = 0;
      for (let index = brace; index < out.length; index += 1) {
        if (out[index] === '{') depth += 1;
        if (out[index] === '}') depth -= 1;
        if (depth === 0) {
          out = out.slice(0, start) + out.slice(index + 1);
          break;
        }
      }
    }
  }
  return out.replaceAll(/@layer properties;/g, '');
}

const COLOUR_PROPERTY = /(?:^|-)(?:color|background|border|outline|fill|stroke|shadow|caret)/;
const NAMED_COLOUR =
  /\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia)\b/i;

interface Declaration {
  /** Every selector and at-rule the declaration sits inside, outermost first. */
  readonly chain: readonly string[];
  readonly property: string;
  readonly value: string;
}

/**
 * Every declaration in a piece of CSS, with the rules it is nested in — so a
 * check can ask what CLASS wrote it, which a flat list of `property: value`
 * cannot say (#950's review: a colour's spelling is in its selector).
 */
function declarationsOf(css: string): Declaration[] {
  const found: Declaration[] = [];
  const chain: string[] = [];
  let buffer = '';
  const flush = (): void => {
    const said = buffer.trim();
    buffer = '';
    if (chain.length === 0) return;
    const match = /^(--[a-z0-9-]+|-?[a-z][a-z-]*)\s*:\s*([\s\S]+)$/i.exec(said);
    if (match === null) return;
    found.push({
      chain: [...chain],
      property: (match[1] ?? '').toLowerCase(),
      value: (match[2] ?? '').trim(),
    });
  };
  for (const character of css) {
    if (character === '{') {
      chain.push(buffer.trim());
      buffer = '';
    } else if (character === ';') {
      flush();
    } else if (character === '}') {
      flush();
      chain.pop();
    } else {
      buffer += character;
    }
  }
  return found;
}

/**
 * The element-level properties that change the colour a rider sees without
 * being a colour — so no contrast pair could ever measure what they make.
 * `opacity` is allowed only fully on or fully off (#950's review: `tw:opacity-40`
 * is a bare-value utility, so clearing the theme does not remove it, and it
 * fades a pair exactly as the refused `bg-ink/40` would).
 */
const CONTRAST_CHANGING =
  /^(?:filter|-webkit-backdrop-filter|backdrop-filter|mix-blend-mode|background-blend-mode)$/;
const WHOLE_OPACITY = /^(?:0|1|0%|100%)$/;

/**
 * Everything in a piece of compiled CSS that is not a token, as sentences.
 * Empty is a pass. Exported to nothing: the fixtures below call it too, which
 * is what makes it a check that can fail.
 */
function valuesNotFromTokens(css: string): string[] {
  const faults: string[] = [];
  const body = withoutTailwindInternals(withoutComments(css));
  for (const { chain, property: name, value: said } of declarationsOf(body)) {
    const where = `${name}: ${said}`;
    const selectors = chain.join(' ');
    if (
      /#[0-9a-f]{3,8}\b/i.test(said) ||
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(said)
    ) {
      faults.push(`a colour literal — ${where}`);
    }
    if (/\bcolor-mix\(/i.test(said)) {
      faults.push(`a mixed colour, which no contrast pair measures — ${where}`);
    }
    if (COLOUR_PROPERTY.test(name) && NAMED_COLOUR.test(said)) {
      faults.push(`a named colour — ${where}`);
    }
    // ⚠️ #950's review: `tw:text-(--oyl-color-illo-sun)` compiles to a token's
    // `var()`, so every check above passes it, and its selector escapes `(`
    // rather than `[`, so the arbitrary-value check below does not fire
    // either — while check 4 reads only `text-<token>` and `bg-<token>`, so the
    // pair it makes is measured by nobody. A theme colour always has its own
    // utility; the `(…)` shorthand is refused on any colour property.
    if (COLOUR_PROPERTY.test(name) && selectors.includes('\\(')) {
      faults.push(
        `a colour written as a (--custom-property), which the contrast pair check cannot ` +
          `read — use the token's own utility — ${selectors.trim()} { ${where} }`,
      );
    }
    if (name === 'opacity' && !WHOLE_OPACITY.test(said)) {
      faults.push(`a partial opacity, which changes the contrast of any pair under it — ${where}`);
    }
    if (CONTRAST_CHANGING.test(name)) {
      faults.push(`a filter or blend, which changes the contrast of any pair under it — ${where}`);
    }
    if (/(?:^|[\s,(])-?\d*\.?\d+m?s\b/.test(said.replaceAll(/var\([^)]*\)/g, ''))) {
      faults.push(`a duration of its own — ${where}`);
    }
    // A custom property's NAME is not a value: `var(--tw-ease, …)` names no easing.
    if (
      /\b(?:cubic-bezier|steps|linear)\(|\bease(?:-in|-out|-in-out)?\b/i.test(
        said.replaceAll(/--[a-z0-9-]+/gi, ''),
      )
    ) {
      faults.push(`an easing of its own — ${where}`);
    }
    for (const [, reference] of said.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const named = reference ?? '';
      // Tailwind's own `--tw-*` plumbing is exempt; one the SOURCE names
      // (`tw:bg-(--tw-anything)`, #950's review) is in its class, so its
      // selector names it, and is not.
      const tailwinds = named.startsWith('--tw-') && !selectors.includes('--tw-');
      if (!tailwinds && !DECLARED_TOKENS.has(named)) {
        faults.push(`a custom property theme.css does not declare — ${where}`);
      }
    }
  }
  for (const [selector] of body.matchAll(/[^{}]*\\\[[^{}]*\{/g)) {
    faults.push(`an arbitrary value made a rule — ${selector.trim()}`);
  }
  return faults;
}

/** Every non-test source file the product's classes can come from. */
function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'testing') files.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry) || /-testing\.tsx?$/.test(entry)) {
      continue;
    }
    files.push(full);
  }
  return files;
}

interface ClassList {
  readonly where: string;
  readonly classes: readonly string[];
}

/** Every string in the source that holds a `tw:` class, one list per literal. */
function classLists(): ClassList[] {
  const lists: ClassList[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes(PREFIX)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        const classes = node.text.split(/\s+/).filter((each) => each.startsWith(PREFIX));
        if (classes.length > 0) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          lists.push({ where: `${relative(WEB, file)}:${String(line + 1)}`, classes });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return lists;
}

const COLOUR_NAMES = new Map(
  Object.keys(COLOUR_TOKENS).map((token) => [kebab(token), token as ColourToken]),
);

/**
 * The ink-on-surface pairs a class list sets, per state: the base state, and
 * each variant (`hover:`, `focus-visible:`, …) with whatever it does not set
 * taken from the base.
 */
function colourPairs(
  classes: readonly string[],
): { state: string; ink: string; surface: string }[] {
  const states = new Map<string, { ink?: string; surface?: string }>();
  for (const each of classes) {
    const parts = each.slice(PREFIX.length).split(':');
    const utility = parts.pop() ?? '';
    const state = parts.join(':');
    const entry = states.get(state) ?? {};
    const ink = /^text-(.+)$/.exec(utility)?.[1];
    const surface = /^bg-(.+)$/.exec(utility)?.[1];
    if (ink !== undefined && COLOUR_NAMES.has(ink)) entry.ink = ink;
    if (surface !== undefined && COLOUR_NAMES.has(surface)) entry.surface = surface;
    states.set(state, entry);
  }
  const base = states.get('') ?? {};
  const pairs: { state: string; ink: string; surface: string }[] = [];
  for (const [state, entry] of states) {
    if (entry.ink === undefined && entry.surface === undefined) continue;
    const ink = entry.ink ?? base.ink;
    const surface = entry.surface ?? base.surface;
    if (ink !== undefined && surface !== undefined) {
      pairs.push({ state: state === '' ? 'at rest' : state, ink, surface });
    }
  }
  return pairs;
}

/** A pair `CONTRAST_REQUIREMENTS` declares, or a sentence saying it does not. */
function undeclaredPairs(list: ClassList): string[] {
  return colourPairs(list.classes)
    .filter(
      (pair) =>
        !CONTRAST_REQUIREMENTS.some(
          (requirement) =>
            requirement.foreground === COLOUR_NAMES.get(pair.ink) &&
            requirement.background === COLOUR_NAMES.get(pair.surface),
        ),
    )
    .map(
      (pair) =>
        `${list.where}: text-${pair.ink} on bg-${pair.surface} (${pair.state}) is not a pair ` +
        'tokens.ts §CONTRAST_REQUIREMENTS declares, so no contrast gate measures it',
    );
}

/** The motion utilities a `tw:` class may use (ADR 0041 D-5). */
const MOTION_ALLOWED = new Set(['duration-short', 'duration-medium', 'ease-standard']);

function motionFaults(list: ClassList): string[] {
  return list.classes
    .map((each) => each.slice(PREFIX.length).split(':').pop() ?? '')
    .filter((utility) => /^(?:duration|ease|delay|animate)-/.test(utility))
    .filter((utility) => !MOTION_ALLOWED.has(utility))
    .map((utility) => `${list.where}: ${utility} is not a motion token`);
}

/**
 * The CSS Tailwind builds for these classes and nothing else. ⚠️ A compiler
 * keeps every candidate it has been handed, so each fixture takes a fresh one:
 * a shared one would read the previous fixture's rules as this one's.
 */
async function builtAlone(classes: string[]): Promise<string> {
  return (await compilerFor(tailwindCss)).build(classes);
}

describe('#950 — Tailwind stays inside the tokens', () => {
  let compiler: Compiler;
  let shipped: string;
  let candidates: string[];
  const lists = classLists();

  beforeAll(async () => {
    ({ compiler, candidates, css: shipped } = await shippedUtilities());
  });

  describe('the theme is the tokens', () => {
    it('declares exactly the tokens, each as the custom property theme.css declares', () => {
      const declared = new Map(declarationsIn(themeBlock(tailwindCss).body));
      expect(Object.fromEntries([...declared].sort())).toEqual(
        Object.fromEntries([...expectedTheme()].sort()),
      );
    });

    it('clears Tailwind’s own theme first, and prefixes every utility', () => {
      // `--*: initial` must come first: a declaration above it is cleared too.
      const [first] = declarationsIn(themeBlock(tailwindCss).body);
      expect(first).toEqual(['--*', 'initial']);
      expect(themeBlock(tailwindCss).opening).toMatch(/^@theme inline prefix\(tw\)$/);
    });

    it('names only custom properties theme.css declares', () => {
      const unknown = [...themeBlock(tailwindCss).body.matchAll(/var\((--[a-z0-9-]+)\)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => !DECLARED_TOKENS.has(name));
      expect(unknown).toEqual([]);
    });
  });

  describe('what ships names no value of its own', () => {
    it('scans the product’s source and finds its classes', () => {
      // A scan that found nothing would make every check below a pass.
      expect(lists.length).toBeGreaterThan(0);
      expect(candidates).toContain('tw:bg-canvas');
      expect(shipped).toContain(selectorOf('tw:bg-canvas'));
    });

    it('holds no colour, duration, easing or custom property that is not a token', () => {
      expect(valuesNotFromTokens(shipped)).toEqual([]);
    });

    it('generates something for every tw: class the source writes', () => {
      const built = compiler.build(lists.flatMap((list) => list.classes));
      const nothing = lists.flatMap((list) =>
        list.classes
          .filter((each) => !built.includes(`${selectorOf(each)}`))
          .map((each) => `${list.where}: ${each} generates no CSS`),
      );
      expect(nothing).toEqual([]);
    });

    it('draws every ink on a surface as a declared contrast pair', () => {
      expect(lists.flatMap(undeclaredPairs)).toEqual([]);
      // And it has pairs to read: StatusMessage's four tones and the dialog.
      expect(lists.flatMap((list) => colourPairs(list.classes)).length).toBeGreaterThanOrEqual(5);
    });

    it('moves only at the motion tokens (#936, #951’s review)', () => {
      expect(lists.flatMap(motionFaults)).toEqual([]);
    });
  });

  describe('the checks can fail', () => {
    it('refuses an arbitrary colour, an opacity modifier and a named one', async () => {
      const fixture = await compilerFor(tailwindCss);
      expect(valuesNotFromTokens(fixture.build(['tw:bg-[#123456]']))).toEqual(
        expect.arrayContaining([expect.stringContaining('a colour literal')]),
      );
      const mixed = await compilerFor(tailwindCss);
      expect(valuesNotFromTokens(mixed.build(['tw:bg-ink/40']))).toEqual(
        expect.arrayContaining([expect.stringContaining('a mixed colour')]),
      );
      expect(valuesNotFromTokens('.a { border-color: red; }')).toEqual([
        'a named colour — border-color: red',
      ]);
    });

    it('refuses a colour written as a (--custom-property), which the pair check cannot read', async () => {
      // #950's review: this spelling passed every check while its pair —
      // illo-sun on canvas — is one no contrast gate measures.
      for (const colour of [
        'tw:text-(--oyl-color-illo-sun)',
        'tw:text-(color:--oyl-color-ink)',
        'tw:hover:bg-(--oyl-color-ink)',
        'tw:border-(--oyl-color-border)',
      ]) {
        expect(valuesNotFromTokens(await builtAlone([colour])), colour).toEqual(
          expect.arrayContaining([expect.stringContaining('a colour written as a')]),
        );
      }
      // The same shorthand on a length is a token like any other.
      expect(valuesNotFromTokens(await builtAlone(['tw:max-w-(--oyl-measure)']))).toEqual([]);
    });

    it('exempts Tailwind’s own --tw-* properties, and not one the source names', async () => {
      expect(valuesNotFromTokens(await builtAlone(['tw:transition-colors']))).toEqual([]);
      expect(valuesNotFromTokens(await builtAlone(['tw:max-w-(--tw-anything)']))).toEqual([
        'a custom property theme.css does not declare — max-width: var(--tw-anything)',
      ]);
      expect(valuesNotFromTokens(await builtAlone(['tw:bg-(--tw-anything)']))).toEqual(
        expect.arrayContaining([
          expect.stringContaining('a custom property theme.css does not declare'),
        ]),
      );
    });

    it('refuses a partial opacity, a filter and a blend, and allows fully on or off', async () => {
      expect(valuesNotFromTokens(await builtAlone(['tw:opacity-40']))).toEqual([
        'a partial opacity, which changes the contrast of any pair under it — opacity: 40%',
      ]);
      for (const effect of [
        'tw:brightness-50',
        'tw:backdrop-opacity-50',
        'tw:mix-blend-multiply',
      ]) {
        expect(valuesNotFromTokens(await builtAlone([effect])), effect).toEqual(
          expect.arrayContaining([expect.stringContaining('a filter or blend')]),
        );
      }
      expect(valuesNotFromTokens(await builtAlone(['tw:opacity-0', 'tw:opacity-100']))).toEqual([]);
    });

    it('refuses a theme that holds a literal rather than a token', async () => {
      const literal = tailwindCss.replace(
        '--color-ink: var(--oyl-color-ink);',
        '--color-ink: #141b1a;',
      );
      const fixture = await compilerFor(literal);
      expect(valuesNotFromTokens(fixture.build(['tw:text-ink']))).toEqual([
        'a colour literal — color: #141b1a',
      ]);
    });

    it('refuses a numeric duration and a delay, in the CSS and in the source', async () => {
      const fixture = await compilerFor(tailwindCss);
      expect(valuesNotFromTokens(fixture.build(['tw:duration-150']))).toEqual(
        expect.arrayContaining([expect.stringContaining('a duration of its own')]),
      );
      expect(
        motionFaults({ where: 'f', classes: ['tw:duration-150', 'tw:hover:delay-75'] }),
      ).toEqual(['f: duration-150 is not a motion token', 'f: delay-75 is not a motion token']);
      expect(motionFaults({ where: 'f', classes: ['tw:duration-short'] })).toEqual([]);
    });

    it('generates nothing for a class outside the theme', async () => {
      const fixture = await compilerFor(tailwindCss);
      const built = fixture.build(['tw:p-4', 'tw:bg-red-500', 'tw:p-md']);
      expect(built).not.toContain(selectorOf('tw:p-4'));
      expect(built).not.toContain(selectorOf('tw:bg-red-500'));
      expect(built).toContain(selectorOf('tw:p-md'));
    });

    it('reads an undeclared pair, in a state as well as at rest', () => {
      expect(
        undeclaredPairs({ where: 'f', classes: ['tw:text-illo-sun', 'tw:bg-canvas'] }),
      ).toHaveLength(1);
      expect(
        undeclaredPairs({
          where: 'f',
          classes: ['tw:text-ink', 'tw:bg-canvas', 'tw:hover:bg-accent'],
        }),
      ).toEqual([
        'f: text-ink on bg-accent (hover) is not a pair tokens.ts §CONTRAST_REQUIREMENTS ' +
          'declares, so no contrast gate measures it',
      ]);
      expect(undeclaredPairs({ where: 'f', classes: ['tw:text-ink', 'tw:bg-canvas'] })).toEqual([]);
    });
  });

  describe('theme.css stays the base', () => {
    it('imports no preflight and puts the utilities in no layer', () => {
      const css = withoutComments(tailwindCss);
      expect(css).not.toMatch(/@import/);
      expect(css).toMatch(/@tailwind utilities source\(none\);/);
      expect(css).not.toMatch(/layer\(/);
    });

    it('loads the utilities after theme.css on every page that loads theme.css', () => {
      const pages = [
        join(SRC, 'main.tsx'),
        ...readdirSync(join(WEB, 'browser'))
          .filter((entry) => entry.endsWith('.tsx'))
          .map((entry) => join(WEB, 'browser', entry)),
      ];
      const faults = pages.flatMap((page) => {
        const text = readFileSync(page, 'utf8');
        const theme = text.search(/import '[./a-z]*design\/theme\.css';/);
        if (theme < 0) return [];
        const utilities = text.search(/import '[./a-z]*design\/tailwind\.css';/);
        return utilities > theme
          ? []
          : [`${relative(WEB, page)} loads theme.css without the utilities after it`];
      });
      expect(faults).toEqual([]);
    });

    it('builds the utilities into the product and into the harness pages', () => {
      for (const config of ['vite.config.ts', 'vite.browser.config.ts']) {
        expect(readFileSync(join(WEB, config), 'utf8'), config).toMatch(/\btailwindcss\(\)/);
      }
    });
  });
});
