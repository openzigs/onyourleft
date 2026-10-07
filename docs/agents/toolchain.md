# Toolchain and runtime gotchas

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries part of §8 "Known gotchas", moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you bump TypeScript, Node, Vitest or pnpm, add a dependency with an install script, touch `pnpm-workspace.yaml`, or test the recorder's auto-pause.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

## 8. Known gotchas (toolchain and runtime)

**TypeScript is pinned to 6.0.3, and 7.0.2 is the current release.** This looks like neglect and is
not. `typescript-eslint` declares `typescript: ">=4.8.4 <6.1.0"` — its canary too, checked
2026-09-03 — so adopting 7.x means shipping a workspace whose linter cannot do type-aware analysis.
Re-check with `npm view typescript-eslint peerDependencies.typescript` and move when the range
admits 7.x.

**Node 26 is not the answer yet.** It enters Active LTS on **2026-10-28**. Until then Node 24
"Krypton" is the line. Move on the date, not before.

**Vitest 5.0.0 is released, and this repository stays on 4.1.11 deliberately.** This line used
to read *"Vitest 5 is in release candidate"*; `npm view vitest dist-tags` reported `latest:
5.0.0` on 2026-09-14, so that reason has expired and the pin now rests on a different one. A
major version of the test runner moves `vitest`, `@vitest/coverage-v8` and every
`vitest.config.ts` in seven packages at once — including `packages/domain`'s, which **imports
nothing on purpose** (§4d) and would be the first thing a config migration breaks. Take it as
its own issue with the suite, the coverage reporter and both platform-free typechecks re-run,
never as part of a grouped bump. Dependabot's #273 proposed it alongside TypeScript 7 and was
closed for the TypeScript half. ⚠️ Since [#916](https://github.com/openzigs/onyourleft/issues/916)
`.github/dependabot.yml` **ignores semver-major updates** of `typescript`, `vitest` and
`@vitest/*` (minor and patch still come in the `toolchain` group), so neither major arrives in a
grouped bump again; the pull request that takes either major on purpose removes its entry.

**pnpm 11 refuses a lockfile entry published in the last 24 hours.** `minimumReleaseAge` is a
default, not something this repository configured, and it is a supply-chain control worth keeping:
the window it closes is the one where a compromised release is published and pulled again. It bites
when you pin the newest version of something: `pnpm install` writes the entry, then fails the
lockfile policy check on the next run with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. **Pin a version
that is more than a day old rather than adding a `minimumReleaseAgeExclude`** — the exclusion turns
the protection off for that package permanently. Rewriting a lockfile that already contains a
too-new entry needs `pnpm clean --lockfile` first; deleting `pnpm-lock.yaml` alone is not enough,
because the copy under `node_modules/.pnpm` is read too.

**An install script is a decision, recorded in `pnpm-workspace.yaml`.** pnpm 11 does not run
dependency build scripts until `allowBuilds` names them, and leaves `pnpm install` exiting 1 until
each is answered `true` or `false`. Answer it rather than deleting the entry: an install script runs
arbitrary code with your privileges before any lint or test gate sees the package. There are two
entries, both answered `false` for the same reason: `unrs-resolver` ships prebuilt native bindings
as platform optional dependencies, so its script has nothing to do; and `workerd` (since
[#781](https://github.com/openzigs/onyourleft/issues/781)) is a binary in its platform package
(`@cloudflare/workerd-<os>-<arch>`), whose script only re-links it or, when that package is
missing, downloads it from npm at install time. ⚠️ That package is ~130 MB (134 218 589 bytes
unpacked, a 39.7 MB tarball for `linux-64`), so every install — CI's included — downloads it, though
CI runs nothing that uses it (§4c). **Measured for [#864](https://github.com/openzigs/onyourleft/issues/864),
it is not worth keeping out of CI, and nothing does.** pnpm's own `Done in` for the job's frozen
install, over six `main` runs either side of #851: **4.1–5.2 s (median 4.7) before, 3.9–6.1 s (median
4.9) after** (+2 packages, 366 → 368; runs 36598959609–36626498625 and 36629332610–36642554580). The
registry is close to the runner and the tarball downloads beside 367 others. `check:capacitor`'s and
`check:notices`' own installs reuse that store and took the same 1–2 s and 7–9 s as their steps did
before. On a developer's machine with an EMPTY store it is larger — 7.1–11.2 s (median 7.4) before
against 11.0–13.6 s (median 11.9) after, five each, on 2026-09-29 — which is one download per clean
store, not per install. Keeping it out would have meant `--no-optional` (which drops every platform
binary, Rolldown's included) or an `ignoredOptionalDependencies` entry (which rewrites the lockfile
for everyone, `test:workerd` included), each for about 0.2 s of a ~20-minute job.

**That block is therefore a security-relevant file on every fork pull request.** CI installs from the
*fork's* `pnpm-workspace.yaml`, so flipping an entry to `true` and adding a dependency is what makes
that dependency's install script run on the runner. The controls that keep it acceptable are all
already in place — `pull_request` rather than its target-context counterpart, `permissions: contents:
read`, no secrets in the job, `persist-credentials: false`, and the first-time-contributor approval
gate — and the residual exposure is runner CPU and outbound network, which is inherent to running an
install in CI at all. Read the block anyway when reviewing a fork's pull request.

**A recorder fed only power auto-pauses, and that is correct.** `apps/web/src/recording/channels.ts`
counts speed and cadence as movement and deliberately **not** power: an ERG-mode trainer holds a
power target while the rider is off the bike getting a drink, and a crank-based meter reports the
torque of a bike being wheeled. A test that feeds power alone and expects a sixty-second ride gets
ten seconds of moving time and fifty of automatic pause — which cost an afternoon to diagnose the
first time. Feed a movement signal, or pass `autoPause: null`. ⚠️ **Since [#390](https://github.com/openzigs/onyourleft/issues/390)
the converse has a fix, and it is not a second pauser**: a recorder handed a `presence` treats no
reading as movement while the camera says `absent` (`channels.ts` §`presenceAwareMovement`), so the
engine's own auto-pause fires on an ERG ride nobody is on. `unknown` changes nothing, and
`recording/one-pauser.test.ts` fails if presence code ever calls a `pause()` itself.
