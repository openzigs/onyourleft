# ADR 0086: The setup wizard recommends one AI model

- **Status**: **Proposed**, 2026-11-19, on the owner's ruling of 2026-11-19 on #2869. Accepted only
  on the owner's approval on its pull request. D-6 lists the questions for the owner
- **Date**: 2026-11-19
- **Deciders**: **the owner**, who ruled on 2026-11-19, verbatim: *"Yes, one recommended model
  (Recommended)"*, asked as *"May the wizard offer one recommended model as a one-press choice?"*
  after seeing the setup wizard's AI step ask a new owner to type `name:tag`. **The author** chose
  the model against the issue's four criteria (D-1) and decided what the ruling leaves open. Each
  such choice is marked *the author's choice*
- **Issue**: [#2869](https://github.com/openzigs/onyourleft/issues/2869), a follow-up to #2792
- **Number**: **0086**. On 2026-11-19 `main` says the next free number is 0081, but the open pull
  requests [#2873](https://github.com/openzigs/onyourleft/pull/2873) (0081),
  [#2864](https://github.com/openzigs/onyourleft/pull/2864) (0083),
  [#2863](https://github.com/openzigs/onyourleft/pull/2863) (0084) and
  [#2872](https://github.com/openzigs/onyourleft/pull/2872) (0085) each write one, and 0082 is
  ADR 0082
- **Supersedes, in part**, for the setup wizard's AI step only:
  [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)'s amendment of
  2026-11-14, point 8 (*"The repository names and recommends no model"*), and
  [ADR 0031](0031-model-licences-and-the-hosted-model-hole.md) D-4 condition 2 as its amendment of
  2026-09-29 keeps it for the generative model (*"D-4 stands for the generative model on every
  path"*). #2869 asked for a dated amendment to ADR 0046. This is a new ADR instead, because the
  ruling changes what the wizard **does**, and [ADR 0013](0013-adr-amendments.md) D-3 sends a
  changed decision to a new ADR, as ADR 0040 did for the embedding model on 2026-09-29. ADR 0046 and
  ADR 0031 each gain one dated `## Amendments` entry pointing here. Neither body is edited
- **Leaves standing**: ADR 0031 D-2 (anything non-OSI is refused wherever *we* choose it), D-3 and
  D-4 conditions 1, 3 and 4, and D-4 condition 2 everywhere but the wizard's AI step: the app's
  Operate panel names and recommends no model, and neither `compose.yaml` nor any template defaults
  to one. ADR 0040 D-5 (a model this project names must be admissible under D-2). ADR 0046 D-9 and
  every other point of its 2026-11-14 entry. ADR 0080 D-7 (the AI step is optional)

---

## Context

The setup wizard's AI step (#2792, PR #2865) lists the models the owner's own Ollama has, and
downloads the one whose name the owner types. ADR 0046's amendment of 2026-11-14, point 8, forbade
it to name one. In the end-to-end trial the owner saw a new owner asked to type `name:tag` with
nothing to go on, and ruled that the wizard may offer one recommended model as a one-press choice.

## Decision

### D-1 — The model: `qwen3:8b`

*The author's choice*, against #2869's four criteria. Each fact was read on 2026-11-19 from the
model's own pages:

| Criterion | `qwen3:8b` | Where it was read |
|---|---|---|
| An OSI-approved weights licence (ADR 0031 D-2) | **Apache-2.0** | The model card's metadata, `huggingface.co/Qwen/Qwen3-8B` (*"License: apache-2.0"*), and the licence file in Ollama's own package (*"Apache License Version 2.0, January 2004"*) |
| Tool calling, which the write-up agent needs | **Yes** | The card's "Agentic Use" section (*"Qwen3 excels in tool calling capabilities"*). Ollama's library page carries the `tools` badge |
| Fits an 8 GB graphics card with room for its context | **5.2 GB** to download, `Q4_K_M`, 8.19 B parameters | `ollama.com/library/qwen3:8b` (digest `500a1f067a9f`). That leaves about 2.8 GB of an 8 GB card for the context and Ollama's own use |
| In Ollama's library | **Yes**, `qwen3:8b` | `ollama.com/library/qwen3` |

**The owner's own model does not qualify.** The owner's instance runs `gemma4:12b` well (ADR 0076,
ADR 0078) on a 12 GB card (spike 0039). Its weights are Apache-2.0 since Gemma 4, but its download
is 7.7 to 8.0 GB, which leaves no room for a context on an 8 GB card. The same family's `gemma4:e4b`
(Apache-2.0, tools) is 6.6 GB for the language model alone and 9.5 GB as Ollama's default package,
which carries a picture projector and a draft model. That is too close to 8 GB to promise room for a
context. `qwen3:8b` is the largest model read that day that meets all four criteria with room to
spare.

**Not measured here**: how well `qwen3:8b` writes this project's write-ups. D-6 asks the owner.

### D-2 — Where it is named: the wizard's AI step, and nowhere else

The name, its size and the reason are constants in `@onyourleft/operate-text` §setup
(`AI_RECOMMENDED_MODEL`), drawn only by the instance's setup page (`apps/instance/src/setup/pages.ts`
§`aiBody`). The app's Operate panel keeps its test that its source names no model. `compose.yaml`
and the templates keep `OYL_INSTANCE_ANALYSIS_MODEL` empty.

### D-3 — One press, above the typed field. Typing stays, and the step stays optional

When the owner's Ollama is found and write-ups are off, the download card shows **"Download the
recommended model (qwen3:8b, about 5 GB)"** above the field where a name is typed. The press asks
the same `POST /setup/ai/pull` the typed field does, with the name filled in, so the download is
logged and shown exactly as a typed one is. Nothing is downloaded without the press, and nothing is
chosen when the download ends: the owner still presses *Use qwen3:8b* (#2792's rule). *Next step*
is there whatever the owner does.

### D-4 — A model already on the machine that fits is offered first, and no download

When write-ups are off and the owner's Ollama already has a model that fits, the step says so first
and puts that model at the top of the list with its *Use* button. It does not offer the recommended
download. *The author's choice* of what "fits" means here, read only from what Ollama reports and
never guessed from a file's size (#2792's rule):

1. a model Ollama lists with tools **and** reports loaded wholly in the graphics card's memory; or,
   failing that,
2. the recommended model itself, already downloaded and listed with tools.

### D-5 — Reversing it

Deleting the constants and the offer restores #2792's step. No setting, column or stored value
depends on them.

### D-6 — Questions for the owner, with the author's recommendation

1. **Is `qwen3:8b` the model?** Recommended: yes, for the reasons in D-1. If the owner would rather
   keep the Gemma family that already works on their own instance, the alternative is `gemma4:e4b`,
   which fits an 8 GB card only with little room for its context.
2. **Should the owner try one write-up on `qwen3:8b` before this merges?** Recommended: yes, on the
   owner's PC. No test here can say whether its write-ups read well.
3. **Is D-4's meaning of "fits" right?** Recommended: yes. A model that is installed but has not
   been loaded has no reported fit, so only the recommended model is offered on trust.

## Consequences

- A new owner can turn AI write-ups on with two presses: *Download the recommended model*, then
  *Use qwen3:8b*.
- The repository now names one generative model, in one place. A later model that is better on the
  same four criteria replaces it by a change to the constants and to this ADR's D-1, read again on
  that day.
- The recommendation can go stale: Ollama's package for `qwen3:8b` may change size or move. The
  download then fails in the step's own words (#2792), and the typed field still works.

## What would make this ADR wrong

- `qwen3:8b`'s licence changes, or Ollama's package of it stops listing tools.
- The write-up agent needs more context than about 2.8 GB of an 8 GB card holds.
