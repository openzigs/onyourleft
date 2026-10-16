# Filing an issue

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file says what every new issue must carry so that the roadmap board places it. **Read it before you
open an issue, file a follow-up from a pull request, or split an issue in two.**

Same authority as the root.

---

## Why it matters

The roadmap board (<https://github.com/orgs/openzigs/projects/1>) is filled by
`scripts/sync-roadmap.py` every night at 04:41 UTC ([`docs/roadmap-board.md`](../roadmap-board.md)).
It adds **every open issue** by itself, but it can only place an issue by what the issue carries:

| Board field | Comes from | Missing means |
|---|---|---|
| **Area** | the issue's `area:` label | a blank Area; the issue is in no epic's slice of the board |
| **Tier** | the issue's own `priority:` label, else its epic's (through the sub-issue link) | **Unranked** |
| **Kind** | `epic` or `bug` label, or a title starting "Spike" | Issue |
| **Progress %** of the epic | the issue being a **sub-issue** of its epic | the epic's progress leaves it out |

The weekly status update on the board lists every open issue with no `area:` label and every
Unranked one, and each run's log prints how many there are. **The aim is that both lists are empty.**

## What every issue carries

1. **Exactly one `area:` label**: the epic or feature it belongs to. `gh label list --search area:`
   lists them, each with the epic it maps to. Use the same area as the epic it sits under. A new
   area is a new label, created only when there is a new epic for it.
2. **A kind**: `feature` or `bug`, or `epic` for an epic. Add `security`, `frontend`, `backend`,
   `docs`, `infra`, `testing` or `decision` beside it as they apply.
3. **A tier**:
   - An **epic** carries its own `priority: now`, `priority: next` or `priority: later`. These are
     the owner's ranking. Do not change an epic's tier without the owner's word: the sync puts the
     label back on the board each night, so a Tier changed on the board itself does not last.
   - Any **other issue** takes its epic's tier through the sub-issue link and needs no `priority:`
     label of its own, unless it should sit in a different tier from its epic, e.g. a follow-up
     the owner asked for next inside a later epic.
   - `priority: high` is only for the owner's device-check list (#733).
4. **A parent**: link it as a **sub-issue of its epic**. An issue that belongs to no epic still
   needs an `area:` label and its own `priority:` label.
5. **A body that names where it came from**: the issue or pull request that produced it, and any
   owner ruling it rests on, dated.

## The commands

```bash
# Open it with its labels in one step.
gh issue create --title "…" --body-file body.md \
  --label "feature,area: racing" [--label "priority: next"]

# Make it a sub-issue of its epic (#16 here). The REST call takes the child's id, not its number.
child=$(gh api repos/openzigs/onyourleft/issues/<N> --jq .id)
gh api -X POST repos/openzigs/onyourleft/issues/16/sub_issues -F sub_issue_id="$child"

# Check what it carries.
gh api graphql -F n=<N> -f query='query($n:Int!){repository(owner:"openzigs",name:"onyourleft"){
  issue(number:$n){labels(first:20){nodes{name}} parent{number}}}}' --jq .data.repository.issue
```

It shows on the board after the next nightly run. To see it sooner, run the **Roadmap board sync**
workflow by hand from the Actions tab.

## Changing an issue later

- Moving an issue to another epic: change its parent **and** its `area:` label together.
- Closing an issue as no longer relevant: close it with a comment that says why; it leaves the
  open views by itself.
- The issue templates under `.github/ISSUE_TEMPLATE/` give a new issue its kind label. The area,
  tier and parent are added by whoever files it, or by the owner when triaging an outside report.
