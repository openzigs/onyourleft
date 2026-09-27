#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/run-concurrently.sh (#651).
#
# The failure worth spending cases on is the SWALLOWED one: a concurrent step
# that exits 0 while one of its commands failed is a gate removed, and it looks
# exactly like a green run. So most cases below make one command fail and
# require the runner to say so — whichever position it is in, whether it ends
# before or after the others, and whether or not it printed anything. The rest
# pin that the commands really do run at the same time (a runner that ran them
# one after another would pass every exit-code case and save nothing), that no
# output is lost, and that running nothing is refused rather than passed.
#
# Run: bash scripts/run-concurrently.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SCRIPT_DIR}/run-concurrently.sh"

pass=0
fail=0
out=""
status=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

run() {
  out="$(cd "$work" && bash "$RUNNER" "$@" 2>&1)"
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

expect_no_output() {
  if grep -qF -- "$1" <<<"$out"; then not_ok "$2 (did not expect: $1)"; else ok "$2"; fi
}

# --- every command succeeds ------------------------------------------------------

run one 'echo alpha' two 'echo beta'
expect_status 0 'two commands that both succeed exit 0'
expect_output '[one] alpha' 'the first command'"'"'s output is printed with its label'
expect_output '[two] beta' 'the second command'"'"'s output is printed with its label'
expect_output 'ok      one' 'the summary lists the first command as ok'
expect_no_output 'FAILED' 'nothing is reported as failed'

run solo 'true'
expect_status 0 'a single command that succeeds exits 0'

# --- one command fails: every position, every order ------------------------------

run first 'exit 3' second 'true'
expect_status 1 'a failing FIRST command fails the run'
expect_output 'FAILED  first' 'the summary names the failing command'
expect_output 'exit 3' 'the summary gives its exit status'

run first 'true' second 'exit 4'
expect_status 1 'a failing LAST command fails the run — every process is waited on, not only the first'

run first 'true' middle 'exit 5' last 'true'
expect_status 1 'a failing command in the middle fails the run'

# The one that fails finishes long after the one that succeeds, and the other
# way round: a runner that took the status of whichever ended first or last
# would pass one of these.
run quick 'true' slow 'sleep 1; exit 6'
expect_status 1 'a failure that ends AFTER a success fails the run'
run quick 'exit 7' slow 'sleep 1; true'
expect_status 1 'a failure that ends BEFORE a success fails the run'
expect_output 'ok      slow' 'the slower success still runs to the end rather than being killed'

run quiet 'exit 8'
expect_status 1 'a command that fails without printing anything still fails the run'

# The status must be the COMMAND's, not the labelling pipeline's: a runner that
# piped each command through its prefixer without pipefail would report the
# prefixer's 0 here.
run piped 'printf "some output\n"; exit 9'
expect_status 1 'a failing command whose output went through the prefixer still fails the run'
expect_output 'exit 9' 'and the status reported is the command'"'"'s own'

run both 'exit 1' failing 'exit 2'
expect_status 1 'two failing commands fail the run'
expect_output '2 of 2 command(s) failed' 'and both are counted'

# --- output ----------------------------------------------------------------------

run noisy 'printf "line one\nline two\n"; printf "no newline at the end"'
expect_output '[noisy] line two' 'every line is labelled'
expect_output '[noisy] no newline at the end' 'a last line with no newline is not lost'

run err 'echo "on stderr" >&2'
expect_output '[err] on stderr' 'standard error is captured and labelled too'

run broken 'echo "the reason it broke"; exit 1' fine 'echo unrelated'
expect_output '----- broken: exit 1, its whole output -----' "a failing command's whole output is printed again at the end"
expect_no_output '----- fine:' "a command that succeeded is not printed again"

# --- they really do run at the same time -----------------------------------------

# A rendezvous: each command announces itself and then waits for the other to
# have done so. Run concurrently, both succeed; run one after the other, in
# EITHER order, whichever goes first waits for a file nobody is going to write
# and fails. So a runner that quietly serialised the commands goes red here.
rm -f "${work}/one" "${work}/two"
# shellcheck disable=SC2016 # expanded by the command's own shell, not this one
wait_for='for _ in $(seq 100); do [[ -e %s ]] && exit 0; sleep 0.05; done; exit 1'
# shellcheck disable=SC2059 # the format string is the fixture above
run one "touch one; $(printf "$wait_for" two)" two "touch two; $(printf "$wait_for" one)"
expect_status 0 'the commands run concurrently — the first sees what the second does while it waits'

# --- usage errors are refused, not passed ----------------------------------------

run
expect_status 2 'no commands at all is a usage error, not a pass'
run lonely
expect_status 2 'a label with no command is a usage error'
run '' 'true'
expect_status 2 'an empty label is a usage error'
run named ''
expect_status 2 'an empty command is a usage error'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
((fail == 0))
