#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-a11y-suite.mjs.
#
# Same shape as the other suites: each case builds a throwaway repository, runs
# the checker against it, and asserts on the output and the exit code.
#
# The checker exists because a gate can pass while covering less than it claims
# (#142), so the cases that matter are the ones where it must go RED. A checker
# that always exits 0 would be indistinguishable from a correctly covered gate,
# which is the same defect one level up.
#
# The selection is supplied with `--selected` rather than by running Vitest, so
# a case costs milliseconds and needs no workspace. That seam is not a gap: the
# CI step runs the checker for real, with no `--selected`, against the actual
# `test:a11y` selector immediately before the gate itself.
#
# Unlike the six checkers, this one needs Node. It is therefore NOT part of
# `pnpm run check:repo`, which is the bare-clone set.
#
# Run: bash scripts/check-a11y-suite.test.sh

# The assertions below hold literal Markdown-ish text with backticks and `*`
# globs which must reach `grep -F` unexpanded. Single-quoted for that reason,
# so SC2016 is the intended shape rather than a mistake. Same call as
# scripts/coverage-summary.test.sh makes.
# shellcheck disable=SC2016

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-a11y-suite.mjs"

pass=0
fail=0
tmp=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

# new_fixture [test:a11y script]  -- a repository root with a package.json.
new_fixture() {
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/apps/web/src/a11y"
  local script="${1-vitest run --project web .a11y.test.}"
  printf '{"name":"f","scripts":{"test:a11y":"%s"}}' "${script}" > "${tmp}/package.json"
}

# new_fixture_without_script -- a package.json with no `test:a11y` at all.
new_fixture_without_script() {
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/apps/web/src/a11y"
  printf '{"name":"f","scripts":{"test":"vitest run"}}' > "${tmp}/package.json"
}

# touch_test <relative path>  -- an empty test file at that path in the fixture.
touch_test() {
  mkdir -p "$(dirname "${tmp}/$1")"
  : > "${tmp}/$1"
}

# selection <path...>  -- write what `vitest list --filesOnly` would print.
selection() {
  : > "${tmp}/selected.txt"
  local path
  for path in "$@"; do printf '[web] %s\n' "${path}" >> "${tmp}/selected.txt"; done
}

# run_check -- output on stdout+stderr, exit code in ${code}.
run_check() {
  out="$(node "${CHECK}" --root "${tmp}" --selected "${tmp}/selected.txt" 2>&1)"
  code=$?
}

assert_green() {
  local name="$1"
  if [ "${code}" -eq 0 ]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf 'FAIL: %s\n  expected exit 0, got %d:\n%s\n\n' "${name}" "${code}" "${out}"
  fi
}

assert_red() {
  local name="$1"
  if [ "${code}" -ne 0 ]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); printf 'FAIL: %s\n  expected a non-zero exit, got 0:\n%s\n\n' "${name}" "${out}"
  fi
}

assert_says() {
  local name="$1" expected="$2"
  if printf '%s' "${out}" | grep -qF -- "${expected}"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected to contain: %s\n  got:\n%s\n\n' "${name}" "${expected}" "${out}"
  fi
}

# --- The covered case --------------------------------------------------------
new_fixture
touch_test apps/web/src/a11y/audit.a11y.test.ts
touch_test apps/web/src/a11y/routes.a11y.test.tsx
touch_test apps/web/src/ride/metrics.test.ts
selection apps/web/src/a11y/audit.a11y.test.ts apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_green 'a gate that runs every accessibility test passes'
assert_says 'and says how many it counted' 'runs all 2 accessibility test files'

# --- An accessibility test the gate does not run -----------------------------
# The direct form of #142: a file carrying the convention that the selector
# stopped matching.
new_fixture
touch_test apps/web/src/a11y/audit.a11y.test.ts
touch_test apps/web/src/a11y/routes.a11y.test.tsx
selection apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_red 'an accessibility test outside the selection fails'
assert_says 'and names the file' 'apps/web/src/a11y/audit.a11y.test.ts'
assert_says 'and says the gate does not run it' 'the gate does not run'

# --- A selector that matched the directory instead of the filename -----------
# This is the pre-#142 selector's signature: it picks up `audit.test.ts` because
# the path contains `a11y`, not because the file is named as one.
new_fixture 'vitest run --project web a11y'
touch_test apps/web/src/a11y/audit.test.ts
touch_test apps/web/src/a11y/routes.a11y.test.tsx
selection apps/web/src/a11y/audit.test.ts apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_red 'a directory-substring selector fails'
assert_says 'and says the selected file lacks the convention' 'does not carry the'

# --- A new accessibility test that forgets the convention --------------------
# Criterion 3 of #142: adding a file to the gate must not require a CI edit, and
# failing to name it correctly must fail the build rather than skip it silently.
new_fixture
touch_test apps/web/src/a11y/routes.a11y.test.tsx
touch_test apps/web/src/a11y/newrule.test.ts
selection apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_red 'an unconventionally named test in the a11y directory fails'
assert_says 'and names it' 'apps/web/src/a11y/newrule.test.ts'

# --- The same, after the directory has been renamed --------------------------
# `accessibility/` is recognised as well as `a11y/`, because the rename in the
# issue is exactly the change that would otherwise take the directory out of
# this check's sight.
new_fixture
mkdir -p "${tmp}/apps/web/src/accessibility"
touch_test apps/web/src/accessibility/routes.a11y.test.tsx
touch_test apps/web/src/accessibility/newrule.test.ts
selection apps/web/src/accessibility/routes.a11y.test.tsx
run_check
assert_red 'the renamed directory is still watched'
assert_says 'and names the unconventional file' 'apps/web/src/accessibility/newrule.test.ts'

# --- A conventionally named test outside any a11y directory ------------------
# The convention is what the gate selects on, so a file carrying it anywhere
# under apps/ must be in the gate.
new_fixture
touch_test apps/web/src/shell/nav.a11y.test.tsx
selection
run_check
assert_red 'a convention-named test elsewhere in apps/ must be selected'
assert_says 'and names it' 'apps/web/src/shell/nav.a11y.test.tsx'

# --- An ordinary test is not an accessibility test ---------------------------
new_fixture
touch_test apps/web/src/a11y/routes.a11y.test.tsx
touch_test apps/web/src/ride/metrics.test.ts
touch_test apps/web/src/design/Button.test.tsx
selection apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_green 'ordinary tests elsewhere are none of this check business'

# --- Deletion ----------------------------------------------------------------
# Vitest already exits non-zero on an empty selection; this check says so too,
# so the reason appears in the log rather than only the symptom.
new_fixture
selection
run_check
assert_red 'an empty selection fails'
assert_says 'and says so plainly' 'selects no files at all'

# --- node_modules and build output are not source ----------------------------
new_fixture
touch_test apps/web/src/a11y/routes.a11y.test.tsx
touch_test apps/web/node_modules/dep/a11y/other.test.ts
touch_test apps/web/dist/a11y/bundled.test.ts
selection apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_green 'a dependency own a11y directory is not this repository test'

# --- A gate this checker cannot read must FAIL, not pass ---------------------
# The whole point: a check that cannot verify the selector and says nothing is
# the vacuous pass again, one level up.
new_fixture 'vitest --project web .a11y.test.'
touch_test apps/web/src/a11y/routes.a11y.test.tsx
selection apps/web/src/a11y/routes.a11y.test.tsx
run_check
assert_red 'an unreadable test:a11y script fails'
assert_says 'and quotes the script it could not read' 'which this check cannot read'

new_fixture_without_script
selection
run_check
assert_red 'a missing test:a11y script fails'
assert_says 'and says which script is missing' 'no `test:a11y` script'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ] || exit 1
