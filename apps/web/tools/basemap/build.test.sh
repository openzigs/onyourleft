#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for build.sh beside this file -- #1557.
#
# Each case runs the real build.sh with a throwaway --work and fake `curl`,
# `git` and `java` first on PATH, and a fake `mvn` where build.sh looks for its
# pinned Maven, the way scripts/mirror-base-image.test.sh fakes `skopeo`. The
# script has no test-only seam. The fake curl serves files from
# ${tmp}/web/<url without its scheme>, so a case says what Geofabrik lists, and
# every fake appends its call to ${tmp}/calls, so a case can say what the
# script ASKED for as well as what it concluded. Nothing reaches the network,
# and no tile is built: the fake java writes a stand-in output file.
#
# Run: bash apps/web/tools/basemap/build.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="${HERE}/build.sh"
UPSTREAM_SHA="$(sed -n 's/^UPSTREAM_SHA="\(.*\)"$/\1/p' "${BUILD}")"
MAVEN_VERSION="$(sed -n 's/^MAVEN_VERSION="\(.*\)"$/\1/p' "${BUILD}")"
GEOFABRIK="download.geofabrik.de"

pass=0
fail=0
tmp=""
out=""
code=0

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() {
  fail=$((fail + 1))
  printf 'FAIL %s\n' "$1"
  printf '%s\n' "${out}" | sed 's/^/     | /'
}

md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }

new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/bin" "${tmp}/web" "${tmp}/work/tools/apache-maven-${MAVEN_VERSION}/bin"
  : >"${tmp}/calls"
  printf '21\n' >"${tmp}/java-spec"

  cat >"${tmp}/bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"${OYL_FAKE_DIR}/calls"
output=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
file="${OYL_FAKE_DIR}/web/${url#*://}"
[ -f "${file}" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
if [ -n "${output}" ]; then cp "${file}" "${output}"; else cat "${file}"; fi
FAKE

  cat >"${tmp}/bin/git" <<FAKE
#!/usr/bin/env bash
printf 'git %s\n' "\$*" >>"\${OYL_FAKE_DIR}/calls"
if [ "\$1" = "-C" ]; then shift 2; fi
case "\$1" in
  clone) mkdir -p "\${@: -1}/.git" "\${@: -1}/tiles/src" ;;
  rev-parse) echo "${UPSTREAM_SHA}" ;;
esac
exit 0
FAKE

  cat >"${tmp}/work/tools/apache-maven-${MAVEN_VERSION}/bin/mvn" <<'FAKE'
#!/usr/bin/env bash
printf 'mvn %s\n' "$*" >>"${OYL_FAKE_DIR}/calls"
mkdir -p target && printf 'jar\n' >target/protomaps-basemap-HEAD-with-deps.jar
FAKE

  cat >"${tmp}/bin/java" <<'FAKE'
#!/usr/bin/env bash
case "$*" in
  -XshowSettings:properties*)
    printf '    java.specification.version = %s\n' "$(cat "${OYL_FAKE_DIR}/java-spec")" >&2 ;;
  -version) echo 'openjdk version "fake"' >&2 ;;
  *)
    printf 'java %s\n' "$*" >>"${OYL_FAKE_DIR}/calls"
    for arg in "$@"; do
      case "${arg}" in --output=*) printf 'tiles\n' >"${arg#--output=}" ;; esac
    done ;;
esac
FAKE
  chmod +x "${tmp}/bin/"* "${tmp}/work/tools/apache-maven-${MAVEN_VERSION}/bin/mvn"
}

# list REGION NAME...: the region's Geofabrik page lists these extract names.
list() {
  local region="$1"
  shift
  mkdir -p "$(dirname "${tmp}/web/${GEOFABRIK}/${region}")"
  {
    echo '<html><body>'
    for name in "$@"; do printf '<a href="%s">%s</a>\n' "${name}" "${name}"; done
    echo '</body></html>'
  } >"${tmp}/web/${GEOFABRIK}/${region}.html"
}

# publish PARENT NAME CONTENT: Geofabrik serves this extract and its MD5.
publish() {
  local file="${tmp}/web/${GEOFABRIK}/$1/$2"
  mkdir -p "$(dirname "${file}")"
  printf '%s\n' "$3" >"${file}"
  printf '%s  %s\n' "$(md5of "${file}")" "$2" >"${file}.md5"
}

run_build() {
  out="$(cd "${tmp}" && OYL_FAKE_DIR="${tmp}" PATH="${tmp}/bin:${PATH}" \
    bash "${BUILD}" --work "${tmp}/work" --build-year 2026 "$@" 2>&1)"
  code=$?
}

record() { cat "${tmp}/work/out/$1.build.txt" 2>/dev/null; }

check() {
  local name="$1"
  shift
  if "$@"; then ok "${name}"; else bad "${name}"; fi
}

has() { grep -qF -- "$2" <<<"$1"; }
lacks() { ! grep -qF -- "$2" <<<"$1"; }

# --- A dated extract --------------------------------------------------------
new_fixture
list north-america/us us-261029.osm.pbf us-261030.osm.pbf us-latest.osm.pbf
publish north-america us-261030.osm.pbf 'extract of 2026-10-30'
publish north-america us-261029.osm.pbf 'extract of 2026-10-29'
run_build --region north-america/us
dated="${tmp}/work/data/extracts/north-america/us/us-261030.osm.pbf"
url="https://${GEOFABRIK}/north-america/us-261030.osm.pbf"
check 'a dated extract: the build succeeds' test "${code}" -eq 0
check 'a dated extract: the newest dated file is fetched, not -latest' has "$(cat "${tmp}/calls")" "-o ${dated}.part ${url}"
check 'a dated extract: it is cached under the region and its dated name' test -f "${dated}"
check 'a dated extract: Planetiler reads that file' has "$(cat "${tmp}/calls")" "--osm_path=${dated}"
check 'a dated extract: the record names the file, its URL and its MD5' \
  has "$(record us)" "extract us-261030.osm.pbf ${url} md5 $(md5of "${dated}") "

# --- Reusing it, and a newer one --------------------------------------------
: >"${tmp}/calls"
run_build --region north-america/us
check 'the same dated extract again: it is reused' test "${code}" -eq 0
check 'the same dated extract again: it is not downloaded' lacks "$(cat "${tmp}/calls")" "-o ${dated}.part"

: >"${tmp}/calls"
list north-america/us us-261030.osm.pbf us-261031.osm.pbf us-latest.osm.pbf
publish north-america us-261031.osm.pbf 'extract of 2026-10-31'
run_build --region north-america/us
newer="${tmp}/work/data/extracts/north-america/us/us-261031.osm.pbf"
check 'a newer dated extract: it is fetched, not the cached older one' test -f "${newer}"
check 'a newer dated extract: Planetiler reads it' has "$(cat "${tmp}/calls")" "--osm_path=${newer}"
check 'a newer dated extract: the record names it' has "$(record us)" 'extract us-261031.osm.pbf '

# --- No dated extract: the -latest fallback ---------------------------------
new_fixture
list north-america/us/delaware delaware-latest.osm.pbf
publish north-america/us delaware-latest.osm.pbf 'latest delaware'
run_build --region north-america/us/delaware
check 'no dated extract: the build falls back rather than exiting' test "${code}" -eq 0
check 'no dated extract: it says which file it fetches instead' has "${out}" 'lists no dated extract; fetching delaware-latest.osm.pbf'
check 'no dated extract: the record names -latest' has "$(record delaware)" 'extract delaware-latest.osm.pbf '

# --- Two regions with one area name -----------------------------------------
new_fixture
list europe/georgia georgia-261030.osm.pbf
publish europe georgia-261030.osm.pbf 'the country'
list north-america/us/georgia georgia-261030.osm.pbf
publish north-america/us georgia-261030.osm.pbf 'the state'
run_build --region europe/georgia --output "${tmp}/work/out/eu.pmtiles"
run_build --region north-america/us/georgia --output "${tmp}/work/out/us.pmtiles"
eu="${tmp}/work/data/extracts/europe/georgia/georgia-261030.osm.pbf"
us="${tmp}/work/data/extracts/north-america/us/georgia/georgia-261030.osm.pbf"
check 'one area name, two regions: each has its own cached file' \
  test "$(cat "${eu}" 2>/dev/null)" = 'the country' -a "$(cat "${us}" 2>/dev/null)" = 'the state'
check 'one area name, two regions: the second build reads its own' has "$(record us)" "md5 $(md5of "${us}") "

# --- An extract an earlier build.sh left in data/sources ---------------------
new_fixture
list north-america/us us-261030.osm.pbf
publish north-america us-261030.osm.pbf 'extract of 2026-10-30'
mkdir -p "${tmp}/work/data/sources"
cp "${tmp}/web/${GEOFABRIK}/north-america/us-261030.osm.pbf" "${tmp}/work/data/sources/us.osm.pbf"
run_build --region north-america/us
dated="${tmp}/work/data/extracts/north-america/us/us-261030.osm.pbf"
check 'an earlier extract with the dated MD5: the build succeeds' test "${code}" -eq 0
check 'an earlier extract with the dated MD5: it is not downloaded again' lacks "$(cat "${tmp}/calls")" "-o ${dated}.part"
check 'an earlier extract with the dated MD5: it stays where it was' test -f "${tmp}/work/data/sources/us.osm.pbf"
check 'an earlier extract with the dated MD5: it is linked as the dated file' test "${dated}" -ef "${tmp}/work/data/sources/us.osm.pbf"

new_fixture
list north-america/us us-261030.osm.pbf
publish north-america us-261030.osm.pbf 'extract of 2026-10-30'
mkdir -p "${tmp}/work/data/sources"
printf 'last quarter\n' >"${tmp}/work/data/sources/us.osm.pbf"
run_build --region north-america/us
dated="${tmp}/work/data/extracts/north-america/us/us-261030.osm.pbf"
check 'an earlier extract of another date: the dated one is downloaded' has "$(cat "${tmp}/calls")" "-o ${dated}.part"
check 'an earlier extract of another date: it is left as it was' test "$(cat "${tmp}/work/data/sources/us.osm.pbf")" = 'last quarter'

# --- An MD5 mismatch --------------------------------------------------------
new_fixture
list north-america/us us-261030.osm.pbf
publish north-america us-261030.osm.pbf 'extract of 2026-10-30'
printf '00000000000000000000000000000000  us-261030.osm.pbf\n' \
  >"${tmp}/web/${GEOFABRIK}/north-america/us-261030.osm.pbf.md5"
run_build --region north-america/us
check 'an MD5 mismatch: the build fails' test "${code}" -eq 1
check 'an MD5 mismatch: it says so' has "${out}" 'us-261030.osm.pbf failed its MD5 check'
check 'an MD5 mismatch: nothing is cached' test ! -e "${tmp}/work/data/extracts/north-america/us/us-261030.osm.pbf"

# --- A relative --work ------------------------------------------------------
new_fixture
list north-america/us/delaware delaware-261030.osm.pbf
publish north-america/us delaware-261030.osm.pbf 'delaware'
mkdir -p "${tmp}/rel/tools"
mv "${tmp}/work/tools/apache-maven-${MAVEN_VERSION}" "${tmp}/rel/tools/"
out="$(cd "${tmp}" && OYL_FAKE_DIR="${tmp}" PATH="${tmp}/bin:${PATH}" \
  bash "${BUILD}" --work rel --build-year 2026 --region north-america/us/delaware 2>&1)"
code=$?
check 'a relative --work: the build succeeds' test "${code}" -eq 0
check 'a relative --work: Planetiler is given an absolute path' \
  has "$(cat "${tmp}/calls")" "-jar ${tmp}/rel/jars/onyourleft.jar"
check 'a relative --work: the archive is written under it' test -f "${tmp}/rel/out/delaware.pmtiles"

# --- The Java version -------------------------------------------------------
for spec in 1.8 17 none; do
  new_fixture
  if [ "${spec}" = none ]; then printf '\n' >"${tmp}/java-spec"; else printf '%s\n' "${spec}" >"${tmp}/java-spec"; fi
  run_build --region north-america/us/delaware
  check "Java ${spec}: refused" test "${code}" -eq 1
  check "Java ${spec}: it says Java 21 is needed" has "${out}" 'Planetiler needs Java 21 or later'
  check "Java ${spec}: nothing is cloned, built or downloaded" test ! -s "${tmp}/calls"
done
new_fixture
list north-america/us/delaware delaware-261030.osm.pbf
publish north-america/us delaware-261030.osm.pbf 'delaware'
printf '25\n' >"${tmp}/java-spec"
run_build --region north-america/us/delaware
check 'Java 25: accepted' test "${code}" -eq 0

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
