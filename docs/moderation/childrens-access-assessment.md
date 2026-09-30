# Children's access assessment: the project's instance with public rooms enabled

> **DRAFT, pending the owner's approval.** This is a draft for the owner to review. It is **not
> legal advice**, and no lawyer has checked it. **Its conclusion is left for the owner.** It is not
> a children's access assessment under the Online Safety Act 2023 until the owner has chosen a
> conclusion, recorded the evidence for it, and signed the block below.

- **Date of this draft**: 2026-09-30
- **Issue**: [#886](https://github.com/openzigs/onyourleft/issues/886). Public rooms
  ([#788](https://github.com/openzigs/onyourleft/issues/788)) stay blocked until the owner approves
  it.
- **Sources relied on**: [spike 0019](../spikes/0019-online-safety-act-and-dsa-read-for-the-projects-instance.md)
  §2 Q3, read first-hand on 2026-09-30: the Online Safety Act 2023 ss.35–37 and s.230; Ofcom's
  children's access assessment page (O4, updated 29 June 2026), its toolkit (O5), its guidance on
  highly effective age assurance (O6) and its age assurance page (O7). ⚠️ **Ofcom's Children's
  Access Assessments Guidance PDF could not be read** (403, and an empty extraction; spike §5
  item 1). It must be read before sign-off.
- **Related drafts**: [illegal content risk assessment](illegal-content-risk-assessment.md), which
  describes the service and its features.

## Sign-off (left blank for the owner)

| | |
|---|---|
| Service assessed | |
| Stage 1 conclusion | |
| Stage 2 conclusion (if reached) | |
| Steps taken and evidence relied on | |
| Completed on | |
| Completed by | |
| Next assessment due (not more than one year later, s.36(3)) | |
| Signature | |

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
the service or any part of it. The assessment therefore goes to Stage 2. The owner decides whether
to record that conclusion, or to adopt highly effective age assurance for some part and re-run
Stage 1 for that part (option C below).

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
| **Is it publicly known that the service is used by children?** (O5's example) | Nothing is known about this service: it has not opened. Whether it becomes known that children use it, or smart-trainer apps of this kind, is a fact the owner can check. | No evidence either way yet |
| **Ofcom's own expectation** | O7: *"we anticipate that most Part 3 services that do not use highly effective age assurance are likely to be accessed by children within the meaning of the Act."* | Points towards "likely" |

## The conclusion, left for the owner

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

1. The conclusion: A, B or C (owner).
2. Whether human approval is admissible as Stage 2 evidence (lawyer).
3. Ofcom's Children's Access Assessments Guidance, which could not be fetched (spike §5 item 1).
4. What ss.11–12 would require under option A (not read).
5. Whether any EU rule on minors applies. Spike 0019 records an EU "KIDS ACT" proposal second-hand
   only (source S1), and DSA Art. 14(3) applies only to a service *"primarily directed at minors or
   … predominantly used by them"*.
