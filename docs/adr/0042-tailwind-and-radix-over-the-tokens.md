# ADR 0042: Tailwind CSS v4 and Radix Primitives for the menus, over the existing tokens

- **Status**: Accepted
- **Date**: 2026-09-30
- **Deciders**: **the owner, on adopting Tailwind and Radix** — the ruling on
  [#935](https://github.com/openzigs/onyourleft/issues/935) of 2026-09-30, quoted in Context. The
  author wrote the engineering rules (D-2 to D-8) from that ruling and from
  [#950](https://github.com/openzigs/onyourleft/issues/950)'s own text
- **Issue**: [#950](https://github.com/openzigs/onyourleft/issues/950), parent epic
  [#935](https://github.com/openzigs/onyourleft/issues/935)
- **Number**: **0042**, read from [`docs/architecture.md`](../architecture.md)'s ownership table —
  the check `CLAUDE.md` §7 asks for — on 2026-09-30, and checked against every open pull request's
  files: none adds an ADR above 0041
- **Amends**: [ADR 0005](0005-tech-stack.md)'s stack table (E, the web client), by the appended
  amendment there. **Required by**: [ADR 0034](0034-lucide-icons.md) D-5, which admits
  `lucide-react` and no other runtime UI dependency, and says another needs its own ADR and must
  arrive in a lazily loaded chunk. This is that ADR for Radix
- **Supersedes**: nothing

## Context

### What the owner ruled

> **Owner decision, 2026-09-30:** "I am not happy with the current look. Just make the changes." The
> redesign adopts **Tailwind CSS v4 and Radix Primitives** (#950), built over the existing tokens so
> the contrast and accessibility gates keep working, with **Motion** for animation (D-2). #950 comes
> after #936 and before the screen issues #939 to #944, which are built with it.

— owner, on #935, 2026-09-30. The epic's research had recommended the opposite for the look ("the
owner's fallback (Tailwind CSS with Radix) is **not taken**: it would replace the token system and
theme.css that the contrast and accessibility gates are built on"); the owner overruled it, on the
condition #950 states:

> `src/design/tokens.ts` stays the one place a colour, space, radius, type or motion value is
> defined. […] Tailwind v4 reads those tokens through its CSS-variable `@theme` […]. So every
> utility colour is a token, and **`contrast.a11y.test.ts` and `theme.a11y.test.ts` keep gating it
> in both palettes**. […] Radix Primitives are used for behaviour and accessibility only.

So the question this ADR answers is not *whether* — the owner decided that — but **how two libraries
come in without becoming a second, ungated way to paint the screen**.

### What was read and measured, 2026-09-30

- **`tailwindcss` 4.3.3** and **`@tailwindcss/vite` 4.3.3**, MIT, published 2026-07-16 (`npm view`).
  Build-time only: the plugin compiles utilities into the one stylesheet, and no Tailwind code runs
  in the app. Their closure adds `@tailwindcss/node`, `@tailwindcss/oxide` (a native scanner, shipped
  as per-platform optional packages with no install script), `lightningcss` 1.33.0 (MPL-2.0, already
  admitted build-time by ADR 0015 D-2), `jiti`, `enhanced-resolve` and `magic-string`, all MIT.
  `check:licences` passes.
- **`@radix-ui/react-alert-dialog` 1.1.23**, MIT, published 2026-07-24. Its closure is sixteen
  `@radix-ui/*` packages, `react-remove-scroll` and its three helpers, `aria-hidden`, `get-nonce`,
  `detect-node-es` and `use-callback-ref`, all MIT, and `tslib` (0BSD, already in the closure).
  ⚠️ Radix declares `@types/react` and `@types/react-dom` as optional peers, so `pnpm licenses list
  --prod` also lists them and `csstype` (all MIT): they are TYPES, no byte of them is in `dist`, and
  the third-party notices credit them anyway, because the notices are generated from that closure and
  a notice for code that does not ship costs nothing, where a filter that guessed wrong would drop one
  that does. One of
  them, `react-remove-scroll-bar` 2.3.8, ships no licence file; its reviewed entry in
  `apps/web/third-party-notices.json` quotes its README and the author's own MIT `LICENSE` from the
  repository. `check:notices` passes with the notices regenerated.
- **Cost** (`pnpm run build`, before and after, raw / gzip):

  | Chunk | Before | After | Change |
  |---|--:|--:|--:|
  | the stylesheet, `index-*.css` (every route) | 39.65 / 7.14 kB | 41.06 / 7.55 kB | **+1.41 / +0.41 kB** |
  | the entry, `index-*.js` (Home) | 513.89 / 168.10 kB | 513.93 / 168.10 kB | +0.04 / 0 kB |
  | History group (`history-*.js`: Activities, a ride, Analysis, Segments) | 73.25 / 21.18 kB | 114.03 / 34.31 kB | **+40.78 / +13.13 kB** |
  | every other group | | | under +1.2 kB raw each |

  The History group carries Radix, because Activities is where the one dialog is. With no `tw:` class
  written, the stylesheet was byte-identical to `main`'s — the build emitted the same file hash — so
  the 1.41 kB is exactly the utilities the source uses.

## Decision

### D-1 — `tailwindcss` and `@tailwindcss/vite` are admitted as build-time dependencies of `apps/web`

Pinned exactly (`CLAUDE.md` §8), devDependencies, and in both Vite configs — the product's and the
browser gate's harness build — so a primitive drawn with utilities is drawn the same way in the gate
as in the app. `@tailwindcss/node` and `@tailwindcss/oxide` are pinned beside them as
devDependencies, at the same version, because `a11y/tailwind.a11y.test.ts` runs Tailwind's own
scanner and compiler (D-4).

### D-2 — The theme is the tokens, and Tailwind's own theme is cleared

`apps/web/src/design/tailwind.css` holds one `@theme inline` block. It opens with `--*: initial`,
which removes Tailwind's default palette, spacing scale, type scale, radii, shadows, breakpoints and
curves. It then names **every colour, space and type token**, each as the `var(--oyl-…)` that
`theme.css` declares, plus the radius and the motion defaults. It defines no value of its own except
`--spacing-0: 0px`, the one length nobody chooses.

So `tw:bg-accent` paints `var(--oyl-color-accent)`. The dark palette re-points that property and the
HUD's light pin restates it, so a utility follows both with no work. `tw:bg-red-500`, `tw:p-4`,
`tw:shadow` and `tw:rounded-lg` generate nothing. `tokens.ts` is still the one place a value is
written, and `theme.css` is still where the browser reads it.

### D-3 — Every utility carries the `tw:` prefix

`prefix(tw)`. Tailwind scans source text, not markup, so without a prefix every word in a comment or
a sentence that happens to be a utility name (`table`, `hidden`, `ring`, `outline`, `transition`)
was built into the stylesheet: measured, 5.4 kB of rules nothing used, one of them `.outline`. With
the prefix a Tailwind class can never be confused with prose, with an `oyl-` class, or with a word,
and the stylesheet holds only what the source writes.

### D-4 — No preflight, and no layer: `theme.css` stays the base

Tailwind's preflight is **not imported**. The base rules of `theme.css` stay the base, unchanged:
the link states (#661), the three kinds of button (#668), the one focus ring, the form controls and
the `base-select` picker (#667). So nothing that `links.browser.spec.ts`,
`button-hierarchy.browser.spec.ts` or `shell.browser.spec.ts` holds can drift under a reset.

The utilities are written with a bare `@tailwind utilities`, **not in `@layer utilities`**: an
unlayered rule in `theme.css` beats any layered rule, whatever its specificity, so a layered `mb-md`
would lose to a `p` margin written there. Unlayered, and loaded after `theme.css` (`main.tsx` and
every harness page, in that order), a utility wins against a `theme.css` rule of equal specificity
by order. A more specific rule there still wins, which is what `.oyl-ride__heading > .oyl-status`
and the HUD's notice cell were written for.

`@source` names the client's own `src/**/*.{ts,tsx}`, less tests and test support, and
`source(none)` turns off Tailwind's walk of the whole directory.

### D-5 — What ships is gated, not trusted

`apps/web/src/a11y/tailwind.a11y.test.ts`, in `test:a11y`, reads what Tailwind reads and holds what
it would ship:

1. **The `@theme` equals the tokens**, in both directions.
2. **The compiled CSS names no value of its own.** It is built by Tailwind's own scanner and
   compiler, so it is what a build writes. It may hold no colour literal, no `color-mix()` (an
   opacity modifier such as `tw:bg-ink/40` makes a colour no pair measures), no duration, no easing
   curve, and no `var()` that `theme.css` does not declare. **No arbitrary value (`[…]`) may produce
   a rule**, so `tw:bg-[#123456]` fails the build wherever it is written. **No colour may be written
   in the `(--custom-property)` shorthand** (`tw:text-(--oyl-color-illo-sun)`): it compiles to a
   token's `var()` and escapes `(` rather than `[`, so it passed every other check while its pair was
   read by nobody — found in this ADR's review. A `var(--tw-*)` is exempt only where Tailwind itself
   wrote it, not where the source's class names one. And **no partial `opacity`** (only 0 and 100),
   **no `filter`, `backdrop-filter` or blend mode** may ship: `tw:opacity-40` is a bare-value utility
   that clearing the theme does not remove, and like `bg-ink/40` it changes the contrast of every
   pair beneath it.
3. **Every `tw:` class the source writes generates CSS**, so a typo or a class outside the theme is
   not a silent no-op.
4. **The contrast gate reads a Tailwind colour.** Where one class list sets an ink and a surface for
   the same state (`tw:text-warning-ink tw:bg-warning-surface`, or a `hover:` pair), the pair must
   be one `tokens.ts` §`CONTRAST_REQUIREMENTS` declares. `contrast.a11y.test.ts` then measures it in
   both palettes, as it does every pair.
5. **Motion comes from the motion tokens** (ADR 0041 D-5, and #951's review on this issue): only
   `duration-short`, `duration-medium` and `ease-standard`. A numeric `duration-*`, and any `delay-*`
   or `animate-*`, fails. A bare `tw:transition-colors` takes `--default-transition-duration`, which
   D-2 sets to the short token, and `theme.css`'s reduced-motion block collapses it like every other
   transition.

`theme.a11y.test.ts`'s "every token is painted" counts a token as painted when a utility the source
actually uses reads it, not merely when the `@theme` maps it.

### D-6 — Radix Primitives are admitted for behaviour, one package at a time, lazily

A Radix primitive is admitted for a control whose accessibility is **behaviour** rather than markup,
where a hand-written version would have to re-implement that behaviour. Each package is installed by
the issue that first uses it, pinned exactly, with `check:licences` and `check:notices` re-run. It
is styled with the token utilities (D-2) or `theme.css` and carries no colour of its own.

**Nothing in the entry chunk may import one.** ADR 0034 D-5 requires this, and it is now enforced
at build time: `tools/bundle/entry-graph.ts` §`LAZY_ONLY_PACKAGES` fails `pnpm run build` when an
`@radix-ui/` module is in the entry's static graph. This was measured by importing the dialog into
Home: the build failed and named three Radix modules.

This PR installs **one**: `@radix-ui/react-alert-dialog`, for `design/ConfirmDialog.tsx`, the
confirmation before a ride is deleted. The issue's list names Dialog. AlertDialog is Radix's Dialog
with the `alertdialog` role and a first focus on the way out, which the WAI-ARIA pattern for a
destructive confirmation asks for, and it depends on `@radix-ui/react-dialog` itself. The primitive:

- sets `aria-modal="true"`, which Radix does not, so a screen reader is told the page behind is
  inert;
- hands focus back to the control that opened it. Radix returns focus to its own `Trigger`, and
  with none it returns focus to nothing, which was measured as an Escape leaving focus on `body`.
  When the confirmed action removes that control, the caller names where focus goes instead;
- has its trap held twice: in jsdom by the keydown Radix's `FocusScope` handles
  (`ConfirmDialog.test.tsx`), and in Chromium with the real Tab key
  (`browser/confirm-dialog.browser.spec.ts`). The browser case has a control: the same presses with
  no dialog open must leave the list.

### D-7 — The audit reads an open modal as what a rider can reach

With the dialog open, `a11y/audit.ts` used to audit the whole document. There, Radix's
`aria-hidden` page and its two `tabindex="0"` focus guards read as a dozen
`aria-hidden-not-focusable` violations, and a dialog with no `main` or `h1` read as a broken page.
**Since #950 `auditAccessibility` audits the open modal instead** (`openModal`): a `dialog` or
`alertdialog` that says `aria-modal="true"` and is not hidden. That is what `aria-modal` tells a
screen reader, and what the focus trap (D-6) makes true for a keyboard. The page's own structure
rules (one `main`, one `h1`, an outline from `h1`) are skipped, because the page was audited with
the dialog closed. A heading level skipped inside the dialog is still a violation, and so is every
element-level rule. A dialog that traps focus without saying `aria-modal` is audited as part of the
page and fails there. `audit.a11y.test.ts` holds each of these.

### D-8 — Where the primitives land, and where Radix and utilities do not fit

| Primitive | What #950 did | Why |
|---|---|---|
| `StatusMessage` | its box and its four tones are token utilities; the glyph, the label and the disclosure stay in `theme.css` | the box is layout and palette, which is what utilities are for. Each tone's ink, surface and edge are one string, so D-5's pair check reads them. `oyl-status` and `oyl-status--<tone>` stay as the names other rules and the gates find a message by |
| `ScrollTable` | its region is `tw:relative tw:max-w-full tw:overflow-x-auto` | the whole of its style. The note on why `relative` is load-bearing (#683) moved with it |
| a delete confirmation | **new**: `ConfirmDialog`, Radix AlertDialog, token utilities | it replaces a hand-written equivalent: Activities' "press Delete, then Confirm delete on the same button", whose warning stood beside the list as a live region. The page is inert while it is open, so **it is never used on a ride-time screen** (`design/ride-time-controls.ts`). The Ride screen's stop confirmation stays the two buttons it is |
| `MoreAbout` | unchanged | it is a native `<details>`, which has no `theme.css` rule of its own to migrate. Radix Collapsible would unmount its content when closed, and `route-sentences.a11y.test.tsx`, the kept-visible gate and the audit's tab model (#665) all read a closed `<details>`' content as present and tucked |
| `Button`, the segmented control, `select` and the form controls | unchanged, in `theme.css` | their styles are pseudo-class state machines (`:hover:not(:disabled)`, `[aria-pressed='true']`, `:has(> input:checked)`, `::picker(select)`). Each state is a declared contrast pair, and a browser control removes that exact rule through the CSSOM (#688's hover, #667's `base-select`, #316's three-way measurement, #669's `.oyl-button--ride`). The segmented control is **native radios** (#667, #668), which Radix ToggleGroup would replace with buttons. The select is native with `base-select`, which the owner chose on #667. Moving any of them to utilities would rewrite each control and change nothing a rider sees. The screens #939 to #944 build compose them as they are |

The computed style of every element in `main`, on every route of the reflow harness, over both
datasets and both palettes (40 properties, 76 route renders), was dumped before and after the
migration. The two dumps are identical.

## Consequences

- **#939 to #944** build their screens with `tw:` utilities over the tokens and compose the existing
  primitives. Any colour they need is a token first, with its contrast pair (D-5.4).
- **The stylesheet** grows only by the utilities the source writes. The History chunk carries Radix,
  about 13 kB gzip, and loads only when a History route is opened.
- **`theme.css`'s header** no longer says "no CSS framework and no component library".
  **`CLAUDE.md`** and **`docs/architecture.md`** record the two libraries, the gate and the prefix.
- **ADR 0005**'s stack table gains an appended amendment. ADR 0034 D-5 stands: this ADR is the one
  it asks for.
- **A Dependabot bump of Tailwind** that changes what the compiler emits (a new default in a utility,
  a colour in `@property`) is caught by D-5.2 before it reaches a rider. A bump of a Radix package is
  a notices change like any other.

## What would make this ADR wrong

- **A utility turns out to need a value the tokens do not have**, and the answer given is an
  arbitrary value. The gate refuses it. The right answer is a token with its pair, and a wrong one
  would be loosening the gate.
- **Radix changes how it hides the page.** If it moves to `inert`, or drops its focus guards, D-7's
  reason changes. The audit still reads `aria-modal`, and the browser gate still presses Tab.
- **Tailwind removes `prefix()` or `@theme inline`.** D-2 and D-3 rest on both. The gate would fail
  first, because the compiled CSS would name Tailwind's own variables.
