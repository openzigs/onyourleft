# The boundaries the linter enforces

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4d, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you add an import across packages, touch `eslint.config.js` or a package tsconfig, or work in a platform-free package (`packages/domain`, `physics`, `sensors`, `protocol`, the instance core).**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4d. The boundaries the linter enforces

`eslint.config.js` is not only style. Three of its blocks are the enforcement half of decisions that
would otherwise be documented and unenforced, which is the gap this project keeps closing:

| Enforced by | What fails |
|---|---|
| `headers/header-format` | a `.ts`/`.tsx` file whose first line is not the SPDX identifier its directory requires. Duplicates `LIC001`/`LIC002` on purpose: the script covers file types ESLint never parses and runs with no toolchain, the lint rule runs in the editor |
| `boundaries/dependencies` | an import from `packages/*` into `apps/*`, in either the relative (`../../../apps/web/src/...`) or the workspace (`@onyourleft/web`) spelling. Dependencies point one way |
| `@typescript-eslint/no-restricted-imports` in `packages/domain`, `packages/physics`, `packages/sensors/src`, `packages/sensors/protocol` and `packages/sensors/web-bluetooth` | naming **any** Node builtin — the list is derived from `builtinModules`, not typed out, so `events`, `util` and `stream/promises` fail exactly as `node:fs` does — or `react`, `react-dom`, `vite` or `dexie`, or a BLE library |
| `no-restricted-globals` in `packages/domain`, `packages/physics`, `packages/sensors/src` and `packages/sensors/protocol` | naming a DOM global (`window`, `document`, `navigator`, `location`, `history`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`), a Node global (`process`, `Buffer`, `__dirname`, `__filename`, `global`, `require`) or a network global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Request`, `Response`, `Headers`). This one **is** a named list; the closure is the typechecker below |
| `no-restricted-globals` in `apps/instance/src`, **except the Node adapter** | naming a Node-only global — `Buffer`, `process`, `require`, `module`, `exports`, `__dirname`, `__filename`, `global`, `setImmediate`, `clearImmediate` — anywhere the core mounts unchanged under `workerd` ([ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) D-2, [#852](https://github.com/openzigs/onyourleft/issues/852)). ⚠️ The exemption is **by file name, not directory**: `main.ts`, `node-listener.ts`, `store/node-sqlite.ts`, `blob/disk-blob-store.ts` — and, since #780/#791 (PR #895), `serve.ts`, `instance.ts`, `node-imports.ts`, `operator/`'s `cli.ts`, `run.ts` and `commands.ts`, `store/backup.ts`, `store/serving.ts` and `room/node/`'s `router.ts`, `worker.ts` and `worker-main.ts`, the Node process that composes the core, all named in `eslint.config.js` §`INSTANCE_NODE_ADAPTER_FILES` — and tests and `*-testing.ts`/`testing/` support — so a new core file is covered with no edit and a new adapter file is a line in `eslint.config.js`. `fetch`, `Request`, `Response`, `Headers` and `crypto` are **not** listed: `workerd` has them and the handler is written against them. ⚠️ **This is the only gate for it on a pull request**: the wide `tsconfig.json` carries `@types/node`, so `process` typechecks, and the `workerd` suite is local-only. Probed: `Buffer`, `process` and `__dirname` in `pagination.ts` passed `eslint` before this block and are three errors after; `process` in `node-listener.ts` is still none. ⚠️ **Since [#864](https://github.com/openzigs/onyourleft/issues/864) it is three rules, not one**: `no-restricted-properties` refuses the same names as properties of `globalThis`, `window`, `self` and `global` (`globalThis.process` is a member expression, which the globals rule never reads — probed: 0 errors before), and `@typescript-eslint/no-restricted-imports` refuses a Node builtin in either spelling, derived from `builtinModules` like the row above — a `node:` import in the core used to be caught by nothing but `workerd`. The room core's own block carries the property entries too, because flat config keeps the last setting of a rule. Probed on the four directories (the core, `store/`, `room/core/`, `room/durable-object/`) with `node:fs`, `path`, `globalThis.process`, `globalThis.Buffer` and `self.require`: none of the three member forms and neither import was an error in the core or `store/` before, and all five are after. ⚠️ **It matches the object by NAME**, so an alias (`const g = globalThis; g.process`) or a computed key (`globalThis['pro' + 'cess']`) is not caught — the lint rule is the fast guard, and `test:workerd` is still the only thing that runs the core without Node's globals |
| `no-restricted-globals` in `packages/sensors/web-bluetooth` | naming any of the same list **except `navigator`** — the adapter is the transport boundary and `navigator.bluetooth` is the one platform API it exists to reach. The exception is derived by subtracting one name from the list above rather than restating it, so the two cannot drift |

`packages/domain/tsconfig.json` narrows `lib` to `ES2024` and sets `types: []`. That is the closure
the lint list cannot be: with no ES library entry and no `@types` package in scope, *any* name from
outside ES2024 is a compile error, `fetch` and `WebSocket` included, and so is `import … from
'events'` (`Cannot find name 'events'`). The lint rules are the fast duplicate — they fire in the
editor with a message that says why, seconds before a typecheck finishes — and they are the half that
survives the paragraph below.

> ⚠️ **That closure is conditional, and it was silently broken until #23's review.** `types: []`
> suppresses the automatic `@types` lookup; it does **not** stop a `/// <reference types="node" />`
> inside a `.d.ts` the package imports. `packages/domain/vitest.config.ts` used to
> `import { defineConfig } from 'vitest/config'`, which pulled Vite's declarations — and through them
> all of `@types/node` — into the same program as `src/`, so `process`, `Buffer` and `fetch` all
> typechecked cleanly inside the package that forbids them. That file now **imports nothing** and
> exports a plain object, and says so at the top. **Any import added to a file inside
> `packages/domain`'s tsconfig program can reopen this**, which is why the ESLint rules are not
> redundant with it: check both gates with a probe file, never one.

`packages/fit` narrows through a second tsconfig for the same reason and with the same shape:
`tsconfig.json` is the wide program, because it has to cover `tools/` — the fixture generator, which
reads and writes files and legitimately needs `@types/node` — and
**`tsconfig.platform-free.json` is the one that enforces**, compiling `src/` alone with
`lib: ["ES2024"]` and `types: []`. That is why the codec carries its own UTF-8 reader and its own
XML reader: a `TextDecoder` in `src/` is a compile error. `pnpm --filter @onyourleft/fit run
typecheck` runs both, and reading only the first is how the boundary would be believed absent.

`packages/sensors/src` (#39) is isolated the same way and for a stricter reason: its interfaces have
to be satisfied **unchanged** by Web Bluetooth, CoreBluetooth and the Android BLE APIs, so an
interface that can name a browser type has already chosen one of the three. It carries one
restriction `packages/domain` does not — a BLE-library denylist, because a library is not a global
and neither the `lib` narrowing nor the globals list can see one.

⚠️ **`packages/sensors` narrows through a *second* tsconfig, not its main one**, for the reason
`packages/fit` does. ESLint's project service resolves a file to the nearest `tsconfig.json`, so
that file has to cover the whole package — including `web-bluetooth/`, which needs the DOM — or lint
reports "not found by the project service" instead of anything useful. So
`packages/sensors/tsconfig.json` is the wide program (`lib: ["ES2024", "DOM"]`,
`types: ["web-bluetooth"]`) and **`packages/sensors/tsconfig.platform-free.json` is the one that
enforces**: `src/` **and `protocol/`**, `lib: ["ES2024"]`, `types: []`. `pnpm run typecheck` runs
both, and a `navigator` in either fails the second while passing the first. Reading only the first
is how this would be believed to be broken; reading only the second is how a lint config change
would be missed.

> ⚠️ **`no-restricted-imports` `group` patterns are matched with gitignore semantics**, where a
> pattern containing no slash matches *any* path segment. The derived Node-builtin list therefore
> matched `@onyourleft/domain` on the builtin named `domain`, and **no workspace package could
> import the units package** until #39 added a `'!@onyourleft/*'` exemption to that group.
> `packages/domain` never hit it because it does not import itself. The same collision waits for any
> future `@onyourleft/<builtin-name>`.
>
> ⚠️ **It reaches relative imports too, and #88 hit it.** A file named `constants.ts` — or
> `util.ts`, `stream.ts`, `path.ts`, `crypto.ts`, `assert.ts`, `events.ts`, `url.ts`, `os.ts`, and
> about forty more — could not be imported as `./constants` from a platform-isolated package,
> because that specifier's last segment is a builtin's name. `packages/physics/src/constants.ts`
> holds `g` and the ISO 2533 atmosphere and was reported as importing a Node builtin. #88 added
> `'!./*'` and `'!../*'` to the same group, which fixes it for every package at once rather than
> renaming one file and leaving the trap for whoever writes the next `util.ts`. **It exempts nothing
> that was ever a violation** — a Node builtin is always a bare specifier, never a relative one — and
> a bare `import 'constants'` and a `node:constants` are both still errors, checked with a probe
> file.

#40's Web Bluetooth adapter needed the DOM, so it arrived in its own directory
(`packages/sensors/web-bluetooth`) with its own entry in `eslint.config.js`, and
`packages/sensors/src` stayed platform-free. #41 and #42's protocol clients arrived on the same
terms in `packages/sensors/protocol` — a third entry, and `platformIsolation` verbatim, because they
name a wire format but no platform. The routing work (#70) goes in the same file when it lands.

**`packages/analysis`** ([#1094](https://github.com/openzigs/onyourleft/issues/1094), ADR 0046 D-5) takes
`platformIsolation` too, over every file but its tests, plus a denylist of its own: `@onyourleft/store`
and any model SDK or schema library (`ai`, `@ai-sdk/*`, `zod`, …), which its tests are held to as well.
Like `packages/fit` it has two tsconfigs, and **`tsconfig.platform-free.json` is the one that enforces**
(`lib: ["ES2024"]`, `types: []`, everything under `src/` but `*.test.ts`); the wide `tsconfig.json`
admits `@types/node` because a few tests read files. Its one declared global is `AbortController`, in
`src/abort.d.ts`, which only the runner uses — every runtime the core targets has it.
