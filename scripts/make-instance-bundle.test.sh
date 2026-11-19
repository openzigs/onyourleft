#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/make-instance-bundle.sh -- #2786.
#
# Each case copies the script beside a copy of the home deployment, so a case
# can change compose.yaml without touching the committed one, and one case runs
# it on the committed files. Needs bash, coreutils, awk and zip; no Docker.
#
# Run: bash scripts/make-instance-bundle.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"

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
assert_exit() {
  if [ "${code}" -eq "$2" ]; then ok "$1"; else bad "$1 (exit ${code}, wanted $2)"; fi
}
assert_says() {
  if grep -qF -- "$2" <<< "${out}"; then ok "$1"; else bad "$1 (no '$2')"; fi
}

# Whether a folder has exactly these permission bits. `find`, because its
# `-perm` reads the same on Linux and macOS and `stat`'s format does not.
dir_has_mode() { [ -n "$(find "$1" -maxdepth 0 -type d -perm "$2" 2>/dev/null)" ]; }

IMAGE="ghcr.io/openzigs/onyourleft-instance:1.2.3@sha256:$(printf 'c%.0s' $(seq 1 64))"
# An email address at the project's own domain, or under it (#2857). Written
# out here and not read from the script, so the script's own pattern is tested.
PROJECT_ADDRESS='[a-z0-9._%+-]+@([a-z0-9-]+\.)*openzigs\.[a-z]'

new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/repo/scripts" "${tmp}/repo/apps/instance/deploy/home" "${tmp}/out"
  cp "${SCRIPT_DIR}/make-instance-bundle.sh" "${tmp}/repo/scripts/"
  cp "${REPO}/apps/instance/deploy/home/compose.yaml" "${REPO}/apps/instance/deploy/home/deploy.sh" \
    "${REPO}/apps/instance/deploy/home/instance.env.example" "${tmp}/repo/apps/instance/deploy/home/"
  cp -R "${REPO}/apps/instance/deploy/home/tailscale" "${tmp}/repo/apps/instance/deploy/home/"
}

run_bundle() {
  out="$(bash "${tmp}/repo/scripts/make-instance-bundle.sh" "$@" 2>&1)"
  code=$?
}

# --- Green: the committed home deployment -------------------------------------------

new_fixture
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
assert_exit 'the committed home deployment bundles' 0
b="${tmp}/out/onyourleft-instance"
for file in compose.yaml deploy.sh instance.env.example release.image; do
  if [ -f "${b}/${file}" ]; then ok "the bundle holds ${file}"; else bad "the bundle holds ${file}"; fi
done
if grep -qxF "  image: \${OYL_INSTANCE_IMAGE:-${IMAGE}}" "${b}/compose.yaml"; then
  ok 'compose.yaml defaults to the image by digest'
else
  bad 'compose.yaml defaults to the image by digest'
fi
if [ "$(cat "${b}/release.image")" = "${IMAGE}" ]; then ok 'release.image names the same digest'; else bad 'release.image names the same digest'; fi
# The literal ${...} below is compose's, not this shell's.
# shellcheck disable=SC2016
if diff <(grep -vF 'image: ${OYL_INSTANCE_IMAGE:-' "${b}/compose.yaml") \
  <(grep -vF 'image: ${OYL_INSTANCE_IMAGE:-' "${REPO}/apps/instance/deploy/home/compose.yaml") >/dev/null; then
  ok 'and every other line of compose.yaml is the home deployment'"'"'s'
else
  bad 'and every other line of compose.yaml is the home deployment'"'"'s'
fi
if grep -q '^OYL_INSTANCE_IMAGE=' "${b}/instance.env.example"; then
  bad 'instance.env.example leaves OYL_INSTANCE_IMAGE unset, so a hand-run compose uses the digest'
else
  ok 'instance.env.example leaves OYL_INSTANCE_IMAGE unset, so a hand-run compose uses the digest'
fi
if diff <(grep -v 'OYL_INSTANCE_IMAGE' "${b}/instance.env.example" | grep -v "^# In a release bundle, leave this unset\|^# image by its digest, and deploy.sh") \
  <(grep -v 'OYL_INSTANCE_IMAGE' "${REPO}/apps/instance/deploy/home/instance.env.example") >/dev/null; then
  ok 'and every other line of it is the home deployment'"'"'s'
else
  bad 'and every other line of it is the home deployment'"'"'s'
fi
# #2857: the bundle is every new server's template, and its /legal page tells
# riders to write to whatever OYL_INSTANCE_CONTACT_EMAIL holds. Asserted on the
# bundle itself and not through the script's BUNDLE005, so these are red
# whichever of the template and the rule is lost.
if [ "$(grep -c '^OYL_INSTANCE_CONTACT_EMAIL=' "${b}/instance.env.example")" = 1 ] &&
  grep -qxF 'OYL_INSTANCE_CONTACT_EMAIL=' "${b}/instance.env.example"; then
  ok 'instance.env.example offers OYL_INSTANCE_CONTACT_EMAIL once, and empty: it names nobody to write to'
else
  out="$(grep -n 'OYL_INSTANCE_CONTACT_EMAIL' "${b}/instance.env.example")"
  bad 'instance.env.example offers OYL_INSTANCE_CONTACT_EMAIL once, and empty: it names nobody to write to'
fi
if out="$(grep -rIinE "${PROJECT_ADDRESS}" "${b}")"; then
  bad 'no file of the bundle holds an address at the project'"'"'s own domain'
else
  ok 'no file of the bundle holds an address at the project'"'"'s own domain'
fi
if cmp -s "${b}/deploy.sh" "${REPO}/apps/instance/deploy/home/deploy.sh"; then ok 'deploy.sh is copied unchanged'; else bad 'deploy.sh is copied unchanged'; fi
if [ -x "${b}/deploy.sh" ]; then ok 'and is executable'; else bad 'and is executable'; fi
# #2805: compose.yaml mounts ./tailscale into the tailscale service, which serves
# the file OYL_INSTANCE_REMOTE_PATH names. A bundle without them serves nothing.
for serve in serve-tailnet.json serve-funnel.json; do
  if cmp -s "${b}/tailscale/${serve}" "${REPO}/apps/instance/deploy/home/tailscale/${serve}"; then
    ok "the bundle holds tailscale/${serve}, unchanged"
  else
    bad "the bundle holds tailscale/${serve}, unchanged"
  fi
done
listing="$(unzip -Z1 "${tmp}/out/onyourleft-instance-1.2.3.zip" 2>&1 | sort | tr '\n' ' ')"
if [ "${listing}" = 'onyourleft-instance/ onyourleft-instance/compose.yaml onyourleft-instance/deploy.sh onyourleft-instance/instance.env.example onyourleft-instance/release.image onyourleft-instance/secrets/ onyourleft-instance/tailscale/ onyourleft-instance/tailscale/serve-funnel.json onyourleft-instance/tailscale/serve-tailnet.json ' ]; then
  ok 'the zip holds those files in one unversioned folder and nothing else -- no .env'
else
  out="${listing}"
  bad 'the zip holds those files in one unversioned folder and nothing else -- no .env'
fi

# #2818: compose.yaml mounts ./secrets into the instance, which makes its secret
# key there on its first start. Docker makes a MISSING bind-mount folder owned
# by root on Linux, where the instance (uid 1000) cannot write it, so the bundle
# ships the folder: empty, and owner-only before anything is in it.
if dir_has_mode "${b}/secrets" 700; then
  ok 'the bundle holds secrets/, owner-only'
else
  out="$(ls -ld "${b}/secrets" 2>&1)"
  bad 'the bundle holds secrets/, owner-only'
fi
# Read back the way an operator gets it: the zip, extracted into an empty folder.
mkdir "${tmp}/install"
(cd "${tmp}/install" && unzip -q "${tmp}/out/onyourleft-instance-1.2.3.zip")
if dir_has_mode "${tmp}/install/onyourleft-instance/secrets" 700; then
  ok 'and the zip extracts it owner-only, before Docker could make it'
else
  out="$(ls -ld "${tmp}/install/onyourleft-instance/secrets" 2>&1)"
  bad 'and the zip extracts it owner-only, before Docker could make it'
fi
if [ -z "$(ls -A "${tmp}/install/onyourleft-instance/secrets" 2>&1)" ]; then
  ok 'and empty'
else
  out="$(ls -A "${tmp}/install/onyourleft-instance/secrets" 2>&1)"
  bad 'and empty'
fi

# An update: the next release's zip extracted over an install. The operator's
# secrets folder is theirs -- its files and its mode stay as they were.
mkdir -p "${tmp}/box/onyourleft-instance/secrets"
chmod 750 "${tmp}/box/onyourleft-instance/secrets"
printf 'the-key\n' > "${tmp}/box/onyourleft-instance/secrets/instance-secret-key"
printf 'OYL_INSTANCE_ORIGIN=https://mine.example\n' > "${tmp}/box/onyourleft-instance/.env"
(cd "${tmp}/box" && unzip -q -o "${tmp}/out/onyourleft-instance-1.2.3.zip")
if [ "$(cat "${tmp}/box/onyourleft-instance/secrets/instance-secret-key" 2>&1)" = 'the-key' ] &&
  dir_has_mode "${tmp}/box/onyourleft-instance/secrets" 750 &&
  [ -f "${tmp}/box/onyourleft-instance/.env" ] && [ -f "${tmp}/box/onyourleft-instance/compose.yaml" ]; then
  ok 'extracted over an install, it leaves the secrets already there, and the folder'"'"'s mode'
else
  out="$(ls -laR "${tmp}/box" 2>&1)"
  bad 'extracted over an install, it leaves the secrets already there, and the folder'"'"'s mode'
fi

# A secrets folder beside the home deployment (the owner's own box) is never
# copied: the bundle's is made empty, whatever the checkout holds.
new_fixture
mkdir "${tmp}/repo/apps/instance/deploy/home/secrets"
printf 'the-key\n' > "${tmp}/repo/apps/instance/deploy/home/secrets/instance-secret-key"
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
assert_exit 'a checkout with secrets beside compose.yaml still bundles' 0
zipped="$(unzip -Z1 "${tmp}/out/onyourleft-instance-1.2.3.zip")"
if grep -q 'secrets/.' <<< "${zipped}" || [ -n "$(ls -A "${tmp}/out/onyourleft-instance/secrets" 2>&1)" ]; then
  out="${zipped}"
  bad 'and nothing in it is in the zip: the bundle'"'"'s secrets/ is empty'
else
  ok 'and nothing in it is in the zip: the bundle'"'"'s secrets/ is empty'
fi

# A .env beside the home deployment (the owner's own box) is not bundled.
new_fixture
printf 'CLOUDFLARE_TUNNEL_TOKEN=secret\n' > "${tmp}/repo/apps/instance/deploy/home/.env"
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
assert_exit 'a checkout with a .env beside compose.yaml still bundles' 0
zipped="$(unzip -Z1 "${tmp}/out/onyourleft-instance-1.2.3.zip")"
if grep -q '\.env$' <<< "${zipped}"; then
  bad 'and the .env is not in the zip'
else
  ok 'and the .env is not in the zip'
fi

# --- BUNDLE001 ---------------------------------------------------------------------

for wrong in ghcr.io/openzigs/onyourleft-instance:1.2.3 \
  "ghcr.io/openzigs/onyourleft-instance@sha256:abc" \
  "ghcr.io/openzigs/onyourleft-instance@sha256:$(printf 'C%.0s' $(seq 1 64))" \
  "ghcr.io/x/y@sha256:$(printf 'c%.0s' $(seq 1 64))}evil" \
  "onyourleft-instance@sha256:$(printf 'c%.0s' $(seq 1 64))"; do
  new_fixture
  run_bundle "${wrong}" 1.2.3 "${tmp}/out"
  assert_exit "an image not named by a full digest is refused: ${wrong:0:60}" 1
  assert_says 'as BUNDLE001' 'BUNDLE001'
done

# --- BUNDLE002 ---------------------------------------------------------------------

new_fixture
sed -i.bak 's/onyourleft-instance:local}/onyourleft-instance:built}/' "${tmp}/repo/apps/instance/deploy/home/compose.yaml"
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
assert_exit 'a compose.yaml whose default image line moved is refused' 1
assert_says 'as BUNDLE002' 'BUNDLE002'
if [ -e "${tmp}/out/onyourleft-instance-1.2.3.zip" ]; then bad 'and writes no zip'; else ok 'and writes no zip'; fi

new_fixture
# shellcheck disable=SC2016
printf '\n  image: ${OYL_INSTANCE_IMAGE:-onyourleft-instance:local}\n' >> "${tmp}/repo/apps/instance/deploy/home/compose.yaml"
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
assert_exit 'a compose.yaml with that line twice is refused' 1
assert_says 'as BUNDLE002' 'BUNDLE002'

new_fixture
sed -i.bak 's/^OYL_INSTANCE_IMAGE=onyourleft-instance:local$/OYL_INSTANCE_IMAGE=other/' \
  "${tmp}/repo/apps/instance/deploy/home/instance.env.example"
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
assert_exit 'an instance.env.example whose image setting moved is refused' 1
assert_says 'as BUNDLE002, naming the file' 'instance.env.example does not have exactly one line'

# --- BUNDLE004 ---------------------------------------------------------------------

for serve in serve-tailnet.json serve-funnel.json; do
  new_fixture
  rm "${tmp}/repo/apps/instance/deploy/home/tailscale/${serve}"
  run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
  assert_exit "a home deployment with no tailscale/${serve} is refused" 1
  assert_says 'as BUNDLE004, naming the file' "BUNDLE004 apps/instance/deploy/home/tailscale/${serve} is missing"
  if [ -e "${tmp}/out/onyourleft-instance-1.2.3.zip" ]; then bad 'and writes no zip'; else ok 'and writes no zip'; fi
done

# --- BUNDLE005 ---------------------------------------------------------------------

# #2857: the template shipped the project's own contact address, so every new
# server's /legal page told its riders to write to the maintainer.
contact_template() {
  new_fixture
  sed -i.bak "$1" "${tmp}/repo/apps/instance/deploy/home/instance.env.example"
  run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
}
refused_as_bundle005() {
  assert_exit "$1 is refused" 1
  assert_says 'as BUNDLE005' 'BUNDLE005'
  if [ -e "${tmp}/out/onyourleft-instance-1.2.3.zip" ]; then bad 'and writes no zip'; else ok 'and writes no zip'; fi
}

contact_template 's/^OYL_INSTANCE_CONTACT_EMAIL=$/OYL_INSTANCE_CONTACT_EMAIL=someone@openzigs.ai/'
refused_as_bundle005 'a template whose contact is an address at the project'"'"'s domain'

# Anybody's: whatever the template holds is what a new server publishes.
contact_template 's/^OYL_INSTANCE_CONTACT_EMAIL=$/OYL_INSTANCE_CONTACT_EMAIL=owner@club.example/'
refused_as_bundle005 'a template whose contact is any address at all'
assert_says 'naming the line that must be empty' "exactly one line 'OYL_INSTANCE_CONTACT_EMAIL='"

# No line to fill in: the operator would have nothing to type their own into.
contact_template '/^OYL_INSTANCE_CONTACT_EMAIL=$/d'
refused_as_bundle005 'a template with no contact line'

contact_template 's/^OYL_INSTANCE_CONTACT_EMAIL=$/OYL_INSTANCE_CONTACT_EMAIL=\
OYL_INSTANCE_CONTACT_EMAIL=/'
refused_as_bundle005 'a template with the contact line twice'

# In a comment, the line itself empty: it is still shipped to every new server.
contact_template 's/^OYL_INSTANCE_CONTACT_EMAIL=$/# Write to Someone@Sub.OpenZigs.ai.\
OYL_INSTANCE_CONTACT_EMAIL=/'
refused_as_bundle005 'a template that names an address under the project'"'"'s domain in a comment'
assert_says 'naming the file' 'in instance.env.example:'

# Any file of the bundle, not only the template.
new_fixture
printf '# questions to someone@openzigs.ai\n' >> "${tmp}/repo/apps/instance/deploy/home/compose.yaml"
run_bundle "${IMAGE}" 1.2.3 "${tmp}/out"
refused_as_bundle005 'a compose.yaml that names an address at the project'"'"'s domain'
assert_says 'naming the file' 'in compose.yaml:'

# The rule is the project's domain, not every `@`: an example address in a
# comment, and the image's own `@sha256:`, are not what it refuses.
contact_template 's/^OYL_INSTANCE_CONTACT_EMAIL=$/# For example you@club.example.\
OYL_INSTANCE_CONTACT_EMAIL=/'
assert_exit 'a template with an example address elsewhere in a comment still bundles' 0

# --- BUNDLE003 ---------------------------------------------------------------------

for wrong in '' '../escape' 'v1 2' '-rf'; do
  new_fixture
  run_bundle "${IMAGE}" "${wrong}" "${tmp}/out"
  assert_exit "a version that is not plain is refused: '${wrong}'" 1
done

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
