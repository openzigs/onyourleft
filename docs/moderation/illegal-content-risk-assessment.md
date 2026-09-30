# Illegal content risk assessment: the project's instance with public rooms enabled

> **DRAFT, pending the owner's approval.** This is a draft for the owner to review. It is **not
> legal advice**, and no lawyer has checked it. It is not a completed assessment under the Online
> Safety Act 2023 until the owner has reviewed it, changed what they disagree with, and signed the
> block below.

- **Date of this draft**: 2026-09-30
- **Issue**: [#886](https://github.com/openzigs/onyourleft/issues/886). Public rooms
  ([#788](https://github.com/openzigs/onyourleft/issues/788)) stay blocked until the owner approves
  this document and the others in this directory.
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
  ([second comment](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911633500)).
- **Public rooms wait for [#907](https://github.com/openzigs/onyourleft/issues/907),
  [#910](https://github.com/openzigs/onyourleft/issues/910) and
  [#911](https://github.com/openzigs/onyourleft/issues/911)** (owner, 2026-09-30): reporting without an
  account, a statement of reasons the rider can read, and complaints and appeals. Private rooms can
  ship before them.
- ⚠️ **Before final sign-off, three Ofcom documents must be read in a browser**: the Risk
  Assessment Guidance (with the current Risk Profiles), the Children's Access Assessments Guidance
  and the Record-Keeping Guidance. None of them could be read for this draft (spike 0019 §5 items
  1–3). The owner recorded this as still open on 2026-09-30.
- **Related drafts**: [children's access assessment](childrens-access-assessment.md),
  [notice-and-action and complaints](notice-and-action.md),
  [statements of reasons](statement-of-reasons.md), [DSA scope](dsa-scope.md). The operator's
  guide is [`docs/moderation.md`](../moderation.md).

## Sign-off (left blank for the owner)

| | |
|---|---|
| Service assessed | |
| Assessment completed on | |
| Completed by | |
| Named person responsible for the assessment | |
| Approved by | |
| Current Ofcom Risk Profiles consulted (version and date) | |
| Next review due | |
| Signature | |

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
| **The Discord voice link** | A link, in a room, to a voice channel on Discord that a bot made for that room. The voice itself is on Discord, not on the instance. The spike 0018 recommendation (awaiting the owner) holds account linking for public rooms | #794, [spike 0018](../spikes/0018-discord-terms-for-a-self-hosted-voice-bot.md) |
| **Plausibility flags** | Shown to **every rider in the race**, beside the flagged rider's result and display name, with the duration the flag was raised for. A flag is generated by the instance from the room's own re-simulation, not by a rider. Each flag is also filed as a report to the moderator | #785, ADR 0028 D-2 rule 3; #789 |
| **Reports** | Seen by the moderator only, not by other riders | #83, #789 |

**What the instance does not offer**, which matters for several kinds of harm below: no images or
video uploaded or shown, no direct messages, no follower or friend graph, no feed, no comments, no
livestreaming on the instance, and no recommender algorithm. A rider's rides are synced to the
instance (#776) but are not shown to other riders (`docs/moderation.md`).

**OPEN, for the owner and a lawyer: the Discord link.** Whether Discord-hosted voice is part of
*this* service is not settled by the text read. The instance does not host, store or relay the
voice. It shows a link, and its bot creates and deletes the channel. s.55(4)(b) treats a bot as a
user only where it is *"not controlled by or on behalf of the provider"*. The owner's bot would be
controlled by the provider. This draft assesses the link as a feature that sends riders to a
service where the instance's moderation does not reach, and does not assess Discord's own service.

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
could not be read (spike §5 item 2). **Before sign-off, a person with a browser must take the full
list from the current Risk Profiles and add a row for every kind not below.** The rows below are the
kinds named in the risk factors and measures that spike 0019 quotes.

## Step 2: assess the risk of harm

Levels use O9's scale: negligible or no risk, low, medium, high. ⚠️ **Every level below is a
proposal for the owner, except harassment and stalking, which the owner rated on 2026-09-30.**
O9: a *low* level needs evidence and *"no or few specific risk factors"*.
A *negligible* level where some risk factors are present *"will normally need comprehensive
evidence"*. There is no usage evidence yet, because the service has not opened. The first review
must replace reasoning with evidence (Step 4).

| Kind of illegal harm | Relevant risk factors (O9) | Proposed level | Reasons |
|---|---|---|---|
| Harassment, stalking, threats and abuse | User profiles; **posting or sending location information** | **Low** (owner, 2026-09-30) | **The owner rated harassment and stalking through shared routes and public plausibility flags low on 2026-09-30**, naming three mitigations: privacy-zone trims, no position in rooms, and no location in flags. The owner must be able to defend this rating. A display name can carry abuse. A plausibility flag is shown to every rider in a race beside the flagged rider's name (#785), so a flag that is wrong, or read as an accusation of cheating, could draw abuse towards that rider; it is generated by the instance, not by a rider, and it is also a report the moderator handles (#789). A route shown to strangers in a public room is location information, and O9 says it *"may be used by potential perpetrators to track the whereabouts of survivors and victims"*. Mitigations: routes starting in a privacy zone are refused (#784), the listing shows no coordinates (#788), routes are deleted when the room closes unless the creator separately shared them, blocking will keep two riders out of the same public room (#789, not built yet), and there is no messaging. ⚠️ A route that starts just outside a privacy zone, or a rider with no privacy zone, still reveals a place the rider rides from |
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
every 12 months (O2; O9 ¶2.45). The first review should come **within three months of public rooms
opening** (proposed; an owner decision), because the levels above rest on reasoning, and it should
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
4. Whether the Discord link is part of the service assessed (owner and lawyer).
5. Reading the three Ofcom documents named at the top (the Risk Assessment Guidance, the Children's
   Access Assessments Guidance and the Record-Keeping Guidance) in a browser before final sign-off.
6. The contact address, `<CONTACT-ADDRESS — owner to choose>` (owner).

Decided by the owner on 2026-09-30, and no longer open here: the level for harassment and stalking
(low), and the ICU A2 accountable individual (the owner, who is also the governance body).
