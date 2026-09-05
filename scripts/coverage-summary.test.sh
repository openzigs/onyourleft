#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/coverage-summary.mjs.
#
# Same shape as the other suites: each case builds a throwaway coverage report,
# renders it, and asserts on the output and the exit code.
#
# The failure mode worth spending cases on is a table that renders confidently
# and wrong. This script's only real logic is deciding which package a covered
# file belongs to, and it does that against ABSOLUTE paths that differ between a
# contributor's checkout, a CI runner and a git worktree. A matcher that stopped
# matching would drop whole packages out of the table and print the survivors
# with no indication anything was missing -- which reads exactly like a
# repository with fewer packages. So the cases below pin each path shape that
# must be attributed, each that must be ignored, and the arithmetic.
#
# Unlike the six checkers, this one needs Node -- it reads JSON. It is therefore
# NOT part of `pnpm run check:repo`, which is the bare-clone set.
#
# Run: bash scripts/coverage-summary.test.sh

# The assertions below hold literal Markdown -- backticks around package names,
# and `packages/*` globs -- which must reach `grep -F` unexpanded. They are
# single-quoted for that reason, so SC2016 is the intended shape rather than a
# mistake. Same call as scripts/check-licence-hashes.test.sh makes.
# shellcheck disable=SC2016

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER="${SCRIPT_DIR}/coverage-summary.mjs"

pass=0
fail=0
tmp=""

new_fixture() { tmp="$(mktemp -d)"; }
cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

# cell <covered> <total>
cell() { printf '{"total":%s,"covered":%s,"skipped":0,"pct":0}' "$2" "$1"; }

# file_entry <covered> <total>  -- the same numbers for all four metrics
file_entry() {
  printf '{"lines":%s,"statements":%s,"functions":%s,"branches":%s}' \
    "$(cell "$1" "$2")" "$(cell "$1" "$2")" "$(cell "$1" "$2")" "$(cell "$1" "$2")"
}

assert() {
  local name="$1" expected="$2" actual="$3"
  if printf '%s' "${actual}" | grep -qF -- "${expected}"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected to contain: %s\n  got:\n%s\n\n' "${name}" "${expected}" "${actual}"
  fi
}

assert_absent() {
  local name="$1" unexpected="$2" actual="$3"
  if printf '%s' "${actual}" | grep -qF -- "${unexpected}"; then
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected NOT to contain: %s\n  got:\n%s\n\n' "${name}" "${unexpected}" "${actual}"
  else
    pass=$((pass + 1))
  fi
}

# --- Path shapes that must be attributed -------------------------------------
# The three that actually occur: a plain checkout, a CI runner, and a worktree
# under .claude/. If any stops matching, that package vanishes from the table.
new_fixture
for prefix in \
  "/Users/someone/Development/onyourleft" \
  "/home/runner/work/onyourleft/onyourleft" \
  "/Users/someone/Development/onyourleft/.claude/worktrees/wf_abc-2"
do
  printf '{"total":{"lines":%s,"statements":%s,"functions":%s,"branches":%s},"%s/packages/domain/src/a.ts":%s}' \
    "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "${prefix}" "$(file_entry 3 4)" \
    > "${tmp}/c.json"
  out="$(node "${RENDER}" "${tmp}/c.json" 2>&1)"
  assert "attributes a file under ${prefix##*/}" '`packages/domain`' "${out}"
  assert "and computes its percentage" '75.00%' "${out}"
done

# --- Paths that must NOT be attributed ---------------------------------------
new_fixture
printf '{"total":{"lines":%s,"statements":%s,"functions":%s,"branches":%s},"/repo/scripts/x.mjs":%s,"/repo/node_modules/pkg/packages/domain/y.ts":%s}' \
  "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(file_entry 1 1)" "$(file_entry 1 1)" \
  > "${tmp}/c.json"
out="$(node "${RENDER}" "${tmp}/c.json" 2>&1)"
assert "warns when nothing matched" 'No `packages/*` or `apps/*` file appeared' "${out}"
# A node_modules path containing "packages/domain/" is the near-miss that would
# silently inflate a real package's numbers with a dependency's files.
assert_absent "ignores a packages/ segment inside node_modules" '| `packages/domain` |' "${out}"

# --- Arithmetic: files are summed, not averaged ------------------------------
# 1/4 and 3/4 is 4/8 = 50%. Averaging the two percentages gives the same answer,
# so the second file is deliberately a different SIZE: 1/4 and 7/12 sum to 8/16
# = 50%, where averaging the percentages would give 41.67%.
new_fixture
printf '{"total":{"lines":%s,"statements":%s,"functions":%s,"branches":%s},"/r/packages/store/src/a.ts":%s,"/r/packages/store/src/b.ts":%s}' \
  "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(file_entry 1 4)" "$(file_entry 7 12)" \
  > "${tmp}/c.json"
out="$(node "${RENDER}" "${tmp}/c.json" 2>&1)"
assert "sums counts rather than averaging percentages" '50.00%' "${out}"
assert_absent "does not average" '41.67%' "${out}"
assert "counts the files" '| 2 |' "${out}"

# --- apps/ is attributed too -------------------------------------------------
new_fixture
printf '{"total":{"lines":%s,"statements":%s,"functions":%s,"branches":%s},"/r/apps/web/src/a.ts":%s}' \
  "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(cell 1 1)" "$(file_entry 1 2)" > "${tmp}/c.json"
out="$(node "${RENDER}" "${tmp}/c.json" 2>&1)"
assert "attributes apps/" '`apps/web`' "${out}"

# --- A missing or unparseable report must FAIL, not render an empty table -----
# The whole point: an empty table reads like good news.
out="$(node "${RENDER}" "/nonexistent/c.json" 2>&1)"; code=$?
if [ "${code}" -ne 0 ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf 'FAIL: a missing report must exit non-zero\n'
fi
assert "and says which file" 'cannot read' "${out}"

new_fixture
printf 'not json' > "${tmp}/c.json"
out="$(node "${RENDER}" "${tmp}/c.json" 2>&1)"; code=$?
if [ "${code}" -ne 0 ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf 'FAIL: an unparseable report must exit non-zero\n'
fi

# --- It must never gate ------------------------------------------------------
# 0% everywhere still exits 0. A non-zero exit here would be the percentage
# floor that CLAUDE.md §5 forbids, arriving by the back door.
new_fixture
printf '{"total":{"lines":%s,"statements":%s,"functions":%s,"branches":%s},"/r/packages/domain/src/a.ts":%s}' \
  "$(cell 0 1)" "$(cell 0 1)" "$(cell 0 1)" "$(cell 0 1)" "$(file_entry 0 10)" > "${tmp}/c.json"
out="$(node "${RENDER}" "${tmp}/c.json" 2>&1)"; code=$?
if [ "${code}" -eq 0 ]; then pass=$((pass + 1)); else
  fail=$((fail + 1)); printf 'FAIL: 0%% coverage must still exit 0 -- this reports, it does not gate\n'
fi
assert "renders 0.00% without complaint" '0.00%' "${out}"

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ] || exit 1
