#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# lint.sh — `pnpm run lint`: ESLint over the whole tree, one workspace project
# per process. #2272.
#
# One `eslint .` held every project's TypeScript program at once — the project
# service keeps each one it opens — and on 2026-11-06 it ran out of its 4 GB
# heap in the Checks job (run 42263160979). Each project's program now lives
# and dies in a process of its own, so the peak is the largest single project's
# rather than the sum of all of them. The rules are the same rules, from the
# same eslint.config.js, over the same files: only the process boundary moved.
#
# The processes are:
#   one for each directory under apps/ and packages/ (the workspace projects,
#   pnpm-workspace.yaml), and
#   one for everything else, which is `eslint .` told to ignore exactly those
#   directories, so a file outside every project is still linted, and linted
#   once.
# eslint.config.js's own ignores apply to every one of them: naming a directory
# on the command line does not lift a global ignore.
#
# They run ONE AFTER ANOTHER, never side by side: concurrent processes would add
# their heaps up again. Every one runs even after one fails, so a run reports
# every problem at once, and the exit status is the highest any of them
# returned (1 for a problem, 2 for ESLint's own failure), so nothing is
# swallowed. Each prints a header and, through scripts/lint-memory.mjs, its peak
# heap beside its heap limit, to stderr — so the margin is in every CI log and
# `--format json` on stdout stays one array per process.
#
# Usage: scripts/lint.sh [ESLINT OPTION ...]
#        Every argument is passed to each ESLint process, e.g. `--fix`. Run it
#        from the workspace root; `eslint` must be on PATH, as `pnpm run` puts it.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--import=\"${script_dir}/lint-memory.mjs\""

worst=0

# lint LABEL ESLINT_ARGUMENT ... — one ESLint process, its header and its
# status folded into `worst`.
lint() {
  local label="$1" start="$SECONDS" status
  shift
  printf 'lint: %s\n' "$label" >&2
  eslint "$@"
  status=$?
  printf 'lint: %s exit %d, %d s\n' "$label" "$status" "$((SECONDS - start))" >&2
  ((status > worst)) && worst=$status
  return 0
}

projects=()
for dir in apps/*/ packages/*/; do
  [[ -d $dir ]] && projects+=("${dir%/}")
done

rest=()
for project in ${projects[@]+"${projects[@]}"}; do
  # --no-error-on-unmatched-pattern: a project with nothing to lint passes,
  # as it does under `eslint .`.
  lint "$project" --no-error-on-unmatched-pattern "$@" "$project"
  rest+=(--ignore-pattern "${project}/")
done
lint 'everything outside apps/* and packages/*' ${rest[@]+"${rest[@]}"} "$@" .

exit "$worst"
