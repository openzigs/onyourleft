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

import {
  COLOUR_TOKENS,
  DARK_COLOUR_TOKENS,
  FONT_SIZE_TOKENS,
  SPACE_TOKENS,
} from '../design/tokens';

const themeCss = readFileSync(
  fileURLToPath(new URL('../design/theme.css', import.meta.url)),
  'utf8',
);

/**
 * The text of the one rule whose selector is exactly `selector`, braces
 * matched, comments stripped — or a failure naming it (#672).
 */
function blockOf(selector: string): string {
  const css = themeCss.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const opening = `\n${selector} {`;
  const start = css.indexOf(opening);
  expect(start, `theme.css has no \`${selector}\` block`).toBeGreaterThanOrEqual(0);
  expect(css.indexOf(opening, start + 1), `theme.css has two \`${selector}\` blocks`).toBe(-1);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  throw new Error(`the \`${selector}\` block is never closed`);
}

/** The light palette's block, which is also where the space and type tokens live. */
const LIGHT_BLOCK = ':root';
/** The dark palette's block (#672). */
const DARK_BLOCK = ":root[data-theme='dark']";
/**
 * The ride HUD's rule, which restates the LIGHT value of every page colour
 * token so nothing inside the HUD follows the page's palette (#672, #744's
 * review).
 */
const HUD_BLOCK = '.oyl-hud';

/** `--oyl-color-ink-muted: #4a5b5c;` → `['inkMuted', '#4a5b5c']`, in `css`. */
function declarationsWithPrefix(prefix: string, css: string): Map<string, string> {
  const pattern = new RegExp(`--oyl-${prefix}-([a-z0-9-]+)\\s*:\\s*([^;]+);`, 'g');
  const found = new Map<string, string>();
  for (const match of css.matchAll(pattern)) {
    const [, kebab, value] = match;
    if (kebab === undefined || value === undefined) {
      continue;
    }
    expect(found.has(camelCase(kebab)), `--oyl-${prefix}-${kebab} is declared twice`).toBe(false);
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
  ])('declares exactly the %s tokens in `:root`, with the same values', (prefix, tokens) => {
    const declared = declarationsWithPrefix(prefix, blockOf(LIGHT_BLOCK));
    expect(Object.fromEntries([...declared].sort())).toEqual(
      Object.fromEntries(Object.entries(tokens).sort()),
    );
  });

  it('declares exactly the dark palette in the dark block, with the same values (#672)', () => {
    // Both directions, as above: a dark token with no declaration paints the
    // LIGHT value on a dark page, and a declaration with no token — a HUD
    // token redeclared, above all — is a colour nothing measured.
    const declared = declarationsWithPrefix('color', blockOf(DARK_BLOCK));
    expect(Object.fromEntries([...declared].sort())).toEqual(
      Object.fromEntries(Object.entries(DARK_COLOUR_TOKENS).sort()),
    );
  });

  it('declares no other token anywhere else, so neither block can be bypassed (#672)', () => {
    // A third palette block — a `@media (prefers-color-scheme: dark)` rule, say
    // — would paint values neither check above reads.
    const outside = themeCss
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replace(blockOf(LIGHT_BLOCK), '')
      .replace(blockOf(DARK_BLOCK), '')
      .replace(blockOf(HUD_BLOCK), '');
    expect([...outside.matchAll(/--oyl-(?:color|space|font-size)-[a-z0-9-]+\s*:/g)]).toEqual([]);
  });

  it('pins the HUD to the light palette: every page colour token, at its light value (#672)', () => {
    // The owner's ruling: the in-ride HUD is left alone. Its panels paint with
    // the HUD's own tokens, but the mute toggle, the volume, the side camera's
    // Stop and a notice's status tones paint with PAGE tokens — so this rule
    // restates every one of them, and nothing else. A token missing here
    // follows the page inside the HUD; a HUD token here is a second value for
    // a theme-independent one; a value that is not the light one is a colour
    // no contrast pair measured.
    const declared = declarationsWithPrefix('color', blockOf(HUD_BLOCK));
    const expected = Object.fromEntries(
      Object.keys(DARK_COLOUR_TOKENS)
        .sort()
        .map((token) => [token, COLOUR_TOKENS[token as keyof typeof DARK_COLOUR_TOKENS]]),
    );
    expect(Object.fromEntries([...declared].sort())).toEqual(expected);
    // And what the platform draws itself inside it — a range's track, a check
    // mark — is the light platform's.
    expect(blockOf(HUD_BLOCK)).toMatch(/\n\s*color-scheme: light;/);
  });

  it('tells the platform which palette each block is (#672)', () => {
    // So a scrollbar, a date picker, a `base-select` picker's platform parts
    // and `accent-color`'s check mark follow the page rather than the device.
    expect(blockOf(LIGHT_BLOCK)).toMatch(/\n\s*color-scheme: light;/);
    expect(blockOf(DARK_BLOCK)).toMatch(/\n\s*color-scheme: dark;/);
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

/**
 * #661: a link in running text paints with a token in every state.
 *
 * `browser/links.browser.spec.ts` reads the computed colour back for rest,
 * hover, keyboard focus and a press — and CANNOT for `:visited`, because a
 * browser reports a visited link's style as if it were not (a history-sniffing
 * defence). This is the half that covers visited: the rule exists, it reads
 * the token, and it is not a literal.
 */
describe('paints every link state with its own token', () => {
  /** The body of the one rule whose selector is exactly `selector`. */
  function ruleBody(selector: string): string {
    const escaped = selector.replaceAll(/[()[\]:.,*+?^$|\\]/g, '\\$&');
    const bodies = [...themeCss.matchAll(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`, 'g'))];
    expect(bodies, `theme.css has ${String(bodies.length)} rules for \`${selector}\``).toHaveLength(
      1,
    );
    return bodies[0]?.[1] ?? '';
  }

  it.each([
    [':where(a)', '--oyl-color-link'],
    [':where(a:visited)', '--oyl-color-link-visited'],
    [':where(a:hover, a:focus-visible)', '--oyl-color-link-hover'],
    [':where(a:active)', '--oyl-color-link-active'],
  ])('`%s` is painted with %s', (selector, property) => {
    expect(ruleBody(selector)).toMatch(new RegExp(`\\n\\s*color: var\\(${property}\\);`));
  });

  it('underlines a link at rest, and no state takes the underline away', () => {
    // WCAG 2.2 SC 1.4.1. Inside a status message a link's colour is within a
    // shade of the message's ink, so the line is what says "link".
    expect(ruleBody(':where(a)')).toContain('text-decoration-line: underline;');
    for (const selector of [
      ':where(a:visited)',
      ':where(a:hover, a:focus-visible)',
      ':where(a:active)',
    ]) {
      expect(ruleBody(selector)).not.toMatch(/text-decoration(-line)?:\s*none/);
    }
  });

  it('writes no link rule with specificity, so a class always wins', () => {
    // `a:visited` is (0,1,1) and beats `.oyl-button` (0,1,0): a visited Ride
    // button would have turned purple on a teal fill. Every link rule is
    // wrapped in `:where()`, and a bare one anywhere in the file is refused.
    expect(themeCss).not.toMatch(/(?:^|\n|,\s*)a(?::[a-z-]+)?\s*[{,]/);
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
 * Every `@supports (appearance: base-select)` block, brace-matched, with where
 * it starts and ends in the file (#667).
 */
function baseSelectBlocks(): {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}[] {
  const opening = '@supports (appearance: base-select) {';
  const found: { start: number; end: number; text: string }[] = [];
  for (
    let start = themeCss.indexOf(opening);
    start >= 0;
    start = themeCss.indexOf(opening, start + 1)
  ) {
    let depth = 0;
    for (let index = themeCss.indexOf('{', start); index < themeCss.length; index += 1) {
      const character = themeCss[index];
      if (character === '{') depth += 1;
      if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push({ start, end: index + 1, text: themeCss.slice(start, index + 1) });
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Every CSS named colour (CSS Color 4 §6.1), lower-cased. A value naming one is
 * a literal colour exactly as `#ff0000` is.
 */
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
    'yellowgreen'
  ).split(' '),
);

/**
 * Every literal colour in the declarations of `css`, as `property: value` —
 * #667's review. ANY property, not only the ones named like a colour: a
 * `box-shadow: 0 0 2px #ff0000` is as much a colour #672's dark theme cannot
 * re-point as a `background` is. What is allowed: a `var(--oyl-…)` token,
 * `currentColor`, `transparent`, the CSS-wide keywords, and the forced-colours
 * system colours — none of which is a named colour, so they need no list.
 */
function colourLiteralsIn(css: string): string[] {
  const declarations = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const [, property, value] of declarations.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/gi)) {
    const bare = (value ?? '').replaceAll(/var\(--oyl-[a-z0-9-]+\)/g, '');
    const literal =
      /#[0-9a-f]{3,8}\b/i.test(bare) ||
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i.test(bare) ||
      [...bare.matchAll(/(?<![\w-])[a-z][a-z-]*/gi)].some(([word]) =>
        NAMED_COLOURS.has(word.toLowerCase()),
      );
    if (literal) found.push(`${property ?? ''}: ${(value ?? '').trim()}`);
  }
  return found;
}

/** Every rule in `css` whose selector list includes `fragment`, comments stripped. */
function rulesMentioning(css: string, fragment: string): { selector: string; body: string }[] {
  const stripped = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: (selector ?? '').trim(), body: body ?? '' }))
    .filter(({ selector }) => selector.includes(fragment));
}

/**
 * #307's third criterion, and the ⚠️ attached to it: the native controls are
 * styled *"without replacing them"*.
 *
 * ⚠️ Since #667 "without replacing them" admits `appearance: base-select`:
 * the owner reversed #307's select rule on 2026-09-27 (#654). See the third
 * case below.
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

  it('opts into the styled picker only where the engine supports it (#667)', () => {
    // ⚠️ This REPLACES a test that said the opposite, and the reversal is the
    // owner's rather than a drift. Until 2026-09-27 it asserted that the file
    // never contained `base-select` or `::picker(`, on the ground that a styled
    // popup is a listbox built out of the select's own parts — the rule #307
    // recorded (PR #311, mutation M11; discussed in #308). The owner reversed it
    // in #654, and #667 is the implementation: `appearance: base-select` keeps
    // the element a `<select>`, with the platform's keyboard model, typeahead
    // and accessibility tree, and only the drawing of the picker becomes ours.
    // What survives of the old rule is its fallback: an engine WITHOUT
    // `base-select` must get exactly the `appearance: none` skin it got before,
    // which is only true while every mention of the new value is guarded.
    const blocks = baseSelectBlocks();
    expect(blocks.length, 'theme.css has no @supports (appearance: base-select) block').toBe(1);
    const block = blocks[0]?.text ?? '';
    expect(block).toContain('appearance: base-select');
    expect(block).toContain('::picker(select)');

    const outside = blocks.reduceRight(
      (css, { start, end }) => css.slice(0, start) + css.slice(end),
      themeCss,
    );
    // Comments are prose and may name the value; declarations may not.
    const declarations = outside.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations, 'base-select outside its @supports block').not.toContain('base-select');
    expect(declarations, '::picker( outside the @supports block').not.toContain('::picker(');
    // And the fallback skin is still the one #307 shipped.
    const rule = /\nselect \{([^}]*)\}/.exec(declarations)?.[1] ?? '';
    expect(rule).toContain('appearance: none');
  });

  it('hands the styled picker back to the platform under forced colours as well', () => {
    // The forced-colours revert is `select { appearance: auto; }` at the same
    // specificity as the `@supports` block's `select { appearance: base-select;
    // }`, so it only wins while it comes LATER in the file. Moved above the
    // block, a high-contrast user in an engine with `base-select` would keep
    // the author-drawn picker; `shell.browser.spec.ts` §"#667" reads the
    // computed value back under emulated forced colours.
    const forced = themeCss.indexOf('@media (forced-colors: active) {');
    expect(forced).toBeGreaterThanOrEqual(0);
    const forcedBlock = themeCss.slice(forced, themeCss.indexOf('\n}\n', forced));
    expect(forcedBlock).toMatch(/\n {2}select \{[^}]*appearance: auto;/);
    for (const { end } of baseSelectBlocks()) {
      expect(
        forced,
        'the forced-colours block must come after the base-select block',
      ).toBeGreaterThan(end);
    }
  });

  it('paints every colour inside the styled picker with a token (#667)', () => {
    // #672's dark theme re-points the custom properties. A literal colour here
    // would be the one part of the picker it could not reach.
    const block = baseSelectBlocks()[0]?.text ?? '';
    // Every declaration in the block, whatever its property — #667's review
    // found a literal `box-shadow` colour here passing a check that read only
    // properties named like a colour.
    expect(
      [...block.matchAll(/[a-z-]+\s*:\s*[^;{}]+;/g)].length,
      'no declarations found to check',
    ).toBeGreaterThan(3);
    expect(colourLiteralsIn(block), 'a literal colour inside the styled picker').toEqual([]);
    const picker = [...block.matchAll(/\n {2}::picker\(select\) \{([^}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .join('');
    expect(picker).toContain('background-color: var(--oyl-color-canvas)');
    expect(picker).toContain('color: var(--oyl-color-ink)');
  });
});

/**
 * #667 — the other native controls, which were at the platform default.
 *
 * These read the declarations. What the declarations DO is measured in a real
 * engine by `browser/shell.browser.spec.ts` §"#667"; neither replaces the
 * other, for the reason #316 gives about a floor and the box it holds.
 */
describe('the other native controls are styled from tokens (#667)', () => {
  /** Every rule body whose selector list is exactly `selector`. */
  function bodyOf(selector: string): string {
    const escaped = selector.replaceAll(/[()[\]:.,*+?^$|\\]/g, '\\$&');
    const bodies = [...themeCss.matchAll(new RegExp(`\\n${escaped} \\{([^}]*)\\}`, 'g'))];
    expect(bodies, `theme.css has ${String(bodies.length)} rules for \`${selector}\``).toHaveLength(
      1,
    );
    return bodies[0]?.[1] ?? '';
  }

  /** `prop: value;` pairs of a rule body, in order. */
  function declarationsOf(body: string): Map<string, string> {
    return new Map(
      [...body.matchAll(/\n\s*([a-z-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [
        name ?? '',
        (value ?? '').trim(),
      ]),
    );
  }

  it('draws checkboxes, radios, a range and a progress bar in the accent token', () => {
    const body = bodyOf(
      "input[type='checkbox'],\ninput[type='radio'],\ninput[type='range'],\nprogress",
    );
    expect(declarationsOf(body).get('accent-color')).toBe('var(--oyl-color-accent)');
  });

  it('declares a 44 px floor on a checkbox or radio row, the label beside or around it', () => {
    const body = bodyOf(
      "label:has(> input[type='checkbox']),\nlabel:has(> input[type='radio']),\n" +
        "label:has(+ input[type='checkbox']),\nlabel:has(+ input[type='radio'])",
    );
    const declared = declarationsOf(body);
    // SC 2.5.5 (AAA) is 44 px; SC 2.5.8 (AA) is 24 px and is not the reason.
    expect(declared.get('min-height')).toBe('2.75rem');
    // `min-height` does nothing to an inline box, so the display is half of it.
    expect(declared.get('display')).toBe('inline-flex');
  });

  it("draws the file input's button as the secondary button, with the same tokens", () => {
    const button = declarationsOf(bodyOf('.oyl-button'));
    const secondary = new Map([...button, ...declarationsOf(bodyOf('.oyl-button--secondary'))]);
    const file = declarationsOf(bodyOf("input[type='file']::file-selector-button"));
    for (const property of [
      'font',
      'cursor',
      'min-height',
      'padding',
      'border',
      'border-radius',
      'background',
      'color',
    ]) {
      expect(
        file.get(property),
        `::file-selector-button's ${property} is not .oyl-button--secondary's`,
      ).toBe(secondary.get(property));
    }
    expect(file.get('min-height')).toBe('2.75rem');
    // The gap from what follows it, and from the label before it, is a token.
    expect(file.get('margin-inline-end')).toMatch(/^var\(--oyl-space-[a-z]+\)$/);
    expect(
      declarationsOf(bodyOf("p > label + input[type='file']")).get('margin-inline-start'),
    ).toMatch(/^var\(--oyl-space-[a-z]+\)$/);
  });

  it('paints every rule #667 added with tokens, whatever the property or the state', () => {
    // #667's review changed the file button's `:hover` fill to `#abcdef` and
    // every gate stayed green: the picker's check covered the `@supports` block
    // and nothing else, and #672's dark theme would have missed the literal.
    // So every rule #667 added is read here, and the file button's rules are
    // found by selector rather than listed, so a `:focus-visible` or `:active`
    // state added later is covered without an edit.
    const fileButton = rulesMentioning(themeCss, '::file-selector-button');
    expect(
      fileButton.map(({ selector }) => selector),
      'the file button rules were not found',
    ).toEqual(
      expect.arrayContaining([
        "input[type='file']::file-selector-button",
        "input[type='file']::file-selector-button:hover",
      ]),
    );
    const bodies = [
      ...fileButton.map(({ body }) => body),
      bodyOf("input[type='checkbox'],\ninput[type='radio'],\ninput[type='range'],\nprogress"),
      bodyOf(
        "label:has(> input[type='checkbox']),\nlabel:has(> input[type='radio']),\n" +
          "label:has(+ input[type='checkbox']),\nlabel:has(+ input[type='radio'])",
      ),
      bodyOf("label > input[type='checkbox'],\nlabel > input[type='radio']"),
      bodyOf(":where(input[type='file'])"),
      bodyOf("p > label + input[type='file']"),
      baseSelectBlocks()[0]?.text ?? '',
    ];
    for (const body of bodies) {
      expect(colourLiteralsIn(body), 'a literal colour in a rule #667 added').toEqual([]);
    }
  });

  it('can find a literal colour, so the check above is not vacuous', () => {
    // The fixtures the review's two mutations produced, and the spellings a
    // literal can take; and the values that must NOT be read as one.
    for (const literal of [
      'box-shadow: 0 0 2px #ff0000;',
      'background: #abcdef;',
      // Upper case and the short forms: the `i` flags and `{3,8}` are each a
      // mutation this list must go red for (#667's re-review).
      'background: #ABCD;',
      'color: #abc;',
      'outline: 2px solid rgb(0 0 0);',
      'outline: 2px solid RGB(0 0 0);',
      'border-color: oklch(70% 0.1 200);',
      'color: color-mix(in srgb, var(--oyl-color-ink), white);',
      'text-decoration-color: Red;',
      'box-shadow: inset 0 0 0 1px hsl(0 0% 0% / 50%);',
    ]) {
      expect(colourLiteralsIn(`a {\n  ${literal}\n}`), literal).toHaveLength(1);
    }
    for (const token of [
      'background: var(--oyl-color-surface);',
      'border: 2px solid var(--oyl-color-accent);',
      'color: currentColor;',
      'background: transparent;',
      'color: inherit;',
      'forced-color-adjust: none;',
      'border-color: ButtonText;',
      'display: inline-flex;',
      'cursor: pointer;',
      'appearance: base-select;',
      'padding: var(--oyl-space-sm) var(--oyl-space-md);',
    ]) {
      expect(colourLiteralsIn(`a {\n  ${token}\n}`), token).toEqual([]);
    }
  });

  it("lets a class on a file input set its size, which a bare `input[type='file']` did not", () => {
    // #667's review: `input[type='file'] { font: inherit }` is (0,1,1) and beat
    // `.oyl-input--file { font-size }` (0,1,0) wherever it sat in the file, so
    // Transfer's two file inputs ignored their class. Held at `:where()`, the
    // element rule has no specificity and any class wins.
    const sized = rulesMentioning(themeCss, '.oyl-input--file').filter(
      ({ selector }) => selector === '.oyl-input--file',
    );
    expect(sized).toHaveLength(1);
    expect(declarationsOf(`\n${sized[0]?.body ?? ''}`).get('font-size')).toMatch(
      /^var\(--oyl-font-size-[a-z]+\)$/,
    );
    const fontRules = rulesMentioning(themeCss, "input[type='file']").filter(
      ({ selector, body }) =>
        !selector.includes('::file-selector-button') &&
        /(?:^|[\s;])font(?:-[a-z]+)?\s*:/.test(body),
    );
    expect(fontRules.length, 'no rule sets a file input’s font').toBeGreaterThan(0);
    for (const { selector } of fontRules) {
      for (const one of selector.split(',').map((part) => part.trim())) {
        expect(one, 'a file input font rule that outranks a class').toMatch(/^:where\(.*\)$/);
      }
    }
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

/**
 * #672: what is drawn over the world or a camera's picture — and the pairing
 * code a phone's camera has to read — does not change with the page's palette.
 *
 * Found by building the dark palette: `ink` was the backdrop of the ride stage
 * and of every camera picture, and `canvas`/`ink` were the pairing code's paper
 * and modules. The dark palette swaps those two, which would have put a
 * near-white box behind the world and drawn the code light on dark. Each rule
 * below now paints with a HUD token, which the dark block does not redeclare.
 */
describe('what sits over a picture is the same in both palettes (#672)', () => {
  it.each([
    ['.oyl-game__world', 'background'],
    ['.oyl-game--riding', 'background'],
    ['.oyl-framing__picture', 'background'],
    ['.oyl-scan-viewfinder__video', 'background'],
    ['.oyl-framing__guide *', 'stroke'],
    ['.oyl-pairing-code__paper', 'fill'],
    ['.oyl-pairing-code__ink', 'fill'],
  ])('`%s` paints its %s with a HUD token', (selector, property) => {
    const css = themeCss.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    const escaped = selector.replaceAll(/[()[\]:.,*+?^$|\\]/g, '\\$&');
    const bodies = [...css.matchAll(new RegExp(`\\n${escaped} \\{([^}]*)\\}`, 'g'))].map(
      (match) => match[1] ?? '',
    );
    expect(bodies, `theme.css has no \`${selector}\` rule`).toHaveLength(1);
    const value = new RegExp(`\\n\\s*${property}:\\s*([^;]+);`).exec(bodies[0] ?? '')?.[1];
    expect(value).toMatch(/^var\(--oyl-color-hud-[a-z-]+\)$/);
  });
});
