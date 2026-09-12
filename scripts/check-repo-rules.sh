#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-repo-rules.sh — enforce the repository rules that are checkable by path.
#
# ADR 0005 makes the licence boundary structural: everything under packages/ is
# Apache-2.0 and everything under apps/ is AGPL-3.0-or-later, decided by the
# directory a file sits in rather than by what a manifest claims. A path rule is
# worth having precisely because it cannot be mis-declared, so it has to be
# checked by a machine. This is that machine.
#
# It deliberately has no dependencies — no Node, no install, no lockfile — so it
# runs on a bare clone and in CI before any toolchain exists. #23 may reimplement
# these rules inside the workspace linter; #24 wires this into CI. Neither is a
# reason to leave the rule unenforced in the meantime.
#
# Rules:
#   LIC001  every source file under packages/ declares SPDX Apache-2.0
#   LIC002  every source file under apps/ declares SPDX AGPL-3.0-or-later
#   LIC006  every path in .spdx-exempt exists, and none of them is a glob
#   LIC003  every package manifest declares the licence its path requires
#   LIC004  every leaf package under packages/ or apps/ carries its own LICENSE
#   SCOPE001 no ANT+ reference in any source tree OR package manifest
#           (owner decision D2, and #15's fifth criterion)
#   WF001   no pull_request_target trigger in .github/workflows/
#   ADR001  no two ADRs share a number
#   ADR002  every ADR filename is NNNN-kebab-case.md
#   ADR003  an ADR's "## Amendments" section is single, last, dated, and in
#           date order -- and no unclosed fence hides it
#   REL001  no signing key material is committed anywhere (#95)
#   REL002  the Android build targets at least API 36 (#95)
#   XML001  no "--" inside an XML comment (#225)
#   XML002  no XML comment left unclosed (#225)
#   XML003  no CDATA section left unclosed -- the construct that used to switch
#           XML001 and XML002 off for the rest of the file (#229)
#   XML004  no processing instruction left unclosed (#229)
#
# Usage: scripts/check-repo-rules.sh [ROOT]   (ROOT defaults to the repo root)
# Exit:  0 clean, 1 if any rule is violated.

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
findings=0

report() {
  printf '%s: %s\n' "$1" "$2" >&2
  findings=$((findings + 1))
}

# --- The trees this repository does not author --------------------------------
#
# `find` arguments, in ONE place, because more than one rule needs them and a
# second copy is a fourth list to keep in step. `.prettierignore` and
# `eslint.config.js` already carry their own for reasons of their own -- Prettier
# reads only the ROOT `.gitignore` and not Capacitor's nested one, and ESLint
# needs Gradle's build output out of its project service -- and #225 asked for
# XML001/XML002 to prune "the same list check-repo-rules.sh already applies
# rather than retyping it". Retyping it here would have made a FOURTH copy that
# could disagree with the other three; an array makes it one copy inside this
# file, used by every walk in it.
#
# `dist`, `build` and `coverage` are build output. `node_modules` and `.git` are
# not ours at all. The last three are the Capacitor trees that `cap sync`
# regenerates and that Capacitor's own nested `.gitignore` therefore keeps out
# of the repository: they are pruned rather than exempted because they do not
# exist in a clean clone, and an entry in `.spdx-exempt` naming an absent file is
# itself a LIC006 violation. The copied web build -- full of bundled `.js` and
# `.css` -- would otherwise make this checker green in CI and red for anyone who
# has run a sync.
#
# ⚠️ An indexed array rather than an associative one, and expanded with
# `"${GENERATED[@]}"` rather than interpolated into a string: this script targets
# the bash on a bare macOS clone, which is 3.2, and a `find` expression that went
# through word splitting would break on the first path containing a space.
#
# ⚠️ `fixtures` is deliberately NOT here, and #229 is where that was settled.
# REL001 used to walk its own inline list which excluded it, beside this one
# which does not; the two disagreed and nobody could say which was right. A
# fixture tree is code this repository AUTHORS and commits, so a key committed
# there is exactly as permanent as a key committed anywhere else -- and the
# content half of REL001 never excluded it in the first place, so the rule
# already disagreed with itself. The resolution is one list: generated output is
# pruned, authored trees are not.
GENERATED=(
  -name node_modules -o -name dist -o -name build -o -name coverage -o -name .git
  -o -name capacitor-cordova-android-plugins
  -o -path '*/main/assets/public'
  -o -path '*/main/res/xml/config.xml'
)

# Every file this repository authors: the walk above, with nothing else added.
# REL001 uses it for both of its halves and the XML rules use the same prune, so
# a tree that is invisible to one rule is invisible to all of them rather than
# to whichever list was edited last.
repo_files() {
  find "${ROOT}" \( "${GENERATED[@]}" \) -prune -o -type f -print
}

# The same walk, NUL-separated, for the one consumer that hands its output to
# another program rather than reading it line by line. A newline is a legal
# character in a filename, and `tr '\n' '\0'` over the list above would turn one
# such name into two arguments that match nothing -- a file silently skipped by
# the rule whose violation cannot be undone.
repo_files_z() {
  find "${ROOT}" \( "${GENERATED[@]}" \) -prune -o -type f -print0
}

# Source files we expect to carry an SPDX header. Data and generated formats are
# excluded because a header cannot be added to them without corrupting them.
#
# ⚠️ The Kotlin, Java, Gradle and Android XML extensions are here for #87's
# Android shell. XML is the one that needed a decision rather than a line: an
# `AndroidManifest.xml` we hand-edit is ours and carries the header, and a
# launcher icon that `cap add android` wrote from `@capacitor/cli`'s MIT
# template is not ours and must not claim to be. Those are named, one exact path
# at a time, in `.spdx-exempt` -- see LIC006, which is what stops that list
# growing into a blanket.
source_files() {
  local dir="$1"
  [ -d "${dir}" ] || return 0
  find "${dir}" \
    \( "${GENERATED[@]}" \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
               -o -name '*.mjs' -o -name '*.cjs' -o -name '*.css' -o -name '*.sh' \
               -o -name '*.kt' -o -name '*.kts' -o -name '*.java' \
               -o -name '*.gradle' -o -name '*.xml' \) -print
}

# --- .spdx-exempt: generated scaffolding, named one exact path at a time ------
#
# `cap add android` writes about twenty files from `@capacitor/cli`'s MIT
# template. Stamping `AGPL-3.0-or-later` on them would be wrong twice over: they
# are not our authorship, and MIT requires its notice to travel with a
# substantial portion of the work, which an AGPL header replacing it does not do.
# So they are exempt -- and the exemption is a list of exact paths, with no glob
# syntax accepted, because a glob is how an exemption for twenty files silently
# becomes an exemption for the twenty-first that somebody should have read.
EXEMPT_FILE="${ROOT}/.spdx-exempt"

exempt_paths() {
  [ -f "${EXEMPT_FILE}" ] || return 0
  sed -e 's/#.*//' -e 's/[[:space:]]*$//' "${EXEMPT_FILE}" | grep -v '^$'
}

is_exempt() {
  local relative="$1" entry
  while IFS= read -r entry; do
    [ "${entry}" = "${relative}" ] && return 0
  done < <(exempt_paths)
  return 1
}

# The SPDX identifier must appear in the file's opening comment block. We allow
# the first five lines rather than only the first, because a shebang and a
# generated-file banner both legitimately precede it.
spdx_of() {
  head -n 5 "$1" | sed -n 's/.*SPDX-License-Identifier:[[:space:]]*\([A-Za-z0-9.+-]*\).*/\1/p' | head -n 1
}

# --- LIC001 / LIC002: SPDX header matches the directory ----------------------

check_headers() {
  local dir="$1" want="$2" rule="$3" file got relative
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    relative="${file#"${ROOT}"/}"
    is_exempt "${relative}" && continue
    got="$(spdx_of "${file}")"
    if [ -z "${got}" ]; then
      report "${rule}" "${file#"${ROOT}"/}: no SPDX-License-Identifier in the first 5 lines (expected ${want})"
    elif [ "${got}" != "${want}" ]; then
      report "${rule}" "${file#"${ROOT}"/}: SPDX header is ${got}, but its path requires ${want}"
    fi
  done < <(source_files "${dir}")
}

check_headers "${ROOT}/packages" "Apache-2.0" LIC001
check_headers "${ROOT}/apps" "AGPL-3.0-or-later" LIC002

# --- LIC006: every exemption names a file that is really there ---------------
#
# An exemption list is the classic vacuous pass: it costs nothing to add a line
# and nothing ever tells you the line stopped meaning something. So a stale
# entry is a violation. Two things follow, and both are the point. A file
# regenerated under a new name lands OUTSIDE the list and fails LIC001/LIC002
# until somebody rules on it, which is the fail-closed direction. And a
# speculative entry -- exempting a path before the file exists -- cannot be
# added at all.
#
# A directory is refused for the same reason a glob is, and separately, because
# `[ -e ]` would happily accept one: an entry naming `apps/mobile/android` reads
# in review as a blanket over the tree, and whether it behaves as one is then a
# property of how `is_exempt` happens to compare strings. Refusing it makes the
# list mean one thing.
check_exemptions() {
  local entry
  while IFS= read -r entry; do
    case "${entry}" in
      *'*'* | *'?'* | *'['*)
        report LIC006 ".spdx-exempt: ${entry}: glob syntax is not accepted; name each file"
        continue
        ;;
      /* | *'..'*)
        report LIC006 ".spdx-exempt: ${entry}: entries are repository-relative paths"
        continue
        ;;
    esac
    if [ -d "${ROOT}/${entry}" ]; then
      report LIC006 ".spdx-exempt: ${entry}: names a directory; exempt each file"
      continue
    fi
    [ -e "${ROOT}/${entry}" ] || \
      report LIC006 ".spdx-exempt: ${entry}: no such file; a stale exemption is not an exemption"
  done < <(exempt_paths)
}

check_exemptions

# --- LIC003: manifest licence field matches the directory --------------------

check_manifests() {
  local dir="$1" want="$2" manifest declared
  [ -d "${dir}" ] || return 0
  while IFS= read -r manifest; do
    [ -n "${manifest}" ] || continue
    declared="$(sed -n 's/.*"license"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${manifest}" | head -n 1)"
    if [ -z "${declared}" ]; then
      report LIC003 "${manifest#"${ROOT}"/}: no \"license\" field (expected \"${want}\")"
    elif [ "${declared}" != "${want}" ]; then
      report LIC003 "${manifest#"${ROOT}"/}: declares \"${declared}\", but its path requires \"${want}\""
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f -name package.json -print)
}

check_manifests "${ROOT}/packages" "Apache-2.0"
check_manifests "${ROOT}/apps" "AGPL-3.0-or-later"

# --- LIC004: each leaf package carries its own LICENSE ------------------------
# ADR 0001: "A package that does not do both is AGPL by default." The path rule
# does not replace the per-package file, it backs it up.
#
# Both trees, not only packages/. CLAUDE.md section 3 says "each package still
# carries its own LICENSE file AND a matching license manifest field -- belt and
# braces", and it says it of apps/ as well. Checking only one tree meant deleting
# apps/web/LICENSE failed nothing.

check_package_licences() {
  local dir="$1" licence="$2" manifest pkgdir
  [ -d "${dir}" ] || return 0
  while IFS= read -r manifest; do
    [ -n "${manifest}" ] || continue
    pkgdir="$(dirname "${manifest}")"
    if [ ! -f "${pkgdir}/LICENSE" ] && [ ! -f "${pkgdir}/LICENSE.txt" ]; then
      report LIC004 "${pkgdir#"${ROOT}"/}: no LICENSE file; every ${licence} leaf package carries its own"
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f -name package.json -print)
}

check_package_licences "${ROOT}/packages" "Apache-2.0"
check_package_licences "${ROOT}/apps" "AGPL-3.0-or-later"

# --- SCOPE001: no ANT+ anywhere in a source tree ------------------------------
# Owner decision D2. Documentation may name ANT+ to explain why it is excluded;
# a source tree may not, because naming it there means someone started building it.

# The pattern is anchored on a non-word character rather than bare `ant[+]`.
# Without that anchor `quadrant+1` and `CONSTANT+2` both match -- and the package
# where that arithmetic lives, packages/physics, is the one place it is certain
# to appear. `[[:<:]]`/`\b` are not portable between GNU and BSD grep, so the
# boundary is spelled out as "start of line, or a character that is not part of
# an identifier".
ANTPLUS_RE='(^|[^[:alnum:]_])(ant[+]|ant-plus|antplus|thisisant)'

# Scoped to SOURCE files, not to the whole tree. CLAUDE.md and ADR 0005 both say
# documentation may name ANT+ to explain why it is excluded; scanning every file
# under packages/ made `packages/sensors/README.md` doing exactly that fail the
# build, so the checker contradicted the rule it exists to enforce.
for dir in "${ROOT}/packages" "${ROOT}/apps"; do
  [ -d "${dir}" ] || continue
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    if grep -qiE "${ANTPLUS_RE}" "${file}" 2>/dev/null; then
      report SCOPE001 "${file#"${ROOT}"/}: ANT+ is out of scope permanently (owner decision D2, ADR 0005 \"Scope exclusions\")"
    fi
  done < <(source_files "${dir}")
done

# ⚠️ **And the manifests, which `source_files` does not return.** #15's fifth
# acceptance criterion is that "no ANT+ code, dependency, permission or string
# appears anywhere in the client, asserted by grep in CI", and it calls that the
# thing "that stops the scope quietly returning". Three of those four were
# covered: code by the extension list, permission by `*.xml` reaching an
# `AndroidManifest.xml` since #87, string by both. **A dependency was not** --
# `source_files` returns no `.json` at all, so `"ant-plus": "^1.0.0"` in a
# `package.json` passed a rule written to forbid exactly that.
#
# It is a separate loop rather than a `.json` entry in `source_files`, because
# that function's other caller is the SPDX header check and a `package.json`
# carries no header. Scoped to manifests rather than to every `.json` for the
# same reason the loop above is scoped to source: a fixture or a lockfile may
# legitimately mention a name it is not adopting.
for dir in "${ROOT}/packages" "${ROOT}/apps"; do
  [ -d "${dir}" ] || continue
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    if grep -qiE "${ANTPLUS_RE}" "${file}" 2>/dev/null; then
      report SCOPE001 "${file#"${ROOT}"/}: an ANT+ dependency is out of scope permanently (owner decision D2)"
    fi
  done < <(find "${dir}" -name node_modules -prune -o -type f -name package.json -print)
done

# --- WF001: pull_request_target is banned in workflows ------------------------
# CLAUDE.md section 8. That trigger runs against the base repository with access
# to secrets, and unlike `pull_request` it is not covered by the fork approval
# gate at all -- so a fork's workflow change executes before anyone reviews it.
# This repository is public, which is exactly the population that vector needs.
#
# Scoped to .github/workflows/ rather than the whole tree, for the same reason
# SCOPE001 is scoped to source: CLAUDE.md and CONTRIBUTING.md have to be able to
# name the trigger in order to ban it. A checker that fails on the file stating
# the rule contradicts the rule.
#
# Matched as a fixed string with no word boundary. Unlike ANT+ there is no
# benign substring to collide with, and a bare occurrence anywhere in a workflow
# -- including inside a comment, ready to be uncommented -- is what we want to
# catch.

if [ -d "${ROOT}/.github/workflows" ]; then
  while IFS= read -r workflow; do
    [ -n "${workflow}" ] || continue
    if grep -qF 'pull_request_target' "${workflow}" 2>/dev/null; then
      report WF001 "${workflow#"${ROOT}"/}: pull_request_target is banned (CLAUDE.md section 8); use pull_request, which cannot read secrets from a fork"
    fi
  done < <(find "${ROOT}/.github/workflows" -type f \( -name '*.yml' -o -name '*.yaml' \) -print)
fi

# --- ADR001 / ADR002: ADR numbering and naming --------------------------------
#
# ADR001 reports BOTH colliding paths and tells the reader neither of them is
# the one to renumber. That is not politeness: this loop walks `find | sort`, so
# the file it reaches second is whichever slug sorts later, which carries no
# information at all about which file is new. The message it used to print --
# "<the second one>: ADR number NNNN is already taken; renumber before merging"
# -- was therefore wrong about half the time, and its wrong half named a MERGED
# ADR. Those are cited by number from other ADRs and from docs/architecture.md,
# so renumbering one is precisely the thing the ownership table exists to
# prevent. Found in #118, from ADR 0009's own mutation test.
#
# The pairs are accumulated in a space-delimited string rather than an
# associative array: this script targets the bash on a bare macOS clone, which
# is 3.2 and has none. Both fields are safe to pack that way because ADR002 runs
# FIRST and `continue`s, so anything reaching here matches NNNN-kebab-case.md
# and can contain neither a space nor a colon.

if [ -d "${ROOT}/docs/adr" ]; then
  seen_pairs=" "
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"
    if ! printf '%s' "${base}" | grep -qE '^[0-9]{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$'; then
      report ADR002 "docs/adr/${base}: filename must be NNNN-kebab-case.md"
      continue
    fi
    number="${base%%-*}"
    case "${seen_pairs}" in
      *" ${number}:"*)
        rest="${seen_pairs#* "${number}":}"
        first="${rest%% *}"
        report ADR001 "docs/adr/${first} and docs/adr/${base} share ADR number ${number}; the one that is not yet merged must be renumbered -- see the ownership table in docs/architecture.md" ;;
      *)
        seen_pairs="${seen_pairs}${number}:${base} " ;;
    esac
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
fi

# --- ADR003: an amendment is appended, and only appended -----------------------
#
# ADR 0013 (#147) establishes the one lighter-than-supersession mechanism this
# repository has: a dated entry APPENDED to an "## Amendments" section at the
# end of an accepted ADR, recording that a statement of fact in the body has
# become false. The body itself is still never edited.
#
# That convention needs a gate for the reason CLAUDE.md section 8 gives for
# banning pull_request_target with a rule rather than a paragraph: the two
# things it distinguishes -- appending a note, and editing the body while
# calling it an amendment -- produce diffs that look similar in review and are
# opposites in what they do to the record. Three properties are checkable from
# the file alone:
#
#   one section   a second "## Amendments" heading is a pile, not a log
#   last section  anything after it means the note went INTO the body
#   dated entries an undated note cannot be placed against the ADR's own date
#
# Whether the change was literally an append is a property of the diff, not of
# the file, and is deliberately NOT checked here -- a rule that reads git
# history would not run on the bare clone this script is written for.
#
# Matched on '^## Amendments' anchored at a level-2 heading. An ADR that
# DISCUSSES the convention -- 0013 does -- names it as a '### Amendments'
# sub-heading, and shows the shape it prescribes inside a fence. Neither is the
# section, so the fences are blanked before anything is matched: without that,
# the rule would make its own ADR unwritable, because 0013's worked example puts
# '## Amendments' at column one and '## Consequences' after it.

# Replace every fenced line, and the fence markers, with a blank line. Line
# NUMBERING is preserved -- the section's position matters and an editor's line
# numbers are what a reader has -- so this blanks rather than deletes. Only
# backtick fences: this repository writes no tilde-fenced block, and a rule that
# guesses at a syntax nobody uses is a rule nobody can predict.
strip_fences() {
  awk '
    /^[[:space:]]*```/ { infence = !infence; print ""; next }
    { print (infence ? "" : $0) }
  ' "$1"
}

#
# Every message carries the line the reader has to go and look at. An ADR here
# runs to several hundred lines, and "something follows it" without a number
# sends the reader back to scroll for what -- the same complaint #118 made of
# ADR001's old message. The numbers are the FILE's, which is what `strip_fences`
# blanking rather than deleting is for.

# A numbered (`grep -n`) amendment entry that opens with a bold ISO date. ONE
# definition, used with `grep -E` to select the dated entries and with `grep -vE`
# to select the undated ones, because two spellings of "dated" drift and the
# pair are each other's complement by construction.
DATED_ENTRY='^[0-9]+:-[[:space:]]+\*\*[0-9]{4}-[0-9]{2}-[0-9]{2}\*\*[[:space:]]'

check_adr_amendments() {
  local adr base body start after following entries numbered undated
  local fences date previous
  while IFS= read -r adr; do
    [ -n "${adr}" ] || continue
    base="$(basename "${adr}")"

    # An UNCLOSED fence would blank the whole rest of the file, which does not
    # weaken this rule -- it switches it off, silently, for that ADR. The
    # heading disappears, so `start` is empty and the file is skipped whole:
    # a section that is not last, an entry with no date and a second section
    # all pass. Reported before anything else is read, because everything
    # after it is read through `strip_fences`. #150's review found the same
    # shape in the test harness (a guard that printed a failure and could not
    # fail the build); a rule a typo can disable is worse than one that misses
    # a case, because nothing tells you it happened.
    fences="$(grep -c '^[[:space:]]*```' "${adr}")"
    if [ $((fences % 2)) -ne 0 ]; then
      report ADR003 "docs/adr/${base}: unclosed code fence (${fences} fence lines, an odd number); everything after the last one is read as code, which would hide an '## Amendments' section and anything wrong inside it (ADR 0013)"
      continue
    fi

    body="$(strip_fences "${adr}")"

    # Line numbers of every level-2 Amendments heading, oldest first.
    start="$(printf '%s\n' "${body}" | grep -n '^## Amendments[[:space:]]*$' | cut -d: -f1)"
    [ -n "${start}" ] || continue

    if [ "$(printf '%s\n' "${start}" | wc -l | tr -d '[:space:]')" -gt 1 ]; then
      report ADR003 "docs/adr/${base}: two '## Amendments' sections, at lines $(printf '%s' "${start}" | tr '\n' ' ' | sed 's/ $//' | sed 's/ / and /g'); an amendment is a new dated entry in the one section, not a second section (ADR 0013)"
      continue
    fi

    after="$(printf '%s\n' "${body}" | tail -n +"$((start + 1))")"

    # ANY heading at column one, not only a level-2 one. "Nothing follows the
    # section" is the rule; a '# Appendix' or a '### Postscript' after it is the
    # same defect as a '## Notes', and matching '^## ' alone let the first of
    # those through (#150's review). An entry is a bullet, so no legitimate
    # amendment puts a heading here.
    #
    # A setext heading -- 'Notes' underlined with hyphens -- is deliberately NOT
    # matched. This repository writes none, a row of hyphens at column one is
    # also a horizontal rule and a table separator, and `strip_fences` already
    # settles the same question the same way: a rule that guesses at a syntax
    # nobody uses is a rule nobody can predict.
    following="$(printf '%s\n' "${after}" | grep -n -m 1 -E '^#{1,6} ')"
    if [ -n "${following}" ]; then
      report ADR003 "docs/adr/${base}: '## Amendments' (line ${start}) must be the last section, but '${following#*:}' follows it at line $((start + ${following%%:*})); an amendment is appended to the end of the file, never inserted into the body (ADR 0013)"
      continue
    fi

    entries="$(printf '%s\n' "${after}" | grep -n '^-[[:space:]]')"
    if [ -z "${entries}" ]; then
      report ADR003 "docs/adr/${base}: '## Amendments' (line ${start}) has no entries; a section that records nothing reads as though it records something (ADR 0013)"
      continue
    fi

    # Every top-level bullet is an entry and every entry is dated. A wrapped
    # entry continues on an INDENTED line, which is not matched here, so a
    # paragraph-length amendment is not read as a pile of undated ones.
    #
    # The date's SHAPE is checked, not its validity: "2026-13-99" passes. A
    # calendar in bash 3.2 without GNU date is not worth the lines, and the
    # failure it would catch -- a typo in a date nobody disputes -- is not the
    # one this rule exists for.
    #
    # `-[[:space:]]` here and in the entry match above, not `- `: a tab after
    # the bullet hyphen is a list item in every Markdown renderer, and matching
    # it as an entry while requiring a literal space to see its date reported a
    # correctly dated entry as undated (#150's review). The two patterns have to
    # admit the same whitespace or the second is judging a line the first
    # already misread.
    while IFS= read -r numbered; do
      [ -n "${numbered}" ] || continue
      undated="${numbered#*:}"
      report ADR003 "docs/adr/${base}: line $((start + ${numbered%%:*})): amendment entry must open with a bold ISO date, as in \"- **2026-09-05** — ...\"; found \"${undated}\" (ADR 0013)"
    done < <(printf '%s\n' "${entries}" | grep -vE "${DATED_ENTRY}")

    # Dates never go backwards. This is the one part of "it was an append" that
    # IS visible in the file: an entry put at the TOP of the section -- the
    # natural move if you read the section as a newest-first changelog -- leaves
    # an older date below a newer one, and D-4 makes the section an append-only
    # log. It cannot catch an append carrying a backdated date, and does not
    # claim to; ISO dates sort lexically, which is why no date parsing happens.
    #
    # A STRING comparison, deliberately, not `-lt` on the digits: this text
    # comes from a fork's tree, and arithmetic is the one context where a
    # `$(( ))` inside it would be evaluated. Both operands are fixed-width and
    # matched by DATED_ENTRY, so they are digits and hyphens in the same
    # positions, and no locale collates ASCII digits out of order.
    previous=""
    while IFS= read -r numbered; do
      [ -n "${numbered}" ] || continue
      date="${numbered#*\*\*}"
      date="${date:0:10}"
      if [ -n "${previous}" ] && [[ "${date}" < "${previous}" ]]; then
        report ADR003 "docs/adr/${base}: line $((start + ${numbered%%:*})): amendment entry dated ${date} follows one dated ${previous}; the section is an append-only log, so its dates never go backwards (ADR 0013 D-4)"
      fi
      previous="${date}"
    done < <(printf '%s\n' "${entries}" | grep -E "${DATED_ENTRY}")
  done < <(find "${ROOT}/docs/adr" -type f -name '*.md' | sort)
}

if [ -d "${ROOT}/docs/adr" ]; then
  check_adr_amendments
fi

# --- REL001: no signing key material, anywhere ---------------------------------
# #95's first acceptance criterion: *"signing keys are in CI secrets and NEVER in
# the repo -- a test or scan asserts no keystore or key material is committed"*.
#
# ⚠️ This is the one rule in this file whose violation cannot be undone by fixing
# it. A pushed commit is permanent regardless of what a later commit deletes, and
# an Android upload key that leaks is not rotatable: Play identifies the app by
# the key, so a compromised one is a compromised app identity. Secret scanning
# with push protection is on for this repository and would catch some of these,
# but it runs server-side after a push is attempted -- this runs on a bare clone,
# before, and with no toolchain.
#
# Matched by NAME rather than by content, deliberately. A keystore is a binary
# blob with no reliable magic this can grep for, and a rule that tried to read
# them would fail open on the one that was encrypted or renamed. Names are what a
# build tool requires, so a key that is actually usable by Gradle has one of
# them.
KEY_MATERIAL_NAMES='.*\.(jks|keystore|p12|pfx|key)$|^keystore\.properties$|^(release|upload)-key\.'

#
# ⚠️ Both halves walk `repo_files`, which is the shared prune list and nothing
# else (#229). They used to walk two different lists -- an inline one here that
# skipped `fixtures` and kept `coverage`, and the shared one that does the
# opposite -- and the two halves of this one rule therefore disagreed with each
# other: a PEM under `fixtures/` was reported while a `.jks` beside it was not.
# The disagreement is resolved towards scanning MORE, because this is the rule
# whose violation cannot be undone: `fixtures` is authored and committed, and
# `coverage` is build output that exists only on a machine that has run the
# suite, so reporting it would be a red that only ever appears locally.
check_no_key_material() {
  local candidates
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    base="$(basename "${file}")"
    relative="${file#"${ROOT}"/}"
    if printf '%s' "${base}" | grep -qE "${KEY_MATERIAL_NAMES}"; then
      report REL001 "${relative}: looks like signing key material; keys belong in CI secrets and never in the repository (#95)"
    fi
  done < <(repo_files | sort)

  # A PEM private key carries its own banner, so this one IS checkable by
  # content -- and it is the case a name rule misses, because a private key
  # pasted into a config file has whatever name that file had.
  #
  # `grep` is handed the same walk's output rather than being asked to recurse
  # with an exclusion list of its own, because `--exclude-dir` cannot express
  # the two path-shaped prunes at all.
  #
  # ⚠️ The guard on an empty walk is where the two `xargs` disagree, and the
  # disagreement is the reason it is here rather than a taste. Given no input at
  # all, the BSD one on macOS does not run the utility -- observed -- and the
  # GNU one on the CI runner runs it once with no operands, which is what
  # `--no-run-if-empty` exists to prevent and is a GNU extension this script
  # cannot use. `grep` with no file operands reads standard input. Whether that
  # returns immediately or waits forever then depends on what standard input
  # happens to be, which is not a thing a gate should depend on.
  candidates="$(repo_files)"
  [ -n "${candidates}" ] || return 0
  while IFS= read -r hit; do
    [ -n "${hit}" ] || continue
    relative="${hit#"${ROOT}"/}"
    # This script and its own suite name the banner in order to look for it.
    case "${relative}" in
      scripts/check-repo-rules.sh | scripts/check-repo-rules.test.sh) continue ;;
    esac
    report REL001 "${relative}: contains a PRIVATE KEY block (#95)"
  done < <(repo_files_z \
    | xargs -0 grep -lE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null | sort)
}

check_no_key_material

# --- REL002: the Android build targets a current API level --------------------
# #95: *"The app targets API 36 and the build fails if the target level regresses
# below it."* Google requires new apps and updates to target Android 16 (API 36);
# #95 records that sources disagree on the exact enforcement date and that Play
# Console is authoritative for the account.
#
# ⚠️ Checked here rather than in Gradle, and that is the point of the criterion.
# A Gradle assertion fails for whoever runs a build -- and nobody in this
# environment can run one, because there is no Android SDK and dl.google.com is
# refused by the egress proxy (apps/mobile/README.md section 4). A rule that only
# fires inside a build nobody can run is a rule that never fires. This one runs
# on a bare clone, in the same CI step as every other repository rule.
MINIMUM_TARGET_SDK=36

check_android_target_sdk() {
  variables="${ROOT}/apps/mobile/android/variables.gradle"
  [ -f "${variables}" ] || return 0
  target="$(grep -oE 'targetSdkVersion[[:space:]]*=[[:space:]]*[0-9]+' "${variables}" | grep -oE '[0-9]+$' | head -1)"
  if [ -z "${target}" ]; then
    report REL002 "apps/mobile/android/variables.gradle: declares no targetSdkVersion (#95)"
    return 0
  fi
  if [ "${target}" -lt "${MINIMUM_TARGET_SDK}" ]; then
    report REL002 "apps/mobile/android/variables.gradle: targetSdkVersion ${target} is below the required ${MINIMUM_TARGET_SDK} (#95)"
  fi
}

check_android_target_sdk

# --- XML001 / XML002 / XML003 / XML004: XML a parser will accept --------------
#
# #225. `apps/mobile/android/app/src/main/AndroidManifest.xml` shipped in #87 as
# XML that NO parser accepts: three of its prose comments contained `--`, which
# XML 1.0 section 2.5 forbids inside a comment. The first Gradle build ever run
# against this repository -- on 2026-09-09, months after the file landed --
# failed on it with `ManifestMerger2$MergeFailureException: Error parsing`.
#
# ⚠️ Nothing here caught it, and the reason is the shape this repository keeps
# shipping. LIC001/LIC002 DO scan `.xml` files -- but only for an SPDX
# identifier in the first five lines. Nothing in `check:repo` parsed XML or
# looked past line five, so a manifest no parser accepts passed every gate, and
# the only thing that would have noticed is a build nobody in the original
# environment could run (`apps/mobile/README.md` section 5). That is the one
# file whose correctness under merge IS #87's first acceptance criterion.
#
# The precedent is DOC002, not a new idea. `check-doc-links.sh` already carries
# a rule of exactly this shape -- a code fence that is never closed -- for
# exactly this reason: without it the fence state machine STICKS, everything
# after it is skipped, and the file reports clean. An unclosed XML comment does
# the same thing to a manifest, and it does something worse to a parser: every
# element after it disappears from the document. XML002 is that rule.
#
# The scan is a delimiter state machine rather than a regular expression,
# because a comment spans lines and `grep` sees one line at a time -- a per-line
# match for `--` would fire on every `--` in a table separator, an SPDX header
# comment's rule, or an Android `tools:` attribute, none of which are inside a
# comment at all.
#
# ⚠️ CDATA is tracked for one reason: a `<!--` inside `<![CDATA[ ... ]]>` is
# TEXT, not a comment. Without this, a well-formed file carrying one in a CDATA
# section would open a comment that never closes and fail XML002 -- a gate going
# red on a correct file, which is the failure mode that teaches people to stop
# running the gate. A processing instruction, `<?target ... ?>`, is tracked for
# exactly the same reason: `Comment` is not a production inside `PIContent`, so
# `<?php <!-- a -- b --> ?>` is valid XML that `xmllint` accepts and that #228
# reported as XML001. #228's body claimed zero false positives; that one is the
# exception, and this is where it was fixed rather than restated.
#
# ⚠️ XML003 and XML004 are why the two above can be believed at all (#229).
# Tracking a region that suppresses scanning is tracking a way to switch the
# scanner OFF: before #229 an unclosed `<![CDATA[` set the CDATA state, nothing
# ever cleared it, and XML001 and XML002 both went silent for the remainder of
# the file -- which is DOC002's sticking-fence failure, in the rule that exists
# because of DOC002. The reproduction is in #229: `xmllint` says "CData section
# not finished" and this checker said "clean", while a real `--` violation on
# the next line went unreported.
#
# The fix is not a rule bolted on at EOF. It is that closure is decided WHEN THE
# REGION OPENS, by asking whether its terminator occurs anywhere after it:
#
#   * terminator found  -- enter the region, exactly as before. A CDATA section
#     spanning twenty lines is legal and its contents are text.
#   * no terminator at all -- report it, treat the rest of THAT LINE as the
#     region's text, and carry on scanning the next line.
#
# That is what makes the difference reportable rather than silent, and it is why
# the second half matters as much as the first: a rule that only said "unclosed
# CDATA" at EOF would fail the build and STILL hide every violation after it.
#
# ⚠️ Recovering at the end of the opening line, rather than dropping the opener
# entirely, keeps the conservative reading: up to the newline those characters
# really are the region's content, so nothing there is reported. Recovery is
# conditional on there being no terminator in the whole file, which is what
# stops it firing on a perfectly legal multi-line CDATA section.
#
# ⚠️ **This is deliberately NOT full well-formedness validation, and the limits
# are recorded here rather than discovered later.** A stray `<`, a mismatched
# tag, an unquoted attribute and a bad character reference all still pass. Nor
# does it undo every blinding: a STRAY `<![CDATA[` or `<?` that does have a
# terminator later in the file suppresses the span between the two, and no
# amount of state machinery can tell that apart from a section somebody meant.
# What #229 removes is the case where the region never ends and the file reports
# clean regardless. Full validation needs `xmllint`, which is a tool rather than
# coreutils, and this is the bare-clone gate -- CLAUDE.md section 4a: *bash and
# coreutils only, no install, no network*. A narrow rule that always runs is
# worth more than a broad one that is skipped wherever the tool is missing.
# Whether to ALSO add `xmllint` as a CI step, on the `shellcheck` precedent, is
# a follow-up and was out of scope for #225 and #229 alike.
#
# ⚠️ The line is tokenised by marking its delimiters rather than walked with a
# moving position, and that is a cost fix rather than a style one (#229). The
# version this replaced took `substr($0, pos)` on every iteration, copying the
# whole remainder of the line each time: O(k x len) for k delimiters on one
# line. Measured on this repository's awk (one-true-awk 20200816, macOS) against
# a single line of `<!-- x --><a/>` repeated:
#
#              delimiters       before        after
#              40 002           2.4 s         0.23 s
#              80 002           8.5 s         0.61 s
#             160 002          37.5 s         1.9 s
#             320 002          (not run)      6.5 s
#
# Four times the time for twice the input is the quadratic curve rather than a
# constant factor, and it put a 1 MB minified document in the tens of seconds
# and an 8 MB one out of reach. ⚠️ The replacement is NOT flat either -- about
# three times for twice the input at these sizes, which is awk allocating one
# field per token and not the scan re-reading the line -- so the honest claim is
# that the delimiter count no longer multiplies the line length, not that the
# cost is linear. No `.xml` this repository authors is within three orders of
# magnitude of these numbers; the case they are here for is a generator writing
# one long line.
#
# ⚠️ `split` will not say WHICH delimiter it matched -- the fourth argument that
# reports the separators is a GNU extension, and this has to run under the awk
# on a bare macOS clone. Marking each delimiter and splitting on the marker is
# how the delimiter ends up being read rather than located, which matters
# because `substr(s, pos, 9)` is not a constant-time operation in this awk
# either: it counts UTF-8 characters from the start of the string, so a scan
# built on absolute positions stays quadratic however it finds them. That was
# measured too -- a position-based version of this same tokeniser took 20 s on
# the 160 002 line, against 1.9 s for this one.
xml_comment_findings() {
  awk '
    function flag(kind, line, opened) {
      printf "%s\t%d\t%d\n", kind, line, opened
    }

    # A line with every delimiter wrapped in a marker, so that splitting on the
    # marker yields alternating text and delimiters and the delimiter can be
    # READ rather than located. Seven passes over the line, then one split, all
    # of them linear in its length.
    #
    # ⚠️ The markers are U+0001, which XML 1.0 forbids in a document at all --
    # not merely discourages -- so a line carrying one is already not XML. Any
    # that are there are replaced with a space first, because a marker arriving
    # in the input would otherwise be read as a delimiter boundary.
    #
    # ⚠️ The passes run longest delimiter first, and that ordering is safe
    # rather than lucky: no delimiter here is a substring of another, and each
    # pass leaves behind only text the later passes cannot match inside. The
    # result is the same token sequence a single leftmost-first scan produces --
    # `<!-->` is `<!--` followed by a stray `>`, and `<?>` is `<?` followed by a
    # stray `>`, in both readings.
    function marked(s) {
      gsub(/\001/, " ", s)
      gsub(/<!\[CDATA\[/, "\001<![CDATA[\001", s)
      gsub(/<!--/, "\001<!--\001", s)
      gsub(/-->/, "\001-->\001", s)
      gsub(/\]\]>/, "\001]]>\001", s)
      gsub(/<\?/, "\001<?\001", s)
      gsub(/\?>/, "\001?>\001", s)
      return s
    }

    # Pass one over a line: the index of its LAST CDATA and processing
    # instruction terminator, so that an opener can ask whether one follows it
    # without searching the rest of the file from where it stands.
    function survey(n,   part, m, i) {
      lastcdataclose[n] = 0
      lastpiclose[n] = 0
      m = split(text[n], part, "\001")
      for (i = 1; i <= m; i++) {
        if (part[i] == "]]>") lastcdataclose[n] = i
        else if (part[i] == "?>") lastpiclose[n] = i
      }
    }

    # Pass two: the state machine itself.
    #
    # ⚠️ The content of a comment is judged as it goes rather than assembled.
    # Both things XML001 asks about survive that -- a `--` is either inside one
    # field or straddles two, and the only delimiter that can begin with a
    # hyphen is the one that CLOSES the comment -- and assembling it would put
    # the quadratic cost back, one comment instead of one line: appending k
    # fields to a growing string copies that string k times.
    #
    # ⚠️ `linebad` and `last` are reset at the start of every line, which is not
    # tidiness: a hyphen ending one line and another opening the next is NOT a
    # double hyphen, because the line break is a character between them and
    # libxml2 accepts it. That is a case in the suite, found by running the rule
    # against xmllint over four hundred generated documents.
    function scan(n,   part, m, i, f, linebad, last) {
      linebad = 0
      last = ""
      m = split(text[n], part, "\001")
      for (i = 1; i <= m; i++) {
        f = part[i]
        if (incdata) {
          if (f == "]]>") incdata = 0
          continue
        }
        if (inpi) {
          if (f == "?>") inpi = 0
          continue
        }
        if (incomment) {
          if (f != "-->") {
            if (index(f, "--") > 0) linebad = 1
            else if (last == "-" && substr(f, 1, 1) == "-") linebad = 1
            if (f != "") last = substr(f, length(f), 1)
            continue
          }
          # "--->": the content ends on a hyphen that abuts the terminator,
          # which the XML grammar (Comment ::= *(Char - "-" | "-" (Char - "-"))
          # "-->") forbids for the same reason.
          if (linebad || last == "-") flag("XML001", n, opened)
          incomment = 0
          linebad = 0
          last = ""
          continue
        }
        if (f == "<!--") {
          incomment = 1
          opened = n
          linebad = 0
          last = ""
          continue
        }
        if (f == "<![CDATA[") {
          if (lastcdataclose[n] > i || cdatacloseafter[n]) { incdata = 1; continue }
          flag("XML003", n, n)
          return
        }
        if (f == "<?") {
          if (lastpiclose[n] > i || picloseafter[n]) { inpi = 1; continue }
          flag("XML004", n, n)
          return
        }
        # A "-->" or a "]]>" outside any region is ordinary text.
      }
      # A comment still open at the end of the line: the trailing-hyphen rule is
      # deliberately NOT applied here. It is about the character that abuts the
      # terminator, and there is no terminator on this line.
      if (incomment && linebad) flag("XML001", n, opened)
    }

    { text[NR] = marked($0) }

    END {
      for (n = 1; n <= NR; n++) survey(n)
      # Does a terminator appear on any LATER line? Accumulated backwards, so
      # the question costs nothing at the point an opener asks it.
      cdatacloseafter[NR] = 0
      picloseafter[NR] = 0
      for (n = NR - 1; n >= 1; n--) {
        cdatacloseafter[n] = (lastcdataclose[n + 1] > 0) || cdatacloseafter[n + 1]
        picloseafter[n] = (lastpiclose[n + 1] > 0) || picloseafter[n + 1]
      }
      incomment = 0; incdata = 0; inpi = 0; opened = 0
      for (n = 1; n <= NR; n++) scan(n)
      # Only a comment can still be open here. A CDATA section or a processing
      # instruction is entered ONLY when its terminator was already known to
      # follow, so neither can reach the end of the file unclosed -- which is
      # why there is no branch for them: a branch that cannot fire is the thing
      # this rule set exists to stop shipping.
      if (incomment) flag("XML002", opened, opened)
    }
  ' "$1"
}

check_xml_comments() {
  local file relative kind line opened tab
  # A literal tab, built rather than typed: an editor that expands tabs would
  # silently turn this field separator into spaces, and the failure would be a
  # rule that reports nothing rather than a syntax error.
  tab="$(printf '\t')"
  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    relative="${file#"${ROOT}"/}"
    while IFS="${tab}" read -r kind line opened; do
      [ -n "${kind}" ] || continue
      case "${kind}" in
        XML001)
          report XML001 "${relative}:${line}: \"--\" inside the XML comment opened at line ${opened}; XML 1.0 section 2.5 forbids it and no parser will read this file (#225)" ;;
        XML002)
          report XML002 "${relative}:${line}: XML comment is never closed; everything after it is swallowed, so the file parses as something other than what it looks like -- or not at all (#225)" ;;
        XML003)
          report XML003 "${relative}:${line}: <![CDATA[ opened here and never closed; a parser stops reading the document at this point, and before #229 it stopped this checker too (#229)" ;;
        XML004)
          report XML004 "${relative}:${line}: processing instruction opened here and never closed with \"?>\"; everything after it is read as instruction data (#229)" ;;
      esac
    done < <(xml_comment_findings "${file}")
  done < <(find "${ROOT}" \( "${GENERATED[@]}" \) -prune -o -type f -name '*.xml' -print | sort)
}

check_xml_comments

# --- Result -------------------------------------------------------------------

if [ "${findings}" -gt 0 ]; then
  printf '\n%s repository-rule violation(s). See docs/adr/0005-tech-stack.md and CONTRIBUTING.md.\n' \
    "${findings}" >&2
  exit 1
fi

printf 'check-repo-rules: clean (%s)\n' "${ROOT}"
