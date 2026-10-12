#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-shard-results.sh — the required check's verdict: every shard of
# `.github/workflows/rules.yml` succeeded. #1285.
#
# `main` requires ONE status check, whose context is exactly `Repository
# rules`. Since #1285 the work is done by several jobs running side by side
# (the shards) and the job that carries that name does nothing but run this
# over their results. It is the whole of what stands between a red shard and a
# green required check, so it has a suite (check-shard-results.test.sh) and
# that suite runs in a shard.
#
# ⚠️ Anything but `success` fails, and the list is not "failure". A job's result
# is one of `success`, `failure`, `cancelled` and `skipped`:
#   failure    a step failed, or a step ran past its own `timeout-minutes`
#   cancelled  the job ran past its `timeout-minutes`, or the run was cancelled
#   skipped    the job's `if:` was false, or a job it `needs` did not succeed
# `skipped` is the dangerous one. GitHub counts a SKIPPED required check as
# passing, and `needs.x.result == 'failure'` is false for a skipped shard, so
# both ordinary ways of writing this job let a shard that never ran through.
# A result this does not recognise fails too: a fifth value is not a pass.
#
# ⚠️ No shard at all fails as well (SHARD002). An aggregating job whose `needs:`
# was emptied would otherwise succeed over nothing, which is the vacuous pass.
#
# Input: the environment variable NEEDS, the workflow's `toJSON(needs)`:
#   { "checks": { "result": "success", "outputs": {} }, ... }
# Read with grep and tr rather than a JSON parser, like every bare-clone checker
# here: no Node, no jq, no install. It refuses what it cannot read (SHARD002)
# rather than skipping it.
#
# Rules:
#   SHARD001  a shard's result is not `success`
#   SHARD002  no shard result could be read, or part of NEEDS could not be read
#
# Usage: NEEDS='<toJSON(needs)>' scripts/check-shard-results.sh
# Exit:  0 when every shard succeeded and there is at least one; 1 otherwise.

set -uo pipefail

findings=0

report() {
  printf '%s: %s\n' "$1" "$2" >&2
  findings=$((findings + 1))
}

# One line, no whitespace, so an entry reads `"<shard>":{"result":"<result>"`
# however the JSON was laid out.
flat="$(printf '%s' "${NEEDS:-}" | tr -d ' \t\r\n')"

entries="$(grep -oE '"[A-Za-z0-9_-]+":\{"result":"[A-Za-z_]*"' <<< "${flat}" || true)"
entry_count=0
[ -n "${entries}" ] && entry_count="$(grep -c '' <<< "${entries}")"

# Every `"result":` in the input must be one this read. A result behind a key
# the pattern above does not take would otherwise be left out of the verdict.
result_count="$(grep -oF '"result":' <<< "${flat}" | grep -c '' || true)"

if [ "${entry_count}" -eq 0 ]; then
  report SHARD002 'no shard result in NEEDS: the aggregating job needs no shard, or NEEDS is not toJSON(needs)'
elif [ "${entry_count}" -ne "${result_count}" ]; then
  report SHARD002 "NEEDS holds ${result_count} results and ${entry_count} could be read"
fi

while IFS= read -r entry; do
  [ -n "${entry}" ] || continue
  shard="$(sed -E 's/^"([^"]+)".*/\1/' <<< "${entry}")"
  result="$(sed -E 's/.*"result":"([^"]*)"$/\1/' <<< "${entry}")"
  printf '%s: %s\n' "${shard}" "${result:-(empty)}"
  if [ "${result}" != 'success' ]; then
    report SHARD001 "the shard '${shard}' ended as '${result:-(empty)}', not 'success'"
  fi
done <<< "${entries}"

if [ "${findings}" -ne 0 ]; then
  printf '\nRepository rules: FAILED. Open the shard named above for what went red.\n' >&2
  exit 1
fi
printf '\nRepository rules: every one of %s shards succeeded.\n' "${entry_count}"
