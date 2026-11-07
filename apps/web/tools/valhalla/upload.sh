#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Uploads one routing-graph release to R2 as an immutable directory (#2320).
#
#   upload.sh <release-dir>             print the plan; upload nothing (the default)
#   upload.sh <release-dir> --upload    upload, check the public URL, then the manifest
#   upload.sh <release-dir> --finish    check the public URL, then upload the manifest
#
# ⚠️ **Only on the owner's word, given at upload time** (#2320). The lane that
# wrote this stopped before running it, and a dry run is the default so that
# reading the plan is what running it without a flag does.
#
# The AWS CLI against R2's S3 API, with the maintainer's existing R2
# credentials in the AWS CLI's own places (AWS_PROFILE, or its environment
# variables). ⚠️ This script never reads, prints or passes a key: the CLI
# finds them itself.
#
#   OYL_R2_BUCKET            the bucket behind tiles.openzigs.com (required to upload)
#   OYL_R2_ENDPOINT          https://<account>.r2.cloudflarestorage.com (required to upload)
#   OYL_R2_PREFIX            the key prefix (default: routing)
#   OYL_ROUTING_PUBLIC_BASE  the public URL of that prefix (default: https://tiles.openzigs.com/routing)
#   OYL_MEASURE_ORIGIN       the Origin the check sends (default: http://localhost:5180, the page)
#
# Every object goes up in one PUT (`s3api put-object` never splits one), with
# `Cache-Control: public, max-age=31536000, immutable` and no Content-Encoding,
# the headers spike 0035 lists. Then, before manifest.json, every graph object
# is fetched from the PUBLIC URL with the page's Origin and must answer 200
# with the manifest's ETag and length, no encoding, the immutable
# Cache-Control, and CORS that lets the page read ETag, Content-Length,
# Content-Range and Last-Modified; graph.tar must also answer one byte range
# with 206. Any failure stops the upload before the manifest, which is what a
# session reads first, so a half-right release is never one the SDK opens.
# Fix the cause (bucket CORS is the owner's: README.md) and run --finish.
#
# Its suite is upload.test.sh, with a fake `aws` and `curl`.

set -euo pipefail

CACHE_CONTROL='public, max-age=31536000, immutable'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "${HERE}/../.." && pwd)"

die() {
  printf 'upload: %s\n' "$1" >&2
  exit 1
}

if [ "${1:-}" = -- ]; then shift; fi # what `pnpm run valhalla:upload -- …` may pass through
dir="${1:-}"
mode="${2:-plan}"
[ -n "${dir}" ] || die 'usage: upload.sh <release-dir> [--upload | --finish]'
[ -d "${dir}" ] || die 'the release directory is not there'
case "${mode}" in
  plan | --upload | --finish) ;;
  *) die "unknown argument ${mode}" ;;
esac
[ $# -le 2 ] || die 'too many arguments'

dir="$(cd "${dir}" && pwd)"
release="$(basename "${dir}")"
prefix="${OYL_R2_PREFIX:-routing}"
public="${OYL_ROUTING_PUBLIC_BASE:-https://tiles.openzigs.com/routing}"
origin="${OYL_MEASURE_ORIGIN:-http://localhost:5180}"
bucket="${OYL_R2_BUCKET:-}"
endpoint="${OYL_R2_ENDPOINT:-}"

objects="$(cd "${WEB}" && node --import ./tools/ts-extensionless-resolve.mjs \
  tools/valhalla/release-objects.ts "${dir}")" || die 'the release directory is not a whole release'

count="$(printf '%s\n' "${objects}" | wc -l | tr -d ' ')"
total="$(printf '%s\n' "${objects}" | awk -F '\t' '{ sum += $4 } END { print sum }')"

if [ "${mode}" = plan ]; then
  printf 'upload: %s: %s objects, %s bytes, to s3://%s/%s/%s/\n' \
    "${release}" "${count}" "${total}" "${bucket:-\$OYL_R2_BUCKET}" "${prefix}" "${release}"
  printf 'upload: each with Cache-Control "%s":\n' "${CACHE_CONTROL}"
  while IFS=$'\t' read -r key type _etag _bytes; do
    printf '  aws s3api put-object --endpoint-url %s --bucket %s --key %s --body %s --content-type %q --cache-control %q\n' \
      "${endpoint:-\$OYL_R2_ENDPOINT}" "${bucket:-\$OYL_R2_BUCKET}" "${prefix}/${release}/${key}" \
      "${dir}/${key}" "${type}" "${CACHE_CONTROL}"
  done <<<"${objects}"
  printf 'upload: manifest.json last, after every object answers %s/%s/ with its ETag.\n' "${public}" "${release}"
  printf 'upload: nothing was uploaded. With the owner'"'"'s word: upload.sh %s --upload\n' "${dir}"
  exit 0
fi

[ -n "${bucket}" ] || die 'OYL_R2_BUCKET is required to upload'
[ -n "${endpoint}" ] || die 'OYL_R2_ENDPOINT is required to upload'
command -v aws >/dev/null 2>&1 || die 'the AWS CLI (aws) is required'
command -v curl >/dev/null 2>&1 || die 'curl is required'

s3() { aws s3api "$@" --endpoint-url "${endpoint}" --bucket "${bucket}"; }

put() {
  local key="$1" type="$2"
  s3 put-object --key "${prefix}/${release}/${key}" --body "${dir}/${key}" \
    --content-type "${type}" --cache-control "${CACHE_CONTROL}" >/dev/null ||
    die "the upload of ${key} failed"
  printf 'upload: put %s\n' "${key}"
}

# header NAME < headers: the value of the last NAME header, case-insensitively.
header() { tr -d '\r' | awk -v name="$1" 'tolower($0) ~ "^" tolower(name) ":" { sub(/^[^:]*:[ \t]*/, ""); value = $0 } END { print value }'; }
status() { tr -d '\r' | awk 'toupper($1) ~ /^HTTP\// { code = $2 } END { print code }'; }

failures=0
problem() {
  failures=$((failures + 1))
  printf 'upload: %s: %s\n' "$1" "$2" >&2
}

check_object() {
  local key="$1" etag="$2" bytes="$3" url="${public}/${release}/$1" headers expose allow encoding
  headers="$(curl -sS -I -H "Origin: ${origin}" "${url}")" || {
    problem "${key}" 'the public URL did not answer'
    return
  }
  [ "$(status <<<"${headers}")" = 200 ] || problem "${key}" "HEAD answered $(status <<<"${headers}"), not 200"
  [ "${etag}" = - ] || [ "$(header etag <<<"${headers}")" = "${etag}" ] ||
    problem "${key}" 'its ETag is not the one in the manifest (a multipart upload, or another object)'
  [ "$(header content-length <<<"${headers}")" = "${bytes}" ] || problem "${key}" 'its Content-Length is not its size'
  encoding="$(header content-encoding <<<"${headers}")"
  [ -z "${encoding}" ] || [ "${encoding}" = identity ] || problem "${key}" "it is served with Content-Encoding ${encoding}"
  case "$(header cache-control <<<"${headers}")" in
    *immutable*) ;;
    *) problem "${key}" 'its Cache-Control is not immutable' ;;
  esac
  allow="$(header access-control-allow-origin <<<"${headers}")"
  [ "${allow}" = '*' ] || [ "${allow}" = "${origin}" ] || problem "${key}" "CORS does not allow ${origin}"
  expose="$(header access-control-expose-headers <<<"${headers}" | tr '[:upper:]' '[:lower:]')"
  for name in etag content-length content-range last-modified; do
    case ",${expose// /}," in
      *",${name},"*) ;;
      *) problem "${key}" "CORS does not expose ${name}" ;;
    esac
  done
}

check_range() {
  local bytes="$1" url="${public}/${release}/graph.tar" headers
  headers="$(curl -sS -o /dev/null -D - -H "Origin: ${origin}" -H 'Range: bytes=0-511' "${url}")" || {
    problem graph.tar 'the range request did not answer'
    return
  }
  [ "$(status <<<"${headers}")" = 206 ] || problem graph.tar 'a byte range is not answered with 206'
  [ "$(header content-range <<<"${headers}")" = "bytes 0-511/${bytes}" ] ||
    problem graph.tar 'its Content-Range is not the range asked for'
}

if [ "${mode}" = --upload ]; then
  existing="$(s3 list-objects-v2 --prefix "${prefix}/${release}/" --max-keys 1 --query KeyCount --output text)" ||
    die 'the bucket could not be listed'
  [ "${existing}" = 0 ] || die "${prefix}/${release}/ already holds objects: a release is immutable, so build a new one"
  while IFS=$'\t' read -r key type _etag _bytes; do
    [ "${key}" = manifest.json ] || put "${key}" "${type}"
  done <<<"${objects}"
else
  if s3 head-object --key "${prefix}/${release}/manifest.json" >/dev/null 2>&1; then
    die 'manifest.json is already uploaded: this release is finished'
  fi
fi

while IFS=$'\t' read -r key _type etag bytes; do
  [ "${key}" = manifest.json ] || check_object "${key}" "${etag}" "${bytes}"
done <<<"${objects}"
check_range "$(printf '%s\n' "${objects}" | awk -F '\t' '$1 == "graph.tar" { print $4 }')"

if [ "${failures}" -gt 0 ]; then
  die "${failures} problem(s) on the public URL; manifest.json was NOT uploaded. Fix them, then: upload.sh ${dir} --finish"
fi

put manifest.json application/json
printf 'upload: %s is live at %s/%s/manifest.json\n' "${release}" "${public}" "${release}"
printf 'upload: measure with ?manifest=%s/%s/manifest.json&pair=5:…&pair=40:…&pair=150:…\n' "${public}" "${release}"
