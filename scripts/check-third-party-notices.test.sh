#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-third-party-notices.mjs -- #664.
#
# Each case builds a throwaway workspace, runs the generator or the check over
# it, and asserts on the output, the exit code and the document written.
#
# ⚠️ **pnpm is substituted the way the real one is found: on PATH.** A fixture
# writes its own `pnpm` into ${tmp}/bin, answering `install`, `list` and
# `licenses list` from files the case wrote. There is no test-only seam in the
# checker for it, so the closure is read by the real `discoverPackages` and
# `readClosure` out of check-dependency-licences.mjs -- which is the point: the
# union over workspace packages is the claim under test, and a seam below it
# would test a copy of it.
#
# The fake answers `licenses list` WITHOUT `--prod` with the dev closure as
# well, so a generator that dropped `--prod` would notice a build tool the app
# does not ship, and a case says so.
#
# Unlike the bare-clone checkers this one needs Node, so it is NOT part of
# `pnpm run check:repo`.
#
# Run: bash scripts/check-third-party-notices.test.sh

# The assertions hold literal text with backticks that must reach `grep -F`
# unexpanded, so they are single-quoted. Same call as check-wiring.test.sh.
# shellcheck disable=SC2016

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHECK="${SCRIPT_DIR}/check-third-party-notices.mjs"

pass=0
fail=0
tmp=""
out=""
code=0

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

DOCUMENT='apps/web/public/licences/third-party.txt'
CONTENTS='apps/web/src/credits/third-party-contents.txt'

# package <name> <version> -- an installed package directory; echoes its path.
package() {
  local dir escaped
  escaped="$(printf '%s' "$1" | tr '/@' '+_')"
  dir="${tmp}/node_modules/.pnpm/${escaped}@$2/node_modules/$1"
  mkdir -p "${dir}"
  printf '{"name":"%s","version":"%s"}\n' "$1" "$2" > "${dir}/package.json"
  printf '%s' "${dir}"
}

# closure <workspace-package> <json-object> -- what `pnpm licenses list --prod`
# says for that workspace package. `{}` is written as pnpm's prose, as pnpm does.
closure() {
  local file
  file="${tmp}/fake/prod/$(printf '%s' "$1" | tr '/@' '+_').json"
  if [ "$2" = '{}' ]; then printf 'No licenses in packages found\n' > "${file}"; else printf '%s\n' "$2" > "${file}"; fi
}

# dev_closure <workspace-package> <json-object> -- the full closure, --prod absent.
dev_closure() {
  printf '%s\n' "$2" > "${tmp}/fake/all/$(printf '%s' "$1" | tr '/@' '+_').json"
}

# entry <licence> <name> <version> <dir> -- one pnpm licence group. pnpm keys
# a group by licence; the key here is the licence AND the name, so two packages
# under one licence stay two groups rather than a duplicate key the parser
# collapses. `readClosure` reads the values and never the keys.
entry() {
  printf '"%s %s":[{"name":"%s","versions":["%s"],"paths":["%s"],"license":"%s"}]' "$1" "$2" "$2" "$3" "$4" "$1"
}

# The reviewed bundler entries every fixture carries, for the vite and rolldown
# new_fixture installs. `through` stops before the part of vite's file that
# covers code which does NOT ship, and a case holds that.
BUNDLER_ENTRIES='{"vite@8.3.0":{"what":"its preload helper","files":[{"file":"LICENSE.md","from":"# Vite core license","through":"SOFTWARE."}]},"rolldown@1.2.6":{"what":"its interop runtime","files":[{"file":"LICENSE"}]}}'

# inputs <json> -- the web inputs, with the fixture's bundler entries added
# unless the JSON names its own.
inputs() {
  node -e 'const j = JSON.parse(process.argv[1]); j.writtenByTheBundler ??= JSON.parse(process.argv[2]); process.stdout.write(JSON.stringify(j));' \
    "$1" "${BUNDLER_ENTRIES}" > "${tmp}/apps/web/third-party-notices.json"
}

# entry_block <name> <version> -- that entry of the document, separator to separator.
entry_block() {
  awk -v name="Name: $1" -v version="Version: $2" '
    /^========================================================================$/ { if (on) exit; held = 1; next }
    held == 1 { held = ($0 == name) ? 2 : 0; next }
    held == 2 { if ($0 == version) on = 1; held = 0 }
    on { print }
  ' "${tmp}/${DOCUMENT}"
}

new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/bin" "${tmp}/fake/prod" "${tmp}/fake/all" "${tmp}/LICENSES" \
    "${tmp}/apps/web/public/licences" "${tmp}/apps/web/src/credits" "${tmp}/apps/mobile" \
    "${tmp}/packages/store"
  cp "${REPO_ROOT}/LICENSES/Apache-2.0.txt" "${tmp}/LICENSES/Apache-2.0.txt"
  printf '[{"name":"root","path":"%s"},{"name":"@onyourleft/web","path":"%s/apps/web"},{"name":"@onyourleft/store","path":"%s/packages/store"}]\n' \
    "${tmp}" "${tmp}" "${tmp}" > "${tmp}/fake/workspace.json"

  cat > "${tmp}/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
fake="$(cd "$(dirname "$0")/../fake" && pwd)"
case "$1" in
  install)
    if [ -f "${fake}/install-fails" ]; then echo ' ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"'; exit 1; fi
    touch "${fake}/installed"; exit 0 ;;
  list) cat "${fake}/workspace.json" ;;
  licenses)
    name="$5"; kind=all
    for arg in "$@"; do [ "${arg}" = --prod ] && kind=prod; done
    file="${fake}/${kind}/$(printf '%s' "${name}" | tr '/@' '+_').json"
    [ -f "${file}" ] || file="${fake}/prod/$(printf '%s' "${name}" | tr '/@' '+_').json"
    if [ -f "${file}" ]; then cat "${file}"; else echo 'No licenses in packages found'; fi ;;
  *) echo "fake pnpm: unexpected $*" >&2; exit 2 ;;
esac
PNPM
  chmod +x "${tmp}/bin/pnpm"

  inputs '{"noLicenceFile":{},"copiedIntoBuild":[]}'
  cat > "${tmp}/apps/mobile/native-closure.json" <<'JSON'
{
  "reviewed": "2026-09-27",
  "libraries": [
    {
      "coordinate": "org.example:native-lib:2.1.0",
      "licence": "Apache-2.0",
      "pom": "The Apache Software License, Version 2.0",
      "notice": { "source": "https://example.invalid/NOTICE", "read": "2026-09-27", "text": "Native Lib\nCopyright 2026 Example\n" }
    }
  ],
  "projects": [{ "project": ":bridge", "package": "react", "why": "x" }]
}
JSON

  # react reaches the app directly; dexie only through the store's closure.
  REACT="$(package react 19.0.0)"
  printf 'MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n' > "${REACT}/LICENSE"
  DEXIE="$(package dexie 4.4.6)"
  printf 'Apache License\nVersion 2.0 (the dexie copy)\n' > "${DEXIE}/LICENSE"
  printf 'Dexie.js\nCopyright (c) 2014 David Fahlander\n' > "${DEXIE}/NOTICE"
  VITEST="$(package vitest 4.1.11)"
  printf 'MIT License -- a build tool\n' > "${VITEST}/LICENSE"

  # The bundler, laid out as pnpm lays it out: vite reached from apps/web
  # through a symlink, rolldown as vite's sibling inside .pnpm. Neither is in
  # any closure -- vite is a devDependency -- which is the point.
  VITE="${tmp}/node_modules/.pnpm/vite@8.3.0/node_modules/vite"
  ROLLDOWN="${tmp}/node_modules/.pnpm/vite@8.3.0/node_modules/rolldown"
  mkdir -p "${VITE}" "${ROLLDOWN}" "${tmp}/apps/web/node_modules"
  printf '{"name":"vite","version":"8.3.0","license":"MIT"}\n' > "${VITE}/package.json"
  printf '# Vite core license\nVite fixture core licence\nSOFTWARE.\n\n# Licenses of bundled dependencies\nbundled into the dev server only\n' > "${VITE}/LICENSE.md"
  printf '{"name":"rolldown","version":"1.2.6","license":"MIT"}\n' > "${ROLLDOWN}/package.json"
  printf 'Rolldown fixture licence\n' > "${ROLLDOWN}/LICENSE"
  ln -s "${VITE}" "${tmp}/apps/web/node_modules/vite"

  closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}")}"
  closure @onyourleft/store "{$(entry Apache-2.0 dexie 4.4.6 "${DEXIE}")}"
  dev_closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}"),$(entry MIT vitest 4.1.11 "${VITEST}")}"
}

# run <args...> -- output on stdout+stderr, exit code in ${code}.
run() {
  out="$(PATH="${tmp}/bin:${PATH}" node "${CHECK}" --root "${tmp}" "$@" 2>&1)"
  code=$?
}

generate() { run --write --assume-installed; }

ok() { printf 'ok   %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL %s\n%s\n' "$1" "${2:-${out}}"; fail=$((fail + 1)); }

assert_exit() { if [ "${code}" -eq "$2" ]; then ok "$1"; else bad "$1 -- expected exit $2, got ${code}"; fi; }
assert_says() { if printf '%s' "${out}" | grep -qF -- "$2"; then ok "$1"; else bad "$1 -- output lacks: $2"; fi; }
assert_silent() { if printf '%s' "${out}" | grep -qF -- "$2"; then bad "$1 -- output has: $2"; else ok "$1"; fi; }
assert_document_has() {
  if grep -qF -- "$2" "${tmp}/${DOCUMENT}" 2>/dev/null; then ok "$1"; else bad "$1 -- document lacks: $2" "$(cat "${tmp}/${DOCUMENT}" 2>/dev/null)"; fi
}
assert_document_lacks() {
  if grep -qF -- "$2" "${tmp}/${DOCUMENT}" 2>/dev/null; then bad "$1 -- document has: $2"; else ok "$1"; fi
}

# --- The agreeing case --------------------------------------------------------

new_fixture
generate
assert_exit 'generates over a fixture workspace' 0
run --assume-installed
assert_exit 'and the check agrees with what it just wrote' 0
assert_says 'and says how much it checked' '2 packages, 2 build tools and 1 native libraries'
if [ -f "${tmp}/${CONTENTS}" ] && grep -qF 'Part 1 — in the app (2 packages)' "${tmp}/${CONTENTS}" \
  && ! grep -qF -- '=====' "${tmp}/${CONTENTS}"; then
  ok 'writes the contents file, which is the document up to its first entry'
else
  bad 'writes the contents file, which is the document up to its first entry' "$(cat "${tmp}/${CONTENTS}" 2>/dev/null)"
fi

# --- The union: a package reached only through a workspace link --------------
#
# ⚠️ The mutation this case exists for: reading `--filter @onyourleft/web`
# alone. `dexie` is in the store's closure and nowhere in the web's, exactly as
# it is in the real tree (CLAUDE.md §4g).

new_fixture
generate
assert_document_has 'notices a dependency reached only through a workspace link' 'Name: dexie'
assert_document_has 'with its own LICENSE, verbatim' 'Version 2.0 (the dexie copy)'
assert_document_has 'and its NOTICE file, verbatim' 'Copyright (c) 2014 David Fahlander'
assert_document_has 'and the one the app depends on directly' 'Copyright (c) Meta Platforms, Inc. and affiliates.'

# --- The distributed closure, not the build-time one --------------------------

assert_document_lacks 'does not notice a build tool the app does not ship' 'Name: vitest'

# --- The Lucide/Feather case: the text comes from the file, not the field -----
#
# lucide-react's manifest says ISC. Its LICENSE is ISC AND MIT, the MIT half
# covering the icons derived from Feather, (c) Cole Bemis. Both halves must
# reach the document; the field is only what the package declares.

new_fixture
LUCIDE="$(package lucide-react 1.48.0)"
cat > "${LUCIDE}/LICENSE" <<'TEXT'
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2026.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2026 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software.
TEXT
closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}"),$(entry ISC lucide-react 1.48.0 "${LUCIDE}")}"
generate
assert_exit 'generates with a package whose manifest names one licence of two' 0
assert_document_has 'Lucide/Feather: the ISC section its manifest names' 'ISC License'
assert_document_has 'Lucide/Feather: the MIT section its manifest does NOT name' 'The MIT License (MIT) (for portions derived from Feather)'
assert_document_has 'Lucide/Feather: Cole Bemis, whose notice the field would drop' 'Copyright (c) 2013-2026 Cole Bemis'
assert_document_has 'and still reports the declared expression as declared' 'Licence: ISC'

# --- Licence files under the names packages actually use ----------------------

new_fixture
ODD="$(package odd-names 1.0.0)"
printf 'lower-case licence\n' > "${ODD}/license"
printf 'second licence\n' > "${ODD}/LICENSE-MIT"
printf 'copying text\n' > "${ODD}/COPYING.md"
mkdir -p "${ODD}/licenses"
printf 'a file in a root licenses directory\n' > "${ODD}/licenses/other.txt"
printf 'not a licence\n' > "${ODD}/licensed-material.txt"
printf 'third-party notices text\n' > "${ODD}/ThirdPartyNotices.txt"
printf 'copyright notice text\n' > "${ODD}/CopyrightNotice.txt"
printf 'module.exports = "a licence helper, which is code"\n' > "${ODD}/license.js"
printf 'export declare const notice: string; // types\n' > "${ODD}/notice.d.ts"
printf 'export const inDirectory = "code";\n' > "${ODD}/licenses/helper.js"
closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}"),$(entry MIT odd-names 1.0.0 "${ODD}")}"
generate
assert_document_has 'reads a lower-case `license`' 'lower-case licence'
assert_document_has 'reads a suffixed LICENSE-MIT' 'second licence'
assert_document_has 'reads COPYING' 'copying text'
assert_document_lacks 'does not read a file whose name only starts like one' 'not a licence'
assert_document_has 'reads a notice whose name does not START with notice (ThirdPartyNotices.txt)' 'third-party notices text'
assert_document_has 'reads tslib'\''s shape, CopyrightNotice.txt' 'copyright notice text'
assert_document_has 'reads every file in a root licenses/ directory' 'a file in a root licenses directory'
assert_document_has 'naming it by its path in the package' '--- licenses/other.txt (from the package) ---'
assert_document_lacks 'does not read a license.js, which is code' 'a licence helper, which is code'
assert_document_lacks 'does not read a notice.d.ts, which is code' 'export declare const notice'
assert_document_lacks 'does not read code inside the licenses/ directory either' 'inDirectory'

# --- One package at two versions: pnpm's versions[i] goes with paths[i] --------
#
# pnpm groups a package installed at two versions into ONE entry with parallel
# `versions` and `paths` arrays. Each version must be noticed with the text
# from its OWN directory -- a generator that took paths[0] for both would
# notice version 2 with version 1's licence and every check would still pass.

new_fixture
TWO_A="$(package twice 1.0.0)"
TWO_B="$(package twice 2.0.0)"
printf 'the licence of twice one\n' > "${TWO_A}/LICENSE"
printf 'the licence of twice two\n' > "${TWO_B}/LICENSE"
closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}"),\"MIT twice\":[{\"name\":\"twice\",\"versions\":[\"1.0.0\",\"2.0.0\"],\"paths\":[\"${TWO_A}\",\"${TWO_B}\"],\"license\":\"MIT\"}]}"
generate
assert_exit 'generates with one package at two versions' 0
if entry_block twice 1.0.0 | grep -qF 'the licence of twice one' && ! entry_block twice 1.0.0 | grep -qF 'twice two'; then
  ok 'notices version 1 with the text from version 1'"'"'s own directory'
else
  bad 'notices version 1 with the text from version 1'"'"'s own directory' "$(entry_block twice 1.0.0)"
fi
if entry_block twice 2.0.0 | grep -qF 'the licence of twice two' && ! entry_block twice 2.0.0 | grep -qF 'twice one'; then
  ok 'and version 2 with the text from version 2'"'"'s'
else
  bad 'and version 2 with the text from version 2'"'"'s' "$(entry_block twice 2.0.0)"
fi

# --- Fails closed: no licence file ---------------------------------------------

new_fixture
BARE="$(package no-licence-here 2.0.0)"
closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}"),$(entry MIT no-licence-here 2.0.0 "${BARE}")}"
generate
assert_exit 'a package with no licence file fails the generator' 1
assert_says 'naming the package and its version' 'NOT003 no-licence-here@2.0.0 ships no LICENSE'
if [ -f "${tmp}/${DOCUMENT}" ]; then bad 'and writes no document at all' "$(head -5 "${tmp}/${DOCUMENT}")"; else ok 'and writes no document at all'; fi

# A reviewed entry for the SAME name at another version does not excuse it.
inputs '{"noLicenceFile":{"no-licence-here@1.0.0":{"why":"x","upstream":{"url":"u","read":"r","text":"t"}}},"copiedIntoBuild":[]}'
generate
assert_exit 'a reviewed entry for another version does not excuse it' 1
assert_says 'and says a new version is read again' 'There is one for no-licence-here@1.0.0'

# An excerpt read from a file the package does ship makes it pass.
printf '# no-licence-here\n\n## Licence\n\nCopyright 2026 Someone. MIT.\n' > "${BARE}/README.md"
inputs '{"noLicenceFile":{"no-licence-here@2.0.0":{"why":"x","excerpt":{"file":"README.md","from":"## Licence"}}},"copiedIntoBuild":[]}'
generate
assert_exit 'a reviewed excerpt from inside the package lets it through' 0
assert_document_has 'with the excerpt, from its marker to the end' 'Copyright 2026 Someone. MIT.'
assert_document_lacks 'and nothing above the marker' '# no-licence-here'

# ... and a marker that is not there fails rather than noticing nothing.
inputs '{"noLicenceFile":{"no-licence-here@2.0.0":{"why":"x","excerpt":{"file":"README.md","from":"## License"}}},"copiedIntoBuild":[]}'
generate
assert_exit 'an excerpt whose marker is gone fails' 1
assert_says 'naming the marker' 'NOT004 no-licence-here@2.0.0: the reviewed excerpt of README.md'

# The canonical text a reviewed entry asks for is appended once.
inputs '{"noLicenceFile":{"no-licence-here@2.0.0":{"why":"x","excerpt":{"file":"README.md","from":"## Licence"},"licenceText":"Apache-2.0"}},"copiedIntoBuild":[]}'
generate
assert_document_has 'appends the canonical text a reviewed entry names' 'Appendix: Apache-2.0'
if [ "$(grep -c '^Appendix: Apache-2.0$' "${tmp}/${DOCUMENT}")" = 1 ]; then ok 'once, however many entries ask for it'; else bad 'once, however many entries ask for it'; fi

# --- Stale reviewed entries ------------------------------------------------------

new_fixture
inputs '{"noLicenceFile":{"gone@1.0.0":{"why":"x","upstream":{"url":"u","read":"r","text":"t"}}},"copiedIntoBuild":[]}'
generate
assert_exit 'a reviewed entry for a package not in the closure fails' 1
assert_says 'naming it' 'NOT004 gone@1.0.0 has a reviewed entry'

new_fixture
inputs '{"noLicenceFile":{"react@19.0.0":{"why":"x","upstream":{"url":"u","read":"r","text":"t"}}},"copiedIntoBuild":[]}'
generate
assert_exit 'a reviewed entry for a package that now ships its own licence fails' 1
assert_says 'naming the file it ships' 'NOT004 react@19.0.0 ships its own licence file now (LICENSE)'

# --- Drift: the gate this suite is mostly for -------------------------------------

new_fixture
generate
NEW="$(package brand-new 0.1.0)"
printf 'MIT License, brand new\n' > "${NEW}/LICENSE"
closure @onyourleft/web "{$(entry MIT react 19.0.0 "${REACT}"),$(entry MIT brand-new 0.1.0 "${NEW}")}"
run --assume-installed
assert_exit 'a dependency added without regenerating is drift' 1
assert_says 'naming it as not noticed yet' 'not noticed yet: brand-new@0.1.0'
assert_says 'and saying how to repair it' 'pnpm run notices:generate'
assert_says 'reported against the contents file as well' "NOT006 ${CONTENTS}"

new_fixture
generate
closure @onyourleft/store '{}'
run --assume-installed
assert_exit 'a dependency that stopped shipping is drift too' 1
assert_says 'naming it as no longer shipped' 'noticed and no longer shipped: dexie@4.4.6'

new_fixture
generate
printf 'Apache License\nVersion 2.0 (the dexie copy, amended)\n' > "${DEXIE}/LICENSE"
run --assume-installed
assert_exit 'a licence text that changed under the same version is drift' 1
assert_says 'naming the line' 'the dexie copy, amended'

new_fixture
generate
printf 'hand-edited\n' >> "${tmp}/${DOCUMENT}"
run --assume-installed
assert_exit 'a hand edit to the document is drift' 1

new_fixture
generate
rm "${tmp}/${DOCUMENT}"
run --assume-installed
assert_exit 'a missing document fails' 1
assert_says 'as NOT007' "NOT007 ${DOCUMENT} is not there"

# --- A gate over nothing is not a pass (#142) --------------------------------------

new_fixture
closure @onyourleft/web '{}'
closure @onyourleft/store '{}'
# ⚠️ No Android project here, so NOTHING but the empty closure is wrong with
# this tree: the fixture's :bridge project names react, which an empty closure
# lacks, and its NOT005 used to hold the exit code at 1 with the NOT002 check
# deleted. Without the check this tree now generates cleanly, and the exit
# assertion goes red on its own.
sed -i.bak 's/"projects": \[.*\]/"projects": []/' "${tmp}/apps/mobile/native-closure.json"
generate
assert_exit 'an empty closure fails' 1
assert_says 'as NOT002' 'NOT002 the distributed closure of every workspace package is empty'
assert_silent 'and for that reason alone' 'NOT005'

new_fixture
generate
closure @onyourleft/web '{}'
closure @onyourleft/store '{}'
run --assume-installed
assert_exit 'and fails the check too, even against a document that exists' 1
assert_silent 'rather than reporting drift, which would read like a stale file' 'NOT006'

new_fixture
printf '[{"name":"root","path":"%s"}]\n' "${tmp}" > "${tmp}/fake/workspace.json"
generate
assert_exit 'no workspace package discovered fails' 1
assert_says 'saying so rather than writing an empty document' 'NOT002'

# --- The install comes first (#298) --------------------------------------------------

new_fixture
generate
run
assert_exit 'without --assume-installed it installs first, then checks' 0
if [ -f "${tmp}/fake/installed" ]; then ok 'and the install really ran'; else bad 'and the install really ran'; fi

new_fixture
generate
touch "${tmp}/fake/install-fails"
run
assert_exit 'an install that fails is its own failure' 1
assert_says 'as NOT001, carrying pnpm'\''s own error code' 'NOT001 pnpm install --frozen-lockfile'
assert_says 'with the code' 'ERR_PNPM_OUTDATED_LOCKFILE'

# --- The native half and the copied files --------------------------------------------

new_fixture
generate
assert_document_has 'notices a reviewed native library' 'Name: org.example:native-lib'
assert_document_has 'with its NOTICE, verbatim' 'Copyright 2026 Example'
assert_document_has 'and the canonical licence text, once, at the end' 'Appendix: Apache-2.0'
assert_document_has 'and says what the reviewed project is built from' ':bridge — built from react, noticed in part 1'

new_fixture
sed -i.bak 's/"licence": "Apache-2.0"/"licence": "EPL-2.0"/' "${tmp}/apps/mobile/native-closure.json"
generate
assert_exit 'a native licence this generator holds no text for fails' 1
assert_says 'as NOT005' 'NOT005 org.example:native-lib:2.1.0 is EPL-2.0'

new_fixture
sed -i.bak 's/"package": "react"/"package": "not-in-the-closure"/' "${tmp}/apps/mobile/native-closure.json"
generate
assert_exit 'a native project said to be a package that does not ship fails' 1
assert_says 'naming the project' 'NOT005 the Android project :bridge'

new_fixture
mkdir -p "${REACT}/wasm"
printf 'wasm' > "${REACT}/wasm/runtime.wasm"
inputs '{"noLicenceFile":{},"copiedIntoBuild":[{"path":"pose/runtime.wasm","package":"react","file":"wasm/runtime.wasm","by":"a plugin"}]}'
generate
assert_document_has 'names a file copied into the build, and its package' 'pose/runtime.wasm — from react 19.0.0 (a plugin)'
rm "${REACT}/wasm/runtime.wasm"
generate
assert_exit 'a copied file its package no longer has fails' 1
assert_says 'as NOT005' 'NOT005 pose/runtime.wasm is copied out of react@19.0.0/wasm/runtime.wasm'

# --- Code the bundler writes into the build (#676's review) ------------------------
#
# vite and rolldown are in no closure -- vite is a devDependency -- and their
# own code is in every build. So an entry for each, at its installed version,
# is REQUIRED rather than merely rendered.

new_fixture
generate
assert_document_has 'notices the bundler, which no closure lists' 'Name: vite'
assert_document_has 'as the bundler'\''s part' 'Part: bundler'
assert_document_has 'with the part of its licence file that covers the code that ships' 'Vite fixture core licence'
assert_document_lacks 'and not the part that covers code which does not' 'bundled into the dev server only'
assert_document_has 'and rolldown, reached through vite as pnpm lays it out' 'Rolldown fixture licence'
if grep -qF 'Part 4 — code the build tools write into the app' "${tmp}/${CONTENTS}" \
  && grep -qF '  vite 8.3.0 — MIT: its preload helper' "${tmp}/${CONTENTS}"; then
  ok 'and lists them in the contents'
else
  bad 'and lists them in the contents' "$(cat "${tmp}/${CONTENTS}")"
fi

new_fixture
inputs "{\"noLicenceFile\":{},\"copiedIntoBuild\":[],\"writtenByTheBundler\":$(node -e 'const j = JSON.parse(process.argv[1]); delete j["vite@8.3.0"]; process.stdout.write(JSON.stringify(j));' "${BUNDLER_ENTRIES}")}"
generate
assert_exit 'the bundler with no reviewed entry fails' 1
assert_says 'as NOT008, naming it and its installed version' 'NOT008 the build writes vite@8.3.0'

new_fixture
inputs "{\"noLicenceFile\":{},\"copiedIntoBuild\":[],\"writtenByTheBundler\":$(node -e 'const j = JSON.parse(process.argv[1]); delete j["rolldown@1.2.6"]; process.stdout.write(JSON.stringify(j));' "${BUNDLER_ENTRIES}")}"
generate
assert_exit 'the bundler'\''s own bundler with no reviewed entry fails too' 1
assert_says 'as NOT008' 'NOT008 the build writes rolldown@1.2.6'

new_fixture
printf '{"name":"vite","version":"8.4.0","license":"MIT"}\n' > "${VITE}/package.json"
generate
assert_exit 'a bundler bump fails closed' 1
assert_says 'saying the new version is read again' 'There is one for vite@8.3.0; a new version is read again'
assert_says 'and the old entry is stale' 'NOT004 vite@8.3.0 has a `writtenByTheBundler` entry'

new_fixture
printf 'no marker here\n' > "${VITE}/LICENSE.md"
generate
assert_exit 'a bundler licence file without its reviewed marker fails' 1
assert_says 'as NOT004' 'NOT004 vite@8.3.0: LICENSE.md, from `# Vite core license`,'

new_fixture
rm "${tmp}/apps/web/node_modules/vite"
generate
assert_exit 'a bundler that cannot be resolved fails rather than noticing nothing' 1
assert_says 'as NOT008' 'NOT008 vite could not be resolved'

# --- Deterministic --------------------------------------------------------------------

new_fixture
generate
first="$(cat "${tmp}/${DOCUMENT}")"
generate
if [ "${first}" = "$(cat "${tmp}/${DOCUMENT}")" ]; then ok 'writes the same bytes twice'; else bad 'writes the same bytes twice'; fi

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
