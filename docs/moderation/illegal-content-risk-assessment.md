# Illegal content risk assessment: the project's instance with public rooms enabled

> **Adopted by the owner on 2026-09-30.** It is **not legal advice**, and no lawyer has checked
> it.

- **Date**: 2026-09-30
- **Issue**: [#886](https://github.com/openzigs/onyourleft/issues/886). Public rooms
  ([#788](https://github.com/openzigs/onyourleft/issues/788)) stay blocked until [#907](https://github.com/openzigs/onyourleft/issues/907),
  [#910](https://github.com/openzigs/onyourleft/issues/910) and [#911](https://github.com/openzigs/onyourleft/issues/911) ship (owner, 2026-09-30). Private rooms do not wait.
- **Sources relied on**: [spike 0019](../spikes/0019-online-safety-act-and-dsa-read-for-the-projects-instance.md),
  read first-hand on 2026-09-30. Section references below (s.9, Sch.3 and so on) are to the Online
  Safety Act 2023 as quoted there. "O1" is Ofcom's Illegal content Codes of Practice for
  user-to-user services (the version incorporating amendments in force on 30 September 2026). "O9"
  is Ofcom's Risk Assessment Guidance and Risk Profiles, ⚠️ **in the version headed 16 December 2024,
  which may be superseded** by the 25 June 2026 update that could not be fetched (spike §5 item 2).
- **Owner decisions of 2026-09-30** are written into this draft where they apply. They were
  recorded on [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5911594101)
  ([second comment](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5911633018)) and on
  [#887](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911594478)
  ([second comment](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911633500)),
  with later comments on [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5913128189) (the Discord link),
  [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5913273878) and
  [#887](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5913274367) (the contact address and the
  sign-off).
- **Where this document says "proposed"**, the proposal is adopted by the owner's sign-off of
  2026-09-30, whose words were *"Safety draft looks good"*; the owner asked for no change to any
  proposal. A proposal that is still conditional (H1 among them) stays conditional.
- **Public rooms wait for [#907](https://github.com/openzigs/onyourleft/issues/907),
  [#910](https://github.com/openzigs/onyourleft/issues/910) and
  [#911](https://github.com/openzigs/onyourleft/issues/911)** (owner, 2026-09-30): reporting without an
  account, a statement of reasons the rider can read, and complaints and appeals. Private rooms can
  ship before them.
- ⚠️ **Still open: three Ofcom guidance documents have not yet been read in full**: the Risk
  Assessment Guidance (with the current Risk Profiles), the Children's Access Assessments Guidance
  and the Record-Keeping Guidance (spike 0019 §5 items 1–3). They are to be read before the first
  review, which is due within 3 months of opening (owner, 2026-09-30).
  **Read in full on 2026-11-03** ([#1365](https://github.com/openzigs/onyourleft/issues/1365)):
  what each changes is under [Amendments](#amendments), for the owner to decide.
- **Related drafts**: [children's access assessment](childrens-access-assessment.md),
  [notice-and-action and complaints](notice-and-action.md),
  [statements of reasons](statement-of-reasons.md), [DSA scope](dsa-scope.md). The operator's
  guide is [`docs/moderation.md`](../moderation.md).

## Sign-off

| | |
|---|---|
| Service assessed | The project's instance with public rooms enabled (below) |
| Assessment completed on | 2026-09-30 |
| Completed by | Drafted in #914; approved by the owner |
| Named person responsible for the assessment | The owner (also the ICU A2 accountable individual) |
| Approved by | The owner, 2026-09-30: *"Safety draft looks good"* |
| Current Ofcom Risk Profiles consulted (version and date) | **Not yet read in full.** The version headed 16 December 2024 was relied on (O9, above). To be read before the first review |
| Next review due | Within 3 months of opening |
| Signature | The owner, 2026-09-30: *"Safety draft looks good"* |

O9 Table 8 lists what the record must contain. The rows above follow that list.

## What this assessment covers

**The service** is the project's own instance: `apps/instance`, run on the owner's home machine
behind a Cloudflare Tunnel ([ADR 0036](../adr/0036-a-self-hostable-instance-server-now.md) D-7),
with registration set to `approval` and **public rooms enabled** (#788). A rider's device keeps
its own copy of every ride. Nothing here assesses the app on its own, with no instance.

**The provider** is the owner. s.226(2)–(3) treats as the provider *"the entity that has control over
who can use the user-to-user part of the service"*, or an individual where no entity has that
control. With `approval` registration the owner decides who may use the instance. A self-hoster is
the provider of their own instance and owes their own assessment (`docs/moderation.md`, "Before you
open your instance to the public").

**Why the Act applies.** s.3(1) defines a user-to-user service by content that one user generates
and another may *"encounter"*. s.236 includes *"data of any description"* in "content". s.3(2)(a)
says a functionality that allows sharing is enough. The Act has no size, revenue or commercial
threshold. Of the Schedule 1 exemptions read, none fits this instance on its face; para 7
(internal business services) is probably not a fit but is left for a lawyer (spike §2 Q1).

**OPEN, for a lawyer, and it affects the date.** The instance may already be a user-to-user service
before public rooms, because display names are shown to other riders today and group rides
(#784) share a route. If so, "the first day" under Sch.3 paras 3–4 may already have passed, and the
three-month clock with it (spike §2 Q2). The owner's ruling (#16, Q5) is stricter than the Act, in
that the assessment comes **before** public rooms. This draft follows the ruling.

**OPEN, for a lawyer.** Whether the service "has links with the United Kingdom" (s.4(5)–(6)). The
owner is in the UK and the app is in English. This draft assumes that it does.

## Step 1: understand the kinds of illegal content to assess

### The features, and what another rider can encounter through each

| Feature | What another rider encounters | Where it comes from |
|---|---|---|
| **Display names** | A name the rider chose, unverified. It is *"identifying content"* (s.236). Today it is the only rider-supplied content another rider sees on the instance (`docs/moderation.md`). A moderator can hide it | #83, ADR 0028 D-6.5 |
| **Route geometry shown in group rides and public rooms** | The creator's own route, relayed for the room's lifetime and deleted when the room closes, *"unless the creator separately shared it"* (#784). A route that starts inside the creator's privacy zone is refused before upload. A public room's listing shows length and climb, never start coordinates, but a rider who joins receives the route | #784, #788, [ADR 0004](../adr/0004-privacy-and-location.md) |
| **Race results** | A finish order after a race, with display names and each rider's power-to-weight (W/kg), never watts, for riders other than the viewer | #785 (ruling Q17), ADR 0028 D-7.7 |
| **The public room listing** | Rooms riders created on their own routes, ordered by start time then creation time. No featured, recommended or operator-pinned slot | #788, ADR 0028 D-7.1 |
| **Room chat** | ⚠️ **There is none today, and no issue read builds one.** Riders cannot send one another text on the instance | — |
| **The Discord voice link** | A link, in a room, to a voice channel on Discord that a bot made for that room. The voice itself is on Discord, not on the instance. **Not part of the service assessed** (owner, 2026-09-30; below). The spike 0018 recommendation (awaiting the owner) holds account linking for public rooms | #794, [spike 0018](../spikes/0018-discord-terms-for-a-self-hosted-voice-bot.md) |
| **Plausibility flags** | Shown to **every rider in the race**, beside the flagged rider's result and display name, with the duration the flag was raised for. A flag is generated by the instance from the room's own re-simulation, not by a rider. Each flag is also filed as a report to the moderator | #785, ADR 0028 D-2 rule 3; #789 |
| **Reports** | Seen by the moderator only, not by other riders | #83, #789 |

**What the instance does not offer**, which matters for several kinds of harm below: no images or
video uploaded or shown, no direct messages, no follower or friend graph, no feed, no comments, no
livestreaming on the instance, and no recommender algorithm. A rider's rides are synced to the
instance (#776) but are not shown to other riders (`docs/moderation.md`).

**The Discord voice link is not part of the service assessed** (owner decision, 2026-09-30). Voice
happens on Discord, under Discord's terms and moderation. The instance only creates a channel and
shares an invite. s.55(4)(b) treats a bot as a user only where it is *"not controlled by or on behalf
of the provider"*; the owner's bot is controlled by the provider, and what it does on the instance
is create the channel and share the invite. This assessment names the link and its risks, and does
not assess Discord's own service:

- **An invite shared in a room.** The link sends riders to a service with voice and messaging where
  the instance's moderation does not reach.
- **Riders' Discord usernames are visible to each other** on Discord.

### The user base (s.9(5)(a))

- Adults, **by self-declaration**: a rider confirms they are 18 or over, and only the confirmation
  and its date are stored (#775). Public rooms need that confirmation (ruling Q5). ⚠️ This is not
  age verification (s.230(4)). The [children's access assessment](childrens-access-assessment.md)
  weighs it.
- Every account is **approved by a person**, the owner. See "What `approval` does and does not
  contribute", below.
- Riders of a cycling training app with a trainer game, using the Android app and the web app.
  The number of riders is not known yet: the instance has not opened to the public.
- Accounts must be active for 7 days and have synced 3 rides before joining a public room (#775).

### The kinds of priority illegal content

⚠️ **The list below is not the full statutory list.** s.9(5)(b)(i) requires *each kind of priority
illegal content, with each kind separately assessed*. O9 says there were 17 kinds in its December
2024 text. Spike 0019 records that two further priority offences were created in December 2025
(serious self-harm and cyberflashing), so the current count may differ. The current Risk Profiles
could not be read (spike §5 item 2). **Before the first review, a person with a browser must take the full
list from the current Risk Profiles and add a row for every kind not below.** The rows below are the
kinds named in the risk factors and measures that spike 0019 quotes.

## Step 2: assess the risk of harm

Levels use O9's scale: negligible or no risk, low, medium, high. ⚠️ **Every level below is adopted by the owner's
sign-off of this assessment on 2026-09-30 (*"Safety draft looks good"*); harassment and stalking the
owner rated separately, the same day.**
O9: a *low* level needs evidence and *"no or few specific risk factors"*.
A *negligible* level where some risk factors are present *"will normally need comprehensive
evidence"*. There is no usage evidence yet, because the service has not opened. The first review
must replace reasoning with evidence (Step 4).

| Kind of illegal harm | Relevant risk factors (O9) | Level | Reasons |
|---|---|---|---|
| Harassment, stalking, threats and abuse | User profiles; **posting or sending location information** | **Low** (owner, 2026-09-30) | **The owner rated harassment and stalking through shared routes and public plausibility flags low on 2026-09-30**, naming three mitigations: privacy-zone trims, no position in rooms, and no location in flags. The owner must be able to defend this rating. A display name can carry abuse. A plausibility flag is shown to every rider in a race beside the flagged rider's name (#785), so a flag that is wrong, or read as an accusation of cheating, could draw abuse towards that rider; it is generated by the instance, not by a rider, and it is also a report the moderator handles (#789). A route shown to strangers in a public room is location information, and O9 says it *"may be used by potential perpetrators to track the whereabouts of survivors and victims"*. Mitigations: routes starting in a privacy zone are refused (#784), the listing shows no coordinates (#788), routes are deleted when the room closes unless the creator separately shared them, a block, either way round, keeps two riders out of the same public room (#788, #789): the instance leaves a room holding anybody the rider blocks, or who blocks them, out of that rider's listing, and refuses them a join and a ticket to ride in it, so a block made after both joined holds from the rider's next ticket. It does not end a ride already under way, and a private room joined by its code is not checked. In a race, two riders with a block between them are never sent each other's name. There is no messaging. A rider blocks another from a race's result in the app ([#1516](https://github.com/openzigs/onyourleft/issues/1516)), and lists and undoes the rider's own blocks on the Instance screen ([#1529](https://github.com/openzigs/onyourleft/issues/1529)), by a handle the instance makes for each block, never the blocked rider's id. ⚠️ A route that starts just outside a privacy zone, or a rider with no privacy zone, still reveals a place the rider rides from |
| Controlling or coercive behaviour | Posting or sending location information | **Low** | As above. The instance offers no way to follow a rider's rides |
| CSEA: grooming | User profiles; location information | **Low** | Public rooms are for adults by self-declaration, which is not age assurance. The instance has no messaging, no images and no friend graph. ⚠️ The Discord link moves riders to a service with voice and messaging where the instance's moderation does not reach. That is the main route by which this could change |
| CSEA: image-based CSAM | — | **Negligible** | O9: negligible *"where the service's functionalities do not enable images or videos to be generated, uploaded or shared"*. The instance shows no images |
| Intimate image abuse; cyberflashing | — | **Negligible** | No image functionality, as above. The intimate image content report (s.20A) must still be possible ([notice-and-action](notice-and-action.md)) |
| Hate | User profiles | **Low** | Only through a display name (or a room's name, if rooms are given one), which a moderator can hide |
| Terrorism | — | **Low** | Only through a display name, for example a proscribed organisation's name. Codes ICU H1 (removing accounts of proscribed organisations): proposed, suspension. Spike 0019 records H1 as read, and as applying to all services, but does not quote what it asks; its wording must be quoted here to confirm a reversible suspension meets "removing accounts" |
| Fraud and financial services | User profiles | **Low** | No payments, no listings, no messages. Impersonation through a display name is the only route |
| Foreign interference | User profiles | **Low** | Named against user profiles in O9. The instance's only profile content is a display name, and there is no way to contact a rider through it |
| Proceeds of crime | User profiles | **Low** | Named against user profiles in O9. The instance's only profile content is a display name, and there is no way to contact a rider through it |
| Unlawful immigration | User profiles | **Low** | Named against user profiles in O9. The instance's only profile content is a display name, and there is no way to contact a rider through it |
| Human trafficking | User profiles | **Low** | Named against user profiles in O9. The instance's only profile content is a display name, and there is no way to contact a rider through it. No messaging, so no recruitment route on the instance |
| Sexual exploitation of adults | User profiles | **Low** | Named against user profiles in O9. The instance's only profile content is a display name, and there is no way to contact a rider through it. No images and no messaging |
| Drugs and psychoactive substances | User profiles | **Low** | Named against user profiles in O9. The instance's only profile content is a display name, and there is no way to contact a rider through it. No listings, payments or messaging; a display name is the only route, and a moderator can hide it |
| Encouraging or assisting serious self-harm | — | **Low** | Only through a display name (or a room's name, if rooms are given one) |
| Every other kind in the current Risk Profiles | To be read | **To be assessed** | See the warning under Step 1 |
| Other illegal content (s.9(5)(b)(ii)) | — | **Low** | No algorithm disseminates content. Content spreads only to riders in the same room or on the listing |

**If every level stays at low or below, the service is not "multi-risk"** (O1 ¶5.6: medium or high
in two or more kinds) and is not "large" (O1 §5: more than 7 million monthly active UK users). The
measures for all services then apply, and the measures for large or multi-risk services do not. If
the owner's rating of **harassment and stalking** (low, 2026-09-30) became medium and one other kind
were medium, the service would become multi-risk and more measures apply (A3, A5–A7, C3–C8, D8;
spike §2 Q2).

⚠️ **One kind at medium is enough for some measures.** Rating **any single kind** medium or high
brings in ICU D3–D6, which the O1 Index applies to *"Services that are large or at medium or high
risk of any kind of illegal harm"*; of those, D3 and D5 apply only where such a service is also
likely to be accessed by children ([children's access assessment](childrens-access-assessment.md)).
Spike 0019 records which services D3–D6 apply to but does **not** quote what they ask. Their text
must be read before the owner chooses a level for any kind.

### The s.9(5) checklist

| s.9(5) | Where it is answered |
|---|---|
| (a) the user base | Step 1, "The user base" |
| (b) the risk of encountering each kind of priority illegal content, and other illegal content, taking into account algorithms and how easily, quickly and widely content spreads | The table above. There is no recommender algorithm, and content reaches only a room's riders and the listing |
| (c) the risk of the service being used to commit or facilitate a priority offence | The table above. Stalking through route geometry is the main one |
| (d) the risk of harm from illegal content of different kinds | The table above |
| (e) the functionalities that carry higher risk | Route geometry shown to strangers; the Discord link; display names; plausibility flags shown beside a rider's name to everyone in the race |
| (f) the different ways the service is used | Private group rides among people who share a code (#784), private races (#785), public rooms (#788) |
| (g) the nature and severity of the harm | Physical risk from a location being learned is the most severe. Abuse through a display name is the most likely |
| (h) how design and operation reduce or increase the risk | Step 3 |

## Step 3: decide measures, implement them, and record them

### What `approval` does and does not contribute

- **It does**: put a person between a new device key and the instance. A suspended rider who makes a
  new key is back in the queue, not back on the instance (`docs/moderation.md`). It limits how fast
  anybody can create accounts in bulk, alongside the per-address limit. It makes re-entry after a
  ban (which ADR 0028 D-6.2 names as the weakness of device-key identity) cost a new approval, but
  it does not identify a returning rider: the moderator sees the same self-chosen name and tick box
  as for anybody else.
- **It does not**: verify age or identity. The moderator sees a self-declared 18+ confirmation and a
  name, and no evidence of either. It is not age verification or age estimation (s.230(4)), and it is
  no evidence that a rider is an adult. It does nothing about content once an account is approved.
- **It is an operational commitment**: every account waits for the owner, and one moderator
  (#905) is the only person who can approve.

### The Codes' measures for all services (O1), and where each stands

s.23(3) requires a written record of the measures taken. s.23(4) requires a record of any
alternative measures and of how they comply.

| Measure | What it asks (O1) | State on 2026-09-30 |
|---|---|---|
| ICU A2 | *"name an individual accountable to the most senior governance body for compliance with the illegal content safety duties and the reporting and complaints duties"* | **The owner** (owner decision, 2026-09-30). For a one-person project the owner is also the governance body, and this record says so. ⚠️ The Codes read do not say how a sole individual meets A2 when they are also the governance body (spike §2 Q2) |
| ICU C1 | A content moderation function that reviews suspected illegal content | The owner, through the moderation routes (`docs/moderation.md`). The procedure is [notice-and-action](notice-and-action.md) |
| ICU C2 | Swift take-down | Hide a display name; suspend. **Taking down one item** (a route in a room, a result, a room listing) is not built: filed as [#913](https://github.com/openzigs/onyourleft/issues/913) |
| ICU D1, D2 | Enabling complaints; easy to find, access and use, with a reporting tool *"clearly accessible in relation to that content"* (D2.2(a)) and assistive technology support (D2.4) | Partly. Signed-in riders can report a rider (#83), and in a room (#789). **Reporting by non-users ("affected persons", s.20(5)) and reporting a specific item** is filed as [#907](https://github.com/openzigs/onyourleft/issues/907) |
| ICU D2.2(a), where the report control is | The reporting tool *"clearly accessible in relation to that content"* | **Measure taken, 2026-11-04** (owner ruling on [#1381](https://github.com/openzigs/onyourleft/issues/1381)). The link to the instance's notice page, with the references to report, sits next to the content it is about: under a room (its listing and its route) and under a race's result (the room, the route and each row), where the rider reads them ([#1877](https://github.com/openzigs/onyourleft/pull/1877)). The ride screen itself has no report control: nobody fills in a form while pedalling, and a rider reports from the room or the result when the ride is over. Revisit at the first review, and sooner if a report shows the placement is not reaching the person who saw the content. A change to where the control is, is a significant change under Step 4 (point 6 above) |
| ICU D7 | Appropriate action on complaints about suspected illegal content, considered promptly | The procedure in [notice-and-action](notice-and-action.md). Target times (owner, 2026-09-30): 48 hours for notices of illegal content (s.10(3A)), and 7 days for other reports and complaints |
| ICU D9, D10 | Appeals determined promptly, and action after the determination | **Not built.** Filed as [#911](https://github.com/openzigs/onyourleft/issues/911). ⚠️ With one moderator, an appeal is decided by the person who took the decision. A notice or complaint about the only moderator is handled as the owner decided on 2026-09-30: [notice-and-action](notice-and-action.md#a-notice-or-complaint-about-the-moderator) |
| ICU D11, D12, D13 | Proactive-technology complaints; all other relevant complaints, directed to a responsible individual (D12.3); manifestly unfounded complaints | No proactive technology is used, so D11 has nothing to act on. D12: the owner. D13: the procedure says how an unfounded complaint is recorded |
| ICU G1, G3 | Terms of service: substance, and clarity (G3.2(c): a reading age for the youngest permitted user) | **None exist.** Filed as [#909](https://github.com/openzigs/onyourleft/issues/909) |
| ICU H1 | Removing accounts of proscribed organisations | Proposed: suspension (`docs/moderation.md`). Spike 0019 records H1 as read but does not quote what it asks; its wording must be quoted here to confirm a reversible suspension meets "removing accounts" |

### Other duties in force, which #886 does not mention

| Duty | What it asks | State |
|---|---|---|
| s.20A and s.10(3A), in force 29.6.2026 | An **intimate image content report**, and take-down within **48 hours** of receiving one | The instance shows no images, so the content is unlikely to exist. The report must still be possible: [#907](https://github.com/openzigs/onyourleft/issues/907) and [notice-and-action](notice-and-action.md) |
| s.66, in force 7.4.2026 | A UK provider reports detected CSEA content to the NCA | A step in [notice-and-action](notice-and-action.md). No product change |
| s.21 | A complaints procedure, including appeals (s.21(4)(c)–(d)), described in the terms of service (s.21(3)) | [#911](https://github.com/openzigs/onyourleft/issues/911), [#909](https://github.com/openzigs/onyourleft/issues/909) |
| s.23 | Written records of this assessment, of the measures and of alternatives, and regular review | This document, the moderation log, and [#912](https://github.com/openzigs/onyourleft/issues/912) (a record of each notice and complaint). ⚠️ Ofcom's Record-Keeping Guidance could not be read, so whether any s.23(7) exemption exists is unknown (spike §5 item 3) |

### Product changes this assessment depends on

Filed on 2026-09-30, and **not built**:
[#907](https://github.com/openzigs/onyourleft/issues/907),
[#908](https://github.com/openzigs/onyourleft/issues/908),
[#909](https://github.com/openzigs/onyourleft/issues/909),
[#910](https://github.com/openzigs/onyourleft/issues/910),
[#911](https://github.com/openzigs/onyourleft/issues/911),
[#912](https://github.com/openzigs/onyourleft/issues/912) and
[#913](https://github.com/openzigs/onyourleft/issues/913). Already open and relevant: #775 (the 18+
confirmation and eligibility), #789 (moderation in rooms), #905 (one moderator), #778 (the privacy
policy).

**Public rooms wait for #907, #910 and #911** (owner, 2026-09-30): reporting without an account, a
statement of reasons the rider can read, and complaints and appeals. Private rooms can ship before
them.

## Step 4: report, review and update

**Accountable individual**: the owner (Codes ICU A2; owner decision, 2026-09-30). For a one-person
project the owner is also the governance body, and this record says so.

**Review.** s.9(3) requires the assessment to be kept up to date. Ofcom recommends a review at least
every 12 months (O2; O9 ¶2.45). The first review is due **within 3 months of opening** (owner,
2026-09-30), because the levels above rest on reasoning, and it should
use the report queue, the moderation log and [#912](https://github.com/openzigs/onyourleft/issues/912)'s
record as evidence.

**A further assessment before any significant change (s.9(4)).** Each of the following is proposed
as a significant change that needs a further assessment **before** it ships:

- room chat, direct messages, or any other text riders send one another;
- showing a rider's rides, or any part of them, to other riders;
- images, avatars or video of any kind;
- account linking to Discord for public rooms, or hosting voice on the instance;
- federation with other instances (#56);
- changing registration from `approval` to `open` or `invite`;
- changing the 18+ rule, the eligibility rules (#775), or the privacy-zone refusal (#784);
- a feed, a follower graph, a leaderboard shown during a race, or any recommender;
- a second moderator, or losing the only one.

## Open points this draft does not settle

1. Whether the instance is already a user-to-user service, and when "the first day" was (lawyer).
2. The full list of priority illegal content from the current Risk Profiles, read by a person with a
   browser (spike §5 item 2).
3. Whether to run Ofcom's interactive scope checker and toolkit and attach the output (owner; spike
   §2 Q5).
4. Reading the three Ofcom documents named at the top (the Risk Assessment Guidance, the Children's
   Access Assessments Guidance and the Record-Keeping Guidance) in full, before the first review.
   **Read on 2026-11-03: see [Amendments](#amendments).**

Decided by the owner on 2026-09-30, and no longer open here: the level for harassment and stalking
(low), the ICU A2 accountable individual (the owner, who is also the governance body), that the
Discord voice link is not part of the service assessed, and the contact address.

## Amendments

### 2026-11-03: Ofcom's Risk Assessment Guidance and Record-Keeping Guidance, read in full

> **An agent's summary for the owner** ([#1365](https://github.com/openzigs/onyourleft/issues/1365):
> *"Owner's hands (or an agent's summary for the owner)"*). It is **not legal advice**. **It changes
> no level, measure or conclusion the owner adopted on 2026-09-30.** Where the guidance points to a
> change, this entry says so and leaves the decision to the owner, at or before the first review.
> The Children's Access Assessments Guidance is the subject of the matching entry in the
> [children's access assessment](childrens-access-assessment.md#amendments).

**What was read, and how.** Ofcom still answers `403` to `curl` and WebFetch, as spike 0019 §5
recorded. Each PDF was fetched from the Internet Archive's capture of the exact URL that Ofcom's
*Online safety regulatory documents and guidance* page links. That page, as captured on 2026-09-25,
lists both documents as the current versions. The text was extracted with `pdftotext` and read in
full. The Search Risk Profile (Part 3 §1, Table 9.2) was read but not applied, because it is for
search services.

| Document | Version | Ofcom URL (as linked on 2026-09-25) | Archive capture | SHA-256 of the PDF read |
|---|---|---|---|---|
| Risk Assessment Guidance and Risk Profiles | **V2.0, "Published 25 June 2026"**, 84 pages | `…/illegal-harms/updates/risk-assessment-guidance-and-risk-profiles.pdf?v=419947` | 2026-07-02 | `c3380670eddc2c9ffe611d4ae8dde2c8e0282b62458bc1c758ef2d8e711c05df` |
| Record-Keeping and Review Guidance | **V3.0, "Published 25 June 2026"**, 17 pages | `…/illegal-harms/updates/record-keeping-and-review-guidance.pdf?v=420034` | 2026-07-02 | `733b3f213d614c294b19efb112b3f09788e0389547a5258a492c0f70de2a68bd` |

The `…` stands for `https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry`.
The same page lists the version this assessment relied on (O9, headed 16 December 2024) as
**superseded**. Paragraph numbers below are the guidance's own: "RAG" is the Risk Assessment
Guidance, "RKG" the Record-Keeping and Review Guidance.

#### What the Risk Assessment Guidance changes

**1. There are 18 kinds of priority illegal content, and Step 2 has no row of its own for five of
them** (cyberflashing shared a row with intimate image abuse).
RAG Table 1 and Appendix A list: terrorism; CSEA (grooming, image-based CSAM, CSAM URLs); hate;
harassment, stalking, threats and abuse; controlling or coercive behaviour; intimate image abuse;
extreme pornography; sexual exploitation of adults; human trafficking; unlawful immigration; fraud
and financial offences; proceeds of crime; drugs and psychoactive substances; firearms, knives and
other weapons; encouraging or assisting suicide and serious self-harm; foreign interference; animal
cruelty; cyberflashing. A U2U service also assesses image-based CSAM, CSAM URLs and grooming
**separately**, and gives CSEA an overall level (RAG ¶2.7, ¶3.4). The rows the Step 2 table lacks,
with levels **proposed by this reading for the owner to adopt or change**:

| Kind | Risk Profile factors present (below) | Proposed level | Reasons |
|---|---|---|---|
| Extreme pornography | None of the four listed | **Negligible** | The offence is possessing extreme pornographic images. The instance shows no images or video, so it is not possible here |
| Firearms, knives and other weapons | 3b (anonymous profiles) | **Low** | Only through a display name, which is at most 32 characters (`MAXIMUM_DISPLAY_NAME_SCALARS`) and which a moderator can hide. No listings, payments or messaging |
| Animal cruelty | None of the six listed | **Low** | No images, video, livestreaming or comments. A display name is the only text another rider sees |
| Cyberflashing (now its own kind, not part of intimate image abuse) | 3a, 3b | **Negligible** | The offence is sending a photograph or film of genitals. Nothing on the instance sends an image |
| CSAM URLs (U2U only) | None of the seven in RAG Table 13.1 (URLs), unless the owner answers yes to questions 2 or 4b below, and then few | **Low** | A display name is free text, so a URL can be typed into one (RAG fn 78 counts a URL in plain text). The URL table's "negligible" needs a service where users cannot share text; its "low" needs no evidence and few of its factors, which fits. An account is required, so its "high" (text shared without an account) does not apply |
| CSEA, overall | — | **Low** | The highest of its parts: grooming and CSAM URLs low, image-based CSAM negligible |

"Encouraging or assisting serious self-harm" in Step 2 is now **encouraging or assisting suicide (or
attempted suicide) and serious self-harm** (RAG Appendix A row 15). The level the owner adopted (low)
is unaffected by the change of name.

**2. The Risk Profile questionnaire, answered** (RAG Part 3 §1, Figure 1; a record of the answers is
what RAG ¶2.22–2.23 and RKG ¶3.7(a)–(b) ask for). Proposed answers, for the owner:

| Question | Proposed answer | Why |
|---|---|---|
| 1a Social media · 1b Messaging · 1d Adult · 1e Forum or chat room · 1f Marketplace · 1g File-sharing | No | None of these is offered (Step 1 above) |
| **1c Gaming service** (*"services which allow users to interact within partially or fully simulated virtual environments"*) | **Yes** | **New.** In a group ride or race the room re-simulates every rider on a route and sends each the others' progress (`apps/instance/src/room/core/room.ts`). Key harms: terrorism, CSEA (grooming), hate, and harassment, stalking, threats and abuse |
| 2 Child users | **The owner's answer** | It follows the [children's access assessment](childrens-access-assessment.md), whose 2026-11-03 amendment finds the guidance does not support its conclusion as recorded |
| 3a User profiles | Yes | Display names, already in Step 1 |
| **3a Fake user profiles** | **Yes** | **New.** A display name is self-chosen and unverified, so one rider can take another's name. Key harms: grooming; harassment; controlling or coercive behaviour; proceeds of crime; fraud; foreign interference |
| **3b Anonymous user profiles** | **Yes** | **New.** RAG fn 57 counts an alias (*"pseudonymity"*) where a user's identity is unknown to other users, which a self-chosen display name is. Users without accounts: no, because all nine room routes need a session (`apps/instance/src/rooms/routes.ts`) |
| 4a User connections (follow or subscribe) | No | There is no follower graph |
| **4b User groups** | **The owner's answer, or a lawyer's** | A private room joined by its code is a closed group of riders for a ride's lifetime, with no messaging in it. Whether that is a "user group" turns on the Register of Risks glossary, which was not read |
| 4b Group messaging · 5a Livestreaming · 5b Direct messaging · 5c Encrypted messaging · 5d Commenting · 5e Images or video · 5g Re-posting | No | None is offered. Voice is on Discord, which the owner ruled is not part of the service assessed |
| 5f Posting or sending location information | Yes | Routes in rooms, already in Step 1 |
| 6 Goods or services for sale · 7a Searching user-generated content · 7b Hyperlinking · 8 Recommender systems | No | None is offered. The listing is ordered by start time, then creation time. Riders cannot post links, though a display name can hold a URL as text (CSAM URLs, above). The Discord invite is made by the owner's bot, not by a rider |
| General: user base demographics; business model; commercial profile | Apply to every service | **Commercial profile is new to this record.** RAG Table 9 names *"low capacity or early-stage services"* as raising the likelihood of different kinds of illegal harm, because they *"may have limited technical skills and financial resources to introduce effective risk management"*. One owner who is also the only moderator is that profile |

**3. What the new factors do to the adopted levels.** Counted from RAG Table 9.1, with the answers
above (4b and 2, which are the owner's, left out; each adds one where it is listed):

| Kind | Factors present / factors listed for it | Adopted level |
|---|---|---|
| Harassment, stalking, threats and abuse | **5 / 13**: 1c, 3a, 3a fake, 3b, 5f | Low (owner) |
| Grooming | 4 / 16: 1c, 3a, 3a fake, 5f | Low |
| Hate | 3 / 11: 1c, 3a, 3b | Low |
| Foreign interference | 3 / 13: 3a, 3a fake, 3b | Low |
| Controlling or coercive behaviour | 2 / 8: 3a fake, 5f | Low |
| Terrorism · drugs · fraud · proceeds of crime · human trafficking | 2 each | Low |
| Cyberflashing | 2 / 7: 3a, 3b | Negligible (proposed in point 1: the offence needs an image) |
| Every other kind | 0 or 1 | As adopted |

- **Harassment, stalking, threats and abuse.** RAG Table 13: *low* fits a service that has *"used
  evidence … and … concluded that there is no evidence of this, and … identified no or few specific
  risk factors"*; *medium* fits *"several specific risk factors"* where the provider *"cannot
  demonstrate"* its systems are effective. RAG ¶3.3: *"Where the evidence of risk is not conclusive …
  we expect providers to err on the side of caution and select the higher risk level."* With five of
  thirteen factors and no evidence from use yet, **the guidance points towards medium for this kind
  until evidence from use supports low.** The owner's rating of low stands until the owner changes it.
  If it became medium, ICU D3–D6 come in (Step 2 above), and one more kind at medium would make the
  service multi-risk.
- **Grooming.** Without evidence that grooming has happened, RAG Table 13.3 rates a service medium or
  high only where users can communicate one-to-one with child users. The instance has no messaging,
  so the table's low row fits whatever the answer to question 2. RAG fn 91: children outside the UK count for grooming.
- **Hate and foreign interference** have three factors each, all of them display names or the game.
  Low remains arguable, and the first review should test it against the report queue.

**4. What the record must hold that this one does not yet** (RAG Table 8, RKG ¶3.6–3.7):

- confirmation that the Risk Profiles were consulted, with the factors found: point 2 above, once the
  owner adopts it;
- a level for every one of the 18 kinds, for each CSAM sub-kind and for CSEA overall: point 1 above;
- **a list of the evidence for each kind**. Every level above rests on reasoning about features. The
  core inputs (RAG Table 10) are the Risk Profiles, user complaints and reports, user data,
  retrospective analysis of incidents, and evidence from existing controls. The report queue, the
  moderation log and #912's record of each notice exist now, and the first review should list them
  for each kind;
- confirmation that the findings went through governance channels. The owner is the governance body
  (ICU A2, above), so the owner's approval is that confirmation, and the record should say so;
- **a written policy for keeping the assessment up to date** that names a review cycle of no more than
  12 months and a responsible person (RAG ¶2.48–2.49, ¶2.68). Proposed: *"The owner reviews this
  assessment at least every 12 months, first within 3 months of the instance opening to the public,
  before any change in Step 4's list, and whenever Ofcom changes a Risk Profile that applies to this
  service. The owner is responsible."*

**5. A trigger Step 4 does not list.** The duty to keep the assessment up to date includes updating
it *"if Ofcom makes any significant change to a Risk Profile that relates to your service"* (RAG
¶2.44(b), ¶2.50–2.53). V2.0 has 18 kinds where the version relied on had 17, and it links the
new one, cyberflashing, to user profiles, anonymous profiles and user connections among others. It
was published before this assessment was adopted, so points 1–3 are that update. Ofcom offers email updates of changes to the Risk Profiles
(¶2.51); subscribing to them is the owner's choice.

**6. More changes Ofcom counts as significant** (RAG Part 3 §4, Table 14). Proposed additions to the
s.9(4) list in Step 4:

- moving the report control, or changing how prominent it is, or how reporting works;
- any revenue, sponsorship or paid tier, and any change in who runs or owns the instance;
- promoting the instance to grow its user base faster.

Table 14 also names *"Change in capacity (in terms of number of employees)"*, which the list already
covers as a second moderator, or losing the only one.

**7. A timing sentence for the lawyer.** RAG ¶2.18 says: *"If your service is in operation on or before
the publication of this guidance, you need to complete your first risk assessment within three months
of the date on which this guidance is published."* Read literally against V2.0's date, that is 25
September 2026, five days before this assessment was completed. It matters only if the instance was
already a Part 3 service before 25 June 2026 (open point 1). The sentence looks carried over from the
2024 version, where it set the 16 March 2025 deadline. ¶2.19 repeats the Act's rule for a new service:
three months from when it starts or comes into scope.

#### What the Record-Keeping and Review Guidance changes

**8. No exemption.** RKG ¶1.2: the guidance *"applies to providers of regulated U2U services"*, and it
describes no s.23(7) exemption. The open question in the s.23 row of Step 3 is answered as far as
Ofcom's guidance goes: treat the record-keeping and review duties as applying.

**9. How the records are kept** (RKG ¶2.1–2.7): durable, in English, *"dated when it is made and on each
occasion that it is updated"*, able to be given to Ofcom *"easily and quickly"*, and with earlier
versions kept for at least three years after they stop being current. This file's git history is the
version record. It must not be rewritten, and each update needs a date, as this entry has.

**10. A record for each Codes measure** (RKG ¶4.2): a description, **which Code** it comes from, and
**the date it takes effect**. Step 3's table has the descriptions and the measure numbers, but no Code
version and no dates, and its "State on 2026-09-30" column is out of date: #907, #910, #911, #912 and
#913 closed on 2026-10-16 and #909 on 2026-10-23. The first review should add a date to each measure.
(This entry checked only that the issues closed. It did not check what they shipped.)

**11. A record of alternative measures** (RKG ¶5.3–5.4). Where an applicable Codes measure is not
taken, the record must name it, the alternative and its date, how the alternative meets the duty, and
how s.49(5) (freedom of expression and privacy) was weighed. Step 3 records no alternatives. With one
moderator, an appeal is decided by the person who took the decision (ICU D9). Whether that meets D9 or
is an alternative needs a decision, and then a record.

**12. A compliance review, which is a separate duty** (RKG §6). The owner must review compliance with
ss.10, 20 and 21 (and the other RKG Table 3 duties that apply) *"regularly"*, *"as a minimum … once a
year"* (¶6.5), and after any significant change. Step 4 commits only to reviewing the assessment.
Proposed: one review a year that covers both, recorded with its date.

#### The open points above, after this reading

- Open point 4 is done: the documents were read on 2026-11-03.
- Open point 2 is answered by point 1 of this entry, as a proposal for the owner.
- **New, for the owner:** the answers to questionnaire questions 2 and 4b; whether to adopt the
  proposed rows and answers; the level for harassment, stalking, threats and abuse in the light of
  point 3; and whether the appeal procedure meets ICU D9 or is recorded as an alternative.
- **Still not read:** Ofcom's Register of Risks (updated 25 June 2026), which RAG Part 1 ¶2.6 recommends and
  which holds the glossary that would settle question 4b.
