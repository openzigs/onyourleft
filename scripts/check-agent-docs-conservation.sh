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
# Two normalisations, and only two:
#
#   - trailing whitespace is ignored;
#   - a Markdown link's TARGET is ignored, `[text](target)` comparing as
#     `[text]()`, because a relative link moved from the root into docs/agents/
#     must change its target to keep pointing at the same file. The link text is
#     still compared, and DOC001 (check-doc-links.sh) is what proves the new
#     target resolves.
#
# Lines the new set ADDS (headings, pointers, the index) are not findings: a
# move may add framing, it may not drop or reword a line.
#
# ⚠️ Not part of `check:repo` and not in CI, deliberately: it needs the OLD
# file, which a shallow CI checkout does not have, and once CLAUDE.md is edited
# again the comparison is with history rather than a check of the tree. Run it
# against the commit before any future move of the same kind:
#
#   git show <commit>:CLAUDE.md > /tmp/old-claude.md
#   bash scripts/check-agent-docs-conservation.sh /tmp/old-claude.md
#
# Exit 0: every line conserved. Exit 1: each missing line printed with its line
# number in the old file. Exit 2: usage, or an input that is not there.

set -euo pipefail

old="${1:-}"
root="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [ -z "${old}" ] || [ ! -s "${old}" ]; then
  printf 'usage: %s <old CLAUDE.md> [repository root]\n' "$0" >&2
  exit 2
fi
if [ ! -f "${root}/CLAUDE.md" ]; then
  printf 'AGENTDOC001: %s/CLAUDE.md is not there\n' "${root}" >&2
  exit 2
fi

new_files=("${root}/CLAUDE.md")
if [ -d "${root}/docs/agents" ]; then
  while IFS= read -r f; do
    new_files+=("${f}")
  done < <(find "${root}/docs/agents" -type f -name '*.md' | LC_ALL=C sort)
fi

# The first file read is the OLD one (marked by FNR==NR); every later file is
# part of the new set. Counts are kept per normalised line.
status=0
awk '
  function norm(s) {
    sub(/[ \t\r]+$/, "", s)
    gsub(/\]\([^)]*\)/, "]()", s)
    return s
  }
  FNR == NR {
    line = norm($0)
    if (line != "") { need[line]++; where[line] = where[line] (where[line] == "" ? "" : ",") FNR }
    next
  }
  {
    line = norm($0)
    if (line != "") have[line]++
  }
  END {
    missing = 0
    for (line in need) {
      if (have[line] < need[line]) {
        missing++
        printf "AGENTDOC001: old line(s) %s missing from the new set (%d of %d): %s\n", where[line], need[line] - have[line], need[line], line
      }
    }
    total = 0
    for (line in need) total += need[line]
    if (missing > 0) {
      printf "\n%d distinct line(s) of the old file are not in the new set.\n", missing > "/dev/stderr"
      exit 1
    }
    printf "AGENTDOC001: all %d non-blank lines of the old file are in the new set (%d files).\n", total, ARGC - 2
  }
' "${old}" "${new_files[@]}" || status=$?

exit "${status}"
