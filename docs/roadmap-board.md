# The roadmap board

**[On Your Left roadmap](https://github.com/orgs/openzigs/projects/1)** is an organisation project
(number 1), public and linked to this repository. It shows where the epics and issues stand without
anyone having to read an issue. **[#1201](https://github.com/openzigs/onyourleft/issues/1201) stays
the written plan; the board mirrors it.** Where the two disagree, #1201 and the issue's own labels
are right and the board is stale until the next run.

The board is kept up to date by [`scripts/sync-roadmap.py`](../scripts/sync-roadmap.py), run nightly
at 04:41 UTC by [`.github/workflows/roadmap.yml`](../.github/workflows/roadmap.yml)
([#1348](https://github.com/openzigs/onyourleft/issues/1348)). To run it yourself:

```bash
GH_TOKEN=... python3 -I scripts/sync-roadmap.py --org openzigs --project 1 --dry-run
```

`--dry-run` reads everything and prints each change it would make, then a summary line; without it
the changes are made. `--status-update` also posts the weekly status update (below). Its tests:
`python3 -I scripts/sync-roadmap.test.py`, which the required check runs.

## What it reads, adds and leaves alone

- **Reads** every issue in `openzigs/onyourleft` that is open, closed in the last 30 days, or a
  closed epic, with its labels, parent and sub-issue summary. Pull requests are never added.
- **Adds** every open issue and every epic (open or closed) that is not on the board. It never
  deletes and never archives, and it leaves an archived item and an item outside what it read
  exactly as they are.
- **Never touches Status.** GitHub's built-in workflows own it (item closed or pull request merged
  → Done).
- Runs twice, changes nothing the second time: values are written only where they differ, and
  adding an issue that is already on the board returns the item that is there (measured
  2026-10-14).
- At most 399 writes a run, about one a second. The first fill needs more than that (about 960
  planned changes in the dry run of 2026-10-14) and carries on over the next nights.

## The fields

| Field | Type | Filled from |
|---|---|---|
| **Tier** | single select | the issue's own `priority:` label, else the nearest ancestor's (parent, its parent, …), else **Unranked**. `priority: now` → Now, `priority: next` → Next, `priority: later` → Later, `priority: high` → Device check (#733). Several on one issue: the first in that order |
| **Kind** | single select | `epic` label → Epic; title starting "Spike" → Spike; `bug` label → Bug; else Issue, in that order |
| **Area** | single select | the `area:` label's name (`area: racing` → racing). The script creates the field, and adds an option when a new `area:` label appears, sending the existing options back with their ids so no item loses its value. No label: cleared |
| **Progress %** | number | the issue's sub-issues, `percentCompleted`; cleared for an issue with none |
| **Sub-issues done** | text | the same, as "10 of 23"; cleared for an issue with none |
| Status, Parent issue, Sub-issues progress | built in | GitHub, not the script |

## The weekly status update

With `--status-update` (the workflow always passes it), the script posts a project status update
unless one was posted in the last 6 days, so in practice once a week. It lists what closed in the
last 7 days and what is `priority: now`, written from the issues alone. Its status is the latest
update's, so an owner who set At risk keeps it; with no earlier update it is On track.
It also lists the open issues with no `area:` label and the Unranked ones, when there are any,
and every run prints how many there are; [`docs/agents/filing-issues.md`](agents/filing-issues.md)
says what an issue should carry.

## The views, set in the web UI

Views are made by hand (or through REST), not by the script:

- **Board**: board layout, grouped by Status.
- **Epics**: table filtered `label:epic`, showing Progress % and Sub-issues progress, sorted by Tier.
- **By tier**: table grouped by Tier, or by Area.
- **Roadmap**: roadmap layout grouped by Parent issue, with the hierarchy shown.
- **Now**: table filtered to Tier Now.
- **Device checks** and **Recently done**, added by the owner on 2026-10-14.

## The App behind the token, set up once

`GITHUB_TOKEN` cannot write an organisation's project, so the workflow mints a token from a GitHub
App with `actions/create-github-app-token`. The App, `openzigs-roadmap-sync`, was made on
2026-10-14:

- owned by `openzigs`; permissions **Organization → Projects: read and write**, **Repository →
  Issues: read** and **Metadata: read**; no webhook; installed on `onyourleft` only;
- its client id is the variable `ROADMAP_APP_CLIENT_ID` and its private key the secret
  `ROADMAP_APP_PRIVATE_KEY`, both in the Environment **`roadmap`**, whose deployments are limited
  to `main`.

The board must stay **public**: an App's token cannot see the items of a private project. And the
App's project write applies to every project in the organisation, which is why its workflow runs
only on a schedule or by hand, never on a pull request. While `ROADMAP_APP_CLIENT_ID` is unset the
workflow skips, green, with a notice.
