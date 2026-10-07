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

# --- #1170: an old TREE, area CLAUDE.md files, and --exact ----------------------
#
# run_tree [--exact]: the old side is the directory old/, holding a previous
# CLAUDE.md, docs/agents/ and area files, as `git archive` would write them.

run_tree() {
  output="$(bash "${CHECKER}" "$@" "${root}/old" "${root}/new" 2>&1)"
  status=$?
}

expect_tree() {
  local name="$1" want_status="$2" want_text="$3"
  shift 3
  run_tree "$@"
  if [ "${status}" -eq "${want_status}" ] && grep -q -- "${want_text}" <<< "${output}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s (exit %s, wanted %s and %s)\n%s\n' "${name}" "${status}" "${want_status}" "${want_text}" "${output}"
  fi
  cleanup_tree
}

OLD_ROOT=$'# CLAUDE.md\n\nAlways on.\n\nArea rule.\n\n---\n\nSee [x](docs/x.md).'
OLD_TOPIC=$'# Topic\n\n---\n\nTopic rule.'

old_tree() {
  new_tree
  put old/CLAUDE.md "${OLD_ROOT}"
  put old/docs/agents/topic.md "${OLD_TOPIC}"
}

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\nA new pointer.'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/apps/web/CLAUDE.md $'# apps/web\n\nArea rule.\n\n---\n\nSee [x](../../docs/x.md).'
expect_tree 'a tree: lines moved into an area CLAUDE.md are conserved' 0 'all 8 non-blank lines of the old set (2 files)'

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\nA new pointer.'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/apps/web/CLAUDE.md $'# apps/web\n\n---\n\nSee [x](../../docs/x.md).'
expect_tree 'a tree: a line dropped from the new set is a finding, with its old file' 1 'old line(s) CLAUDE.md:5 missing .*Area rule.'

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\nArea rule.\n\n---\n\nSee [x](docs/x.md).'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/packages/CLAUDE.md $'# packages\n\nArea rule.'
expect_tree '--exact: a line COPIED into an area file rather than moved is a finding' 1 'are in the new set 2 times, not 1: Area rule.' --exact

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\nArea rule.\n\n---\n\nSee [x](docs/x.md).'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/packages/CLAUDE.md $'# packages\n\nArea rule.'
expect_tree 'without --exact the same copy passes, as #1156 defined the check' 0 'all 8 non-blank lines of the old set'

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\nArea rule.\n\n---\n\n---\n\nSee [x](docs/x.md).'
put new/docs/agents/topic.md "${OLD_TOPIC}"
expect_tree '--exact: one more separator than before is a finding' 1 'are in the new set 3 times, not 2: ---' --exact

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\n---\n\nSee [x](docs/x.md).\n\nBrand new.'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/packages/sensors/CLAUDE.md $'Area rule.'
expect_tree '--exact: a NARROWER area file counts, and an added line is reported, not refused' 0 '1 new line(s) added' --exact

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\n---\n\nSee [x](docs/x.md).'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/apps/web/node_modules/pkg/CLAUDE.md $'Area rule.'
expect_tree 'a CLAUDE.md inside node_modules is not part of the new set' 1 'missing .*Area rule.'

old_tree
put new/CLAUDE.md $'# CLAUDE.md\n\nAlways on.\n\n---\n\nSee [x](docs/x.md).'
put new/docs/agents/topic.md "${OLD_TOPIC}"
put new/scripts/CLAUDE.md $'Area rule.'
expect_tree 'an area file OUTSIDE apps/ and packages/ is part of the new set' 0 'all 8 non-blank lines of the old set' --exact

old_tree
put old/CLAUDE.md $'# CLAUDE.md\n\n> Quote one.\n>\n> Quote two.'
put new/CLAUDE.md $'# CLAUDE.md\n\n> Quote one.'
put new/apps/web/CLAUDE.md $'> Quote two.'
put new/docs/agents/topic.md "${OLD_TOPIC}"
expect_tree 'a bare `>` joining two quoted paragraphs is a blank line, not a lost line' 0 'are in the new set exactly as often' --exact

old_tree
put old/CLAUDE.md $'# CLAUDE.md\n\n> Quote one.\n>\n> Quote two.'
put new/CLAUDE.md $'# CLAUDE.md\n\n> Quote one.\n>'
put new/docs/agents/topic.md "${OLD_TOPIC}"
expect_tree 'but the quoted text beside it is still a line' 1 'missing .*> Quote two.' --exact

old_tree
put new/CLAUDE.md "${OLD_ROOT}"
put new/docs/agents/topic.md $'# Topic\n\n---'
expect_tree 'a tree: a line lost from a TOPIC file is a finding too' 1 'docs/agents/topic.md:5 missing .*Topic rule.'

new_tree
mkdir -p "${root}/old"
put new/CLAUDE.md 'x'
run_tree --exact
if [ "${status}" -eq 2 ]; then pass=$((pass + 1)); printf 'ok   %s\n' 'an old tree with no CLAUDE.md is a usage error, not a pass'; else fail=$((fail + 1)); printf 'FAIL old tree with no CLAUDE.md (exit %s)\n' "${status}"; fi
cleanup_tree

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
