#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# make-instance-bundle.sh -- the pull-only release bundle (#2786).
#
# The zip a release carries beside the image, for an operator with no git
# checkout and no build: the home deployment's own `compose.yaml`, `deploy.sh`
# and `instance.env.example`, with ONE change -- compose's default image is the
# published image BY DIGEST, not the `onyourleft-instance:local` a checkout
# builds -- and `release.image`, which names that same digest for `deploy.sh`.
# `instance.env.example` changes too: the checkout's sets OYL_INSTANCE_IMAGE
# to the local tag, and a `.env` copied from it would point a hand-run
# `docker compose up` at an image a bundle never builds, so the bundle's leaves
# it unset. The files are copied, not kept twice, so the bundle cannot drift
# from the deployment the rest of the repository tests (home-compose.test.ts).
# The `tailscale/` folder goes too, unchanged (#2805): compose.yaml mounts it
# into the `tailscale` service, and the file in it that OYL_INSTANCE_REMOTE_PATH
# names is what `tailscale serve` serves. Without it a bundle on the tailnet
# would mount an empty folder and serve nothing.
#
#   bash scripts/make-instance-bundle.sh IMAGE@sha256:DIGEST VERSION OUTDIR
#
# Writes OUTDIR/onyourleft-instance/ and OUTDIR/onyourleft-instance-VERSION.zip,
# whose one folder is `onyourleft-instance` whatever the version: a release's
# zip extracted where the last one was replaces these files and leaves the
# operator's `.env`, `secrets/` and deploy.sh's `.deployed` beside them, which
# is what lets deploy.sh roll back to the previous release.
#
# Rules:
#   BUNDLE001  the image is not named by a full sha256 digest
#   BUNDLE002  compose.yaml's default image is not where this expects it, so
#              the bundle would not name the digest
#   BUNDLE003  the version is empty or is not a plain version string
#   BUNDLE004  a serve file the tailscale profile reads is missing from
#              apps/instance/deploy/home/tailscale/
#   BUNDLE005  the bundle's instance.env.example does not offer
#              OYL_INSTANCE_CONTACT_EMAIL exactly once and EMPTY, or a file of
#              the bundle holds an email address at the project's own domain
#
# Its own suite: bash scripts/make-instance-bundle.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DEPLOY="${ROOT}/apps/instance/deploy/home"
# The one line of compose.yaml the bundle changes. Written out in full, so a
# reworded line fails BUNDLE002 rather than shipping a bundle that builds nothing
# and pulls nothing.
# The literal ${...} is compose's, not this shell's.
# shellcheck disable=SC2016
LOCAL_IMAGE_LINE='  image: ${OYL_INSTANCE_IMAGE:-onyourleft-instance:local}'
LOCAL_IMAGE_SETTING='OYL_INSTANCE_IMAGE=onyourleft-instance:local'
# #2857: the bundle is the template EVERY new server starts from, and what
# OYL_INSTANCE_CONTACT_EMAIL holds is what that server's /legal page tells its
# riders, and anybody with a complaint, to write to. The template shipped the
# project's own address once. So the line ships once and empty -- compose.yaml
# refuses to start without it, and the operator types their own -- and no file
# of the bundle holds an address at the project's domain or under it, in a
# setting or in a comment.
CONTACT_SETTING='OYL_INSTANCE_CONTACT_EMAIL='
PROJECT_ADDRESS='[a-z0-9._%+-]+@([a-z0-9-]+\.)*openzigs\.[a-z]'

die() {
  printf 'make-instance-bundle: %s\n' "$1" >&2
  exit 1
}

image="${1:-}"
version="${2:-}"
out="${3:-}"
[ -n "${out}" ] || die 'usage: make-instance-bundle.sh IMAGE@sha256:DIGEST VERSION OUTDIR'

# A registry host (and port), a path, an optional tag, and the digest.
[[ "${image}" =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$ ]] ||
  die "BUNDLE001 the image must be named by its digest (IMAGE@sha256:<64 hex>): ${image}"
[[ "${version}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
  die "BUNDLE003 the version is not a plain version string: ${version:-(empty)}"

[ "$(grep -cxF -- "${LOCAL_IMAGE_LINE}" "${HOME_DEPLOY}/compose.yaml")" = 1 ] ||
  die "BUNDLE002 apps/instance/deploy/home/compose.yaml does not have exactly one line '${LOCAL_IMAGE_LINE}' to point at the digest."
[ "$(grep -cxF -- "${LOCAL_IMAGE_SETTING}" "${HOME_DEPLOY}/instance.env.example")" = 1 ] ||
  die "BUNDLE002 apps/instance/deploy/home/instance.env.example does not have exactly one line '${LOCAL_IMAGE_SETTING}' to leave unset."

# The serve files OYL_INSTANCE_REMOTE_PATH can name (compose.yaml's
# TS_SERVE_CONFIG): `tailnet` and `funnel`.
SERVE_FILES='serve-tailnet.json serve-funnel.json'
for serve in ${SERVE_FILES}; do
  [ -f "${HOME_DEPLOY}/tailscale/${serve}" ] ||
    die "BUNDLE004 apps/instance/deploy/home/tailscale/${serve} is missing: the tailscale profile serves it."
done

name='onyourleft-instance'
zip="${name}-${version}.zip"
bundle="${out}/${name}"
rm -rf "${bundle}" "${out:?}/${zip}"
mkdir -p "${bundle}"

# `awk` with the line passed as data, so nothing in the image name is read as
# a pattern or a replacement.
awk -v from="${LOCAL_IMAGE_LINE}" -v to="  image: \${OYL_INSTANCE_IMAGE:-${image}}" \
  '$0 == from { print to; next } { print }' "${HOME_DEPLOY}/compose.yaml" > "${bundle}/compose.yaml"
cp "${HOME_DEPLOY}/deploy.sh" "${bundle}/deploy.sh"
chmod +x "${bundle}/deploy.sh"
awk -v from="${LOCAL_IMAGE_SETTING}" '
  $0 == from {
    print "# In a release bundle, leave this unset: compose.yaml names the release'"'"'s"
    print "# image by its digest, and deploy.sh sets it for each deploy itself."
    print "# OYL_INSTANCE_IMAGE="
    next
  }
  { print }' "${HOME_DEPLOY}/instance.env.example" > "${bundle}/instance.env.example"
printf '%s\n' "${image}" > "${bundle}/release.image"
mkdir -p "${bundle}/tailscale"
for serve in ${SERVE_FILES}; do
  cp "${HOME_DEPLOY}/tailscale/${serve}" "${bundle}/tailscale/${serve}"
done

# Read back: the digest is in compose.yaml exactly once, and the local tag is not.
[ "$(grep -cF -- "${image}" "${bundle}/compose.yaml")" = 1 ] ||
  die "BUNDLE002 the bundle's compose.yaml does not name ${image} exactly once."
if grep -qF 'onyourleft-instance:local}' "${bundle}/compose.yaml"; then
  die "BUNDLE002 the bundle's compose.yaml still defaults to the locally built image."
fi
if grep -q '^OYL_INSTANCE_IMAGE=' "${bundle}/instance.env.example"; then
  die "BUNDLE002 the bundle's instance.env.example still sets OYL_INSTANCE_IMAGE."
fi
# Read back, on what ships: the contact line once and empty, and nobody's
# address at the project's domain in any file (#2857).
if [ "$(grep -c -- "^${CONTACT_SETTING}" "${bundle}/instance.env.example")" != 1 ] ||
  ! grep -qxF -- "${CONTACT_SETTING}" "${bundle}/instance.env.example"; then
  die "BUNDLE005 the bundle's instance.env.example does not have exactly one line '${CONTACT_SETTING}', with nothing after it: every new server starts from this file, and its /legal page tells riders to write to whatever address is there."
fi
holding="$(cd "${bundle}" && grep -rIilE -- "${PROJECT_ADDRESS}" . | sed 's|^\./||' | sort | tr '\n' ' ')" || true
if [ -n "${holding}" ]; then
  die "BUNDLE005 the bundle holds an email address at the project's own domain, in ${holding% }: every new server would ship it. The project's address is not an operator's default."
fi

(cd "${out}" && zip -q -r -X "${zip}" "${name}")
printf 'make-instance-bundle: %s, pulling %s\n' "${out}/${zip}" "${image}"
