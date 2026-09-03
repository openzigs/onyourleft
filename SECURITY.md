# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Use GitHub's [private vulnerability reporting](https://github.com/openzigs/onyourleft/security/advisories/new)
— it is enabled on this repository. That creates a private advisory visible only to maintainers,
where a fix can be prepared and a CVE requested before anything is disclosed.

If you cannot use that form, open a regular issue saying only that you have a security report and
asking for a private channel. **Do not include details in it.**

### What to expect

This is a volunteer open-source project with no paid staff and no SLA. Realistically:

- We will acknowledge a report when we see it, not within a guaranteed window.
- We will tell you whether we think it is a real issue and roughly when we expect a fix.
- We will credit you in the advisory unless you ask us not to.

If a report is urgent and we are not responding, say so in a public issue **without details** —
that is a legitimate way to get attention and it does not disclose the problem.

## Supported versions

The project is in **planning** and has no releases yet. When releases exist, this section will state
which are supported. Until then, `main` is the only supported code.

## What is in scope

This project handles data that is genuinely sensitive, so the following are all real reports:

- **Location data from activity files.** GPS traces reveal where people live and ride. Anything that
  exposes a private activity, defeats a privacy zone, or leaks location through an API response,
  an export, a cache or an error message is in scope. See
  [ADR 0004](docs/adr/) and issue [#21](https://github.com/openzigs/onyourleft/issues/21).
- **Health data.** Heart rate and power are health data under both Google Play and App Store policy.
- **Cross-athlete data exposure.** Any path where one athlete can read another's activity, stream or
  personal data — including a query that matches on an entity id without also filtering on the
  owning athlete.
- **Bluetooth handling.** Malformed or hostile GATT payloads from a device that is not what it
  claims to be. Sensor data is untrusted input.
- **Activity file parsing.** FIT, GPX and TCX are parsed from files users supply. Malformed input
  should produce an error, never memory corruption, a crash loop, resource exhaustion or code
  execution. XML external entity handling in GPX and TCX is specifically in scope.
- **Trainer control.** A smart trainer applies physical resistance to a person who is pedalling.
  Anything that lets an attacker set resistance or an ERG target is a safety issue, not only a
  security one, and will be treated as high severity.
- **Self-hosted instances.** Authentication, authorisation, and instance-to-instance federation.

## What is out of scope

- Reports from automated scanners with no demonstrated impact on this codebase.
- Vulnerabilities in third-party dependencies with no exploitable path here — report those upstream,
  though we do want to know if we are exposing one.
- Social engineering, physical attacks, or anything requiring a compromised device the user already
  controls.
- Missing hardening headers with no demonstrated exploit.

## Our own security tooling

This repository has, all free for public repositories:

- **CodeQL code scanning** (default setup) — static analysis on push and pull request.
- **Secret scanning with push protection** — a commit containing a recognised credential is blocked
  at push time.
- **Dependabot alerts and security updates** — automatic pull requests for vulnerable dependencies.
- **Private vulnerability reporting** — the form linked above.

Dependency licences are also gated per package: see
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [ADR 0001](docs/adr/0001-licence.md). That is a licence
control rather than a security one, but it is enforced in the same place.

## A note on scope, honestly

There is **no application code in this repository yet**. This policy exists so it is in place before
the first line lands, not because there is currently an attack surface. The scope list above
describes the system being built, and it is deliberately specific so that a future reader can tell
what we consider a real report rather than guessing.
