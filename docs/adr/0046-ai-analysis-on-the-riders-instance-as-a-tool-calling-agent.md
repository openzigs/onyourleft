# ADR 0046: AI analysis runs only on the rider's instance, as a tool-calling agent

- **Status**: **Accepted, 2026-10-07.** The owner answered every question this ADR left open, in
  three comments on [PR #1114](https://github.com/openzigs/onyourleft/pull/1114) on 2026-10-07,
  ruled on three points those answers left to the author in a fourth (all four quoted in Context),
  and posted the first-person relicence consent D-4 rests on, on
  [#1093](https://github.com/openzigs/onyourleft/issues/1093) the same day. It was **Proposed** from
  2026-10-04 until then, and ⚠️ a reviewer who remembers it awaiting the owner's approval is reading
  the old file. **Nothing is built by this ADR**: the sub-issues of
  [#1092](https://github.com/openzigs/onyourleft/issues/1092) build it
- **Date**: 2026-10-04; accepted 2026-10-07
- **Deciders**: **the owner**, in the rulings on #1092 and #1093 of 2026-10-04 and on PR #1114 and
  #1093 of 2026-10-07, all quoted verbatim in Context. The author wrote the wording and decided the
  engineering content the rulings do not settle. Each such point is marked *the author's choice*
  where it is made. §"Owner questions, and the owner's answers" records each question this ADR
  asked and the ruling that answered it
- **Issue**: [#1093](https://github.com/openzigs/onyourleft/issues/1093). Parent epic
  [#1092](https://github.com/openzigs/onyourleft/issues/1092), the successor to
  [#795](https://github.com/openzigs/onyourleft/issues/795)
- **Number**: **0046**, reserved by #1093's title. 0044 and 0045 were already claimed when this
  number was taken, by the epic [#1055](https://github.com/openzigs/onyourleft/issues/1055); both are
  now written and on `main` ([ADR 0044](0044-side-camera-live-view-and-snapshot.md),
  [#1058](https://github.com/openzigs/onyourleft/issues/1058), and
  [ADR 0045](0045-fit-from-one-side-camera.md), [#1059](https://github.com/openzigs/onyourleft/issues/1059),
  both 2026-10-04). [`docs/architecture.md`](../architecture.md)'s ownership table records 0046 as
  this ADR, and the next free number is 0047
- **Supersedes**, **for AI analysis only**:
  - [ADR 0036](0036-a-self-hostable-instance-server-now.md) **D-3(a)**, as far as asking for a
    ride analysis is concerned. (a) stays in force for every other feature it lists.
  - [ADR 0036](0036-a-self-hostable-instance-server-now.md) **D-3(d)**'s clause *"the rider's own
    analysis endpoint ([ADR 0035](0035-model-written-ride-write-ups.md)) is the rider's computer,
    not this instance"*. The rest of (d) stands.
  - [ADR 0035](0035-model-written-ride-write-ups.md) **D-7**'s *"The app decides every step; the
    model never chooses a tool, a step or what data it gets"*, on the instance.
- **Amends**, by an entry dated 2026-10-07 appended under [ADR 0013](0013-adr-amendments.md) to
  each: [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md), [ADR 0033](0033-side-camera-link.md),
  [ADR 0035](0035-model-written-ride-write-ups.md),
  [ADR 0036](0036-a-self-hostable-instance-server-now.md),
  [ADR 0037](0037-instance-runtime-hosting-and-transport.md) and
  [ADR 0040](0040-a-history-index-on-the-riders-instance.md). No existing line of any of them is
  edited. §"Amendments appended to other ADRs" lists what each entry records
- **Relates to**: [ADR 0013](0013-adr-amendments.md), [ADR 0029](0029-camera-imagery-as-a-data-class.md),
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md),
  [ADR 0033](0033-side-camera-link.md), [ADR 0035](0035-model-written-ride-write-ups.md),
  [ADR 0036](0036-a-self-hostable-instance-server-now.md),
  [ADR 0037](0037-instance-runtime-hosting-and-transport.md),
  [ADR 0040](0040-a-history-index-on-the-riders-instance.md),
  [ADR 0015](0015-dependency-licences.md), [ADR 0025](0025-app-store-additional-permission.md)

---

## Context

### The question

[ADR 0035](0035-model-written-ride-write-ups.md) built a ride write-up as a fixed chain the app
decides, run on the device against the rider's own computer or a hosted model on a key the device
holds. [ADR 0040](0040-a-history-index-on-the-riders-instance.md) put a searchable index of the
rider's history on their instance, and kept the steps on the device. The research of 2026-10-04
(on-device feasibility, agent frameworks, a server-side agent, and comparable products) found that
a phone or tablet cannot host an agent with tools, retrieval and long-running jobs at the quality
the owner wants: the platform models have about a 4 096-token window, Gemini Nano refuses inference
unless the app is in the foreground, and sustained inference throttles within minutes. Every
comparable product found runs its model and its history on a server. The owner was asked where the
analysis should run, and ruled.

### What the owner decided, quoted so it is not argued again

**The six rulings on #1093 and in #1092's body, 2026-10-04**, verbatim from
[#1093](https://github.com/openzigs/onyourleft/issues/1093) §"The owner's rulings":

> 1. **Instance only.** AI analysis (ride write-ups and any future analysis agent) runs **only** on
>    the rider's instance. The on-device runner and "send to your own computer" are removed. The
>    live side-camera pose model (MediaPipe on the tablet, epic #1055) stays on the device: it is
>    not an analysis job, and pictures do not leave the room.
> 2. **The code moves to `packages/`.** The runner, templates, write-up screen, angle matchers and
>    hosted mask move into a new Apache-2.0 package, relicensed. The owner is the sole copyright
>    holder and consents.
> 3. **A hosted model key may be held by the instance**, on a **single-rider** instance only. It is
>    encrypted at rest, never logged, never in a backup unencrypted, and refused on an instance with
>    more than one athlete. The other source is Ollama on the same box, at local addresses only.
> 4. **The model chooses its own tools.** Tools are read-only and scoped to one athlete. There are
>    no write tools and no tool that can reach a trainer. Runs have step, time and token budgets.
>    Output is screened before it is saved, and screened again on the device on display. The
>    framework is the Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) on the instance only, with
>    the provider always passed explicitly. Mastra and the Claude Agent SDK are rejected.
> 5. **Results stream live** to the ride page: an SSE job stream through the tunnel, heartbeats, a
>    SQLite job table, resume, cancel, device-key session auth.
> 6. **No built-in phone models** (Gemini Nano, Apple Foundation Models): never.

**The owner's answers to the epic's open questions, 2026-10-04**, verbatim from the
[comment on #1092](https://github.com/openzigs/onyourleft/issues/1092), which says of itself
*"These supersede the epic body where they differ"*:

> **Owner rulings, 2026-10-04: answers to the epic's questions.** These supersede the epic body
> where they differ.
>
> 1. **Pose on your computer (ADR 0033 D-11): move it to the instance.** Side-camera pictures will
>    go to the instance, which asks the vision model. A photograph of the rider then leaves the
>    room, through the tunnel when away from home. That needs its own privacy ruling: amendments to
>    ADR 0029 and ADR 0033, plus the policy and Data Safety. It is filed as its own sub-issue. #1103
>    does not remove the path until that issue lands.
> 2. **AI SDK:** accept `ai`, with a test-enforced guard that makes any gateway call throw. List the
>    gateway/oidc/execa closure in ADR 0037 D-9 and the notices.
> 3. **Streaming:** live progress, then each section once screened. If a later section fails,
>    everything already shown is withdrawn.
> 4. **A model without tool support:** say so and stop. There is no fixed-chain fallback.
> 5. **Riders and keys. This REPLACES ruling 3's "single-rider only".** The instance also hosts
>    group rides and races, so it will have other riders' accounts.
>    - **Two key modes, both allowed:**
>      - **Share:** the operator sets one key, and every permitted rider's analysis uses it.
>      - **Bring your own:** a rider stores their own key, used only for their own analysis.
>    - Every key is encrypted at rest, never logged, and never in a backup in clear.
>    - The app tells a bring-your-own rider that the operator could technically read their key.
>    - **Other riders' access to AI analysis:** off by default. The operator can switch it on for
>      everyone.
> 6. **Who sets a key:** the operator command, **and the app**. A rider pastes their own key in
>    Settings, and the operator can set the shared key from the app too. The key crosses the network
>    once, over the tunnel's TLS and the existing device-key session. It must never appear in a log,
>    an error or an export.
> 7. **Masking data:** **sync it to the instance.** Privacy zones and the words-to-mask list are
>    stored on the instance, per athlete, in scoping and erasure, and in the account export (#35's
>    lists). This reverses the device-only note in `packages/store/src/masked-words.ts`; the ADR
>    records that.
> 8. **Retention:** **keep results on the instance** as well as on the device, so another device can
>    see them. The device stays canonical (ADR 0036 D-3(b)/(c)). The instance copy is per athlete,
>    erased with the athlete, and included in the export.
> 9. **"What will be sent" preview:** the masked ride input before the run, plus a log of what was
>    actually sent afterwards (the planner's recommendation; not separately ruled).
>
> #1093 (ADR 0046) must carry all of the above. #1097, #1101, #1102 and #1103 are affected.

And the owner's note on #1093 the same day, verbatim:

> The owner answered every open question. The rulings are on #1092:
> https://github.com/openzigs/onyourleft/issues/1092. Ruling 5 replaces 'single-rider only' with
> share-or-bring-your-own keys.

**The owner's answers to this ADR's own questions, 2026-10-07**, in three comments on
[PR #1114](https://github.com/openzigs/onyourleft/pull/1114), verbatim. The question numbers are
§"Owner questions, and the owner's answers"'s.
[The first](https://github.com/openzigs/onyourleft/pull/1114#issuecomment-6046565003)
(2026-10-07T20:48:15Z):

> **Owner rulings, 2026-10-07, on this ADR's open questions:**
> - **Q9 (who the operator is):** the athlete whose device holds `OYL_INSTANCE_OWNER_KEY`, the key
>   that already makes them moderator.
> - **Q13 (bring-your-own key and the switch):** the operator's switch gates both key modes. Other
>   riders get no analysis until the operator turns it on, whichever key they use.
> - **Q11 (Cloudflare's edge):** open. The owner asked whether this traffic can be encrypted end to
>   end; options are being written up.
>
> Q1–Q8, Q10 and Q12 remain open.

[The second](https://github.com/openzigs/onyourleft/pull/1114#issuecomment-6046599179)
(2026-10-07T20:50:27Z):

> **Owner rulings, 2026-10-07 (continued):**
> - **Q1 (what the job is sent):** the device builds the asked-about ride's input with #809's
>   builder and sends it in the job request. The exclusion walk stays where it runs today.
> - **Q2 (pose summary on the instance):** sent only inside a job's input and only with camera
>   consent. Never indexed, never returned by a tool, and not kept with the result; the stored
>   *what was sent* log records only that one was sent.
> - **Q3 (side-camera pictures to the instance):** left to #1106. Pictures travel only over the home
>   network or a WireGuard-class overlay, never through the Cloudflare tunnel (ADR 0029 D-6).
> - **Q4 (budgets):** the drafted figures stand until #1098's measurements replace them.
> - **Q5 (job-row retention):** 7 days. The result itself is kept, per ruling 8.
> - **Q6 (operator secret):** an environment variable on the instance.
> - **Q7 (ADR 0031 D-4 reading):** met. Nothing in this repository names, defaults to or suggests
>   the dependency's guarded vendor default.
> - **Q11 (Cloudflare's edge):** encrypt at the application layer, end to end: the instance holds a
>   key pair, each device pins its public key when linked, and a pasted API key, the synced privacy
>   zones and words-to-mask list, and each job's input and result are encrypted so Cloudflare sees
>   only ciphertext. Tracked in https://github.com/openzigs/onyourleft/issues/1179. Until it ships,
>   a pasted key is accepted only on the home network or through the operator command.
>
> **Still open:** Q8 (the owner's first-person relicence consent, to be posted by the owner on
> #1093), Q10 and Q12.

[The third](https://github.com/openzigs/onyourleft/pull/1114#issuecomment-6046606781)
(2026-10-07T20:50:56Z):

> **Owner rulings, 2026-10-07 (continued):**
> - **Q10 (a rider's own consent to a hosted job):** required in both key modes. A hosted job runs
>   only for an athlete whose own hosted consent is recorded on the instance and names the
>   endpoint; changing the shared endpoint withdraws every rider's consent to it; the Ollama source
>   on the operator's box needs none.
> - **Q12 (the device-held hosted key):** removed with the on-device runner. Every key lives on the
>   instance (rulings 5 and 6).
>
> **Every owner question is now answered except Q8**, the owner's first-person relicence consent,
> which the owner will post on #1093 themselves. Once it is there, the ADR can be marked Accepted
> per D-15.

Q8 was answered on #1093 the same evening; D-4 quotes it.

[The fourth](https://github.com/openzigs/onyourleft/pull/1114#issuecomment-6049839974)
(2026-10-08T00:47:59Z, headed 2026-10-07 by the owner), from the acceptance review of this pull
request:

> **Owner rulings, 2026-10-07 (from the acceptance review):**
> - **Analysis traffic waits for end-to-end encryption.** #1101 (masking sync) and #1095 (the job
>   stream) do not ship before #1179. Privacy-zone centres, the words-to-mask list and job text never
>   cross Cloudflare's edge readable.
> - **"Home network" for a pasted key means a private address on the local network only.**
>   WireGuard-class overlays do not count. A request the instance cannot place is refused.
> - **Rotating the shared key at the same endpoint does not re-ask riders' consent.** Consent names
>   the endpoint, and only a change of endpoint withdraws it.

### How the rulings supersede one another, recorded so nobody applies the wrong one

| Earlier statement | Replaced by | Effect |
|---|---|---|
| #1093 ruling 3, *"on a **single-rider** instance only … refused on an instance with more than one athlete"* | #1092 comment ruling 5, *"This REPLACES ruling 3's 'single-rider only'"* | Two key modes on any instance (D-9). The encryption, logging and backup rules of ruling 3 survive and ruling 5 restates them |
| #1093 ruling 1, *"pictures do not leave the room"*, and the epic body's *"The live side-camera pose model … **stays on the device**"* | #1092 comment ruling 1, *"Pose on your computer (ADR 0033 D-11): move it to the instance"* | ⚠️ **Only the D-11 path moves.** The live pose model on the tablet stays (D-3). Pictures to the instance wait on their own privacy ruling ([#1106](https://github.com/openzigs/onyourleft/issues/1106)) and **this ADR does not make it** |
| The epic body's open question 4, *"Recommended: the operator CLI only"* | #1092 comment ruling 6 | The operator command **and** the app |
| The epic body's open question 6, *"held in memory only"* | #1092 comment ruling 7 | Synced and stored per athlete (D-10) |
| The epic body's open question 9, *"the candidate is deleted when the device acknowledges the save"* | #1092 comment ruling 8 | Results are kept on the instance (D-12) |
| `packages/store/src/masked-words.ts`, *"It is NOT in the account export"*, and its device-first note | #1092 comment ruling 7 | Reversed (D-10). The code changes in #1101, not here |
| #1092 comment ruling 6, *"The key crosses the network once, over the tunnel's TLS"* | The owner's Q11 ruling of 2026-10-07 | Until [#1179](https://github.com/openzigs/onyourleft/issues/1179)'s end-to-end encryption ships, a pasted key is accepted **only on the home network or through the operator command**, never through the tunnel (D-9) |
| The Q11 ruling's *"Until it ships, a pasted key is accepted only on the home network"*, which held back only the key | The owner's fourth ruling of 2026-10-07, *"#1101 (masking sync) and #1095 (the job stream) do not ship before #1179"* | Nothing but a pasted key crosses the tunnel before #1179, and the key only from the home network as the same ruling defines it (D-9, D-10) |
| [ADR 0029](0029-camera-imagery-as-a-data-class.md)'s 2026-09-28 entry, the hosted key kept on the device | The owner's Q12 ruling of 2026-10-07 | Removed with the on-device runner; every key lives on the instance (D-1, D-9) |

### What was read for this ADR, and when

- **The repository**, on `origin/main` at `a9c7f3ff`, 2026-10-04.
- **Package facts**, with `npm view <package>@<version> version license dependencies` on 2026-10-04
  (D-8's table).
- **Authorship of the files that move**, with `git log` on the same commit (D-4).
- **The research summary of 2026-10-04** behind #1092: Android's ML Kit GenAI overview (*"Inference
  is permitted only when the app is the top foreground application"*), Apple's TN3193 (4 096 tokens
  per session, input and output combined), the AI SDK documentation (a bare string model id routes
  to the Vercel AI Gateway, the default global provider), Mastra's licence page (an `ee/` directory
  under the Mastra Enterprise License inside `@mastra/core`), npm's record for
  `@anthropic-ai/claude-agent-sdk` (`SEE LICENSE IN README`, Anthropic's commercial terms), and
  Cloudflare's 524 documentation (a 125 s proxy read timeout, which a stream survives while bytes
  keep flowing).

---

## Decision

### D-1 — AI analysis runs only on the rider's instance

> **The rule, the owner's (#1093 ruling 1), verbatim.** *"**Instance only.** AI analysis (ride
> write-ups and any future analysis agent) runs **only** on the rider's instance. The on-device
> runner and "send to your own computer" are removed. The live side-camera pose model (MediaPipe on
> the tablet, epic #1055) stays on the device: it is not an analysis job, and pictures do not leave
> the room."*

- **The device-held hosted key is removed too**, by the owner's Q12 ruling of 2026-10-07:
  *"removed with the on-device runner. Every key lives on the instance (rulings 5 and 6)."* The key
  [ADR 0029](0029-camera-imagery-as-a-data-class.md)'s 2026-09-28 entry keeps on the device goes
  with the runner, and every key the analysis uses is set by the operator or pasted by the rider
  and stored on the instance (D-9).
- **This supersedes [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3(a) for AI analysis
  only.** Asking for a write-up now requires an instance. Every other feature (a)'s list names —
  recording, the store, pairing, trainer control, the game, the library, the non-AI analysis,
  routes, workouts, import and export — still works with no instance, and
  `apps/web/src/privacy/no-network.test.ts` still admits exactly one module for instance traffic
  ([#777](https://github.com/openzigs/onyourleft/issues/777)). The job client goes through that one
  module and names no network primitive of its own.
- **This supersedes D-3(d)'s clause** *"the rider's own analysis endpoint (ADR 0035) is the rider's
  computer, not this instance"*. The rest of (d) stands; D-14 says how it is kept.
- **"Analysis" here means a model writing about a ride.** The zones, bests, load and fitness series
  under `apps/web/src/analysis/` are arithmetic, not AI, and stay on the device unchanged.

### D-2 — A rider with no instance loses the write-up, and nothing else

Stated in full in §"What a rider with no instance loses", below the decisions, so it can be read on
its own. The ride page says so in one app sentence, drafted for the owner in
[#1104](https://github.com/openzigs/onyourleft/issues/1104).

### D-3 — What stays on the device

- **The live side-camera pose model** (MediaPipe on the tablet, epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055), [ADR 0033](0033-side-camera-link.md)).
  It is not an analysis job (#1093 ruling 1).
- **Recording, and every other feature** D-3(a) lists.
- **Building the ride's input** ([#809](https://github.com/openzigs/onyourleft/issues/809)'s
  builder, moving to `@onyourleft/analysis` by D-5), and **sending it with the job** (D-6, the
  owner's Q1 ruling).
- **The screen on display** ([ADR 0035](0035-model-written-ride-write-ups.md) D-4): a write-up from
  the instance is screened again on the device before a word renders.
- **The save of a `ScreenedWriteUp`**, the device's copy of record (D-14).
- **The ride-detail write-up section and its states**
  ([#805](https://github.com/openzigs/onyourleft/issues/805)).
- ⚠️ **The D-11 path of [ADR 0033](0033-side-camera-link.md)** (side-camera pictures sent to the
  rider's computer for pose) **stays where it is** until [#1106](https://github.com/openzigs/onyourleft/issues/1106)
  lands, by #1092 comment ruling 1: *"#1103 does not remove the path until that issue lands."*

### D-4 — The relicence, and the consent it rests on

**What moves.** The platform-free core of the write-up — the runner, the templates, the input
builder, the write-up screen, the angle matchers and the hosted mask — moves from `apps/web`
(`AGPL-3.0-or-later` by path) to `packages/analysis` (`Apache-2.0` by path, `CLAUDE.md` §3).
[#1094](https://github.com/openzigs/onyourleft/issues/1094) names each file and moves it with no
change of behaviour.

**The ruling** (#1093 ruling 2, and the epic body's ruling 2, both posted from the owner's account,
`mgcronin`, on 2026-10-04), verbatim:

> The owner is the sole copyright holder and consents.

That sentence is the owner's ruling, but it was drafted by the planner and is written in the third
person. A relicence rests on the copyright holder's own consent, so this ADR asked for one in the
first person (§"Owner questions, and the owner's answers", Q8).

**The consent the relicence rests on**, posted by the owner (`mgcronin`) on #1093 on
**2026-10-07 at 21:49:06 UTC**,
[#1093 comment 6047535343](https://github.com/openzigs/onyourleft/issues/1093#issuecomment-6047535343),
verbatim:

> I am the sole copyright holder of the files ADR 0046 D-4 and #1094 move from apps/web to
> packages/analysis, and I consent to relicensing them from AGPL-3.0-or-later under Apache-2.0.

**The authorship evidence, read on 2026-10-04.** Run in `apps/web/src` on `origin/main` at
`a9c7f3ff`, over the twenty-five files that are the core's modules, their tests and their test
support today:

```bash
FILES="ride-analysis/runner.ts ride-analysis/runner.test.ts ride-analysis/runner-safety.test.ts \
  ride-analysis/template.ts ride-analysis/template.test.ts ride-analysis/template-v1.ts \
  ride-analysis/template-v2.ts ride-analysis/input.ts ride-analysis/input.test.ts \
  ride-analysis/read-input.ts ride-analysis/model-step-port.ts ride-analysis/hosted-mask.ts \
  ride-analysis/hosted-mask.test.ts ride-analysis/hosted-mask-reachable.test.ts \
  ride-analysis/personal-details-testing.ts ride-analysis/sealed-step.ts \
  ride-analysis/sealed-step.test.ts ride-analysis/ride-summary.ts ride-analysis/ride-summary.test.ts \
  ride-analysis/history.ts ride-analysis/history.test.ts camera/write-up-screen.ts \
  camera/write-up-screen.test.ts camera/angle-claims.ts camera/angle-claims.test.ts"
git log a9c7f3ff --format='%an <%ae>' -- $FILES | sort | uniq -c
git log a9c7f3ff --format='%B' -- $FILES | grep -i 'co-authored-by' | sort | uniq -c
```

The result: **28 commits**, 26 by `mcronin <mgcronin@gmail.com>` and 2 by
`mgcronin <mgcronin@gmail.com>` — one person, the owner. 25 of the 28 carry a
`Co-Authored-By: Claude Opus 5.5` trailer and no other co-author trailer appears. (The five files
this list gained in review — `read-input.ts`, `hosted-mask-reachable.test.ts`,
`personal-details-testing.ts`, `ride-summary.test.ts` and `history.test.ts` — take the total from
27 commits to 28: four commits touch them, all by `mcronin`, and three of those four were already
counted for the files listed before review, so only one commit is new.) An AI assistant is a tool and holds no
copyright, so it is not a holder whose consent is needed. (#1093's body counted 39 commits and 33
trailers over a wider file set; the conclusion is the same.) ⚠️ **#1094 re-runs the command over
exactly the files it moves**, on the day it merges, and records the result in its pull request. A
file whose history shows another human author is **not moved** until that person consents in
writing.

**What the consent covers, and what it does not.**

- **Covers**: the files #1094 moves, as they stand on the commit it moves them from, relicensed to
  `Apache-2.0` by the path rule.
- **Does not touch `COPYRIGHT`'s additional permission** ([ADR 0025](0025-app-store-additional-permission.md)).
  It is a grant over the AGPL code, and nothing here widens or narrows it.
- **Does not recall anything already published.** Every copy of those files already distributed
  under `AGPL-3.0-or-later` stays under that licence for whoever holds it; a licence once granted is
  not withdrawn. From #1094's merge the same code is also available under Apache-2.0.
- **Does not cover any other file**, and is not a standing permission to move more. A later move
  out of `apps/` is its own decision with its own authorship check.

### D-5 — The package: `@onyourleft/analysis`

- **At `packages/analysis`**, `Apache-2.0`, with its own `LICENSE` and manifest field (`LIC003`,
  `LIC004`).
- **Platform-free like `packages/domain`** (`CLAUDE.md` §4d): `lib: ["ES2024"]`, `types: []`, and
  `eslint.config.js`'s platform-isolation blocks — no DOM, no Node global, no network global, no
  clock it reads itself. Time and transport stay parameters, as the runner already takes them.
- **Its only production dependency is `@onyourleft/domain`.** It does **not** depend on
  `@onyourleft/store`, which carries Dexie and the DOM lib; the constants and types it needs are
  restated structurally or moved into it (#1094).
- **`ai` and `@ai-sdk/*` never enter it.** The package holds the rules — templates, budgets, the
  screen, the mask, the input exclusions — and the instance holds the engine that calls a model
  (D-8). A lint rule refuses those imports under `packages/analysis`.

### D-6 — What the job is sent, and from where

> **The rule, the owner's (Q1, 2026-10-07), verbatim.** *"the device builds the asked-about ride's
> input with #809's builder and sends it in the job request. The exclusion walk stays where it runs
> today."*

- **The device builds the input and sends it in the job request.** #809's exclusions — no
  coordinate, no absolute altitude, no date, no name, no identifier — are enforced exactly where
  they are today, and camera consent is checked on the device that holds it. The agent's tools read
  only rows the device has already synced.
- **The instance does not build an input from the synced ride.** That was the alternative this ADR
  asked about, and it would have moved the exclusion walk onto rows that carry the true track and
  the true dates.
- **The pose summary** (the owner's Q2 ruling, verbatim): "sent only inside a job's input and only
  with camera consent. Never indexed, never returned by a tool, and not kept with the result; the
  stored *what was sent* log records only that one was sent." (D-12, D-14(d).)

### D-7 — The agent: the model chooses its tools, inside fixed walls

> **The rule, the owner's (#1093 ruling 4, its first five sentences), verbatim.** *"**The model
> chooses its own tools.** Tools are read-only and scoped to one athlete. There are no write tools and no tool that can reach a
> trainer. Runs have step, time and token budgets. Output is screened before it is saved, and
> screened again on the device on display."*

**This supersedes [ADR 0035](0035-model-written-ride-write-ups.md) D-7's** *"The app decides every
step; the model never chooses a tool, a step or what data it gets"*, **on the instance**. What the
template still decides: the sections asked for, the instructions, the budgets and the output shape.

**The tools, and nothing else** (each is
[#1098](https://github.com/openzigs/onyourleft/issues/1098)'s,
[#1099](https://github.com/openzigs/onyourleft/issues/1099)'s or
[#1100](https://github.com/openzigs/onyourleft/issues/1100)'s to build):

| Tool | Reads | Bound on what it returns |
|---|---|---|
| `ride_sections` | the asked-about ride's input (D-6) | at most 8 sections, as #809 builds them |
| `recent_rides` | synced ride summaries | at most 10 rides, #809's exclusions |
| `goals` | synced goals and notes ([#836](https://github.com/openzigs/onyourleft/issues/836)) | the rider's own text, at most 4 000 characters |
| `workouts` | synced workouts (#1100) | at most 10, no watts quoted beyond the workout's own shares |
| `history_search` | the [ADR 0040](0040-a-history-index-on-the-riders-instance.md) index | ADR 0040 D-8's bounds per call: **at most 6 passages of at most 900 characters**, inside its data fence |

- **Every tool is read-only.** There is no write tool of any kind.
- **Every tool is scoped to the job's athlete**, taken from the device-key session that created the
  job and never from a model's argument. A tool has no `athlete` parameter for a model to fill
  ([ADR 0040](0040-a-history-index-on-the-riders-instance.md) D-3's rule, applied to every tool).
  `apps/instance/src/store/sql-store.scoping.test.ts`'s three-athlete shape holds each.
- **No tool reaches the network, a file, a process or a trainer.** The instance has no Bluetooth
  path at all, and a test walks the tool modules' imports to keep it so.
- **Tool results are data, never instructions** — ADR 0040 D-8's fence, applied to every tool
  result, because a goal or a note the rider wrote can say anything.
- **The budgets.** The figures are the author's draft, and the owner ruled (Q4, 2026-10-07) that
  *"the drafted figures stand until #1098's measurements replace them"*. #1098 measures them and
  states its figures; an amendment records any it replaces:

  | Budget | Figure | Why |
  |---|---|---|
  | Model calls per run | **at most 24** | eight sections, a summary and a rewrite, with room for tool rounds |
  | Tool calls per run | **at most 16** | a model that loops on a tool is stopped, not paid for |
  | Time per run | **10 minutes** | the runner's `RUN_BUDGET_MILLISECONDS` today |
  | Tokens asked for per run | **at most 40 000** | four times the runner's `RUN_TOKEN_BUDGET` of 10 100, for tool results and history |

- **The screen runs on the instance before a candidate is kept**, with ADR 0035 D-4's one rewrite,
  **and again on the device** before display (D-3). Both are `@onyourleft/analysis`'s one set of
  matchers (D-5), which is what ADR 0035 D-4's *"One set of matchers, shared"* requires.
- **A model without tool support** (#1092 comment ruling 4): *"say so and stop. There is no
  fixed-chain fallback."* The job fails with an app sentence naming that cause.
- **[ADR 0035](0035-model-written-ride-write-ups.md) D-8 is restated, and narrowed in one bullet.**
  Nothing reaches a trainer control point, the HUD, the announcer, a notification or a ride-time
  screen; nothing runs during a ride. ⚠️ **"Nothing is sent in the background" is narrowed**: a job
  starts only on the rider's press, and may finish while the app is closed. Nothing starts without a
  press, and no notification is sent when it finishes.

### D-8 — The framework: the Vercel AI SDK, on the instance only, behind one module

> **The rules, the owner's, verbatim.** #1093 ruling 4, its last two sentences: *"The framework
> is the Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) on the instance only, with the provider
> always passed explicitly. Mastra and the Claude Agent SDK are rejected."* #1092 comment ruling 2:
> *"**AI SDK:** accept `ai`, with a test-enforced guard that makes any gateway call throw. List the
> gateway/oidc/execa closure in ADR 0037 D-9 and the notices."*

- **One module imports `ai`**: a Node-adapter file under `apps/instance/src/analysis/`, named in
  `eslint.config.js` §`INSTANCE_NODE_ADAPTER_FILES`. A `no-restricted-imports` rule refuses `ai` and
  `@ai-sdk/*` everywhere else in the repository: in `packages/` (D-5), in `apps/web`, in
  `apps/mobile`, and in the rest of `apps/instance`. The agent's engine is written against ports — a
  model port and a clock — so [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-2's
  Durable Object adapter is not foreclosed.
- **The guard** (#1092 comment ruling 2). The global default provider is set, at that module's
  load, to one that **throws** on any call, so a bare string model id can never reach the Vercel AI
  Gateway. Every call passes a provider instance built from the operator's or rider's configuration
  (D-9). A test in the instance's Vitest project calls the SDK with a string model id and requires
  it to throw without a network request (the fake model server of
  [#1096](https://github.com/openzigs/onyourleft/issues/1096) sees nothing), with a red control
  that removes the guard. Telemetry is off.
- **[ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 holds**: no vendor is named,
  defaulted or suggested, and there is one code path that takes a URL and a key. The gateway is in
  the closure because `ai` depends on it, and it is never called. Whether an unused vendor default
  in a dependency meets *"No vendor endpoint is hard-coded, and no vendor is named in source"* was
  asked (Q7), and the owner ruled it **met** on 2026-10-07: *"Nothing in this repository names,
  defaults to or suggests the dependency's guarded vendor default."* ADR 0031's 2026-10-07
  amendment records it.
- **Rejected, and why.** **Mastra**: `@mastra/core` ships an `ee/` directory under the non-OSI
  Mastra Enterprise License inside a package whose manifest says `Apache-2.0`, which `DEP001` reads
  and cannot see past (`CLAUDE.md` §4g). **The Claude Agent SDK**: `SEE LICENSE IN README`, Anthropic's
  commercial terms, which `DEP001` fails closed, and one vendor against ADR 0031 D-4.

**The production closure, read on 2026-10-04** with
`npm view <package>@<version> version license dependencies`, in
[ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-9's shape:

| Package | Version read | SPDX, read 2026-10-04 | Pulled by | Lands in | `DEP001` / `DEP002` prediction |
|---|---|---|---|---|---|
| `ai` | 7.0.127 | `Apache-2.0` | `apps/instance` | `apps/instance` | permissive: passes both |
| `@ai-sdk/openai-compatible` | 3.0.62 | `Apache-2.0` | `apps/instance` | `apps/instance` | passes both |
| `@ai-sdk/provider` | 4.0.21 | `Apache-2.0` | `ai`, the provider | `apps/instance` | passes both |
| `@ai-sdk/provider-utils` | 5.0.53 | `Apache-2.0` | `ai`, the provider | `apps/instance` | passes both |
| `@ai-sdk/gateway` | 4.0.103 | `Apache-2.0` | `ai` itself | `apps/instance` | passes both. **Never called** (the guard) |
| `@vercel/oidc` | **3.2.0** (pinned exactly by the gateway) | `Apache-2.0` | `@ai-sdk/gateway` | `apps/instance` | passes both |
| `zod` | 4.x (a peer range of `^3.25.76 \|\| ^4.1.8`) | `MIT` | a **peer** of `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/gateway` and `@ai-sdk/provider-utils`, each `^3.25.76 \|\| ^4.1.8` (`npm view <package>@<version> peerDependencies`, 2026-10-04). `@ai-sdk/provider` 4.0.21 declares no peer | `apps/instance` | passes both |
| `undici` | ^7.29.0 | `MIT` | `@ai-sdk/provider-utils` | `apps/instance` | passes both |
| `eventsource-parser` | ^3.0.8 | `MIT` | `@ai-sdk/provider-utils` | `apps/instance` | passes both |
| `@standard-schema/spec` | ^1.1.0 | `MIT` | `@ai-sdk/provider-utils` | `apps/instance` | passes both |
| `@workflow/serde` | 4.1.0 | `Apache-2.0` | `@ai-sdk/provider-utils` | `apps/instance` | passes both |
| `json-schema` | ^0.4.0 | `(AFL-2.1 OR BSD-3-Clause)` | `@ai-sdk/provider` | `apps/instance` | passes `DEP001` on its `BSD-3-Clause` operand |

⚠️ **`execa` is NOT in that closure on the versions read, and #1093's body and #1092 comment
ruling 2 both expected it.** `@ai-sdk/gateway` 4.0.103 pins `@vercel/oidc` at exactly `3.2.0`, and
`npm view @vercel/oidc@3.2.0 dependencies` printed **none**. The chain the epic described —
`@vercel/oidc` → `@vercel/cli-exec` → `execa` — is `@vercel/oidc` **4.0.0**'s (`@vercel/cli-exec`
1.0.1 depends on `execa` 5.1.1, `MIT`, which pulls `cross-spawn`; `@vercel/cli-config` 0.3.1 pulls
`xdg-app-paths`, `MIT`, and a second `zod`). So:

- **The owner's ruling covers it when it arrives.** A gateway release that moves to `@vercel/oidc`
  4.x brings a process-spawning library into the instance's closure, and #1092 comment ruling 2
  accepts that with the guard. When it does, its rows are added to this table and to ADR 0037 D-9
  in the pull request that takes the bump, and the third-party notices change in the same one.
- **The install, not this table, is the record.** [#1096](https://github.com/openzigs/onyourleft/issues/1096)
  installs the SDK, and `pnpm run check:licences` and `pnpm run check:notices` read pnpm's own
  resolution. If they disagree with this table, they win, and the table is corrected by an
  amendment.
- **No install script** is declared by any package above, so `pnpm-workspace.yaml`'s `allowBuilds`
  gains nothing. #1096 confirms that on install.
- **What ships to riders is unchanged.** None of these is in `apps/web`'s or `apps/mobile`'s
  closure, so `apps/web/public/licences/third-party.txt` must not change because of them, and
  `apps/instance/third-party.txt` must. `check:notices` holds both.

### D-9 — Model sources, the two key modes, and who may use them

**Two sources, one code path** ([ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4):

1. **An OpenAI-compatible server on the box** (Ollama), at a **local address only**, by
   [ADR 0040](0040-a-history-index-on-the-riders-instance.md) D-6's rule as built in
   `apps/instance/src/history/address.ts`, the resolution check included. Its port is never
   published and never tunnelled.
2. **A hosted OpenAI-compatible endpoint**, **`https` only**, on a key the instance holds.

**Two key modes, both allowed** (#1092 comment ruling 5, which replaces #1093 ruling 3's
*"single-rider only"*):

- **Share**: the operator sets one key, and every permitted rider's analysis uses it.
- **Bring your own**: a rider stores their own key, used only for their own analysis. A
  bring-your-own key is stored per athlete, scoped like every other row, and never used for another
  athlete's job.

**Every key, in either mode** (rulings 3, 5 and 6, and the owner's Q6, Q11 and Q12 rulings of
2026-10-07):

- **Held on the instance, and nowhere else.** No key is kept on a device (Q12, D-1).
- **Encrypted at rest** with an operator secret the instance reads from its **environment**
  (Q6: *"an environment variable on the instance"*), listed in `.env.example` (`ENV001`). #1097
  builds it. Because the instance holds the secret, the instance can use a key with the rider's
  device away, and the operator can read a bring-your-own key (§"What this costs").
- **Never logged** (`apps/instance/src/log.ts` §`redacted`), **never in an error**, **never in
  `/metrics`**, **never in an export**, and **never in a backup in clear**: `operator backup`
  copies only ciphertext.
- **Erased with its athlete** (a bring-your-own key), or by the operator (the shared key).
- **Set by the operator command and by the app** (ruling 6). A rider pastes their own key in
  Settings; the operator can set the shared key from the app too. The key goes over the existing
  device-key session and is never sent back.
- **How a pasted key may travel: end-to-end encryption, and until then the home network only.**
  "The tunnel's TLS" ends at Cloudflare's edge, which
  [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6 records: Cloudflare terminates TLS there
  and opens a second connection to the box, so a key pasted through the tunnel would be plaintext
  at Cloudflare. The owner ruled (Q11, 2026-10-07), verbatim: *"encrypt at the application layer,
  end to end: the instance holds a key pair, each device pins its public key when linked, and a
  pasted API key, the synced privacy zones and words-to-mask list, and each job's input and result
  are encrypted so Cloudflare sees only ciphertext. Tracked in
  https://github.com/openzigs/onyourleft/issues/1179. Until it ships, a pasted key is accepted only
  on the home network or through the operator command."* So:
  - **Until [#1179](https://github.com/openzigs/onyourleft/issues/1179) ships**, the instance
    accepts a pasted key (a rider's own, or the shared key set from the app) **only from a request
    on the home network**, or through the operator command. Any other request that carries a key
    is refused before the key is read or stored, with an app sentence.
  - **The home network is defined positively**, by the owner's ruling of 2026-10-07: *"a private
    address on the local network only. WireGuard-class overlays do not count. A request the
    instance cannot place is refused."* So a request is on the home network only when its source
    address is a **private address under [ADR 0040](0040-a-history-index-on-the-riders-instance.md)
    D-6's rule** (the private and link-local ranges `addressSpaceOf` calls `local`) **and** it
    reached the instance directly over the local network. It is **not** on the home network if it
    came through the Cloudflare tunnel, whatever address the tunnel's connector presents; if its
    address is in the shared range `100.64.0.0/10` or otherwise belongs to a WireGuard-class
    overlay; if it reached a port forwarded from the internet; or if it came over loopback, which is
    where a tunnel connector on the same box arrives (the operator command is the loopback path).
    **A request the instance cannot place is refused**, not guessed at. How the instance places a
    request, and what it cannot see (an overlay on a private range it cannot tell from the LAN), is
    #1097's to build and state; where it cannot tell, it refuses.
  - **Once #1179 ships**, the key, the synced masking data (D-10) and every job's input and result
    (D-11, D-12) are encrypted to the instance's key, which each device pinned when it was linked,
    and Cloudflare sees only ciphertext. #1179 is its own ADR and decides the scheme.
- **The app tells a bring-your-own rider that the operator could technically read their key**
  (ruling 5). The sentence is drafted for the owner in #1104.

**Who may ask** (ruling 5, and the owner's Q9 and Q13 rulings of 2026-10-07): **other riders'
access to AI analysis is off by default**, and the operator can switch it on for everyone.

- **The operator is** *"the athlete whose device holds `OYL_INSTANCE_OWNER_KEY`, the key that
  already makes them moderator"* (Q9). Today that variable names a **device key** for registration
  and moderation (#884, `apps/instance/src/config.ts`, `auth/identity.ts` §`moderatorKey`); the
  operator's athlete is the athlete that device key is linked to. #1097 builds the lookup. The
  deputy key (`OYL_INSTANCE_DEPUTY_KEY`) does not make its athlete the operator.
- **"Other riders"** means every athlete on the instance but the operator's own. *The author's
  reading*, for #1097 to build: the switch is one instance setting, held in the database, changed by
  the operator command or by the operator in the app; while it is off a job request from another
  athlete is refused with an app sentence, before a model is called and before a key is read.
- **The switch gates both key modes** (Q13): *"Other riders get no analysis until the operator turns
  it on, whichever key they use."* A rider who brings their own key still needs the switch.

**A rider's own consent to a hosted job, in either key mode** — the owner's Q10 ruling of
2026-10-07, verbatim: *"required in both key modes. A hosted job runs only for an athlete whose own
hosted consent is recorded on the instance and names the endpoint; changing the shared endpoint
withdraws every rider's consent to it; the Ollama source on the operator's box needs none."* It
reconciles Share mode with three rules that would otherwise have been broken for every rider but
the operator, because under Share another rider's masked ride input, goals and history go to an
endpoint **the operator** chose, on **the operator's** key:

- [ADR 0029](0029-camera-imagery-as-a-data-class.md) owner decision **D-B**, restated in D-7:
  *"a hosted model **on the rider's own key, opted into, never default and never silent**"*;
- [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) **D-4**: *"A rider may point this
  client at a model endpoint **they** chose, on **their** key"*;
- [ADR 0036](0036-a-self-hostable-instance-server-now.md) **D-3(d)**'s heading: *"Nothing the
  client already refuses to send starts to leave through the instance"* — and today the client sends
  nothing hosted without the rider's own consent.

What it means for #1097 and #1104 to build:

1. **A hosted job runs only for an athlete whose own hosted consent is recorded on the instance**,
   in **either** mode. Share and bring-your-own differ only in whose key pays; neither is consent.
   The operator's switch decides who *may* ask; the rider's consent decides whether *their* data
   goes to a hosted service. A job without it is refused, before a key is read, with an app
   sentence.
2. **The consent names the endpoint** — the origin the request will go to — so the rider agrees to
   a place, not to "a hosted model". The wording is #1104's, approved by the owner.
3. **Changing the shared endpoint withdraws every rider's consent to it.** A rider who agreed to
   one service has not agreed to the next; their next hosted job asks again. **Rotating the shared
   key at the same endpoint does not withdraw it**, by the owner's ruling of 2026-10-07: *"Rotating
   the shared key at the same endpoint does not re-ask riders' consent. Consent names the endpoint,
   and only a change of endpoint withdraws it."*
4. **The Ollama source needs no hosted consent**, because nothing leaves the operator's box (D-10),
   and the operator's switch still applies.

ADR 0029's and ADR 0031's 2026-10-07 amendments record the reconciliation.

### D-10 — Masking runs on the instance, from masking data synced to it

> **The rule, the owner's (#1092 comment ruling 7), verbatim.** *"**Masking data:** **sync it to
> the instance.** Privacy zones and the words-to-mask list are stored on the instance, per athlete, in scoping and
> erasure, and in the account export (#35's lists). This reverses the device-only note in
> `packages/store/src/masked-words.ts`; the ADR records that."*

- **What is synced**: the rider's privacy zones (labels, centres and radii) and their words-to-mask
  list ([ADR 0029](0029-camera-imagery-as-a-data-class.md)'s 2026-09-29 masking entry,
  [#839](https://github.com/openzigs/onyourleft/issues/839)). Per athlete, in
  `sql-store.scoping.test.ts` and the schema-derived erasure test, and in the account export on
  both sides.
- **What it reverses, recorded as the ruling asks.** `packages/store/src/masked-words.ts` says the
  list is *"NOT in the account export"* and treats the device copy as the only one until sync
  carries it. Both stop being true when [#1101](https://github.com/openzigs/onyourleft/issues/1101)
  lands, and that file's comment changes in that pull request. ⚠️ **A privacy zone in the account
  export is a change too**: the device's export has never carried one, and #1101 owes the export
  manifest's wording for it.
- **The device copy stays canonical** (ADR 0036 D-3(b), (c)). The instance's copy is a copy, and an
  edit on the device is what changes it.
- **On the way, through the tunnel: never readable.** The owner ruled on 2026-10-07 that
  *"#1101 (masking sync) and #1095 (the job stream) do not ship before #1179. Privacy-zone centres,
  the words-to-mask list and job text never cross Cloudflare's edge readable."* So
  [#1101](https://github.com/openzigs/onyourleft/issues/1101) is **blocked on
  [#1179](https://github.com/openzigs/onyourleft/issues/1179)**, and the masking data crosses the
  tunnel only encrypted end to end (the owner's Q11 ruling, D-9).
- **`maskForHosted` runs on the instance, over every message of every hosted request, tool results
  included** — because a history passage or a goal a tool returns can name anything, which is why
  the device could not mask for a tool-choosing run.
- **The Ollama source is not masked**, as today: the rider's instance and their own box keep the full
  text ([ADR 0040](0040-a-history-index-on-the-riders-instance.md) D-9).
- **The preview** (#1092 comment ruling 9, *"the planner's recommendation; not separately ruled"*):
  the masked ride input before the run, and a log of what was actually sent after it. A
  tool-choosing run cannot know in advance which history it will retrieve, so the log is the only
  exact record of a hosted run.

### D-11 — Results stream live, and no unscreened text ever renders

> **The rules, the owner's, verbatim.** #1093 ruling 5: *"**Results stream live** to the ride
> page: an SSE job stream through the tunnel, heartbeats, a SQLite job table, resume, cancel,
> device-key session auth."* #1092 comment ruling 3: *"**Streaming:** live progress, then each section once screened. If a
> later section fails, everything already shown is withdrawn."*

- **It waits for end-to-end encryption.** The owner ruled on 2026-10-07 that #1095, which builds
  this stream, does not ship before [#1179](https://github.com/openzigs/onyourleft/issues/1179):
  job text is among what *"never cross[es] Cloudflare's edge readable"*, so a job's input and every
  event's text go through the tunnel only encrypted to the instance's pinned key.
- **A job is a row**, in a SQLite job table on the instance (ADR 0037 D-5, through Kysely, with a
  tested `down`, D-6). Creating one answers at once, well inside Cloudflare's 125 s timeout; the
  work is not done in the request.
- **Events** go over SSE through #777's one module, read with `fetch` streaming. A heartbeat every
  **25 s** — *the author's choice*, the room socket's ping interval
  ([#780](https://github.com/openzigs/onyourleft/issues/780)) — keeps the tunnel open.
- **What an event may carry**: progress (which step, which tool, by name only), and a section's text
  **only after it has passed the screen on the instance**. Never a raw token.
- **Withdrawn whole** ([ADR 0035](0035-model-written-ride-write-ups.md) D-4's *"withheld whole"*,
  and ruling 3): if a later section fails its screen and its rewrite, a `withdrawn` event retracts
  every section already shown, and the device removes them. Nothing is saved.
- **The device screens each section again on arrival** (D-3) before rendering it.
- **Resume** reads the events after the last one the device saw. **Cancel** is a request on the same
  session; the job stops at its next model or tool call.
- **Authentication** is the device-key session ([#772](https://github.com/openzigs/onyourleft/issues/772));
  the athlete is the session's.

### D-12 — Results are kept on the instance too, and the device copy is canonical

> **The rule, the owner's (#1092 comment ruling 8), verbatim.** *"**Retention:** **keep results on
> the instance** as well as on the device, so another device can see them. The device stays canonical (ADR 0036 D-3(b)/(c)). The
> instance copy is per athlete, erased with the athlete, and included in the export."*

- **What is kept**: the screened write-up of a finished job, beside its job row. Never a withdrawn
  or failed candidate's text.
- **The device's saved `ScreenedWriteUp` is the copy of record.** Another device reads the
  instance's copy and screens it again before it shows a word, as it would any saved row.
- **The job rows and events themselves** (as opposed to the result) are kept **7 days**, the
  owner's Q5 ruling of 2026-10-07: *"7 days. The result itself is kept, per ruling 8."*
  [#1095](https://github.com/openzigs/onyourleft/issues/1095) builds it.
- **The *"what was sent"* log (D-10) is kept with the result, so it outlives the 7-day job rows.**
  ⚠️ This is *the author's choice*, flagged for the owner: Q2's *"the stored what was sent log"*
  says the log is stored, and Q5's 7 days names the job rows, but no ruling says how long the log
  is kept. It is kept as long as the result because it is what explains the result; if the owner
  rules otherwise it goes with the job rows instead, and #1101 builds whichever is ruled.
- **Except the pose summary.** On a hosted job the sent log would contain the side-camera pose
  summary whenever the ride's input carried one (D-6). The owner ruled (Q2) that the summary is
  *"not kept with the result"* and that the stored sent log *"records only that one was sent"*, so
  the log leaves the summary's content out.

### D-13 — No platform models on a phone or tablet: never

> **The rule, the owner's (#1093 ruling 6), verbatim.** *"**No built-in phone models** (Gemini
> Nano, Apple Foundation Models): never."*

Gemini Nano, Apple Foundation Models, and any system model reached through a Capacitor plugin are
refused, as a source of analysis or of anything else this ADR covers. A proposal to add one is a
new ADR, not an amendment. The reasons recorded beside the ruling, none of which it depends on:
ADR 0031 D-4 condition 3 (neither is OpenAI-compatible, so neither fits the one code path); a
4 096-token window (Apple's TN3193), which #835 already found full without history; and Gemini
Nano's refusal of any inference unless the app is the top foreground app.

### D-14 — ADR 0036 D-3(b), (c) and (d), reconciled

**(b) The device copy is never deleted on an instance's confirmation.** The device saves only a
`ScreenedWriteUp`, and nothing an instance sends deletes a device row. A job's result on the
instance (D-12) is a copy; a job's cancellation or failure changes no device row; and a device that
already holds a write-up keeps it whatever the instance later says.

**(c) The instance is never the only place a rider's data is.** The write-up's copy of record is
the device's. Job rows and events are derived and transient. The masking data the instance holds
(D-10) originates on the device and stays there. An erase on the instance removes the job rows, the
results, the masking copy and any bring-your-own key, and touches no device row.

**(d) Nothing the client already refuses to send starts to leave through the instance** (ADR 0036's
heading, verbatim). Narrowed by D-1 for
the analysis endpoint only. Otherwise kept: the input is built on the device under #809's
exclusions (D-6, the owner's Q1 ruling); **no picture type is reachable** from the job request or from any
instance analysis module — [#799](https://github.com/openzigs/onyourleft/issues/799)'s
`no-picture-reachable` gate is extended to `apps/instance/src/analysis/`; tool results come only
from synced rows; hosted requests are masked on the instance (D-10); and **no job text crosses
Cloudflare's edge readable**, because the job stream (#1095) waits for #1179 (the owner's ruling of
2026-10-07, D-10). **In Share mode (d) holds
because of the owner's Q10 ruling** (D-9): a hosted job runs only for a rider whose own recorded
consent names the endpoint, so no rider's input leaves for a service they never chose. **The pose
summary** reaches the instance only inside the device-built input, only with camera consent, and
**no tool may return a `side-camera-report` item's pose summary**
([ADR 0033](0033-side-camera-link.md) D-3,
[ADR 0040](0040-a-history-index-on-the-riders-instance.md) D-2 item 1) — the owner's Q2 ruling.
⚠️ **Side-camera pictures to the instance** (#1092
comment ruling 1) would make (d)'s *"Camera imagery stays on the device"* false; that is #1106's
privacy ruling, and this ADR does not make it. The owner's Q3 ruling bounds it: *"Pictures travel
only over the home network or a WireGuard-class overlay, never through the Cloudflare tunnel
(ADR 0029 D-6)."*

### D-15 — The owner approved this ADR before anything in #1092 merged

Every other sub-issue of #1092 is blocked by #1093, and this ADR was not to merge until the owner
approved it. The owner answered every question it asked on 2026-10-07 and posted the first-person
consent D-4 rests on the same day. These edits were made in the same pull request, before it
merged, and nothing else changed:

1. **This file's `Status` line**, from *Proposed* to *Accepted*, dated 2026-10-07.
2. **D-4's consent**: the owner's first-person consent on #1093 (Q8), quoted verbatim with its link
   and date, below the ruling's third-person sentence.
3. **This file's answered owner questions** (Q1 to Q13), each recorded as answered with the owner's
   words in §"Owner questions, and the owner's answers", and the decisions they settle rewritten to
   the ruling: D-1 (Q12), D-6 (Q1, Q2), D-7 (Q4), D-8 (Q7), D-9 (Q6, Q9, Q10, Q11, Q13), D-12 (Q2,
   Q5) and D-14(d) (Q1, Q2, Q3, Q10), and §"What this costs" (Q6, Q11).
4. **`CLAUDE.md`**: two lines added beside the invariants block, naming the analysis exception to
   (a) and saying that (d) holds as D-14 narrows it. Against `main` they are an addition: the
   *Proposed* wording they replaced was only ever on this pull request's branch.
5. **`docs/architecture.md`**: the ADR index row and the reservation-table row for 0046 added,
   written as accepted. Against `main` these are additions for the same reason.
6. **The ADR-number record.** It moved out of `CLAUDE.md` while this ADR was open
   ([#1156](https://github.com/openzigs/onyourleft/issues/1156), then #1180): which numbers were
   taken, and when, is [`docs/agents/adr-numbering.md`](../agents/adr-numbering.md), where 0046's
   entry is written as accepted; the next free number is stated in
   [`docs/agents/conventions.md`](../agents/conventions.md) §7 and in `docs/architecture.md`, and
   both say 0047.
7. **The entries in §"Amendments appended to other ADRs"**, appended to each ADR named, dated
   2026-10-07.

---

## What a rider with no instance loses

Asking for a model's write-up of a ride. **From any source**: their own computer, a hosted key on
the device, and a model on the phone are all gone (D-1, D-13).

They keep, with no instance and the network off:

- **Every write-up already saved on the device**, readable, and screened again before it is shown.
- **Every other feature** ADR 0036 D-3(a) lists: recording, the store, pairing, trainer control,
  the game, the library, the arithmetic analysis (zones, bests, load, fitness), routes, workouts,
  import and export.
- **The live side-camera pose model** and its post-ride report (D-3), which are not AI analysis.

The ride page says this in one app sentence where the write-up button was, drafted for the owner in
#1104. That is the whole of the loss, and it is a loss: before this ADR, a rider with a computer of
their own could have a write-up with no server at all.

---

## Consequences

### What this enables

- An agent with history, goals and workouts to read, on a machine that can run one for minutes,
  with results that survive the app being closed and are visible from a second device.
- One set of rules — templates, budgets, screen, mask — in an Apache-2.0 package both the device and
  the instance import, so the screen on the instance and the screen on the device cannot drift.

### What this costs, stated plainly

- **ADR 0036 D-3(a) is no longer unconditional.** A rider without an instance loses a feature that
  works for them today. That is the owner's ruling, and §"What a rider with no instance loses" says
  exactly what.
- **The operator can read a bring-your-own key.** Encryption at rest protects the key from a stolen
  disk or backup, not from the person who holds the operator secret, and the owner ruled that the
  secret is an environment variable on the instance (Q6). The app says so (D-9). #1179's end-to-end
  encryption protects the key from Cloudflare, not from the operator.
- **The rider's most identifying words leave the device**: privacy zones and the words-to-mask list
  are stored on the instance and carried in its export (D-10).
- **Nothing this ADR sends crosses the tunnel readable, and that costs time.** ADR 0029 D-6
  records that Cloudflare terminates TLS at its edge (*"Cloudflare terminates TLS at its edge"*).
  The owner ruled (Q11, 2026-10-07) that this traffic is **encrypted at the application layer, end
  to end**: the instance holds a key pair, each device pins its public key when linked, and a pasted
  key, the synced privacy zones and words-to-mask list, and each job's input and result are
  encrypted so Cloudflare sees only ciphertext. That is #1179's to build, and needs its own ADR.
  And the owner ruled the same day that the analysis traffic **waits for it**: *"#1101 (masking
  sync) and #1095 (the job stream) do not ship before #1179."* So:
  - **No write-up runs on any instance until #1179 ships**, because the job stream (#1095) and the
    masking it needs (#1101) are blocked on it. A rider who loses the device paths (#1103) before
    then has no write-up at all until it does; whether #1103 waits for #1095 is the owner's to
    rule when #1103 is scheduled.
  - **a pasted key is accepted only on the home network or through the operator command** (D-9), so
    no key crosses Cloudflare's edge in clear;
  - **A rider who never reaches the home network cannot set their own key** until #1179 ships; they
    use the shared key, if the operator set one, or none.
- **A rider on a small local model may get no write-up at all.** #795's research, restated in the
  research summary of 2026-10-04, found tool calling **unreliable on small local models**, and that
  **Ollama's OpenAI-compatible endpoint ignores `tool_choice`**, so the agent cannot force a tool
  call there. With #1092 comment ruling 4's *"say so and stop. There is no fixed-chain fallback"*,
  an operator whose only source is a small model on the box may see every job fail, where ADR
  0035's fixed chain asked such a model for one section at a time. #1098 measures it on the fake
  model server's misbehaving cases and on at least one real small model, and states the figure.
- **A model-chosen tool loop is easier to steer by injected text** than an app-decided chain (OWASP
  LLM01:2025). The walls in D-7 — read-only, one athlete, no network, no trainer, budgets, the screen
  twice — are what is claimed; that a real model is unaffected by an injected note is not.
- **A third-party SDK on the server**, with an unused gateway in its closure (D-8), and a
  process-spawning library the day the gateway moves to `@vercel/oidc` 4.x.
- **CI grows again** in a job already near its stop (`CLAUDE.md` §4c). #1096's fake model server
  keeps the network and real models out of it; each pull request states its added case time.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #1094 | Moves the core to `packages/analysis` with no behaviour change; re-runs D-4's authorship check over the files it moves |
| #1095 | The job table, routes and SSE stream (D-11), job-row retention (D-12). **Blocked on #1179** (the owner's ruling of 2026-10-07): it does not ship before job text can cross Cloudflare's edge only encrypted |
| #1096 | Installs the SDK in one module; the throwing default provider and its red control; the fake model server; reconciles D-8's table with pnpm's resolution |
| #1097 | The two key modes, encryption at rest with the operator secret from the environment (Q6), the operator as the athlete of the device holding `OYL_INSTANCE_OWNER_KEY` (Q9), the operator switch over both key modes (Q13), a rider's own endpoint-naming hosted consent kept across a key rotation at the same endpoint (Q10, and the ruling of 2026-10-07), and a pasted key accepted only from the home network, defined positively as a private LAN address with overlays and unplaceable requests refused, until #1179 ships (Q11, D-9) |
| [#1179](https://github.com/openzigs/onyourleft/issues/1179) | Application-layer end-to-end encryption between the app and the instance (Q11): its own ADR first; then a pasted key, the synced masking data and every job's input and result are encrypted to the instance's pinned key. **#1095 and #1101 wait for it.** When it ships, D-9's home-network rule for a pasted key can be lifted by an amendment |
| #1098 | The agent loop, the tools, the budgets (D-7) |
| #1099, #1100 | `history_search`, and workouts synced and readable (D-7) |
| #1101 | Masking data synced; masking on the instance; the preview and the sent log (D-10). **Blocked on #1179** (the owner's ruling of 2026-10-07): privacy-zone centres and the words-to-mask list never cross Cloudflare's edge readable |
| #1102 | The app client: start, stream, cancel, resume, screen, save (D-3, D-11) |
| #1103 | Removes the device paths — and **not** ADR 0033 D-11's until #1106 lands |
| #1104 | Every disclosure: the ride page's no-instance sentence, the bring-your-own sentence, the policy and Play Data Safety — **approved by the owner before merge** |
| #1106 | Side-camera pictures to the instance: its own privacy ruling first |
| #1058 (ADR 0044) | A live view and a pressed snapshot on the side-camera path. A snapshot is a picture: it must not be reachable from a job request or an instance analysis module (D-14(d)'s extended `no-picture-reachable` gate), and is never sent to the rider's computer, to a hosted model or to an instance ([ADR 0044](0044-side-camera-live-view-and-snapshot.md) D-11, the owner's answer of 2026-10-04 to its question 6; [#1067](https://github.com/openzigs/onyourleft/issues/1067) repeats it as a criterion) |
| #1059 (ADR 0045) | Fit from one side camera. It decides whether a model's write-up may state a fit angle, and so whether `camera/write-up-screen.ts`'s degree rule narrows. **That screen moves into `@onyourleft/analysis` (D-5) and runs twice, on the instance and on the device (D-7, D-3)**: any narrowing is made once, in the package, and both screens take it together. ADR 0030 D-4's frontal-plane screen is not narrowed by either |
| #1067 | Sends the fit check's angles to the model and narrows the screen as ADR 0045 permits. Its component is `apps/web`'s `input.ts`, `template*.ts`, `write-up-screen.ts` and `angle-claims.ts` — **every one of them moves in #1094**, so #1067 lands in `packages/analysis` after #1094, or #1094 moves its changes with no change of behaviour. Under D-1 its fit section goes **to the instance** inside the job's input, and is bound by D-6 and the owner's Q1 and Q2 rulings as the pose summary is. Q2's ruling names the pose summary only; whether a fit number may be kept in the stored sent log (D-12) is #1067's to put to the owner, and until then it is left out as the pose summary is (*the author's choice*) |

---

## Amendments appended to other ADRs

Each entry below was appended under [ADR 0013](0013-adr-amendments.md) to the ADR named, **dated
2026-10-07**, in the pull request that accepted this ADR, with no existing line touched — the shape
[ADR 0040](0040-a-history-index-on-the-riders-instance.md) used for its own three. Each names the
statement in that ADR that became false. Until 2026-10-07 this section was §"Amendments owed", and
the entries were not yet made.

| ADR | The statement that becomes false | What the entry says |
|---|---|---|
| [0029](0029-camera-imagery-as-a-data-class.md) | The hosted consent's *"Your key is kept on this device"* (its 2026-09-28 and later entries); the 2026-09-28 entry's *"the key is the rider's own and stored on the device"* (an amendment entry, **not** D-7's body); D-7's "Whose key" row, *"It is not a secret this project holds and `.env.example` gains nothing"*, which the operator secret of D-9 contradicts; and owner decision D-B as D-7 states it, *"on the rider's own key"*, which Share mode contradicts | The key is held by the instance, in one of two modes (D-9), encrypted with an operator secret `.env.example` lists, and the device-held key goes with the on-device runner (Q12); the consent is replaced by #1104's wording. **Share mode is reconciled with D-B by the owner's Q10 ruling**: a hosted job runs only for a rider whose own recorded consent names the endpoint. Its local-address rule is applied to the instance's model URL by ADR 0040 D-6's rule. Pictures to the instance are #1106's, and **D-6's rejection of Cloudflare Tunnel by name is untouched by this ADR**; the entry records the owner's Q11 ruling: application-layer end-to-end encryption (#1179), and until it ships a pasted key only on the home network or through the operator command, with the masking sync and the job stream waiting for it (the owner's ruling of 2026-10-07); and Q3's bound on #1106, never through the tunnel |
| [0031](0031-model-licences-and-the-hosted-model-hole.md) | D-4's rule, *"A rider may point this client at a model endpoint **they** chose, on **their** key"*, and *"it takes a URL and a key the rider typed"*, for the shared key the operator typed; condition 1's *"`.env.example` gains nothing"*, which D-9's operator secret contradicts (it is a secret that protects a key, not a key of this project's, which condition 1's first sentence still forbids); and condition 2 as it reads against a dependency with an unused vendor default | D-4 holds on a new path for bring-your-own; Share mode's *"they chose"* is met by the rider's own endpoint-naming consent (Q10); the operator secret is a secret that protects a key, not a key of this project's; the gateway is in the closure, guarded, never called, and the owner ruled condition 2 met (Q7, D-8). D-4's 2026-09-29 entry (the embedding default) is unchanged |
| [0033](0033-side-camera-link.md) | D-11's *"The phone never talks to the computer … the tablet sends them on through `camera/analysis-transport.ts`"*, once #1106 moves it | A pointer only: D-11 is **not** decided by this ADR; #1092 comment ruling 1 moves it to the instance, and #1106 records that ruling |
| [0035](0035-model-written-ride-write-ups.md) | D-7's *"The app decides every step; the model never chooses a tool"*; D-7's *"The rider's own computer is offered first when both it and a hosted model are set up"* (line 321 of that file); D-8's *"Nothing is sent in the background"*; D-9 B (own computer) and C (hosted, device key); D-10's *"Where each piece lands"* | D-7 superseded on the instance, and its source order gone with the rider's computer; D-8's bullet narrowed (D-7 above); B withdrawn; C replaced by #1104; D-10 redirected to #1092. **D-4 and D-5's never-sent list are unchanged** |
| [0036](0036-a-self-hostable-instance-server-now.md) | D-3(a) for AI analysis; D-3(d)'s *"the rider's own analysis endpoint (ADR 0035) is the rider's computer, not this instance"*; and its own 2026-09-29 amendment's *"a rider with no instance gets the write-up without history and loses nothing, which keeps (a)"* and *"The analysis endpoint that **writes** a write-up is still the rider's computer or a hosted service they chose"* | Superseded by D-1, for analysis only; (b) and (c) reconciled by D-14; the 2026-09-29 entry's two sentences are recorded as no longer true, since a rider with no instance has no write-up and the endpoint is the instance's |
| [0037](0037-instance-runtime-hosting-and-transport.md) | D-9's table as the instance's whole runtime closure | Adds D-8's rows. D-2: the agent's engine is written against ports, and only one Node-adapter module imports `ai` |
| [0040](0040-a-history-index-on-the-riders-instance.md) | D-2's *"Where the screen and the summary builder run: on the device, and nowhere else"*; D-8's *"**A separate "history" step** … is the **only** step that sees a passage"*; D-9's masking on the device; §Consequences' *"(a) a rider with no instance loses nothing — the write-up works exactly as ADR 0035 built it"* (line 141 of that file) and *"one who does not gets the write-up without history and loses nothing"* (line 479); and D-9's *"the history step runs on the rider's own computer only"* | The screen runs on both, from `@onyourleft/analysis`, and the summary builder stays on the device; the history step becomes the `history_search` tool (#1099), with the same 6 × 900-character bounds and the same fence; masking moves to the instance (D-10); the three sentences about a rider with no instance, and about the rider's own computer, are recorded as no longer true |

**Outside `docs/adr/`**:

- **Made in the pull request that accepted this ADR**:
  - **`CLAUDE.md`**: two lines beside the warning block that states ADR 0036 D-3's four invariants,
    naming this ADR's exception to (a) and saying that (d) holds as D-14 narrows it. They stay in the
    always-on root rather than moving to `docs/agents/layout.md`, because the block's own heading,
    *"a rider with no instance loses nothing"*, is false for the write-up.
  - **[`docs/agents/conventions.md`](../agents/conventions.md) §7 and `docs/architecture.md`**: the
    next free ADR number, 0047; and 0046's entry in
    [`docs/agents/adr-numbering.md`](../agents/adr-numbering.md).
- **Owed, and not made here**, each in the pull request named:
  - **The repository layout** — since #1156 the area files
    [`docs/agents/packages.md`](../agents/packages.md) and
    [`docs/agents/instance.md`](../agents/instance.md) rather than `CLAUDE.md` §2: `packages/analysis`
    (#1094) and `apps/instance/src/analysis/` (#1095), each in the pull request that creates it.
  - **`packages/store/src/masked-words.ts`**'s export note (D-10), in #1101.
  - **`docs/privacy-policy.md` and Play Data Safety**, in #1104, approved by the owner before merge.

---

## Owner questions, and the owner's answers

This ADR asked the owner thirteen questions when it was proposed on 2026-10-04. **Every one is
answered**: Q1 to Q7 and Q9 to Q13 in three comments on
[PR #1114](https://github.com/openzigs/onyourleft/pull/1114) on 2026-10-07 (quoted in full in
Context), and Q8 on [#1093](https://github.com/openzigs/onyourleft/issues/1093) the same day. Each
question is kept as it was asked, with the ruling that answered it and where the ruling is applied.
Until 2026-10-07 this section was §"Owner questions left open".

1. **What the job is sent** (D-6). Asked: the device-built input (the author's recommendation), or
   an input the instance builds from the synced ride. **Answered (Q1)**: *"the device builds the
   asked-about ride's input with #809's builder and sends it in the job request. The exclusion walk
   stays where it runs today."* Applied in D-3 and D-6.
2. **The pose summary on the instance** (D-6, D-14(d)). Asked: may the side-camera pose summary be
   sent to the instance inside a job's input, and is it kept with the result (D-12), given that
   ADR 0035 D-5 and ADR 0033 D-3 were written for the rider's own computer or a hosted model and
   ADR 0040 D-2 keeps it out of the index? **Answered (Q2)**: "sent only inside a job's input and
   only with camera consent. Never indexed, never returned by a tool, and not kept with the result;
   the stored *what was sent* log records only that one was sent." Applied in D-6, D-12 and
   D-14(d). (#1067's fit angles raise the same question; §"Constraints" says how they are held
   until #1067 asks.)
3. **Side-camera pictures to the instance** (#1092 comment ruling 1). Asked: the privacy ruling
   [#1106](https://github.com/openzigs/onyourleft/issues/1106) owes, including ADR 0029 D-6's
   rejection of Cloudflare Tunnel **by name** for a photograph. **Answered (Q3)**: *"left to #1106.
   Pictures travel only over the home network or a WireGuard-class overlay, never through the
   Cloudflare tunnel (ADR 0029 D-6)."* This ADR still does not make #1106's ruling; it records the
   bound (D-14(d)).
4. **The budgets' figures** (D-7). **Answered (Q4)**: *"the drafted figures stand until #1098's
   measurements replace them."* Applied in D-7.
5. **Job-row retention** (D-12). **Answered (Q5)**: *"7 days. The result itself is kept, per ruling
   8."* Applied in D-12.
6. **Where the operator secret lives** (D-9). Asked: an environment variable (the author's choice),
   or a key derived from the device, which would stop the operator reading a bring-your-own key and
   also stop the instance using it with the device away. **Answered (Q6)**: *"an environment variable
   on the instance."* Applied in D-9 and §"What this costs".
7. **The ADR 0031 D-4 reading** (D-8): does a dependency's unused, guarded vendor default meet
   condition 2? **Answered (Q7)**: *"met. Nothing in this repository names, defaults to or suggests
   the dependency's guarded vendor default."* Applied in D-8, and in ADR 0031's 2026-10-07 entry.
8. **A first-person consent to the relicence** (D-4, D-15). Asked: the ruling's *"The owner is the
   sole copyright holder and consents"* is the owner's but drafted in the third person, so the owner
   posts a first-person consent on #1093. **Answered (Q8)**: the owner posted it on 2026-10-07 at
   21:49:06 UTC
   ([#1093 comment 6047535343](https://github.com/openzigs/onyourleft/issues/1093#issuecomment-6047535343)),
   and D-4 quotes it verbatim.
9. **Who the operator is, as an athlete** (D-9). Asked: the athlete holding the moderator owner key
   (`OYL_INSTANCE_OWNER_KEY`), a separate setting, or something else? **Answered (Q9)**: *"the
   athlete whose device holds `OYL_INSTANCE_OWNER_KEY`, the key that already makes them
   moderator."* Applied in D-9.
10. **A rider's own consent to a hosted job, in either key mode** (D-9, D-14(d)). Asked: the
    author's proposal that a hosted job runs only for an athlete whose own consent is recorded on
    the instance and names the endpoint. **Answered (Q10)**: *"required in both key modes. A hosted
    job runs only for an athlete whose own hosted consent is recorded on the instance and names the
    endpoint; changing the shared endpoint withdraws every rider's consent to it; the Ollama source
    on the operator's box needs none."* Applied in D-9 and D-14(d), and in ADR 0029's and ADR 0031's
    2026-10-07 entries.
11. **Cloudflare's edge sees all of it in clear** (D-9, §"What this costs"). Asked: is plaintext at
    Cloudflare's edge acceptable for a pasted key, the synced masking data and every job's input and
    result, or must they take ADR 0029 D-6's other transports? The owner first left it open and
    asked for options (2026-10-07T20:48:15Z). **Answered (Q11)**: *"encrypt at the application
    layer, end to end: the instance holds a key pair, each device pins its public key when linked,
    and a pasted API key, the synced privacy zones and words-to-mask list, and each job's input and
    result are encrypted so Cloudflare sees only ciphertext. Tracked in
    https://github.com/openzigs/onyourleft/issues/1179. Until it ships, a pasted key is accepted
    only on the home network or through the operator command."* Applied in D-9, D-10 and §"What this
    costs"; [#1179](https://github.com/openzigs/onyourleft/issues/1179) builds it. **The owner then
    ruled, from the acceptance review** (Context, the fourth comment), that #1101 and #1095 do not
    ship before #1179, that the home network is a private LAN address only with overlays and
    unplaceable requests refused, and that rotating the shared key at the same endpoint keeps every
    rider's consent. Applied in D-9, D-10, D-14(d), §"What this costs" and §"Constraints".
12. **Is the device-held hosted key removed with the on-device runner?** (D-1.) **Answered (Q12)**:
    *"removed with the on-device runner. Every key lives on the instance (rulings 5 and 6)."*
    Applied in D-1 and D-9.
13. **Does a rider who brings their own key still need the operator's switch?** (D-9.) **Answered
    (Q13)**: *"the operator's switch gates both key modes. Other riders get no analysis until the
    operator turns it on, whichever key they use."* Applied in D-9.

---

## What would make this ADR wrong

- **A feature other than AI analysis starts to need the instance.** D-1 is for analysis only;
  `no-network.test.ts` still admits one module.
- **A word of model text renders before the screen has passed it**, on the instance or the device.
  That is ADR 0035 D-4 broken, and D-11's design is what prevents it.
- **A tool gains a write, a network call, a second athlete or a trainer.** D-7's walls are the
  safety case for letting the model choose.
- **The gateway is reached.** The guard and its red control (D-8) are the test.
- **The instance becomes the only copy** of a write-up or of the masking data. D-14(c).
- **The models riders actually run cannot call tools reliably.** If #1098's measurement shows the
  small local models an operator can run on a home box fail most jobs — tool calls ignored,
  malformed or looping — then *"say so and stop"* (ruling 4) makes the write-up unavailable to
  exactly the riders the instance was meant to serve without a hosted key, and the choice between a
  fixed-chain fallback and that loss goes back to the owner.
- **A hosted job runs for a rider who never agreed to that service.** If Share mode ships without
  the consent the owner's Q10 ruling requires, or with one that does not name the endpoint, ADR 0029
  D-B and ADR 0031 D-4 are broken for every rider but the operator.

## Amendments

- **2026-10-08** — **The SDK is installed, and D-8's table is read against the install.**
  [#1096](https://github.com/openzigs/onyourleft/issues/1096) pinned `ai` **7.0.130** and
  `@ai-sdk/openai-compatible` **3.0.65** (each more than a day old, §8's `minimumReleaseAge`), and
  pnpm resolved `@ai-sdk/provider` 4.0.24, `@ai-sdk/provider-utils` 5.0.56, `@ai-sdk/gateway`
  4.0.106, `@vercel/oidc` 3.2.0, `zod` 4.6.5, `undici` 7.30.0, `eventsource-parser` 3.1.1,
  `@standard-schema/spec` 1.1.0, `@workflow/serde` 4.1.0 and `json-schema` 0.4.0. The packages and
  their licences are the table's; only the versions moved since it was read on 2026-10-04, and
  `execa` is still not in the closure (`@vercel/oidc` is still 3.2.0). `pnpm run check:licences`
  passed and `apps/instance/third-party.txt` lists all fourteen. **One fact the table did not
  record**: `@ai-sdk/provider-utils` 5.0.56 ships **no licence file**, so its notice comes from a
  reviewed entry in `apps/instance/third-party-notices.json` (the repository's own `LICENSE` at
  the commit its tag names), which `scripts/check-third-party-notices.mjs` now reads for a server
  as it reads `apps/web/third-party-notices.json` for the app. (#1096)
- **2026-10-08** — **D-7's figures stand; #1098 replaced none of them, and measured no real
  model.** The agent ([#1098](https://github.com/openzigs/onyourleft/issues/1098)) runs with 24
  model turns, 16 tool calls, ten minutes and 40 000 tokens. Two facts about them that the table
  does not say: under these figures the **tool-call budget binds before the step budget** — every
  turn but the last calls a tool, so 16 calls allow at most 18 turns — and the token budget is
  counted as what is **sent as well as answered**, because a tool-calling run re-sends the whole
  conversation every turn (the chain's `RUN_TOKEN_BUDGET` counts only `max_tokens`).
  `apps/instance/src/analysis/agent.ts` §`AGENT_TOKEN_BUDGET` says so; the owner may rule the
  other reading. No figure was measured against a model an operator runs; that is still owed.
  (#1098)
- **2026-10-09** — **D-9's "until #1179 ships" clause has stopped applying.** As of
  [#1192](https://github.com/openzigs/onyourleft/issues/1192), every phase-1 route of
  [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md) D-7 that exists in
  the route table is reached only sealed on an instance that holds keys
  (`apps/instance/src/sealed/phase-one.ts`). The rest of D-7's phase 1 —
  `POST /v1/auth/recovery-email/clear`, `POST /v1/auth/recovery/reset`, the two account-changes
  routes, and D-8's semantics — is still owed by
  [#1193](https://github.com/openzigs/onyourleft/issues/1193) and
  [#1194](https://github.com/openzigs/onyourleft/issues/1194), and those routes arrive sealed-only.
  None of them carries a key, so ADR 0047 D-13's lift — the owner's D-14 Q2 ruling — holds now: a
  pasted key may come from anywhere, but
  only sealed, signed by a device key, from a device whose pin came from a card, and no plaintext
  key route may exist, on the home network or anywhere else. **Nothing was removed to make that
  so, and that is a fact of the tree, not an omission**: [#1097](https://github.com/openzigs/onyourleft/issues/1097)
  built the operator command and no app key route, so there was no plaintext key route and no
  home-network placement check to take off; the key routes still owed ([#1199](https://github.com/openzigs/onyourleft/issues/1199),
  whose fourth part this lifts) are born sealed-only and are added to that list. The operator
  command stays. (#1192)
- **2026-10-09** — **D-7's "nothing reaches a trainer control point … nothing runs during a ride"
  no longer holds for one job type, the re-plan during the ride.** The owner ruled on
  [#1233](https://github.com/openzigs/onyourleft/issues/1233) (Q2, 2026-10-09): *"Only as
  enumerated moves, only for future blocks, checked by the device (which computes the watts), off
  unless switched on for the ride. ADR 0046 D-7 is amended for the re-plan job type."* A re-plan
  job runs during a ride, starts when the rider has switched re-plans on for that ride (the press
  D-7 requires), and answers with one move from a closed list and one reason from a closed list. No
  tool it is given writes anything or reaches a trainer, and its answer reaches a setpoint only
  through the device's validator and the workout player
  ([ADR 0048](0048-workouts-that-change-during-the-ride.md) D-4 to D-8). **For every other job type D-7 stands as written.** (#1233)
- **2026-10-09** — **D-9's Share mode is withdrawn by the owner, and a hosted model runs only on the
  rider's own key.** The owner ruled on #1233 on 2026-10-09, *"Operator key is not shared with
  riders. If it is hosted they need to bring their own key"*, and, asked whether that reached
  post-ride analysis too, *"yes share mode should go for post ride analysis"* ([recorded on #1092](https://github.com/openzigs/onyourleft/issues/1092#issuecomment-6091274039)). So D-9's
  *"**Share**: the operator sets one key, and every permitted rider's analysis uses it"* no longer
  holds, for post-ride analysis and for re-plans alike: **a hosted model runs only on a key the
  rider brought themselves** (bring-your-own,
  [#1199](https://github.com/openzigs/onyourleft/issues/1199)), under that rider's recorded consent
  naming the endpoint, masked as [#1101](https://github.com/openzigs/onyourleft/issues/1101) does.
  The operator's own analyses may still use the operator's key **for the operator's own account**:
  that is the operator as a rider bringing their own key, not a key shared with anyone. D-9's
  source 1 (the instance's local model) and every rule D-9 states for a key (held on the instance,
  encrypted at rest, never logged, erased with its athlete) are unchanged.
  [ADR 0048](0048-workouts-that-change-during-the-ride.md) D-11 records it. (#1233)
