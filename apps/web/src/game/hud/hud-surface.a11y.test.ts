// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD panel is opaque, and #241 is the change that could have made it not.
 *
 * ## Why this file exists at all
 *
 * #94's contrast criterion is the one **gated** accessibility criterion in this
 * repository: `test:a11y` fails the build on a violation, and `tokens.ts`
 * §`hudSurface` says in its own words why it is opaque — *"a translucent panel
 * over a scene whose colours change every metre cannot be checked, because
 * there is no second colour to check against"*.
 *
 * Until #241 there was nothing behind the HUD but a flat clear colour. There
 * now is: a ground, a sky and fog, all derived from the route and all different
 * on every route. **Making `hudSurface` translucent at any point after this
 * would silently void a gated criterion while the gate stayed green**, because
 * the accessibility suite renders into jsdom, which has no WebGL and no
 * compositing at all. The contrast walk would keep passing against a colour
 * that is no longer the colour behind the text.
 *
 * So the opacity is asserted rather than assumed, and it is asserted **inside
 * the gate** — the filename carries the `.a11y.test.` convention #142 made the
 * selector, so `test:a11y` picks it up and a violation fails the build.
 *
 * ## What it checks, and why three things rather than one
 *
 * A panel can become see-through in three independent ways and closing one of
 * them is not closing the others:
 *
 * 1. the **token** gains an alpha channel — `#10161ccc`, or an `rgba()`;
 * 2. the **stylesheet** stops using the token, or adds `opacity`;
 * 3. the stylesheet adds a `backdrop-filter`, which composites what is behind
 *    the panel into it without changing any colour at all.
 *
 * ⚠️ It reads the stylesheet as a **file**, for the reason
 * `a11y/theme.a11y.test.ts` gives: jsdom performs no layout and resolves no
 * custom property, so a computed style in this suite would be empty and the
 * check would pass over anything.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COLOUR_TOKENS } from '../../design/tokens';

const themeCss = readFileSync(
  fileURLToPath(new URL('../../design/theme.css', import.meta.url)),
  'utf8',
);

/**
 * The stylesheet with its comments removed.
 *
 * A commented-out rule is not a rule, and a selector named inside a prose
 * comment is not one either — `theme.css` has several. Stripping first means
 * {@link rulesFor} neither invents a rule from a comment nor misses one that
 * follows a comment containing a brace.
 */
const declarations = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The declarations inside **every** rule whose selector list names `selector`.
 *
 * ⚠️ **Every one of them, not the first.** This read used to take
 * `indexOf(selector + ' {')` and stop, which made a *later* `.oyl-hud` rule
 * invisible — and in CSS a later rule is the one that **wins**. Appending
 * `.oyl-hud { opacity: 0.5; backdrop-filter: blur(4px) }` to the end of
 * `theme.css` left the whole accessibility gate green: both of the things this
 * file exists to forbid, in force in the shipped stylesheet, unseen. A HUD
 * tweak at the bottom of the stylesheet, or inside a `@media` block, is exactly
 * how that arrives.
 *
 * The selector is matched as a whole token — followed by whitespace, a comma or
 * the brace — so `.oyl-hud__value {` is not a match and `.oyl-hud, .x {` is.
 * Declaration blocks do not nest, so the first `}` after the `{` ends one.
 */
function rulesFor(selector: string): readonly string[] {
  const blocks: string[] = [];
  const occurrences = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[,{])`,
    'g',
  );
  for (const match of declarations.matchAll(occurrences)) {
    const opened = declarations.indexOf('{', match.index);
    const closed = declarations.indexOf('}', opened);
    if (opened !== -1 && closed !== -1) {
      blocks.push(declarations.slice(opened + 1, closed));
    }
  }
  return blocks;
}

describe('the HUD panel a rider reads is opaque', () => {
  it('states its surface as a six-digit hex, which carries no alpha', () => {
    // `#10161c` is opaque by construction. `#10161ccc` and `rgba(…, .8)` are
    // the two spellings that would not be, and both fail this.
    expect(COLOUR_TOKENS.hudSurface).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('has a panel rule at all, so the three checks below are not vacuous', () => {
    // Every assertion after this one is over a list. A selector renamed away
    // would empty that list and make all three pass over nothing, which is the
    // one way a rule like this fails silently.
    expect(rulesFor('.oyl-hud').length).toBeGreaterThan(0);
  });

  it('paints the panel with that token and nothing else', () => {
    // A literal colour here would leave `contrast.a11y.test.ts` checking a
    // token the panel no longer uses — the same drift `theme.a11y.test.ts`
    // exists to stop, at the one selector where it would void a gate.
    //
    // Asserted over EVERY `.oyl-hud` rule rather than the one that happens to
    // be first: a later `background:` is the declaration that actually paints
    // the panel, so it is the one that has to name the token.
    const backgrounds = rulesFor('.oyl-hud').flatMap((block) => [
      ...block.matchAll(/background(?:-color)?:[^;]*/g),
    ]);

    expect(backgrounds.length).toBeGreaterThan(0);
    for (const [background] of backgrounds) {
      expect(background).toMatch(/var\(--oyl-color-hud-surface\)/);
    }
  });

  it('never dims the whole panel with opacity', () => {
    // `opacity` applies to the element and everything in it, so this would make
    // the world show through the panel *and* wash out the text, while every
    // colour token stayed exactly as the contrast suite reads it.
    for (const block of rulesFor('.oyl-hud')) {
      expect(block).not.toMatch(/\bopacity:/);
    }
  });

  it('never composites the world behind it into the panel', () => {
    // `backdrop-filter` needs no transparency in any colour to make the panel
    // depend on what is behind it, which is the dependency #94's criterion
    // cannot be checked under.
    for (const block of rulesFor('.oyl-hud')) {
      expect(block).not.toMatch(/\bbackdrop-filter:/);
    }
  });

  it('keeps the token the contrast pairs are written against', () => {
    // The pairs in `tokens.ts` name `hudSurface` as the background for four
    // foregrounds. Renaming or removing it would move those pairs somewhere
    // else without anybody deciding to.
    expect(themeCss).toContain(`--oyl-color-hud-surface: ${COLOUR_TOKENS.hudSurface};`);
  });
});
