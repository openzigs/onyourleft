#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/lint.sh (#2272).
#
# Splitting one `eslint .` into a process per project is a gate removed twice
# over if it is done carelessly: a file that falls between the processes is
# never linted, and a process whose failure is swallowed is a red lint that
# reports green. Both look exactly like a clean run. So most cases put one
# problem in one place — inside each kind of project, outside every project,
# in the first process and in the last — and require the runner to report it,
# once, and to exit non-zero. The rest pin that eslint.config.js's ignores still
# hold, that ESLint's own failure is not a pass, that options reach every
# process, and that every process carries the memory reporter.
#
# Each case lints a fixture workspace with the repository's own ESLint and a
# config that imports nothing, so no type information and no plugin is needed.
#
# Run: bash scripts/lint.test.sh   (after `pnpm install`)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT="${SCRIPT_DIR}/lint.sh"
BIN="$(cd "${SCRIPT_DIR}/.." && pwd)/node_modules/.bin"

if [[ ! -x ${BIN}/eslint ]]; then
  printf 'lint.test.sh: %s/eslint is missing; run pnpm install first\n' "$BIN" >&2
  exit 2
fi

pass=0
fail=0
out=""
status=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

CLEAN='export const value = 1;'
BAD='debugger;'

# fresh — an empty fixture workspace with every kind of place a file can be:
# two apps, a package, the root, and a directory that is no project.
fresh() {
  rm -rf "${work:?}/ws"
  mkdir -p "$work/ws/apps/one" "$work/ws/apps/two" "$work/ws/packages/three" "$work/ws/scripts"
  cat >"$work/ws/eslint.config.js" <<'EOF'
export default [
  { ignores: ['**/dist/**'] },
  { rules: { 'no-debugger': 'error', 'no-console': 'warn' } },
];
EOF
  put apps/one/a.js "$CLEAN"
  put apps/two/b.js "$CLEAN"
  put packages/three/c.js "$CLEAN"
  put root.js "$CLEAN"
  put scripts/tool.mjs "$CLEAN"
}

# put PATH CONTENT — write one fixture file.
put() {
  mkdir -p "$(dirname "$work/ws/$1")"
  printf '%s\n' "$2" >"$work/ws/$1"
}

run() {
  out="$(cd "$work/ws" && PATH="${BIN}:${PATH}" bash "$LINT" "$@" 2>&1)"
  status=$?
}

ok() {
  printf 'ok   %s\n' "$1"
  pass=$((pass + 1))
}

not_ok() {
  printf 'FAIL %s\n' "$1"
  printf '     status %s, output:\n' "$status"
  printf '%s\n' "$out" | sed 's/^/     | /'
  fail=$((fail + 1))
}

expect_status() {
  if [[ $status -eq $1 ]]; then ok "$2"; else not_ok "$2 (expected exit $1)"; fi
}

expect_output() {
  if grep -qF -- "$1" <<<"$out"; then ok "$2"; else not_ok "$2 (expected: $1)"; fi
}

# expect_count N PATTERN DESCRIPTION — PATTERN (an extended regex) matches
# exactly N lines of the output.
expect_count() {
  local seen
  seen="$(grep -cE -- "$2" <<<"$out")"
  if [[ $seen -eq $1 ]]; then ok "$3"; else not_ok "$3 (expected $1 line(s) matching $2, saw $seen)"; fi
}

# expect_reported_once FILE DESCRIPTION — the stylish formatter names a file
# with a problem on a line of its own, once per process that linted it.
expect_reported_once() {
  expect_count 1 "/ws/$1\$" "$2"
}

# --- a clean tree ----------------------------------------------------------------

fresh
run
expect_status 0 'a clean tree exits 0'
expect_output 'lint: apps/one exit 0' 'apps/one is linted in a process of its own'
expect_output 'lint: apps/two exit 0' 'apps/two is linted in a process of its own'
expect_output 'lint: packages/three exit 0' 'packages/three is linted in a process of its own'
expect_output 'lint: everything outside apps/* and packages/* exit 0' 'the rest of the tree is linted'
expect_count 4 '^lint-memory: peak heap [0-9]+ MB of a [0-9]+ MB limit, peak RSS [0-9]+ MB$' \
  'every one of the four processes reports its peak heap'

# --- one problem, in each place a file can be -------------------------------------

for file in apps/one/a.js apps/two/b.js packages/three/c.js root.js scripts/tool.mjs apps/loose.js packages/loose.js; do
  fresh
  put "$file" "$BAD"
  run
  expect_status 1 "a problem in ${file} fails the run"
  expect_reported_once "$file" "${file} is reported, and only once"
done

# --- a failure is not swallowed by what runs after it ---------------------------

fresh
put apps/one/a.js "$BAD"
run
expect_status 1 'a problem in the FIRST process fails the run although every later one is clean'
expect_output 'lint: everything outside apps/* and packages/* exit 0' \
  'the processes after a failing one still run'

fresh
put root.js "$BAD"
run
expect_status 1 'a problem in the LAST process fails the run'

# --- every file once, when every file has a problem ------------------------------

fresh
for file in apps/one/a.js apps/two/b.js packages/three/c.js root.js scripts/tool.mjs; do
  put "$file" "$BAD"
done
run
expect_status 1 'problems everywhere fail the run'
expect_count 5 '^.*/ws/.*\.m?js$' 'five files with a problem are reported five times: none is linted twice'

# --- what eslint.config.js ignores stays ignored ---------------------------------

fresh
put packages/three/dist/bundle.js "$BAD"
put dist/bundle.js "$BAD"
run
expect_status 0 'a problem in an ignored directory, inside a project or outside one, is still ignored'

# --- a project with nothing to lint ---------------------------------------------

fresh
mkdir -p "$work/ws/packages/docs-only"
printf '# notes\n' >"$work/ws/packages/docs-only/README.md"
run
expect_status 0 'a project with no file to lint passes, as it does under eslint .'

fresh
put packages/built/dist/bundle.js "$BAD"
run
expect_status 0 'a project whose every file is ignored passes, as it does under eslint .'

# --- ESLint's own failure -------------------------------------------------------

fresh
printf 'export default [ {\n' >"$work/ws/eslint.config.js"
run
expect_status 2 'an ESLint config that does not load fails the run with ESLint'"'"'s own status'

# --- options reach every process -------------------------------------------------

fresh
put packages/three/c.js 'console.log(1);'
run
expect_status 0 'a warning alone passes'
run --max-warnings 0
expect_status 1 'an option reaches a project'"'"'s process (--max-warnings 0 fails on its warning)'

fresh
put root.js 'console.log(1);'
run --max-warnings 0
expect_status 1 'an option reaches the last process too'

# --- NODE_OPTIONS ---------------------------------------------------------------

fresh
out="$(cd "$work/ws" && PATH="${BIN}:${PATH}" NODE_OPTIONS='--max-old-space-size=200' bash "$LINT" 2>&1)"
status=$?
expect_status 0 'a run with NODE_OPTIONS already set passes'
expect_count 4 'of a 2[0-9][0-9] MB limit' \
  'NODE_OPTIONS already set is kept beside the memory reporter, in every process'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
((fail == 0))
