# Releasing the Android app

[#95](https://github.com/openzigs/onyourleft/issues/95). Read [§1](#1-what-has-and-has-not-been-done) before trusting anything else here.

## 1. What has and has **not** been done

⚠️ **Nothing in this document has been executed.** There is no Android SDK in the
environment this was written in and `dl.google.com` is refused by the egress
proxy, which is the same limitation [`README.md`](README.md) §4 records for #87.
So:

| Piece | State |
| --- | --- |
| `REL001` — no committed key material | **Enforced and tested.** `scripts/check-repo-rules.sh`, six fixtures, runs on every pull request |
| `REL002` — target API floor | **Enforced and tested.** Five fixtures, including one that goes red below 36 |
| `.github/workflows/release.yml` | **Written, never run.** No tag has been pushed and no signed build exists |
| The Play account decision | **Not taken.** It is an owner decision and §3 is what it needs |
| A published privacy policy | **Not written.** §4 |
| A signed build installed on a device | **Not done.** This is #95's definition of done and it is outstanding |

CLAUDE.md §4a's rule — that a documented command nobody has run is the most
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

> *"If you have a newly created personal developer account, you must run a closed
> test for your app with a minimum of 12 testers who have been opted-in for at
> least the last 14 days continuously."*

Testers who opt in, test for under 14 days and opt out **do not count**, and the
14 days must be consecutive. For a pre-release open-source project, finding 12
people to hold an install for two unbroken weeks is a scheduling hazard rather
than a formality.

**Organization accounts, D-U-N-S verified, are exempt.** The project is already
under the `openzigs` GitHub organization, so registering the Play account as an
organization sidesteps it — but D-U-N-S verification itself takes time, which is
why #95 was filed now rather than at release.

⚠️ **This decision has not been taken and cannot be taken from here.** #95's
third criterion is that either the org account is registered *or* this file
records the fallback **with named testers**. Neither has happened. Whoever takes
it writes the outcome and the date below this line.

## 4. Health policy, and the one thing #87 already bought

Play's Health Content and Services policy covers apps that are *not primarily*
health apps:

> *"If your app is not primarily a health app, but has health-related features
> and accesses health data, it is still in scope of the Health App policy… (for
> example… games apps that collect a user's activity data as a way to advance
> game play)."*

That example is this app: heart rate and power are health data and they advance
gameplay. So the Health apps declaration and a published privacy policy are
required, and neither exists yet.

The good news is structural rather than a promise. #87 asserts `neverForLocation`
on the Bluetooth scan permission and caps `ACCESS_FINE_LOCATION` at API 30, so
the Data Safety form can honestly declare **no location collection** — which
avoids the much harder location-policy review. ⚠️ #95's fifth criterion asks for
a reviewer to confirm the **merged** manifest supports that claim, and #87's
README records that the merged manifest has never been produced. That
confirmation is outstanding, and it is the same outstanding item in both issues.

## 5. Android developer verification — checked 2026-09-08

From `developer.android.com/developer-verification` as summarised in #95: developer
APIs and limited-distribution accounts launched **August 2026**; regional
enforcement in Brazil, Indonesia, Singapore and Thailand from **2026-09-30**;
global rollout **2027 and beyond**. Google's stated position:

> *"Starting in September 2026, Android will require all apps to be registered by
> verified developers in order to be installed on certified Android devices."*

F-Droid's open letter (2026-02-24) calls this existential and states that apps
from unregistered developers will simply fail to install. **This threatens
F-Droid and direct-APK distribution, which is otherwise the natural home for an
AGPL app.**

⚠️ **This section is a dated observation, not a live status.** It was checked on
**2026-09-08** against #95's own summary rather than against the primary source,
because `developer.android.com` was not reachable from this environment. The
regional enforcement date above is three weeks after that check. Re-read the
primary source before relying on any of it.

This issue does not solve that problem. It records it, so a distribution channel
closing is not a surprise.

## 6. The release workflow

[`.github/workflows/release.yml`](../../.github/workflows/release.yml), triggered
by a `v*` tag.

Deliberately a **separate workflow** from `rules.yml` rather than a job inside
it. CLAUDE.md §4c's warning — that a second job reports under a different context
and cannot block a merge — is about *gates*, and this is not a gate: it runs on a
tag, after review, and blocking a merge is not its purpose. Adding it to
`rules.yml` would run an Android build on every pull request, which is minutes of
runner time for a check nothing depends on.

It builds unsigned unless `ANDROID_KEYSTORE_BASE64` is present, so a fork can run
it and get an installable debug artefact without holding any secret.
