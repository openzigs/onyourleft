#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-cost-model.mjs.
#
# Same shape as the other suites: each case builds a throwaway document, runs
# the checker against it, and asserts on the output and the exit code.
#
# The checker exists because a cost model's arithmetic stops being true the
# moment one of its inputs is edited, and a Markdown table cannot notice. So
# the cases that matter are the ones where it must go RED: an input changed
# without the table, a figure typed in by hand, a provenance dropped, and --
# the one that matters most -- a document whose tables parse and are never
# actually compared against anything, which is the pass that is
# indistinguishable from a correct model.
#
# Every fixture is written from `base_document`, which is a CONSISTENT model at
# deliberately round numbers rather than a copy of docs/cost-model.md. Copying
# the real document would make this suite fail the day somebody legitimately
# re-reads a rate, which is precisely the event the gate exists to accommodate.
#
# Unlike the four bare-clone checkers, this one needs Node. It is therefore NOT
# part of `pnpm run check:repo`.
#
# Run: bash scripts/check-cost-model.test.sh

# The assertions hold literal Markdown with backticks and `$` which must reach
# `grep -F` unexpanded. Single-quoted for that reason, so SC2016 is the
# intended shape rather than a mistake -- the same call the sibling suites make.
# shellcheck disable=SC2016

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-cost-model.mjs"

pass=0
fail=0
tmp=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

# base_document -- a complete, self-consistent model.
#
# The inputs are chosen so every derived figure is exact in cents and can be
# checked by eye: a EUR 10.00 box at 1.50, a 200 GB archive at $0.01/GB-month,
# 10 map loads of 10 tiles at a 60% hit rate and $2.00 per million reads.
#
# NOT round in the sense of being 1 or 0. Every rate here is deliberately away
# from the identity of the operation it takes part in, and that is a finding
# rather than a preference: the first version of this fixture priced Class B
# reads at $1.00 per million, which made `* p_classB` indistinguishable from
# omitting it, and a mutation that deleted the multiplication passed all 49
# assertions. A zero egress price would hide `s` the same way, and an exchange
# rate of 1.00 would hide `fx`.
base_document() {
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/docs"
  cat > "${tmp}/docs/cost-model.md" <<'DOC'
# A model

<!-- cost-model:inputs -->

| Input | Value | Unit | Provenance | Confidence |
| --- | --- | --- | --- | --- |
| `r` | 4 | rides per active per month | a source | inherited |
| `d` | 2 | recorded hours per ride | a source | inherited |
| `b` | 25,000 | bytes per recorded hour | a source | measured |
| `m` | 10 | months | a source | inferred |
| `L` | 10 | map loads per active per month | a source | inferred |
| `T` | 10 | tile requests per map load | a source | inherited |
| `h` | 0.6 | share | a source | read |
| `s` | 70,000 | bytes | a source | inherited |
| `S` | 200,000,000,000 | bytes | a source | measured |
| `p_storage` | 0.01 | USD per GB-month | a source | read |
| `p_classB` | 2.00 | USD per million | a source | read |
| `p_egress` | 0.01 | USD per GB | a source | read |
| `box_eur` | 10.00 | EUR per month | a source | inherited |
| `fx` | 1.50 | USD per EUR | a source | read |
| `domain_usd_year` | 12.00 | USD per year | a source | read |
| `email_usd_month` | 0.25 | USD per month | a source | inherited |
| `errors_usd_month` | 0.75 | USD per month | a source | inherited |
| `fee_rate` | 0.10 | share | a source | read |
| `fee_fixed` | 1.00 | USD | a source | read |
| `support_usd_year` | 120.00 | USD per year | a source | inferred |

<!-- cost-model:projection -->

| Line item | 1,000 MAU | 10,000 MAU | 100,000 MAU |
| --- | --- | --- | --- |
| Instance (one box) | $15.00 | $15.00 | $15.00 |
| Basemap archive storage | $2.00 | $2.00 | $2.00 |
| Basemap tile requests | $0.08 | $0.80 | $8.00 |
| Basemap egress | $0.07 | $0.70 | $7.00 |
| Activity streams (object storage) | $0.02 | $0.20 | $2.00 |
| Infrastructure subtotal | $17.17 | $18.70 | $34.00 |
| Infrastructure, per 1,000 MAU | $17.17 | $1.87 | $0.34 |
| Domain name | $1.00 | $1.00 | $1.00 |
| Transactional email | $0.25 | $0.25 | $0.25 |
| Error tracking | $0.75 | $0.75 | $0.75 |
| Fully loaded total | $19.17 | $20.70 | $36.00 |
| Fully loaded, per 1,000 MAU | $19.17 | $2.07 | $0.36 |
| Fully loaded, US cents per athlete per year | 23.00 | 2.48 | 0.43 |
| Dominant line item | Instance (one box) | Instance (one box) | Instance (one box) |
| Second-largest line item | Basemap archive storage | Basemap archive storage | Basemap tile requests |

<!-- cost-model:donations -->

| Billing cadence | Charges per year | Amount per charge | Fees per year | Share of the gift |
| --- | --- | --- | --- | --- |
| Monthly | 12 | $10.00 | $24.00 | 20.0% |
| Quarterly | 4 | $30.00 | $16.00 | 13.3% |
| Annually | 1 | $120.00 | $13.00 | 10.8% |
DOC
}

# edit <sed expression> -- rewrite the fixture document in place.
edit() {
  local expression="$1"
  sed -i.bak "${expression}" "${tmp}/docs/cost-model.md"
  rm -f "${tmp}/docs/cost-model.md.bak"
}

# run_check [extra args] -- output on stdout+stderr, exit code in ${code}.
run_check() {
  out="$(node "${CHECK}" --root "${tmp}" "$@" 2>&1)"
  code=$?
}

assert_green() {
  local name="$1"
  if [ "${code}" -eq 0 ]; then pass=$((pass + 1)); else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected exit 0, got %d:\n%s\n\n' "${name}" "${code}" "${out}"
  fi
}

assert_red() {
  local name="$1"
  if [ "${code}" -ne 0 ]; then pass=$((pass + 1)); else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected a non-zero exit, got 0:\n%s\n\n' "${name}" "${out}"
  fi
}

assert_says() {
  local name="$1" expected="$2"
  if printf '%s' "${out}" | grep -qF -- "${expected}"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n  expected to contain: %s\n  got:\n%s\n\n' "${name}" "${expected}" "${out}"
  fi
}

assert_silent_about() {
  local name="$1" unexpected="$2"
  if printf '%s' "${out}" | grep -qF -- "${unexpected}"; then
    fail=$((fail + 1))
    printf 'FAIL: %s\n  did not expect: %s\n  got:\n%s\n\n' "${name}" "${unexpected}" "${out}"
  else
    pass=$((pass + 1))
  fi
}

# --- A model that agrees with itself ----------------------------------------
base_document
run_check
assert_green 'a document whose figures follow from its inputs passes'
assert_says 'and says how many figures it compared' 'figures checked'
assert_says 'and names the three scales' '1,000, 10,000, 100,000 monthly actives'

# --- COST001: no document at all --------------------------------------------
tmp="$(mktemp -d)"
run_check
assert_red 'a missing document fails'
assert_says 'and says so plainly' 'COST001: docs/cost-model.md is not there'

# --- COST001: an anchor that is not there -----------------------------------
base_document
edit 's|<!-- cost-model:projection -->|<!-- cost-model:forecast -->|'
run_check
assert_red 'a renamed anchor fails'
assert_says 'and names the anchor it wanted' 'carries no <!-- cost-model:projection --> anchor'

# --- COST001: an anchor with nothing table-shaped after it ------------------
#
# The anchor is moved to the very end of the file, which is how an edit that
# reorders sections silently detaches a gate from the table it was reading.
base_document
edit 's|<!-- cost-model:donations -->||'
printf '\n<!-- cost-model:donations -->\n\nNothing follows.\n' >> "${tmp}/docs/cost-model.md"
run_check
assert_red 'an anchor followed by no table fails'
assert_says 'and says which anchor' 'no table follows <!-- cost-model:donations -->'

# --- COST001: the wrong populations -----------------------------------------
base_document
edit 's|100,000 MAU |50,000 MAU |'
run_check
assert_red 'a projection stated at the wrong scales fails'
assert_says 'and names the criterion' "#54's second acceptance criterion"
assert_says 'and says what it found' '1000,10000,50000'

# --- COST001: a scale column that is not a population at all ----------------
base_document
edit 's/| 10,000 MAU |/| lots of MAU |/'
run_check
assert_red 'an unreadable scale column fails'
assert_says 'and quotes it' 'scale columns are not all numbers'

# --- COST002: an input the model needs, gone --------------------------------
base_document
edit '/^| `p_classB` |/d'
run_check
assert_red 'a missing input fails'
assert_says 'and names it and what it meant' 'missing `p_classB`'
assert_says 'and says what it is for' 'Class B reads, USD per million'

# --- COST002: an input whose value is not a number --------------------------
base_document
edit 's/| `box_eur` | 10.00 |/| `box_eur` | about ten euro |/'
run_check
assert_red 'an unreadable input value fails'
assert_says 'and quotes the cell' 'input `box_eur` has no readable value'

# --- ...and it must not then report every figure as disagreeing with NaN ----
assert_silent_about 'an unreadable input does not bury the cause in COST003 noise' 'COST003'

# --- COST003: a figure edited without its input -----------------------------
#
# This is the defect the whole gate exists for: somebody re-reads a rate,
# updates one cell of the projection by hand, and the rest of the column is
# now arithmetic that was true last year.
base_document
edit 's/| Basemap tile requests | \$0.08 | \$0.80 | \$8.00 |/| Basemap tile requests | $0.08 | $0.85 | $8.00 |/'
run_check
assert_red 'a hand-edited figure fails'
assert_says 'and says both numbers' 'at 10,000 MAU states $0.85; the model gives $0.80'

# --- COST003: an input edited without the figures ---------------------------
#
# The same defect from the other end, and the more likely one: the rate moves
# and nobody recomputes the column.
base_document
edit 's/| `p_storage` | 0.01 |/| `p_storage` | 0.02 |/'
run_check
assert_red 'an input changed without the projection fails'
assert_says 'and names the storage line' '"Basemap archive storage" at 1,000 MAU states $2.00'

# --- COST003: a projection row deleted --------------------------------------
base_document
edit '/^| Basemap egress |/d'
run_check
assert_red 'a deleted projection row fails'
assert_says 'and names the row' 'no row for "Basemap egress"'

# --- COST003: a donations figure that does not follow -----------------------
base_document
edit 's/| Quarterly | 4 | \$30.00 | \$16.00 | 13.3% |/| Quarterly | 4 | $30.00 | $12.00 | 13.3% |/'
run_check
assert_red 'a hand-edited processing fee fails'
assert_says 'and says both numbers' '"Quarterly" row'"'"'s fees per year states 12.00; the model gives 16.00'

# --- COST004: an input with no provenance -----------------------------------
base_document
edit 's/| `L` | 10 | map loads per active per month | a source | inferred |/| `L` | 10 | map loads per active per month |  | inferred |/'
run_check
assert_red 'an input with no provenance fails'
assert_says 'and names it' 'input `L` states no provenance'

# --- COST004: a confidence outside the vocabulary ---------------------------
#
# "about right" is the failure mode this rule is for: an input that is really a
# guess, classified as though it were a reading. The vocabulary is closed so a
# new word is a decision somebody takes rather than a cell somebody types.
base_document
edit 's/| `S` | 200,000,000,000 | bytes | a source | measured |/| `S` | 200,000,000,000 | bytes | a source | about right |/'
run_check
assert_red 'an unrecognised confidence fails'
assert_says 'and quotes it and the vocabulary' 'is classified "about right"'
assert_says 'and lists what is allowed' 'measured, read, inherited, inferred'

# --- COST005: a table that parses and is never compared ---------------------
#
# The vacuous pass. Every donations row is short of a column, so the reader
# skips all of them, no rule disagrees with anything, and without this guard
# the run would exit 0 saying the model checks out.
base_document
edit 's/| Monthly | 12 | \$10.00 | \$24.00 | 20.0% |/| Monthly | 12 | $10.00 | $24.00 |/'
edit 's/| Quarterly | 4 | \$30.00 | \$16.00 | 13.3% |/| Quarterly | 4 | $30.00 | $16.00 |/'
edit 's/| Annually | 1 | \$120.00 | \$13.00 | 10.8% |/| Annually | 1 | $120.00 | $13.00 |/'
run_check
assert_red 'a donations table nothing compares fails'
assert_says 'and says which table' 'COST005: the donations table yielded no comparison'

# --- COST003: the headline claim, rounded into meaninglessness --------------
#
# "costs somebody about ten cents a year" is the sentence this whole document
# exists to support, and at two decimal places of DOLLARS it is $0.00 at two of
# the three scales. A row restated in dollars is caught here rather than
# quietly becoming a claim nothing can contradict.
base_document
edit 's/| Fully loaded, US cents per athlete per year | 23.00 | 2.48 | 0.43 |/| Fully loaded, US cents per athlete per year | 0.23 | 0.02 | 0.00 |/'
run_check
assert_red 'the per-athlete row restated in dollars fails'
assert_says 'and says both' 'per athlete per year" at 100,000 MAU states 0.00; the model gives 0.43'

# --- COST006: a dominance claim the model does not support ------------------
#
# A derived claim in words rather than dollars, and the one a reader is most
# likely to carry away: "the next thing to optimise". It goes stale silently,
# because no figure in the table changes when it becomes wrong.
base_document
edit 's/| Dominant line item | Instance (one box) | Instance (one box) | Instance (one box) |/| Dominant line item | Instance (one box) | Instance (one box) | Basemap tile requests |/'
run_check
assert_red 'a wrong dominant line item fails'
assert_says 'and says both' 'states "Basemap tile requests"; the model gives "Instance (one box)"'

# --- COST006: ...and the ordering it actually turns on ----------------------
#
# Second place is where the model's answer changes with scale, so a document
# that states one answer for all three columns is wrong at exactly one of them.
base_document
edit 's/| Second-largest line item | Basemap archive storage | Basemap archive storage | Basemap tile requests |/| Second-largest line item | Basemap archive storage | Basemap archive storage | Basemap archive storage |/'
run_check
assert_red 'a second-largest line that does not move with scale fails'
assert_says 'and names the scale it is wrong at' 'at 100,000 MAU states "Basemap archive storage"'

# --- COST006: the row removed altogether ------------------------------------
base_document
edit '/^| Second-largest line item |/d'
run_check
assert_red 'a deleted dominance row fails'
assert_says 'and says so' 'no "Second-largest line item" row'

# --- Formatting a reviewer will use is not a disagreement -------------------
#
# Bold, code spans and thousands separators are how a figure gets emphasised in
# review. A gate that goes red on emphasis gets worked around.
base_document
edit 's/| Instance (one box) | \$15.00 | \$15.00 | \$15.00 |/| Instance (one box) | **$15.00** | `$15.00` | $15.00 |/'
run_check
assert_green 'emphasis on a figure is not a disagreement'

# --- --print regenerates the tables rather than inviting a hand edit --------
base_document
edit 's/| `p_storage` | 0.01 |/| `p_storage` | 0.02 |/'
run_check --print
assert_green 'printing works from the inputs alone, even when the document disagrees'
assert_says 'and gives the recomputed storage line' '| Basemap archive storage | $4.00 | $4.00 | $4.00 |'
assert_says 'and the crossover the prose quotes' 'Tile requests overtake archive storage at'

# --- ...and does not print a table of NaN when an input is unreadable -------
base_document
edit 's/| `S` | 200,000,000,000 |/| `S` | two hundred gigabytes |/'
run_check --print
assert_red 'printing refuses when an input cannot be read'
assert_silent_about 'and prints no NaN' 'NaN'

# --- The checker run from a path containing a space --------------------------
#
# `realpathSync` on the entry point is how this script decides it is being run
# rather than imported, and the sibling suites record that the predicate can go
# false for reasons that have nothing to do with the repository. A checker that
# quietly does nothing is the failure this whole file is about.
base_document
spaced_home="$(mktemp -d)/a directory"
mkdir -p "${spaced_home}"
cp "${CHECK}" "${spaced_home}/check-cost-model.mjs"
edit '/^| `fx` |/d'
spaced_out="$(node "${spaced_home}/check-cost-model.mjs" --root "${tmp}" 2>&1)"
spaced_code=$?
if [ "${spaced_code}" -ne 0 ]; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: the checker exits 0 from a path containing a space\n  output:\n%s\n' "${spaced_out}"
fi
if printf '%s' "${spaced_out}" | grep -qF 'missing `fx`'; then
  pass=$((pass + 1))
else
  fail=$((fail + 1))
  printf 'FAIL: from a spaced path the checker did not name the missing input\n  output:\n%s\n' "${spaced_out}"
fi
rm -rf "${spaced_home%/*}"

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ] || exit 1
