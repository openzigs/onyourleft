#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-test-split.mjs (#852).
#
# Same shape as check-a11y-suite.test.sh: each case builds a throwaway root with
# a package.json, supplies the three selections with `--lists` rather than by
# running Vitest, and asserts on the output and the exit code. CI runs the
# checker for real, with no `--lists`, before the two runs it checks.
#
# The cases that matter are the RED ones. The checker exists because splitting
# one run into two can drop a file from both and stay green, so a checker that
# always exits 0 would be indistinguishable from a sound split.
#
# Needs Node, so it is NOT part of `pnpm run check:repo`, the bare-clone set.
#
# Run: bash scripts/check-test-split.test.sh

# The assertions hold literal backticks, which must reach `grep -F` unexpanded.
# shellcheck disable=SC2016

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-test-split.mjs"

COVERAGE='vitest run --coverage --exclude src/slow.test.ts'
UNINSTRUMENTED='vitest run apps/web/src/slow.test.ts'

pass=0
fail=0
tmp=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

# new_fixture [test:coverage] [test:uninstrumented] -- a root whose package.json
# carries the two scripts. An argument of `-` leaves that script out.
new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  local coverage="${1-${COVERAGE}}" uninstrumented="${2-${UNINSTRUMENTED}}"
  {
    printf '{"name":"f","scripts":{"test":"vitest run"'
    [ "${coverage}" != '-' ] && printf ',"test:coverage":"%s"' "${coverage}"
    [ "${uninstrumented}" != '-' ] && printf ',"test:uninstrumented":"%s"' "${uninstrumented}"
    printf '}}'
  } > "${tmp}/package.json"
  lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts
  lists instrumented apps/web/src/fast.test.ts
  lists uninstrumented apps/web/src/slow.test.ts
}

# lists <all|instrumented|uninstrumented> <path...> -- what `vitest list
# --filesOnly` would print for that selection.
lists() {
  local name="$1"
  shift
  : > "${tmp}/${name}.txt"
  local path
  for path in "$@"; do printf '[web] %s\n' "${path}" >> "${tmp}/${name}.txt"; done
}

run_check() {
  out="$(node "${CHECK}" --root "${tmp}" --lists "${tmp}" 2>&1)"
  code=$?
}

assert_green() {
  if [ "${code}" -eq 0 ]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf 'FAIL: %s\n  expected exit 0, got %d:\n%s\n\n' "$1" "${code}" "${out}"
  fi
}

assert_red() {
  if [ "${code}" -ne 0 ]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf 'FAIL: %s\n  expected a non-zero exit, got 0:\n%s\n\n' "$1" "${out}"
  fi
}

assert_says() {
  if grep -qF -- "$2" <<< "${out}"; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf 'FAIL: %s\n  expected to contain: %s\n  got:\n%s\n\n' "$1" "$2" "${out}"
  fi
}

# --- The sound split ---------------------------------------------------------
new_fixture
run_check
assert_green 'two runs that are the whole suite, once each, pass'
assert_says 'and say what each run holds' 'all 2 test files run once — 1 under coverage, 1 without it'

new_fixture 'vitest run --coverage --exclude src/a.test.ts --exclude tools/b.test.ts' \
  'vitest run apps/web/src/a.test.ts packages/fit/tools/b.test.ts'
lists all apps/web/src/a.test.ts apps/web/src/c.test.ts packages/fit/tools/b.test.ts
lists instrumented apps/web/src/c.test.ts
lists uninstrumented apps/web/src/a.test.ts packages/fit/tools/b.test.ts
run_check
assert_green 'two excludes and two filters, one file each, pass'

# --- A file in neither run ---------------------------------------------------
# The widened glob: `**/decode-fuzz.test.ts` also took packages/protocol's fuzz,
# which the uninstrumented run does not name. Measured against Vitest itself.
new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts packages/protocol/src/slow.test.ts
run_check
assert_red 'a file in neither run fails'
assert_says 'and names it' 'packages/protocol/src/slow.test.ts runs in NEITHER'

# --- A file in both runs ------------------------------------------------------
# The exclude no longer matches (a repository-relative glob, or a rename).
new_fixture
lists instrumented apps/web/src/fast.test.ts apps/web/src/slow.test.ts
run_check
assert_red 'a file in both runs fails'
assert_says 'and names it' 'apps/web/src/slow.test.ts runs in BOTH'

# --- An uninstrumented run over nothing --------------------------------------
new_fixture
lists all apps/web/src/fast.test.ts
lists uninstrumented
run_check
assert_red 'an uninstrumented run that selects nothing fails'
assert_says 'and says so' 'selects no files at all'
assert_says 'and says its filter selects nothing' 'selects 0 files'

# --- A filter that selects two files -----------------------------------------
new_fixture "${COVERAGE} --exclude src/slow.test.tsx" 'vitest run apps/web/src/slow.test.ts'
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts apps/web/src/slow.test.tsx
lists uninstrumented apps/web/src/slow.test.ts apps/web/src/slow.test.tsx
run_check
assert_red 'a filter selecting two files fails'
assert_says 'and says how many' 'selects 2 files where it must select exactly one'

# --- The whole suite selecting nothing ---------------------------------------
new_fixture
lists all
lists instrumented
lists uninstrumented
run_check
assert_red 'a suite that selects nothing fails rather than comparing nothing'
assert_says 'and says so' 'the whole suite selects no files'

# --- Shapes this cannot check ------------------------------------------------
new_fixture - "${UNINSTRUMENTED}"
run_check
assert_red 'no test:coverage fails'
assert_says 'and names the script' 'no `test:coverage` script'

new_fixture 'vitest run' "${UNINSTRUMENTED}"
run_check
assert_red 'a test:coverage without --coverage fails'

new_fixture 'vitest run --coverage --exclude' "${UNINSTRUMENTED}"
run_check
assert_red 'a dangling --exclude fails'

new_fixture 'vitest run --coverage --exclude src/slow.test.ts --bail 1' "${UNINSTRUMENTED}"
run_check
assert_red 'any other flag in test:coverage fails'
assert_says 'and says what shape it expects' 'followed only by `--exclude <glob>` pairs'

new_fixture "${COVERAGE}" -
run_check
assert_red 'no test:uninstrumented fails'
assert_says 'and names the script' 'no `test:uninstrumented` script'

new_fixture "${COVERAGE}" 'vitest run --coverage apps/web/src/slow.test.ts'
run_check
assert_red 'coverage on the uninstrumented run fails'
assert_says 'and says what shape it expects' 'followed only by the paths'

new_fixture "${COVERAGE}" 'vitest run'
run_check
assert_red 'an uninstrumented run with no filter fails'

# --- What the shell would read first (#864) ----------------------------------
# pnpm runs a script through `sh`, so each of these would reach Vitest as
# something other than the words a split on spaces gives.
new_fixture "vitest run --coverage --exclude 'src/slow test.ts'" "${UNINSTRUMENTED}"
run_check
assert_red 'a quoted exclude fails rather than being split on its space'
assert_says 'and says why' 'reads quoting, globs, variables and separators'

new_fixture 'vitest run --coverage --exclude src/*.test.ts' "${UNINSTRUMENTED}"
run_check
assert_red 'an exclude the shell would expand as a glob fails'
assert_says 'and names the character' '"*"'

new_fixture "${COVERAGE}" 'vitest run apps/web/src/slow.test.ts; true'
run_check
assert_red 'a command separator in test:uninstrumented fails'
assert_says 'and names the script' '`test:uninstrumented` is'

new_fixture "${COVERAGE}" 'vitest run $SLOW'
run_check
assert_red 'a variable in test:uninstrumented fails'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ] || exit 1
