# Contributing to On Your Left

## Licensing of contributions

This project uses two licences, split along a deliberate boundary:

| What | Licence | Why |
|---|---|---|
| The application — instance server, web app, deployed product | `AGPL-3.0-or-later` | Nobody can run a closed hosted fork of this service |
| The reusable leaf packages — domain types, FIT/GPX/TCX codec, BLE sensor layer | `Apache-2.0` | Others can adopt them freely, and they carry an express patent grant |

Anything **not** explicitly marked Apache-2.0 is AGPL-3.0-or-later.

**The boundary is a path.** Everything under `packages/` is Apache-2.0 and everything under
`apps/` is AGPL-3.0-or-later, without exception — so the directory your change lands in
answers the licence question, and you do not have to ask. This is stricter than ADR 0001
requires, deliberately: a path cannot be silently mis-declared the way a manifest field can.
Each package still carries its own `LICENSE` **and** a matching manifest declaration; the path
rule backs those up rather than replacing them.

Run `bash scripts/check-repo-rules.sh` to check it locally. It needs no install.

Full reasoning: [`docs/adr/0001-licence.md`](docs/adr/0001-licence.md) and
[`docs/adr/0005-tech-stack.md`](docs/adr/0005-tech-stack.md).

## Sign your commits (DCO)

Every commit must be signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "feat: your change"
```

That appends a line like:

```
Signed-off-by: Your Name <your.email@example.com>
```

By signing off you certify the DCO — in short, that you wrote the contribution or
otherwise have the right to submit it under the project's licence, and that you
understand the contribution and the sign-off are public and permanent.

**There is no CLA.** You keep your copyright. Nobody — including the maintainers —
can take your contribution proprietary later, because relicensing this project would
require unanimous consent from every contributor. That is intentional; see ADR 0001.

## Source file headers

Every source file carries an SPDX identifier as its first line, matching the package
it lives in:

```
// SPDX-License-Identifier: AGPL-3.0-or-later
```

```
// SPDX-License-Identifier: Apache-2.0
```

This is linted in CI, so a missing or mismatched header fails the build rather than
being caught in review.

## Adding a dependency

Check the dependency's licence against the package it lands in **before** adding it:

- A **GPL** or **AGPL** dependency can only be used by the AGPL application, never by
  an Apache-2.0 leaf package.
- A **permissive** dependency (MIT, BSD, Apache-2.0, ISC) is fine anywhere.
- Anything **non-open-source** — including Garmin's FIT SDK — needs a decision recorded
  as an ADR first. See #58 for why this is not theoretical.

## Before opening a pull request

- Tests pass, and you have watched each new test fail before making it pass.
- The linter is clean on the files you changed.
- Your commits are signed off.
- The PR references the issue it resolves.
