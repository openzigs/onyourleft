# The accessibility gate

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4e, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you add or change a route, a view, a design token, a contrast pair, or a `*.a11y.test.*` file.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4e. The accessibility gate

Added by [#48](https://github.com/openzigs/onyourleft/issues/48), whose fourth acceptance criterion
is that *automated accessibility checks run on every route in CI and fail the build on a violation*.
It lives in [`apps/web/src/a11y/`](../../apps/web/src/a11y/) and it is **the one gate in this repository
with a real pass/fail line in it** — coverage deliberately has none (§5), and this one is not a
percentage.

| File | What it decides |
|---|---|
| `audit.ts` | sixteen structural rules over a rendered DOM (it said fourteen until #394 and fifteen until #660; `table-in-scroll-region` is the sixteenth — every table the child of a focusable, named scroll region, `design/ScrollTable.tsx`, because SC 1.4.10 lets a table keep its columns on a phone only there — count `ACCESSIBILITY_RULES` rather than this cell; since #690 `landmarks-are-distinguishable` reads a declared landmark `role` as well as the tag, so two `ScrollTable`s captioned alike fail) — an unnamed control, a control not in the tab order, a broken heading order, a dangling ARIA reference, a positive `tabindex`, and so on. `tabbableElements` is the tab-order model the keyboard tests rest on. ⚠️ Since #950 (ADR 0042 D-7) a document with an open modal — a `dialog` or `alertdialog` saying `aria-modal="true"` — is audited AS that dialog (`openModal`): the page behind is Radix's `aria-hidden` and out of the trap's reach, and its one-`main`/one-`h1`/outline-from-`h1` rules were met with the dialog closed |
| `audit.a11y.test.ts` | a violating fixture for **every** rule, plus an assertion that every rule in `ACCESSIBILITY_RULES` has one. A rule added without a failing fixture fails the build |
| `route-sentences.a11y.test.tsx` | [#666](https://github.com/openzigs/onyourleft/issues/666)'s "nothing is deleted": every sentence every route rendered on `main`, over both walk fixtures and with a store behind Files, is recorded in `route-sentences.snapshot.json` and must still render on the same route, visible or tucked. ⚠️ The record is READ unless `OYL_RECORD_ROUTE_SENTENCES=1`; a reworded sentence is changed in the record in the same commit, where a reviewer sees both. ⚠️ **Since [#746](https://github.com/openzigs/onyourleft/issues/746) the record must EQUAL what the recorder would write**, and the two share one collection (the list, plus the selected item on a list–detail route): a sentence ADDED to a route is red until the record is re-taken with that variable, and the diff is where a dropped line shows |
| `kept-visible.a11y.test.tsx` | #666's other half: each view's `*_KEPT_VISIBLE` sentences — trainer control, what leaves the device, what an erase cannot reach, the camera and anyone else in the room, Web Bluetooth's limits — mapped from a `Record` over `RouteId`, must be on their route with no closed `<details>` above them; and nothing marked `data-oyl-kept-visible` may be tucked on any route |
| `routes.a11y.test.tsx` | renders every entry in `shell/routes.ts` and audits it. A route added to the table is audited without anyone editing this file |
| `contrast.a11y.test.ts` | WCAG 2.2 AA contrast for every declared token pair, and that every token appears in a pair |
| `theme.a11y.test.ts` | that `theme.css` carries the same values as `design/tokens.ts`, in both directions. Since #950 a token counts as painted when a `tw:` utility the source uses reads it, as well as a rule here |
| `tailwind.a11y.test.ts` | since [#950](https://github.com/openzigs/onyourleft/issues/950) (ADR 0042 D-5): `tailwind.css`'s `@theme` equals the tokens both ways; the CSS Tailwind's own scanner and compiler build from the source holds no colour literal, `color-mix()`, duration, easing or undeclared `var()`, no colour written in the `(--custom-property)` shorthand (which the pair check cannot read — #950's review), no partial `opacity`, `filter` or blend, and no arbitrary `[…]` made a rule; every `tw:` class generates CSS; an ink and a surface set in one class list are a declared `CONTRAST_REQUIREMENTS` pair; motion utilities are the motion tokens only; and no preflight, no layer, utilities loaded after `theme.css` on every page. `tailwind-shipped-testing.ts` is the build it reads |
| `index-html.a11y.test.ts` | `lang`, and that the viewport meta does not block zoom |
| `degradation.a11y.test.tsx` | that a chart which throws is replaced by its table and does not take the page with it |

⚠️ **An accessibility test file is named `*.a11y.test.{ts,tsx}`, and that name is what the gate
selects on** — `test:a11y` is `vitest run --project web .a11y.test.`. Until
[#142](https://github.com/openzigs/onyourleft/issues/142) the filter was the *directory* name, which
failed closed against deleting `apps/web/src/a11y/` and **open** against renaming it: renaming to
`src/accessibility/` dropped `audit.test.ts` and the step stayed green with 6 files and 61 tests
instead of 7 and 101. A filename cannot be moved out of the gate by a directory rename, and a new
file that carries the convention is picked up with no CI edit.

`scripts/check-a11y-suite.mjs` closes what the convention alone cannot: a test file inside a
directory named `a11y` or `accessibility` that does **not** carry the convention fails the build,
rather than sitting silently outside the gate. It takes the selector out of `package.json` and asks
`vitest list` which files it picks, so the check and the gate cannot drift apart; a `test:a11y` it
cannot parse is a failure, not a pass. Run it with `pnpm run check:a11y-suite`, and its own suite
with `bash scripts/check-a11y-suite.test.sh`.

⚠️ **Two of its four rules look like each other and are not**, which #155 raised as a rule that
could not fire. **It can** — the two catch different things and the suite now isolates each:

- *A test inside an `a11y`/`accessibility` directory that lacks the convention* is **rule 3**, and
  it is what catches #142's own regression. Renaming the directory leaves the old filter matching
  the *filename*, so the conventional files stay selected and only the non-conventional one is
  silently dropped — rule 3 is the one that notices.
- *A selected file that lacks the convention* is **rule 2**, and it catches a filter broadened the
  other way, past the convention, pulling in tests that are not accessibility tests at all. Rule 3
  cannot see that, because the file is outside any accessibility directory.

The confusion was reasonable: the pre-existing fixture for rule 2 put its file *inside* `src/a11y/`,
where rule 3 also fires, so deleting rule 2 left the case red anyway and the rule looked redundant.
A fixture outside such a directory isolates it, and deleting rule 2 now turns that case green.

**There is no `axe-core` and adding one is a decision, not a tidy-up.** It is MPL-2.0, which §3
records as *not ruled on yet* and [#24](https://github.com/openzigs/onyourleft/issues/24)'s to
decide; and its highest-value rule — colour contrast — is inert under a headless DOM, because jsdom
performs no layout and resolves no custom property. That is why contrast is checked at the tokens
instead.

⚠️ **The suite loads no stylesheet, so an element hidden by CSS alone looks focusable to
`tabbableElements`.** The shell therefore hides nothing that way: the skip link is moved off-screen
with a `transform` and stays focusable. Hiding a control with `display: none` in a stylesheet would
make this checker wrong rather than make the control safe.

⚠️ **jsdom updates `location.hash` when a fragment link is clicked and then does not fire
`hashchange`**, which the HTML standard requires and every browser does. `testing/mount.tsx`
supplies the missing event. Do not "fix" that by making the router set the hash itself in a click
handler — that would be changing shipping behaviour to suit a test double, and it costs the
browser's own middle-click and open-in-new-tab handling.
