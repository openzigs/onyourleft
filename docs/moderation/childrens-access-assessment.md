# Children's access assessment: the project's instance with public rooms enabled

> **Adopted by the owner on 2026-09-30.** It is **not legal advice**, and no lawyer has checked
> it.

- **Date**: 2026-09-30
- **Issue**: [#886](https://github.com/openzigs/onyourleft/issues/886). Public rooms
  ([#788](https://github.com/openzigs/onyourleft/issues/788)) stay blocked until [#907](https://github.com/openzigs/onyourleft/issues/907),
  [#910](https://github.com/openzigs/onyourleft/issues/910) and [#911](https://github.com/openzigs/onyourleft/issues/911) ship (owner, 2026-09-30). Private rooms do not wait.
- **Sources relied on**: [spike 0019](../spikes/0019-online-safety-act-and-dsa-read-for-the-projects-instance.md)
  §2 Q3, read first-hand on 2026-09-30: the Online Safety Act 2023 ss.35–37 and s.230; Ofcom's
  children's access assessment page (O4, updated 29 June 2026), its toolkit (O5), its guidance on
  highly effective age assurance (O6) and its age assurance page (O7). ⚠️ **Ofcom's Children's
  Access Assessments Guidance PDF could not be read** (403, and an empty extraction; spike §5
  item 1). It is to be read before the first review.
- **Owner decisions of 2026-09-30** are written into this draft where they apply. They were
  recorded on [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5911594101)
  ([second comment](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5911633018)) and on
  [#887](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911594478)
  ([second comment](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911633500)),
  with later comments on [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5913128189) (the Discord link),
  [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5913273878) and
  [#887](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5913274367) (the contact address and the
  sign-off).
- ⚠️ **Still open: three Ofcom guidance documents have not yet been read in full**: the Risk
  Assessment Guidance (with the current Risk Profiles), the Children's Access Assessments Guidance
  and the Record-Keeping Guidance (spike 0019 §5 items 1–3). They are to be read before the first
  review, which is due within 3 months of opening (owner, 2026-09-30).
- **Related drafts**: [illegal content risk assessment](illegal-content-risk-assessment.md), which
  describes the service and its features.

## Sign-off

| | |
|---|---|
| Service assessed | The project's instance with public rooms enabled |
| Stage 1 conclusion | Possible for children to access: no highly effective age assurance is used (Stage 1, below) |
| Stage 2 conclusion (if reached) | The child user condition is not met: not likely to be accessed by children (option B) |
| Steps taken and evidence relied on | Registration is `approval` (the owner sees every sign-up); riders confirm they are 18 or over; a cycling-training instance. Ofcom may not accept this evidence alone |
| Completed on | 2026-09-30 |
| Completed by | Drafted in #914; approved by the owner |
| Next assessment due (not more than one year later, s.36(3)) | A review within 3 months of opening |
| Signature | The owner, 2026-09-30: *"Safety draft looks good"* |

s.36(7): *"A provider must make and keep a written record, in an easily understandable form, of
every children's access assessment."*

## The ruling this assessment has to weigh

The owner ruled on 2026-09-28 (#16, Q5) that **public rooms are 18 and over, self-declared**, with
approval-required registration. The instance stores the confirmation and its date and never asks for
or keeps a date of birth (`docs/moderation.md`, #775).

That ruling is a **fact this assessment weighs. It does not settle the question.** The rest of this
document says why.

## Stage 1: is it possible for children to access the service, or a part of it?

s.35(1)(a) asks *"whether it is possible for children to access the service or a part of the
service"*.

**The test for concluding "no" is narrow.** s.35(2): *"A provider is only entitled to conclude that
it is not possible for children to access a service, or a part of it, if age verification or age
estimation is used on the service with the result that children are not normally able to access the
service or that part of it."*

**Self-declaration is not age verification or age estimation.** s.230(4): *"A measure which requires
a user to self-declare their age (without more) is not to be regarded as age verification or age
estimation."* Ofcom's guidance (O6 ¶3.14) names *"asking a user to tick a box to confirm that they
are 18 years of age or over"* as such a measure, and ¶3.16 names a terms-of-service condition that
prohibits under-18s *"without any additional age assurance"*. O4 lists *"your terms and conditions
say the service is for over 18s only"* among methods that are not highly effective.

**Approval by a person is not age verification or age estimation either.** The owner approves an
account seeing a self-declared confirmation and a name, and no evidence of age
([risk assessment, "What `approval` does and does not contribute"](illegal-content-risk-assessment.md#what-approval-does-and-does-not-contribute)).
Nothing read says a human approval of this kind counts. Whether it could be admissible as evidence
at Stage 2 is open (below).

**The parts of the service.** The 18+ confirmation gates public rooms only. Registration, sync and
private group rides and races (#784, #785) have no age rule at all today. So even a public-room
gate that met s.35(2) would settle Stage 1 for that part only.

**What the text points to at Stage 1**: with self-declaration and human approval as the only
measures, the texts read do not allow the conclusion that it is not possible for children to access
the service or any part of it. The assessment therefore goes to Stage 2. The owner did not
adopt highly effective age assurance (option C below), and chose option B at Stage 2 on 2026-09-30.

## Stage 2: is the child user condition met?

s.35(3): the condition is met if *"(a) there is a significant number of children who are users of
the service or of that part of it, or (b) the service, or that part of it, is of a kind likely to
attract a significant number of users who are children."*

s.35(4): "significant" includes a number significant in proportion to the UK users, and whether (a)
is met is *"to be based on evidence about who actually uses a service, rather than who the intended
users of the service are"*.

O4: *"The Act does not define what is meant by a 'significant number' of children … Even a relatively
small number of children could be significant in terms of the risk of harm. We suggest you should err
on the side of caution in making your assessment."*

### The evidence available, weighed

| Factor | What is known | Weight |
|---|---|---|
| **Who actually uses it** (s.35(4)(b)) | Nothing yet: the instance has not opened to the public, and it collects no date of birth. | No evidence either way. A "not likely" conclusion would need evidence the instance does not collect |
| **Self-declared 18+ confirmations** | Every public-room rider will have confirmed. | O5: *"you should not rely on this data alone to conclude that you do not have a significant number of users who are children"* |
| **Human approval of each account** | The owner sees a name and a confirmation. | ⚠️ **OPEN.** Whether it is admissible evidence, and how much it weighs, is not answered by the texts read. It is not evidence of age |
| **Benefits to children** (O4 factor) | Training, ride recording and a trainer game benefit a junior cyclist as much as an adult. | Points towards "likely" |
| **Content appealing to children** (O4 factor) | Routes, rides, races and a game. Cycling has junior riders and junior racing, and races are the kind of content a junior cyclist would look for. | Points towards "likely" for the game and races |
| **Design appealing to children** (O4 factor) | A 3D trainer game with riders on a road, which a junior cyclist could use as readily as an adult. The app is not designed for children, and nothing in it targets them. | Mixed |
| **Children in the commercial strategy** (O4 factor) | There is no commercial strategy. | Points towards "not likely" |
| **Is it publicly known that the service is used by children?** (O5's example) | Nothing is known about this service: it has not opened. Whether it becomes known that children use it is a fact the owner can check once it opens. | No evidence either way yet |
| **Ofcom's own expectation** | O7: *"we anticipate that most Part 3 services that do not use highly effective age assurance are likely to be accessed by children within the meaning of the Act."* | Points towards "likely" |

## The conclusion: option B, the owner's decision of 2026-09-30

**The owner concluded on 2026-09-30 that the service is not likely to be accessed by children**
(option B: the child user condition is not met). The evidence recorded for it:

- registration is `approval`: the owner sees every sign-up;
- riders confirm they are 18 or over;
- it is a cycling-training instance.

**Review it within 3 months of the instance opening** (owner, 2026-09-30).

⚠️ **As this draft notes, Ofcom may not accept this evidence alone.** O5 advises against relying on
self-declared age data alone, approval by a person is not evidence of age, and O7 expects most
services without highly effective age assurance to be likely to be accessed by children (see the
table above).

The three options the draft weighed are kept below as the record of what was considered.


### Option A: conclude that the service is likely to be accessed by children

- What follows: the children's risk assessment and the children's safety duties (s.37(1) refers to
  ss.11 and 12). ⚠️ **Those sections were not read** (spike §5 item 12), so this draft cannot say
  what they would ask of the instance. That is the next reading.
- The 18+ rule for public rooms can stay as the owner's product rule. It does not change the
  conclusion.

### Option B: conclude that the child user condition is not met

- O4: *"you must record the steps taken and the detailed evidence used to reach that conclusion."*
  With no users yet and no date of birth collected, the evidence above does not appear to support
  this conclusion today. It could be reached later, on evidence from real use.
- s.36(4)(c): a new assessment *"in response to evidence about a significant increase in the number
  of children using the service"*.

### Option C: adopt highly effective age assurance for a part of the service

- O4: *"You can only conclude that it is not possible for children to access the service if you are
  using highly effective age assurance, as well as access control measures that prevent users from
  accessing the service if they have not been identified as adults via the age assurance process."*
- For public rooms only, this could let Stage 1 conclude "not possible" for that part. It would
  change ruling Q5 (self-declared, no date of birth), it would bring a third-party age assurance
  provider and more personal data into the service, and it would cost money or effort. It would not
  cover the rest of the instance.
- A new ruling by the owner. Nothing here recommends it.

### Whatever is chosen

- The owner's review: within 3 months of the instance opening (above).
- Repeat the assessment **not more than one year apart** (s.36(3)), and before any significant change
  (s.36(4)(a)). The list of significant changes in the
  [risk assessment](illegal-content-risk-assessment.md#step-4-report-review-and-update) applies here
  too.
- s.37(4)–(5): if the first assessment is not carried out, the service *"is to be treated as likely
  to be accessed by children"* from the date it was due.
- **Timing.** O4: a service that came into scope after 16 January 2025 has *"three months to complete
  your assessment from the first day your service became available to users in the UK"*. Whether the
  instance is already in scope is open (risk assessment, "OPEN, for a lawyer, and it affects the
  date").

## Open points this draft does not settle

1. Whether human approval is admissible as Stage 2 evidence (lawyer).
2. The three Ofcom documents named at the top (the Risk Assessment Guidance, the Children's Access
   Assessments Guidance and the Record-Keeping Guidance), not yet read in full, to be read before the
   first review (spike §5 items 1–3).
3. What ss.11–12 would require under option A (not read).
4. Whether any EU rule on minors applies. Spike 0019 records an EU "KIDS ACT" proposal second-hand
   only (source S1), and DSA Art. 14(3) applies only to a service *"primarily directed at minors or
   … predominantly used by them"*.

Decided by the owner on 2026-09-30, and no longer open here: the conclusion (option B).
