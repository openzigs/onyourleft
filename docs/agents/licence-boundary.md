# The licence boundary, in full

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds §3 beyond its two-line rule, and §3a on `.spdx-exempt`, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you add or bump a dependency, add a file type, touch `.spdx-exempt`, or wonder whether a licence is admitted.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


## 3. The licence boundary is a path — the detail

The boundary *is* the directory, so it is checkable by path rather than by reading manifests. This is
**stricter than [ADR 0001](../adr/0001-licence.md) requires** — ADR 0001 permits per-package
declaration — and the extra strictness is deliberate: a path rule cannot be silently mis-declared the
way a manifest field can.

Belt **and** braces, not one instead of the other. Each package still carries:

- its own `LICENSE` file, **and**
- `"license"` in its manifest matching its path.

What this means in practice:

- A **GPL or AGPL dependency anywhere under `packages/`** fails CI. If a package needs one, the code
  moves to `apps/` or the dependency is replaced. There is no third option and no exemption.
- **Permissive** dependencies (MIT, BSD-2/3, Apache-2.0, ISC) are fine anywhere.
- **Weak, file-level copyleft (MPL-2.0) and permissive licences the list above does not name** —
  `BlueOak-1.0.0`, `CC0-1.0`, `MIT-0`, `0BSD` and, since
  [ADR 0016](../adr/0016-unlicense.md), `Unlicense` — **are now ruled on, by
  [ADR 0015](../adr/0015-dependency-licences.md) D-2**, which discharges the deferral this bullet
  used to carry. They are admitted **in the build-time-only closure under either path**, and in a
  distributed closure **under `apps/` only** — an Apache-2.0 leaf package exists to be droppable
  into someone else's project, and a shipped MPL-2.0 file carries obligations its own `LICENSE`
  does not describe. Six such packages are in the tree as build-time devDependencies. Read on
  2026-09-05 from `pnpm licenses list --json`: `lightningcss` and `lightningcss-darwin-arm64`
  (MPL-2.0), `lru-cache` and `minimatch` (BlueOak-1.0.0), `mdn-data` (CC0-1.0), and
  `@csstools/color-helpers` and `@csstools/css-syntax-patches-for-csstree` (MIT-0). Two more
  arrived with #87's Capacitor install and are the reason ADR 0016 exists: `bplist-parser` and
  `bplist-creator` (`Unlicense`), reached from `@capacitor/cli` through `xcode` and `simple-plist`,
  build-time under `apps/mobile` and in no distributed closure at all. **All of the first six
  reach `packages/*` through Vitest**, not only `apps/web`: an allowlist written against "the MPL
  one is under `apps/`" would scope itself to the wrong tree and pass vacuously — which is exactly
  why ADR 0015 splits on the closure rather than the path alone. Enforced by `DEP001`; verify with
  `pnpm run check:licences` rather than from this paragraph, which ages.
- ⚠️ **An "it lands under `apps/`" argument is checked with `pnpm why <pkg> --recursive`, and a
  clean `require.resolve` probe is not evidence of anything** — why, and what each probe answers, is
  in [`docs/agents/licence-gates.md`](licence-gates.md).
- **`OFL-1.1` is admitted for a committed FONT FILE under `apps/` and for nothing else**, since
  [ADR 0043](../adr/0043-ofl-display-typeface.md) (#991): not a picture, not a file under
  `packages/`, not a dependency (`DEP001` is unchanged, so a font *package* is still refused), and
  not `OFL-1.1-RFN`. Enforced by `ASSET004`. A subset stays `OFL-1.1` in `ASSETS.toml` — the font
  keeps its licence, as a CC0 model does.
- Anything **non-OSI** — BUSL, SSPL, CC-BY-NC, "commercial use requires a licence" — fails
  everywhere and needs an ADR before it is even discussed.
- Where a change lands is therefore a **licence question answered before you write the code**, not a
  taste question settled in review.

`LIC001` and `LIC002` scan `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.sh` and — since
[#87](https://github.com/openzigs/onyourleft/issues/87) — `.kt`, `.kts`, `.java`, `.gradle` and
`.xml`, and — since [#430](https://github.com/openzigs/onyourleft/issues/430) — `.py`, because the
realistic world's Blender scripts live under `apps/` (ADR 0026 D-5) and a Python file there passed
with no header at all. The identifier may sit anywhere in the first **five** lines, not only the first, because a
shebang and an XML declaration both legitimately precede it. An `AndroidManifest.xml` therefore
carries `<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->` on line 2.

### 3a. `.spdx-exempt` — the one way out, and why it cannot become a blanket

Some files under `apps/` are **not ours**: `cap add android` writes about twenty of them from
`@capacitor/cli`'s MIT template, launcher artwork included. Stamping `AGPL-3.0-or-later` on those
would be a *worse* misdeclaration than leaving them bare — it claims authorship we do not have, and
it displaces the notice MIT requires to travel with the work. So they are exempt, and the exemption
is a file: [`.spdx-exempt`](../../.spdx-exempt) at the repository root, one repository-relative path per
line.

⚠️ **The list is the classic vacuous pass, so `LIC006` is what stops it being one.** An entry is
rejected when it names a file that is not there, names a **directory**, is absolute or contains
`..`, or uses **glob syntax**. Exact paths only. Three consequences, all of them the point:

- A generator that writes a file under a **new** name lands *outside* the list and fails
  `LIC001`/`LIC002` until somebody reads it. The list fails closed.
- A **stale** entry — the file was deleted or renamed — is a violation rather than a line nobody
  notices. An exemption that has stopped meaning something stops the build.
- You cannot exempt a tree, or a file you have not written yet.

**The one reason to be on that list is "verbatim output of a third-party generator, whose own
licence notice we reproduce instead".** `apps/mobile/README.md` §2 reproduces Capacitor's. "The
header is awkward here" is not a reason: a file this repository authors *or edits* carries the
header, which is why five of the twenty `cap add` wrote are deliberately absent from the list —
`res/values/styles.xml` since #672, which paints the launch window and the window behind the
WebView in the page's canvas colour.

⚠️ Three Capacitor trees are **pruned rather than exempted** — the copied web build under
`android/app/src/main/assets/public`, `android/app/src/main/res/xml/config.xml`, and
`android/capacitor-cordova-android-plugins/`. `cap sync` regenerates all three and Capacitor's own
nested `.gitignore` keeps them out of the repository, so they are absent from a clean clone and an
`.spdx-exempt` entry naming one would be a `LIC006` violation. `.prettierignore` carries the same
three plus two generated JSON assets, because **Prettier reads only the root `.gitignore`, not a
nested one** — without it `format:check` reports a minified bundle on any machine where a sync has
run, which is a local-only red with no fix a contributor can apply.
