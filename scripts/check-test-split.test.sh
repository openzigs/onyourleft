#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-test-split.mjs (#852, and #1076's third run).
#
# Same shape as check-a11y-suite.test.sh: each case builds a throwaway root with
# a package.json, supplies the four selections with `--lists` rather than by
# running Vitest, and asserts on the output and the exit code. CI runs the
# checker for real, with no `--lists`, before the two runs it checks.
#
# The cases that matter are the RED ones. The checker exists because splitting
# one run into three can drop a file from all of them and stay green, so a checker that
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

REQUIRED='vitest run --exclude src/slow.test.ts'
UNINSTRUMENTED='vitest run apps/web/src/slow.test.ts'
A11Y='vitest run --project web .a11y.test.'
# #2154: the required run's two parts, one per CI job.
SHARD_1='pnpm run test:required --project web'
SHARD_2="pnpm run test:required --project '!web'"
# #2285: the nightly coverage run's two halves, each writing the blob of its
# own number that `test:coverage:merge` reads.
BLOB_1='--reporter=default --reporter=blob --outputFile.blob=coverage-blobs/coverage-1.json'
BLOB_2='--reporter=default --reporter=blob --outputFile.blob=coverage-blobs/coverage-2.json'
COVERAGE_1="pnpm run test:coverage src/game/ ${BLOB_1}"
COVERAGE_2="pnpm run test:coverage --exclude 'src/game/**' ${BLOB_2}"

pass=0
fail=0
tmp=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

# new_fixture [test:required] [test:uninstrumented] [test:a11y] [test:coverage]
#             [test:required:shard-1] [test:required:shard-2]
#             [test:coverage:shard-1] [test:coverage:shard-2]
# -- a root whose package.json carries the eight scripts. An argument of `-`
# leaves that script out. `test:coverage` defaults to what it must be since
# #1280: `test:required` with `--coverage` after `run`.
new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  local required="${1-${REQUIRED}}" uninstrumented="${2-${UNINSTRUMENTED}}" a11y="${3-${A11Y}}"
  local coverage="${4-${required/#vitest run/vitest run --coverage}}"
  local shard1="${5-${SHARD_1}}" shard2="${6-${SHARD_2}}"
  local coverage1="${7-${COVERAGE_1}}" coverage2="${8-${COVERAGE_2}}"
  {
    printf '{"name":"f","scripts":{"test":"vitest run"'
    [ "${required}" != '-' ] && printf ',"test:required":"%s"' "${required}"
    [ "${coverage}" != '-' ] && printf ',"test:coverage":"%s"' "${coverage}"
    [ "${uninstrumented}" != '-' ] && printf ',"test:uninstrumented":"%s"' "${uninstrumented}"
    [ "${a11y}" != '-' ] && printf ',"test:a11y":"%s"' "${a11y}"
    [ "${shard1}" != '-' ] && printf ',"test:required:shard-1":"%s"' "${shard1}"
    [ "${shard2}" != '-' ] && printf ',"test:required:shard-2":"%s"' "${shard2}"
    [ "${coverage1}" != '-' ] && printf ',"test:coverage:shard-1":"%s"' "${coverage1}"
    [ "${coverage2}" != '-' ] && printf ',"test:coverage:shard-2":"%s"' "${coverage2}"
    printf '}}'
  } > "${tmp}/package.json"
  lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts apps/web/src/form.a11y.test.ts \
    packages/store/src/store.test.ts
  lists required apps/web/src/fast.test.ts packages/store/src/store.test.ts
  lists uninstrumented apps/web/src/slow.test.ts
  lists a11y apps/web/src/form.a11y.test.ts
}

# lists <all|required|uninstrumented|a11y|required-shard-N|coverage-shard-N> <path...> -- what
# `vitest list --filesOnly` would print for that selection.
lists() {
  local name="$1"
  shift
  : > "${tmp}/${name}.txt"
  local path
  # The project is the package's directory, as the workspace names it.
  for path in "$@"; do
    printf '[%s] %s\n' "$(cut -d/ -f2 <<< "${path}")" "${path}" >> "${tmp}/${name}.txt"
  done
}

# A case that does not write the parts' selections gets what the two default
# patterns would select from its required run: `web` and every other project.
# The coverage run's halves default to the same division (#2285).
run_check() {
  local part
  for part in required coverage; do
    [ -f "${tmp}/${part}-shard-1.txt" ] || grep '^\[web\] ' "${tmp}/required.txt" \
      > "${tmp}/${part}-shard-1.txt"
    [ -f "${tmp}/${part}-shard-2.txt" ] || grep -v '^\[web\] ' "${tmp}/required.txt" \
      > "${tmp}/${part}-shard-2.txt"
  done
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
assert_green 'three runs that are the whole suite, once each, pass'
assert_says 'and say what each run holds' 'all 4 test files run once — 2 in the required run, 1 without it (nightly), 1 in the Accessibility step'
assert_says 'and how the required run is divided' "the required run's 2 are 1 in \`test:required:shard-1\`, 1 in \`test:required:shard-2\`"
assert_says 'and how the coverage run is halved' "the coverage run's 2 are 1 in \`test:coverage:shard-1\`, 1 in \`test:coverage:shard-2\`"

new_fixture 'vitest run --exclude src/a.test.ts --exclude tools/b.test.ts' \
  'vitest run apps/web/src/a.test.ts packages/fit/tools/b.test.ts'
lists all apps/web/src/a.test.ts apps/web/src/c.test.ts packages/fit/tools/b.test.ts \
  apps/web/src/form.a11y.test.ts packages/fit/src/d.test.ts
lists required apps/web/src/c.test.ts packages/fit/src/d.test.ts
lists uninstrumented apps/web/src/a.test.ts packages/fit/tools/b.test.ts
run_check
assert_green 'two excludes and two filters, one file each, pass'

# --- A file in neither run ---------------------------------------------------
# The widened glob: `**/decode-fuzz.test.ts` also took packages/protocol's fuzz,
# which the uninstrumented run does not name. Measured against Vitest itself.
new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts packages/protocol/src/slow.test.ts \
  apps/web/src/form.a11y.test.ts
run_check
assert_red 'a file in no run fails'
assert_says 'and names it' 'packages/protocol/src/slow.test.ts runs in NONE'

# --- A file in both runs ------------------------------------------------------
# The exclude no longer matches (a repository-relative glob, or a rename).
new_fixture
lists required apps/web/src/fast.test.ts apps/web/src/slow.test.ts
run_check
assert_red 'a file in both runs fails'
assert_says 'and names it' 'apps/web/src/slow.test.ts runs in `test:required` and `test:uninstrumented`'

# --- An uninstrumented run over nothing --------------------------------------
new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/form.a11y.test.ts
lists uninstrumented
run_check
assert_red 'an uninstrumented run that selects nothing fails'
assert_says 'and says so' 'selects no files at all'
assert_says 'and says its filter selects nothing' 'selects 0 files'

# --- A filter that selects two files -----------------------------------------
new_fixture "${REQUIRED} --exclude src/slow.test.tsx" 'vitest run apps/web/src/slow.test.ts'
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts apps/web/src/slow.test.tsx \
  apps/web/src/form.a11y.test.ts
lists uninstrumented apps/web/src/slow.test.ts apps/web/src/slow.test.tsx
run_check
assert_red 'a filter selecting two files fails'
assert_says 'and says how many' 'selects 2 files where it must select exactly one'

# --- The whole suite selecting nothing ---------------------------------------
new_fixture
lists all
lists required
lists uninstrumented
lists a11y
run_check
assert_red 'a suite that selects nothing fails rather than comparing nothing'
assert_says 'and says so' 'the whole suite selects no files'

# --- Shapes this cannot check ------------------------------------------------
new_fixture - "${UNINSTRUMENTED}" "${A11Y}" 'vitest run --coverage --exclude src/slow.test.ts'
run_check
assert_red 'no test:required fails'
assert_says 'and names the script' 'no `test:required` script'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" -
run_check
assert_red 'no test:coverage fails'
assert_says 'and names the script' 'no `test:coverage` script'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED}"
run_check
assert_red 'a test:coverage without --coverage fails'
assert_says 'and names the script' '`test:coverage` is'

# --- The required run and the nightly report (#1280) --------------------------
new_fixture 'vitest run --coverage --exclude src/slow.test.ts' "${UNINSTRUMENTED}" "${A11Y}" \
  'vitest run --coverage --exclude src/slow.test.ts'
run_check
assert_red 'coverage on the required run fails'
assert_says 'and names the script' '`test:required` is'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" \
  'vitest run --coverage --exclude src/slow.test.ts --exclude src/fast.test.ts'
run_check
assert_red 'a report that leaves out a file the required run keeps fails'
assert_says 'and says why' 'the nightly coverage report is of the files the required job runs'

new_fixture "${REQUIRED} --exclude src/fast.test.ts" "${UNINSTRUMENTED}" "${A11Y}" \
  'vitest run --coverage --exclude src/slow.test.ts'
run_check
assert_red 'a required run that leaves out a file the report keeps fails'

new_fixture 'vitest run --exclude src/a.test.ts --exclude src/slow.test.ts' "${UNINSTRUMENTED}" \
  "${A11Y}" 'vitest run --coverage --exclude src/slow.test.ts --exclude src/a.test.ts'
run_check
assert_red 'the same globs in another order fail: the two scripts are kept identical'

new_fixture 'vitest run --exclude' "${UNINSTRUMENTED}"
run_check
assert_red 'a dangling --exclude fails'

new_fixture 'vitest run --exclude src/slow.test.ts --bail 1' "${UNINSTRUMENTED}"
run_check
assert_red 'any other flag in test:required fails'
assert_says 'and says what shape it expects' 'followed only by `--exclude <glob>` pairs'

new_fixture "${REQUIRED}" -
run_check
assert_red 'no test:uninstrumented fails'
assert_says 'and names the script' 'no `test:uninstrumented` script'

new_fixture "${REQUIRED}" 'vitest run --coverage apps/web/src/slow.test.ts'
run_check
assert_red 'coverage on the uninstrumented run fails'
assert_says 'and says what shape it expects' 'followed only by the paths'

new_fixture "${REQUIRED}" 'vitest run'
run_check
assert_red 'an uninstrumented run with no filter fails'

# --- What the shell would read first (#864) ----------------------------------
# pnpm runs a script through `sh`, so each of these would reach Vitest as
# something other than the words a split on spaces gives.
# #1076: a WHOLE word in single quotes is read as `sh` reads it -- one word,
# expanded not at all -- because an exclude glob needs them. Anything else
# about a quote is still refused.
new_fixture "vitest run --exclude 'src/slow test.ts'" "${UNINSTRUMENTED}"
run_check
assert_green 'a whole single-quoted exclude is read as one word, its space and all'

new_fixture "vitest run --exclude src/slow test.ts" "${UNINSTRUMENTED}"
run_check
assert_red 'the same exclude unquoted is two words, and the second is no --exclude pair'

new_fixture "vitest run --exclude '**/*.a11y.test.*'" "${UNINSTRUMENTED}"
run_check
assert_green 'a single-quoted glob is read, not refused'

new_fixture "vitest run --exclude src/'slow.test.ts'" "${UNINSTRUMENTED}"
run_check
assert_red 'a quote that opens mid-word fails'
assert_says 'and says why' 'reads quoting, globs, variables and separators'

new_fixture "vitest run --exclude 'src/slow.test.ts" "${UNINSTRUMENTED}"
run_check
assert_red 'an unclosed quote fails'

new_fixture 'vitest run --exclude \"src/*.test.ts\"' "${UNINSTRUMENTED}"
run_check
assert_red 'a double-quoted glob fails: sh still reads $ and backticks inside one'
assert_says 'and names the character' '"\""'

new_fixture 'vitest run --exclude src/*.test.ts' "${UNINSTRUMENTED}"
run_check
assert_red 'an exclude the shell would expand as a glob fails'
assert_says 'and names the character' '"*"'

new_fixture "${REQUIRED}" 'vitest run apps/web/src/slow.test.ts; true'
run_check
assert_red 'a command separator in test:uninstrumented fails'
assert_says 'and names the script' '`test:uninstrumented` is'

new_fixture "${REQUIRED}" 'vitest run $SLOW'
run_check
assert_red 'a variable in test:uninstrumented fails'
assert_says 'and says it is the refusal, not an empty selection' '"$"'

# --- The accessibility run (#1076) --------------------------------------------
new_fixture
lists required apps/web/src/fast.test.ts apps/web/src/form.a11y.test.ts
run_check
assert_red 'an accessibility test in the required run as well fails'
assert_says 'and names both runs' 'apps/web/src/form.a11y.test.ts runs in `test:required` and `test:a11y`'

new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts apps/web/src/form.a11y.test.ts \
  packages/store/src/form.a11y.test.ts
run_check
assert_red 'an accessibility test outside the project test:a11y names runs nowhere, and fails'
assert_says 'and names it' 'packages/store/src/form.a11y.test.ts runs in NONE'

new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts
lists a11y
run_check
assert_red 'an accessibility run that selects nothing fails'
assert_says 'and says so' '`test:a11y` selects no files at all'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" -
run_check
assert_red 'no test:a11y fails'
assert_says 'and names the script' 'no `test:a11y` script'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" 'vitest run .a11y.test.'
run_check
assert_red 'a test:a11y with no --project fails'
assert_says 'and says what shape it expects' 'expects `vitest run --project <name>`'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" 'vitest run --coverage --project web .a11y.test.'
run_check
assert_red 'coverage on the accessibility run fails'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" 'vitest run --project web'
run_check
assert_red 'a test:a11y with no filter fails'

# --- The required run's parts, one per CI job (#2154) ------------------------
new_fixture
lists required-shard-1 apps/web/src/fast.test.ts
lists required-shard-2
run_check
assert_red 'a part of the required run that selects nothing fails'
assert_says 'and names the part' '`test:required:shard-2` selects no files at all'

new_fixture
lists required-shard-1 apps/web/src/fast.test.ts packages/store/src/store.test.ts
lists required-shard-2 packages/store/src/store.test.ts
run_check
assert_red 'a file in two parts of the required run fails'
assert_says 'and names it and both parts' 'packages/store/src/store.test.ts runs in `test:required:shard-1` and `test:required:shard-2`'

new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts apps/web/src/form.a11y.test.ts \
  packages/store/src/store.test.ts packages/zz/src/new.test.ts
lists required apps/web/src/fast.test.ts packages/store/src/store.test.ts packages/zz/src/new.test.ts
lists required-shard-1 apps/web/src/fast.test.ts
lists required-shard-2 packages/store/src/store.test.ts
run_check
assert_red 'a required file in no part of the required run fails'
assert_says 'and names it' 'packages/zz/src/new.test.ts is in `test:required` and in NONE of its parts'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" -
run_check
assert_red 'a required run in one part fails: it is divided between at least two jobs'
assert_says 'and says how many it found' 'package.json has 1 `test:required:shard-<n>` scripts'

new_fixture
node -e 'const f=process.argv[1], p=JSON.parse(require("fs").readFileSync(f));
  p.scripts["test:required:shard-3"]=p.scripts["test:required:shard-2"];
  delete p.scripts["test:required:shard-2"]; require("fs").writeFileSync(f, JSON.stringify(p));' \
  "${tmp}/package.json"
lists required-shard-3 packages/store/src/store.test.ts
run_check
assert_red 'a gap in the parts numbering fails'
assert_says 'and names the part after it' '`test:required:shard-3` follows `test:required:shard-1`'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  'vitest run --project web' "${SHARD_2}"
run_check
assert_red 'a part that is not test:required plus a project filter fails'
assert_says 'and says what shape it expects' 'followed only by `--project <pattern>` pairs'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  'pnpm run test:required --project web --coverage' "${SHARD_2}"
run_check
assert_red 'coverage on a part of the required run fails'
assert_says 'and names the part' '`test:required:shard-1` is'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  'pnpm run test:required' "${SHARD_2}"
run_check
assert_red 'a part with no project filter fails: it would be the whole run again'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  'pnpm run test:required --project web --project' "${SHARD_2}"
run_check
assert_red 'a dangling --project fails'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  'pnpm run test:required --project web --bail 1' "${SHARD_2}"
run_check
assert_red 'any other flag in a part of the required run fails'
assert_says 'and names the part' '`test:required:shard-1` is'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" 'pnpm run test:required --project !web'
run_check
assert_red 'an unquoted ! fails: the check reads only plain words and whole single-quoted ones'

# --- The nightly coverage run's halves, one per job (#2285) -------------------
# Each is red here rather than a merged report that is green and counts less:
# a file in no half is a file whose lines the report never sees.
new_fixture
lists coverage-shard-1 apps/web/src/fast.test.ts
lists coverage-shard-2
run_check
assert_red 'a half of the coverage run that selects nothing fails'
assert_says 'and names the half' '`test:coverage:shard-2` selects no files at all'

new_fixture
lists coverage-shard-1 apps/web/src/fast.test.ts packages/store/src/store.test.ts
lists coverage-shard-2 packages/store/src/store.test.ts
run_check
assert_red 'a file in both halves of the coverage run fails'
assert_says 'and names it and both halves' 'packages/store/src/store.test.ts runs in `test:coverage:shard-1` and `test:coverage:shard-2`'

new_fixture
lists all apps/web/src/fast.test.ts apps/web/src/slow.test.ts apps/web/src/form.a11y.test.ts \
  packages/store/src/store.test.ts packages/zz/src/new.test.ts
lists required apps/web/src/fast.test.ts packages/store/src/store.test.ts packages/zz/src/new.test.ts
lists required-shard-1 apps/web/src/fast.test.ts
lists required-shard-2 packages/store/src/store.test.ts packages/zz/src/new.test.ts
lists coverage-shard-1 apps/web/src/fast.test.ts
lists coverage-shard-2 packages/store/src/store.test.ts
run_check
assert_red 'a file of the coverage run in neither half fails'
assert_says 'and names it' 'packages/zz/src/new.test.ts is in `test:coverage` and in NONE of its halves'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "${COVERAGE_1}" -
run_check
assert_red 'a coverage run in one half fails: it is divided between at least two jobs'
assert_says 'and says how many it found' 'package.json has 1 `test:coverage:shard-<n>` scripts'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "${COVERAGE_1}" -
node -e 'const f=process.argv[1], p=JSON.parse(require("fs").readFileSync(f));
  p.scripts["test:coverage:shard-3"]=process.argv[2]; require("fs").writeFileSync(f, JSON.stringify(p));' \
  "${tmp}/package.json" "pnpm run test:coverage --exclude 'src/game/**' ${BLOB_2/coverage-2/coverage-3}"
lists coverage-shard-3 packages/store/src/store.test.ts
run_check
assert_red 'a gap in the halves numbering fails'
assert_says 'and names the half after it' '`test:coverage:shard-3` follows `test:coverage:shard-1`'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "pnpm run test:coverage --project web ${BLOB_1}" "${COVERAGE_2}"
run_check
assert_red 'a project filter on a half of the coverage run fails'
assert_says 'and says what it would lose' 'narrows the coverage report to that project'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" 'pnpm run test:coverage src/game/' "${COVERAGE_2}"
run_check
assert_red 'a half that writes no blob fails: the merge would have nothing of it'
assert_says 'and says what shape it expects' "and then \`${BLOB_1}\`"

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "pnpm run test:coverage src/game/ ${BLOB_2}" "${COVERAGE_2}"
run_check
assert_red 'a half writing the other half’s blob fails: one download would overwrite the other'
assert_says 'and names the half' '`test:coverage:shard-1` is'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "pnpm run test:coverage ${BLOB_1}" "${COVERAGE_2}"
run_check
assert_red 'a half with no filter or exclude fails: it would be the whole run again'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "pnpm run test:coverage src/game/ --bail 1 ${BLOB_1}" "${COVERAGE_2}"
run_check
assert_red 'any other flag in a half of the coverage run fails'
assert_says 'and names the half' '`test:coverage:shard-1` is'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "${COVERAGE_1}" "pnpm run test:coverage --exclude ${BLOB_2}"
run_check
assert_red 'a dangling --exclude in a half fails'
assert_says 'and names the half' '`test:coverage:shard-2` is'

new_fixture "${REQUIRED}" "${UNINSTRUMENTED}" "${A11Y}" "${REQUIRED/#vitest run/vitest run --coverage}" \
  "${SHARD_1}" "${SHARD_2}" "pnpm run test:required src/game/ ${BLOB_1}" "${COVERAGE_2}"
run_check
assert_red 'a half that is not test:coverage fails: it would take no coverage'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ] || exit 1
