#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-shard-results.sh.
#
# The checker is the required check's whole verdict since #1285, so the case
# worth spending on is the pass it must not give: a shard that was skipped
# (GitHub counts a skipped required check as passing), cancelled at its stop,
# or absent altogether. The green cases are here so that a checker which
# simply always fails is not mistaken for a strict one.
#
# The fixtures are `toJSON(needs)` as the runner writes it -- pretty-printed,
# two spaces, an `outputs` object per job -- and one compact form, because the
# checker must not depend on the layout.
#
# Run: bash scripts/check-shard-results.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-shard-results.sh"

pass=0
fail=0

# needs_json <shard> <result> [<shard> <result> ...] -- as toJSON(needs) prints.
needs_json() {
  local out='{' first=1
  while [ "$#" -ge 2 ]; do
    [ "${first}" -eq 1 ] || out+=','
    first=0
    out+=$'\n'"  \"$1\": {"$'\n'"    \"result\": \"$2\","$'\n'"    \"outputs\": {}"$'\n'"  }"
    shift 2
  done
  printf '%s\n}\n' "${out}"
}

# assert_clean <name> <NEEDS>
assert_clean() {
  local name="$1" out status
  out="$(NEEDS="$2" bash "${CHECKER}" 2>&1)"
  status=$?
  if [ "${status}" -eq 0 ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit 0, got %s\n%s\n' "${name}" "${status}" "${out}"
  fi
}

# assert_violation <name> <rule> <expected-substring> <NEEDS>
assert_violation() {
  local name="$1" rule="$2" needle="$3" out status
  out="$(NEEDS="$4" bash "${CHECKER}" 2>&1)"
  status=$?
  if [ "${status}" -eq 1 ] \
     && grep -qF -- "${needle}" <<< "$(grep "^${rule}: " <<< "${out}")"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit 1 and a %s finding containing: %s\n     got exit %s:\n%s\n' \
      "${name}" "${rule}" "${needle}" "${status}" "${out}"
  fi
}

# assert_unset <name> -- NEEDS not in the environment at all.
assert_unset() {
  local name="$1" out status
  out="$(env -u NEEDS bash "${CHECKER}" 2>&1)"
  status=$?
  if [ "${status}" -eq 1 ] && grep -q '^SHARD002: ' <<< "${out}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit 1 and SHARD002, got exit %s:\n%s\n' "${name}" "${status}" "${out}"
  fi
}

# --- Green -------------------------------------------------------------------

assert_clean 'three shards that all succeeded pass' \
  "$(needs_json checks success tests success browser success)"

assert_clean 'one shard that succeeded passes' \
  "$(needs_json checks success)"

assert_clean 'the layout does not matter: compact JSON passes' \
  '{"checks":{"result":"success","outputs":{}},"browser-gate":{"result":"success","outputs":{}}}'

# --- Red: every result that is not success ------------------------------------

assert_violation 'a failed shard fails, and is named' SHARD001 \
  "the shard 'tests' ended as 'failure'" \
  "$(needs_json checks success tests failure browser success)"

assert_violation 'a cancelled shard fails (a job past its own stop ends as cancelled)' SHARD001 \
  "the shard 'browser' ended as 'cancelled'" \
  "$(needs_json checks success tests success browser cancelled)"

# The case the whole job exists for: GitHub counts a skipped required check as
# passing, so a shard that never ran must not be read as one that passed.
assert_violation 'a SKIPPED shard fails' SHARD001 \
  "the shard 'checks' ended as 'skipped'" \
  "$(needs_json checks skipped tests success browser success)"

assert_violation 'every shard skipped fails' SHARD001 \
  "the shard 'browser' ended as 'skipped'" \
  "$(needs_json checks skipped tests skipped browser skipped)"

assert_violation 'the LAST shard failing fails (not only the first is read)' SHARD001 \
  "the shard 'browser' ended as 'failure'" \
  "$(needs_json checks success tests success browser failure)"

assert_violation 'the FIRST shard failing fails (not only the last is read)' SHARD001 \
  "the shard 'checks' ended as 'failure'" \
  "$(needs_json checks failure tests success browser success)"

assert_violation 'a result that is not one of the four fails' SHARD001 \
  "the shard 'tests' ended as 'neutral'" \
  "$(needs_json checks success tests neutral)"

assert_violation 'an empty result fails' SHARD001 \
  "the shard 'tests' ended as '(empty)'" \
  "$(needs_json checks success tests '')"

assert_violation 'a result that merely contains the word fails' SHARD001 \
  "the shard 'tests' ended as 'unsuccess'" \
  "$(needs_json checks success tests unsuccess)"

# --- Red: nothing to read, the vacuous pass ----------------------------------

assert_violation 'no shard at all fails: a job that needs nothing proves nothing' SHARD002 \
  'no shard result in NEEDS' '{}'

assert_violation 'an empty NEEDS fails' SHARD002 'no shard result in NEEDS' ''

assert_unset 'an unset NEEDS fails'

assert_violation 'text that is not toJSON(needs) fails' SHARD002 \
  'no shard result in NEEDS' 'success'

# A result under a key the checker cannot read must not be left out of the
# verdict: here one of the two is a failure it would otherwise never see.
assert_violation 'a result it cannot read is refused, not skipped' SHARD002 \
  'NEEDS holds 2 results and 1 could be read' \
  '{"checks":{"result":"success","outputs":{}},"a.shard":{"result":"failure","outputs":{}}}'

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
