#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# run-concurrently.sh — run several commands at once, and fail if ANY of them
# fails. #651.
#
# The `Repository rules` job is one job on purpose: `main` requires a status
# check whose context is exactly that string, and a second job reports under a
# different context and cannot block a merge (docs/agents/ci.md §4c). So the only way to
# use more than one of the runner's four CPUs is to run commands concurrently
# INSIDE a step, and this is the one place that is done.
#
# ⚠️ A concurrent step is a gate removed if its failure can be swallowed, and
# the two ordinary ways of writing one both swallow it: `a & b & wait` exits 0
# whatever `a` and `b` did, and `a | prefix &` reports the PREFIXER's status.
# So each command runs in a subshell with `pipefail`, every process id is
# waited on by itself, and the step exits non-zero when any one of them did.
# Nothing is killed early: a sequential job stops at its first failure, and this
# lets every command finish, so one run reports every failure at once.
#
# Output stays readable in two ways. Every line is printed as it arrives,
# prefixed with its command's label — so a job that is cancelled at its timeout
# still has a log saying how far each command got. And the full output of each
# command that FAILED is printed again at the end, unprefixed and in one piece,
# under its label.
#
# Usage: scripts/run-concurrently.sh LABEL COMMAND [LABEL COMMAND ...]
#        Each COMMAND is run by `bash -c`, from the current directory.
# Exit:  0 when every command exited 0; 1 when any did not; 2 on a usage error —
#        including no commands at all, because running nothing is not a pass.

set -uo pipefail

if (($# == 0 || $# % 2 != 0)); then
  printf 'usage: %s LABEL COMMAND [LABEL COMMAND ...]\n' "${0##*/}" >&2
  printf 'run-concurrently: expected label/command pairs, got %d argument(s)\n' "$#" >&2
  exit 2
fi

logs="$(mktemp -d)"
trap 'rm -rf "$logs"' EXIT

labels=()
pids=()
started=()

# prefix LABEL — copy stdin to stdout a line at a time, each line labelled. A
# last line with no newline is still printed.
prefix() {
  local line
  while IFS= read -r line || [[ -n $line ]]; do
    printf '[%s] %s\n' "$1" "$line"
  done
}

index=0
while (($# > 0)); do
  label="$1"
  command="$2"
  shift 2
  if [[ -z $label || -z $command ]]; then
    printf 'run-concurrently: an empty label or command (pair %d)\n' "$((index + 1))" >&2
    exit 2
  fi
  labels+=("$label")
  started+=("$SECONDS")
  printf '[%s] $ %s\n' "$label" "$command"
  (
    set -o pipefail
    bash -c "$command" 2>&1 | tee "${logs}/${index}" | prefix "$label"
    status=$?
    printf '%s\n' "$SECONDS" > "${logs}/${index}.end"
    exit "$status"
  ) &
  pids+=("$!")
  index=$((index + 1))
done

statuses=()
for i in "${!pids[@]}"; do
  wait "${pids[$i]}"
  statuses+=("$?")
done

failed=0
printf '\nrun-concurrently: %d command(s)\n' "${#labels[@]}"
for i in "${!labels[@]}"; do
  # Whole seconds, from the command starting to its output closing.
  ended="$(cat "${logs}/${i}.end" 2>/dev/null || printf '%s' "$SECONDS")"
  elapsed=$((ended - started[i]))
  if ((statuses[i] == 0)); then
    printf '  ok      %-44s %4d s\n' "${labels[$i]}" "$elapsed"
  else
    printf '  FAILED  %-44s %4d s  exit %d\n' "${labels[$i]}" "$elapsed" "${statuses[$i]}"
    failed=$((failed + 1))
  fi
done

for i in "${!labels[@]}"; do
  if ((statuses[i] != 0)); then
    printf '\n----- %s: exit %d, its whole output -----\n' "${labels[$i]}" "${statuses[$i]}"
    cat "${logs}/${i}"
  fi
done

if ((failed > 0)); then
  printf '\nrun-concurrently: %d of %d command(s) failed\n' "$failed" "${#labels[@]}" >&2
  exit 1
fi
exit 0
