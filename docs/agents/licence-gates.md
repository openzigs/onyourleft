# The dependency-licence and notices gates

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4g and one bullet of §3 (checking an "it lands under `apps/`" argument), moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you add, remove or bump a dependency, or touch the third-party notices.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

## From §3: proving where a dependency lands

- ⚠️ **An "it lands under `apps/`" argument is checked with `pnpm why <pkg> --recursive`, and a
  clean `require.resolve` probe is not evidence of anything.** This trap has now caught two
  dependencies — `lightningcss` and, in #141, `jsdom` — so #143 recorded how to check it.
  `pnpm why lru-cache --recursive` lists `@onyourleft/domain`, `fit`, `sensors` and `store` under
  `vitest`, because pnpm re-resolves `vitest` per importer with the peer in the key and a
  devDependency declared under `apps/` reaches every package through that graph. The other probe
  answers a **narrower** question — whether that package's own source could `import` the name — and
  under pnpm's isolated `node_modules` it returns *not resolvable* for every transitive dependency,
  **`lightningcss` from `packages/domain` included**, which the bullet above records as reaching
  there. Both probes were re-run for #143 and that is what they said; a "not resolvable" therefore
  proves the package cannot be imported by name, and nothing about the licence boundary.

### 4g. The dependency-licence gate

Added by [#24](https://github.com/openzigs/onyourleft/issues/24) part 2 and classified by
[ADR 0015](../adr/0015-dependency-licences.md). `scripts/check-repo-rules.sh` checks the licence
of the code **we write** — the header, the manifest, the `LICENSE` file. This checks the licence of
the code **we pull in**, which is the direction §3's HARD RULE actually protects against: a GPL
dependency inside an Apache-2.0 leaf package is a licensing incident and it arrives looking like a
version bump.

**Two closures, judged by different tables**, because a licence's obligations attach to what is
distributed:

| | `packages/*` (Apache-2.0) | `apps/*` (AGPL-3.0-or-later) |
|---|---|---|
| **Distributed** (`--prod`) | permissive only | permissive + weak — ⚠️ **no copyleft since [ADR 0025](../adr/0025-app-store-additional-permission.md) D-5**, reported as `DEP002` |
| **Build-time only** | permissive + weak | permissive + weak + GPL/LGPL/AGPL |

where *weak* is ADR 0015 D-2's set — `MPL-2.0`, `BlueOak-1.0.0`, `CC0-1.0`, `MIT-0`, `0BSD` — plus
`Unlicense`, added to that set by [ADR 0016](../adr/0016-unlicense.md) D-1. `Unlicense` grants
more than MIT does and still sits in *weak* rather than *permissive*, because the permissive row is
§3's quotable list verbatim and stays that way; ADR 0016 D-1 gives the reasoning.

⚠️ **GPL and AGPL stay forbidden under `packages/` in BOTH closures.** The distributed-artefact
argument alone would permit a GPL build-time tool there; ADR 0015 D-3 deliberately does not go
there, because §3 states the rule with no exemption and reversing it is an owner's decision rather
than a side effect of writing a checker.

⚠️ **And since ADR 0025 they are forbidden in what an *app* ships, too — which this section used to
say the opposite of.** The table above read *"permissive + weak + GPL/LGPL/AGPL"* in both `apps/*`
rows, on the argument that GPL-family code is licence-compatible with an AGPL application. It is.
But an app reaches its users through the Apple App Store and Google Play under a GNU AGPL §7
**additional permission** in [`COPYRIGHT`](../../COPYRIGHT), and a permission this project's copyright
holders grant cannot reach a third party's copyleft. **Compatible is not the same as shippable.**
Measured 2026-09-20, nothing copyleft ships: `pnpm licenses list --prod` over `apps/web` and
`apps/mobile` is MIT, ISC, BSD-2/3, one `(MIT OR Apache-2.0)` and 0BSD. `DEP002` keeps it that way.
⚠️ **It cannot see native dependencies** — CocoaPods, Swift packages, Gradle — so whoever generates
the iOS project owes the same check by hand; ADR 0025 §Consequences says so.

⚠️ **It fails closed.** A licence in none of the tables is a violation, not a pass — the gate exists
for the licence nobody has considered yet. A perfectly fine but unnamed licence (`Zlib`, say) will
stop the build until someone adds it to ADR 0015 **and** to `POLICY` in the script. Those two tables
can drift and nothing prevents it; the script says so where `POLICY` is defined and the failure
message names the ADR.

⚠️ **That is not hypothetical — it has now happened once, and `Unlicense` is no longer the example.**
#87's `@capacitor/cli` install reached `bplist-parser` and `bplist-creator` (`Unlicense`) and
`DEP001` stopped the build. [ADR 0016](../adr/0016-unlicense.md) ruled on it and `POLICY.weak`
carries it, in the same pull request, which is the shape ADR 0015's §Consequences asks for. `Zlib`
was deliberately **not** ruled on at the same time: nothing in the tree needs it, and a licence
nobody has a dependency for is a licence nobody has read.

⚠️ **`pnpm licenses list --filter` does NOT follow workspace links, and that was measured.**
`apps/web` declares `@onyourleft/store`, which declares `dexie`, yet `dexie` does not appear in
web's closure — it appears in `store`'s, which is where the licence question belongs. So **the union
over every workspace package is what makes the check complete**, the package list is *discovered*
rather than written down, and a discovery returning nothing is a failure rather than a clean run.

⚠️ **It cannot see a licence the package declares wrongly.** It reads the `license` field each
package publishes. A package that declares MIT and vendors GPL inside itself passes, and no check at
this layer would catch that — which is why `packages/fit`'s clean-room posture (ADR 0006) exists
separately rather than being subsumed here.

**Not part of `pnpm run check:repo`**: it needs an install, the same reason `check:a11y-suite` is
not. Its own suite is `bash scripts/check-dependency-licences.test.sh` — 56 cases, and every policy
branch has a case that goes **red** as well as one that passes. ⚠️ That said 49 here while §4a said
50; the number is what the suite prints, so read the run rather than either line.

#### Admitted is not the same as noticed — #664

⚠️ **Everything above decides which licences may SHIP. None of it says whether their notices ship
with them**, and until [#664](https://github.com/openzigs/onyourleft/issues/664) none did: MIT, ISC,
the BSDs and Apache-2.0 all ask for their copyright and permission notice — and Apache-2.0 for any
`NOTICE` file — to travel with copies, and `dist` carried only the Apache-2.0 text #597 added for
two assets. `DEP001` reads a manifest's `license` field, which names a licence and carries none of
its text, so it could never have seen this. The second half is a separate gate:

| | |
|---|---|
| The document | `apps/web/public/licences/third-party.txt`, served from `dist`, precached, and in the APK. Every package in the app's distributed closure with the **verbatim** text of every licence and notice file it ships — any root file whose name contains `licence`/`license`, `notice` or `copying` (so `ThirdPartyNotices.txt` and tslib's `CopyrightNotice.txt` too, since #676's review), and every file in a root `LICENSES/` directory, source files excepted; every native library the APK links; the files the build copies out of a package (`pose/`'s WebAssembly runtime); and the code the **bundler** writes into the build (Part 4) |
| Where it comes from | `scripts/check-third-party-notices.mjs`, over the **same** `discoverPackages`/`readClosure` `check:licences` uses — imported, not re-derived — so what is admitted and what is noticed are one list. The union, not `--filter @onyourleft/web`, for the reason above: `dexie` reaches the app only through `@onyourleft/store` |
| The gate | `check:notices` (NOT001–NOT008) and its suite, in the one `Repository rules` job. Shape (b) of #664: **committed and regenerated-and-diffed**, with its own frozen install — the script's header says why not built at build time |
| What fails closed | a package with no licence file (NOT003). Three in today's closure ship none — `@mediapipe/tasks-vision`, `murmurhash-js`, `pmtiles` — and each has a reviewed entry in `apps/web/third-party-notices.json`, keyed by **name and version**, saying where its notice comes from instead; an entry nothing uses is NOT004 |
| The native half | `apps/mobile/native-closure.json`, a **reviewed** list, because CI cannot run Gradle. `apps/mobile/src/android/native-closure.test.ts` holds it to `./gradlew :app:dependencies --configuration releaseRuntimeClasspath` in both directions wherever `native:closure` has written a report, and **skips loudly** elsewhere — #318's shape, and like it **not a CI gate** |
| Code no closure lists | ⚠️ **Vite's module-preload polyfill and `__vitePreload` helper are in the entry chunk, and Rolldown's CommonJS-interop runtime is `assets/rolldown-runtime-*.js`** — both MIT, both shipped, and both from **devDependencies**, so `--prod` never lists them (#676's review, read off a real `dist`). `WRITTEN_BY_THE_BUNDLER` in the script names the two, resolved from `apps/web` as Node resolves them, and each needs a reviewed `writtenByTheBundler` entry at its **installed** version — so a Vite or Rolldown bump fails closed (NOT008) until somebody re-reads what it writes. A new bundler is a new line there, and nothing finds one for you |
| Files copied out of a package | `copiedIntoBuild` is a reviewed list; what holds it complete is the **build**, not `check:notices`, which deliberately needs no build. `apps/web/tools/notices/copied-into-build.ts` is a plugin in the product's `vite.config.ts` that fails `pnpm run build` when the bundle holds a non-code asset (not `.js`/`.css`/`.html`/`.map`) that came from a package — no origin module at all, which is how a plugin's `emitFile` arrives, or one under `node_modules` — and the list does not name it; and when the list names a file the build did not write. ⚠️ **Its limits**: it reads the one product build, so the service-worker sub-build and the harness build are not read; `public/` is not in the bundle and is `ASSETS.toml`'s; and a package's bytes passed off as this repository's own source (copied into `src/` and imported from there) look like ours, which is `ASSET001`'s to catch |
| Fonts the repository commits | ⚠️ **Part 5**, since #991 ([ADR 0043](../adr/0043-ofl-display-typeface.md) D-2): a committed font is a file and in no closure, so `committedFonts` in `apps/web/third-party-notices.json` names it and its notice is the upstream `OFL.txt` committed beside its input, reproduced verbatim. A file or licence file that is not there is NOT005; `tools/fonts/fonts.test.ts` holds the list to what `fonts:subset` writes |
| Where a rider reads it | Credits §"Software this app includes", reached from About. The screen inlines the document's **contents** (the list, ~5 KiB) rather than the document (~125 KiB); both are the generator's output and `check:notices` compares both |

⚠️ **A SERVER is not in the app's union, and has a document of its own**
([#767](https://github.com/openzigs/onyourleft/issues/767)). `SERVERS` in the script names
`apps/instance`: its distributed closure — with every workspace package its manifest names — is
written to `apps/instance/third-party.txt`, which the instance serves at
`GET /licences/third-party.txt`, and is **excluded** from `apps/web/public/licences/third-party.txt`,
because a rider's device carries none of it. A server dependency with no licence file is `NOT003`
with no reviewed escape yet: the first one is a decision to make with the package in front of you.
Today the instance's closure is `kysely` and, since #780, `ws` — both MIT (ADR 0037 D-9) — and
its document says so; this sentence said the closure was empty until #780 read it.

⚠️ **The text is read from the files, never from the manifest.** `lucide-react`'s manifest says
`ISC`; its `LICENSE` is ISC **and** MIT, for the icons derived from Feather. The field is printed as
what a package declares, and the notice is every licence file it ships — the fixture suite's
Lucide/Feather case is the proof. ⚠️ And like `DEP001` it **cannot see what a package vendors**:
MediaPipe's bundle is one binary built from many projects, and is noticed only as far as that
package's own files notice it.

⚠️ **A dependency bump now fails CI until somebody regenerates**, on purpose: `pnpm run
notices:generate`, then read the licence text in the diff before committing it. A Dependabot pull
request goes red at `Third-party notices` for exactly that reason.
