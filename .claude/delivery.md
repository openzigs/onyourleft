# Delivery pipeline constraints

Read by every agent that `/delivery:orchestrate` and `/delivery:plan-epic` dispatch. It adds to
[`CLAUDE.md`](../CLAUDE.md) and the files its map names; it repeats none of them, and where the two
disagree `CLAUDE.md` wins. It is not loaded into ordinary sessions, which is why these rules are
here and not there.

## Owner-only criteria

Some acceptance criteria can only be met by the owner. They are **gates on the merge, not defects in
the code**:

- "Owner screenshots before merge", or the owner's approval of draft wording.
- A check on the owner's tablet, phone, trainer or PC: a moving-ride frame check, a device session.
- The owner's acceptance of an ADR, an amendment, a new asset source or a budget change.
- Anything an issue words as "the owner confirms", "owner ruling" or "owner's call".

**Implementer.** Do everything up to the gate, so that the owner only has to look:

- Take the screenshots yourself, in the product's own renderer, at the sizes the issue names (the
  tablet is 1280×800), and say in the PR body where each file is. The CLI cannot attach images.
- Write draft wording in full and list every new sentence in the PR body.
- Write the ADR or amendment as Proposed, with the questions for the owner numbered and a
  recommendation for each.
- List what is still owed under a heading **"Waiting on the owner"** in the PR body. Do not claim an
  owner-only criterion as met, and do not leave it out.

**Reviewer.** An owner-only criterion that is still open is **never a blocking finding**. Report it
under "Waiting on the owner", outside the findings list, and recommend on the code alone. A review
whose only objection is an owner-only criterion says "merge with follow-ups — 0 blocking findings;
waiting on the owner for …". It is blocking only when the implementer could have done their half and
did not: no screenshots taken, wording not listed, the questions not written down.

**Nobody dispatched by a workflow merges.** The session that ran the workflow asks the owner.

## The machine and the checkout

- **Node 26.** `.nvmrc` says 26 and `engines` refuses anything else. If `node --version` is not 26,
  put a Node 26 on `PATH` first (with nvm: `~/.nvm/versions/node/v26.*/bin`). Do not work round the
  engines check.
- **Work in your own git worktree**, created from `origin/main` or the branch the lane comment
  names. The main checkout is shared by every lane and may be on another branch: never switch it,
  stash in it or commit in it. Create the worktree with `git worktree add … || exit 1`, so that a
  failed add cannot leave the next command running in the main checkout.
- **Name scratch files for your issue** (`pr-body-2794.md`, never `pr-body.md`). Lanes share a
  scratch directory, and a shared name has overwritten another lane's PR body before.
- **Pass the number to `gh pr edit`.** Without one it edits whichever PR the current branch has.
- **Fetch a PR head with a force refspec** (`+refs/pull/N/head:refs/remotes/pr/N`). Worktrees share
  refs, and a stale one has shipped an old build.

## Before you say a PR is ready

- **No per-case test timeout, in any form** (#1688). Grep your own added lines for `timeout`,
  `testTimeout`, `hookTimeout`, `test.slow` and a trailing numeric argument to `it`/`test`
  (`}, 120_000);`) before you push. A file that already has old ones does not license a new one:
  share a `beforeAll` load or test the pure function instead. A child process's own kill bound
  (`spawnSync(…, { timeout })`) and a WebAuthn `timeout` option are not test timeouts.
- **A failed job with every test file passing** is usually an unhandled rejection after teardown or
  a runner limit. Read the log's end before you call it a flake; re-run a known flake once, and name
  its issue in your report.
- **The mutation list** (`CLAUDE.md` §5) goes in the PR body: each mutation and what went red. A
  mutation that stayed green is reported as such, with what you did about it.
- **Check the closing reference after opening**: `gh pr view N --json closingIssuesReferences`. A
  closing verb beside a number in prose links that issue too.

## Stacked pull requests

- A PR whose base is not `main` **cannot link a closing keyword**. Say so in the body, and say that
  the reference must be checked again once the PR is retargeted to `main`.
- State the base branch and what it carries in the first lines of the body, so a reviewer reads the
  right diff.
- Do not rewrite another lane's branch. If your base moved, merge it into yours.

## ADR numbers

Most merge conflicts between lanes are the ADR records, not code.

- Before taking a number, read `docs/agents/adr-numbering.md` on `main` **and** every open PR
  (`gh pr list --search "ADR in:title"`): a number claimed by an open PR is taken.
- A new ADR touches three records: `docs/agents/adr-numbering.md`, `docs/agents/conventions.md` and
  `docs/architecture.md`. Change the fewest lines you can in each, and keep one "next free number"
  statement per file.
- When merging `main` into your branch, keep both sides' entries. Never edit an accepted ADR's body:
  a dated entry under `## Amendments` is the only change it takes.

## Reporting

- **Report once, at the end.** Do not hand back while CI is running to say that it is running. If
  you must stop before CI finishes, say exactly which checks are pending and that nobody is watching
  them.
- Lead with the state: the PR number, whether CI is green, what is not done. Quote a command as run
  only if you ran it, with what it printed.
- If the permission system refused an action, say what you were trying to do and stop. Do not ask
  another agent to do it for you.
