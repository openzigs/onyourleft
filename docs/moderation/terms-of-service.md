# Terms of service for the project's instance

> **A draft, pending the owner's approval. It is not legal advice, and no lawyer has checked it.**
> Until the owner approves it, the project's instance publishes no terms (`/terms` says so), and
> public rooms stay off.

- **Date of this draft**: 2026-10-21. The first draft was dated 2026-10-15; this one is checked
  against what the instance and the app do on `main` today (see "What changed in this draft").
- **Issue**: [#909](https://github.com/openzigs/onyourleft/issues/909). Related drafts:
  [notice-and-action](notice-and-action.md), [statements of reasons](statement-of-reasons.md),
  [illegal content risk assessment](illegal-content-risk-assessment.md),
  [children's access assessment](childrens-access-assessment.md), [DSA scope](dsa-scope.md).
- **What it is for.** These are the terms of the **project's own instance**. An operator who runs
  their own instance publishes their own: these are a starting point, never a default. An instance
  publishes no terms until its operator points `OYL_INSTANCE_TERMS_FILE` at a file
  ([`docs/operating-an-instance.md`](../operating-an-instance.md)).
- **How it is served.** Everything below the line `<!-- terms -->` is the text an instance serves at
  `/terms`. It is written as plain words with headings and lists: the instance renders only
  `#` headings, paragraphs, `-` and `1.` lists and `**bold**`. Nothing above that line is served.
- **What the texts read on 2026-09-30 ask the terms to contain**, and where each is answered:

  | Text | Section below |
  |---|---|
  | OSA s.10(5)–(8): how people are protected from illegal content, priority illegal content named, the intimate image takedown | 4, 5, 6 |
  | OSA s.21(3): the complaints procedure, easy to access, including for children | 7 |
  | Codes ICU G1, G3: substance and clarity, at a reading age for the youngest permitted user (18 for public rooms) | the whole text: short sentences, plain words |
  | DSA Art. 14(1), if it applies: restrictions, moderation policies and tools including human review, the complaints system | 2, 3, 5, 6, 7 |
  | DSA Art. 14(2), if it applies: riders told of a significant change | 10 |
  | The 18+ rule for public rooms (#16, Q5) | 2 |
  | One moderator (#905), and a complaint about the moderator | 6, 7 |

- **What changed in this draft** (2026-10-21), each checked against `docs/moderation.md` and the code:
  - Section 2 names the other conditions for public rooms (#788): an account approved for 7 days,
    3 synced rides, and at most 3 public rooms a day. They are restrictions, so DSA Art. 14(1) asks
    for them. The numbers are the instance's defaults, which the home deployment does not change.
  - A new section 3, *Riding with others*: what other riders see in a race, that a private room's
    maker can remove a rider (no statement of reasons and no appeal, because it is not a moderator's
    decision), and the race's check on power, which marks a rider beside their name for everybody in
    the race and files a report (ADR 0028 D-2, #789).
  - Section 4 names cheating in a race, because a rider can report it (#789) and a moderator may
    remove a rider for it, and a removal on the terms needs a term to rely on.
  - Section 5 no longer says that no automated tool finds anything: the power check does. It now
    says that a person decides every report, and that the power check is the only automatic one.
    It adds reporting a rider from a ride, the 7-day target, the email a notifier is sent by hand,
    and "say where it is in words" (the app does not show a rider's identifier yet, #1381).
  - Section 5 adds removal from a room as a step. The terms do not promise that a suspended rider
    can export or delete their instance account from the app: the instance allows it (#898), but
    the app has no control that calls it.
  - Section 10 said the app shows the new terms "before you go on". It does not block anything: the
    Instance screen says so, with a link, until the rider marks them read. The text now says that.
  - **Removal from a private room is in the terms, though the app has no control for it.** Unlike
    blocking, it is not a feature the terms promise: it is something that happens to a rider, and
    the rider needs to know it is not a moderator's decision and has no appeal. The terms say it
    can happen and do not say how.
  - **Blocking is in the terms (owner, 2026-10-23).** The app blocks a rider from a race's result
    since #1516; section 3 uses the app's own approved wording, including that the app cannot undo
    a block yet.
  - **Export and delete while suspended are in the terms (owner, 2026-10-23).** The app offers
    both beside the statements on the Instance screen since #1517 (section 6).
  - **Reporting child sexual abuse material (owner, 2026-10-23).** The operator is in the United
    States, so section 5 names NCMEC's CyberTipline (18 U.S.C. § 2258A), not the UK's National
    Crime Agency. The UK intimate image rule stays, for riders in the UK.
- **Open for the owner.** Whether a change is "significant" is the owner's call each time; the
  instance tells riders whenever `OYL_INSTANCE_TERMS_VERSION` changes (section 10). The governing
  law is New York's (owner, 2026-10-23), in section 11.

<!-- terms -->

# Terms of service

These are the rules for using this On Your Left instance. By using it you agree to them. They are
short on purpose. If anything here is unclear, write to us (section 9).

## 1. Who we are

This instance is run by one person, who is also its only moderator. The app you ride with is free
and open source. Your rides are kept on your own device, and the instance never becomes the only
place they are.

## 2. Who can use it

- Anybody may ask for an account. A moderator approves each new account before it can ride with
  others. Until then you can manage your own account, choose your name and confirm your age,
  and export or erase your account, but you cannot ride with anybody or join a room.
- **Public rooms are for people aged 18 or over.** You confirm your age yourself. We never ask for
  your date of birth.
- To join a public room, make one or see the list of them, your account must also have been
  approved for at least 7 days, and you must have synced at least 3 rides. You can make at most 3
  public rooms a day.
- Private rooms are for the riders who share a room's code.

## 3. Riding with others

- In a race, the other riders see your name, your power for your weight (watts per kilogram), and
  how far ahead or behind you are. The race's result shows your place, your time and your power
  for your weight, to the riders in that race. If the race's check on power marked you
  (see below), the result shows the mark too. The privacy policy says exactly what is shared.
- **The rider who made a private room can remove you from it.** That is their choice, not a
  moderator's decision, so it comes with no written reasons and no appeal. If you think it was
  abuse, report it (section 5).
- **A race checks power.** If a rider's power goes over what this instance accepts as possible for
  a person, the race marks it beside their name, for everybody in the race, and tells the
  moderator. A mark is not a decision. A person looks at it.
- **You can block another rider** from a race's result. From your next ride, neither of you is
  named to the other in a race, and a public room keeps you apart. The rider is not told. The app
  cannot undo a block yet.

## 4. What you must not do

You must not use this instance to share, or to make other riders see, anything that is illegal.
That includes, and is not limited to:

- threats, harassment or stalking of anyone;
- content that encourages or assists terrorism;
- child sexual abuse material, or anything that sexualises a child;
- an intimate image of a person shared without their consent;
- content that incites hatred or violence;
- fraud, or pretending to be somebody you are not in order to deceive.

You must also not:

- use a display name, a room, or a route to abuse another rider;
- cheat in a race, for example with a weight you know is wrong, or a device that reports more power
  than you ride;
- try to get round a moderator's decision, for example with a new account.

## 5. How we keep illegal content off

- **Anybody can report content**, with or without an account, on this instance's notice page
  (`/report`). Name the item if you can: a display name, a room, a route shown in a room, or a row
  of a race's result. Or say where it is in words.
- **In a ride, you can report another rider** from the app: follow them, then press Report and
  choose a reason.
- **An intimate image report** (UK Online Safety Act, section 20A) is a separate choice on the
  notice page, and it asks for your email address. We take the content down within 48 hours of
  receiving the report.
- If you give an email address on the notice page, we write to you to say we have it, and again to say
  what we decided. The instance itself sends no email: a person writes.
- **A person decides every report.** No automated tool decides anything. The race's check on power
  (section 3) is the only automatic check, and a person decides what to do about it.
- We aim to decide a report within 7 days. There is one moderator and nobody covers for them. If
  they will be away for longer than that, public rooms are switched off until they are back.
- We take the smallest step that deals with the problem: we hide one item (a room's listing, the
  route shown in a room, or a row of a race's result), hide a display name, remove a rider from a
  room, or suspend an account. Hiding something does not delete it, and your rides stay on your
  device.
- Some things we must report to the authorities. Child sexual abuse material is reported to the
  CyberTipline of the National Center for Missing & Exploited Children (NCMEC), as US law requires.

## 6. What happens when we act

- When we restrict your account or something you shared, you can read **why**, on the Instance
  screen of the app: what we did, the facts, the law or the rules we relied on, and what you can do.
  This works even if your account is suspended.
- Even while your account is suspended, you can save everything the instance holds about you, or
  delete your account on the instance, from the same screen. Deleting it there never deletes the
  rides on your device.
- We never tell you who reported you, unless you cannot see why without knowing.
- **One person moderates this instance.** Sometimes the matter involves them, for example a report
  about them or a complaint about their own decision. They still decide it, but they say so in the
  decision, and it is logged.

## 7. Complaints and appeals

- **To ask us to look at a decision again**, appeal it beside the decision on the Instance screen.
  You can do this even if your account is suspended. Each decision can be appealed once.
- We decide appeals as soon as we can, and at the latest within 7 days. If we were wrong, we undo
  the decision at once: a suspension is lifted, a name or an item is shown again, or you may come
  back into the room.
- **Any other complaint**, for example that we are not following these terms or our own procedure,
  goes to the contact address on the legal page (`/legal`).
- You can also take a decision to a court under the law of your country.

## 8. Your data

The privacy policy says what the instance keeps and why. It is linked from the legal page
(`/legal`). Your rides stay on your device whatever we do on the instance.

## 9. Contact

Write to the address on the legal page (`/legal`). A person reads every message.

## 10. When these terms change

The date these terms took effect is shown at the top of this page. When we change them in a way
that matters to you, the Instance screen of the app tells you, with a link to the new terms, until
you mark them as read.

## 11. The law that applies

These terms are governed by the law of the State of New York, United States. If you live somewhere
else, you keep any protection the law where you live gives you and that an agreement cannot take
away.
