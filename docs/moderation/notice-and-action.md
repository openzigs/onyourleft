# Notice-and-action, content reports and complaints: the procedure for the project's instance

> **DRAFT, pending the owner's approval.** This is a draft for the owner to review. It is **not
> legal advice**, and no lawyer has checked it. It is not the procedure in force until the owner has
> approved it and the product changes it depends on exist.

- **Date of this draft**: 2026-09-30
- **Issues**: [#887](https://github.com/openzigs/onyourleft/issues/887) (EU DSA Art. 16) and
  [#886](https://github.com/openzigs/onyourleft/issues/886) (UK Online Safety Act ss.20–21). Public
  rooms ([#788](https://github.com/openzigs/onyourleft/issues/788)) stay blocked until the owner
  approves it.
- **Sources relied on**: [spike 0019](../spikes/0019-online-safety-act-and-dsa-read-for-the-projects-instance.md),
  read first-hand on 2026-09-30: DSA (Regulation (EU) 2022/2065, OJ L 277, 27.10.2022) Arts 16–18 and
  recitals 50, 52 and 54; OSA ss.10, 20, 20A, 21, 23 and 66; Ofcom's Illegal content Codes of
  Practice (O1).
- **Whether the DSA applies to the project at all is open.** See [DSA scope](dsa-scope.md). This
  procedure is written to meet Art. 16 either way, because the UK duties need most of the same steps.
- **Related drafts**: [statements of reasons](statement-of-reasons.md),
  [illegal content risk assessment](illegal-content-risk-assessment.md). The tools a moderator has are
  in [`docs/moderation.md`](../moderation.md).

## Sign-off (left blank for the owner)

| | |
|---|---|
| Procedure approved on | |
| Contact address chosen | |
| Conflict-of-interest option chosen (see "A notice or complaint about the moderator") | |
| Target times chosen (see "Target times") | |
| Signature | |

## One moderator, and what that supersedes

The owner ruled on 2026-09-30 ([#905](https://github.com/openzigs/onyourleft/issues/905)) that the
project's instance has **one moderator, the owner, with no deputy**. That reverses ruling Q13 ("the
owner plus a named deputy"). **#887's acceptance criterion names "a named deputy (ruling Q13)", and
that criterion is superseded by #905.** This procedure is written for one person.
`docs/moderation.md` still describes two moderator roles. #905 owns that wording.

## Where a notice comes in

| Route | Who can use it | State on 2026-09-30 |
|---|---|---|
| **The notice page on the instance** (for example `/report`), for anybody, with or without an account | Anybody: users and people who are not users | **Not built.** Filed as [#907](https://github.com/openzigs/onyourleft/issues/907) |
| **A link from the app** to that page, from the report control and from About | Riders | **Not built.** Filed as [#907](https://github.com/openzigs/onyourleft/issues/907) |
| **The legal and contact page on the instance** (for example `/legal`), naming the points of contact and the notice page | Anybody | **Not built.** Filed as [#908](https://github.com/openzigs/onyourleft/issues/908) |
| **The private contact address** `<CONTACT-ADDRESS — owner to choose>` | Anybody | **Not chosen.** It is also the address for statements of reasons that cannot be delivered in the app, and for requests to delete |
| **Reporting a rider** in the app (#83), and in a room (#789) | Signed-in riders only | #83's report exists. #789's in-room report is not built |

⚠️ **Until #907 exists and the address is chosen, a person who is not a rider has no way to send a
notice.** DSA Art. 16(1) says *"any individual or entity"*, and OSA s.20(2) covers *"affected
persons"*, who are not users (s.20(5)). So this procedure cannot be followed in full before then.

## What a notice can carry

DSA Art. 16(2) requires the mechanism to *enable* a notice containing all of these. It does not make
any of them a condition of acting on a notice.

| Art. 16(2) | Field on the notice page (#907) | Note |
|---|---|---|
| (a) *"a sufficiently substantiated explanation of the reasons why the individual or entity alleges the information in question to be illegal content"* | Why you think it is illegal (free text) | |
| (b) *"a clear indication of the exact electronic location of that information"* | Which item: a display name, a room, a route shown in a room, a race result, each by an identifier the app shows. One notice may name several items (recital 50) | Items other than a display name cannot be taken down on their own yet: [#913](https://github.com/openzigs/onyourleft/issues/913) |
| (c) *"the name and email address of the individual or entity submitting the notice, except in the case of information considered to involve one of the offences referred to in Articles 3 to 7 of Directive 2011/93/EU"* | Your name and email, **optional** | Recital 50: the mechanism *"should allow, but not require, the identification"* of the notifier. Never required for the CSAM offences |
| (d) *"a statement confirming the bona fide belief … that the information and allegations contained therein are accurate and complete"* | A tick box | |

The same page offers the **intimate image content report** of OSA s.20A(2) as a separate choice. It
carries the declarations in s.20A(2)(a)–(e): that the content is intimate image content, that the
report is made by the subject or on their behalf, that it is made in good faith and is true, enough
information to identify the content, and contact details. The instance shows no images, so such
content is unlikely to be present, but the report must still be possible (s.20A(1)).

## The steps

### 1. Record it

Every notice and complaint is recorded when it arrives, with the time. A record of **received,
acknowledged, decided and notifier told** is filed as
[#912](https://github.com/openzigs/onyourleft/issues/912). Until it exists, the moderator keeps the
record by hand. OSA s.23 requires written records, and Ofcom can ask for them (O2).

### 2. Confirm receipt

DSA Art. 16(4): *"Where the notice contains the electronic contact information of the individual or
entity that submitted it, the provider of hosting services shall, without undue delay, send a
confirmation of receipt."* The wording is in [statements of reasons](statement-of-reasons.md#confirmation-of-receipt).

### 3. Put it in order

Take notices in this order, whatever order they arrived in:

1. **A threat to someone's life or safety.** DSA recital 52: providers *"can be expected to act without
   delay"*. DSA Art. 18(1): where the provider becomes aware of information giving rise to a suspicion
   of *"a criminal offence involving a threat to the life or safety of a person or persons"*, it
   *"shall promptly inform the law enforcement or judicial authorities of the Member State or Member
   States concerned"*, or under Art. 18(2), those where its legal representative is, or Europol.
   ⚠️ Art. 18 applies only if the DSA applies ([DSA scope](dsa-scope.md)). For a threat in the UK,
   this draft proposes contacting the police. That is an operational step, and no UK text read
   requires it.
2. **Child sexual exploitation and abuse.** OSA s.66(1): a UK provider *"reports all detected and
   unreported CSEA content present on the service to the NCA"*. Do not copy, forward or keep the
   content beyond what the report needs.
3. **An intimate image content report.** OSA s.10(3A): take down the content, and content identified
   as the same or substantially the same, *"as soon as reasonably practicable, and no later than 48
   hours"* after receiving the report. s.21(2A) requires an expedited complaints procedure for the
   person who reported it.
4. **Everything else**, oldest first.

### 4. Decide

- Codes ICU C1.3: review the content and either make an **illegal content judgement**, or, where the
  terms of service prohibit that kind of illegal content, decide whether it **breaches the terms**.
  (There are no terms of service yet: [#909](https://github.com/openzigs/onyourleft/issues/909).)
- DSA Art. 16(3): a notice gives actual knowledge where it lets *"a diligent provider … identify the
  illegality … without a detailed legal examination"*. A notice that needs a detailed legal
  examination is recorded as such, with the decision and why.
- DSA Art. 16(6): decide *"in a timely, diligent, non-arbitrary and objective manner"*. **No automated
  means are used** to process a notice or take a decision. If that ever changes, the notification in
  step 6 must say so.
- **Take the smallest action that removes the illegal content**: hide the one item
  ([#913](https://github.com/openzigs/onyourleft/issues/913), not built), hide the display name, or
  suspend the account. Suspension is for a rider, not for a single item. Nothing is deleted:
  suspension must not become a way to destroy a rider's data (`docs/moderation.md`, #83).
- **Content on Discord** is Discord's to act on. Tell the notifier how to report it to Discord. If the
  room's link is the problem, the instance can stop showing it.
- **Content on another operator's instance** is that operator's. Each operator is the provider of
  their own instance (s.226). Tell the notifier which instance it is, if known.
- Write every action to the moderation log with a reason. Do not write a rider's personal details into
  a reason: the log keeps entries after erasure (`docs/moderation.md`).

### 5. Tell the rider (the statement of reasons)

DSA Art. 17(1): a statement of reasons to the affected rider for a restriction imposed because the
content is illegal or against the terms. [Templates](statement-of-reasons.md). ⚠️ The instance holds
no email for a rider, and whether an in-app channel is "electronic contact details" under Art. 17(2)
is **open**. A channel is filed as [#910](https://github.com/openzigs/onyourleft/issues/910). Do not
reveal who sent the notice unless it is necessary to identify the illegality (recital 54).

### 6. Tell the notifier

DSA Art. 16(5): *"without undue delay, notify that individual or entity of its decision in respect of
the information to which the notice relates, providing information on the possibilities for redress in
respect of that decision."* Only possible where the notifier gave contact details.
[Template](statement-of-reasons.md#decision-on-a-notice).

### 7. Complaints and appeals

OSA s.21(4) names the complaints the procedure must take: about content considered illegal (a); that
the provider is not complying with s.10, s.20 or s.22 (b); from a rider whose content was taken down
(c); and from a rider who was warned, suspended or restricted (d). Codes ICU D9: *"determine relevant
complaints which are appeals promptly"*. D10: act on the determination, which can mean restoring a
display name or lifting a suspension. The route is filed as
[#911](https://github.com/openzigs/onyourleft/issues/911). A suspended rider cannot sign in today,
so #911 must reach them some other way.

ICU D13 is the Codes' measure on manifestly unfounded complaints. Its text was not read line by line
(spike §1, O1). Proposed until it is: record the complaint and why it was judged unfounded, and say so
to the complainant.

## A notice or complaint about the moderator

With one moderator, every decision is the moderator's own, and some notices will be about them: their
display name, a room they created, a race they rode, or how they handled an earlier notice (OSA
s.21(4)(b)). The software already refuses to let a moderator decide a report about themselves, and
with one moderator such a report stays open for ever. [#905](https://github.com/openzigs/onyourleft/issues/905)
item 1 decides what the software does. This section is the procedure around it.

**Always, whichever option is chosen:**

- Record the notice, and record that it is about the moderator.
- If the notice names content the moderator provided (their display name, their room), the moderator
  may **remove their own content at once**. Removing it needs no judgement about anybody else.
- The moderator never uses a moderator's tools to act on the notifier because of the notice.
- The notifier is told that the notice is about the moderator, and which option below handles it.

**The options, for the owner to choose one** (an owner decision, recorded in the sign-off block):

| Option | How it works | Cost |
|---|---|---|
| **1. A named reviewer, who is not a moderator** | The owner names one person, outside the moderation tooling, who decides notices and appeals about the moderator. The moderator carries out their decision | A second person is needed after all, for this narrow role. It does not reverse #905, because the reviewer holds no moderator key |
| **2. Another operator reviews** | An arrangement with the operator of another instance to decide such notices | Depends on somebody else, and on there being another operator |
| **3. Self-review, declared** | The moderator decides, writes a conflict-of-interest statement into the record, waits a stated time before deciding, and tells the notifier they can go to a court (DSA recital 55: a right to an effective remedy before a court) | Weakest. ICU D12.3 asks for complaints to go to *"an appropriate individual"*, and whether a conflicted one qualifies is not answered by the texts read |
| **4. Remove and review later** | For a notice about the moderator's own content, remove it first and decide afterwards | Covers only content, not complaints about how the moderator acted |

## Target times

The texts read say *"without undue delay"*, *"promptly"* and *"swiftly"*, and give one fixed time: 48
hours under s.10(3A). **The owner chooses targets** for the rest and records them in the sign-off
block. They are not legal limits. For a single volunteer moderator the targets must be ones they can
keep, including while away. What happens to the queue when the only moderator is away is part of the
same decision.

## What this procedure does not cover

- Orders from authorities (DSA Arts 9 and 10) and the points of contact for them (Art. 11): see
  [#908](https://github.com/openzigs/onyourleft/issues/908) and [DSA scope](dsa-scope.md).
- Moderation inside a room during a ride: #789.
- A self-hoster's instance. They are the provider of their own instance and owe their own procedure.
