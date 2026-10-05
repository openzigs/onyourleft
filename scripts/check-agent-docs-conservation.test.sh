#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-agent-docs-conservation.sh.
#
# A throwaway tree per case: an "old" CLAUDE.md, a new root CLAUDE.md and
# docs/agents/*.md, the checker run against them, and an assertion on the exit
# code and the rule id. The cases that carry the weight are the RED ones — a
# dropped line, a reworded line, a line that was there twice and is now there
# once, a line moved to a file outside docs/agents/ — because a conservation
# check that passes them proves nothing.
#
# Run: bash scripts/check-agent-docs-conservation.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-agent-docs-conservation.sh"

pass=0
fail=0
root=""

new_tree() {
  root="$(mktemp -d)"
  mkdir -p "${root}/docs/agents"
}

cleanup_tree() {
  [ -n "${root}" ] && rm -rf "${root}"
  root=""
}

# put <relative-path> <body>
put() {
  mkdir -p "${root}/$(dirname "$1")"
  printf '%s\n' "$2" > "${root}/$1"
}

run_checker() {
  output="$(bash "${CHECKER}" "${root}/old.md" "${root}" 2>&1)"
  status=$?
}

expect() {
  local name="$1" want_status="$2" want_text="$3"
  run_checker
  if [ "${status}" -eq "${want_status}" ] && grep -q -- "${want_text}" <<< "${output}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s (exit %s, wanted %s and %s)\n%s\n' "${name}" "${status}" "${want_status}" "${want_text}" "${output}"
  fi
  cleanup_tree
}

OLD=$'# CLAUDE.md\n\nRule one.\n\n## 2. Section\n\nSee [the ADR](docs/adr/0001.md).\n\n---\n\n---\n\nRule two.'

new_tree
put old.md "${OLD}"
put CLAUDE.md $'# CLAUDE.md\n\nRule one.\n\n---\n\n---\n\nAn added pointer.'
put docs/agents/topic.md $'# Topic\n\n## 2. Section\n\nSee [the ADR](../adr/0001.md).\n\nRule two.'
expect 'every line moved, links retargeted: clean' 0 'all 7 non-blank lines'

new_tree
put old.md "${OLD}"
put CLAUDE.md $'# CLAUDE.md\n\nRule one.\n\n---\n\n---'
put docs/agents/topic.md $'## 2. Section\n\nSee [the ADR](../adr/0001.md).'
expect 'a dropped line is a finding' 1 'AGENTDOC001: old line(s) 13 .*Rule two.'

new_tree
put old.md "${OLD}"
put CLAUDE.md $'# CLAUDE.md\n\nRule one, reworded.\n\n---\n\n---\n\nRule two.'
put docs/agents/topic.md $'## 2. Section\n\nSee [the ADR](../adr/0001.md).'
expect 'a reworded line is a finding' 1 'Rule one.'

new_tree
put old.md "${OLD}"
put CLAUDE.md $'# CLAUDE.md\n\nRule one.\n\n---\n\nRule two.'
put docs/agents/topic.md $'## 2. Section\n\nSee [the ADR](../adr/0001.md).'
expect 'a line there twice and now once is a finding' 1 '(1 of 2): ---'

new_tree
put old.md "${OLD}"
put CLAUDE.md $'# CLAUDE.md\n\nRule one.\n\n---\n\n---\n\nRule two.'
put docs/agents/topic.md $'## 2. Section\n\nSee [another text](../adr/0001.md).'
expect 'changed link TEXT is a finding' 1 'See \[the ADR\]()'

new_tree
put old.md "${OLD}"
put CLAUDE.md $'# CLAUDE.md\n\nRule one.\n\n---\n\n---\n\nRule two.'
put docs/elsewhere.md $'## 2. Section\n\nSee [the ADR](adr/0001.md).'
expect 'a line moved outside docs/agents/ is a finding' 1 '## 2. Section'

new_tree
put CLAUDE.md 'x'
run_checker_empty() { output="$(bash "${CHECKER}" "${root}/missing.md" "${root}" 2>&1)"; status=$?; }
run_checker_empty
if [ "${status}" -eq 2 ]; then pass=$((pass + 1)); printf 'ok   %s\n' 'a missing old file is a usage error, not a pass'; else fail=$((fail + 1)); printf 'FAIL missing old file (exit %s)\n' "${status}"; fi
cleanup_tree

new_tree
put old.md ''
: > "${root}/old.md"
put CLAUDE.md 'x'
run_checker
if [ "${status}" -eq 2 ]; then pass=$((pass + 1)); printf 'ok   %s\n' 'an empty old file is a usage error, not a pass'; else fail=$((fail + 1)); printf 'FAIL empty old file (exit %s)\n' "${status}"; fi
cleanup_tree

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
