#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds this project's basemap archive (#1557): the Protomaps v4 basemap from
# OpenStreetMap, by Planetiler, with upstream's profile at a pinned commit and
# this project's z15-only building fields added by `profile/`. README.md beside
# this file says what each pin is, its licence, and the build's time and size.
#
#   build.sh --region north-america/us/delaware            # a small region
#   build.sh --region north-america/us --xmx 24g           # the US
#   build.sh --region north-america/us/delaware --compare  # and upstream's, unmodified
#
# Everything it downloads or writes goes under --work (default
# ~/.cache/onyourleft/basemap), never into the repository: the OSM extract for
# the US is ~11 GB and the upstream clone carries its own *.test.ts files,
# which this repository's Vitest would otherwise collect.
#
# It uploads nothing. Publishing an archive is a separate, owner-approved step
# (#1557's ruling of 2026-10-31).
set -euo pipefail

# --- Pins -------------------------------------------------------------------
# protomaps/basemaps (BSD-3-Clause code, CC0 visual design): tiles 4.15.2.
UPSTREAM_REPO="https://github.com/protomaps/basemaps.git"
UPSTREAM_SHA="42ffaaa4a85a41bfcb23e43cc0f5b492a5eca123"
# Apache Maven (Apache-2.0), only to compile the profile. The SHA-512 is the one
# Apache publishes beside the tarball.
MAVEN_VERSION="3.9.16"
MAVEN_SHA512="831a8591fe20c8243b1dbe7d71e3244f31d1665b0804b2e825e38cbbe5ce0cafb8338851f90780735568773e0a6cd07bbec107cda0b896b008b861075358b6f6"
MAVEN_URL="https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/apache-maven-${MAVEN_VERSION}-bin.tar.gz"
# Planetiler itself (Apache-2.0) is pinned by upstream's pom.xml: 0.10.2.
GEOFABRIK="https://download.geofabrik.de"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${HOME}/.cache/onyourleft/basemap"
REGION=""
OUTPUT=""
XMX="8g"
COMPARE=0
BUILD_YEAR=""

usage() {
  sed -n '3,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  echo "Options: --region <geofabrik path> --output <file.pmtiles> --work <dir> --xmx <heap> --build-year <yyyy> --compare"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --region) REGION="${2:?--region needs a value}"; shift 2 ;;
    --output) OUTPUT="${2:?--output needs a value}"; shift 2 ;;
    --work) WORK="${2:?--work needs a value}"; shift 2 ;;
    --xmx) XMX="${2:?--xmx needs a value}"; shift 2 ;;
    --build-year) BUILD_YEAR="${2:?--build-year needs a value}"; shift 2 ;;
    --compare) COMPARE=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "build.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "${REGION}" ]; then
  echo "build.sh: --region is required, a Geofabrik path such as north-america/us/delaware" >&2
  exit 2
fi
case "${REGION}" in
  *[!a-z0-9/-]* | /* | */ | *..*)
    echo "build.sh: --region must be a Geofabrik path of lower-case letters, digits, '-' and '/'" >&2
    exit 2 ;;
esac
AREA="${REGION##*/}"
# Every path below is ${WORK}/…, and the build runs `cd` into ${WORK} and into
# the upstream clone, so a relative --work is made absolute here.
case "${WORK}" in /*) ;; *) WORK="${PWD}/${WORK}" ;; esac
OUTPUT="${OUTPUT:-${WORK}/out/${AREA}.pmtiles}"
# Planetiler runs from ${WORK}, so a relative path is made absolute here.
case "${OUTPUT}" in /*) ;; *) OUTPUT="${PWD}/${OUTPUT}" ;; esac
case "${OUTPUT}" in *.pmtiles) ;; *) echo "build.sh: --output must end in .pmtiles" >&2; exit 2 ;; esac
# The latest start year written (BuildingTags.BUILD_YEAR). Defaults to this
# year; give the same value again to rebuild the same extract byte for byte.
BUILD_YEAR="${BUILD_YEAR:-$(date -u +%Y)}"
case "${BUILD_YEAR}" in
  [12][0-9][0-9][0-9]) ;;
  *) echo "build.sh: --build-year must be a four-digit year" >&2; exit 2 ;;
esac

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
bytes() { wc -c <"$1" | tr -d ' '; }

# --- Java 21 ----------------------------------------------------------------
# A JDK before 9 reports `1.8`: its major is the part before the first dot,
# and anything not all digits counts as none, so `1.8` is refused as 1.
JAVA_SPEC="$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java.specification.version = //p' || true)"
JAVA_MAJOR="${JAVA_SPEC%%.*}"
case "${JAVA_MAJOR}" in '' | *[!0-9]*) JAVA_MAJOR=0 ;; esac
if [ "${JAVA_MAJOR}" -lt 21 ]; then
  echo "build.sh: Planetiler needs Java 21 or later; found '${JAVA_SPEC:-none}'" >&2
  exit 1
fi

mkdir -p "${WORK}/tools" "${WORK}/data/sources" "${WORK}/jars" "$(dirname "${OUTPUT}")"

# --- Maven, pinned and verified ----------------------------------------------
MVN="${WORK}/tools/apache-maven-${MAVEN_VERSION}/bin/mvn"
if [ ! -x "${MVN}" ]; then
  tarball="${WORK}/tools/apache-maven-${MAVEN_VERSION}-bin.tar.gz"
  curl -sSfL -o "${tarball}" "${MAVEN_URL}"
  echo "${MAVEN_SHA512}  ${tarball}" | shasum -a 512 -c - >/dev/null
  tar -xzf "${tarball}" -C "${WORK}/tools"
fi

# --- The profile: upstream at the pin, then this project's fields -----------
# Built twice from one clone: first unmodified (the `--compare` baseline, and
# proof the pin's own suite passes), then with profile/ added. `mvn package`
# runs each suite, so a red BuildingTagsTest stops the build before any tile.
CLONE="${WORK}/upstream"
if [ ! -d "${CLONE}/.git" ]; then
  git clone --quiet "${UPSTREAM_REPO}" "${CLONE}"
fi
git -C "${CLONE}" fetch --quiet origin "${UPSTREAM_SHA}" 2>/dev/null || true
git -C "${CLONE}" checkout --quiet --force "${UPSTREAM_SHA}"
git -C "${CLONE}" clean -fdxq
if [ "$(git -C "${CLONE}" rev-parse HEAD)" != "${UPSTREAM_SHA}" ]; then
  echo "build.sh: the upstream clone is not at ${UPSTREAM_SHA}" >&2
  exit 1
fi

TILES="${CLONE}/tiles"
JAR="target/protomaps-basemap-HEAD-with-deps.jar"
(cd "${TILES}" && "${MVN}" -B -q package) || exit 1
cp "${TILES}/${JAR}" "${WORK}/jars/upstream.jar"

git -C "${CLONE}" apply "${HERE}/profile/protomaps-basemaps.patch"
cp -R "${HERE}/profile/src/." "${TILES}/src/"
(cd "${TILES}" && "${MVN}" -B -q package) || exit 1
cp "${TILES}/${JAR}" "${WORK}/jars/onyourleft.jar"

# --- The OSM extract --------------------------------------------------------
# The newest DATED extract (`<area>-YYMMDD.osm.pbf`, listed on the region's
# page) is fetched, not `-latest`: `-latest` is replaced daily, and a US
# download takes long enough for the file to change under it, so its MD5 no
# longer matched (#1557, 2026-10-31). Geofabrik publishes an MD5 beside each
# extract; it is checked, and the record carries the file's name, URL, MD5 and
# SHA-256.
#
# The cache is keyed by the WHOLE region and the dated name,
# data/extracts/<region>/<area>-YYMMDD.osm.pbf, so europe/georgia and
# north-america/us/georgia never share a file, and a newer dated extract is
# fetched rather than last quarter's reused. Planetiler is pointed at it with
# --osm_path. An extract an earlier build.sh left at data/sources/<area>.osm.pbf
# is used, by a hard link, only when its MD5 is the dated file's; it is never
# moved or deleted.
md5of() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
PAGE="${GEOFABRIK}/${REGION}.html"
LISTING="$(curl -sSfL "${PAGE}")" || { echo "build.sh: could not read ${PAGE}" >&2; exit 1; }
DATED="$(printf '%s\n' "${LISTING}" | { grep -oE "${AREA}-[0-9]{6}\.osm\.pbf" || true; } | sort -u | tail -1)"
if [ -n "${DATED}" ]; then
  NAME="${DATED}"
else
  NAME="${AREA}-latest.osm.pbf"
  echo "build.sh: ${PAGE} lists no dated extract; fetching ${NAME} instead, which Geofabrik replaces daily, so a long download can fail its MD5 check" >&2
fi
SOURCE="${GEOFABRIK}/$(dirname "${REGION}")/${NAME}"
EXTRACTS="${WORK}/data/extracts/${REGION}"
PBF="${EXTRACTS}/${NAME}"
LEGACY="${WORK}/data/sources/${AREA}.osm.pbf"
mkdir -p "${EXTRACTS}"
want="$(curl -sSfL "${SOURCE}.md5" | cut -d' ' -f1)" || { echo "build.sh: could not read ${SOURCE}.md5" >&2; exit 1; }
case "${want}" in
  *[!0-9a-f]* | '') echo "build.sh: ${SOURCE}.md5 is not an MD5" >&2; exit 1 ;;
esac
if [ -n "${DATED}" ] && [ -f "${PBF}" ] && [ "$(cat "${PBF}.md5" 2>/dev/null || true)" = "${want}" ]; then
  echo "build.sh: using the cached ${NAME}" >&2
elif [ -n "${DATED}" ] && [ -f "${LEGACY}" ] && [ "$(md5of "${LEGACY}")" = "${want}" ]; then
  echo "build.sh: data/sources/${AREA}.osm.pbf is ${NAME} (its MD5 matches); linking it, not downloading" >&2
  rm -f "${PBF}"
  ln "${LEGACY}" "${PBF}"
  echo "${want}" >"${PBF}.md5"
else
  echo "build.sh: fetching ${SOURCE}" >&2
  curl -sSfL -o "${PBF}.part" "${SOURCE}"
  got="$(md5of "${PBF}.part")"
  if [ "${want}" != "${got}" ]; then
    echo "build.sh: ${NAME} failed its MD5 check" >&2
    rm -f "${PBF}.part"
    exit 1
  fi
  mv "${PBF}.part" "${PBF}"
  echo "${want}" >"${PBF}.md5"
fi

# --- The region's outline ---------------------------------------------------
# Geofabrik's .poly beside the extract (north-america/us.poly), handed to
# Planetiler as --polygon so the output is clipped to the extract. Without it
# Planetiler fills the bounding box with land and ocean polygons: the first US
# build (2026-10-31) addressed 368 848 915 tiles against 21 635 078 and answered
# a tile in London, Toronto or Mexico City with bare land and no roads (#1557's
# review). Fetched every build, because the outline changes with the extract.
POLY_URL="${GEOFABRIK}/${REGION}.poly"
POLY="${EXTRACTS}/${AREA}.poly"
curl -sSfL -o "${POLY}.part" "${POLY_URL}" || { echo "build.sh: could not read ${POLY_URL}" >&2; rm -f "${POLY}.part"; exit 1; }
mv "${POLY}.part" "${POLY}"

# --- Tiles ------------------------------------------------------------------
# Upstream's run(): every other source (Natural Earth, the OSM water and land
# polygons, Daylight landcover, QRank, the pgf encoding) is downloaded into
# data/sources by --download when it is missing, and reused when present.
run_profile() {
  local jar="$1" output="$2"
  (cd "${WORK}" && java "-Xmx${XMX}" "-Doyl.build_year=${BUILD_YEAR}" -jar "${jar}" \
    --area="${AREA}" --osm_path="${PBF}" --polygon="${POLY}" --download --force --output="${output}" \
    --nodemap-type=sparsearray --nodemap-storage=mmap)
}

started="$(date +%s)"
run_profile "${WORK}/jars/onyourleft.jar" "${OUTPUT}"
elapsed=$(( $(date +%s) - started ))

if [ "${COMPARE}" -eq 1 ]; then
  run_profile "${WORK}/jars/upstream.jar" "${OUTPUT%.pmtiles}.upstream.pmtiles"
fi

# --- The build record -------------------------------------------------------
# Every input's digest, so the same inputs and these pins rebuild these bytes.
RECORD="${OUTPUT%.pmtiles}.build.txt"
{
  echo "region ${REGION}"
  echo "build_year ${BUILD_YEAR}"
  echo "upstream ${UPSTREAM_REPO} ${UPSTREAM_SHA}"
  echo "maven ${MAVEN_VERSION}"
  echo "java $(java -version 2>&1 | head -1)"
  echo "patch $(sha256 "${HERE}/profile/protomaps-basemaps.patch")"
  echo "jar $(sha256 "${WORK}/jars/onyourleft.jar")"
  echo "extract ${NAME} ${SOURCE} md5 ${want} $(bytes "${PBF}") $(sha256 "${PBF}")"
  echo "polygon ${POLY_URL} $(bytes "${POLY}") $(sha256 "${POLY}")"
  # Every shared source. An extract in data/sources is not this build's input:
  # the extract is the line above.
  for source in "${WORK}"/data/sources/*; do
    case "${source}" in *.osm.pbf) continue ;; esac
    if [ -f "${source}" ]; then echo "input $(basename "${source}") $(bytes "${source}") $(sha256 "${source}")"; fi
  done
  echo "output $(basename "${OUTPUT}") $(bytes "${OUTPUT}") $(sha256 "${OUTPUT}")"
  echo "seconds ${elapsed}"
} >"${RECORD}"
cat "${RECORD}"
