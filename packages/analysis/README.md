# `@onyourleft/analysis`

The platform-free core of a model-written ride write-up: the rules, never the engine
([ADR 0046](../../docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) D-4, D-5).

| Module | What it is |
|---|---|
| `src/runner.ts` | Runs a template's steps through a `ModelStepPort`, inside time and token budgets, and screens the result (#811). Time is a `RunnerClock` it is handed |
| `src/template/` | The templates — each step's prompt, bounds and reply contract — and their recorded digests (#810, #835). A shipped prompt changes only as a new template version |
| `src/input.ts` | What a model is sent about a ride: at most eight sections of numbers, no coordinate, no date, no name (#809) |
| `src/history.ts` | The rider's history passages and the fence they arrive in (#835) |
| `src/model-step-port.ts`, `src/sealed-step.ts` | The port a transport implements, and the seal only the runner applies (#803) |
| `src/screen/` | The write-up screen and the angle matchers it shares with `apps/web`'s source scan — one set of matchers (ADR 0035 D-4) |
| `src/pose-summary.ts` | The side camera's pose summary, as numbers (#801) |
| `src/hosted-mask.ts`, `src/masked-words.ts` | What is masked before anything goes to a hosted model (#839) |

## Licence and provenance

`Apache-2.0`, by path (`CLAUDE.md` §3). Every module here was moved out of `apps/web`
(`AGPL-3.0-or-later`) with `git mv` by [#1094](https://github.com/openzigs/onyourleft/issues/1094), on
the sole copyright holder's written consent, quoted in ADR 0046 D-4; `git log --follow` reaches each
file's history there. `src/masked-words.ts` came from `packages/store`, already Apache-2.0.

## What it may not depend on

- **Any platform API at all.** `tsconfig.platform-free.json` (`lib: ["ES2024"]`, `types: []`) is the
  one that enforces, over everything but the tests; `eslint.config.js` is the fast duplicate. The one
  global declared is `AbortController` (`src/abort.d.ts`): the runner cancels with it, and every
  runtime the core runs in has it.
- **`@onyourleft/store`.** The record fields the input builder and the mask read are restated as
  structural types; `packages/store` imports `MAXIMUM_WRITE_UP_CHARACTERS` and `parseMaskedWords`
  from here.
- **Any model SDK** (`ai`, `@ai-sdk/*`) or schema library: the instance holds the engine.

Its only production dependency is `@onyourleft/domain`. Test support is `@onyourleft/analysis/testing`
— including `sealStep`, which the barrel deliberately does not export.
