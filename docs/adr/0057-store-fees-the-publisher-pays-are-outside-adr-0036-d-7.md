# ADR 0057: Store fees the publisher pays are outside ADR 0036 D-7

- **Status**: **Accepted, 2026-11-26**, by the owner, 2026-11-26, on its pull request
  [#3330](https://github.com/openzigs/onyourleft/pull/3330)
  ([comment](https://github.com/openzigs/onyourleft/pull/3330#issuecomment-7207451311)): *"accepted
  as written"*, Q1 (D-3's list of what the carve-out does not permit) and Q2 (the `CLAUDE.md` §1
  qualifier as drafted). It was **Proposed** earlier the same day, and that wording was only ever on
  the pull request's branch. The decision is the owner's: **D-2** on the epic
  [#15](https://github.com/openzigs/onyourleft/issues/15), 2026-10-27: *"a **new ADR** says store
  fees the publisher pays (Apple's $99 a year, Play's one-off fee) are outside D-7. Riding,
  recording and self-hosting never need a paid service."* The author wrote the wording and chose
  D-3's list, which the owner accepted
- **Date**: 2026-11-26
- **Deciders**: **the owner** (D-2, and D-1 on the same day, which makes the organisation account
  the payer; D-3 and the `CLAUDE.md` §1 qualifier, accepted 2026-11-26); the author (the wording,
  and D-3's list as proposed)
- **Issue**: [#1748](https://github.com/openzigs/onyourleft/issues/1748), under the iOS epic
  [#15](https://github.com/openzigs/onyourleft/issues/15). It comes before
  [#1749](https://github.com/openzigs/onyourleft/issues/1749), the Apple Developer Program
  enrolment, and it covers the Play fee [#958](https://github.com/openzigs/onyourleft/issues/958)
  and [#95](https://github.com/openzigs/onyourleft/issues/95) already paid for
- **Number**: **0057**, reserved for #1748 by the plan comment on #15 on 2026-10-27, beside 0058 for
  [#1752](https://github.com/openzigs/onyourleft/issues/1752). On 2026-11-26 no file under
  `docs/adr/` held it and no open pull request named it, and `docs/agents/conventions.md` §7 listed
  it as claimed by #1748. Writing it does not move the next free number, which is 0100 (#1748's
  revision block of 2026-11-26)
- **Supersedes**: nothing. It says what [ADR 0036](0036-a-self-hostable-instance-server-now.md)
  D-7's last sentence does not reach. ADR 0036 gains one dated `## Amendments` pointer here
  ([ADR 0013](0013-adr-amendments.md)). Its body is not edited
- **Leaves standing**: ADR 0036 D-3's four invariants, and D-7's *"There is no hosting bill to
  begin with"* and its rule that a paid box is the owner's call when it comes.
  [ADR 0025](0025-app-store-additional-permission.md) (the app-store permission).
  [ADR 0018](0018-native-client-platform.md) D-5

## Context

[ADR 0036](0036-a-self-hostable-instance-server-now.md) D-7 ends: *"No issue may take a paid
service as a prerequisite."* The root `CLAUDE.md` §1 restates it. The sentence was written about
hosting: D-7 is titled *"Where the first instance runs, and what is not implied"*, and the sentence
before it is *"Lifting D6 implies no paid hosting."*

Read literally, though, it forbids work the project is already doing:

- **Google Play.** Publishing needs a developer account, and Google charges *"a US$25 one-time
  registration fee"* (Play Console Help, read 2026-11-26). #958 and #95 took that account as a
  prerequisite, and #958 is closed.
- **The App Store and TestFlight.** *"The Apple Developer Program is 99 USD per membership year"*
  (developer.apple.com, read 2026-11-26). Every issue under #15 that signs, uploads or distributes
  the iOS app takes that membership as a prerequisite, starting with #1749.

The owner ruled on 2026-10-27 that the fee question is answered by a **new ADR, not an amendment**
(D-2). Clarifying a decision's scope is itself a decision, and ADR 0013 D-3 allows an appended
amendment only for a fact that has drifted. The owner also ruled (D-1) that the iOS membership is an
**organisation** account, as the Play account is, so the publisher pays the fee and no rider or
contributor does.

**What is free without either fee**, read on 2026-11-26 from Apple's *Choosing a Membership* page:
*"To install and test your apps on a personal device, you'll need to sign in to your Apple Account in
Xcode. If your account is not associated with a developer program membership, Xcode will indicate
it's a Personal Team."* Building and running the app needs Xcode and a free Apple Account, and
distributing it needs the membership. #1756 is to build the iOS project unsigned for the simulator in CI,
with no account at all. On Android, an unsigned or self-signed build needs no Play account.

## Decision

### D-1 — A store fee the publisher pays is outside ADR 0036 D-7

**A fee the project's publisher pays to a store to publish the app** is not a "paid service" in the
sense of ADR 0036 D-7, and an issue may take it as a prerequisite. On 2026-11-26 there are two:

- **Apple's Developer Program membership**, 99 USD a year, for App Store and TestFlight
  distribution (#1749 and the issues after it under #15);
- **Google Play's developer registration**, US$25 once, for Play distribution (#958, #95).

The publisher is the organisation account of the owner's D-1 ruling. A store fee is a cost of
*publishing* a build, and it buys nothing a rider needs in order to use the app. That is the reason
for the carve-out, and it is also its limit.

### D-2 — No rider-facing, recording or self-hosting path may take a paid service as a prerequisite

**Nothing a rider does, nothing that records a ride, and nothing a self-hoster runs may require a paid
service.** This half of ADR 0036 D-7 is unchanged, and it binds every issue:

- **riding and recording**: on the web client, the Android app and the iOS app, with or without an
  instance (ADR 0036 D-3 (a));
- **self-hosting**: running `apps/instance` on hardware the self-hoster owns, with no bill from this
  project or from anyone this project requires (ADR 0036 D-7, *"There is no hosting bill to begin
  with"*);
- **getting the app**: the web client needs no store at all. A rider who installs from a store pays
  the store nothing, because both apps are free to download.

### D-3 — What the carve-out does not permit

So that D-1 cannot widen without anyone noticing, it does **not** permit any of these:

1. **A paid service a rider or a self-hoster must buy**: a subscription, a paid API key the app
   needs in order to work, a paid tunnel, domain or host that self-hosting needs. Any optional paid
   service a rider *chooses* (a hosted model on their own key, ADR 0046) stays optional, and the path
   without it keeps working.
2. **A paid build service as the only way to build the app.** CI and a contributor's machine must
   be able to build each client without paying anyone. On iOS, an unsigned simulator build (to come in #1756) needs no
   Apple account, and Xcode with a free Apple Account installs on a personal device
   (Context). [ADR 0018](0018-native-client-platform.md) D-5 lands the iOS project only in a pull
   request that can build it. A hosted build service (Xcode Cloud, a paid macOS runner) may be an
   addition, never the only way: `CLAUDE.md` §8 already forbids larger, charged runners in CI.
3. **Sponsorware or paid plugins**: a feature, a source file or a build that is available only to
   people who pay. These are excluded already, because `CLAUDE.md` §3 fails a non-OSI licence
   everywhere. This ADR adds no exception.
4. **Any other fee as a "store fee"**: a store's paid placement or advertising, a paid analytics or
   crash-reporting service, a code-signing certificate bought outside the store's membership. Each
   is a paid service under ADR 0036 D-7 and needs its own decision.

### D-4 — Where this is said

- `CLAUDE.md` §1's sentence *"no issue may take a paid service as a prerequisite"* gains a short
  qualifier that points here. The file's budget is 15 KiB (`AGENT002`), so the qualifier is a
  pointer and not a restatement.
- ADR 0036 gains a dated `## Amendments` entry that points here. Its D-7 is not edited.

## Questions for the owner

Both were answered by the owner on 2026-11-26 on #3330: **accepted as written**.

1. **Q1 — D-3's list.** **Accepted as written, 2026-11-26.** *Recommendation was: accept it as written.* Each item is a way D-1 could widen
   without anyone noticing. Items 1 and 3 restate rules that already bind, and items 2 and 4 are the
   author's.
2. **Q2 — The `CLAUDE.md` §1 qualifier**, as written in this pull request. **Accepted as drafted,
   2026-11-26.** *Recommendation was: approve it.* The issue asks for the owner's approval of this line in the pull request.

## Consequences

- **What this enables.** #1749 (the Apple enrolment) and every iOS distribution issue under #15 can
  proceed without breaching ADR 0036 D-7. #958's and #95's Play account is covered after the fact.
- **What it costs.** The publisher pays 99 USD a year for as long as the iOS app is distributed
  through Apple. If the membership lapses, the iOS app leaves the store. That is a cost of
  publishing, and riders keep the web client and their data on the device (ADR 0036 D-3).
- **What it does not change.** Riding, recording and self-hosting never need a paid service
  (D-2). Nothing here adds a network call, an account a rider must hold, or a dependency.
- **Review question, permanently.** No rule can tell whether a new prerequisite is a "store fee".
  A reviewer asks two things of any issue that names a fee: does the publisher pay it to a store to
  publish the app, and does a rider, a recorder or a self-hoster need it? It is allowed only if the
  answers are yes and no.

## What would make this ADR wrong

- **A store starts charging riders** for a free app. That is not a publisher's fee, and D-2 binds.
- **A store requires a paid service beyond its membership** in order to publish. That service is
  not covered (D-3 item 4) and needs its own decision.
- **Building the app comes to require the membership.** That breaks D-3 item 2, and the project
  must find an unpaid build path or decide again.
