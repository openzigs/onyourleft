#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# DOC001 — every relative link in the documentation points at something.
#
# This repository's documentation is unusually cross-linked: CLAUDE.md alone
# points at ADRs, spikes, package READMEs and individual source files, and its
# section 9 is a table of nothing but such links. A file that moves takes every
# pointer to it with it, silently, and the reader who finds out is the one
# following the link a month later.
#
# Separate from `check-repo-rules.sh` for the reason `check-env-example.sh` is:
# that script reads PATHS, this one reads PROSE and then resolves paths out of
# it. The two have different failure modes and different fixture shapes.
#
# ⚠️ **Relative links only.** An `https://` target is not checked and must not
# be: that would need the network, which would make a bare-clone checker into
# one that fails on an aeroplane and passes on a good day. A dead external link
# is a real problem and it is not this script's.
#
# Two rules, because the second is what stops the first passing vacuously:
#
#   DOC001  a relative link points at nothing
#   DOC002  a code fence is never closed, so every link after it went unchecked
#
# DOC002 exists because the fence rule below is a state machine, and an odd
# number of fences leaves it stuck: every remaining link in the file is skipped
# and the file reports clean. That is the "rule that could not fire" shape this
# repository has now shipped five separate times, so the unbalanced state is a
# finding rather than a silent skip.
#
# Usage: bash scripts/check-doc-links.sh [root]
# Exit:  0 clean, 1 listing each finding.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
findings=0

# Markdown we wrote. The prune list is `check-repo-rules.sh`'s, plus `.claude/`
# — worktrees of other branches, whose links describe another checkout.
documents() {
  find "${ROOT}" \
    \( -name node_modules -o -name dist -o -name build -o -name coverage -o -name .git \
       -o -name .claude -o -name capacitor-cordova-android-plugins \
       -o -path '*/main/assets/public' \) -prune -o \
    -type f -name '*.md' -print
}

# Every relative link target in one document, one per line.
#
# In awk rather than in shell because it has to be STATEFUL: a fenced code block
# may legitimately contain `](something)` as an example, and reporting those
# would make the checker punish documentation for documenting. The fence rule is
# markdown's own — three or more backticks or tildes at the start of a line,
# with the same character closing it.
#
# What is skipped, and why each: an absolute URL and a `mailto:` are not this
# script's business, and a bare `#anchor` is a link within the page, which this
# script does not resolve headings for.
#
# ⚠️ An empty target — `[a]()` — is **not** guarded against here and does not
# need to be, which was established by mutation rather than assumed: the shell
# loop below skips an empty line, and an empty path would resolve to the
# containing directory, which exists. A guard here changed no outcome, so it is
# not here. The suite's case for it says the same thing about itself.
link_targets() {
  awk '
    # Fence state. `substr` rather than a regex so a line of exactly three
    # backticks and a line opening a language-tagged block are both matched.
    # `[[:blank:]]` rather than `[ \t]`: POSIX, and every awk agrees on it.
    /^[[:blank:]]*(```|~~~)/ {
      fence = !fence
      next
    }
    fence { next }
    {
      line = $0
      # Inline links: `](target)` and `](<target>)`, with an optional title.
      while (match(line, /\]\([^)]*\)/)) {
        target = substr(line, RSTART + 2, RLENGTH - 3)
        line = substr(line, RSTART + RLENGTH)
        # ⚠️ The angle-bracket form is unwrapped BEFORE the title is stripped,
        # and the order is the whole point: `](<a b.md> "T")` carries a path
        # with a space in it, and stripping at the first blank first would cut
        # it to `<a`. Inside the brackets a space is part of the path; outside
        # them it begins a title.
        if (target ~ /^</) {
          sub(/^</, "", target)
          sub(/>.*$/, "", target)
        } else {
          sub(/[[:blank:]].*$/, "", target)
        }
        # A fragment or a query is not part of the path on disk.
        sub(/[#?].*$/, "", target)
        if (target ~ /^[a-zA-Z][a-zA-Z0-9+.-]*:/) continue
        print target
      }
    }
    END { if (fence) print "\x01unclosed-fence" }
  ' "$1"
}

while IFS= read -r document; do
  [ -n "${document}" ] || continue
  directory="$(dirname "${document}")"
  while IFS= read -r target; do
    [ -n "${target}" ] || continue
    if [ "${target}" = $'\x01unclosed-fence' ]; then
      printf 'DOC002: %s: a code fence is never closed, so links after it were not checked\n' \
        "${document#"${ROOT}"/}" >&2
      findings=$((findings + 1))
      continue
    fi
    # A percent-encoded space is the only escape that appears in practice, and
    # decoding it is what makes `docs/a%20b.md` resolve to the file on disk.
    decoded="${target//%20/ }"
    case "${decoded}" in
      /*) resolved="${ROOT}${decoded}" ;;
      *) resolved="${directory}/${decoded}" ;;
    esac
    if [ ! -e "${resolved}" ]; then
      printf 'DOC001: %s: link to "%s" points at nothing\n' \
        "${document#"${ROOT}"/}" "${target}" >&2
      findings=$((findings + 1))
    fi
  done < <(link_targets "${document}")
done < <(documents)

if [ "${findings}" -ne 0 ]; then
  printf '\n%d documentation link finding(s). See CLAUDE.md section 4a.\n' "${findings}" >&2
  exit 1
fi

printf 'check-doc-links: clean (%s)\n' "${ROOT}"
