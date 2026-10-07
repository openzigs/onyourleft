# What the coverage report covers

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the part of §5 on the coverage report's scope, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you touch the coverage configuration, read a coverage figure, or wonder why a file reads as untested.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

## 5. The quality gate: what the coverage report covers

**What the report covers**, decided in [#110](https://github.com/openzigs/onyourleft/issues/110) and
recorded in `vitest.config.ts` beside the patterns: `packages/*/src/**`, `packages/*/*/src/**` (the
adapter directories that need a platform library — `packages/sensors/web-bluetooth/src` today) and
`apps/*/src/**`. The `packages/fit/tools/` tree is **deliberately outside it**: it is the #29 fixture
generator, authoring-time code that produces a committed artefact and ships in nothing. Its tests do
run — `packages/fit/vitest.config.ts` includes `tools/**/*.test.ts` — and the corpus tests assert
its output; including it in the report would only mix a generator's coverage into a codec's
denominator. #107's observation that the report listed `apps/web` alone at 125 statements predated
the second pattern and is no longer true: all six packages appear (`packages/physics` since #88).

⚠️ **Since [#852](https://github.com/openzigs/onyourleft/issues/852) the report is taken WITHOUT
two test files**, and a module only they exercise reads as untested in it. `test:coverage` excludes
the #545 near-field rides and the FIT decode fuzz, which `test:uninstrumented` runs with no
coverage (§4c says why: CI time). Measured locally on 2026-09-29, the total moved from 94.43 % of
statements to 93.19 %, and almost all of it is two files: `apps/web/src/game/near-field.ts`
**98.87 % → 23.22 %** and `near-field-testing.ts` 92.54 % → 0 %; `packages/fit/src/xml/` lost 12
statements, and nothing else moved. Those two numbers are the instrumentation's absence, not the
tests': read a low figure on either file as *not measured*, and run
`pnpm exec vitest run --coverage apps/web/src/game/near-field.test.ts` for the real one.

⚠️ **Since [#1076](https://github.com/openzigs/onyourleft/issues/1076) it is also taken without
`realistic-textures.test.ts` and without every `.a11y.test.` file** — the first nightly, the
second run once, by the `Accessibility` step. Measured locally on 2026-10-03 against the same
tree with #852's script, the total moved from 91.90 % of statements to 90.17 % (branches
86.82 → 85.00 %), over 30 files, almost all of it what only the accessibility tests render:
`game/three-renderer.ts` 83.50 → 74.22 % (the realistic textures), `a11y/section-lines.ts`
100 → 6.06 %, `a11y/audit.ts` 98.44 → 77.04 %, `a11y/button-hierarchy.ts` 100 → 50 %,
`ride/RideAnnouncer.tsx` 98.95 → 73.95 %, `ride/RideResultCard.tsx` 100 → 6.25 %. Those are
the instrumentation's absence, not the tests': every one of those files is still run, and gates,
in `test:a11y` or nightly. Run `pnpm exec vitest run --coverage --project web .a11y.test.` for
the accessibility half's own figure.
