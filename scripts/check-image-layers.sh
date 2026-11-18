#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-image-layers.sh -- the instance's image carries no `.env`, no secrets
# folder and no secret in its configuration (#2786).
#
# A deploy's `.env` holds the tunnel token and the secret key, and `secrets/`
# beside it the Discord bot token (#2146). Neither may ever be in an image the
# project publishes: a pushed image is public and permanent, like a pushed
# commit. `Dockerfile.dockerignore` is an allowlist that should keep both out,
# and this reads what was actually built rather than trusting it.
#
# It reads EVERY LAYER, not the finished filesystem: a file one layer adds and
# a later layer deletes is gone from the container and still in the image,
# where anybody who pulls it can read it. So it lists each layer the archive's
# `manifest.json` names, and a layer it cannot list fails rather than passing
# unread.
#
# Rules:
#   LAYER001  a layer holds an env file (`.env`, `.env.*`, `*.env`,
#             `*.env.*`), a `secrets` folder, the Discord bot token's file or
#             a deploy's `.deployed`
#   LAYER002  the image's configuration sets a variable whose name says it is a
#             secret (TOKEN, SECRET, PASSWORD, KEY)
#   LAYER003  the image could not be read: no archive, no layers, or a layer
#             that does not list
#
# Usage:
#   bash scripts/check-image-layers.sh IMAGE             # `docker save IMAGE`
#   bash scripts/check-image-layers.sh --archive FILE    # a docker-archive tar
#
# The second form is how the release workflow reads each platform of a pushed
# image (`skopeo copy ... docker-archive:FILE`); the first is how
# scripts/check-instance-image.sh reads the image it built (IMG009).
#
# Its own suite: bash scripts/check-image-layers.test.sh

set -uo pipefail

fail() {
  printf 'check-image-layers: %s\n' "$1" >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

if [ "${1:-}" = '--archive' ]; then
  [ -n "${2:-}" ] && [ -f "$2" ] || fail "LAYER003 there is no archive at ${2:-(none given)}."
  label="$2"
  tar -xf "$2" -C "${work}" 2>/dev/null || fail "LAYER003 ${label} is not an image archive."
elif [ -n "${1:-}" ]; then
  label="$1"
  docker save "$1" > "${work}/image.tar" || fail "LAYER003 docker could not save ${label}."
  tar -xf "${work}/image.tar" -C "${work}" 2>/dev/null || fail "LAYER003 ${label} did not save as an image archive."
  rm -f "${work}/image.tar"
else
  fail 'LAYER003 name an image, or --archive FILE.'
fi

[ -f "${work}/manifest.json" ] || fail "LAYER003 ${label} has no manifest.json."
manifest="$(tr -d '\n' < "${work}/manifest.json")"

# The names inside `"Layers":[...]` and the one `"Config":"..."`, read without
# jq so this runs wherever the image check does. A layer name is a path inside
# the archive (`blobs/sha256/<hex>` or `<hex>/layer.tar`) and holds no quote.
# `|| [ -n ... ]`: the last name has no newline after it, and a bare `read`
# returns non-zero on it while still filling the variable (#864's shape).
layers=()
while IFS= read -r layer || [ -n "${layer}" ]; do
  [ -n "${layer}" ] && layers+=("${layer}")
done < <(printf '%s' "${manifest}" | sed -n 's/.*"Layers":\[\([^]]*\)\].*/\1/p' | tr ',' '\n' | tr -d '" ')
[ "${#layers[@]}" -gt 0 ] || fail "LAYER003 ${label}'s manifest.json names no layers."
config="$(printf '%s' "${manifest}" | sed -n 's/.*"Config":"\([^"]*\)".*/\1/p')"

found=()
for layer in "${layers[@]}"; do
  case "${layer}" in
    /* | *..*) fail "LAYER003 ${label}'s manifest names a layer outside the archive: ${layer}" ;;
  esac
  listing="$(tar -tf "${work}/${layer}" 2>/dev/null)" ||
    fail "LAYER003 a layer of ${label} could not be listed: ${layer}"
  while IFS= read -r path; do
    [ -n "${path}" ] && found+=("${path}")
  done < <(printf '%s\n' "${listing}" |
    grep -E '(^|/)(\.env|[^/]*\.env|[^/]*\.env\.[^/]*|\.deployed|discord-bot-token)/?$|(^|/)secrets(/|$)' || true)
done

if [ "${#found[@]}" -gt 0 ]; then
  printf 'check-image-layers: LAYER001 %s carries files a deploy keeps secret:\n' "${label}" >&2
  printf '  %s\n' "${found[@]}" | sort -u >&2
  exit 1
fi

# The configuration's environment, from the archive rather than `docker
# inspect`, so the two forms above ask the same question.
if [ -n "${config}" ] && [ -f "${work}/${config}" ]; then
  secrets="$(tr -d '\n' < "${work}/${config}" | sed -n 's/.*"Env":\[\([^]]*\)\].*/\1/p' |
    tr ',' '\n' | tr -d '"' | sed 's/=.*//' | grep -E 'TOKEN|SECRET|PASSWORD|PASSWD|KEY' || true)"
  if [ -n "${secrets}" ]; then
    printf 'check-image-layers: LAYER002 %s sets a secret in its configuration:\n' "${label}" >&2
    printf '  %s\n' "${secrets}" >&2
    exit 1
  fi
else
  fail "LAYER003 ${label}'s configuration (${config:-not named}) is not in the archive."
fi

printf 'check-image-layers: %s -- %d layers read; no env file, no secrets folder, no secret in its configuration.\n' \
  "${label}" "${#layers[@]}"
