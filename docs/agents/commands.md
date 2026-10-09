# Commands

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4 "Commands" and §4a, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you need a command beyond the handful in the root, want to know what a check prints or enforces (the rule tables: LIC, ADR, SPIKE, REL, XML, SH, ASSET, ENV, DOC, DEP), or the stack table.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

## 4. Commands

⚠️ Until #1170 the root's §4 opened with the paragraph below; the commands it introduces are the
code block that stayed in the root:

Every command, what it prints and what it enforces is [`docs/agents/commands.md`](commands.md) §4a — **read it
literally**: a command listed there has been run, and nothing else may be quoted as if it had. What
CI runs is [`docs/agents/ci.md`](ci.md) §4c. The ones nearly every change needs (Node 24 from `.nvmrc`,
pnpm 11 from `packageManager` through `corepack enable pnpm`):

**Read this section literally.** Commands are split into ones that work **today** and ones that do
not exist yet. A documented command nobody has run is the most expensive kind of wrong, because every
downstream issue's acceptance criteria depend on these.

### 4a. Works today — executed and observed to succeed on 2026-09-05

**Bare clone — bash and coreutils only, no install, no network:**

```bash
# Enforce the repository rules that are checkable by path.
# Exits 0 clean; exits 1 listing each violation by rule id.
bash scripts/check-repo-rules.sh

# Test the checker itself. Fixture-driven; 218 cases, printed by the run on
# 2026-09-29. ⚠️ This said 115 until #357, 168 until #416, 182 until #378,
# 195 until #493 and 206 until #864, and has been stale every single time somebody quoted it —
# the number is what the suite prints, so read the run rather than this line.
bash scripts/check-repo-rules.test.sh

# Verify the licence texts are byte-identical to the canonical ones, by
# reproducing the two SHA-256 digests recorded in docs/adr/0001-licence.md.
# The digests are read out of the ADR rather than duplicated in the script, and
# a required digest that is missing fails — checking nothing is not a pass.
bash scripts/check-licence-hashes.sh

# Test that checker. Fixture-driven; 16 cases.
bash scripts/check-licence-hashes.test.sh

# Every environment variable the code reads is listed in .env.example.
# Exits 1 naming the file and the variable. A missing .env.example also fails —
# a template that is not there documents nothing.
bash scripts/check-env-example.sh

# Test that checker. Fixture-driven; 23 cases on 2026-10-03 (22 until #1075's
# review added the `bash -e` case) — the count is what the run prints.
bash scripts/check-env-example.test.sh

# Every relative link in the documentation points at something. RELATIVE ONLY —
# an https:// target is not checked and must not be, because that needs the
# network and would turn a bare-clone gate into one that fails on an aeroplane.
# A dead external link is a real problem and is not this script's.
bash scripts/check-doc-links.sh

# Test that checker. Fixture-driven; 28 cases.
bash scripts/check-doc-links.test.sh

# Run several commands at once and fail if ANY of them fails (#651). Not a
# check: it is how CI runs the checks, in one of its steps — see §4c. Every
# line is labelled with its command as it arrives, each process is waited on by
# itself, and a failing command's whole output is printed again at the end.
# No commands at all is exit 2, not a pass. Bash only, so it runs on a bare
# clone, and any §4a command can be handed to it as a string:
bash scripts/run-concurrently.sh 'lint' 'pnpm run lint' 'typecheck' 'pnpm run typecheck'

# Its own suite. Fixture-driven; 29 cases, most of them a failure the runner
# must NOT swallow — in every position, ending before and after a success —
# plus a rendezvous that fails if the commands were quietly run one at a time.
bash scripts/run-concurrently.test.sh

# The same two digests, printed for reading by eye.
shasum -a 256 LICENSE LICENSES/Apache-2.0.txt
```

**The workspace — needs Node 24 and pnpm 11, and the first run needs the network.**
Executed in this order on a clean clone on 2026-09-03, from nothing installed to green:

```bash
# Node 24 "Krypton", read from .nvmrc so the runner and you cannot disagree.
# With nvm: `nvm install` then `nvm use`. Any other version manager is fine;
# what matters is that `node --version` reports v24.
nvm install && nvm use

# pnpm 11, from the `packageManager` field in package.json rather than a global
# install, so the version is the one the lockfile was written by. Corepack ships
# with Node. The first `pnpm` command after this downloads that exact version,
# and in an interactive terminal corepack asks before it does — answer yes, or
# set COREPACK_ENABLE_DOWNLOAD_PROMPT=0. CI sets neither because corepack does
# not prompt when CI=true.
corepack enable pnpm

# Install. --frozen-lockfile is what CI runs: it fails rather than quietly
# resolving something the committed lockfile does not describe.
pnpm install --frozen-lockfile

# Prettier. `format:check` reports and exits 1; `format` rewrites.
pnpm run format:check
pnpm run format

# ESLint 10 + typescript-eslint, type-aware. Also enforces the SPDX header and
# the package boundaries — see §3 and §4d.
pnpm run lint

# tsc --noEmit, per package, because each package is allowed a different
# platform surface. Runs the root config too.
pnpm run typecheck

# Vitest, run-once. Never `vitest` on its own: watch mode does not belong in a
# gate, and a watching process in an agent session never exits.
pnpm run test

# The same run with a coverage report. There is no percentage threshold and you
# must not add one — see §5. ⚠️ Since #852 it is NOT the whole suite: it
# `--exclude`s the heaviest files, which the next command runs, and — since
# #1076 — every `.a11y.test.` file, which `test:a11y` runs (so CI runs them
# once, not twice). The a11y exclude is a glob in SINGLE quotes, because the
# script goes through `sh`; `check:test-split` reads a whole single-quoted word.
pnpm run test:coverage

# The files `test:coverage` excludes, with NO coverage (#852): the #545
# near-field rides and the FIT decode fuzz, which V8's instrumentation slowed
# about three times. They gate exactly as before; the coverage report stops
# counting what they alone execute (§5). `pnpm run test` still runs everything.
# ⚠️ Since #866 CI runs this NIGHTLY (`.github/workflows/nightly.yml`), not in
# `Repository rules`, so a break in either file is found the next morning.
# ⚠️ Since #1076 it also runs `apps/web/src/game/realistic-textures.test.ts`,
# the opt-in realistic world's texture checks (the owner's ruling, 2026-10-03).
pnpm run test:uninstrumented

# What stops those lists coming apart (#852). Reads the scripts out of
# package.json, asks `vitest list` what the whole suite and each run selects,
# and fails on a file in NO run (CI would never run it) or in two. ⚠️ Since
# #1076 there are THREE runs — `test:coverage`, `test:uninstrumented` and
# `test:a11y` — and a reviewer who remembers "both halves" is reading the old
# file. ⚠️ An
# `--exclude` glob is matched against each Vitest PROJECT's root, not the
# repository's, which is why it compares selections rather than globs. Lists,
# runs no test: under a second.
pnpm run check:test-split

# Its own suite. Fixture-driven; 51 cases on 2026-10-03 (33 before #1076, 25 before #864, 32 before its review) — the count is what the
# run prints. Needs Node, so not in `check:repo`.
bash scripts/check-test-split.test.sh

# The accessibility gate (#48): every route in apps/web is rendered into a DOM
# and audited, and the design tokens are checked for WCAG 2.2 AA contrast. This
# is a SUBSET of `pnpm run test` — the same files, run under a name that says
# what broke. Unlike coverage it DOES gate: criterion 4 of #48 is that a
# violation fails the build. See §4e. ⚠️ Since #1076 it is the ONLY CI run of
# these files: `test:coverage` excludes them, so they are not in the report.
pnpm run test:a11y

# What proves that gate selects every accessibility test there is (#142). Runs
# `vitest list` with the same selector `test:a11y` uses — read out of
# package.json, never copied — and compares it against the files on disk. Needs
# Node and an install, so it is NOT part of `check:repo`.
pnpm run check:a11y-suite

# Its own suite. Fixture-driven; 27 cases. Needs Node, so also not in
# `check:repo`.
bash scripts/check-a11y-suite.test.sh

# The wiring gate (#278). Walks the module graph from the page Vite builds and
# reports what the client's own seams — apps/web/src/game/, apps/web/src/ride/
# and every *-port.ts — cannot reach. This is the gate for the defect every
# other one here is blind to: a correct, unit-tested, typechecked unit wired to
# nothing. Needs Node and an install (it parses with the TypeScript compiler's
# own parser), so it is NOT part of `check:repo`. See §4j.
pnpm run check:wiring

# Its own suite. Fixture-driven; the count is what the run prints and it ages —
# 115 as of #447, 86 as of #406, and the line below said 81 until then.
#
# ⚠️ Since #406 the fixture builder **reads `WATCHED_PREFIXES` out of the
# checker** rather than naming the directories itself, which is the move
# `check-a11y-suite.mjs` already makes about `test:a11y`'s selector. It used to
# `mkdir` the two by name, so adding a third prefix turned all 83 cases red at
# once — a prefix naming no directory is a hard failure, by design. The
# derivation is resolved once at the top and hard-fails if it reads nothing,
# because an `exit` inside a process substitution exits the subshell.
#
# 81 assertions over 36 throwaway trees before that, five of
# them #278's five defects taken from the tree as it actually was — and two of
# those green on purpose, because they are limits this gate states rather than
# findings it makes. Three more cover the two ways this gate could check nothing
# and say so cheerfully: a renamed watched directory, an empty watched set, and
# a reasonless `@unwired` on the one path that silences a whole file. ⚠️ Since
# #363 it also reproduces **#362** from the tree as it was — a trainer command
# nothing calls — and pins every entry of the trainer-command seam as
# load-bearing, because deleting one of the five used to leave the suite green.
bash scripts/check-wiring.test.sh

# The generated-artefact gate (#299). `cap sync` writes two files this
# repository commits -- apps/mobile/android/capacitor.settings.gradle and
# app/capacitor.build.gradle -- and pnpm's store path carries the PEER version
# as well as the package's own, so any Capacitor bump invalidates the first.
# This regenerates them with `cap update android` and fails if either changes.
# It runs `pnpm install --frozen-lockfile` itself first and treats a non-zero
# exit as its own failure, because `cap update` faithfully encodes whatever
# node_modules holds -- see §4k. Needs an install, so it is NOT part of
# `check:repo`. It does NOT need a build, and ⚠️ that is not obvious -- see §4k.
# About half a second.
pnpm run check:capacitor

# Its own suite. Fixture-driven; 53 assertions over 16 throwaway projects, two
# of them the drift that actually happened -- #276/#277's 8.5.1 path and #298's
# own artefact, each reproduced from the tree as it was. Needs Node and pnpm, so
# also not in `check:repo`.
bash scripts/check-capacitor-generated.test.sh

# The cost model (#54). Recomputes every figure in docs/cost-model.md from the
# inputs stated in docs/cost-model.md, and fails when the two disagree. The
# defect it catches is arithmetic that was true on the day somebody typed it, in
# a document whose inputs move -- two of them moved while it was being written.
# `--print` emits the tables the model computes, which is what to paste in after
# a rate is re-read rather than editing cells until the build goes green.
# Needs Node but no install; it is NOT part of `check:repo` all the same,
# because that is the bash-and-coreutils set. See section 4l.
pnpm run check:cost-model
node scripts/check-cost-model.mjs --print

# Its own suite. Fixture-driven; 51 assertions over throwaway documents, one per
# rule, plus the vacuous pass -- a document whose tables parse and are never
# compared against anything. Needs Node, so also not in `check:repo`.
bash scripts/check-cost-model.test.sh

# tsc --noEmit followed by `vite build`, for apps/web. A green typecheck is not
# a green build: the bundler resolves imports the typechecker only reads types
# from, so run this before claiming a change compiles.
pnpm run build

# The browser gate (#63). Builds `apps/web/` AND `apps/web/browser/` and drives
# them in a real headless Chromium through Playwright. ⚠️ **Two builds and two
# preview servers since #408**: an offline claim about the PRODUCT cannot be
# measured against the harness, so `playwright.config.ts` serves `dist` on 4320
# beside `browser/dist` on 4319. One CI job, because a second job reports under
# a different context and could not block a merge. ⚠️ Two Playwright PROJECTS
# since #651 — `chromium`, and `game` LAST — in one run and one browser; §4c
# says why the game spec is last and why it is not split further. ⚠️ Since
# #1128 they are TWO runs in this one command: `chromium` on three workers,
# then `game` alone, each with its own stop (§4c §"23m50s of 25 — #1128").
# A failed build ends it before either run. CI runs it under
# `timeout --verbose --kill-after=10s 765s` (§4c, `GATE_STEP_MS`).
# This is the ONLY place in the
# repository where a browser runs: jsdom implements no WebGL, so MapLibre
# cannot be constructed in the Vitest suite at all, and three things are
# checkable nowhere else — that MapLibre initialises against the style we
# build, that `addProtocol` takes effect in a real engine, and **which hosts
# the map actually contacts**. That last one is #63's third criterion in its
# literal form and the assertion `styleOrigins` cannot make, because a request
# a dependency issues on its own initiative is in no style at all.
#
# Since #266 it also runs the HUD page, which is here for a DIFFERENT reason
# than WebGL: jsdom performs no layout, so nothing in the Vitest suite can say
# whether a value fits its grid track. And since #408 it runs the PRODUCT with
# the network off, which is a third reason again: jsdom has no service worker,
# no Cache Storage and no network stack to switch off. See §4f.
#
# Needs the pinned browser present. In a container that already has one (
# `PLAYWRIGHT_BROWSERS_PATH` set, revision matching) it runs as-is; on a bare
# machine or a CI runner, install it first with the line below.
pnpm run test:browser

# ⚠️ Since #866 `test:browser` runs the `chromium` and `game` projects ONLY.
# The describes tagged `@nightly` — a reviewed list in
# `apps/web/browser/nightly.ts`: the opt-in realistic world, the reflow walk's
# DARK palette (#1076; its light twin stays here), and since #1137 four layout
# and motion describes of the default world (#941's card-shape margins, #1072's
# carry, #945's cross-fade, #1014's two-column sections; each one's
# accessibility or safety half stays here) —
# run in the `nightly` project, one worker, from `.github/workflows/nightly.yml`,
# which is NOT a required check. This is that run. On the runner, with #1137's
# four describes in it: 431 s of browser checks in an 8 m 47 s (527 s) nightly
# job on an EPYC 7763 (run 37288924707); the "about 1.3 minutes on a Mac" this
# line said predates #1076 and #1137 and is not re-measured.
# `nightly-split.test.ts` (in `pnpm run test`) fails a tag the list does not
# name and a test in both runs or in neither.
pnpm run test:browser:nightly

# The same gate with its HOSTED block turned on (#63). Renders the same harness
# page against a real PMTiles archive over the internet and prints #63's eighth
# measurement -- time to first painted tile on a cold cache. Unset, that block
# is SKIPPED and the gate is exactly what the line above runs: CI sets nothing,
# because a gate that needs somebody else's CDN fails on an aeroplane.
# ⚠️ Set but malformed is an ERROR rather than a skip.
# `apps/web/browser/hosted-archive.ts` argues the trade; the figures it produced
# on 2026-09-16 are in `docs/spikes/0004-cold-load-first-painted-tile.md`.
OYL_HOSTED_BASEMAP_URL=https://…/basemap.pmtiles pnpm run test:browser

# Fetch the browser the lockfile pins. @playwright/test 1.63.0 ships Chromium
# revision 1243 and this fetches exactly that, so the browser is as
# reproducible as the toolchain. ~170 MB, and `--with-deps` uses sudo to add
# the shared libraries a headless Chromium needs. Skip it where a matching
# browser is already installed.
pnpm --filter @onyourleft/web exec playwright install --with-deps chromium

# One package at a time, which is how you check a single package's harness.
# `@onyourleft/sensors`' and `@onyourleft/fit`'s typechecks each run TWO
# programs — see §4d — and both have to pass; the second is the one that
# enforces the platform boundary.
pnpm --filter @onyourleft/domain run test
pnpm --filter @onyourleft/fit run test
pnpm --filter @onyourleft/sensors run test
pnpm --filter @onyourleft/store run test
pnpm --filter @onyourleft/physics run test
pnpm --filter @onyourleft/web run test

# Re-cut the owner's brand art (#965): every app icon (web and Android), the
# favicon, the wordmark and the logo, from apps/web/tools/brand/sources/. NOT a
# gate and NOT in CI: it needs Python 3.14 with tools/brand/requirements.txt
# installed (any other version is refused); it fetches nothing. `--check`
# writes nothing and compares by KIND of file (the owner's ruling of
# 2026-10-07, #1167): the two lossless WebP logos BYTE FOR BYTE (libwebp 1.6.0
# writes the same bytes on macOS and Linux, so a Pillow bump that moves them is
# meant to go red: re-derive, read the diff, move the digests); the PNGs by
# DECODED PIXELS (Pillow's zlib differs between macOS and Linux, #972) AND with
# no chunk but IHDR/PLTE/tRNS/IDAT/IEND in the made or the committed file, so a
# colour profile, gamma or EXIF block (iCCP, gAMA, sRGB, cHRM, cICP, eXIf) is
# refused by name, and a file it cannot read or decode at all (a broken chunk
# frame, a damaged IDAT stream) is a printed reason, never a traceback (#1178's
# review). `--records` prints the ASSETS.toml rows. CI holds the
# committed pictures to the same chunk lists (`provenance.test.ts`). ⚠️
# `icons:generate` is gone: it drew the icons until #965. Run on 2026-10-07 on
# macOS, `--check` green.
<venv>/bin/python apps/web/tools/brand/derive_brand.py --check

# Its own tests (#1167), with the same interpreter: what `--check` refuses, each
# with a control, and (`test_make_webp_fixtures.py`) the lossy fixtures' chunk
# reader refusing a file that only looks like a WebP. NOT in CI, which has no
# Python with Pillow. 20 cases on 2026-10-07 (11 before #1178's review) — the
# count is what the run prints.
<venv>/bin/python -m unittest discover -s apps/web/tools/brand -p 'test_*.py'

# The WebP reader's fixtures (#1167): pictures drawn from arithmetic under
# apps/web/tools/brand/fixtures/, written by the same pinned Pillow. `--check`
# compares the lossless ones' bytes (the two lossy ones exist to be refused,
# and libwebp's lossy encoder promises no bytes across CPUs, so only their chunk
# layout); `--digests` prints Pillow's RGBA digests, which
# `webp-testing.test.ts` records.
<venv>/bin/python apps/web/tools/brand/make_webp_fixtures.py --check

# The realistic world's asset pipeline (#430, ADR 0026 D-5). NOT a gate and NOT
# in CI: it needs the network and Blender 4.4.3 (set BLENDER to its path; the
# default is the macOS app's), and it refuses any other Blender version.
# `realistic:fetch` downloads the upstream inputs into tools/realistic/build/
# (ignored) and fails unless every one matches inputs.lock.json; `--lock` re-bases
# on new inputs, which then moves every derived ASSETS.toml row. `realistic:process`
# re-makes apps/web/public/realistic/; with `--check` it writes nothing and fails
# unless every committed file is reproduced BYTE FOR BYTE — measured twice running
# on 2026-09-22. `--records` prints the ASSETS.toml entries the pipeline's own
# table produces. `realistic:stage` copies the owner's harness page into a built
# `dist` for a LOCAL debug APK (validation 0002 Part Z) — never a release.
# ⚠️ Since #618 it also needs KTX-Software's `ktx` at v4.4.2 exactly (KTX
# names it; the default is `ktx` on the PATH), a second pinned TOOL that makes
# every KTX2 texture, byte-stable, so `--check` still compares byte for byte.
# `apps/web/tools/realistic/sources.ts` §`PINNED_KTX` says how it was installed.
pnpm --filter @onyourleft/web run realistic:fetch
pnpm --filter @onyourleft/web run realistic:process --check
pnpm --filter @onyourleft/web run realistic:stage

# Regenerate the map's label glyphs (#578) from the committed Roboto v2.138.
# Deterministic, and `--check` writes nothing and fails unless every committed
# range is what it would write. The ordinary suite makes the same comparison
# (`tools/glyphs/generate-glyphs.test.ts`), so this is for after changing the
# generator or the ranges — then update the six ASSETS.toml digests with it.
pnpm --filter @onyourleft/web run glyphs:generate
pnpm --filter @onyourleft/web run glyphs:generate --check

# Subset the display face (#991, ADR 0043 D-5). NOT a gate and NOT in CI: it
# needs a Python with fontTools 4.66.1 and Brotli 1.2.0 exactly (FONTTOOLS_PYTHON
# names it; `tools/fonts/subset-fonts.ts`' header says how to make one), and
# refuses any other. `--check` writes nothing and fails unless the WOFF2s and
# `public/licences/OFL-1.1.txt` are reproduced byte for byte — run on
# 2026-10-02. In CI, `tools/fonts/fonts.test.ts` reads each WOFF2 back instead.
FONTTOOLS_PYTHON=… pnpm --filter @onyourleft/web run fonts:subset --check

# Regenerate the in-game wordmark (#966) from the owner's committed brand
# sheet, `tools/brand/sources/gemini-assets-v2.jpeg`: writes
# `src/game/brand/game-wordmark.png` (1024 × 128 RGBA) with its own baseline
# JPEG decoder and nothing else on the PATH. Deterministic — on a clean tree it
# leaves `git status` clean — and it has no `--check`: the ordinary suite makes
# that comparison pixel for pixel (`tools/brand/game-wordmark.test.ts`), which
# is the CI half. The realistic world's KTX2 of the same picture is
# `realistic:process`'s, not this command's. After changing the script, update
# the PNG's ASSETS.toml digest in the same commit.
pnpm --filter @onyourleft/web run wordmark:generate

# Regenerate the #29 synthetic FIT fixture corpus from its generator. It is
# DETERMINISTIC: running it on a clean tree leaves `git status` clean, which is
# what makes a corpus that is committed and generated the same corpus. It writes
# only under `packages/fit/fixtures/corpus`, and prints the byte budget it is
# inside. Run it after changing the generator, never to "fix" a failing test.
pnpm --filter @onyourleft/fit run fixtures:generate

# Build the six files #138 asks a person to upload to Strava and to a second
# platform: two synthetic rides — one outdoor, one indoor with no position at
# all — each as FIT, GPX and TCX. They are DECODED from the #29 corpus and
# RE-ENCODED by this package, because #138's criterion is about this package's
# output rather than about a fixture. Written to packages/fit/dist, which is
# gitignored: regenerate rather than commit. `docs/validation/0001-trainer-and-
# sensors.md` part C is where the results go, and it says which of the six is
# expected to be refused and why that is the finding rather than a bug.
pnpm --filter @onyourleft/fit run uploads:generate

# The dependency-licence gate (#24 part 2). Every dependency's OWN licence,
# checked against the path its package lands in -- the other half of the
# boundary check-repo-rules.sh performs on the code we write. Reads pnpm's own
# resolution of its own lockfile, so it needs an install and is NOT part of
# `check:repo`. About eight seconds. ADR 0015 classifies the licences; see
# also section 4g.
pnpm run check:licences

# Its own suite. Fixture-driven; 56 cases, every policy branch with a case that
# FAILS as well as one that passes. Needs Node, so also not in `check:repo`.
bash scripts/check-dependency-licences.test.sh

# The third-party notices gate (#664). Admitted is not the same as noticed: the
# check above decides which licences may ship, this one that their notices do.
# Runs its own `pnpm install --frozen-lockfile` (#298's reason, section 4k),
# regenerates apps/web/public/licences/third-party.txt and
# apps/web/src/credits/third-party-contents.txt from the union of every
# workspace package's distributed closure — every package but a SERVER, since
# #767 — and apps/instance/third-party.txt from the instance's own, and fails
# (NOT001-NOT008) when any committed file is not what it writes. About 2 s on a warm install locally and
# 4 s in CI, measured 2026-09-27 (this line said twenty until #676's review
# measured it). `notices:generate`
# is the same run with --write, and is how a dependency bump is repaired: run
# it, then READ the diff. See section 4g.
pnpm run check:notices
pnpm run notices:generate

# Its own suite. Fixture-driven, with a fake `pnpm` on PATH so the real
# union code is what runs; the count is what the run prints (133 on 2026-09-29,
# with #767's server cases; 96 on 2026-09-27; 68 before #676's review).
# Needs Node, so not in `check:repo`.
bash scripts/check-third-party-notices.test.sh

# What the APK links, from Gradle, written where
# apps/mobile/src/android/native-closure.test.ts reads it (#664). NOT a gate
# and NOT in CI: it needs a JDK and an Android SDK. Without its report that
# test skips loudly, naming this command; with a stale one it fails.
pnpm --filter @onyourleft/mobile run native:closure

# The instance server (#767), run on 2026-09-29. Its tests are the `instance`
# Vitest project, so `pnpm run test` and `test:coverage` already run them (and
# the coverage report lists `apps/instance/src`); these run the package alone.
# Every test that speaks HTTP does it through the real listener on a port the
# operating system chose.
pnpm --filter @onyourleft/instance run test
pnpm --filter @onyourleft/instance run typecheck

# The Durable Object adapter (#781) under a REAL workerd, run on 2026-09-29:
# the conformance script through the adapter under workerd, the tick as a real
# storage alarm that stops once an emptied race finishes, and a lobby evicted
# by the runtime itself (after ~10 s idle) and restored. It bundles
# src/room/durable-object/worker-under-test.ts with rolldown, runs the pinned
# `workerd` binary on 127.0.0.1 with SQLite storage in a temporary directory,
# and needs NO Cloudflare account, token or network. About 35 s, most of it
# waiting on the runtime's own clock. ⚠️ NOT in CI and NOT in `pnpm run test`
# (§4c): `vitest.config.ts` excludes `*.workerd.test.ts`, and
# `src/room/conformance.test.ts` runs there against the reference and the
# adapter under in-memory fakes, with its workerd block reported SKIPPED.
pnpm --filter @onyourleft/instance run test:workerd

# Start the instance on this machine, on 127.0.0.1:8787. ⚠️ It REFUSES to start
# without a commit or a source URL (AGPL-3.0 §13, ADR 0036 D-6), and — since
# #780 — against a database that is not migrated (run `operator migrate`
# below first; the default database is data/instance.sqlite). Accounts and
# rooms need OYL_INSTANCE_ORIGIN; every variable it reads is in .env.example.
# Ctrl-C (SIGTERM) closes every room socket 1001 and writes final results.
# Not a gate, and nothing runs it. Run on 2026-09-29.
OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)" pnpm --filter @onyourleft/instance start

# The operator's commands (#791), run on 2026-09-29 — the same ones the image
# runs (`node src/operator/cli.ts …`): `migrate` (the deploy's step; the
# server never migrates), `backup <dir> [--keep N] [--copy-to <dir>]` (an
# online VACUUM INTO and the blobs), `restore <snapshot> [--force]` (checked
# against the snapshot's manifest), `verify`, and `room-open <id> --kind
# ride|race --length <m>` (until #784/#785). They act on OYL_INSTANCE_DATABASE
# and OYL_INSTANCE_BLOBS. docs/operating-an-instance.md says what each does.
pnpm --filter @onyourleft/instance run operator migrate

# #807's tunnel measurement, from a machine that is NOT the box: two riders,
# one room, through the public hostname, for 30 minutes — every disconnect,
# every rejoin's time, the longest silence. `--idle-probe` measures the
# tunnel's idle timeout (with OYL_INSTANCE_PING_INTERVAL_MS=0 on the box for
# the run). NOT a gate: it needs the real tunnel. Run locally against the
# image for one minute on 2026-09-29 (no disconnect, 59 frames each).
pnpm --filter @onyourleft/instance run tunnel-soak --url https://… --room … --minutes 30

# Migrate an instance database file by hand (#769): `status`, `latest`, `up`
# (one) or `down` (one), each printing the applied migrations and every table's
# row count afterwards. ⚠️ `down` drops what the newest migration created, rows
# and all. Run on 2026-09-29 against a file holding three athletes' fixture rows.
pnpm --filter @onyourleft/instance run migrate <database file> status

# The blob store's conformance suite against a REAL S3-compatible bucket (#770).
# Unset, those cases SKIP loudly naming the five variables; CI sets none, so it
# is not a gate. Run on 2026-09-29 against SeaweedFS 4.48 with signatures
# enforced (and red with a wrong secret).
OYL_INSTANCE_S3_ENDPOINT=… OYL_INSTANCE_S3_BUCKET=… OYL_INSTANCE_S3_REGION=… \
  OYL_INSTANCE_S3_ACCESS_KEY_ID=… OYL_INSTANCE_S3_SECRET_ACCESS_KEY=… \
  pnpm --filter @onyourleft/instance run test

# Rewrite apps/instance/openapi.json from the route table (#36). The ONLY way
# that file changes: `src/openapi.test.ts` fails when it is not what this
# writes, so a route added without it is a red build. Read the diff after.
pnpm --filter @onyourleft/instance run openapi:generate

# Prove that moving text out of CLAUDE.md into docs/agents/ lost no line
# (AGENTDOC001): every non-blank line of the old file must be in the new set
# (the root CLAUDE.md and docs/agents/*.md) at least as often as it was, with
# Markdown link targets ignored because a moved link is retargeted. NOT a gate
# and NOT in `check:repo`: it needs the OLD file, which a shallow CI checkout
# does not hold, so it is run by hand for a move like 2026-10-05's split.
# Exits 1 naming each old line the new set lacks. Its suite: 8 cases.
git show <commit>:CLAUDE.md > /tmp/old-claude.md
bash scripts/check-agent-docs-conservation.sh /tmp/old-claude.md
bash scripts/check-agent-docs-conservation.test.sh

# Since #1170 the same check takes a whole previous TREE (its CLAUDE.md,
# docs/agents/ and area CLAUDE.md files), always counts the area CLAUDE.md files
# under apps/ and packages/ in the new set, and with --exact also fails a line
# the new set holds MORE often than before (copied rather than moved). #1170's
# own run, against main before it:
mkdir /tmp/old-agents && git archive <commit> CLAUDE.md docs/agents | tar -x -C /tmp/old-agents
bash scripts/check-agent-docs-conservation.sh --exact /tmp/old-agents

# All eight bare-clone script checks in one command.
pnpm run check:repo

# Render coverage per package as Markdown. Reads coverage/coverage-summary.json,
# so it runs AFTER `test:coverage`. Prints; never gates — see §5. Exits non-zero
# only when the report is missing or unparseable, because an empty table reads
# like good news.
node scripts/coverage-summary.mjs

# Its tests. Needs Node, so it is deliberately NOT in `check:repo`, which is the
# bare-clone set. 17 cases.
bash scripts/coverage-summary.test.sh
```

**Need a tool installed, or the network** — these work, but not on a bare clone:

```bash
# Requires shellcheck (brew install shellcheck / apt install shellcheck).
# Preinstalled on the standard Ubuntu runner, so CI runs it without installing
# anything — but the runner's shellcheck is older than a typical developer's
# (0.9.0 on ubuntu-24.04), and the two can disagree. CI prints its version.
shellcheck scripts/*.sh

# Requires npm and network access.
# Check whether typed linting has caught up with TypeScript 7 yet (see §8).
npm view typescript-eslint peerDependencies.typescript

# Requires Docker, and the network the first time (the base image is pulled by
# digest). Builds apps/instance/Dockerfile with the tree's commit — from the
# REPOSITORY ROOT since #780, installing the production closure from the
# lockfile inside the build, which needs the npm registry — runs the migrate
# step in the image (IMG006), waits for the image's OWN healthcheck to answer
# /health inside the container, requires /source to name that commit, and
# since #780 requires /ready to be `ready` (IMG007: the store opened, so its
# runtime dependencies are in the image). IMG001-IMG005: since #841 the base
# image must be pinned by digest (IMG005) and is pulled as its own step, so a
# Docker Hub that will not serve it is IMG004 -- the registry, named -- rather
# than an IMG001 that reads like a broken Dockerfile. ⚠️ Since #852 that is
# EVERY `FROM`, in any case, with options such as `--platform=` before the
# image; a stage naming an earlier stage, and `scratch`, are not base images.
# Until then it read the first line beginning `FROM` alone. A base image already
# on the machine is not pulled again. Removes the container and the image
# whatever happens. About 1 s with the base image cached and 2 s without on a
# developer's machine, and 10 to 15 s on the CI runner, measured 2026-09-29.
# In CI since #771 (§4c).
bash scripts/check-instance-image.sh

# Its own suite (#841). A fake `docker`, `curl` and `sleep` go first on PATH,
# the way check-third-party-notices.test.sh fakes `pnpm`, so it needs no Docker
# and waits for nothing; every IMG id has a case that goes red. 71 cases on
# 2026-09-29 (69 with #780 before #864's merge, 62 with #864 alone, 43 before #852) -- the count is what the run prints.
bash scripts/check-instance-image.test.sh

# The same image by hand. The commit is a REQUIRED build argument: the build
# fails without it, rather than an instance that cannot say which source it
# is. ⚠️ The context is the REPOSITORY ROOT since #780 (`-f`), and the server
# refuses an un-migrated volume, so the migrate step runs first.
docker build --build-arg OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)" -f apps/instance/Dockerfile -t onyourleft-instance .
docker run --rm -v oyl-data:/data onyourleft-instance node src/operator/cli.ts migrate
docker run --rm -v oyl-data:/data -p 127.0.0.1:8787:8787 onyourleft-instance

# #807's deployment and #52's one command, on a machine with Docker Compose and
# a filled-in apps/instance/deploy/home/.env (template: instance.env.example
# there): builds this checkout, snapshots the data, migrates, starts, waits for
# /ready, and rolls itself back if the new build is not ready. `--rollback` by
# hand. docs/self-hosting/home-machine.md is the guide. Performed and timed on
# a Mac with Docker 29.5.3 on 2026-09-29 (deploy 10 s, rollback with a restore
# 9 s); the owner's Windows box is issue #733's. NOT a gate.
bash apps/instance/deploy/home/deploy.sh
```

`scripts/check-repo-rules.sh` enforces:

| Rule | Fails when |
|---|---|
| `LIC001` | a source file under `packages/` is missing an SPDX header, or declares one other than `Apache-2.0` |
| `LIC002` | a source file under `apps/` is missing an SPDX header, **or** declares one other than `AGPL-3.0-or-later` |
| `LIC003` | a package manifest declares a licence its path does not permit |
| `LIC004` | a package under `packages/` **or `apps/`** has no `LICENSE` file of its own |
| `LIC006` | an entry in `.spdx-exempt` names a file that is not there, a directory, an absolute or `..` path, or uses glob syntax — see §3a |
| `SCOPE001` | ANT+ is referenced anywhere in a source tree, **or named as a dependency in a `package.json` under `packages/` or `apps/`** (see §6) |
| `WF001` | `pull_request_target` appears in a `.github/workflows/` file (see §8) |
| `ADR001` | two ADRs share a number |
| `ADR002` | an ADR filename is not `NNNN-kebab-case.md` |
| `ADR003` | an ADR's `## Amendments` section is followed by **any** heading, or there are two of them, or an entry does not open with a bold ISO date, or an entry is dated **before the one above it**, or an **unclosed code fence** would hide any of those — see §7 and [ADR 0013](../adr/0013-adr-amendments.md) |
| `ADR004` | an ADR under `docs/adr/` declares no **Status**, **Context**, **Decision** or **Consequences** — §7's sentence, which nothing enforced until [#416](https://github.com/openzigs/onyourleft/issues/416). ⚠️ The matcher is **two spellings and no more**, decided rather than guessed: a level-2 heading whose text is the word (`## Decision` and `## Decision: what was chosen` count, `## Decisions` does not), and — for **Status** alone, because it is metadata rather than prose — a bold label opening a line (`- **Status**:` or `**Status**:`). A rule accepting any line that *contains* the word would pass every ADR here without reading one, since each discusses its own consequences in a sentence. Fences are blanked first, so a quoted example is an example; an **unclosed** fence is `ADR003`'s finding and deliberately not a second, misleading one here |
| `SPIKE001` | two files under `docs/spikes/` declare the same `NNNN` prefix. [#493](https://github.com/openzigs/onyourleft/issues/493). ⚠️ A **new id rather than a widening of `ADR001`**, and the reason is the remedy sentence: `ADR001` tells the reader to renumber the unmerged file, and §7 says of a spike *"Do not renumber one"*. The unmerged file takes the **next free number** and nothing is renumbered — so a collision found after merge has no cheap repair at all, which makes this **strictly worse** than the ADR case `ADR001` exists for. It happened twice, both live on 2026-09-22 (0005 and 0006), and neither was caught by a gate: two differently-named files are two new files and git merges them clean. Both paths are named on one line, for `ADR001`'s own #118 reason |
| `SPIKE002` | a filename under `docs/spikes/` is not `NNNN-kebab-case.md` — `ADR002`'s check applied to the directory §7 gives the same convention. It runs **first** and `continue`s, which is what makes `SPIKE001`'s string packing safe |
| `SPIKE003` | `docs/spikes/` is absent, or holds no write-up. ⚠️ This is what stops the two above passing over nothing: a rule that walks a path which is not there reports clean for ever, which is `LIC006`'s reason applied to a directory and #142's shape applied to a selector — failing closed against *deleting* the directory and **open** against *renaming* it. The directory is therefore **asserted**, as `check-wiring.mjs` asserts `WATCHED_PREFIXES` and as `ASSET005` asserts the manifest is present. Measured 2026-09-23: removing its two `report` calls turns exactly two of the suite's 206 cases red and nothing else; pointing the walk at a suffix nothing uses makes it fire on this repository |
| `REL001` | signing key material is committed anywhere — by name (`.jks`, `.keystore`, `.p12`, `.pfx`, `.key`, `keystore.properties`) **or** by content (a `PRIVATE KEY` block in a file with an innocent name). #95, and the one rule here whose violation cannot be undone by fixing it. ⚠️ Since #229 both halves walk the **same** prune list every other rule walks: it used to keep its own, which excluded `fixtures` and kept `coverage`, so a `.jks` under `packages/fit/fixtures/` was invisible while a PEM beside it was reported |
| `REL002` | any Gradle file under `apps/mobile/android` declares a target API level below **36**, or the project declares none at all. Checked here rather than in Gradle because CI does not build Android — a rule that only fires inside a build nobody runs never fires. ⚠️ Since #95 it reads **every** Gradle file and follows the value rather than the filename: it used to open `variables.gradle`, take the first match and pass silently when that file was absent, so deleting it, overriding the ext property with a literal in `app/build.gradle`, appending a lower value below a compliant one, and AGP's current `targetSdk` spelling were four green regressions |
| `XML001` | `--` appears inside an XML comment in a non-generated `.xml` file, which XML 1.0 §2.5 forbids and no parser accepts. #225 — the rule exists because `AndroidManifest.xml` shipped in #87 with three of them and passed every gate here for months, until the first Gradle build ever run failed on it |
| `XML002` | an XML comment is never closed — the `DOC002` failure mode in XML, where the scanner's state sticks, everything after it is silently skipped, and a parser drops every element that follows |
| `XML003` | a `<![CDATA[` section is never closed. #229, and it is the rule that keeps the two above honest: before it, an unclosed CDATA set the scanner's state and nothing cleared it, so **`XML001` and `XML002` went silent for the rest of the file and it reported clean** — `DOC002`'s own failure mode inside the rule written because of `DOC002`. Closure is now decided where a region opens, so the section is reported **and** the scan carries on |
| `XML004` | a processing instruction is never closed with `?>`. The same construct class, and the reason a PI is tracked at all: `Comment` is not a production inside `PIContent`, so `<?php <!-- a -- b --> ?>` is valid XML that #225's first version reported as `XML001`. Tracking it fixes that false positive; `XML004` is what stops the tracking becoming a second way to switch the scanner off |
| `SH001` | a shell script anywhere the walk reaches pipes into `grep -q` (or `--quiet`). [#743](https://github.com/openzigs/onyourleft/issues/743): under `set -o pipefail`, `grep -q` exits at its first match, a producer still writing dies of SIGPIPE, and the pipeline reads a MATCH as "no match". ⚠️ **It is not about the pipe buffer**, which is what this repository believed until #743: on Linux bash's `printf` writes one line per `write(2)`, so any producer of two or more lines can lose the race. The negated form (`! … \| grep -q`) turned a lost race into a silent PASS in about eight fixture assertions. Every pipeline is refused, a one-line producer included, so there is no allowlist to grow; read a here-string instead (`grep -q x <<< "${out}"`). A comment line may name the pipeline. ⚠️ Since [#758](https://github.com/openzigs/onyourleft/issues/758) a pipe that ENDS a line, feeding a `grep -q` that opens the next code line, is refused too; the line-at-a-time pattern alone could not see it |
| `ASSET001` | a committed **binary** exists that `ASSETS.toml` does not name. #339, filed before the first `.glb` exists rather than after. ⚠️ Discovery walks for binaries by **content** — a NUL byte in the first 8000, which is git's own rule — and deliberately **not** by an extension list: a list fails closed against deleting a format and **open** against adding one, which is #142's defect exactly |
| `ASSET002` | `ASSETS.toml` names a path that is not there. A stale entry records the provenance of nothing. A glob lands here rather than being refused as syntax, unlike `.spdx-exempt`: the lookup is string equality, so a pattern truly names no file |
| `ASSET003` | a named file's SHA-256 does not reproduce, or none is recorded. ⚠️ It pins **what is committed**, so a substitution is visible; it does **not** establish that the bytes are the upstream artefact they name, which nothing offline can — `apps/mobile/README.md` §4 still stands on `gradle-wrapper.jar` |
| `ASSET004` | an entry's licence is absent, on **no** list, or not permitted where the file lands. Permissive anywhere; weak (`CC0-1.0` and friends) and — since #357 — attribution-requiring (`CC-BY-4.0`) under `apps/` only; and — since #991, [ADR 0043](../adr/0043-ofl-display-typeface.md) D-1 — `OFL-1.1` for a **font file** (`woff2`, `woff`, `ttf`, `otf`) under `apps/` only. ADR 0015 D-2's distributed-closure table, applied to a committed file. ⚠️ Fails **closed**, and this row used to name `CC-BY-4.0` as an example of that: [ADR 0023](../adr/0023-cc-by-assets-and-attribution.md) ruled on it, so the examples are now GPL, AGPL, `CC-BY-SA-4.0` and **`CC-BY-NC-4.0`**, which is two letters from an admitted one and non-OSI |
| `ASSET005` | `ASSETS.toml` is absent, or does not parse. ⚠️ Five ids where #339 names four, and the fifth is the reason the other four cannot pass vacuously — the same move `LIC006` made for `.spdx-exempt`. An unrecognised key is **refused rather than ignored** (ADR 0017 D-4's choice, for the same reason), and a manifest that does not parse **stops the walk** rather than reporting every entry after the bad line as unnamed |
| `ASSET007` | a **derived** entry — one this repository made from an upstream input rather than committed as the upstream bytes — records its `input`, `inputsha256`, `script` and `tool` together, with `modified`, and the `script` it names is committed. #430, [ADR 0026](../adr/0026-realistic-game-world.md) D-5. ⚠️ The four keys are ACCEPTED on any entry and REQUIRED together, so a derived row cannot be half-recorded; what `ASSET003` pins is still the committed bytes, and what these add is that they can be **made again** — `realistic:process --check`, run by hand because CI has no Blender, and `provenance.test.ts` holding every row to the pipeline's own table |
| `ASSET006` | an entry whose licence **requires attribution** records no `creator`, no `url` or no `modified`. #357, [ADR 0023](../adr/0023-cc-by-assets-and-attribution.md) D-3. ⚠️ It fires on a licence `ASSET004` has just **permitted**, which is what makes it a rule rather than a branch: CC-BY is the only identifier in either set whose obligation is **continuing** — discharged by the shipped app crediting the work every time it ships, not by the manifest row existing — so the data [#358](https://github.com/openzigs/onyourleft/issues/358) generates the credits screen from is checked where the asset enters the tree. Widening a list alone would have satisfied "a CC-BY asset now passes" and left the obligation unchecked, which is this repository's own recurring defect shape |
| `ASSET008` | a **vector or animation file** under `apps/` or `packages/` — an `.svg`, `.lottie` or `.riv` (any case), or a `.json` whose **top-level** object has `"v"`, `"fr"` and `"layers"` (a Lottie document) — is not named in `ASSETS.toml`. [#937](https://github.com/openzigs/onyourleft/issues/937). ⚠️ **The one extension list in the asset rules, on purpose**: `ASSET001` finds binaries by content and is blind to text, and a text file carries no signal that it is somebody else's work, so what can be keyed on is its kind. It fails open against a format it does not name — `.gltf` and `.obj` are still undiscovered, deliberately. It runs **before** the binary sniff, so a binary `.riv` or `.lottie` is one `ASSET008` rather than an `ASSET001`. The Lottie sniff is a brace walk that skips strings, so a `package.json`, or the three names only nested or inside a string, is not one. Walks `repo_files`, so `node_modules`, `dist` and the rest of `GENERATED` are pruned. A named file is then `ASSET002`–`ASSET004`'s like any entry — a named `CC-BY-SA-4.0` SVG is red by `ASSET004`. Art drawn **in code** is a `.tsx` and is not matched |
| `AGENT001` | a topic file under `docs/agents/` is not linked from the root `CLAUDE.md`. Since 2026-10-05 the root is an index and everything else is in topic files an agent reads when its work reaches that area; a topic file the index does not name is an instruction nobody is sent to read. A mention in prose is not enough — it must be a Markdown link to `docs/agents/<file>`, which is what the topic map writes |
| `AGENT002` | the root `CLAUDE.md` is larger than **48 KiB** (49 152 bytes, about 12 000 tokens). Every agent session, and every subagent it dispatches, loads that file whole on every turn, which is why it was split; new text goes in the topic file whose area it is, with a pointer in the index if every task needs to know it exists |
| `AGENT002` since [#1170](https://github.com/openzigs/onyourleft/issues/1170) | the root `CLAUDE.md` is larger than **15 KiB** (15 360 bytes, about 3 800 tokens). ⚠️ The row above is #1156's 48 KiB, kept verbatim because #1170 moved text and deleted none: the root now holds only the always-on rules, the essential commands and the map |
| `AGENT003` | an **area** `CLAUDE.md` — any `CLAUDE.md` under `apps/` or `packages/`, `node_modules`, `dist` and `coverage` pruned — is larger than **8 KiB** (8 192 bytes). Claude Code loads one whenever a session works beneath it, so it is the root's cost one directory down; the detail goes in the topic file it points at. [#1170](https://github.com/openzigs/onyourleft/issues/1170) |

`scripts/check-licence-hashes.sh` enforces one more, separately because it hashes files rather than
reading paths:

| Rule | Fails when |
|---|---|
| `LIC005` | a licence text no longer matches the SHA-256 digest ADR 0001 records for it, **or** ADR 0001 no longer records a digest for one of them, **or** a leaf package's own `LICENSE` is not byte-identical to the canonical text its path requires |

`scripts/check-env-example.sh` enforces one more, separately because it reads code rather than paths:

| Rule | Fails when |
|---|---|
| `ENV001` | a source file under `apps/` or `packages/` reads an environment variable `.env.example` does not list, **or** `.env.example` is missing |

`scripts/check-doc-links.sh` enforces two more, separately because it reads **prose** and then
resolves paths out of it:

| Rule | Fails when |
|---|---|
| `DOC001` | a relative link in a `.md` file points at nothing. Absolute URLs, `mailto:` and bare `#anchor` targets are skipped; a `#fragment` is stripped before the path is resolved, and a link inside a code fence is an example rather than a link |
| `DOC002` | a code fence is never closed. Without it the fence state machine sticks and every link after the fence is skipped **while the file reports clean** — the "rule that cannot fire" shape this repository has now shipped five separate times |

`scripts/check-dependency-licences.mjs` enforces one more, separately because it reads the installed
dependency graph rather than the repository:

| Rule | Fails when |
|---|---|
| `DEP001` | a dependency's own licence is not permitted in the closure and path where it was found — including a licence in none of [ADR 0015](../adr/0015-dependency-licences.md)'s tables, which fails closed |
| `DEP002` | **third-party copyleft in the *distributed* closure of an application.** [ADR 0025](../adr/0025-app-store-additional-permission.md) D-5: an app ships through an app store under an additional permission this project's copyright holders grant (`COPYRIGHT`), and that permission cannot cover anybody else's GPL, LGPL or AGPL code. ⚠️ **Until ADR 0025 this was permitted**, and a reviewer who remembers *"GPL is fine under `apps/`"* is remembering the **build-time** half, which still is. One such dependency is one third party able to have the app removed from a store, which is what a single copyright holder did to VLC in 2011 |

The stack the workspace is built on is decided in ADR 0005 and is not open:

| Concern | Decision |
|---|---|
| Language | TypeScript **6.0.3** — *not* 7.x, see §8 |
| Runtime | Node **24 "Krypton"** (Active LTS until 2026-10-20) |
| Package manager | **pnpm 11** workspaces |
| Web client | React 19 + Vite 8 |
| Styling | `theme.css` over `design/tokens.ts`, and since #950 Tailwind CSS **4.3.3** utilities built from those tokens (`tw:` prefix, no preflight) — [ADR 0042](../adr/0042-tailwind-and-radix-over-the-tokens.md) |
| Headless UI primitives | Radix, one package per primitive, lazily loaded — `@radix-ui/react-alert-dialog` 1.1.23 since #950 (ADR 0042 D-6) |
| Test runner | Vitest 4.1.11 + `@vitest/coverage-v8` |
| Linter / formatter | ESLint 10 + typescript-eslint + Prettier 3 |
| Typechecker | `tsc --noEmit` |
| Local data layer | IndexedDB via **Dexie 4.4.5** |
| Migration tool | **Dexie's own versioned schema** — no separate migrator; see §5 |
| Monorepo task runner | none |

**When you run tests, always use the run-once form.** Vitest defaults to watch mode and a watching
process never belongs in a gate. `pnpm run test` is already the run-once form; `pnpm exec vitest` is
not.
