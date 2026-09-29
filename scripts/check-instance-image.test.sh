#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Tests for scripts/check-instance-image.sh -- #841.
#
# Each case copies the checker into a throwaway git repository beside a
# Dockerfile, and runs it with a fake `docker`, `curl` and `sleep` first on
# PATH -- the way check-third-party-notices.test.sh substitutes `pnpm`. The
# checker has no test-only seam: it finds the fakes exactly as it finds the
# real tools, so every rule under test is the committed one. No Docker is
# needed, and nothing waits: the fake `sleep` returns at once, so the 30 s
# health deadline costs nothing.
#
# The fake `docker` answers from files a case writes under ${tmp}/fake/, and
# appends every call it receives to ${tmp}/fake/calls, so a case can say what
# the checker ASKED as well as what it concluded.
#
# Needs only bash, coreutils and git, so it could run on a bare clone; it is
# not in `check:repo` because the checker it tests is not either.
#
# Run: bash scripts/check-instance-image.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="${SCRIPT_DIR}/check-instance-image.sh"

pass=0
fail=0
tmp=""
out=""
code=0
commit=""

cleanup() { [ -n "${tmp}" ] && rm -rf "${tmp}"; }
trap cleanup EXIT

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() {
  fail=$((fail + 1))
  printf 'FAIL %s\n' "$1"
  printf '%s\n' "${out}" | sed 's/^/     | /'
}

PINNED='node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6'

# new_fixture -- a repository holding the checker and a Dockerfile, and fakes
# that, left alone, answer the way a healthy image does.
new_fixture() {
  cleanup
  tmp="$(mktemp -d)"
  mkdir -p "${tmp}/repo/scripts" "${tmp}/repo/apps/instance" "${tmp}/bin" "${tmp}/fake"
  cp "${CHECK}" "${tmp}/repo/scripts/check-instance-image.sh"
  printf 'FROM %s\nCMD ["node", "src/main.ts"]\n' "${PINNED}" > "${tmp}/repo/apps/instance/Dockerfile"
  git -C "${tmp}/repo" init --quiet
  git -C "${tmp}/repo" add -A
  git -C "${tmp}/repo" -c user.name=t -c user.email=t@example.invalid commit --quiet -m fixture
  commit="$(git -C "${tmp}/repo" rev-parse HEAD)"

  # The image's HEALTHCHECK as `docker inspect` renders it: every argument
  # after the first ("CMD"), one per line.
  printf 'node\n-e\nfetch('"'"'http://127.0.0.1:8787/health'"'"').then(() => process.exit(0))\n' \
    > "${tmp}/fake/healthcheck"
  printf '0\n' > "${tmp}/fake/image-present"  # 0: not held locally, so it is pulled
  printf '0\n' > "${tmp}/fake/pull"
  printf '0\n' > "${tmp}/fake/build"
  printf '0\n' > "${tmp}/fake/run"
  printf '1\n' > "${tmp}/fake/healthy-after"   # the probe answers on this attempt; 0 = never
  printf 'true\n' > "${tmp}/fake/running"
  printf '0\n' > "${tmp}/fake/curl"
  printf '{"url":"https://github.com/openzigs/onyourleft/tree/%s"}' "${commit}" > "${tmp}/fake/source"
  : > "${tmp}/fake/calls"
  printf '0\n' > "${tmp}/fake/exec-count"

  cat > "${tmp}/bin/docker" <<'FAKE'
#!/usr/bin/env bash
fake="${OYL_FAKE_DIR}"
printf 'docker %s\n' "$*" >> "${fake}/calls"
case "$1" in
  image)
    case "$2" in
      inspect) [ "$(cat "${fake}/image-present")" = 1 ] ;;
      rm) exit 0 ;;
    esac ;;
  pull) exit "$(cat "${fake}/pull")" ;;
  build) exit "$(cat "${fake}/build")" ;;
  run)
    code="$(cat "${fake}/run")"
    [ "${code}" = 0 ] && : > "${fake}/started"
    exit "${code}" ;;
  inspect)
    case "$*" in
      *Healthcheck*) cat "${fake}/healthcheck" ;;
      *State.Running*) cat "${fake}/running" ;;
      *) [ -f "${fake}/started" ] ;;
    esac ;;
  exec)
    count=$(( $(cat "${fake}/exec-count") + 1 ))
    printf '%s\n' "${count}" > "${fake}/exec-count"
    after="$(cat "${fake}/healthy-after")"
    [ "${after}" != 0 ] && [ "${count}" -ge "${after}" ] ;;
  port) printf '127.0.0.1:49999\n' ;;
  logs) printf 'the container log line\n' ;;
  rm) exit 0 ;;
  *) printf 'fake docker: unexpected %s\n' "$*" >&2; exit 99 ;;
esac
FAKE
  cat > "${tmp}/bin/curl" <<'FAKE'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "${OYL_FAKE_DIR}/calls"
code="$(cat "${OYL_FAKE_DIR}/curl")"
[ "${code}" = 0 ] && cat "${OYL_FAKE_DIR}/source"
exit "${code}"
FAKE
  printf '#!/usr/bin/env bash\nexit 0\n' > "${tmp}/bin/sleep"
  chmod +x "${tmp}/bin/docker" "${tmp}/bin/curl" "${tmp}/bin/sleep"
}

set_fake() { printf '%s\n' "$2" > "${tmp}/fake/$1"; }

run_check() {
  out="$(OYL_FAKE_DIR="${tmp}/fake" PATH="${tmp}/bin:${PATH}" bash "${tmp}/repo/scripts/check-instance-image.sh" 2>&1)"
  code=$?
}

assert_exit() {
  if [ "${code}" -eq "$2" ]; then ok "$1"; else bad "$1 (exit ${code}, wanted $2)"; fi
}
assert_says() {
  if grep -qF -- "$2" <<< "${out}"; then ok "$1"; else bad "$1 (no '$2')"; fi
}
assert_asked() {
  if grep -qF -- "$2" "${tmp}/fake/calls"; then ok "$1"; else bad "$1 (never asked '$2')"; fi
}
assert_not_asked() {
  if grep -qF -- "$2" "${tmp}/fake/calls"; then bad "$1 (asked '$2')"; else ok "$1"; fi
}

# --- Green, and what it asked on the way -----------------------------------------

new_fixture
run_check
assert_exit 'a healthy image that names its commit passes' 0
assert_says 'and says which commit' "/source names ${commit}"
assert_asked 'builds with the commit the tree is at' "--build-arg OYL_INSTANCE_COMMIT=${commit}"
assert_asked 'pulls the base image it read out of the Dockerfile' "docker pull --quiet ${PINNED}"
assert_asked 'runs the image'"'"'s OWN healthcheck, not a probe of its own' \
  "docker exec onyourleft-instance-check-"
execs="$(grep -F 'docker exec' "${tmp}/fake/calls")"
if grep -qF "node -e fetch('http://127.0.0.1:8787/health')" <<< "${execs}"; then
  ok 'the probe is the HEALTHCHECK command, argument for argument'
else
  bad 'the probe is the HEALTHCHECK command, argument for argument'
fi
assert_asked 'asks /source through the published port' 'http://127.0.0.1:49999/source'
assert_asked 'removes the container' 'docker rm -f onyourleft-instance-check-'
assert_asked 'removes the image' 'docker image rm -f onyourleft-instance:check-'

new_fixture
set_fake image-present 1
run_check
assert_exit 'a base image already held passes' 0
assert_not_asked 'and is not pulled again, so a developer needs no network' 'docker pull'

new_fixture
set_fake healthy-after 5
run_check
assert_exit 'a container that becomes healthy on the fifth probe passes' 0

# --- IMG001 ------------------------------------------------------------------------

new_fixture
set_fake build 1
run_check
assert_exit 'an image that does not build fails' 1
assert_says 'as IMG001' 'IMG001 apps/instance/Dockerfile did not build.'
assert_asked 'and still removes what it made' 'docker image rm -f onyourleft-instance:check-'

# --- IMG002 ------------------------------------------------------------------------

new_fixture
set_fake run 1
run_check
assert_exit 'a container that does not start fails' 1
assert_says 'as IMG002' 'IMG002 the container did not start.'

new_fixture
printf 'curl\n-f\nhttp://127.0.0.1:8787/\n' > "${tmp}/fake/healthcheck"
run_check
assert_exit 'a HEALTHCHECK that does not ask /health fails' 1
assert_says 'as IMG002, naming what it asks' "IMG002 the image's HEALTHCHECK does not fetch /health: curl -f http://127.0.0.1:8787/"

new_fixture
: > "${tmp}/fake/healthcheck"
run_check
assert_exit 'an image with no HEALTHCHECK fails' 1
assert_says 'as IMG002, saying there is none' "IMG002 the image's HEALTHCHECK does not fetch /health: (none)"

new_fixture
set_fake healthy-after 0
run_check
assert_exit 'a container that never answers /health fails' 1
assert_says 'as IMG002, with the deadline' 'IMG002 /health did not answer inside the container within 30 s.'
if [ "$(cat "${tmp}/fake/exec-count")" = 30 ]; then ok 'after asking once a second for the whole deadline'; else bad "after asking once a second for the whole deadline (asked $(cat "${tmp}/fake/exec-count"))"; fi
assert_says 'and prints what the container said' 'the container log line'

new_fixture
set_fake healthy-after 0
set_fake running false
run_check
assert_exit 'a container that exits before /health answers fails' 1
assert_says 'as IMG002, at once' 'IMG002 the container exited before /health answered.'
if [ "$(cat "${tmp}/fake/exec-count")" = 1 ]; then ok 'without waiting out the deadline'; else bad 'without waiting out the deadline'; fi

# --- IMG003 ------------------------------------------------------------------------

new_fixture
set_fake curl 7
run_check
assert_exit '/source that does not answer fails' 1
assert_says 'as IMG003' 'IMG003 /source did not answer through the published port.'

new_fixture
printf '{"url":"https://github.com/openzigs/onyourleft/tree/main"}' > "${tmp}/fake/source"
run_check
assert_exit '/source naming main rather than the commit fails' 1
assert_says 'as IMG003, with the commit it wanted' "IMG003 /source does not name ${commit}"

new_fixture
printf '{"url":"https://github.com/someone-else/onyourleft/tree/%s"}' "${commit}" > "${tmp}/fake/source"
run_check
assert_exit '/source naming the commit in another repository fails' 1
assert_says 'as IMG003' 'IMG003 /source does not name'

# --- IMG004 ------------------------------------------------------------------------

new_fixture
set_fake pull 1
run_check
assert_exit 'a base image Docker Hub will not serve fails' 1
assert_says 'as IMG004, naming Docker Hub rather than the Dockerfile' 'IMG004 the base image'
assert_says 'and saying it is not this tree' 'not a defect in apps/instance'
assert_not_asked 'without trying to build' 'docker build'

# --- IMG005 ------------------------------------------------------------------------

new_fixture
printf 'FROM node:24.21.0-bookworm-slim\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a base image pinned by tag alone fails' 1
assert_says 'as IMG005, naming it' 'IMG005 apps/instance/Dockerfile'"'"'s base image is not pinned by digest: node:24.21.0-bookworm-slim'
assert_not_asked 'without pulling a mutable tag' 'docker pull'

new_fixture
printf '# no base image\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a Dockerfile with no FROM fails' 1
assert_says 'as IMG005, saying so' 'IMG005 apps/instance/Dockerfile'"'"'s base image is not pinned by digest: (no FROM line)'

# Every FROM, in every spelling Docker reads (#852). The check used to read the
# first line starting `FROM`, so each of these passed it.
OTHER='node:24.21.0-alpine@sha256:1111111111111111111111111111111111111111111111111111111111111111'

new_fixture
printf 'FROM %s AS build\nFROM node:24-bookworm-slim\n' "${PINNED}" > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a second stage built from a tag fails' 1
assert_says 'as IMG005, naming the second base' 'not pinned by digest: node:24-bookworm-slim'

new_fixture
printf 'from node:24-bookworm-slim\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a lowercase from with a tag fails' 1
assert_says 'as IMG005, naming it' 'not pinned by digest: node:24-bookworm-slim'

new_fixture
printf '  FROM --platform=linux/amd64 node:24-bookworm-slim AS run\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'an indented FROM with --platform and a tag fails' 1
assert_says 'as IMG005, naming the image rather than the option' 'not pinned by digest: node:24-bookworm-slim'

new_fixture
printf 'FROM node AS node\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a stage named like its unpinned image fails' 1
assert_says 'as IMG005, reading the image and not the alias' 'not pinned by digest: node'

new_fixture
printf 'FROM\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a FROM with no image fails' 1
assert_says 'as IMG005, saying so' 'not pinned by digest: (a FROM line with no image)'

new_fixture
# The literal $BUILDPLATFORM is the Dockerfile's, not this shell's.
# shellcheck disable=SC2016
printf 'FROM --platform=$BUILDPLATFORM %s AS Build\nfrom %s as test\nFROM build AS run\nFROM scratch\nFROM TEST\n' \
  "${PINNED}" "${OTHER}" > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'every FROM pinned, with stage references and scratch, passes' 0
assert_asked 'pulls the first base' "docker pull --quiet ${PINNED}"
assert_asked 'and the second' "docker pull --quiet ${OTHER}"
assert_not_asked 'and not a stage by its name' 'docker pull --quiet build'
assert_not_asked 'nor scratch' 'docker pull --quiet scratch'

new_fixture
printf 'FROM scratch\n' > "${tmp}/repo/apps/instance/Dockerfile"
run_check
assert_exit 'a Dockerfile built only from scratch pulls nothing and passes' 0
assert_not_asked 'and pulls nothing' 'docker pull'

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
[ "${fail}" -eq 0 ]
