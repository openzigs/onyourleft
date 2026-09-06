// SPDX-License-Identifier: Apache-2.0

/**
 * A module one directory down, named after a Node builtin, so that importing it
 * across that boundary is exercised by `pnpm run lint` (#163).
 *
 * `no-restricted-imports` matches its `group` patterns with gitignore
 * semantics, where `*` does not cross a slash. So the negations that let a
 * platform-isolated package write `./constants` did **not** let it write
 * `./boundary-probe/constants`, and about forty builtin names — `util`,
 * `stream`, `path`, `crypto`, `assert`, `events`, `url`, `os` — carried the
 * same trap at any depth below the package root.
 *
 * This file is the fixture that keeps the fix honest. It is deliberately
 * trivial: the assertion that matters is not what it exports but that
 * {@link ../boundary-probe.test.ts} can name it at all. Remove `'!./**'` from
 * `NODE_BUILTIN_SPECIFIERS` in `eslint.config.js` and the lint step fails,
 * which is the whole point of it being a committed file rather than a probe
 * somebody ran once.
 */
export const BOUNDARY_PROBE = 163;
