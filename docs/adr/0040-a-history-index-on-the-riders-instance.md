# ADR 0040: A searchable index of the rider's history on their own instance, for the AI analysis — an index and never a store of record, local embeddings only, scoped to one athlete

- **Status**: Accepted, **subject to the owner's confirmation before it merges** (#834's last
  acceptance criterion). The owner ruled on every product question on 2026-09-29 and those rulings
  are quoted verbatim in Context. The wording in D-11 is **drafted for the owner to approve** and is
  not approved by this ADR. **Nothing is built by this ADR**: the store and the retrieval step are
  [#835](https://github.com/openzigs/onyourleft/issues/835)'s, and the places a rider writes goals,
  notes and documents are [#836](https://github.com/openzigs/onyourleft/issues/836)'s
- **Date**: 2026-09-29
- **Deciders**: **the owner**, in the ruling that opens
  [#834](https://github.com/openzigs/onyourleft/issues/834) and in two comments on it the same day
  (the answers to the research's four questions, and the masking ruling). The author wrote the
  wording and decided the engineering content the rulings do not settle: the row shape, the
  retention and export rules, the passage exclusions, and the trigger for the fallback index. Each
  such point is marked *the author's choice* where it is made
- **Issue**: [#834](https://github.com/openzigs/onyourleft/issues/834). Parent epic
  [#795](https://github.com/openzigs/onyourleft/issues/795); relates to
  [#16](https://github.com/openzigs/onyourleft/issues/16)
- **Number**: **0040**, read from [`docs/architecture.md`](../architecture.md)'s ownership table on
  2026-09-29, which said *"The next free number is 0040"*. No open pull request adds a file under
  `docs/adr/` (checked the same day against #879, #889, #891, #892, #893 and #896)
- **Supersedes**, narrowly and **for the instance's embedding model only**:
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4's *"no default endpoint"* and
  *"no vendor is named in source"*, and [ADR 0035](0035-model-written-ride-write-ups.md) D-3's
  bullet *"No vendor, model or service is named or defaulted"*, as far as the embedding model is
  concerned (D-5). Each of those ADRs, and [ADR 0036](0036-a-self-hostable-instance-server-now.md),
  gains an appended amendment in the same pull request ([ADR 0013](0013-adr-amendments.md)). **No
  existing ADR line is edited**
- **Does NOT supersede**, named so none of it is read as touched: ADR 0031 D-2 (which licences are
  admissible), D-3 (a hosted model needs a named ADR), D-4 for the **generative** model on either
  path, and D-5; ADR 0035 D-4 (the runtime screen), D-5's *"never sent"* list for anything but the
  rider's own typed text on the hosted path (D-9), and D-8; ADR 0036 D-3's four invariants, all of
  which D-1 below keeps; [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-1 and D-8 in full
- **Relates to**: [ADR 0037](0037-instance-runtime-hosting-and-transport.md) (D-2's two adapters,
  D-5's SQLite through Kysely, D-6's tested `down`, D-8's home machine behind a tunnel),
  [ADR 0014](0014-portable-identity.md), [ADR 0004](0004-privacy-and-location.md) decision D

---

## Context

### The question

The ride write-up of [ADR 0035](0035-model-written-ride-write-ups.md) reads **one** ride. A rider
asking *"how did this compare with the last time I rode it?"* or *"am I on track for my plan?"* is
asking about their history, and nothing in the program can put their history in front of the model.
The owner ruled that the rider's own instance should hold a searchable index of it. That is the
first time free text a rider typed, and a digest of their health and fitness history, is held on a
server by this project's code — so it is a decision about a data class, not only about plumbing.

### What the owner decided, quoted so it is not argued again

The ruling that opens #834, verbatim:

> **Owner ruling, 2026-09-29:** the AI analysis (#795) gets a **RAG store on the instance server**,
> so the agent can draw on the rider's history.
>
> - **Where:** a RAG store on the rider's own instance (`apps/instance`, ADR 0036/0037), not on the
>   device.
> - **Embeddings:** computed **on the server by a local open model**, for example served by Ollama
>   on the owner's home box. Ride data never leaves the rider's machine to build the index. No vendor
>   may be named as a default (ADR 0031 D-3).
> - **Contents, all four:** past screened write-ups; ride and section summaries (power, heart rate,
>   cadence, pacing, route or climb); the rider's goals and notes; and training plans or reference
>   documents the rider adds.

The answers to the research's four questions, the same day, verbatim:

> 1. **Index:** brute-force cosine in TypeScript over an ordinary SQLite table, with `sqlite-vec`
>    0.1.9 as the named fallback. Accepted.
> 2. **Embedding model:** the server **names a default: `nomic-embed-text` v1.5**
>    (`nomic-ai/nomic-embed-text-v1.5`, Apache-2.0, 768 dimensions), pulled through Ollama. It stays
>    configurable, and the server adds the model's `search_document:` and `search_query:` prefixes.
>    This is an owner ruling for the **self-hosted, local** embedding model only. The ADR records it
>    as a narrow exception to ADR 0031 D-3/D-4's "name no model" rule, for the reason that nothing
>    leaves the rider's machine. The docs never name `embeddinggemma` or any other model under a
>    non-OSI licence.
> 3. **Embedding address:** **local only.** The instance refuses any embedding address that is not
>    loopback, a private address or a Compose service name. This mirrors ADR 0029's Q1 amendment.
> 4. **Hosted model:** retrieved history, **including goals, notes and documents (free text)**,
>    **may** go to the hosted model (#803). The hosted consent wording (a further ADR 0029
>    amendment, drafted for the owner to approve), the privacy policy and Play Data Safety must
>    change to say so, in the PR that first sends history to the hosted model.

And the masking ruling, verbatim:

> **Owner ruling, 2026-09-29:** hosted-bound text is masked (#839): patterns, privacy-zone places
> and a rider word list, with a preview. The rider's own computer and instance keep the full text.
> The ADR records this.

⚠️ **One reading of the rulings departs from their words, for the confirmation to cover.** Answer 2
calls the default an exception to *"ADR 0031 D-3/D-4's 'name no model' rule"*. This ADR supersedes
**D-4 only** and leaves D-3 standing (see *Does NOT supersede* above, and D-5): D-4 is the rule that
names no vendor or default, while D-3 is about a **hosted** model needing a named ADR, and a local
embedding model is not hosted. D-5 still records what D-3 asks of a named model — its card and its
licence, read on a date — so nothing D-3 protects is lost. If the owner meant D-3 to be superseded
as well, that is one line of an amendment.

### What was measured and read, and by whom

The research on #834 (2026-09-29, the body's §1 to §5) is the evidence this ADR rests on; it is
cited rather than re-measured, and nothing below claims a figure that research did not produce. In
short:

| Finding | Source, from the research |
|---|---|
| Brute-force cosine over unit-length 768-dimension vectors, top 8: 1.3 ms at 1 000 rows, 7.0 ms at 10 000, 37 ms at 50 000, per query, in memory | §1, *measured*, Node 24.20.0, Apple M4 Pro. ⚠️ The cost of reading the BLOBs out of SQLite was **not** measured |
| `sqlite-vec` 0.1.9 loads into `node:sqlite` only with `allowExtension: true`, is glibc-only (does not load on Alpine), ships no licence file in its npm packages, and cannot run on a Durable Object | §1, *measured* on three platforms; the Durable Object half is read from Cloudflare's docs and one third-party issue |
| Ollama's `/api/embed` **truncates silently by default** (`truncate: true`); with `truncate: false` an over-long input is HTTP 400. Its vectors are L2-normalised. **Its API has no authentication** | §2, read and *measured* on Ollama 0.34.4 |
| `nomic-embed-text` v1.5 wants `search_document:` and `search_query:` prefixes; vectors from two models, or one model with and without prefixes, are not comparable | §2, read from the model pages |
| `nomic-ai/nomic-embed-text-v1.5`'s model card declares `apache-2.0`; `google/embeddinggemma-300m` declares `gemma`, a non-OSI use-restricted licence | §2, the Hugging Face cards' `license` field, read 2026-09-29 |
| CPU-only, `nomic-embed-text` embeds about 6 passages of 800 characters a second on four cores; one query about 71 ms | §2, *measured* in Docker on an Apple M4 Pro. ⚠️ **Not** a Windows PC |
| The summary step is at 8 203 of its 8 600-character bound and the rewrite at 8 511 of 9 000, which is 4 024 of 4 096 tokens at 3 characters a token — **no room for passages in either** | §3, arithmetic against `template-v1.ts` and `template.test.ts` at `c4467bc` |
| OWASP LLM01:2025 says no prevention of prompt injection is known to be fool-proof, and lists segregating external content; LLM08:2025 asks for strict partitioning of a vector store | §4, read 2026-09-29 |

---

## Decision

Eleven decisions. **D-1** and **D-2** are what the store is and what it holds. **D-3** is scoping.
**D-4** to **D-7** are the index and the embedding model. **D-8** and **D-9** are retrieval and the
two model paths. **D-10** and **D-11** are erase, export, retention and disclosure.

### D-1 — The store is on the rider's instance, and it is an **index**, never a store of record

> **The rule.** Every row of the history index is **derived** from a row the instance already holds
> because the device synced it ([#776](https://github.com/openzigs/onyourleft/issues/776)). Delete
> every index row and the index can be rebuilt, in full, from those source rows and nothing else.

- **Goals, notes and documents originate on the device**, like every other thing a rider types,
  and reach the instance by sync. #836's body already says so for goals and notes (*"Stored on the
  device first and synced (ADR 0036: the device copy is canonical)"*); ⚠️ **for documents it is the
  author's choice**, made because the alternative breaks an invariant. A document added on the
  instance and held only there would make the instance *"the only place a rider's data is"*, which
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3(c) forbids. So a document is kept on
  the device, carried in the device's account export, and synced; the instance's copy is a copy.
- **So the source of truth for a note is the device**, and the answer to #834's *"is it
  rebuildable?"* is yes, for all four contents. The instance's sync tables hold the synced source
  (bundle #881 builds the `goal`, `note` and `document` kinds); the index holds passages cut from
  them, their vectors, and nothing a rider could lose.
- **ADR 0036 D-3 holds unchanged**: (a) a rider with no instance loses nothing — the write-up works
  exactly as ADR 0035 built it, with no history step (D-8); (b) nothing here deletes a device row;
  (c) is kept by the rule above; (d) nothing the client refuses to send starts to leave — a picture
  never enters the index (D-2).

### D-2 — The data class, and what the index may and may never hold

**What it is**: health and fitness data (heart rate, power, cadence, weight and watts per kilogram,
threshold power, pacing) and **free text** the rider typed or added, held on a server the rider
chose. The free text is the new part: a note or a document can hold anything — a name, a place, a
medical condition, text written by somebody else aimed at a model.

**The four contents, and nothing else** (owner's ruling):

| Content | What a passage is cut from | Screened before indexing |
|---|---|---|
| Past write-ups | A saved write-up as synced — the device saves only a `ScreenedWriteUp` — screened **again on the device** by [ADR 0035](0035-model-written-ride-write-ups.md) D-4's screen when it comes back from retrieval | Yes, D-8, on the device |
| Ride and section summaries | Text the **device** builds from #809's input builder (`apps/web/src/ride-analysis/input.ts`) and syncs as a source row of its own | No model text in them |
| Goals and notes | The rider's text, as synced | No — it is the rider's own |
| Training plans and reference documents | The rider's plain text or Markdown, as synced (#836: no PDF, no image) | No — it is the rider's own |

**Never in the index**, each a rule #835 is held to by a test:

1. **A picture, or anything made from one.** #799's gate
   (`apps/web/src/camera/no-picture-reachable.test.ts`) is extended to the server path: no module
   that writes or reads the index may reach a picture type. ⚠️ **And not the pose summary either**
   — *the author's choice*. [ADR 0035](0035-model-written-ride-write-ups.md) D-5 sends it only with
   camera consent, whole-session, and never paired with a section; an index that returns it beside
   another ride's section would break [ADR 0033](0033-side-camera-link.md) D-3's *"Nothing on the
   tablet joins [pose numbers] to a ride reading"* in spirit, and the owner's four contents do not
   name it.
2. **In the passages the program generates** (summaries and write-ups): no coordinate, no absolute
   altitude, no calendar date or time of day, no ride, route or athlete name, and no identifier —
   #809's exclusions, word for word, because a passage is model input exactly as #809's is. A
   passage may say how long **before the ride being written about** its ride was, in whole weeks
   (*the author's choice*: history without any sense of time is not history, and a relative age
   names no day). A route or climb is described by its length, gradient and climb, never its name.
3. **The rider's own text is not filtered** on the way in: it is theirs, and it is kept whole on
   their instance (the masking ruling). What protects it on the hosted path is D-9.

**Where the screen and the summary builder run: on the device, and nowhere else** — *the author's
choice*. `apps/instance` may not import `apps/web` (`boundaries/dependencies`), and ADR 0035 D-4
requires **one** set of matchers (`apps/web/src/camera/angle-claims.ts`, `write-up-screen.ts`), so
a copy under `apps/instance` is ruled out. Two ways remain, and the first is taken:

- **Taken: the device does both.** The device already builds #809's input and already screens every
  write-up before it saves one. It renders a ride's summary passages as text and syncs them as a
  source row beside the ride (#776 owes the row kind; D-1 holds, because the index is still derived
  from synced rows), and it screens every retrieved write-up **again on arrival**, before it enters
  a prompt — which is also where a row hand-edited on the instance is caught. The instance holds,
  embeds and ranks text, and interprets none of it.
- **Not taken: move both into a `packages/` module** both apps import. That moves AGPL-3.0 code under
  Apache-2.0 by the path rule (§3 of `CLAUDE.md`), which is a relicensing question for the owner
  rather than a refactor, and it would put a screen on the instance that the device must run again
  anyway. If the owner wants the instance to screen at indexing time too, that is the route, and an
  amendment.

**A passage's relative age is computed at retrieval, never stored** — *the author's choice*. *"How
long before the ride being written about"* differs for every query, so the row holds no age and the
embedded text holds none. When the instance returns a passage it computes the age in whole weeks
from the source row's own date and the date of the ride being written about (named in the request by
its synced id, so no date travels in it), and returns it as a short label **beside** the passage,
not inside it. The label is **not** part of the 900-character passage budget; it **is** part of the
history step's input, allowed about 40 characters a passage inside D-8's 9 900.

### D-3 — Every row is scoped to one athlete, and there is no cross-athlete retrieval, ever

- **Every index row carries `athlete_id`, and every read and every write filters on it** — the rule
  `packages/store/src/activity-store.scoping.test.ts` enforces on the device, applied on the server,
  where `apps/instance/src/store/sql-store.scoping.test.ts` already enforces it for the instance's
  other tables. #835 extends that test to the index's reads with the three-athlete fixture, so a
  query that forgot the scope is a red build (OWASP LLM08:2025's *"strict logical and access
  partitioning"*).
- **The athlete is taken from the authenticated caller, never from a parameter.** The retrieval
  endpoint has no `athlete` argument to get wrong: it is the device-key session's athlete
  ([#772](https://github.com/openzigs/onyourleft/issues/772)).
- **No shared corpus.** There is no index of anybody else's rides, no public reference library the
  project ships, and no "riders like you". A feature wanting any of those is a new ADR.

### D-4 — The index: brute-force cosine in TypeScript over an ordinary table; `sqlite-vec` 0.1.9 the named fallback

**Chosen** (owner's answer 1): unit-length `Float32` vectors stored as a BLOB in an **ordinary
SQLite table** of `apps/instance`'s store ([ADR 0037](0037-instance-runtime-hosting-and-transport.md)
D-5), read for one athlete and one model (D-7), and ranked by a dot product in TypeScript behind a
small index port. Why, from the research §1:

- no dependency, no native binary, no licence or notices row, no `allowExtension`;
- it runs on **both** of ADR 0037 D-2's adapters, where `vec0` runs on the self-host one only;
- it goes through Kysely's typed builder, the migration test (ADR 0037 D-6) and the schema-derived
  erasure test (`sql-store.erasure.test.ts`) like any other table;
- deleting a source row's passages and their vectors is **one `DELETE` in one transaction**, where a
  separate index file would be two stores to keep in step.

**A row** holds (*the author's choice* of shape, for #835 to build): `athlete_id`; the source's kind
and id; the passage's ordinal within its source; the passage text; the embedding model's name, its
dimension and the prefix convention (D-7); and the vector.

**The fallback**, `sqlite-vec` **0.1.9** (`MIT OR Apache`, admitted by `DEP001`/`DEP002` on its
`MIT` operand), is taken **only** when a query measured **on the owner's box**, reading one
athlete's vectors out of SQLite and ranking them, takes longer than **250 ms** — *the author's
choice* of trigger, about a quarter of a second against a write-up run that already takes tens of
seconds, and chosen so the research's unmeasured half (reading the BLOBs) is what decides. Taking
it is a decision the pull request that does so records with that measurement, and it brings every
cost the research names, all of them owed in that pull request:

- a **Debian** base image, because the extension is glibc-only;
- `allowExtension: true` on the database handle, and nothing else loaded through it;
- a **reviewed entry** in the instance's own notices document, because the npm packages ship no
  licence text (`check:notices`, §4g);
- erasure coverage of the `vec0` table **and its shadow tables**;
- and the self-host adapter only: the Durable Object adapter keeps brute force.

### D-5 — The embedding model: a named default, `nomic-embed-text` v1.5, as a narrow exception to "name no model"

> **The rule, the owner's.** The instance's embedding model **defaults to `nomic-embed-text` v1.5**
> (`nomic-ai/nomic-embed-text-v1.5`, 768 dimensions), served by a local Ollama, and stays
> configurable. The instance adds the model's `search_document:` prefix to a passage and
> `search_query:` to a query.

**Why this is an exception, and why it is narrow.** [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md)
D-4 permits bring-your-own-model **because** the client names no vendor and no default: naming one
is recommending one. The owner's reason for the exception is that **nothing leaves the rider's
machine**: the default is weights the operator pulls onto their own box, called at a local address
(D-6), and no third party sees a byte. So the exception covers exactly one thing — **the instance's
embedding model** — and ADR 0031 D-4 stands for the **generative** model on every path, and for
anything the client ships. The client names no embedding model at all: it never calls one.

**What the default's licence is, recorded as ADR 0031 D-3 asks of a named model** although it is not
hosted: the upstream model card is `https://huggingface.co/nomic-ai/nomic-embed-text-v1.5`, its
declared licence is **`apache-2.0`**, read on **2026-09-29** (the research's §2), and what is
transmitted is nothing — it runs on the rider's machine. That licence is **permissive**, admissible
anywhere under ADR 0031 D-2.

**Why it is in no closure and has no `ASSETS.toml` row.** The weights are neither committed (ADR 0031
D-1) nor hosted (D-3): the operator pulls them with Ollama, and Ollama itself (`ollama/ollama`, MIT)
is a separate container the operator runs. No npm package is added — the instance calls
`/api/embed` with plain `fetch` — so `DEP001`, `DEP002` and `check:notices` see nothing new, and the
Android app's `third-party.txt` must not change.

**The rule for every other model the project names.** The instance documentation, its example
Compose file and any comment may name an embedding model **only if its declared licence is
admissible under ADR 0031 D-2** (the permissive or weak rows). ⚠️ **`embeddinggemma` is never
named**, though Ollama's own documentation leads with it: its `gemma` licence is non-OSI and
use-restricted, D-2's last row. The same holds for any other model under such a licence. A rider may
configure any model they like on their own box; what is refused is this project suggesting one.

**`truncate: false`, always.** Ollama's default silently cuts an over-long input, which is #795's
silent-truncation defect on the embedding side. An over-long passage is an error the instance
reports, never a cut vector.

### D-6 — The embedding address is local, or the instance refuses it

> **The rule, the owner's.** The instance refuses an embedding address that is not **loopback**, a
> **private address**, or a **Compose service name**. This mirrors
> [ADR 0029](0029-camera-imagery-as-a-data-class.md)'s Q1 amendment for the device.

- **What counts as configured** (*the author's reading*, for #835 to build and test): a loopback
  literal or `localhost`; an IPv4 or IPv6 literal in a private, link-local, shared (`100.64.0.0/10`)
  or unique-local range — the ranges `apps/web/src/camera/analysis-endpoint.ts` §`addressSpaceOf`
  calls `loopback` or `local`; and a **single-label** hostname (no dot), which is what a Compose
  service name is. Anything else is refused — a public name, and a `.local`, `.home.arpa` or
  `.internal` name too. The configuration is checked **when it is read**, and an instance with a
  refused address starts with the history index **off** and says why, rather than refusing to start
  at all: the rest of the instance does not depend on it.
- **What counts as connected — the half that makes the rule a promise rather than a spelling.** A
  name is not an address: a single-label name can be completed by a resolver's search domain, and
  any name can resolve anywhere. So on **every** connection the instance resolves the configured
  name itself, **requires every address it resolves to to be in the same ranges**, and connects to
  the address it checked — never re-resolving between the check and the connect, which is the gap a
  rebinding answer uses. A name that resolves to any address outside those ranges, or to none, is
  refused for that request, and D-6's last bullet applies: nothing is sent anywhere. #835 tests it
  with a stub resolver: a single-label name answering with a public address is refused, and the
  same name answering with a private one is accepted, as the control. With that check, *"ride data
  never leaves the rider's machine"* no longer depends on how the box's DNS is configured.
- ⚠️ **This is NOT the device's rule, and it inverts it in two places, on purpose — for the owner
  to confirm knowingly.** `addressSpaceOf` **refuses** a single-label name and **accepts** `.local`,
  `.home.arpa` and `.internal`. Its reason is that a page is told nothing about where a name
  resolved to, so it can only accept names that are local by construction, and a single-label name
  is completed by a search domain the page cannot see. The instance **can** see where a name
  resolved to, so it checks the answer instead (the bullet above), which is strictly stronger than
  either spelling rule; and it accepts single-label names because a Compose service name is one,
  which the owner's ruling names. It refuses `.local`, `.home.arpa` and `.internal` **not** because
  they are less safe once the answer is checked, but because the owner's list names three forms and
  these are none of them, and mDNS is not answered inside a Compose network anyway. Widening the
  list to them is an amendment, not a review note. The owner's words *"This mirrors ADR 0029's Q1
  amendment"* are therefore read as *the same intent — local only, fail closed — on a machine that
  can check more*, not as the same list.
- **The Ollama port is never published and never tunnelled.** Its API has no authentication
  (research §2, *measured*), so the project's example Compose file puts Ollama on the instance's
  network with **no published port**, and the Cloudflare Tunnel ([#807](https://github.com/openzigs/onyourleft/issues/807))
  routes to the instance alone. A self-hoster who publishes it has exposed an unauthenticated model
  server, and the documentation says so in those words.
- **It fails closed.** When the model cannot be reached, nothing is indexed and nothing is
  retrieved; a source row waits to be indexed. Nothing is embedded anywhere else as a fallback.

### D-7 — A change of model re-embeds everything, and rows from two models are never compared

- **Every row records the model's name, its dimension and the prefix convention** (D-4). Vectors
  from two models, or from one model with and without prefixes, are not comparable (research §2).
- **Retrieval reads only rows of the configured model, dimension and convention.** A row of any
  other is never ranked, whatever its score would have been.
- **A change of model re-embeds every row** from its passage text, which the row keeps for this
  reason. Until it finishes, retrieval returns fewer passages, or none, rather than mixing. At the
  one measured rate (about 6 passages a second, CPU-only, research §2) 5 000 passages take about
  14 minutes; the owner's box has not been measured and #835 owes that figure.

### D-8 — Retrieval, and how retrieved text reaches the model: a separate history step, budgeted in characters

**Retrieved passages are rider data, and a retrieved write-up is untrusted model output.** So:

- **A separate "history" step**, in a new template version
  ([ADR 0035](0035-model-written-ride-write-ups.md) D-7's versioned template), is the **only** step
  that sees a passage. The summary and rewrite steps have no room (research §3), and one step is also
  the containment: raw retrieved text reaches one prompt, whose only output is a bounded note.
- **The budget is in characters, stated by the template and sent to the instance**, because the
  instance cannot know the generative model's tokeniser and the template already budgets in
  characters. The planning figures, for #835's `template.test.ts` to hold to the 4 096-token
  arithmetic:

  | | Bound |
  |---|---|
  | Passages returned | **at most 6** |
  | One passage | **at most 900 characters** |
  | The history step's input | about **9 900 characters**, the age labels (D-2) included, `max_tokens` **400** |
  | Its output, the note that reaches the summary | **at most 300 characters** |

  A passage longer than 900 characters is split by the instance when it is indexed, never cut when
  it is returned. If `template.test.ts`'s real numbers disagree with these, the test's numbers win
  and this table is corrected by an amendment.
- **A retrieved write-up is screened again on the device** through ADR 0035 D-4's matchers when it
  arrives, before it reaches the history step's prompt; one that fails is dropped from that run and
  the rider is not shown it (D-2, *Where the screen runs*). The device saved it screened, so a
  failure here means the row changed on the instance.
- **Passages are data, never instructions.** They reach the prompt inside a labelled data fence that
  a passage **cannot close**: a fence marker inside passage text is escaped or the passage is
  refused. The step's instructions say the fenced text is data. (OWASP LLM01:2025, *"Segregate and
  identify external content"*.)
- **The history step's reply goes through the same acceptor and the same screen as every other
  step.** A reply that obeys an injected instruction is refused like any other bad reply.
- **Nothing a passage says can change** which steps run, their bounds, the model's address, or reach
  a trainer, the HUD, the announcer or any network path — `runner-safety.test.ts`'s shape, extended.
- ⚠️ **What is not claimed**: that a real model is unaffected by an injected note. OWASP says no
  prevention is known to be fool-proof, and no test can show it. #835's injection test holds the
  three things above against the scripted model server, and **that is the whole of the claim**.
- **No instance, or an unreachable one, skips the step with a sentence**, as a failed section is
  skipped (ADR 0035; `runner.ts`). A write-up without history is still a write-up.

### D-9 — The hosted model may be sent retrieved history, masked; the rider's computer and instance keep it whole

> **The rule, the owner's (answer 4 and the masking ruling).** The history step may run on the
> hosted model ([#803](https://github.com/openzigs/onyourleft/issues/803)), and its passages —
> **including goals, notes and documents** — may be sent to it. Everything it sends is masked first
> by [#839](https://github.com/openzigs/onyourleft/issues/839)'s `maskForHosted`: patterns,
> privacy-zone places and the rider's word list, with a preview. The rider's own computer and their
> instance keep the full text.

- **This widens ADR 0035 D-5's *"never sent"* list on the hosted path for one thing**: text the
  rider typed, which can name anything. Everything the program generates stays inside #809's
  exclusions (D-2 item 2). The consent must therefore stop saying *"It is not sent your name, where
  you rode, or when"* **as a guarantee** for a run that carries history, because a note can say all
  three and masking is not a guarantee.
- **None of the three disclosures changes here.** The hosted consent (a further ADR 0029 amendment,
  drafted for the owner), `docs/privacy-policy.md` and Play Data Safety change **in the pull request
  that first sends history to the hosted model**, and not before — ADR 0029's rule that *"a policy
  amended in advance, 'so it is ready', is a false statement about a shipped app"*. Until that pull
  request, the history step runs on the rider's own computer only.
- **The preview shows the masked history too.** `RideWriteUpControl.tsx`'s *See what will be sent*
  is the sent text (#839); a run with history previews what history it sends.

### D-10 — Erase, export and retention

- **Retention: a row lives exactly as long as its source row on the instance.** A ride, write-up,
  goal, note or document deleted on the device is deleted on the instance at the next sync (#881
  builds that), and its passages and vectors go **in the same transaction**. Nothing is kept for
  "training", for statistics or after the source is gone.
- **Account erasure on the instance** ([#35](https://github.com/openzigs/onyourleft/issues/35),
  `DELETE /v1/account`) removes every index row and vector for the athlete. The index tables are in
  the schema, so the schema-derived erasure (`sql-store.erasure.test.ts`) covers them the day they
  exist; #835 extends the fixture so the test fails if they are left.
- **"Erase everything" on the device does not reach the instance**, by design (ADR 0036 D-3(c);
  #881). `ERASE_CANNOT_REACH` names what the instance holds once a transport exists (#777), and
  **the index is part of that copy** — the line names the history the instance keeps for the
  analysis when the index ships.
- **The account export carries the sources, not the vectors** — *the author's choice*. The device's
  export carries goals, notes and documents (#836) as the rider's own data; the instance's export
  (#35) carries the synced sources and a manifest line saying an index exists and which model built
  it. Vectors are derived, model-specific and rebuildable (D-1, D-7): exporting them would hand a
  rider an opaque file that means nothing without the same model.

### D-11 — Disclosure: what changes, when, and the wording drafted for the owner

**When**: the privacy policy and Play Data Safety change **in the pull request that first stores
history on the instance** (#835, or #836 for goals, notes and documents), under the same rule D-9
quotes. This ADR changes neither.

**What they must say**, at minimum: that the rider's instance keeps a searchable copy of their
write-ups, ride summaries, goals, notes and documents for the analysis; that it is computed on their
own instance by a model on that machine; that it is deleted with its source and with the account;
and that it is not in the device erase. On Play Data Safety, the instance clauses
[#892](https://github.com/openzigs/onyourleft/pull/892) proposes for the health and fitness rows
(open on 2026-09-29, not merged) are where the index is named, and the free text needs a row of its
own — Play's *"Other user-generated content"* is the likely one — answered by the pull request that
stores it, re-reading Play's definitions on the day.

**Drafted wording, for the owner's approval** — the disclosure #836 asks this ADR to approve, shown
beside the goals and notes field and the documents list. It is shown whether or not an instance is
connected, so its first sentence is conditional: a rider with no instance is a supported state (ADR
0036 D-3(a)), and for them nothing here leaves the device through an instance:

> **What you write here is kept on this device. If you connect an instance, it goes there too, and
> to the model you chose.** When an instance is connected, your goals, notes and documents are
> copied to it when it syncs. It keeps a searchable copy so the analysis can look back at your
> history, and that copy is worked out by a model on that machine, not sent anywhere else to do it.
> When you ask for an analysis, the parts that match are sent to the model you set up — on your own
> computer, or, if you turned it on, a service you chose, after the details on your list are
> masked.
>
> A model reads this text. If a document came from somewhere else, it may contain instructions
> written for a model; the app treats everything here as information, not instructions, but no
> safeguard is perfect.

---

## Consequences

### What this enables

- #835 can build the store and the history step, and #836 the places a rider writes, against a
  recorded decision rather than an issue thread.
- A write-up can compare a ride with the rider's own past, on their own machine, with no vendor in
  the loop.

### What this costs, stated plainly

- **Free text on a server, with a model reading it.** A note is the most likely carrier of an
  injected instruction (OWASP LLM01:2025's indirect injection), and D-8 contains it structurally
  rather than preventing it. The disclosure says so, and the claim stops at what a test can hold.
- **A second model to run.** A self-hoster who wants history runs Ollama beside the instance and
  pulls a 274 MB model; one who does not gets the write-up without history and loses nothing.
- **A named default** where this project has named none before. The exception is narrow (D-5), and
  the next request to name a model — a generative one, or a hosted one — is not covered by it.
- **The hosted path gets text a rider typed.** Masking reduces what is sent and does not guarantee
  that nothing personal gets through (#839's own words); the consent will have to say that plainly,
  in the pull request that sends it (D-9).
- **Nothing measured on the owner's box yet.** Every throughput figure is an Apple M4 Pro in
  Docker; #835 owes the ingest rate and one query's time on the real machine, CPU-only and on GPU if
  present.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #835 | Builds the index as D-4, scoped as D-3, with a tested `down`; the embedding client as D-5 to D-7 (`truncate: false`, prefixes, the address rule on the configured name **and** on every resolved address it connects to, fail closed, model on every row); the history step and its budget as D-8, with the three-part injection test and the relative age computed at retrieval; the summary source rows the device builds and syncs (D-2), and **no** copy of the screen's matchers or of #809's input builder under `apps/instance`; erasure as D-10; extends #799's gate to the server path and holds the pose summary out of the index |
| #836 | Keeps goals, notes **and documents** on the device first and syncs them (D-1); states limits in characters (a ride note of at most 900 characters is one passage); ships the D-11 wording once the owner approves it |
| #803's successor | The pull request that first sends history to the hosted model carries the ADR 0029 amendment, the policy and Play Data Safety changes together (D-9) |
| #777 | `ERASE_CANNOT_REACH`'s instance line covers the index once it ships (D-10) |
| #807 | The Compose file publishes no Ollama port and the tunnel routes to the instance alone (D-6) |

---

## What would make this ADR wrong

- **An index row that cannot be rebuilt from a synced source** — a document edited on the instance,
  a note that exists nowhere else. Then D-1 is false and ADR 0036 D-3(c) is broken with it.
- **A query that returns another athlete's passage.** D-3 has a test; a retrieval path around it
  (a cache, a shared table, a "global" search) is the thing to stop.
- **An embedding address that is not local**, whether a public name configured by hand or a
  fallback added "for when the box is off". The owner's reason for D-5's exception is that nothing
  leaves the machine; a remote embedding service removes the reason and the exception with it.
  So does **a connection to an address nobody checked**: a name accepted by its spelling and
  resolved again after the check (D-6).
- **Retrieved text reaching any step but the history step**, or a step's bound, address or order
  changing because of what a passage said.
- **The project's documentation naming a model under a non-OSI licence** — `embeddinggemma` first,
  because the upstream docs lead with it.
- **Nothing mechanical checks D-5's licence rule, D-9's timing or D-11.** They are review questions
  until #835 and #836 land, and a reviewer of either asks them.
