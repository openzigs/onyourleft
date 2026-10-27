# Releasing the Android app

[#95](https://github.com/openzigs/onyourleft/issues/95). Read [§1](#1-what-has-and-has-not-been-done) before trusting anything else here.

## 1. What has and has **not** been done

⚠️ **This table used to open "nothing in this document has been executed", and a
reader who remembers that sentence is reading the old file.** The pipeline has
been run; the account has not been registered and no phone has installed
anything. Those are different kinds of outstanding and the table says which is
which.

| Piece | State |
| --- | --- |
| `REL001` — no committed key material | **Enforced and tested.** `scripts/check-repo-rules.sh`, six fixtures, runs on every pull request |
| `REL002` — target API floor | **Enforced and tested.** Eleven fixtures. ⚠️ Since #95 it reads **every** Gradle file under `android/`, not `variables.gradle` alone — §7 says what it used to miss |
| `.github/workflows/release.yml` | **Run, and green.** Two `workflow_dispatch` runs on 2026-09-16 assembled a **signed release APK** on a GitHub-hosted runner — [35160018484](https://github.com/openzigs/onyourleft/actions/runs/35160018484) and, with the verification step below, [35162828363](https://github.com/openzigs/onyourleft/actions/runs/35162828363) — and a third on 2026-09-17, after §10's alias migration, did the same on `main`: [35213089600](https://github.com/openzigs/onyourleft/actions/runs/35213089600). ⚠️ **Never run on a tag**: there is no `v*` tag and no GitHub Release (`gh run list --workflow release.yml`, read 2026-09-30: every run is a `workflow_dispatch`) |
| The signing key | **In CI secrets, and used.** Nothing about the key is in this repository, which is `REL001`'s whole job |
| The key alias | **A repository VARIABLE, set, and the secret deleted** — both on 2026-09-17. `release.yml` stopped reading `secrets.ANDROID_KEY_ALIAS` in [#338](https://github.com/openzigs/onyourleft/issues/338) — a secret's value is redacted from every log line that contains it and that one was the word `upload`. A `workflow_dispatch` run on `main` after the change, [35213089600](https://github.com/openzigs/onyourleft/actions/runs/35213089600), signed and verified with the same certificate as before. ⚠️ **This row used to say the variable was "not set yet" and that "the next release run fails"; a reader who remembers that is reading the old file** (corrected 2026-09-30, #955). §9 is why, §10 is the procedure and its results |
| The App Bundle (`.aab`) Play needs | **Built, signed with the upload key, verified, and kept as the `android-aab` workflow artefact** ([#958](https://github.com/openzigs/onyourleft/issues/958)). Never uploaded to Play from CI, and never a GitHub Release asset. §11 |
| The Play account decision | **Taken, 2026-09-30**: an **organization** account under Zylos Labs LLC, D-U-N-S verified, so the 12-tester closed test does not apply. §3. The app entry in Play Console is not created yet; §11 lists what the owner enters |
| A published privacy policy | **Written and linked.** [`docs/privacy-policy.md`](../../docs/privacy-policy.md), reachable from the app's About page. §4 |
| The Health apps declaration | **Not filed.** It is a Play Console form and needs an account, which is §3 |
| The Data Safety form | **Answered, not filed.** The answers are `src/android/data-safety.ts` and the "no location" one is asserted against the merged manifest. §4 |
| A signed build installed on a device | **Not done.** This is #95's definition of done and it is outstanding. §8 says how to get the APK now that a dispatch run keeps one |

docs/agents/commands.md §4a's rule — that a documented command nobody has run is the most
expensive kind of wrong — is why that table is first rather than last.

## 2. Why the key scan is a repository rule rather than a CI step

`REL001` is the one rule in `check-repo-rules.sh` whose violation **cannot be
undone by fixing it**. A pushed commit is permanent regardless of what a later
commit deletes, and an Android upload key is not rotatable: Play identifies the
app by the key, so a leaked one is a leaked app identity, not a leaked secret.

GitHub's secret scanning with push protection is on for this repository and would
catch some of these. It runs server-side, when a push is attempted. `REL001` runs
on a bare clone with no toolchain, before that — and it has a content half as
well as a name half, because a private key pasted into a file called `config.yml`
has no telling name at all.

## 3. The Play account — an owner decision, with a deadline attached

Google Play, verbatim from `support.google.com/googleplay/android-developer/answer/14151465`:

> _"If you have a newly created personal developer account, you must run a closed
> test for your app with a minimum of 12 testers who have been opted-in for at
> least the last 14 days continuously."_

Testers who opt in, test for under 14 days and opt out **do not count**, and the
14 days must be consecutive. For a pre-release open-source project, finding 12
people to hold an install for two unbroken weeks is a scheduling hazard rather
than a formality.

**Organization accounts, D-U-N-S verified, are exempt.** The project is already
under the `openzigs` GitHub organization, so registering the Play account as an
organization sidesteps it — but D-U-N-S verification itself takes time, which is
why #95 was filed now rather than at release.

Re-checked **2026-09-16**, and nothing has moved: the rule still applies to
personal accounts created on or after 2023-11-13, the tester minimum is still 12
(reduced from 20 in December 2024), and an organization account verified against
a legal entity is still exempt.

⚠️ **This decision has not been taken and cannot be taken from here.** #95's
third criterion is that either the org account is registered _or_ this file
records the fallback **with named testers**. Neither has happened, and no code
change can make either happen — it needs somebody with a card and a company
number. Whoever takes it writes the outcome and the date below this line.

<!-- The Play account decision goes here: what was registered, by whom, on what
     date. If it is a personal account, the twelve testers go here by name with
     the date each opted in, because the 14 days are consecutive and a list
     nobody wrote down is a list that restarts. -->

**Taken on 2026-09-30, by the owner** (recorded from
[#958](https://github.com/openzigs/onyourleft/issues/958)): a Google Play
developer account registered as an **organization**, Zylos Labs LLC, verified
with a D-U-N-S number. The closed-test rule above is for new **personal**
accounts, so it does not apply and no tester list is needed. ⚠️ The paragraph
above saying the decision "has not been taken" is the old state, kept because
this section's history is the reason the account is an organization one.

## 4. Health policy, the privacy policy, and the Data Safety form

Play's Health Content and Services policy covers apps that are _not primarily_
health apps:

> _"If your app is not primarily a health app, but has health-related features
> and accesses health data, it is still in scope of the Health App policy… (for
> example… games apps that collect a user's activity data as a way to advance
> game play)."_

That example is this app: heart rate and power are health data and they advance
gameplay.

**The privacy policy exists**, at [`docs/privacy-policy.md`](../../docs/privacy-policy.md).
⚠️ Play requires an app in scope of the health policy to carry the policy link
**inside the app** as well as in the store listing, and requires the two to be
the same URL. `apps/web/src/privacy/policy.ts` is the single place that URL is
written down; the About page renders it and `AboutView.test.tsx` fails if it
stops matching. The URL to paste into Play Console is `PRIVACY_POLICY_URL` from
that file, not one typed out by hand.

**The Data Safety answers are `src/android/data-safety.ts`**, written down as
data rather than left in a screenshot of a console — a form nobody can read from
the repository is a form nobody can review. Most rows are "not collected", which
is a statement about the product: there is no server (owner decision D6) and no
analytics. ⚠️ **"No outbound request in the client at all" stopped being true
with [#534](https://github.com/openzigs/onyourleft/issues/534)**: a ride's map
requests tiles from `tiles.openzigs.com` by default (a rider can turn that off in
Settings). ⚠️ **Since [#558](https://github.com/openzigs/onyourleft/issues/558)
the approximate-location row is "collected"**, and a reviewer who remembers it
resting on Play's ephemeral-processing exemption is reading the old file:
Cloudflare's standard HTTP analytics keep each tile request's IP address, time
and user agent where this project's account can see them for up to 7 days, which
is not ephemeral. They do **not** keep which tile: the basemap is one PMTiles
file, the tile is picked by a `Range` header the dataset has no field for, and
every request's path is the same — which is why the row is approximate and the
precise row is not collected. §8 has a step that re-checks both before every
tag.

**The form's two section-level answers are filed too**, and are in the same file
as `DATA_SAFETY_SECTION_ANSWERS`
([#562](https://github.com/openzigs/onyourleft/issues/562)); the owner decided
both on 2026-09-30 and enters them in Play Console:

- **Is all of the user data collected by your app encrypted in transit? Yes**,
  with one exception the form cannot carry: a picture or a ride's numbers sent
  to a computer on the rider's own network can travel over plain `http://`. The
  privacy policy discloses it, and `sectionAnswerFaults` fails if any other path
  can be plain `http:` without being named as an exception (`DATA_PATHS`, each
  held to the address rule in `apps/web` that decides it).
- **Do you provide a way for users to request that their data is deleted? Yes**:
  by email to `DELETION_REQUEST_EMAIL` (matt@openzigs.ai), named in the privacy
  policy, until in-app deletion on an instance
  ([#906](https://github.com/openzigs/onyourleft/issues/906)) ships. ⚠️ Play's
  separate **account-deletion** requirement — a web link as well as an in-app
  path, for an app that lets a rider create an account — is #906's, not this.

#95's fifth criterion asks a reviewer to confirm the **merged** manifest supports
the "no location collection" claim — since #558, the claim that the app does
not read the **device's** location (the precise-location row). That is now done
twice over:

- [#318](https://github.com/openzigs/onyourleft/issues/318) established what the
  merged manifest carries and reviewed each entry, and
- `data-safety.test.ts` runs `locationClaimFaults` over that merged manifest, so
  an injected or unbounded location permission is a red test rather than a
  review nobody repeats. The bound is the whole safety: `ACCESS_FINE_LOCATION`
  at `maxSdkVersion="30"` grants nothing on Android 12 or later, and the same
  permission unbounded is a runtime grant everywhere.

⚠️ **Two limits on that, stated rather than implied.** The assertions skip
loudly where no Gradle build has been run, which includes CI — docs/agents/ci.md §4c —
so they are a local gate rather than a pull-request one. And only the **debug**
variant's merge has ever been produced; `merged-manifest.ts` looks for the
release variant too and has never found one.

### The wording checklist for the listing, the README and release notes

[ADR 0048](../../docs/adr/0048-workouts-that-change-during-the-ride.md) D-12 (the
owner's Q12 on #1233) bans a list of words from everything this project says
about a workout, because a regulator reads intended purpose from what a product
says about itself. `apps/web/src/privacy/no-medical-wording.test.ts` scans the
client's source for them ([#1245](https://github.com/openzigs/onyourleft/issues/1245)).
**No scan reaches the Play listing, the README or release notes**
([spike 0008](../../docs/spikes/0008-eu-uk-medical-device-read.md) §8), so a
person reads those, before every release and whenever one of them changes:

- [ ] None of them says _cardiac_, _heart condition_, _rehabilitation_,
      _patient_, _therapy_, _safe heart rate_, _protects your heart_, _medical_
      or _clinical_, in any form. The list is `BANNED_WORDS` in
      `apps/web/src/privacy/no-medical-wording.ts`; read it from there.
- [ ] No heart-rate number is called a limit for health or safety. It is _the
      range you chose_.
- [ ] Nothing claims to prevent, treat or reduce the risk of anything, and
      nothing says the app does not (ADR 0030 R5, its negative form included).
- [ ] The purpose given is training: _to help you ride at the effort you
      chose_.
- [ ] The features are called _heart-rate hold_ and _re-plan during the ride_,
      and none of the names ADR 0048 D-13 lists is used.
- [ ] Screenshots in the listing show no sentence that breaks the rules above.

## 5. Android developer verification — re-checked 2026-09-16

⚠️ **This section used to be dated 2026-09-08 and to say the primary source was
unreachable. It was read directly this time**, from
`developer.android.com/developer-verification`.

> _"These protections begin for users installing apps from participating stores
> (Google Play, HONOR App Market, OPPO App Market, Galaxy Store, Palm Store,
> V-Appstore, GetApps) in Brazil, Indonesia, Singapore, and Thailand, on
> certified devices running Android 7+. In 2027, we'll expand this globally to
> all apps on certified devices."_

| Milestone | What |
| --- | --- |
| August 2026 | developer APIs, limited-distribution accounts and the power-user "advanced flow" launched |
| **2026-09-30** | regional enforcement in Brazil, Indonesia, Singapore and Thailand |
| 2027 and beyond | global, on all certified devices |

Two things the 2026-09-08 note did not have, both of which matter to the
direct-APK route:

- **Limited distribution accounts exist and are small.** Google's own wording is
  that students, teachers and hobbyists can "share apps with up to 20 devices
  without a government-issued ID or registration fee". Twenty devices is a test
  group, not a distribution channel.
- **There is an Android Developer Console for apps distributed only outside
  Play**, and an "advanced flow" so that "power users can sideload apps from
  unverified developers". Neither has been exercised by anybody here.

F-Droid's open letter (2026-02-24) calls the requirement existential and states
that apps from unregistered developers will simply fail to install. **This
threatens F-Droid and direct-APK distribution, which is otherwise the natural
home for an AGPL app.**

⚠️ **This is a dated observation, not a live status**, and the regional
enforcement date above is a fortnight after the check. Re-read the primary
source before relying on any of it. This issue does not solve the problem; it
records it, so a distribution channel closing is not a surprise.

## 6. The release workflow

[`.github/workflows/release.yml`](../../.github/workflows/release.yml), triggered
by a `v*` tag and by `workflow_dispatch`.

Deliberately a **separate workflow** from `rules.yml` rather than a job inside
it. docs/agents/ci.md §4c's warning — that a second job reports under a different context
and cannot block a merge — is about _gates_, and this is not a gate: it runs on a
tag, after review, and blocking a merge is not its purpose. Adding it to
`rules.yml` would run an Android build on every pull request, which is minutes of
runner time for a check nothing depends on.

It builds unsigned unless `ANDROID_KEYSTORE_BASE64` is present, so a fork can run
it and get an installable debug artefact without holding any secret — **except on
a tag, where a missing secret is now a hard failure.** Without that clause a tag
pushed after the secret had been rotated or dropped built `assembleDebug` and
published `app-debug.apk` as the release: signed with the debug key whose private
half is in every Android SDK on earth, under a version number, with every step
green.

⚠️ **The step that reads the artefact is the one worth knowing about.**
`assembleRelease` exiting 0 does not mean the APK is signed — injected signing
properties AGP ignores produce `app-release-unsigned.apk` and a successful build
— so the workflow verifies the packaged file with `apksigner` and refuses an
APK that is unsigned or carries the Android debug certificate. It reads the
target API level out of the same file with `aapt2`, which is the only copy of
that number Play ever sees.

`apksigner` rather than `jarsigner`: `minSdkVersion` is 24, so AGP may sign with
the v2 and v3 schemes alone, and `jarsigner` reports an unsigned jar for a
perfectly signed APK.

⚠️ **Three of its four signing inputs are secrets and the fourth deliberately is
not.** The key alias is a repository variable; §9 is why, and what happens to a
build whose alias is missing.

Every run uploads the APK as a workflow artefact, so the pipeline can be
exercised and the result installed **without cutting a tag** — which is what §8
is for. The GitHub Release step still runs only on a tag.

**It builds an Android App Bundle too** ([#958](https://github.com/openzigs/onyourleft/issues/958)),
because Play accepts a new app only as an `.aab`. `bundleRelease` runs in the
same Gradle invocation as `assembleRelease`, so the one set of injected signing
properties signs both; an unsigned run builds `bundleDebug` beside
`assembleDebug`. A second step verifies the bundle as the first verifies the
APK: signed (`jarsigner -verify`, whose verdict is read from what it prints,
because ⚠️ **it exits 0 on an unsigned file**), not with the Android debug
certificate (`keytool -printcert -jarfile`), and targeting at least the `REL002`
floor, read out of the bundle's own manifest with
[bundletool](https://github.com/google/bundletool) `dump manifest`. `aapt2 dump
badging` reads only an APK. bundletool is fetched from Google's release, pinned
by version and SHA-256. The bundle is uploaded as the `android-aab` workflow
artefact and **nowhere else**: not to Play, which would need a Play
service-account credential (a separate decision), and not to the GitHub
Release, because nobody can install an `.aab` directly.

## 7. The target API level, and where the floor is stated

Google Play requires new apps and updates to target **Android 16 (API 36)**.
#95 recorded that sources disagreed on the date; checked 2026-09-16, the date is
**2026-08-31** for new apps and updates, with an extension available to
2026-11-01. It is already past, which is why the floor is not negotiable.

The number is stated in three places and `release-pipeline.test.ts` asserts they
agree:

| Where | How |
| --- | --- |
| `android/variables.gradle` | `targetSdkVersion = 36` — what the build applies |
| `scripts/check-repo-rules.sh` | `MINIMUM_TARGET_SDK=36` — `REL002`, on a bare clone |
| `.github/workflows/release.yml` | `MINIMUM_TARGET_SDK: '36'` — read back out of the packaged APK |

⚠️ **`REL002` used to read `variables.gradle` alone, take the first match in it,
and pass silently if the file was absent.** That is the #142 shape (docs/agents/accessibility.md
§4e): a selector asserted to exist rather than discovered. Four regressions were
green under it and each is now a fixture — deleting `variables.gradle` and
inlining the values, a literal in `app/build.gradle` overriding the ext
property, a lower value appended below a compliant one, and AGP's current
`targetSdk` spelling.

## 8. Getting an APK, and cutting a release

**To exercise the pipeline without releasing anything:**

```bash
gh workflow run release.yml --ref <branch>
gh run list --workflow=release.yml --limit 1
gh run download <run-id> --name android-apk    # the APK, signed if the secrets are set
adb install -r <the .apk>
gh run download <run-id> --name android-aab    # the App Bundle, for Play Console (§11)
```

That is the path to #95's definition of done. It needs no tag, creates no
release, and the artefact is the same file a tag would publish.

### Before every release tag — the tile host's retention is what the policy says

⚠️ **Do this before pushing any `v*` tag, every time.** Two filed statements rest
on it: the Data Safety **approximate location** row (`src/android/data-safety.ts`)
and the privacy policy's tile paragraphs (`docs/privacy-policy.md`). Both say
that Cloudflare, which serves `tiles.openzigs.com` for us, keeps a record of
each map request — the client IP address, the time and the device or browser
type, **not which part of the map** — that this project's Cloudflare account can
see for **up to 7 days**, and that no further logging, log export or analytics
of those requests is turned on. Nothing in this repository can check that: it
is the Cloudflare account's plan and settings, and what the app's requests look
like on the wire.
`apps/web/src/privacy/no-network.test.ts` checks only that the two documents
name the host and the 7 days, not that the 7 days is still true.

**What was measured** ([#558](https://github.com/openzigs/onyourleft/issues/558),
2026-09-26, read-only through the Cloudflare API): the zone `openzigs.com` is on
the **Free** plan; its standard HTTP analytics (`httpRequestsAdaptive`, present on
every zone and not switchable off) hold per-request records for
`tiles.openzigs.com` with `clientIP` and `clientRequestPath`; Logpush is not
available on the account; the R2 bucket has no event notifications and its
`r2.dev` address is disabled; Web Analytics is on for the zone but injects its
beacon into HTML responses only, so tile responses are not measured by it.
Then, the same day (#559's review), `httpRequestsAdaptiveGroups` on the zone,
filtered to host `tiles.openzigs.com` over the last 23 hours and grouped by
`clientRequestPath`: every request the app made had **one** path,
`/basemap-us-20260914.pmtiles` (26 requests). The other paths were scanners
(`/.env`, `/robots.txt`, `/sitemap.xml`, `/`) and one test probe
(`/oyl-no-such-archive.pmtiles`). The basemap is a single PMTiles file read with
HTTP `Range` headers, and `Range` is not a field of that dataset, so the record
says nothing about which part of the map a rider looked at.

In the Cloudflare dashboard, for the zone and the R2 bucket serving
`tiles.openzigs.com`, confirm:

1. **The plan** is still **Free** (or Pro). Retention of the zone's analytics
   follows the plan — Cloudflare's
   [Security Analytics availability table](https://developers.cloudflare.com/waf/analytics/security-analytics/)
   gives *"up to the last 7 days"* for Free and Pro, 31 days for Business and 90
   for Enterprise.
2. **Logpush** is still unavailable, or has no job whose dataset covers
   `tiles.openzigs.com` (HTTP requests, R2 access, or any other dataset that
   carries the request URL or client IP). A Logpush job keeps requests for as
   long as its destination does, which the policy does not say.
3. **Web Analytics** is still limited to HTML pages — no beacon or rule covers
   the tile host — and no Logs or Log Explorer product stores its requests, and
   the bucket has no R2 event notification that records them.
4. **The kept record still does not name the tile.** Re-run the query above:
   `httpRequestsAdaptiveGroups` on the zone, filtered to
   `clientRequestHTTPHost: "tiles.openzigs.com"` over the last day, grouped by
   `clientRequestPath`. The app's requests must share **one constant path** —
   the archive file `basemapStyle` names — with anything else explained as a
   scanner or a probe. ⚠️ If a tile setup ever puts the tile in the URL (a
   z/x/y tile server, a tile in the query string, one file per region fine
   enough to locate a ride), the kept record names where a rider looked: the
   **precise location** row must become collected, and every sentence that says
   *"not which part of the map"* must change, before the tag.

Record the date and who checked in the release's notes.

⚠️ **A tag is when this is checked, not the only time it has to be true.** The
filed answers describe every build already installed, so a plan change or a
logging setting switched on between tags makes them false for riders who never
update. Treat any change to the Cloudflare account's plan, logging, Logpush or
analytics settings as needing this same check at the time it is made, and re-run
it at least once a quarter. A public deployment of `apps/web/dist`, if one ever
exists, reaches the same host and is covered by the same answer without passing
through a tag.

**If any of them has changed** — the plan moved to Business (31 days) or
Enterprise (90), a Logpush job or other store now keeps the requests, Web
Analytics now covers the tiles, or the app's requests no longer share one path —
either put it back before tagging, or do all of
these before the tag, not after:

- change the approximate-location row's `why` in `src/android/data-safety.ts`
  to say what is kept, for how long and by whom — and, if step 4 failed, the
  precise-location row too — and re-file the Data Safety form in Play Console
  to match;
- change `docs/privacy-policy.md`'s short version and its map tile bullet, and
  the *Ride map* sentence in `apps/web/src/views/SettingsView.tsx`, to the same
  period and the same store;
- update the retention the tests look for in
  `apps/web/src/privacy/no-network.test.ts` and
  `src/android/data-safety.test.ts`;
- land all of it in one pull request, because the policy, the app and the form
  must agree (§4).

**To cut a release:** push a `v*` tag, **after the step above**. The same job runs, and the GitHub Release
step publishes the APK as a release asset — the AGPL-native distribution path,
independent of any store (#95's sixth criterion), and the one §5 says is under
threat. ⚠️ Nobody has done this yet, so the release step itself is the one part
of this workflow that has never executed.

## 9. Why the key alias is a repository variable and not a secret

[#338](https://github.com/openzigs/onyourleft/issues/338).

`ANDROID_KEY_ALIAS` was an Actions secret whose value is the ordinary English
word **`upload`**. Actions redacts every occurrence of a secret's *value* from a
workflow log, so that word was blanked out of every line of every release run
that contained it. Read from
[35162828363](https://github.com/openzigs/onyourleft/actions/runs/35162828363),
the second run there has ever been:

```
Decode the *** key, if this repository has one
Run actions/***-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
```

The second line is the one worth staring at. CLAUDE.md §8 requires every action
to be pinned to a commit **so that a reader can audit what runs**, and the
masking took the action's own name out of the audit trail. "Upload" is one of
the commonest words in a release pipeline's vocabulary — `upload-artifact`,
"uploading", "failed to upload the asset" — and every one of those renders with
a hole in it, in the log somebody is reading *because the release went wrong*.

⚠️ There is a second cost and it is the larger one: a reader who sees `***`
reasonably assumes a real credential was nearly leaked there. **Masking that
fires on a non-secret trains people to ignore masking.**

**The alias is not a credential.** It names an entry inside the keystore. It
opens nothing without the store and key passwords, which are still secrets and
stay that way. So it is now a repository **variable**, which Actions does not
redact, and `release-pipeline.test.ts` asserts that `release.yml` reads exactly
three `secrets.*` and takes the alias from `vars.*`.

### Moving the reference is not the fix on its own

⚠️ **The runner masks every secret in the job's map whether the workflow
references it or not.** A workflow that has stopped reading
`secrets.ANDROID_KEY_ALIAS` still gets its logs redacted while that secret
exists, so **deleting it is the operative step**.

⚠️ **That claim is reasoned from GitHub's documented behaviour and has NOT been
measured here**, which is what §10 is for: it is a procedure with empty result
cells, in the shape `docs/validation/` uses, because the change that proves it
is a change to this repository's Actions settings and no pull request can make
it. §10 is also where the migration itself is written down.

⚠️ **Since 2026-09-17 half of that is measured, and a reader who remembers the
paragraph above as the whole story is reading the old file** (noted 2026-09-30,
#955). With the secret deleted, run
[35213089600](https://github.com/openzigs/onyourleft/actions/runs/35213089600)
shows `upload` unmasked everywhere §10 looks. What was NOT measured is the
other half — the variable set and the secret still present — because both
changes were made before any run read them.

### What happens to a build with no alias

A keystore present and an empty alias is now a **hard failure** in the signing
step. It deliberately does not fall through to the unsigned branch: that branch
exits 0, so a repository that had lost its alias would build `assembleDebug`,
pass every step and look exactly like a successful signed run. #338 warns about
that shape in its own acceptance criteria, and it is the reason the signing
step's script is lifted out of the workflow and **executed** in
`release-pipeline.test.ts` rather than read as text — a guard that cannot fire
greps the same as one that can.

### The key itself is untouched

#338 proposed renaming the alias in the keystore with `keytool -changealias`.
Under a variable there is nothing to rename: the word is no longer a redaction
trigger anywhere, so the cheapest fix got cheaper still. **Nothing in this
change opens the keystore**, and §10 proves it from the artefact rather than
asserting it.

⚠️ If the alias is ever renamed anyway, it is `keytool -changealias` and
**never** a regenerated keystore. Under direct-APK distribution the key *is* the
app's identity: Android refuses an update signed by a different key, so a new
key means every existing installation must be uninstalled first — and in a
local-first app that is the rider's whole ride history.

## 10. The alias migration — procedure, **run on 2026-09-17**

**Status:** written 2026-09-17 with [#338](https://github.com/openzigs/onyourleft/issues/338),
and run the same day. **Not an ADR and not a spike**; it decides nothing, and it
ages.

⚠️ **This section used to be headed "not yet run", with every result cell empty
and a warning that the next release run would fail at the signing step; a
reader who remembers that is reading the old file** (corrected 2026-09-30,
#955, from `gh variable list`, `gh secret list`, `gh run list --workflow
release.yml` and the run logs). What the repository's settings say now:

| Setting | State, read 2026-09-30 |
| --- | --- |
| Variable `ANDROID_KEY_ALIAS` | set, 2026-09-17 09:05:22 UTC |
| Secret `ANDROID_KEY_ALIAS` | **absent**: the secrets are `ANDROID_KEYSTORE_BASE64` (2026-09-17 10:56:12), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD` (2026-09-16) |

⚠️ **The first run after the variable was set failed, and not at the guard.**
[35203263648](https://github.com/openzigs/onyourleft/actions/runs/35203263648)
(09:06 UTC) failed at *Assemble*: the keystore then in `ANDROID_KEYSTORE_BASE64`
held no key under the alias the variable names. `ANDROID_KEYSTORE_BASE64` was
set again at 10:56:12, and the run after it passed — with the same certificate
digest as before, which step 3 below is the check for. Which keystore change
was made is not in any log, and this document does not guess it.

Needs somebody who can write the repository's Actions settings. It is two
commands and a workflow run.

### 1. Move the alias out of the secret store

```bash
# The alias inside the keystore, UNCHANGED. `keytool -list -keystore <the .jks>`
# prints it if nobody remembers; do not open the keystore for any other reason.
gh variable set ANDROID_KEY_ALIAS --body '<the alias>'
gh secret delete ANDROID_KEY_ALIAS
```

⚠️ **Both**, in that order. The variable alone leaves the logs redacted — the
runner masks every secret in the job's map whether the workflow reads it or not
— and the deletion alone breaks signing.

### 2. Run the pipeline and read the log

```bash
gh workflow run release.yml --ref main
gh run list --workflow=release.yml --limit 1
gh run view <run-id> --log | grep -nE '\*\*\*|signed=|SHA-256'
```

| What to read | Expected | Result |
| --- | --- | --- |
| The signing step's name in the job list | `Decode the upload key, if this repository has one`, with no `***` | as expected |
| The artefact step's name | `actions/upload-artifact@043fb46d…`, with no `***` | as expected: `Download action repository 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'` |
| `signed=` in the signing step | `signed=true`, **not** `signed=false` | `SIGNED: true` in the environment of *Assemble* and *Verify the artefact*, which read that output (the line itself goes to `$GITHUB_OUTPUT`, not the log) |
| The `Verify the artefact` step | `Signed as required, targeting API 36` | `Signed as required, targeting API 36.` |
| Run id | | [35213089600](https://github.com/openzigs/onyourleft/actions/runs/35213089600), `main`, `workflow_dispatch`, 2026-09-17 10:56 UTC, success |

⚠️ **The `signed=true` line is the one that cannot be skipped.** The unsigned
fallback also exits 0 and also uploads an APK, so a run that quietly stopped
signing is green and looks identical in the run list.

### 3. Compare the certificate, before and after

Nothing in #338 opens the keystore, so the key cannot have changed — but the
proof is free, because the workflow already prints it. `apksigner
verify --print-certs` runs on every build and its digest is a property of the
key, not of the pipeline.

| Run | Certificate SHA-256 |
| --- | --- |
| Before — [35162828363](https://github.com/openzigs/onyourleft/actions/runs/35162828363), 2026-09-16 | `1e9206a0b8836da33abc98a484a282e8f4f416afbeefa5c5c8c87bc5f8ad9369` |
| After — [35213089600](https://github.com/openzigs/onyourleft/actions/runs/35213089600), 2026-09-17 | `1e9206a0b8836da33abc98a484a282e8f4f416afbeefa5c5c8c87bc5f8ad9369` — **the same** |

A certificate fingerprint is public by design: it travels inside every APK
signed with the key. It is the password and the keystore that are secret, and
neither is here.

⚠️ **A different digest means the key changed**, which under direct-APK
distribution means every existing installation can no longer be updated in
place — §9's last paragraph. Stop and work out what touched the keystore before
publishing anything.

## 11. Google Play: the App Bundle, Play App Signing, and what the owner enters

[#958](https://github.com/openzigs/onyourleft/issues/958). §6 says how the
workflow builds and verifies the `.aab`; this section is what it is for.

### Play App Signing: the `oyl-upload` key is the upload key

The app uses **Play App Signing**. Google generates and holds the **app signing
key**, and that is the key every install from Play is signed with. The existing
key in CI, alias `oyl-upload` (§9), is the **upload key**: it signs the `.aab`
this repository uploads, and Play checks that signature and then re-signs what
it serves. Nothing about Google's key is, or ever will be, in this repository
or in its secrets.

⚠️ **So a Play install and a direct-download install cannot update each other.**
The APK on a GitHub Release, and the `android-apk` workflow artefact, are signed
with the **upload key**, not Play's key. Android refuses an update whose
signature differs from the installed app's, so:

- a rider who installed from Play cannot update to a GitHub-Release APK, and a
  rider who installed a GitHub-Release APK cannot update from Play;
- moving from one to the other means **uninstalling first**, which deletes the
  app's data, and the device is where a rider's rides are (CLAUDE.md §1). Export
  or sync before switching.

Both channels remain; the README and the release notes should say which one a
rider is on and that they do not mix. A lost upload key can be reset through
Play Console support, because Google holds the signing key; a lost upload key
still ends direct-APK updates for good, which is §9's last paragraph.

### The first signed bundle

| Run | What |
| --- | --- |
| [40420499350](https://github.com/openzigs/onyourleft/actions/runs/40420499350), 2026-10-26, `workflow_dispatch` on `feature/issue-958-play-app-bundle` | Built `app-release.aab`; `jarsigner` printed `jar verified.`; signer `CN=On Your Left, OU=Development, O=openzigs, C=US`, SHA-256 `1E:92:06:A0:…:AD:93:69`, **the same key** as §10's APK digest; *"Bundle signed as required, targeting API 36."*; uploaded as `android-aab` |
| [40420566672](https://github.com/openzigs/onyourleft/actions/runs/40420566672), 2026-10-26, throwaway branch (deleted) | The red demonstration: `bundleRelease` run in a second Gradle invocation without the injected signing properties. The APK step still passed; the bundle step printed `jar is unsigned.` and failed with *"The release App Bundle does not verify as signed."* |

To get one: `gh run download <run-id> --name android-aab` (§8). That file goes
to Play Console by hand.

### The privacy policy against Play's User Data policy

Read on 2026-10-26 from `support.google.com/googleplay/android-developer/answer/10144311`:

> _"The entity (for example, developer, company) named in the app's Google Play
> store listing must appear in the privacy policy or the app must be named in
> the privacy policy."_

and the policy must carry _"developer information and a privacy point of contact
or a mechanism to submit inquiries."_ [`docs/privacy-policy.md`](../../docs/privacy-policy.md)
opens by naming the app (_"the policy for the On Your Left Android app
(`dev.openzigs.onyourleft`)"_) and has a **Contact** section giving
matt@openzigs.ai. That meets both, so **no wording change is made**. The owner
ruled on 2026-09-30 that the policy does **not** name Zylos Labs LLC; any change
to its wording is held for the owner's approval.

### What the owner enters in Play Console (no pull request)

- [ ] Create the app: name _On Your Left_, default language, **app** (not game), **free**.
- [ ] Store listing: short and full description, 512 px icon, 1024×500 feature
      graphic, phone and tablet screenshots. Hold every word and screenshot to
      §4's wording checklist.
- [ ] Privacy policy URL: `PRIVACY_POLICY_URL` from `apps/web/src/privacy/policy.ts`,
      never one typed by hand (§4).
- [ ] Data Safety: the answers in `src/android/data-safety.ts`, with the two
      section answers of 2026-09-30 (§4): **encrypted in transit: Yes**, except a
      picture or a ride's numbers sent to the rider's own computer; **deletion: by
      email to matt@openzigs.ai**.
- [ ] Health apps declaration (§4).
- [ ] Content rating questionnaire.
- [ ] Target audience: **adults; not likely to be accessed by children** (owner ruling).
- [ ] App access: the core app needs no sign-in; features behind an instance
      sign-in need the rider's own instance, which a reviewer does not have.
- [ ] Opt in to Play App Signing (the default for a new app) and upload the first
      `.aab` to the **internal testing** track, not production.

Not in scope here: uploading to Play from CI (a Play service-account
credential, a separate decision), iOS, and a public release.

