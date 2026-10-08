#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# AGENTDOC001 — nothing in an old CLAUDE.md is lost when its text is moved.
#
# CLAUDE.md used to be one file of about 650 KB, loaded into every agent
# session. It was split into a root index and topic files under docs/agents/,
# by MOVING text rather than rewriting it. This script is what proves the move
# lost nothing: every non-blank line of the old file must appear in the new set
# (the root CLAUDE.md plus every docs/agents/*.md) at least as many times as it
# appeared in the old one.
#
# Three normalisations, and only three:
#
#   - trailing whitespace is ignored;
#   - a line that is nothing but `>` is a blank line inside a blockquote, and is
#     skipped as a blank line is (#1170's review): splitting a two-paragraph
#     quote between two files leaves the `>` that joined them meaning nothing,
#     and keeping it opened the moved half with an empty quote line;
#   - a Markdown link's TARGET is ignored, `[text](target)` comparing as
#     `[text]()`, because a relative link moved from the root into docs/agents/
#     must change its target to keep pointing at the same file. The link text is
#     still compared, and DOC001 (check-doc-links.sh) is what proves the new
#     target resolves.
#
# Lines the new set ADDS (headings, pointers, the index) are not findings: a
# move may add framing, it may not drop or reword a line.
#
# Since #1170 it does three more things, the first and last opt-in so that the
# 2026-10-05 comparison above still means what it meant:
#
#   - The OLD side may be a DIRECTORY holding a previous state of the agent
#     instructions (its CLAUDE.md, its docs/agents/*.md and any area CLAUDE.md
#     below its root) rather than one file. #1170 moved text out
#     of the root AND between files, so the old set is the whole of the
#     instructions, not the root alone. Make one with:
#
#       mkdir /tmp/old && git archive <commit> CLAUDE.md docs/agents | tar -x -C /tmp/old
#
#   - The NEW set always includes every area CLAUDE.md below the root, in any
#     directory (node_modules, dist, coverage, .git and .claude pruned), which
#     Claude Code loads when a session works beneath it.
#
#   - `--exact` also fails a line that the new set holds MORE often than the old
#     set did: text that was copied rather than moved, so one rule now sits in
#     two places and can drift apart. A line that is new altogether is still not
#     a finding; how many were added is printed on the success line.
#
# ⚠️ Not part of `check:repo` and not in CI, deliberately: it needs the OLD
# file, which a shallow CI checkout does not have, and once CLAUDE.md is edited
# again the comparison is with history rather than a check of the tree. Run it
# against the commit before any future move of the same kind:
#
#   git show <commit>:CLAUDE.md > /tmp/old-claude.md
#   bash scripts/check-agent-docs-conservation.sh /tmp/old-claude.md
#
#   bash scripts/check-agent-docs-conservation.sh --exact /tmp/old   # a tree
#
# Exit 0: every line conserved. Exit 1: each missing (or, with --exact,
# duplicated) line printed with where it was in the old set. Exit 2: usage, or
# an input that is not there.

set -euo pipefail

exact=0
if [ "${1:-}" = "--exact" ]; then
  exact=1
  shift
fi

old="${1:-}"
root="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

usage() {
  printf 'usage: %s [--exact] <old CLAUDE.md, or a directory holding one> [repository root]\n' "$0" >&2
  exit 2
}

[ -n "${old}" ] || usage
if [ -d "${old}" ]; then
  [ -s "${old}/CLAUDE.md" ] || usage
elif [ ! -s "${old}" ]; then
  usage
fi
if [ ! -f "${root}/CLAUDE.md" ]; then
  printf 'AGENTDOC001: %s/CLAUDE.md is not there\n' "${root}" >&2
  exit 2
fi

# instruction_files <tree>: the root CLAUDE.md, every docs/agents/*.md and
# every area CLAUDE.md anywhere else below the root, in a stable order. The
# area walk is the whole tree, as AGENT003's is, so a rule moved into
# scripts/CLAUDE.md is conserved rather than reported lost; docs/agents/ is left
# out of it because its *.md are already listed, and the trees nobody authors
# are pruned.
instruction_files() {
  local tree="$1"
  printf '%s\n' "${tree}/CLAUDE.md"
  if [ -d "${tree}/docs/agents" ]; then
    find "${tree}/docs/agents" -type f -name '*.md' | LC_ALL=C sort
  fi
  find "${tree}" -mindepth 1 \( -name node_modules -o -name dist -o -name coverage -o -name .git \
    -o -name .claude -o -path "${tree}/docs/agents" -o -path "${tree}/CLAUDE.md" \) -prune \
    -o -type f -name CLAUDE.md -print | LC_ALL=C sort
}

old_files=()
if [ -d "${old}" ]; then
  while IFS= read -r f; do old_files+=("${f}"); done < <(instruction_files "${old}")
  old_prefix="${old%/}/"
else
  old_files=("${old}")
  old_prefix=""
fi
new_files=()
while IFS= read -r f; do new_files+=("${f}"); done < <(instruction_files "${root}")

# Each side is flattened into one stream of `<where>\t<line>` records, so the
# comparison cannot be misled by an empty file shifting a file count. `where`
# is the line number for a single old file and `<path>:<line>` for a tree.
tagged() {
  local strip="$1" one="$2"
  shift 2
  awk -v strip="${strip}" -v one="${one}" '
    { f = FILENAME; if (strip != "" && index(f, strip) == 1) f = substr(f, length(strip) + 1)
      printf "%s\t%s\n", (one ? FNR : f ":" FNR), $0 }
  ' "$@"
}

single=0
[ -d "${old}" ] || single=1

status=0
awk -v exact="${exact}" -v nold="${#old_files[@]}" -v nnew="${#new_files[@]}" -F '\t' '
  function norm(s) {
    sub(/[ \t\r]+$/, "", s)
    if (s ~ /^>$/) return ""
    gsub(/\]\([^)]*\)/, "]()", s)
    return s
  }
  {
    tab = index($0, "\t"); at = substr($0, 1, tab - 1); line = norm(substr($0, tab + 1))
    if (line == "") next
  }
  FNR == NR {
    need[line]++
    where[line] = where[line] (where[line] == "" ? "" : ",") at
    next
  }
  { have[line]++ }
  END {
    missing = 0; extra = 0; added = 0; total = 0
    for (line in need) {
      total += need[line]
      if (have[line] < need[line]) {
        missing++
        printf "AGENTDOC001: old line(s) %s missing from the new set (%d of %d): %s\n", where[line], need[line] - have[line], need[line], line
      } else if (exact && have[line] > need[line]) {
        extra++
        printf "AGENTDOC001: old line(s) %s are in the new set %d times, not %d: %s\n", where[line], have[line], need[line], line
      }
    }
    for (line in have) if (!(line in need)) added += have[line]
    if (missing > 0) printf "\n%d distinct line(s) of the old set are not in the new set.\n", missing > "/dev/stderr"
    if (extra > 0) printf "\n%d distinct line(s) of the old set are in the new set more often than before (--exact).\n", extra > "/dev/stderr"
    if (missing > 0 || extra > 0) exit 1
    if (exact) {
      printf "AGENTDOC001: all %d non-blank lines of the old set (%d files) are in the new set exactly as often (%d files); %d new line(s) added.\n", total, nold, nnew, added
    } else if (nold > 1) {
      printf "AGENTDOC001: all %d non-blank lines of the old set (%d files) are in the new set (%d files).\n", total, nold, nnew
    } else {
      printf "AGENTDOC001: all %d non-blank lines of the old file are in the new set (%d files).\n", total, nnew
    }
  }
' <(tagged "${old_prefix}" "${single}" "${old_files[@]}") <(tagged "${root%/}/" 0 "${new_files[@]}") || status=$?

exit "${status}"
