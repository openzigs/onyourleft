# What CI runs

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4c, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you touch `.github/workflows/`, add or move a gate, change a timeout or a Vitest case timeout, move something to the nightly job, or read a CI timing.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4c. What CI runs, and what it deliberately does not

[`.github/workflows/rules.yml`](../../.github/workflows/rules.yml) runs on every pull request and on every
push to `main`. It runs **exactly** the §4a commands and nothing else: `bash
scripts/run-concurrently.test.sh`, the eight bare-clone script
checks (`check-repo-rules`, `check-licence-hashes`, `check-env-example` and `check-doc-links`, each
with its own fixture suite), `shellcheck scripts/*.sh`, then `pnpm install --frozen-lockfile`, `format:check`, `lint`,
`typecheck`, `test:coverage`, `check:test-split` and its suite
`bash scripts/check-test-split.test.sh` (both since [#852](https://github.com/openzigs/onyourleft/issues/852); #852's
`test:uninstrumented` runs nightly since [#866](https://github.com/openzigs/onyourleft/issues/866) — below), `check:a11y-suite`,
`test:a11y`, `bash scripts/check-a11y-suite.test.sh`, `check:wiring`,
`bash scripts/check-wiring.test.sh`, `check:capacitor`,
`bash scripts/check-capacitor-generated.test.sh`, `check:cost-model`,
`bash scripts/check-cost-model.test.sh`, `bash scripts/coverage-summary.test.sh`, `build`,
`playwright install --with-deps chromium`, `test:browser`, `bash scripts/check-dependency-licences.test.sh`, `check:licences`,
`bash scripts/check-third-party-notices.test.sh`, `check:notices` and — since
[#771](https://github.com/openzigs/onyourleft/issues/771) — `bash scripts/check-instance-image.sh`, with its
suite `bash scripts/check-instance-image.test.sh` since [#841](https://github.com/openzigs/onyourleft/issues/841) — then
publishes the coverage table to the run summary and uploads the HTML report as an artefact.
Those last two carry `if: always()` and cannot fail the job: the run where coverage moved
unexpectedly is exactly the one whose table you want, and a reporting step that can fail a
build is a percentage floor arriving by the back door, which §5 forbids.

⚠️ **Since [#651](https://github.com/openzigs/onyourleft/issues/651) one step, `Checks,
concurrently`, runs twenty-six of those commands AT ONCE (twenty-two until #771 added the
instance image, twenty-three until #841 added its suite, twenty-four until #852 added
`check:test-split` and its suite), and a reviewer who remembers one step per
command is reading the old file.** It runs the eight bare-clone script checks, `shellcheck`,
`format:check`, `lint`, `typecheck`, `check:wiring`, `check:cost-model`, `check:licences`, `build`,
the browser install, the instance image, `check:test-split` and seven checker suites, after the install — the bare-clone checks need none
of it, but on their own before it they took 48 s with the runner otherwise idle. It goes through
`scripts/run-concurrently.sh` (§4a), which labels every line with its command, waits on each
process by itself and fails the step if **any** command failed — its own suite runs first, because
a runner that swallowed a failure would make that step twenty-six gates removed and still look
green, and #651's pull request proved it red on the runner with one formatting defect (run
36325105846: `format:check` FAILED, the other twelve then in that step finished, the job failed).
⚠️ **Anything that runs Vitest stays out of it**, and so do `check:capacitor` and `check:notices`,
which each run their own install under the tree the linter is walking: Vitest's 5 s case
timeout is already within a second of several cases on the slower runner, and beside other work
three of them passed it (run 36324592730) — `test:a11y` and `test:coverage` each run alone
(and `test:uninstrumented` did too, from #852 until #866 moved it to the nightly job). (`check:test-split` is in it: it runs `vitest list`, which
runs no case and so has no timeout to miss.) And
`test:coverage` and `test:browser` are **not** run together, though they are the two longest steps:
run 36323764725 did it and both went red, because each is CPU-bound on its own.

⚠️ **The instance ([#771](https://github.com/openzigs/onyourleft/issues/771)) is tested inside this
same job and adds no step of its own but one**, decided against the three constraints that bound
everything here — one required context, a budget already spent, and no gate that needs an account,
a secret or a service this project operates. ⚠️ **This used to read "no gate that needs a service
outside the runner", and that was never true** ([#841](https://github.com/openzigs/onyourleft/issues/841)):
the install reaches the npm registry, the browser install Playwright's CDN and Ubuntu's archives,
and the image check **Docker Hub**, on every run, because a runner starts with no base image. What
each of those can do is turn `main` red on a day the service is down. For Docker Hub:

- **Its pull-rate limit DID apply here, and since [#1231](https://github.com/openzigs/onyourleft/issues/1231)
  the job logs in.** GitHub's [Actions limits](https://docs.github.com/en/actions/reference/limits)
  page says *"GitHub-hosted runners pulling public images: Docker Hub's rate limit is not applied"*
  (read 2026-09-29, and the same words again on 2026-10-09), and the base image is public — but on
  2026-10-09 run 37994349506 on `main` failed in `instance image` with `toomanyrequests:
  unauthenticated pull rate limit`, and runs 37994374884 and 37995040607 with auth timeouts against
  `registry-1.docker.io` / `auth.docker.io`; re-runs about 20 minutes later passed. ⚠️ A reviewer
  who remembers "does not apply here" is reading the old file: the page's sentence is not what the
  runner observed. So, the owner's stop-gap of 2026-10-09, the step `Log in to Docker Hub` (below,
  §"exactly three steps") logs in with a read-only pull token before `Checks, concurrently`, which
  moves the limit from the runner's shared address to the account. It does **not** help an auth
  outage, which a logged-in pull goes through too, and a fork's pull request gets no secret and
  stays unauthenticated. #1231's GHCR mirror is still owed and is the fix for both.
- **An outage is named, not disguised.** The checker pulls the base image as its own step before it
  builds, so a registry that will not serve it fails as `IMG004`, saying it is Docker Hub and not
  `apps/instance` — a re-run, not a fix. Before #841 it failed as `IMG001`, *"the Dockerfile did not
  build"*.
- **Once the base image is held, the build does not ask the registry again — measured, not
  assumed** ([#852](https://github.com/openzigs/onyourleft/issues/852), 2026-09-29). In a
  `docker:29-dind` daemon (Docker Engine 29.8.1, its default image store) the pinned base was
  pulled, the daemon's network was then **disconnected** (a request to `registry-1.docker.io` from
  inside it failed to resolve), the build cache was pruned, and `docker build --no-cache` of
  `apps/instance` succeeded in about a second with `load metadata for …@sha256:…` answered locally.
  **Control**: the same disconnected daemon with the base image *not* held failed at exactly that
  step, `failed to do request: Head "https://registry-1.docker.io/v2/…"`. So after `IMG004`'s pull
  succeeds, a registry outage cannot surface as `IMG001`. ⚠️ Measured on 29.8.1 locally, not on the
  runner's own Docker; a different engine or builder driver could resolve differently.
- **The check stays in the required job, decided.** It is the only gate that the image builds and
  that `/source` names its commit (AGPL-3.0 §13), a second job could not block a merge, and it is
  exposed to one more registry than the job already was — the same trade as the install. Mirroring
  the base image to GHCR would move the dependency rather than remove it, and would add a push
  credential, which this job holds none of (its one secret, since #1231, is a read-only Docker Hub
  pull token). ⚠️ Since #1231's failures the owner prefers that mirror as the long-term fix, in a
  separate non-required workflow; the login is the stop-gap until it lands. Removing `'instance image'` from `Checks, concurrently`
  is a one-line revert if an outage ever outlasts the patience of the day.

| What | Where | Why |
|---|---|---|
| `apps/instance`'s unit and HTTP tests (the real listener on an ephemeral port) | the Vitest run, as one more project (`instance`) | no service, no second job; 51 cases in about 0.15 s locally at #767, 299 at #855 (the identity routes' files add about 1 s of case time on an idle machine — the count ages, read the run) |
| The Docker image, and `/health` inside the container | `Checks, concurrently`, as `instance image` | mostly a digest-pinned pull, so it waits rather than works — the step's shape |
| The OpenAPI drift check (#36) | the Vitest run (`src/openapi.test.ts`) | it is a byte comparison, not a tool |
| Rooms: the conformance suite (`src/room/conformance.test.ts`) against the reference, the Durable Object adapter under in-memory fakes and — since #780 — the Node adapter over real `ws` sockets on loopback | the Vitest run (`instance`) | #781, #780; a few seconds |
| Rooms: the Node adapter's router with real forked room workers, backpressure, the keepalive through a fake idle-closing proxy, and a SIGTERM mid-race through `node src/main.ts` | the Vitest run (`instance`) | #780, #791. ⚠️ These wait on real 1 Hz ticks and real processes — the instance's slowest files (`router.test.ts`, `room-host.test.ts`, `instance.test.ts`), about 45 s of case time locally |
| Rooms: the Durable Object adapter under a real `workerd` | **not CI** — `test:workerd`, a local command (§4a), decided by #781 | about 35 s, most of it waiting on the runtime's alarms and its ten-second eviction, which a job already past fifteen minutes on the 7763 cannot spend on every pull request; its logic runs in CI under the fakes. ⚠️ **The 35 s is a LOCAL figure** (34.6 s again on #781's review, on a Mac) — the suite has never run on the runner, so this decision rests on the local figure and #771's *"measure its cost on the runner before deciding"* is not met. ⚠️ The ~130 MB `workerd` binary is still downloaded by CI's install, and **that costs well under a second there** — measured for #864, §8 |
| Rooms: the two-browser e2e spec with its fan-out control | `test:browser`, the `chromium` project (`room.browser.spec.ts`, #782) | a real `startInstance` with one room worker in the spec's own process; about 9 s of case time and 3 s to start the instance, locally. Its control is a page with fan-out off, which must see nobody move |
| Rooms: made on a route, shared by code, joined, drawn and ridden (#784) | the same spec, a second case on an instance of its own (an address registers three riders an hour) | about 7 s of case time and 2 s to start its instance, locally. Its control is a page whose copy of the room's route is altered on the way in, which must be refused and draw nothing. ⚠️ **No two-browser RACE case**: a race with its 10 s countdown is about 25 s more, and §4f's all-hang arithmetic has 26 s of margin; the race is held at the jsdom shell (`rooms/rooms-shell.test.tsx`) and through the real instance, router and worker (`instance.test.ts` §"a rider's race") |
| A load test, and a Cloudflare bill | **not CI** (#792, #464) | a measurement and an account, not gates |

**What it cost, measured on the runner** — see the table directly below this paragraph, which
quotes run ids rather than estimates.

| | Run | CPU | Job | `Checks, concurrently` | Vitest with coverage | Browser gate |
|---|---|---|--:|--:|--:|--:|
| **Before**, `main` | [36576722522](https://github.com/openzigs/onyourleft/actions/runs/36576722522) | EPYC 7763 | 1231 s | 155 s | 386 s | 616 s |
| **Before**, `main` | [36569152175](https://github.com/openzigs/onyourleft/actions/runs/36569152175) | EPYC 7763 | 1221 s | | | |
| **Before**, `main` | [36563116178](https://github.com/openzigs/onyourleft/actions/runs/36563116178) | EPYC 7763 | 1206 s | | | |
| **Before**, `main` | [36574047878](https://github.com/openzigs/onyourleft/actions/runs/36574047878) | EPYC 9V74 | 985 s | 127 s | 300 s | 495 s |
| **Before**, `main` | [36559634387](https://github.com/openzigs/onyourleft/actions/runs/36559634387) | EPYC 9V74 | 970 s | | | |
| **After**, #833 | [36582905894](https://github.com/openzigs/onyourleft/actions/runs/36582905894) attempt 2 | EPYC 7763 | 1223 s | 158 s | 384 s | 605 s |
| **After**, #833 | [36582905894](https://github.com/openzigs/onyourleft/actions/runs/36582905894) attempt 1 | EPYC 9V74 | 1216 s | 154 s | 410 s | 581 s |
| **After**, #833 | [36588252465](https://github.com/openzigs/onyourleft/actions/runs/36588252465) | EPYC 9V74 | 994 s | | | |
| **After**, #833, `main` at #853 | [36615487288](https://github.com/openzigs/onyourleft/actions/runs/36615487288) | EPYC 7763 | 1276 s | 169 s | 417 s | 609 s |

⚠️ **This paragraph used to say "the delta is +4 s" on the 7763, and that was one run inside a 25 s
spread** ([#841](https://github.com/openzigs/onyourleft/issues/841)): **no measurable change, n = 1
on the 7763**, where #771 asked for two. The 1223 s run against a mean of 1219 s over three `main`
runs is inside the spread of `main` alone. The image check itself took about **10 s**
inside the concurrent step, which grew by 3 s. The instance's Vitest project is 51 cases in well under
a second. ⚠️ **A reviewer who remembers "n = 1 on the 7763" is reading the old file**: the second
7763 sample is the 36615487288 row above, found by #864, and what it does and does not say is the
paragraph after this one. **On the 9V74 it is +16 s** on the second sample (994 s against 985 s and 970 s on
`main`). ⚠️ The first 9V74 sample took 1216 s, and all of the extra time was in Vitest (+110 s) and
the browser gate (+86 s), neither of which this change touches. The second sample did not repeat it,
so it is recorded as runner variance, not as a cost. ⚠️ **The job was already past 15 minutes on the 7763 before this change** (1206–1231 s),
so #771's "if the delta pushes a green run past 15 minutes" was already true of `main`. This
change did not push it there, and moving something out of the job is #651's open question, not
this one's.

**#771's second 7763 sample, found for [#864](https://github.com/openzigs/onyourleft/issues/864).**
It had landed and nobody had read it: `main` at #853's merge,
[36615487288](https://github.com/openzigs/onyourleft/actions/runs/36615487288), the tree after #833
and #850 and before #852, printed `AMD EPYC 7763` and took **1276 s** (169 s concurrent, 417 s
Vitest with coverage, 609 s browser gate). So the 7763 after the instance is **n = 2: 1223 s and
1276 s**, against 1206–1231 s before. ⚠️ **That is not a +30 s cost of the instance**: five other
merges (#840, #843, #844, #850, #853) sit between the two samples, and #852's own "before" runs on
that same ancestry took 1256–1296 s on the 7763 — the growth is in Vitest and the browser gate, which
the instance does not touch, and its own step (the image check) is 10–15 s. Two later `main` runs on
the 7763, after #852, read the same way: [36636542091](https://github.com/openzigs/onyourleft/actions/runs/36636542091)
(#860, **1196 s**: 294 s coverage, 44 s outside it, 608 s browser gate) and
[36639122031](https://github.com/openzigs/onyourleft/actions/runs/36639122031) (#862, **1234 s**:
308 s, 45 s, 619 s). ⚠️ Every one of these CPU lines came from the racing-line test's print, which
not every run makes; the `Record the runner's CPU` step (below, §"exactly three steps") is what makes
it every run's.

**The runs since, read on 2026-09-29 for #841, and why they settle nothing about #771.** No second
`main` run after #833 has landed on a 7763 yet, so the 7763 comparison is still n = 1 — it is owed
by the next one, and its id goes in the table above. ⚠️ **That sample has since landed, and a
reviewer who remembers the 7763 comparison as owed is reading the old file**: it is
[36615487288](https://github.com/openzigs/onyourleft/actions/runs/36615487288), in the table above,
and §"#771's second 7763 sample" above says why it is n = 2 and still not a cost. What did land says the runner, not the change,
is the variable:

| | Run | CPU | Job | `Checks, concurrently` | Vitest with coverage | Browser gate |
|---|---|---|--:|--:|--:|--:|
| **Before** #833, `main` | [36585604660](https://github.com/openzigs/onyourleft/actions/runs/36585604660) | EPYC 9V74 | 977 s | 129 s | 297 s | 490 s |
| **Before** #833, `main` | [36588522202](https://github.com/openzigs/onyourleft/actions/runs/36588522202) | EPYC 7763 | 1230 s | 161 s | 391 s | 605 s |
| **Before** #833, `main` | [36595072185](https://github.com/openzigs/onyourleft/actions/runs/36595072185) | EPYC 9V45 | 738 s | 98 s | 213 s | 378 s |
| **After** #833, `main` | [36596941341](https://github.com/openzigs/onyourleft/actions/runs/36596941341) | EPYC 9V74 | 1206 s | 168 s | 379 s | 584 s |
| **After** #833 and #840, `main` | [36598959609](https://github.com/openzigs/onyourleft/actions/runs/36598959609) | EPYC 9V74 | 1228 s | 173 s | 393 s | 584 s |

The two post-#833 9V74 runs took 1206 s and 1228 s where the three before took 970–985 s — the
same 25 % the first 9V74 sample on #833's own pull request showed, and in the two steps it does not
touch; the image check itself took **12 s and 15 s** inside the concurrent step. So "EPYC 9V74" is
not one speed (the tag is the CPU model, not the VM's share of it), and one job can land anywhere
from 738 s to 1230 s. **Any before/after comparison of this job is n-per-CPU or it is noise.**

#### Where the time comes from next — owed before B9 and B12

⚠️ **The job is now 1206–1231 s of its 25-minute `timeout-minutes` on the slower runners — about
20.5 minutes, 82 % of the stop** — and every bundle still to come adds to it: rooms and their
conformance suite on Node and on `workerd` (#779–#781), and the two-browser room spec. A stop has to
be clear of what it stops (§4f's #423 reason), so this has to be answered **before** those land, not
by raising the stop again. The time is in two steps: Vitest with coverage (379–393 s) and the
browser gate (584–605 s). The candidates, in the order they cost least in what the job proves:

1. **Run the heaviest Vitest files outside coverage instrumentation — DONE by
   [#852](https://github.com/openzigs/onyourleft/issues/852), and it bought about one minute, not
   three.** `test:coverage` `--exclude`s the #545 near-field rides and the FIT decode fuzz, and
   `test:uninstrumented` runs them with no coverage in a step of its own (`Tests outside coverage`);
   `check:test-split` holds the two lists to the whole suite, once each. They still gate exactly as
   before; what the report lost is §5's to say. #651's ratio held — the pair took 28 s of test time
   uninstrumented against 82 s instrumented locally, and 57 s against about 307 s on the runners —
   but the saving is smaller than that ratio predicted, because the uninstrumented run is its own
   Vitest start-up and its wall time is the near-field file alone (43 s of a 45 s step: two files,
   two workers, one of them idle for most of it). Measured on the 7763, the runner #771 names:

   | | Run | CPU | Job | Vitest with coverage | Tests outside coverage | Both | Browser gate |
   |---|---|---|--:|--:|--:|--:|--:|
   | **Before** #852 | [36602099227](https://github.com/openzigs/onyourleft/actions/runs/36602099227) | EPYC 7763 | 1256 s | 399 s | | 399 s | 608 s |
   | **Before** #852 | [36610049975](https://github.com/openzigs/onyourleft/actions/runs/36610049975) | EPYC 7763 | 1257 s | 399 s | | 399 s | 610 s |
   | **Before** #852 | [36613423129](https://github.com/openzigs/onyourleft/actions/runs/36613423129) | EPYC 7763 | 1296 s | 416 s | | 416 s | 621 s |
   | **After** #852 | [36615071157](https://github.com/openzigs/onyourleft/actions/runs/36615071157) | EPYC 7763 | 1220 s | 297 s | 45 s | 342 s | 616 s |

   **The two Vitest steps went from 399–416 s to 342 s: about −63 s, n = 1 after.** The job went
   from 1256–1296 s to 1220 s, −50 s against the mean, inside what the browser gate alone varies
   by. The "before" rows are other branches' pull requests on the same tree ancestry (#842, #839),
   because no `main` run in that window printed its CPU; #850's own run
   ([36612643969](https://github.com/openzigs/onyourleft/actions/runs/36612643969), the tree this
   branch starts from) landed on a 9V74 at 1170 s with 376 s of coverage. **It did not free three
   minutes**, which is the threshold #852 set for reporting back: the rest has to come from option
   2 or from the browser gate, and both are the owner's. The next files by weight
   (`realistic-textures`, `GameView`, `racing-line`, `line-on-the-road`: about 100 s of test time
   under coverage on the 9V74) are slowed about 2× rather than 3× — measured locally, 29 s against
   14 s — so moving them too would buy perhaps 25 s more of wall time and lose four more files from
   the report.
   ⚠️ **#771's second `main` sample on the 7763 is still owed**: the one `main` run after #850's
   tree ([36615069379](https://github.com/openzigs/onyourleft/actions/runs/36615069379), 1150 s)
   printed no CPU. The CPU line in these logs is not the runner's: it is printed by one Vitest
   test (the racing-line timing), and only on some runs. ⚠️ **It is no longer owed, and a reviewer
   who remembers it as owed is reading the old file**: #864 found it in an earlier `main` run,
   [36615487288](https://github.com/openzigs/onyourleft/actions/runs/36615487288) (EPYC 7763,
   1276 s) — §"#771's second 7763 sample" above — and since #866 the `Record the runner's CPU`
   step prints every run's CPU.
2. **A second, non-required job for the heaviest gates — DONE by
   [#866](https://github.com/openzigs/onyourleft/issues/866), on the owner's ruling of 2026-09-29.**
   See §"The nightly job" below: what moved, what did not, and the trade.
3. **Not a larger runner**: §8 — always charged, even on a public repository.

#### The nightly job — #866

⚠️ **[`.github/workflows/nightly.yml`](../../.github/workflows/nightly.yml) — `Nightly heavy checks` — is
NOT a required check and cannot block a merge.** It runs at 03:17 UTC, on `workflow_dispatch`, and
on a pull request that changes that file (so a change to it is seen running before it merges). A
break in anything it runs is found **the next morning, not before the merge that caused it**: the
owner accepted that trade on 2026-09-29 for the checks below and **only** for checks that are not
safety gates. It must never be renamed `Repository rules` — the required context would then report
twice — and `nightly-split.test.ts` fails if it is.

| Moved out of `Repository rules` | Seconds it cost there (run 36634388848, EPYC 9V45) | Why it is not a safety gate |
|---|--:|---|
| `test:uninstrumented` — the #545 near-field rides and the FIT decode fuzz | 28 (its own step) | the near plane is drawing; the fuzz is a robustness sweep, and the decoder's named refusals (XXE, a bad CRC, the bounds) are unit tests that stay in `test:coverage` |
| `game.browser.spec.ts` §"the realistic world — ADR 0026" and §"#545" | 69 (the `?realistic` load) | the opt-in realistic world's look and cost; its one network claim, that the DEFAULT world fetches none of it, rests in the required job on `realistic-offered.test.ts` and `precache.test.ts` |
| `game.browser.spec.ts` §"the trees' levels of detail — #617" | 56 (the `?realistic&trees` load) | triangle and draw-call budgets in the realistic world |
| `realistic.browser.spec.ts` — the owner's instruments (#616) | 36 | a measuring tool for a page that ships in no build |
| `realistic-textures.test.ts` ([#1076](https://github.com/openzigs/onyourleft/issues/1076), the owner's ruling of 2026-10-03; in `test:uninstrumented`) | ~30 on the EPYC 7763 (run 37131982824) | the opt-in realistic world's KTX2 pipeline and dressed rider, #866's class |
| `reflow.browser.spec.ts` §"the dark palette — #672, nightly since #1076" ([#1076](https://github.com/openzigs/onyourleft/issues/1076), same ruling) | ~22 on the EPYC 7763 (run 37131982824) | the same layout walk as the light palette's, which STAYS required; the dark palette's colours stay required in `theme`, `links`, `button-hierarchy` and `controls-first` |
| `list-detail.browser.spec.ts` §"#941 — the drawings’ cost to each primary" ([#1137](https://github.com/openzigs/onyourleft/issues/1137), the owner's ruling of 2026-10-05) | 32.6 s of case time on the EPYC 7763 (run 37244296171) | layout: how far a primary moves under the cards' drawings. #941's `aria-hidden` drawing and 44 × 44 link stay required, as do `controls-first`'s fold and #670's primaries |
| `list-detail.browser.spec.ts` §"#1072 — a card carried into its detail" ([#1137](https://github.com/openzigs/onyourleft/issues/1137), same ruling) | 15.7 s of case time (same run) | motion: the carry and its by-address control. Its reduced-motion case stays required, and holds that a press with no preference carries as its control |
| `motion.browser.spec.ts` §"the route cross-fade — #945, how it runs" ([#1137](https://github.com/openzigs/onyourleft/issues/1137), same ruling) | 3.2 s of case time (same run) | the fade itself: one transition, its control, its duration. Of #945's 21.6 s only these are the fade alone; reduced motion, every ride-route case (safety), focus and a hanging transition stay required |
| `sections.browser.spec.ts` §"#1014 — a screen of sections uses a tablet’s width" and §"… read across, in rows" ([#1137](https://github.com/openzigs/onyourleft/issues/1137), same ruling) | 16.6 + 17.4 s of case time (same run) | layout: columns and row order on a tablet. #1014's detail panes, #1026's row balance, `controls-first`'s fold and `reflow`'s walks stay required |

**What stays required, whatever it costs**: anything that gates trainer control; privacy (no
network, no picture, masking, scoping, erasure); licences and notices; accessibility and layout;
and the wiring gate. ⚠️ **One exception, the owner's of 2026-10-03
([#1076](https://github.com/openzigs/onyourleft/issues/1076#issuecomment-5974417148))**:
`reflow.browser.spec.ts`' walk in the DARK palette is nightly. Layout stays required — the same
walk in the light palette, the one every rider starts in, is in `test:browser` — and the dark
palette's colours stay required in `theme`, `links`, `button-hierarchy` and `controls-first`; what
moved is the repeat of the layout walk in the second palette. ⚠️ **And four more, the owner's of
2026-10-05 ([#1137](https://github.com/openzigs/onyourleft/issues/1137))**, to bring the job 180 s
clear of its stop on the EPYC 7763: #941's card-shape margins, #1072's card carry, #945's
cross-fade and #1014's two-column sections — layout and motion of the DEFAULT world, the first
nightly checks that are not about the realistic world or a second palette. Where a describe held an
accessibility or safety half it was SPLIT and only the appearance half tagged: reduced motion (#945
and #1072), focus under a fade, every #945 ride-route case, #941's `aria-hidden` drawing and 44 × 44
link, #1014's detail panes and #1026's row balance stay required, and each `nightly.ts` entry names
the required test still holding its claim's other half. A reviewer who reads "accessibility
and layout" here as admitting no exception is reading it before those rulings, and any further one
is the owner's to make, not a tag added in passing. The browser half of the split is a Playwright **tag**: a describe carrying
`@nightly` runs in the `nightly` project and in neither `chromium` nor `game`, so every test is in
exactly one run by construction, and the tagged describes must equal the reviewed list in
`apps/web/browser/nightly.ts`, each with its seconds and its reason — adding a tag anywhere else is
a red `nightly-split.test.ts`, not a quiet move. `check:test-split`, still required, fails a Vitest
file in neither run.

**What it bought, on the runner, with the CPU each run printed** — n = 1 after, so read it as one
sample and not a figure:

| | Run | CPU | Job | Vitest with coverage | Tests outside coverage | Browser gate |
|---|---|---|--:|--:|--:|--:|
| **Before** #866 (after #852) | [36615071157](https://github.com/openzigs/onyourleft/actions/runs/36615071157) | EPYC 7763 | 1220 s | 297 s | 45 s | 616 s |
| **Before** #866, `main` | [36634388848](https://github.com/openzigs/onyourleft/actions/runs/36634388848) | EPYC 9V45 | 860 s | 199 s | 28 s | 431 s |
| **After** #866 | [36637978753](https://github.com/openzigs/onyourleft/actions/runs/36637978753) | EPYC 7763 | 887 s | 296 s | — | 338 s |

On the 7763 that is **−333 s** of job: 45 s of Vitest and 278 s of browser gate, the gate's four game
loads now two (the plain page 25 s, `?shadow-map` 39 s). The nightly run on the pull request that
made it took 281 s on an Intel Xeon 6973P-C
([36637979054](https://github.com/openzigs/onyourleft/actions/runs/36637979054)): 35 s of Vitest
and 201 s of browser checks.

**A red nightly run opens an issue titled `Nightly heavy checks failed`**, or comments on it while
it is open, from a second job whose token holds `issues: write` and nothing else and which checks
nothing out. Close the issue once a nightly run is green. The job that runs the checks is
read-only, pins its actions to the same SHAs as `rules.yml`, and runs on `ubuntu-latest`.

#### 23m39s of 25 — #1051

⚠️ **Four days after #866's 887 s the job was back at 1 400 s on the 7763**, and PR #1047's run
([37131982824](https://github.com/openzigs/onyourleft/actions/runs/37131982824)) took 1 419 s of its
1 500 s stop. Thirteen green `main` runs from 2026-10-02 22:09 to 2026-10-03 17:31 UTC, with the CPU
`Record the runner's CPU` printed for each (step seconds; the job is `started_at` to
`completed_at`):

| Run | CPU | Job | `Checks, concurrently` | Accessibility | Vitest with coverage | Browser gate |
|---|---|--:|--:|--:|--:|--:|
| [37070950955](https://github.com/openzigs/onyourleft/actions/runs/37070950955) | EPYC 7763 | 1424 | 220 | 49 | 458 | 656 |
| [37077843274](https://github.com/openzigs/onyourleft/actions/runs/37077843274) | EPYC 7763 | 1414 | 214 | 49 | 446 | 664 |
| [37079780914](https://github.com/openzigs/onyourleft/actions/runs/37079780914) | Xeon 6973P-C | 1015 | 141 | 31 | 308 | 501 |
| [37084931010](https://github.com/openzigs/onyourleft/actions/runs/37084931010) | EPYC 9V74 | 1140 | 171 | 36 | 346 | 551 |
| [37087015700](https://github.com/openzigs/onyourleft/actions/runs/37087015700) | EPYC 7763 | 1409 | 213 | 48 | 443 | 666 |
| [37120739683](https://github.com/openzigs/onyourleft/actions/runs/37120739683) | EPYC 7763 | 1411 | 212 | 49 | 442 | 669 |
| [37122320624](https://github.com/openzigs/onyourleft/actions/runs/37122320624) | EPYC 7763 | 1435 | 210 | 50 | 457 | 672 |
| [37126496645](https://github.com/openzigs/onyourleft/actions/runs/37126496645) | EPYC 9V45 | 928 | 138 | 28 | 260 | 467 |
| [37130959007](https://github.com/openzigs/onyourleft/actions/runs/37130959007) | EPYC 7763 | 1446 | 218 | 50 | 456 | 675 |
| [37131982824](https://github.com/openzigs/onyourleft/actions/runs/37131982824) (#1047's PR) | EPYC 7763 | 1419 | 216 | 49 | 445 | 669 |
| [37133519300](https://github.com/openzigs/onyourleft/actions/runs/37133519300) | EPYC 9V74 | 1415 | 218 | 48 | 436 | 670 |
| [37136194554](https://github.com/openzigs/onyourleft/actions/runs/37136194554) | EPYC 9V45 | 958 | 139 | 29 | 275 | 482 |
| [37140800605](https://github.com/openzigs/onyourleft/actions/runs/37140800605) | EPYC 9V74 | 1135 | 169 | 38 | 343 | 549 |

**Seven of the thirteen are at 1 409–1 446 s, 59 to 91 s from the stop** — every 7763 and one 9V74
(which is #841's "9V74 is not one speed" again). The 9V45 and the Xeon land at 928–1 015 s.

**What grew since #866's 887 s, on the same CPU** (the 7763; 36637978753 against 37131982824, both
logs read for this):

| Step | #866 | #1047 | Growth | Where it went |
|---|--:|--:|--:|---|
| Browser gate | 338 s | 669 s | +331 s | 902 → 1 213 tests. 311 new tests added 386 s of case time (`ride` +180: #940's chooser, #1011's tiles; new `sections`, `look`, `controls`, `confirm-dialog`, `room`). And the **887 tests both runs share got 1.49× slower** (513 → 767 s of case time): a harness load is about 0.45 s now where it was 0.27 s (`ride.browser.spec.ts`' overlay cases, 270 → 460 ms), the page now loading ~1.46 MB in ~73 requests. Two workers, so wall time is about half the case time |
| Vitest with coverage | 296 s | 445 s | +149 s | 546 → 656 files; summed test time 499 → 846 s. `instance` alone 15 → 167 s (subprocess and real-tick files: `instance.test.ts` 38.7 s, `operator/commands.test.ts` 19.6 s, `room/node/router.test.ts` 12.3 s, `tools/tunnel-soak.test.ts` 10.4 s), `web` 408 → 585 s (`realistic-textures` 32 → 59 s, new `billboards` 20 s, `instance/sync` 12.7 s, `analysis-safety` 2 → 11 s) |
| `Checks, concurrently` | 178 s | 216 s | +38 s | CPU-bound; `lint` is the long pole (178 → 216 s), `check-repo-rules` 128 → 154 s, its suite 161 → 190 s, `check-env-example` 76 → 95 s |
| Accessibility | 38 s | 49 s | +11 s | 46 → 50 files |

**What #1051 cut, keeping every check in the required job** (the owner's instruction of
2026-10-03: measure first; deduplicate and share, move nothing to nightly):

- **`check-repo-rules.sh` and `check-env-example.sh` fork far fewer processes.** Both are bash
  walks of ~2 000 files and spent their time starting `sed`, `grep`, `head` and `basename` per
  file, on a step whose 26 commands share two cores. `is_exempt` reads `.spdx-exempt` once (it
  re-read it for every source file), `spdx_of` is one `sed` (was three processes), REL001's
  name match is bash's own `[[ =~ ]]` (was `basename` and `grep`), the binary sniff lost its
  fourth process, and `check-env-example.sh` finds the files that mention `process.env` or
  `meta.env` with ONE `grep -l` over the whole list before running its per-file matchers — a
  superset of all three spellings by construction. Every finding is unchanged: both scripts were
  run old and new over this tree and over planted violations with identical output, and the
  fixture suites pass (`check-repo-rules.test.sh` gains a case that an exemption is the whole
  path, not a prefix or a suffix — the read-once match's two newlines, each mutation-tested).
  Locally: `check-repo-rules.sh` 38 → 22 s, `check-env-example.sh` 24 → 1.4 s.
- **The read-only cases of `ride.browser.spec.ts` and `rideview.browser.spec.ts` share one load**
  (`apps/web/browser/shared-load.ts`, #456's move made reusable): a case that only measures asks
  for its page by key and gets the one the previous case with that key loaded. Every control, and
  every case that changes the page, still loads its own. Locally the shared cases take 2–4 ms
  where each took a load: 93 cases in `ride` served by 13 loads, 34 in `rideview` by 9.
  ⚠️ **It is module state, not a worker-scoped fixture, and that is the lesson of #1075's first
  run** ([37155138130](https://github.com/openzigs/onyourleft/actions/runs/37155138130)):
  Playwright gives a file that declares a worker fixture of its own a worker group of its own, so
  the two specs were queued after every other `chromium` file, ran beside the `game` group that
  `playwright.config.ts` §`projects` queues last, and its `?shadow-map` load ran out of its 70 s.
  Anything added to a spec that changes its worker hash moves it in the queue.

**What it bought on the runner — n = 1 per CPU, so read it as a sample, not a figure.** On #1075's
first run, on an EPYC 7763
([37155138130](https://github.com/openzigs/onyourleft/actions/runs/37155138130), red in the browser
gate for the reason above), `Checks, concurrently` took **200 s against 210–220 s** on the seven
7763 runs above: `check-repo-rules` 154 → 104 s, its suite 190 → 154 s, `check-env-example` 95 →
6 s, `lint` (the long pole) 216 → 200 s. The green run
([37157396306](https://github.com/openzigs/onyourleft/actions/runs/37157396306)) landed on an
Intel Xeon Platinum 8573C, a CPU none of the thirteen used, at 1 277 s (165 s concurrent, 383 s
Vitest, 608 s browser gate, `ride` 198 s of case time against 253 s and `rideview` 65 s against
80 s on the 7763). **#1051 does not take the job back under 20 minutes on the 7763 by itself**:
the cuts that would are the table below, and every one of them is the owner's.

**What the measurement points at next, each OWED A RULING before it moves** (none moves in #1051;
seconds are the 7763's, from 37131982824):

| Candidate | Saves | Why it is not a safety gate — or why it stays |
|---|--:|---|
| Run the 50 `.a11y.test.` files ONCE: `test:coverage` stops running them and `test:a11y` stays the named gate (a dedup, not a move; needs `check:test-split` to know a third run, and the coverage report loses what only they execute, as #852 did) | ~43 s (86 s of case time under coverage, two workers) | accessibility stays required and blocking |
| `ride.browser.spec.ts` §"#940 — the notices are never hidden…" to nightly | ~42 s (84 s of case time) | a layout sweep of the pre-ride chooser; #940's own "Ride is on the screen" cases stay. ⚠️ It is the notices-never-obscured check, so it may count as a safety sentence — the owner's call |
| `realistic-textures.test.ts` to nightly (#866's realistic rule) | ~30 s (59 s summed) | the opt-in realistic world's KTX2 pipeline, the same class #866 moved for the browser |
| `reflow.browser.spec.ts`' dark-palette walks to nightly | ~22 s (45 s of its 89 s) | #672 put them back on purpose; the light walk stays |
| The `instance` subprocess files (`instance.test.ts`, `operator/commands.test.ts`, `tunnel-soak.test.ts`) to nightly, or a faster spawn | ~35 s (69 s summed) | `/source`, migrate-refusal and SIGTERM are AGPL §13 and data-safety claims — probably stays; a faster fixture is the better cut |
| `check-repo-rules.test.sh`' last case, "this repository passes its own rules" | one whole `check-repo-rules` run of CPU in the concurrent step (49 s of wall time there in 37131982824, under contention) | it re-runs exactly the `check-repo-rules` command beside it in the same step |

#### The owner's rulings, and what #1076 cut

[#1076](https://github.com/openzigs/onyourleft/issues/1076) carried the table above to the owner,
who ruled on 2026-10-03 ([the issue comment](https://github.com/openzigs/onyourleft/issues/1076#issuecomment-5974417148)).
A reviewer who reads the table above as still open is reading it before that day.

| Candidate | Ruling | What landed |
|---|---|---|
| The `.a11y.test.` files once | **approved** | `test:coverage` `--exclude`s `'**/*.a11y.test.*'` (single-quoted: the script goes through `sh`), and the `Accessibility` step is their only CI run. `check:test-split` knows a third run, `test:a11y`, and fails a file in no run or in two — an accessibility test outside `--project web` is in none, and goes red there. The coverage report no longer counts what only these files execute (§5) |
| #940's "notices are never hidden" chooser describe | **not approved — stays required** | nothing |
| `realistic-textures.test.ts` to nightly | **approved** | in `test:uninstrumented` and excluded from `test:coverage`; the nightly workflow runs it |
| `reflow.browser.spec.ts`' dark walks to nightly | **approved; the light walks stay required** | the walk is one function and two describes, `the light palette` and `the dark palette — #672, nightly since #1076`, the second tagged `@nightly` and listed in `browser/nightly.ts`. A third palette in `tokens.ts` §`THEMES` fails the spec at load |
| The `instance` process-starting files | **approved: faster, not moved** | measured first: a spawned `node src/main.ts` is `/ready` in about 0.4 s and a CLI call takes about 0.2 s locally, so start-up was not where the time went — real ticks and the room core's 10 s race countdown were. `startInstance` takes an optional `defaultCountdownMs` (unset in `serve.ts`, so a running instance still counts down ten seconds) and the race-by-code case in `instance.test.ts` runs a one-second countdown, asserting the `countdown` message's `startsInMs` so the option is seen to apply: 16.3 → 7.2 s locally. `router.test.ts`' dead-worker case opens its four rooms at once rather than waiting a tick for each: 5.5 → 2.2 s. `instance.test.ts` as a file: 33 → 20 s locally |
| `check-repo-rules.test.sh`' "this repository passes its own rules" | **approved** | removed; `check-repo-rules.sh` itself runs in the same step |

And the two follow-ups from #1075's review: `check-env-example.sh`'s prefilter carries `|| true`
(a no-match batch's exit 123 can no longer end a `set -e` walk; its suite runs the checker under
`bash -e` to hold it), and `shared-load.ts` attaches a screenshot of the page a failing shared case
read — the `page` fixture's own failure screenshot is of a page that case never touched.

**What it bought on the runner — n = 1, on the EPYC 7763 #1076 names**: PR #1077's run
([37162466197](https://github.com/openzigs/onyourleft/actions/runs/37162466197)) took **1 296 s,
204 s clear of the 1 500 s stop**, against 1 409–1 446 s on the seven 7763 `main` runs above.
`Checks, concurrently` 189 s (210–220 s before #1075, 200 s on #1075's own 7763 run), Accessibility
49 s (unchanged: it is now the only run of those files), Vitest with coverage **369 s** (436–458 s),
browser gate **645 s** (656–675 s). One sample: the runner's speed varies by more than a minute on
one CPU model (§4c above), so read it as one green job clear of the stop, not as a figure. The
nightly run on the same pull request, with the dark walk and `realistic-textures.test.ts` in it,
took 6m50s ([37162466198](https://github.com/openzigs/onyourleft/actions/runs/37162466198)).

**#1077's second sample on the 7763** ([#1078](https://github.com/openzigs/onyourleft/issues/1078)):
[37163632225](https://github.com/openzigs/onyourleft/actions/runs/37163632225), the same pull
request a commit later, printed `AMD EPYC 7763` and took **1 317 s, 183 s clear of the stop**
(`Checks, concurrently` 203 s, Accessibility 51 s, Vitest with coverage 373 s, browser gate 647 s).
So the 7763 after #1076 is **n = 2: 1 296 s and 1 317 s**, both green. ⚠️ **Read strictly, #1076's
criterion — "a green job at least 180 s clear of the stop" — is met by both, and the second by 3 s**:
the margin #1076 bought is about 180–200 s, not more, and a spec or step added to the job spends it
from there.

#### 23m50s of 25 — #1128

⚠️ **Two days after #1077's 1 296–1 317 s the job was at 1 430 s on the 7763**: PR #1125's run
([37244296171](https://github.com/openzigs/onyourleft/actions/runs/37244296171)) took 23m50s of its
25 minutes. Twelve green runs on the EPYC 7763 between #1077 and #1128, read from each run's
`Record the runner's CPU` step (step seconds; the job is `started_at` to `completed_at`):

| Run | CPU | Job | `Checks, concurrently` | Accessibility | Vitest with coverage | Browser gate |
|---|---|--:|--:|--:|--:|--:|
| [37176493041](https://github.com/openzigs/onyourleft/actions/runs/37176493041) | EPYC 7763 | 1385 | 198 | 52 | 379 | 716 |
| [37177623210](https://github.com/openzigs/onyourleft/actions/runs/37177623210) | EPYC 7763 | 1347 | 191 | 50 | 370 | 696 |
| [37211838052](https://github.com/openzigs/onyourleft/actions/runs/37211838052) | EPYC 7763 | 1350 | 187 | 51 | 371 | 700 |
| [37227357870](https://github.com/openzigs/onyourleft/actions/runs/37227357870) | EPYC 7763 | 1360 | 195 | 53 | 375 | 698 |
| [37227420467](https://github.com/openzigs/onyourleft/actions/runs/37227420467) | EPYC 7763 | 1346 | 188 | 51 | 370 | 698 |
| [37228081373](https://github.com/openzigs/onyourleft/actions/runs/37228081373) | EPYC 7763 | 1366 | 192 | 52 | 376 | 706 |
| [37228793888](https://github.com/openzigs/onyourleft/actions/runs/37228793888) | EPYC 7763 | 1380 | 194 | 52 | 378 | 713 |
| [37231658727](https://github.com/openzigs/onyourleft/actions/runs/37231658727) | EPYC 7763 | 1443 | 192 | 52 | 376 | 709 |
| [37231733576](https://github.com/openzigs/onyourleft/actions/runs/37231733576) | EPYC 7763 | 1379 | 190 | 51 | 385 | 711 |
| [37236523581](https://github.com/openzigs/onyourleft/actions/runs/37236523581) | EPYC 7763 | 1364 | 188 | 52 | 376 | 705 |
| [37240230931](https://github.com/openzigs/onyourleft/actions/runs/37240230931) | EPYC 7763 | 1385 | 196 | 53 | 380 | 716 |
| [37244296171](https://github.com/openzigs/onyourleft/actions/runs/37244296171) | EPYC 7763 | 1430 | 202 | 54 | 387 | 742 |

On the other CPUs the job took 887–978 s (EPYC 9V45), 1 065–1 371 s (EPYC 9V74) and 1 078–1 316 s
(Xeon 8573C). **The growth is the browser gate**, +50 to +95 s of step time against #1077's 645 s
and 647 s; Vitest, the concurrent step and Accessibility are flat. Playwright's summed case time
went from 1 103 s to 1 203–1 292 s: about 58 s of it new cases (#1091's card carry about 19 s,
#1074's motion spec about 22 s, #1079's Save-workout fold about 10 s, #1082's Home facts about
4.5 s, #1109's side camera about 1.4 s), and the rest the cases already there running about 10 %
slower, most of it in the `reflow.html` walks (`controls-first` +15 s, `ride` +12 s,
`list-detail` +10 s, `reflow` +8.5 s, `sections` +8 s, `links` +6.7 s, `look` +5.6 s) — likely,
not confirmed, #1074's `startTransition` navigation. ⚠️ **A `reflow.html` walk is mostly
waiting**: each route it visits waits at least `reflow-harness.tsx` §`QUIET_MS` (250 ms) of no DOM
change and two frames, about 36 routes a walk.

**What #1128 cut, keeping every check in the required job and moving nothing to nightly** (the
owner's plan of 2026-10-04):

- **One light phone walk for two specs.** `reflow.browser.spec.ts`' light walk at 390×844 and
  `controls-first.browser.spec.ts`' light phone walk opened the same page with the same query in
  the same palette, over both fixtures. `controls-first`'s walk now hands each route's one
  measurement to `browser/reflow-faults.ts` §`reflowFaults` as well as to #666's rules (its two
  cases are named `… and every route reflows (#660)`, and the #660 faults are reported with
  `expect.soft` beside #666's), and `reflow`'s light walk skips that viewport. The dark reflow walk
  (nightly) still walks all three. About 18 s of case time on the 7763.
- **Twenty-seven of `shell.browser.spec.ts`' read-only cases read a shared load**
  (`shared-load.ts`), keyed by page, viewport and palette, the load checking the page is that size
  and in that palette. Every case that scrolls, focuses, presses, strips a style, screenshots or
  reads a request still loads its own. Locally the spec went from 33.7 s to 28.3 s on one worker.
- **The `chromium` project runs on THREE workers, and the `game` project after it, alone** —
  `test:browser` is two Playwright runs in the one step, each with its own stop
  (`playwright.config.ts` §`CHROMIUM_PART_MS` 720 s, `GAME_PART_MS` 85 s), the game run starting
  whatever the first run's result (but not after a failed build) and the step failing if either
  did (`nightly-split.test.ts` holds the script to the constants). ⚠️ **The two stops summed to
  `GATE_BUDGET_MS`' 840 s until #1128's review, and a reviewer who remembers that is reading the old
  file**: 840 s did not fit inside the job (below), so the game's is 85 s, about 1.2 times its
  slowest green 71 s, the `chromium` run's is 720 s (690 s until a 7763 took 625 s), and the STEP
  has a bound of its own (§"What bounds the browser gate's step"). ⚠️ **A third worker for the whole
  gate was measured first and failed**: the game group started beside the last `chromium` specs and
  the plain and `?shadow-map` loads ran out of their 60 s and 70 s (run
  [37248143495](https://github.com/openzigs/onyourleft/actions/runs/37248143495), 7763, red).
  Alone, they load in 25 s and 41 s on the 7763, as before. Three workers make each case about
  22 % slower (summed case time 1 244 → 1 515 s) and the `chromium` run shorter (about 687 s on
  two workers to 594 s on three), because the third overlaps the walks' waiting.

| | Run | CPU | Job | `Checks, concurrently` | Accessibility | Vitest with coverage | Browser gate |
|---|---|---|--:|--:|--:|--:|--:|
| Three workers, whole gate | [37248143495](https://github.com/openzigs/onyourleft/actions/runs/37248143495) | EPYC 7763 | 1347, red | 198 | 53 | 381 | 672 |
| The two cuts, two workers | [37249637942](https://github.com/openzigs/onyourleft/actions/runs/37249637942) | EPYC 7763 | 1416 | 206 | 55 | 393 | 718 |
| The two cuts and the split | [37251288275](https://github.com/openzigs/onyourleft/actions/runs/37251288275) attempt 1 | EPYC 9V45 | 850 | 126 | 32 | 223 | 436 |
| | [37251288275](https://github.com/openzigs/onyourleft/actions/runs/37251288275) attempt 2 | EPYC 9V74 | 1074 | 153 | 40 | 302 | 542 |
| | [37254251351](https://github.com/openzigs/onyourleft/actions/runs/37254251351) attempt 1 | EPYC 9V74 | 1071 | 151 | 40 | 300 | 543 |
| | [37254251351](https://github.com/openzigs/onyourleft/actions/runs/37254251351) attempt 4 | EPYC 9V45 | 906 | 142 | 33 | 246 | 450 |
| | [37254251351](https://github.com/openzigs/onyourleft/actions/runs/37254251351) attempt 5 | EPYC 7763 | **1347** | 197 | 54 | 385 | **669** |
| The same, merged with `main` at #1129 | [37261811267](https://github.com/openzigs/onyourleft/actions/runs/37261811267) attempt 1 | EPYC 9V45 | 851 | 118 | 31 | 228 | 440 |
| | [37261811267](https://github.com/openzigs/onyourleft/actions/runs/37261811267) attempt 2 | EPYC 9V74 | 1076 | 156 | 40 | 304 | 537 |
| | [37261811267](https://github.com/openzigs/onyourleft/actions/runs/37261811267) attempt 3 | Xeon 8573C | 1237 | 175 | 48 | 335 | 638 |
| | [37261811267](https://github.com/openzigs/onyourleft/actions/runs/37261811267) attempt 5 | EPYC 7763 | **1301** | 187 | 52 | 374 | **647** |
| The same, at 034925f2 | [37269334621](https://github.com/openzigs/onyourleft/actions/runs/37269334621) attempt 1 | EPYC 9V45 | 823 | 115 | 30 | 221 | 424 |
| | [37269334621](https://github.com/openzigs/onyourleft/actions/runs/37269334621) attempt 2 | EPYC 7763 | **1362** | 195 | 53 | 382 | **672** |
| The same with the step bound, at 5b0d8618 | [37274106339](https://github.com/openzigs/onyourleft/actions/runs/37274106339) attempt 1 | Xeon 8573C | 1041 | 145 | 40 | 285 | 532 |
| | [37274106339](https://github.com/openzigs/onyourleft/actions/runs/37274106339) attempt 2 | EPYC 7763 | **1409** | 212 | 56 | 396 | **699** |
| The `chromium` stop at 720 s, d96ba0f2 | [37278024081](https://github.com/openzigs/onyourleft/actions/runs/37278024081) attempt 1 | EPYC 9V74 | 1296 | 188 | 50 | 367 | 651 |
| | [37278024081](https://github.com/openzigs/onyourleft/actions/runs/37278024081) attempt 2 | EPYC 7763 | **1337** | 198 | 54 | 381 | **660** |

**What it bought — n = 5 on the 7763, so samples and not a figure**: 1 347 s, 1 301 s, 1 362 s,
1 409 s and 1 337 s (median 1 347) against 1 346–1 443 s (median 1 373) on the twelve runs above,
the browser gate 669 s, 647 s, 672 s, 699 s and 660 s against 696–742 s. ⚠️ **#1128's "at least
180 s clear" is met by one of the five (199 s) and not by the other four (153 s, 138 s, 91 s and
163 s)**: the fourth ran on a
slow 7763 (its concurrent step 212 s and Vitest 396 s, both the slowest here, which this PR does not
touch), so read the gain as about 20–70 s of job, which a spec added to the gate spends again. The cuts
that would buy more are the owner's (the questions on PR #1131: `QUIET_MS`, and nightly
candidates). ⚠️ **Three failures on PR #1131's heads, none of them a check this PR changed**: the
`sections` case read About as fewer than two columns twice (37254251351 attempt 2, 37261811267
attempt 4), and once on two workers on another branch
([37247091721](https://github.com/openzigs/onyourleft/actions/runs/37247091721), 1 in about 86
runs), so three workers made it more frequent rather than caused it.
[#1132](https://github.com/openzigs/onyourleft/issues/1132) found the cause — React 19.3 holds a
transition's commit for About's unloaded logo, and the harness called the fallback settled — and
`reflow-harness.tsx` §`untilViewShown` now waits for the view. And
37254251351 attempt 3 was cancelled at 25 minutes with its browser gate unfinished, on a 9V45 —
the next section.

#### What bounds the browser gate's step — #1128's review

⚠️ **Run [37254251351](https://github.com/openzigs/onyourleft/actions/runs/37254251351) attempt 3
ran past both of the gate's own stops**: the step started 425 s into the job and was still running
at 25 minutes, where 690 + 150 s and the builds should have ended it by about 1 275 s. Its log
(`gh api …/jobs/111595373510/logs`) ends at 02:52:53, inside the Vitest step, **86 s before the gate
began** (02:54:19, from `…/attempts/3/jobs`), and the job's `completed_at` is 30 minutes after its
start, so the runner stopped sending its log and then took five minutes to answer the cancel. That
reads as the runner itself, not anything the step runs, and **no command inside a runner can bound
that** — but it is a reading, not a finding, and it was 1 in 14 attempts on three workers. What a
command CAN leave unbounded — either `vite build`, a `webServer` that never answers, a worker or a
browser that does not exit after a `--global-timeout`, the second run starting after the first
overran — is bounded since the review from OUTSIDE: the step runs
`timeout --verbose --kill-after=10s 765s pnpm run test:browser` (`playwright.config.ts`
§`GATE_STEP_MS`) with `timeout-minutes: 13` behind it, and `nightly-split.test.ts` holds the
workflow to both. GNU `timeout` signals its whole process group and says so
(`timeout: sending signal TERM to command ‘pnpm’`), then KILLs it; the step goes red, named, and
the coverage steps still run. ⚠️ **Measured locally, it does not take Playwright's two `vite
preview` servers with it**: Playwright starts them in a process group of their own, so they were
left running (their stdio were sockets to the dead runner, not the step's output, so the step still
ended in 60 s). On CI the runner removes them at the end of the job.

**The arithmetic, on the 7763.** The gate's step started **650 to 707 s** into the job on eight
runs (`gh api …/attempts/N/jobs`; 37261811267 attempt 5 at 650 s, `main`'s
[37250669777](https://github.com/openzigs/onyourleft/actions/runs/37250669777) at 707 s, the final
head's 37269334621 attempt 2 at 683 s, 37274106339 attempt 2 at 703 s, 37278024081 attempt 2 at 670 s), and the coverage publish, upload and post steps after it
took 4 s.

| | seconds |
|---|---|
| the latest start | 707 |
| the wrapper, 765 s, and its kill, 10 s | 775 |
| the coverage steps after it | 4 |
| **inside the job's 1 500** | **1 486** |

`timeout-minutes: 13` (780 s) ends it by 1 487 s plus the runner's own few seconds of cancelling.
⚠️ **765 s is only 1.09 times the slowest green step** (699 s, 37274106339 attempt 2) — short of the
1.15 every other stop here keeps, and nothing widens it inside 25 minutes, because the job leaves no
more: the room is the owner's cuts (PR #1131's questions), not a longer stop. Inside it,
`CHROMIUM_PART_MS` 720 s is 1.15 times the slowest green `chromium` run (625 s with its servers,
37274106339 attempt 2) and `GAME_PART_MS` 85 s about 1.2 times the slowest green game run (71 s);
with the two builds (10 s) they come to **815 s, 50 s more than the wrapper** — so a `chromium` run
that uses all of its 720 s leaves the game run 35 s, and the wrapper, not the game's stop, names
that. ⚠️ **Nothing re-checks the 14 s** but
`nightly-split.test.ts`, which holds 707 + 780 + 4 under the job's stop: a step added before the
gate, or a slower 7763, eats it first.

#### Four describes to nightly and `QUIET_MS` 100 ms — #1137

[#1137](https://github.com/openzigs/onyourleft/issues/1137) carried PR #1131's two questions to the
owner, who ruled on 2026-10-05: **lower `reflow-harness.tsx` §`QUIET_MS` from 250 ms to 100 ms**, to
be kept only if the flaky rate does not rise, and **move four layout and motion describes to
nightly** (§"The nightly job" above: #941's card-shape margins, #1072's card carry, #945's
cross-fade, #1014's two-column sections, each with its accessibility or safety half kept required).

**Flakiness, measured both ways.** Locally (a Mac, 12 cores, eight `yes` processes beside the run,
three workers, `--repeat-each 6`), `reflow`, `controls-first` and `sections` in the `chromium` and
`nightly` projects — 60 cases a repeat: at 100 ms **720 of 720 passed** over two runs (2 241 s and
1 996 s of case time, 12.8 and 11.5 min); at 250 ms **360 of 360 passed** (3 166 s, 18.4 min), and a
first 250 ms run that `GATE_BUDGET_MS`' 840 s stopped had passed its 185. No failure and no retry
either way (`retries: 0`). On the runner: eight attempts of PR #1138's run, **every case green on
every attempt** (no flaky failure). 100 ms took about 30–37 % off those three specs' case time
locally; on the 7763 the `reflow.html` specs' case time fell by about 140 s, of which the
moved describes are about 85 s. **`QUIET_MS` 100 ms is kept.**

| | Run | CPU | Job | `Checks, concurrently` | Accessibility | Vitest with coverage | Browser gate |
|---|---|---|--:|--:|--:|--:|--:|
| **Before**, `main` after #1131 | [37285410833](https://github.com/openzigs/onyourleft/actions/runs/37285410833) | EPYC 7763 | 1333 | 193 | 54 | 384 | 661 |
| **After**, PR #1138 at b6ae773 | [37288932952](https://github.com/openzigs/onyourleft/actions/runs/37288932952) attempt 1 | EPYC 9V45 | 929 | 149 | 34 | 249 | 462 |
| | attempt 2 | EPYC 7763 | **1329** | 196 | 54 | 391 | **646** |
| | attempt 3 | EPYC 7763 | **1301** | 195 | 53 | 384 | **626** |
| | attempt 4 | EPYC 7763 | **1302** | 192 | 54 | 384 | **630** |
| | attempt 5 | EPYC 7763 | **1308** | 195 | 53 | 382 | **631** |
| | attempt 6 | Xeon 6973P-C | 908 | 135 | 34 | 252 | 452 |
| | attempt 7 | Xeon 8573C | 1075 | 151 | 42 | 298 | 547 |
| | attempt 8 | EPYC 9V74 | 1281 | 185 | 50 | 367 | 631 |

**On the 7763, n = 4 after: 1 329, 1 301, 1 302 and 1 308 s** — 171, 199, 198 and 192 s clear of
the 1 500 s stop, the first short of #1137's 180 — with the browser gate
626–646 s against 647–699 s on #1131's five and 661 s on `main`. So #1137's criterion — a green job
180 s clear on the 7763 on at least three runs — is met by three of the four. ⚠️ **The gain is
smaller than the case seconds moved**: about 140 s of case time left the `chromium` run, and the
gate's step fell about 30 s. The `chromium` project runs each spec FILE in one worker (no
`fullyParallel`), so its wall time is set by how the files pack onto three workers, and the
largest files (`list-detail`, `controls-first`, `links`) decide the tail; the rest of the job
(the concurrent step, Accessibility and Vitest with coverage, about 630 s on the 7763) this does not
touch. The margin is therefore about 180–200 s and no more, as #1076's was: a spec or step added to
the job spends it from there.

⚠️ **The runner is two cores, not four, and that is what bounds all of this.** `ubuntu-latest`
reports four vCPUs, and `lscpu` on it reads `Thread(s) per core: 2`, `Core(s) per socket: 2` (run
36333257690, an AMD EPYC 7763). So a fourth Vitest worker made the suite no faster — 336 s to
334 s — while its summed test time rose from 676 s to 807 s and one case passed its timeout, and
Playwright kept its default of two workers until #1128, which measured a third for the `chromium`
project alone (§"23m50s of 25 — #1128" above): the Vitest half is CPU-bound, but a
browser-gate case that walks `reflow.html` mostly waits for the DOM to go quiet, and a third worker
overlaps that waiting. Otherwise the job is CPU-bound from end to end: running more
things at once moves time around, and only doing less work removes it. #651 measured what the
browser gate's game loads spent their time on and removed the probes each load ran for nobody
(§4f); it split the near-field rides into files of their own and started the heaviest Vitest files
first, measured no gain (346 s against 336 s — the suite is not waiting on a tail), and reverted
both.

If CI ever needs a step this file does not list, **this
file is wrong and gets fixed in the same PR**; CI must not accumulate private knowledge, because
that is how a contributor's local green becomes CI's red with no explanation.

⚠️ **There are exactly three steps that are not §4a commands** (two until #1231), and since #1128's review one §4a
command is run under a wrapper: `Browser gate` is `timeout --verbose --kill-after=10s 765s pnpm run
test:browser`, for the reason §"What bounds the browser gate's step" gives — locally the command is
the same without it. The first, since #866, is `Record
the runner's CPU` — `lscpu`, filtered to the model and the core count — because two CPU models at
different speeds serve `ubuntu-latest` and a duration means nothing without it (#864); it gates
nothing. The second is this one:
`sudo rm -f /etc/apt/sources.list.d/google-chrome.*`, before the browser install — which since
#651 means before `Checks, concurrently`, the step the browser install runs in.
It is recorded here rather than left as private CI knowledge, which is what the paragraph above
forbids. `playwright install --with-deps` runs `apt-get update` across **every** source the runner
image configures, and the image configures Google's own Chrome apt repository for the Chrome it
ships. On 2026-09-09 that repository served a `Release` file regenerated at 17:16 UTC beside a
`Packages.gz` last modified at 09:41; apt refused the mismatch (`Hash Sum mismatch`), the install
exited 100, and it failed **byte-identically on a re-run** rather than settling. Nothing in this
repository uses that source: the browser is the one the lockfile pins, fetched from Playwright's
own CDN, and `--with-deps` takes its shared libraries from Ubuntu's archives. Removing it
therefore makes CI trust **less** than it did, which is why it is a safe answer to an outage and
not a workaround with a cost. It is a no-op the day Google's index is consistent again, and
deleting the step is a one-line revert if the trade is ever judged wrong.

The third, since [#1231](https://github.com/openzigs/onyourleft/issues/1231), is `Log in to Docker
Hub`, just before `Checks, concurrently` (whose `instance image` pulls the base image), with a
`Log out of Docker Hub` at the end of the job (`if: always()`, `|| true`, so it cannot fail it). It
reads the repository secret `DOCKERHUB_TOKEN` — a read-only *Public Repo Read-only* token, and **the
only secret this job holds** — and the repository **variable** `DOCKERHUB_USERNAME`, a variable on
purpose because Actions redacts a secret's value everywhere in a log (#338). The token goes to
`docker login --password-stdin` and is never printed. Present and wrong, the login fails the step;
absent — a fork's pull request, which GitHub gives no secret — the step says so and passes, and the
pull is unauthenticated. Why: three `instance image` failures on 2026-10-09 (above, §"Its pull-rate
limit DID apply here"). Credentials fix the rate limit, not an auth outage. ⚠️ On a same-repository
pull request or `main` the credential sits in the runner's Docker config while later steps run that
branch's code; it can pull public images and nothing else. Deleting both steps is the revert once
the GHCR mirror lands.

> ⚠️ **The workflow's `name:` and its job's `name:` are both `Repository rules`, and `main` requires
> a status check whose context is exactly that string.** Rename either and the required check never
> reports, which makes every subsequent pull request unmergeable — including the one doing the
> renaming. Extend the existing job; do not add a second job for a new gate, because a second job
> reports under a different context and its failure would not block a merge.

**The browser gate (#63) is in that same job, and it is the step that most looks like it wants its
own.** It installs a ~170 MB Chromium and then runs for about three seconds, which is exactly the
shape a separate job exists for — and it stays here anyway, because a second job reports under a
different context and could not block a merge. A gate that cannot block is not a gate. The job's
`timeout-minutes` moved from 10 to 15 to give the download room; that number is a stop on a hung
job, not a budget. ⚠️ **It is 20 since
[#423](https://github.com/openzigs/onyourleft/issues/423), and a reviewer who remembers 15 is reading
the old file.** A stop has to be clear of the thing it stops: main was taking 9 to 13 minutes, and the
first run of #423's pull request ran for **14m19s** with nothing hung — 41 seconds from being killed. The
browser gate is what grew (6.8 minutes on main, 8.0 with the ride-stage and Ride-screen specs).
⚠️ **It is 25 since [#682](https://github.com/openzigs/onyourleft/issues/682), and a reviewer who
remembers 20 is reading the old file.** Thirteen green runs on `main` on 2026-09-28 (36370135206 to
36405580515, job `started_at` to `completed_at`, which excludes queueing) took **699 s to 1 128 s**,
in two clusters — 699–888 s and 1 005–1 128 s — and the slower one is an AMD EPYC 7763, two cores
of two threads: no `main` run prints its CPU, but #651's `lscpu` read it so and so did a temporary
step on #682's own pull request, for a 1 113 s job (run 36412215912). The slowest, 36405580515, was
**18m48s — 72 s from twenty minutes**. Run 36396660625's 28 minutes of wall clock was 11m36s of
waiting for the concurrency group before its job was created and a 16m45s job. Twenty-five leaves a
green job 372 s clear and pays for the browser gate's own stop to grow with it (below); it is still
a stop and not a budget.
⚠️ **Since [#456](https://github.com/openzigs/onyourleft/issues/456) the cases in
`game.browser.spec.ts` share ONE load of their harness, and a reviewer who remembers "every case
reloads a harness that takes ten seconds" is reading the old file.** They did reload it, and that was
the whole critical path: 43 cases at 9.1 s each, run in one worker, came to 6.0 to 7.3 minutes of a
browser gate that took 271 to 449 s, in a job that ran 8m40s to 13m44s on `main`. The harness does
all of its work in one `run()` and publishes one object, so a worker-scoped fixture now loads it
once per query (`''`, `?shadow-map`, `?realistic` and `?realistic&trees`) and every case reads that result, with every assertion
unchanged. On #456's pull request that made the game spec 32 s, the browser gate 88 s and the job
**7m44s**. The browser gate's slowest spec is now `ride.browser.spec.ts` at about 45 s of case time,
and the job's largest step is Vitest with coverage at about 150 s. ⚠️ **What this does NOT change**:
a failing case makes Playwright replace its worker, so the case after it loads the page again. A red
run costs more than a green one (49 s against 13 s locally, with nine cases red). A new case that
reads the shared result costs almost nothing. A new case that drives its own page still costs a
load, so add it to the harness's one run where the claim allows.
⚠️ **Since [#607](https://github.com/openzigs/onyourleft/issues/607) the `?realistic` load is paid
in a `beforeAll` with a 150 s budget of its own** (`game.browser.spec.ts`
§`paysForTheRealisticLoad`), and a reviewer who remembers it timed against the first case's 60 s is
reading the old file. It took 33 to 48 s on green CI runs and over 60 s on two red ones, and each red
case replaced the worker, so every later realistic case reloaded and timed out in turn until the job
was cancelled at 20 minutes. A failed `beforeAll` marks the rest of its describe "did not run"
instead, which was measured both ways round. A new case that needs a slow load of its own takes the
same shape rather than a longer global `timeout`.
⚠️ **Since [#644](https://github.com/openzigs/onyourleft/issues/644) #617's three tree cases read a
load of their own, `game.html?realistic&trees`, under the same hook and budget, and a reviewer who
remembers them reading `?realistic` is reading the old file.** #617 put their probes inside the
shared realistic run and took it from 33–48 s to **182 s** on the runner — 117.7 s of it the trees —
past its 150 s, which turned `main` red. Their own load also asserts the realistic world drew
(`trees.drawnWorld`), which the shared load had asserted for them. Every phase of a harness run is
printed as it ends (`game-harness.ts` §`phaseEnds`) and never asserted; read those lines before
raising a budget.
⚠️ **Since [#651](https://github.com/openzigs/onyourleft/issues/651) every load has a budget of
its own, every describe pays for the load it reads, the game spec runs LAST, and the whole gate
has a `globalTimeout`** — a reviewer who remembers the plain page and `?shadow-map` loaded inside a
case's 60 s, or "at most three budgets, inside the job's twenty", is reading the old file. That
sentence counted the budgets and not the job, and was false. The budgets are 50 s for the plain
page, 65 s for `?shadow-map`, 120 s for `?realistic` and 120 s for `?realistic&trees` — each at least
1.5 times what its load took alone on the slower runner — and a cross-worker ledger
(`game.browser.spec.ts` §`loadLedger`) makes a hung load cost ONE of them per run, with every other
describe that reads it failing at once in its hook and naming the describe that paid. The
arithmetic that fits all four hanging inside the gate's own 580 s (`playwright.config.ts`
§`GATE_BUDGET_MS`), and the gate inside the job's twenty, is `game.browser.spec.ts`
§`paysForTheRealisticLoad`, with the local run that demonstrated it. ⚠️ **Those figures are
#651's and are the old file since [#682](https://github.com/openzigs/onyourleft/issues/682).** A
day later green loads on the slower runner reached 39 s, 45 s, 111 s and 105 s — 78 %, 69 %, 93 %
and 88 % of their budgets — and a green gate took 547 s of its 580 (run 36405580515), so the budgets
are **60 s, 70 s, 165 s and 160 s** and the gate's stop **840 s**, each about 1.5 times the slowest
green figure. If every game load hangs, and `realistic.browser.spec.ts`' page with them:

| | seconds |
|---|---|
| the four budgets, 60 + 70 + 165 + 160 | 455 |
| 21 describes failing, each replacing the worker, and the two servers starting (#651's figure) | 30 |
| the rest of the gate before the game spec's first load, slowest green (36395959573, 36405580515) | 245 |
| `realistic.browser.spec.ts`' instruments case waiting its own 150 s where green took at most 66 s | 84 |
| **inside the gate's 840** | **814** |

and the gate's step starts at most 592 s into the job and builds for 9 s (36395959573), so 840 s
ends it by **1 441 s — 59 s inside the job's 1 500**, with only the coverage publish and upload after
it. ⚠️ **That was #682's arithmetic and it is false now, and a reviewer who remembers it is reading
the old file**: by #1128 the step started 650 to 707 s in on the 7763, so 707 + 10 + 840 s is
**1 557 s, 57 s past the job's stop**, and the table above is the NIGHTLY run's worst case, not the
required gate's. What bounds the required step since #1128's review is §"What bounds the browser
gate's step — #1128's review". ⚠️ **Nothing re-checks either margin** (26 s and 59 s): a spec added to the gate eats the first
and a step added before it eats the second. Before #682 the second was **19 s** once the 9 s build
the old sum left out is counted (592 + 9 + 580 against 1 200). ⚠️ **That 84 s assumes the
instruments case's FIRST load is the one that hangs**, and until #736's review nothing here said so. If the first load is green and its control load hangs instead, the case takes
about 180 s where green took 66 s — **114 s**, and the column sums to **844 s, 4 s past the gate's
840**. The table keeps 84 because the linear sum over-counts: that spec runs on the `chromium`
project in one of the two workers, so while it waits the other worker carries on through the
remaining specs and then takes the game group (`playwright.config.ts` §`projects`: nothing waits for
`chromium` to finish), and its wait overlaps the rest of the gate and the game loads rather than
adding to them in a line. ⚠️ **That overlap is reasoned, not measured**: no run has hung every game
load and that control load together, and if one did and the overlap were smaller than 4 s, the gate
would stop itself at 840 s with the last game describe interrupted — still inside the job, still
naming what was running. ⚠️ **A Vitest hang is bounded by nothing short of the job's own stop**, and
a sentence #736 first wrote here said it ended the step by about 892 s — a reviewer who remembers
that is reading this pull request's first draft. Vitest cannot stop a synchronous case:
`@vitest/runner` 4.1.11's `withTimeout` arms a timer that cannot fire while the case holds the
thread, and otherwise compares the elapsed time only once the case RETURNS. The #545 near-field
rides and the FIT fuzz arm are both synchronous, so a genuine hang in the Vitest step runs until the
job's 1 500 s cancel, which names nothing. The per-case timeouts turn a slow-down red, not a hang —
and even a slow-down is not bounded by one of them: the nine near-field rides run one after another
in one file, so a cull that slows every ride can cost up to 9 × 230 s = 2 070 s before the last goes
red. That is not new with #682: 9 × 120 s after a start about 222 s in already overran twenty
minutes. ⚠️ And the two default loads
no longer run the same probes: each case reads one load's copy, so each load runs only what its
own cases read (`game-harness.ts` §`SHADOW_MAP_LOAD`) — measured on the runner, that was 12.6 s of
the plain page's 34 and about 16 s of `?shadow-map`'s 55 spent for nobody. A new case on either
load reads a field the OTHER load no longer measures at its "nothing measured" value, which fails
rather than passes; move the probe, do not read across.
⚠️ **What #651 bought, and what it did not.** It asked for a green job of 12 minutes or less. On
`main` before it, green runs took 1005 s, 1009 s and 1039 s on an AMD EPYC 7763 runner and 723 s on
a faster runner whose CPU no run printed; on #651's pull request, on the 7763, 933 s (run 36337270885): 141 s of
concurrent checks, 28 s of `test:a11y`, 347 s of Vitest with coverage and 390 s of browser gate.
**It is not twelve minutes on that runner, and what is left to cut is a gate or its instrumentation**:
removing or weakening a gate, or running the heaviest files outside coverage — and coverage is
reported, not gated (§5), so that last one would change what the report says rather than what
fails. #651 did none of them. The
job is CPU-bound on two cores (above), Vitest with coverage alone is 347 s of the 933, and its two
largest files — the #545 near-field rides at 216 s and the FIT fuzz at 99 s — are slowed about
three times by coverage's instrumentation of their hot loops (2.8 times for the rides, measured as
CPU time locally; 3.3 times for the fuzz, `decode-fuzz.test.ts`'s own measurement). Which runner a job lands
on is not something this repository can choose without paying for a larger one, which §8 forbids.

⚠️ **A Vitest case's timeout is judged against its time under coverage ON CI, and since
[#682](https://github.com/openzigs/onyourleft/issues/682) no case runs above half of it.** The
measurement needs nothing added: Vitest's default reporter prints, beneath its file, every case
slower than 300 ms, so every job log already holds per-case times for the `Tests and coverage
report` step. Read over thirteen green `main` runs on 2026-09-28 (36370135206 to 36405580515),
eighteen cases ran at 45 % or more of their timeout (#682 asks for 50 %; the five points are
margin on one day's sample), fifteen of them on Vitest's default 5 s — the slowest,
`no-network.test.ts`' MediaPipe scan, at **4.8 s, 96 %** — and #682's own cull sweep, given 15 s by
#651, had fallen to 38 %. Seventeen of them now carry an explicit timeout of about three times their
slowest CI figure, with the figures and the run ids beside it; none of them is a
performance claim, and none of their assertions or inputs changed. The #545 near-field rides went
from 120 s to 230 s (75.2 s, 63 %) and the FIT fuzz from 180 s to 300 s (96.6 s, 54 %). A new case
that is slow under coverage takes the same shape: measure it in a CI log, write the numbers beside
it, never trim what it sweeps. ⚠️ **One in-test timing bound is also near its line and is NOT
changed here**: `racing-line.test.ts`' 1 000 km solve asserts under 30 s and took 12.2 s to 27.2 s
on the same runs (36374954481), which is an assertion rather than a timeout and so is its own
issue, [#734](https://github.com/openzigs/onyourleft/issues/734). ⚠️ **Since #734 that case asserts no
seconds at all**, and a reviewer who remembers "under 30 s" is reading the old file: it times a
1 000 km solve against a 100 km solve of the same road in the same process and holds the RATIO
under 25 (linear is 10), so the runner and coverage's counters divide out, and the solve itself is
about a third cheaper under coverage, to the bit (`racing-line.test.ts` §"its cost").

⚠️ **The browser is pinned by the lockfile, not by the install command.** `@playwright/test`
**1.63.0** ships Chromium revision **1243**, and `playwright install chromium` fetches whatever the
installed Playwright names. Bumping Playwright therefore changes the browser under the gate, which
is a thing to do deliberately and to re-run the gate after — the same posture as the fixture-corpus
generator in `packages/fit`. ⚠️ **These two numbers move together and are the reason this bump is
not a routine one.** #206 took 1.56.0 → 1.63.0, which took Chromium **1194 (141.0.7390.37) → 1243
(153.0.8010.12)** — twelve major browser versions in one version bump, read from each release's own
`browsers.json` rather than from the changelog. The gate was re-run on the new browser before that
merge and stayed green. A future bump updates this paragraph in the same pull request; a Dependabot
bump that leaves it saying 1.56.0 is the drift §4c forbids.

It runs on `ubuntu-latest`, holds `permissions: contents: read`, and pins `actions/checkout` and
`actions/setup-node` to full commit SHAs with the `gh api` command that produced each in a comment.
All of that is §8 rules rather than preference. Node comes from `.nvmrc` and pnpm from
`packageManager` via corepack, so the runner cannot drift from a contributor. There is deliberately
**no dependency cache**: it would mean another action to pin and a writable cache in every job's
dependency path, to save seconds on a workspace this size.

**This pipeline has been proved to go red**, which is the whole of what
[#24](https://github.com/openzigs/onyourleft/issues/24) was for. #100 did it for the bare-clone
script rules; the toolchain steps were demonstrated on 2026-09-07 in a throwaway pull request
(#180, closed unmerged) carrying one defect per commit, each chosen to pass every earlier step so
the failure lands on the step under test:

| Defect | Failed at | Run |
|---|---|---|
| a floating promise (`tsc` allows it, `@typescript-eslint/no-floating-promises` does not) | **Lint** | [34116473625](https://github.com/openzigs/onyourleft/actions/runs/34116473625) |
| a `string` assigned to a `number` (type-aware ESLint passes it — assignment compatibility is `tsc`'s job) | **Typecheck** | [34116588471](https://github.com/openzigs/onyourleft/actions/runs/34116588471) |
| an assertion that is simply false | **Tests and coverage report** | [34116723271](https://github.com/openzigs/onyourleft/actions/runs/34116723271) |

Two things that demonstration settled beyond the criterion. The coverage steps **ran anyway** in
the two failing runs, reported the missing report, and did **not** fail the job — §4c's `if:
always()` design, observed rather than asserted. And a defect that trips an *earlier* step proves
nothing about a later one, which is why each was verified locally against every preceding step
before being pushed.

**The coverage report is real, and that is a separate claim from any threshold.** Measured the
same day on `main`: the suite reports 6408/6616 statements (96.85%); removing
`apps/web/src/transfer/export-activity.test.ts` and re-running moves that file from 54/54 to
50/54 and the total to 6404/6616 (96.79%). It drops by four rather than to zero because
`TransferView.test.tsx` exercises the same code — which is the more useful half of the result:
coverage is attributed to what actually executes, not to a filename that looks related.

⚠️ **#24's own wording for this asks for something §5 forbids.** The criterion reads *"the
coverage gate is enforced and demonstrated to fail below threshold"*, and it **predates §5 and
does not govern**: §5 bans a percentage floor outright, and §4b reframes what is owed as the
demonstration above. Read §5, not that criterion.

⚠️ **`rules.yml` is not the only workflow, and this section used to read as though it were.**
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) — **`Android release`** — arrived
with [#207](https://github.com/openzigs/onyourleft/pull/207) and is described here because §4c's own
rule is that CI must not accumulate knowledge this file does not carry.

| | |
|---|---|
| Triggers | a pushed tag matching `v*`, and `workflow_dispatch` |
| Job | `Build and publish the APK` |
| What it does | decodes an upload key **if this repository has one**, assembles, **verifies the packaged APK**, uploads it as a workflow artefact, publishes a GitHub Release on a tag, and removes the key before anything else runs |
| Permissions | ⚠️ `contents: write` — **the only workflow here that is not read-only**, because writing a Release needs it |

⚠️ **It has run, and this paragraph used to say it never had** — a reviewer who remembers "treat
every claim about its behaviour as untested" is reading the old file.
[#95](https://github.com/openzigs/onyourleft/issues/95) exercised it: two `workflow_dispatch` runs on
2026-09-16 assembled a **signed release APK** on a GitHub-hosted runner
([35160018484](https://github.com/openzigs/onyourleft/actions/runs/35160018484),
[35162828363](https://github.com/openzigs/onyourleft/actions/runs/35162828363)), and the three
`ANDROID_*` **secrets** are set. ⚠️ **This paragraph used to say "the four `ANDROID_*` secrets"
are set, and a reviewer who remembers that is reading the old file.**
`ANDROID_KEY_ALIAS` is not one of them since
[#338](https://github.com/openzigs/onyourleft/issues/338): Actions redacts every occurrence of a
secret's **value**, and this one is the word `upload`, which rendered the pinned
`actions/upload-artifact` as `actions/***-artifact` — taking an action's own name out of the audit
trail §8 pins it for. The workflow reads `vars.ANDROID_KEY_ALIAS` instead. ⚠️ **The variable IS
set and the secret IS deleted — both on 2026-09-17 — and a reviewer who remembers "that variable
is NOT set yet and the secret is NOT deleted yet, so the next release run fails at the signing
step" is reading the old file** (corrected 2026-09-30 by #955, read with `gh variable list`,
`gh secret list` and `gh run list --workflow release.yml`). The variable was set at 09:05:22 UTC.
The dispatch run straight after
([35203263648](https://github.com/openzigs/onyourleft/actions/runs/35203263648)) failed at
*Assemble* — the keystore then held no key under the alias the variable names — and after
`ANDROID_KEYSTORE_BASE64` was set again at 10:56:12 the next one
([35213089600](https://github.com/openzigs/onyourleft/actions/runs/35213089600), `main`,
`workflow_dispatch`) signed, verified *"Signed as required, targeting API 36."*, and printed the
same certificate digest as 2026-09-16's run, with no `***` in the signing step's name or in
`actions/upload-artifact`. ⚠️ **That the variable alone would not have been enough is NOT
measured** — that the runner masks every secret in the job's map whether the workflow reads it or
not is read off GitHub's documented behaviour. Both changes were made before any run read them, so
the variable-set, secret-present half never ran, and a reviewer who remembers this paragraph saying
"both halves were needed" as a finding is reading #955's first draft.
[`apps/mobile/RELEASE.md`](../../apps/mobile/RELEASE.md) §9 is why and §10 holds the results.
⚠️ **It has still never run on a tag**, so the GitHub Release step alone is untested, and no phone
has installed the result —
[`apps/mobile/RELEASE.md`](../../apps/mobile/RELEASE.md) §1 is the table of which is which.

⚠️ **A green `assembleRelease` is not a signed APK, and until #95 nothing here noticed the
difference.** Injected signing properties AGP ignores produce `app-release-unsigned.apk` and a
successful build, which `fail_on_unmatched_files` accepted — so a tag would have published an
uninstallable artefact with every step green. The `Verify the artefact` step reads the packaged file
with `apksigner` and `aapt2` instead: signed, not the Android debug certificate, and targeting at
least the same API level `REL002` names. It was demonstrated to go red by deleting the injected
properties on a throwaway branch
([35163073011](https://github.com/openzigs/onyourleft/actions/runs/35163073011), `DOES NOT VERIFY`).
⚠️ And a **tag** with no `ANDROID_KEYSTORE_BASE64` now fails rather than falling through to
`assembleDebug`: the fork-friendly fallback is right for a manual run and wrong for the one path
that publishes.

⚠️ **It is not a required check and cannot block a merge**, which is right for a tag-triggered job
and is also why its action pins drifted behind `rules.yml`'s without anything noticing —
`actions/checkout` sat on v5.0.0 there while `rules.yml` was on v7.0.1. Each pin carries the
`gh api …/commits/<tag> --jq .sha` line that produced it, and **a bump must move the comment with
the SHA**: a Dependabot bump changes only the pin, which leaves the comment naming a different
commit than the one running.

Repository-level security scanning — CodeQL default setup, secret scanning with push protection, and
Dependabot alerts and security updates — is **already enabled on the repository** and needs no
workflow step. Adding one would duplicate it.
