#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-doc-links.sh.
#
# Same shape as the other suites: a throwaway tree per case, the checker run
# against it, and an assertion on the exit code and the rule id.
#
# The cases that carry the weight are the ones where the checker must go RED and
# the ones where it must stay GREEN on something that *looks* like a link. A
# link checker that reports a URL, or an example inside a code fence, is one
# people turn off.
#
# Run: bash scripts/check-doc-links.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-doc-links.sh"

pass=0
fail=0
root=""

new_tree() {
  root="$(mktemp -d)"
}

cleanup_tree() {
  [ -n "${root}" ] && rm -rf "${root}"
  root=""
}

# doc <relative-path> <body>
doc() {
  mkdir -p "${root}/$(dirname "$1")"
  printf '%s\n' "$2" > "${root}/$1"
}

assert_clean() {
  local name="$1" out status
  out="$(bash "${CHECKER}" "${root}" 2>&1)"
  status=$?
  if [ "${status}" -eq 0 ]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit 0, got %s\n%s\n' "${name}" "${status}" "${out}"
  fi
  cleanup_tree
}

# assert_violation <name> <rule> <needle>
#
# The needle names the target or the file, never just the rule id: a checker
# that reports the wrong link still looks correct against a rule-id-only
# assertion, which is the defect the repo-rules suite records catching by
# mutation.
assert_violation() {
  local name="$1" rule="$2" needle="$3" out status
  out="$(bash "${CHECKER}" "${root}" 2>&1)"
  status=$?
  if [ "${status}" -ne 0 ] \
     && printf '%s' "${out}" | grep "^${rule}: " | grep -qF -- "${needle}"; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "${name}"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n     expected exit != 0 and a "%s: " line containing "%s"; got %s\n%s\n' \
      "${name}" "${rule}" "${needle}" "${status}" "${out}"
  fi
  cleanup_tree
}

# --- DOC001: the link resolves, or it does not -------------------------------

new_tree
doc README.md 'See [the notes](docs/notes.md).'
doc docs/notes.md '# Notes'
assert_clean 'a link that resolves passes'

new_tree
doc README.md 'See [the notes](docs/notes.md).'
assert_violation 'a link to a missing file is reported' DOC001 'docs/notes.md'

new_tree
doc README.md 'See [the notes](docs/notes.md).'
assert_violation 'the report names the document the link is in' DOC001 'README.md'

new_tree
doc docs/adr/0001.md 'Superseded by [0002](0002.md).'
doc docs/adr/0002.md '# Two'
assert_clean 'a link resolves relative to the file it is in, not to the root'

new_tree
doc docs/adr/0001.md 'Up to [the index](../architecture.md).'
doc docs/architecture.md '# Index'
assert_clean 'a parent-relative link resolves'

new_tree
doc docs/adr/0001.md 'Up to [the index](../architecture.md).'
assert_violation 'a broken parent-relative link is reported' DOC001 '../architecture.md'

new_tree
doc README.md 'The [scripts](scripts) directory.'
mkdir -p "${root}/scripts"
assert_clean 'a link to a directory resolves'

new_tree
doc README.md 'A [root-relative](/docs/notes.md) link.'
doc docs/notes.md '# Notes'
assert_clean 'a root-relative link resolves against the repository root'

# --- What must NOT be reported -----------------------------------------------
#
# A checker that reports these is a checker people switch off.

new_tree
doc README.md 'See [the spec](https://example.com/docs/notes.md) and [more](http://x/y).'
assert_clean 'an absolute URL is not checked, even when it looks like a path'

new_tree
doc README.md 'Mail [us](mailto:security@example.com).'
assert_clean 'a mailto: is not checked'

new_tree
doc README.md 'Jump to [section 4](#section-4).'
assert_clean 'a bare fragment is not checked'

# ⚠️ A case that CANNOT go red, and is kept anyway with that said out loud.
# An empty target resolves to the containing directory, which exists, so no
# guard in the checker can change this outcome — mutation confirmed it: deleting
# the `target == ""` guard left this green, and the guard was then deleted.
# Kept because it pins the intent for the next person who reaches for one.
new_tree
doc README.md 'An [empty]() target.'
assert_clean 'an empty target is left alone rather than reported as broken (structural)'

new_tree
doc README.md 'See [the notes](docs/notes.md#the-rule).'
doc docs/notes.md '# Notes'
assert_clean 'a fragment is stripped before the path is resolved'

new_tree
doc README.md 'See [the notes](docs/gone.md#the-rule).'
assert_violation 'a broken path with a fragment is still reported' DOC001 'docs/gone.md'

new_tree
doc README.md 'See [the notes](docs/notes.md "The notes").'
doc docs/notes.md '# Notes'
assert_clean 'a link title is not part of the path'

new_tree
doc README.md 'See [the notes](<docs/a b.md>).'
doc 'docs/a b.md' '# Spaced'
assert_clean 'an angle-bracket link carrying a space resolves'

new_tree
doc README.md 'See [the notes](docs/a%20b.md).'
doc 'docs/a b.md' '# Spaced'
assert_clean 'a percent-encoded space resolves'

# --- Code fences --------------------------------------------------------------
#
# Documentation that documents markdown must not be punished for it.

new_tree
doc README.md '```
See [an example](nowhere.md).
```'
assert_clean 'a link inside a backtick fence is an example, not a link'

new_tree
doc README.md '~~~
See [an example](nowhere.md).
~~~'
assert_clean 'a tilde fence works the same way'

new_tree
doc README.md '```ts
// [an example](nowhere.md)
```

And a real [one](docs/notes.md).'
doc docs/notes.md '# Notes'
assert_clean 'a language-tagged fence is still a fence'

# The state machine must toggle BACK. Without this case a checker that treated
# the first fence as "skip the rest of the file" would pass every case above.
new_tree
doc README.md '```
[an example](nowhere.md)
```

And a broken [one](docs/gone.md).'
assert_violation 'a link AFTER a closed fence is checked' DOC001 'docs/gone.md'

# --- DOC002: an unclosed fence is a finding, not a silent skip ----------------

new_tree
doc README.md 'Text.

```
[an example](nowhere.md)'
assert_violation 'an unclosed fence is reported' DOC002 'README.md'

new_tree
doc README.md '```
[an example](nowhere.md)
```'
assert_clean 'a closed fence is not reported as unclosed'

# --- What is not scanned ------------------------------------------------------

new_tree
doc README.md '# Fine'
doc node_modules/thing/README.md 'A [broken](nope.md) link in a dependency.'
assert_clean 'node_modules is not scanned'

new_tree
doc README.md '# Fine'
doc .claude/worktrees/other/README.md 'A link from another branch: [link](nope.md).'
assert_clean 'a worktree of another branch is not scanned'

new_tree
doc README.md '# Fine'
doc dist/README.md 'Build output with a [broken](nope.md) link.'
assert_clean 'build output is not scanned'

# --- Reporting ----------------------------------------------------------------

new_tree
doc README.md 'One [a](a.md) and two [b](b.md).'
out="$(bash "${CHECKER}" "${root}" 2>&1)"
count="$(printf '%s\n' "${out}" | grep -c '^DOC001: ')"
if [ "${count}" -eq 2 ]; then
  pass=$((pass + 1))
  printf 'ok   every broken link is reported, not just the first\n'
else
  fail=$((fail + 1))
  printf 'FAIL every broken link is reported, not just the first\n     expected 2, got %s\n%s\n' \
    "${count}" "${out}"
fi
cleanup_tree

# --- The real repository must pass --------------------------------------------

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
out="$(bash "${CHECKER}" "${REPO_ROOT}" 2>&1)"
status=$?
if [ "${status}" -eq 0 ]; then
  pass=$((pass + 1))
  printf 'ok   this repository has no broken documentation links\n'
else
  fail=$((fail + 1))
  printf 'FAIL this repository has no broken documentation links\n     exit %s\n%s\n' \
    "${status}" "${out}"
fi

printf '\n%s passed, %s failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
