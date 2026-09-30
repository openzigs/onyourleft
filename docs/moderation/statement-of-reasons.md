# Statements of reasons, and what a notifier is told: templates for the project's instance

> **Adopted by the owner on 2026-09-30.** These are **not legal advice**, and no lawyer has checked
> them.

- **Date**: 2026-09-30
- **Issue**: [#887](https://github.com/openzigs/onyourleft/issues/887). The procedure that uses these
  templates is [notice-and-action](notice-and-action.md).
- **Sources relied on**: [spike 0019](../spikes/0019-online-safety-act-and-dsa-read-for-the-projects-instance.md)
  §3 Q8, read first-hand on 2026-09-30: DSA Arts 16(4)–(5) and 17(1)–(5), and recitals 54 and 55; and
  the Commission's Transparency Database FAQ (E5, updated 7 July 2025).
- **The owner treats the DSA as probably not applying** (2026-09-30: a free service, one person, not
  provided for remuneration), and **follows Arts 16 and 17 voluntarily anyway**. See
  [DSA scope](dsa-scope.md). Telling a rider why they were restricted is good moderation whatever the
  law requires.
- **Owner decisions of 2026-09-30** are written into this draft where they apply. They were
  recorded on [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5911594101)
  ([second comment](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5911633018)) and on
  [#887](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911594478)
  ([second comment](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5911633500)),
  with later comments on [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5913128189) (the Discord link),
  [#886](https://github.com/openzigs/onyourleft/issues/886#issuecomment-5913273878) and
  [#887](https://github.com/openzigs/onyourleft/issues/887#issuecomment-5913274367) (the contact address and the
  sign-off).

## Sign-off

| | |
|---|---|
| Templates approved on | 2026-09-30, by the owner: *"Safety draft looks good"* |
| Delivery channel chosen (see "OPEN: where a statement is delivered") | Not chosen. Public rooms wait for #910; until then a rider can write to [matt@openzigs.ai](mailto:matt@openzigs.ai) |
| Signature | The owner, 2026-09-30: *"Safety draft looks good"* |

## When a statement is owed

DSA Art. 17(1): a *"clear and specific statement of reasons to any affected recipients of the
service"* for any of these restrictions, imposed *"on the ground that the information provided by the
recipient of the service is illegal content or incompatible with their terms and conditions"*:

| Art. 17(1) | The instance's action |
|---|---|
| (a) restricting the visibility of specific items, including removal | Hide a display name. Hide one item: a room listing, a route shown in a room, a race result ([#913](https://github.com/openzigs/onyourleft/issues/913), not built) |
| (b) suspending or restricting monetary payments | None: the instance takes and makes no payments |
| (c) suspending or terminating the service in whole or in part | Removing a rider from a room (#789, not built) |
| (d) suspending or terminating the account | Suspend |

Art. 17(2): *"at the latest from the date that the restriction is imposed, regardless of why or how it
was imposed"*. Art. 17(4): *"clear and easily comprehensible and as precise and specific as reasonably
possible"*, so that the rider can use the redress in (f).

## OPEN: where a statement is delivered

Art. 17(2): *"Paragraph 1 shall only apply where the relevant electronic contact details are known to
the provider."* **The instance holds no email address for a rider.** It knows a rider by device key
(`docs/moderation.md`). Whether an in-app channel counts as "electronic contact details" is **open,
for a lawyer** (spike §3 Q8). Either way there has to be somewhere the rider can read it, and today
there is none: a suspended rider cannot sign in at all.

- The product change is filed as [#910](https://github.com/openzigs/onyourleft/issues/910): store the
  Art. 17(3) fields with each log entry, and let the affected rider read their statements in the app,
  **suspended or not**.
- **Public rooms wait for #910**, with [#907](https://github.com/openzigs/onyourleft/issues/907) and
  [#911](https://github.com/openzigs/onyourleft/issues/911) (owner, 2026-09-30). Private rooms can ship
  before them. A rider who writes to [matt@openzigs.ai](mailto:matt@openzigs.ai) can be sent theirs.

**The Transparency Database is not owed** unless the instance is an online platform that is not
micro or small. Art. 24(5) applies to *"providers of online platforms"*, and Art. 19 exempts micro and
small ones. The Commission's FAQ: *"The DSA Transparency Database only collects statements of reasons
from online platforms, a subset of hosting services."* See [DSA scope](dsa-scope.md).

## The template: a restriction

Every element of Art. 17(3) is a numbered part. Leave none out: where a part does not apply, say so.
**Never write a coordinate or a place into a statement** (ADR 0004 decision D), and never write the
rider's personal details into the reason (`docs/moderation.md`).

> **What we did on [instance] on [date]**
>
> **1. What we did** *(Art. 17(3)(a))*: we [hid your display name | hid [item: the listing of your
> room "…" | the route you shared in room … | your result in race …] | removed you from room … |
> suspended your account].
>
> - **Where it applies**: [everywhere this instance can be reached | only in …]
> - **How long**: [until [date] | no end date; see part 6]
>
> [We did not delete anything: your rides are still on your device, and on this instance. | We
> deleted [item], and [what is kept, if anything].]
>
> **2. Why, and what we relied on** *(Art. 17(3)(b))*: [We acted on a notice sent to us on [date]. |
> We found it ourselves on [date].] The facts: [what the content was and what it did, without anybody's
> personal details]. [If the matter involves the moderator: this decision was taken by the moderator,
> in a matter that involves them. We declare that conflict of interest here, and the decision is
> logged.] [We are not telling you who sent the notice. | We are telling you who sent the
> notice because you cannot see why the content is illegal without knowing that: [name].] *(DSA recital
> 54: only where necessary to identify the illegality.)*
>
> **3. Automated means** *(Art. 17(3)(c))*: no automated means were used to find this content or to
> decide. A person, the moderator, read it and decided.
>
> **4. The law we relied on** *(Art. 17(3)(d), only for illegal content)*: [the law, for example the
> offence and the country], and why the content is illegal under it: [explanation]. [Not applicable:
> we did not decide that the content is illegal.]
>
> **5. The terms we relied on** *(Art. 17(3)(e), only for a breach of the terms)*: [section of the
> terms of service], and why the content breaks it: [explanation]. [Not applicable: we decided on the
> law, not the terms.] *(There are no terms of service yet: [#909](https://github.com/openzigs/onyourleft/issues/909).)*
>
> **6. What you can do about it** *(Art. 17(3)(f))*:
> - **Ask us to look again.** [How to appeal: [#911](https://github.com/openzigs/onyourleft/issues/911),
>   not built yet; until then, write to [matt@openzigs.ai](mailto:matt@openzigs.ai).] [If the matter
>   involves the moderator, the moderator decides it, as the owner decided on 2026-09-30: see
>   [notice-and-action](notice-and-action.md#a-notice-or-complaint-about-the-moderator).]
> - **Out-of-court dispute settlement.** [certified body and how to reach it, only if the owner or a
>   lawyer decides DSA Art. 21 applies | Not available for this decision.]
> - **A court.** You can take the decision to a court under the law of your country. *(Recital 55:
>   "the recipient of the service should always have a right to effective remedy before a court".)*

## Confirmation of receipt

DSA Art. 16(4): sent *"without undue delay"* where the notice gave electronic contact information.

> We received your notice on [date and time], about [the items it names]. We have given it the
> reference [reference]. We will tell you what we decide, and what you can do if you disagree. [If
> the notice is about the moderator: this notice is about the person who moderates this instance.
> They will decide it, declare that conflict of interest in the decision, and log it.]

## Decision on a notice

DSA Art. 16(5): sent *"without undue delay"*, *"providing information on the possibilities for
redress in respect of that decision"*. Art. 16(6): if automated means were used, say so here.

> About your notice [reference] of [date]: we [removed | hid | restricted | did not act on] [the
> items]. [Why, in a sentence.] No automated means were used: a person decided.
>
> If you disagree, you can [ask us to look again: [#911](https://github.com/openzigs/onyourleft/issues/911),
> or write to [matt@openzigs.ai](mailto:matt@openzigs.ai)], or go to a court. [If the content is on Discord:
> report it to Discord, which decides what happens to content on its service.]
