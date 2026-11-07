#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for upload.sh beside this file -- #2320.
#
# Each case runs the real upload.sh over a real release (make-release.ts over
# graph-tar-testing.ts's three filler tiles) with a fake `aws` and a fake
# `curl` first on PATH. The fake aws keeps every object it is given in
# ${tmp}/bucket, with the Cache-Control and Content-Type it was given, and
# appends every call to ${tmp}/calls; the fake curl answers a public URL from
# that bucket the way R2 behind the CDN does (an MD5 ETag for a one-part PUT,
# single ranges, CORS for any origin), unless OYL_FAKE_BREAK names one thing
# to get wrong. No credential exists, and nothing reaches the network.
#
# Run: bash apps/web/tools/valhalla/upload.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "${HERE}/../.." && pwd)"
UPLOAD="${HERE}/upload.sh"
PUBLIC="https://tiles.example/routing"

pass=0
fail=0
tmp=""
out=""
code=0
rel=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() {
  fail=$((fail + 1))
  printf 'FAIL %s\n' "$1"
  printf '%s\n' "${out}" | sed 's/^/     | /'
}

new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/bin" "${tmp}/work" "${tmp}/bucket"
  : >"${tmp}/calls"
  (cd "${WEB}" && node --import ./tools/ts-extensionless-resolve.mjs tools/valhalla/graph-tar-testing.ts "${tmp}/work/graph.tar")
  printf '{"mjolnir":{},"loki":{}}' >"${tmp}/work/native-config.json"
  printf 'an extract\n' >"${tmp}/somewhere-261030.osm.pbf"
  (cd "${WEB}" && node --import ./tools/ts-extensionless-resolve.mjs tools/valhalla/make-release.ts \
    --work "${tmp}/work" --out "${tmp}/out" --pbf "${tmp}/somewhere-261030.osm.pbf" \
    --image test --valhalla-version 3.8.3 >/dev/null)
  rel="$(find "${tmp}/out" -mindepth 1 -maxdepth 1 -type d | head -1)"

  cat >"${tmp}/bin/aws" <<'FAKE'
#!/usr/bin/env bash
printf 'aws %s\n' "$*" >>"${OYL_FAKE_DIR}/calls"
op="$2"
key="" body="" cache=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) key="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    --cache-control) cache="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "${op}" in
  list-objects-v2) printf '%s\n' "${OYL_FAKE_KEYCOUNT:-0}" ;;
  head-object) [ -f "${OYL_FAKE_DIR}/bucket/${key}" ] || exit 254 ;;
  put-object)
    [ "${OYL_FAKE_PUT_FAIL:-}" = "${key##*/}" ] && exit 1
    mkdir -p "$(dirname "${OYL_FAKE_DIR}/bucket/${key}")"
    cp "${body}" "${OYL_FAKE_DIR}/bucket/${key}"
    if [ "${OYL_FAKE_BREAK:-}" = etag ] && [ "${key##*/}" = graph.tar ]; then
      # Other bytes of the same length: only the ETag can tell.
      printf 'X' | dd of="${OYL_FAKE_DIR}/bucket/${key}" bs=1 seek=600 conv=notrunc 2>/dev/null
    fi
    printf '%s\n' "${cache}" >"${OYL_FAKE_DIR}/bucket/${key}.cache"
    printf '{"ETag": "fake"}\n' ;;
esac
FAKE

  cat >"${tmp}/bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >>"${OYL_FAKE_DIR}/calls"
range="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -H) case "$2" in Range:*) range="${2#Range: bytes=}" ;; esac; shift 2 ;;
    -o) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
file="${OYL_FAKE_DIR}/bucket/routing/${url#https://tiles.example/routing/}"
if [ ! -f "${file}" ]; then printf 'HTTP/2 404\r\n\r\n'; exit 0; fi
size="$(wc -c <"${file}" | tr -d ' ')"
md5="$(md5 -q "${file}" 2>/dev/null || md5sum "${file}" | cut -d' ' -f1)"
brk="${OYL_FAKE_BREAK:-}"
if [ -n "${range}" ] && [ "${brk}" != range ]; then
  printf 'HTTP/2 206\r\ncontent-range: bytes %s/%s\r\ncontent-length: %s\r\n' "${range}" "${size}" "$((${range#*-} - ${range%-*} + 1))"
else
  printf 'HTTP/2 200\r\ncontent-length: %s\r\n' "${size}"
fi
printf 'etag: "%s"\r\nlast-modified: Fri, 06 Nov 2026 00:00:00 GMT\r\n' "${md5}"
printf 'cache-control: %s\r\n' "$([ "${brk}" = cache ] && echo 'max-age=3600' || cat "${file}.cache")"
[ "${brk}" = encoding ] && printf 'content-encoding: gzip\r\n'
printf 'access-control-allow-origin: *\r\n'
if [ "${brk}" = cors ]; then
  printf 'access-control-expose-headers: Content-Length, Content-Range\r\n'
else
  printf 'Access-Control-Expose-Headers: Content-Range, Content-Length, ETag, Last-Modified\r\n'
fi
printf '\r\n'
FAKE
  chmod +x "${tmp}/bin/aws" "${tmp}/bin/curl"
}

run_upload() {
  out="$(OYL_FAKE_DIR="${tmp}" PATH="${tmp}/bin:${PATH}" OYL_R2_BUCKET=oyl-tiles \
    AWS_SECRET_ACCESS_KEY=oyl-test-secret-value \
    OYL_R2_ENDPOINT=https://account.r2.example OYL_ROUTING_PUBLIC_BASE="${PUBLIC}" \
    bash "${UPLOAD}" "$@" 2>&1)"
  code=$?
}

check() {
  local name="$1"
  shift
  if "$@"; then ok "${name}"; else bad "${name}"; fi
}

has() { grep -qF -- "$2" <<<"$1"; }
lacks() { ! grep -qF -- "$2" <<<"$1"; }
puts() { grep -c 'put-object' "${tmp}/calls"; }

# --- The default is a plan --------------------------------------------------
new_fixture
release="$(basename "${rel}")"
run_upload "${rel}"
check 'no flag: it succeeds' test "${code}" -eq 0
check 'no flag: it calls neither aws nor curl' test ! -s "${tmp}/calls"
check 'no flag: it says nothing was uploaded' has "${out}" 'nothing was uploaded'
check 'no flag: it lists the immutable Cache-Control' has "${out}" 'public, max-age=31536000, immutable'
check 'no flag: it plans every object under the release' has "${out}" "--key routing/${release}/tiles/2/000/519/120.gph"
last="$(grep 'put-object' <<<"${out}" | tail -1)"
check 'no flag: the manifest is planned last' has "${last}" 'manifest.json'

new_fixture
out="$(PATH="${tmp}/bin:${PATH}" bash "${UPLOAD}" -- "${rel}" 2>&1)"
code=$?
check 'no flag and no settings: it plans with placeholders' has "${out}" "--bucket \$OYL_R2_BUCKET"
check 'a leading -- is passed over' test "${code}" -eq 0

# --- An upload --------------------------------------------------------------
new_fixture
release="$(basename "${rel}")"
run_upload "${rel}" --upload
calls="$(cat "${tmp}/calls")"
check '--upload: it succeeds' test "${code}" -eq 0
check '--upload: it checks the release is not there first' has "${calls}" "list-objects-v2 --prefix routing/${release}/ --max-keys 1"
check '--upload: every object is in the bucket' \
  test "$(find "${tmp}/bucket/routing/${release}" -type f ! -name '*.cache' | wc -l | tr -d ' ')" -eq "$(find "${rel}" -type f | wc -l | tr -d ' ')"
check '--upload: each object is put once' test "$(puts)" -eq "$(find "${rel}" -type f | wc -l | tr -d ' ')"
last="$(grep -E 'put-object|curl' "${tmp}/calls" | tail -1)"
check '--upload: the manifest is put last, after the checks' has "${last}" 'put-object'
check '--upload: the last call is the manifest' has "${last}" 'manifest.json'
check '--upload: with the immutable Cache-Control' \
  test "$(cat "${tmp}/bucket/routing/${release}/manifest.json.cache")" = 'public, max-age=31536000, immutable'
check '--upload: as JSON and as bytes' has "${calls}" "--key routing/${release}/graph.tar --body ${rel}/graph.tar --content-type application/octet-stream"
check '--upload: the check sends the page'"'"'s Origin' has "${calls}" 'Origin: http://localhost:5180'
check '--upload: the check asks graph.tar for a range' has "${calls}" 'Range: bytes=0-511'
check '--upload: the key is on no command line' lacks "${calls}" 'oyl-test-secret-value'
check '--upload: and in no output' lacks "${out}" 'oyl-test-secret-value'
check '--upload: it prints where the manifest is' has "${out}" "${PUBLIC}/${release}/manifest.json"

# --- A release that is already there ------------------------------------------
new_fixture
out="$(OYL_FAKE_DIR="${tmp}" OYL_FAKE_KEYCOUNT=3 PATH="${tmp}/bin:${PATH}" OYL_R2_BUCKET=b OYL_R2_ENDPOINT=e \
  OYL_ROUTING_PUBLIC_BASE="${PUBLIC}" bash "${UPLOAD}" "${rel}" --upload 2>&1)"
code=$?
check 'an existing release: refused' test "${code}" -eq 1
check 'an existing release: it says why' has "${out}" 'a release is immutable'
check 'an existing release: nothing is put' test "$(puts)" -eq 0

# --- What the public URL gets wrong stops the manifest ----------------------------
for broken in etag cors encoding range cache; do
  new_fixture
  release="$(basename "${rel}")"
  out="$(OYL_FAKE_DIR="${tmp}" OYL_FAKE_BREAK="${broken}" PATH="${tmp}/bin:${PATH}" OYL_R2_BUCKET=b \
    OYL_R2_ENDPOINT=e OYL_ROUTING_PUBLIC_BASE="${PUBLIC}" bash "${UPLOAD}" "${rel}" --upload 2>&1)"
  code=$?
  check "a wrong ${broken}: the upload fails" test "${code}" -eq 1
  check "a wrong ${broken}: the manifest is not uploaded" test ! -e "${tmp}/bucket/routing/${release}/manifest.json"
  check "a wrong ${broken}: it says how to finish" has "${out}" '--finish'
  case "${broken}" in
    etag) check 'a wrong etag: it says the ETag is wrong' has "${out}" 'graph.tar: its ETag is not the one in the manifest' ;;
    cors) check 'a wrong cors: it names the header' has "${out}" 'CORS does not expose etag' ;;
    encoding) check 'a wrong encoding: it names it' has "${out}" 'served with Content-Encoding gzip' ;;
    range) check 'a wrong range: it says a range is not answered' has "${out}" 'a byte range is not answered with 206' ;;
    cache) check 'a wrong cache: it says so' has "${out}" 'its Cache-Control is not immutable' ;;
  esac
done

# --- --finish ----------------------------------------------------------------
new_fixture
release="$(basename "${rel}")"
out="$(OYL_FAKE_DIR="${tmp}" OYL_FAKE_BREAK=cors PATH="${tmp}/bin:${PATH}" OYL_R2_BUCKET=b OYL_R2_ENDPOINT=e \
  OYL_ROUTING_PUBLIC_BASE="${PUBLIC}" bash "${UPLOAD}" "${rel}" --upload 2>&1)"
: >"${tmp}/calls"
run_upload "${rel}" --finish
check '--finish: once the cause is fixed it succeeds' test "${code}" -eq 0
check '--finish: it puts only the manifest' test "$(puts)" -eq 1 -a -e "${tmp}/bucket/routing/${release}/manifest.json"
run_upload "${rel}" --finish
check '--finish again: refused, the release is finished' has "${out}" 'already uploaded'

# --- Refusals ------------------------------------------------------------------
new_fixture
printf 'stray\n' >"${rel}/notes.txt"
run_upload "${rel}" --upload
check 'a stray file: refused' test "${code}" -eq 1
check 'a stray file: nothing is put' test "$(puts)" -eq 0

new_fixture
mv "${rel}" "${tmp}/out/renamed"
run_upload "${tmp}/out/renamed" --upload
check 'a renamed release: refused before any call' test "${code}" -eq 1 -a ! -s "${tmp}/calls"

new_fixture
out="$(OYL_FAKE_DIR="${tmp}" PATH="${tmp}/bin:${PATH}" bash "${UPLOAD}" "${rel}" --upload 2>&1)"
code=$?
check 'no bucket: refused' has "${out}" 'OYL_R2_BUCKET is required to upload'

new_fixture
run_upload "${rel}" --force
check 'an unknown flag: refused' has "${out}" 'unknown argument --force'

new_fixture
out="$(OYL_FAKE_DIR="${tmp}" OYL_FAKE_PUT_FAIL=config.json PATH="${tmp}/bin:${PATH}" OYL_R2_BUCKET=b \
  OYL_R2_ENDPOINT=e OYL_ROUTING_PUBLIC_BASE="${PUBLIC}" bash "${UPLOAD}" "${rel}" --upload 2>&1)"
code=$?
check 'a failed put: it stops' test "${code}" -eq 1
check 'a failed put: it names the object' has "${out}" 'the upload of config.json failed'
check 'a failed put: the manifest is not uploaded' test "$(grep -c 'manifest.json' "${tmp}/calls")" -eq 0

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
