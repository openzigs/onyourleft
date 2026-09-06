# ADR 0014: Portable identity — an Ed25519 device keypair and signed, content-addressed activity records

- **Status**: Accepted
- **Date**: 2026-09-06
- **Deciders**: No owner decision was sought or given for this ADR, and none is claimed. Every
  decision below is the author's engineering work, constrained by four that are already merged:
  **owner decision D6** (no server, no account and no network in Phase 1),
  [ADR 0002](0002-local-first-architecture.md) (the athlete's device is the canonical holder of
  their data), [ADR 0004](0004-privacy-and-location.md) (activity privacy and the location-data
  model), and [ADR 0005](0005-tech-stack.md) §D (`packages/domain` depends on no platform API at
  all)
- **Issue**: [#61](https://github.com/openzigs/onyourleft/issues/61)
- **Number**: **0014**. `0012` is reserved for [#64](https://github.com/openzigs/onyourleft/issues/64)
  and `0013` is the [ADR amendment convention](0013-adr-amendments.md); the ownership table in
  [`docs/architecture.md`](../architecture.md) is the register, and rule `ADR001` fails the build on
  a duplicate
- **Supersedes**: nothing
- **Constrains**: [#56](https://github.com/openzigs/onyourleft/issues/56) (federation, which is
  where the record format stops being provisional), [#7](https://github.com/openzigs/onyourleft/issues/7)
  (an instance verifies these records from Node and must agree byte for byte),
  [#35](https://github.com/openzigs/onyourleft/issues/35) (export carries records and never key
  material), [#37](https://github.com/openzigs/onyourleft/issues/37) (import verifies),
  [#51](https://github.com/openzigs/onyourleft/issues/51) (the client composes the keystore),
  [#33](https://github.com/openzigs/onyourleft/issues/33)–[#35](https://github.com/openzigs/onyourleft/issues/35)
  (accounts, which arrive later and do not replace this)
- **Relates to**: [ADR 0001](0001-licence.md) (a dependency under `packages/` is a licence question,
  which is half of why there is no third-party cryptography here),
  [ADR 0003](0003-platform-support-matrix.md) (the browser floor this rests on),
  [ADR 0011](0011-stream-storage.md) (the stream set is derived and lossy **because** the signed
  file is canonical — this ADR is what makes that sentence executable)

---

## Context

[ADR 0002](0002-local-first-architecture.md) makes the athlete's device the canonical holder of
their data. #61 observes that the claim is only meaningful if a file taken off the device can be
**verified by somebody else** — otherwise "you own your data" means "you own a copy we could
contradict".

Nothing in the program does that today. An activity in `packages/store` is a row an athlete's own
device wrote and only that device has ever attested to. There is no artefact a second party could
check, so there is nothing to sync in Phase 4 ([#7](https://github.com/openzigs/onyourleft/issues/7))
that carries its own authenticity, and nothing to federate in
[#56](https://github.com/openzigs/onyourleft/issues/56).

The work is done **now**, in the v0.1 local milestone, while there are no activities yet.
Retrofitting signatures onto a corpus of unsigned rides is a migration with an unanswerable
question in the middle of it — what does the device attest to about a ride it did not sign at the
time? Adding two functions before the first ride exists has no such question.

Two constraints shape everything below and are worth stating before the decisions:

1. **`packages/domain` may not name a platform API**, and CLAUDE.md §2 nonetheless puts signing and
   verification there, "because those must run identically on the device and on an instance". There
   is no `crypto` in that package: `lib` is narrowed to `ES2024` with `types: []`, so `crypto`,
   `SubtleCrypto` and `CryptoKey` are undeclared and `crypto.subtle` is `TS2304: Cannot find name
   'crypto'`.
2. **A dependency under `packages/` is a licence question first** ([ADR 0001](0001-licence.md),
   CLAUDE.md §3). Adding a cryptography library is not a convenience decision.

### What was deliberately not adopted

**W3C DID Core.** v1.0 is a Recommendation (2022-07-19), but v1.1 is a Candidate Recommendation
Snapshot dated 2026-03-05, DID Resolution v1 is a CR Draft (2026-08-28), and `did:key` itself is a
W3C CCG draft at v0.9. None of that is a stable base for a **file format**, which is the thing that
becomes permanent the moment an athlete has rides. A raw keypair plus a signed, content-addressed
record gets most of the benefit with none of the spec churn, and Nostr (NIP-01, status `draft
mandatory`) demonstrates the pattern at scale with nothing but a keypair.

**Accounts, passwords and sessions.** Those are
[#33](https://github.com/openzigs/onyourleft/issues/33)–[#35](https://github.com/openzigs/onyourleft/issues/35),
in a later phase. An identity here is a keypair on a device, not a login.

---

## Decision

### D-1 — The signature scheme is **Ed25519** (RFC 8032), not secp256k1 Schnorr

#61 left this open and asked for it to be decided here.

Ed25519 wins on the grounds that matter to this project:

| | Ed25519 | secp256k1 Schnorr (BIP-340) |
|---|---|---|
| In `crypto.subtle` | **yes**, in all three engines | no, in none |
| Third-party dependency needed | **none** | one, under `packages/` |
| Signing is deterministic | yes (RFC 8032 §5.1.6) | yes (BIP-340), but implementations vary |
| Key / signature size | 32 / 64 bytes | 32 / 64 bytes |
| Ecosystem argument | none | Nostr relays, if [#56](https://github.com/openzigs/onyourleft/issues/56) goes that way |

The decisive column is the second. secp256k1 is not in any browser's WebCrypto, so choosing it means
adding a cryptography library to `packages/domain` — which is a licence question under
[ADR 0001](0001-licence.md), a supply-chain question under CLAUDE.md §8, and a permanent one either
way, because the signature format cannot be changed once records exist. Ed25519 needs no library at
all.

The cost is stated so a superseding ADR has something to argue with: **if #56 chooses Nostr relays
as the federation transport, these records are not natively verifiable by that ecosystem.** That is
a real loss and it is accepted, because #56 has not chosen a transport, because a bridge that
re-signs is possible if it ever does, and because trading a definite dependency today for a
hypothetical ecosystem tomorrow is the wrong way round.

Ed25519 is also the misuse-resistant choice on its own merits: it is deterministic, so there is no
per-signature nonce to get wrong, which is the failure mode that has broken ECDSA deployments
repeatedly.

### D-2 — The primitive is the platform's, and there is **no cryptography dependency**

`crypto.subtle` implements Ed25519 natively. **Read on 2026-09-06**, from the Web Cryptography API's
"Secure Curves" tracking and the engines' own release notes:

| Engine | Ed25519 in `crypto.subtle` | Since |
|---|---|---|
| WebKit (Safari) | yes | Safari 17.0 |
| Gecko (Firefox) | yes | Firefox 129, August 2024 |
| Blink (Chrome, Edge) | yes | Chrome 137, May 2025 |
| Node | yes | verified on Node 24.20.0 while writing this ADR |

Every one of those is above [ADR 0003](0003-platform-support-matrix.md)'s floor, and the floor is
already Chrome-shaped because Web Bluetooth exists nowhere else.

So: **the version of the signature library is "the platform's", and that is the whole dependency
list.** There is nothing to pin, nothing to audit, and nothing to clear against the licence
boundary. `packages/store/src/web-crypto.ts` is the only file in the program that calls it.

### D-3 — The private key is a **non-extractable `CryptoKey`**, stored in IndexedDB

`generateKey` is called with `extractable: false`. The resulting handle can sign and
`crypto.subtle.exportKey` on it **rejects**. It survives the structured clone algorithm, so it goes
into IndexedDB as a handle and comes back as one.

This is what makes #61's "the private key never leaves the device" a property of the platform rather
than a promise about our own code: there is no sequence of calls — in this package, above it, or in
a devtools console — that turns the stored value back into bytes. An export that walked every field
of every row would carry an object with no enumerable properties.

The consequence is D-7's, and it is the price: a key that cannot be exported cannot be **backed up**
or **moved to a second device**.

### D-4 — What is signed is **RFC 8785 canonical JSON of the payload, UTF-8 encoded**

The record is a JSON object with seven members. Six are the payload; the seventh, `signature`, is an
Ed25519 signature over the RFC 8785 (JSON Canonicalization Scheme) serialisation of the other six,
UTF-8 encoded.

A published scheme rather than "whatever `JSON.stringify` produced that day", because #61's fourth
acceptance criterion is that a verifier written **from the spec** — not against our code — verifies
our records, and that is only possible if "the bytes that were signed" is a statement somebody else
can implement. `JSON.stringify` is not one: it preserves insertion order, so two builds constructing
the same record in a different order sign different bytes and neither is wrong. RFC 8785 pins member
order (UTF-16 code units), number formatting (the ECMAScript `Number::toString` algorithm) and
string escaping (JSON's minimal set), and has off-the-shelf implementations in Java, Python, Go,
Rust, .NET and C.

Three deliberate **narrowings** on top of it, each of which keeps every document we emit a valid JCS
document:

- **`null` is rejected.** A record format needs one spelling of "no value"; absent is it. An
  optional member is simply not emitted.
- **Non-finite numbers are rejected.**
- **Unpaired surrogates are rejected** (RFC 8785 §3.2.3 requires this). `TextEncoder` would
  substitute U+FFFD, which maps two different strings onto the same bytes — and a canonicalisation
  that is not injective is not canonical.

### D-5 — The record **references** the activity file by content hash and carries **no location**

`contentHash` is `sha256:` followed by the lowercase hex SHA-256 of the activity file's bytes. The
ride's shape lives in that file; the record says "the file with these bytes is mine, and here is
what it is a summary of".

The claims are a small, fixed set — activity id, name, start instant and IANA zone, elapsed and
moving time, distance, `hasPosition`, and average power if there is one — and **no coordinate member
exists or may be added**. That is [ADR 0004](0004-privacy-and-location.md)'s "Constraints this
places on other work" item 1 applied to a document that is *designed to be published*: a record
carrying a start position would make publishing one the thing that leaks a home address
([#21](https://github.com/openzigs/onyourleft/issues/21)).

It is enforced three ways rather than stated once: the claims type has no such member so a literal
fails to compile; the parser **rejects any member it does not know**, at both levels, so a record
arriving from another device cannot smuggle one in; and a test serialises a record and greps it.

Rejecting unknown members has a second effect worth naming: it is also what keeps the format
honest. Trimming an unknown member would mean the bytes re-canonicalised for the check are not the
bytes that were signed, so a record with an extra member would fail as a *forgery* rather than as
what it is.

### D-6 — A failed verification is **five answers**, not a boolean

| Status | What happened |
|---|---|
| `verified` | the signature and the file both check out |
| `content-mismatch` | the record is authentic; the **file** is not the one it vouches for |
| `signature-mismatch` | the payload was altered after signing, or that key did not sign it |
| `unsupported` | a version or scheme this build does not know — **not** a forgery |
| `malformed` | not a record of this format at all |

The distinction #61 asks for is the middle three. In particular, changing one byte of the activity
file produces `content-mismatch` and **not** `signature-mismatch`: the signature is still perfectly
valid, because the signer signed a hash of the bytes as they were, and reporting "bad signature"
there would send a reader looking for a forger who does not exist.

`verifyActivityRecord` requires the file's digest. Checking the signature **without** it is a
separate, differently named function rather than an optional parameter, because an optional
`fileDigest` that silently skips half the check is the shape that lets a caller believe a record was
fully verified when it was not.

### D-7 — The identity is **write-once per athlete**, and key loss is terminal for signing

`putDeviceKey` refuses to replace an existing key with a different one. #61's first acceptance
criterion names the failure it prevents: an athlete's whole history silently splitting across two
identities. Two browser tabs opening for the first time at the same moment both see no key and both
create one; the second write is refused and the loser **adopts the winner**, because the other two
outcomes are "one tab cannot sign" and "the athlete now has two identities".

**There is no key rotation in Phase 1**, and the consequences of that and of key loss are stated
in full under Consequences below, because #61 asks for them to be documented behaviours with a
stated consequence rather than silent ones.

### D-8 — The algorithm is in `packages/domain`; the key material and the primitive are injected

The seam is `packages/domain/src/identity/seam.ts`. That package owns **what is signed** (the
canonicalisation), **the record format**, **the verification logic** and **the identity lifecycle**;
the caller injects a `SigningKey`, a `SignatureVerifier` and a `Sha256`.

This is the same shape [#45](https://github.com/openzigs/onyourleft/issues/45) met, where the
recording engine may not read a clock and time therefore arrives as a parameter. The message handed
across the seam is **bytes**, not an object: the canonicalisation happens once, on the domain side,
so a browser implementation and a Node implementation cannot serialise differently — which they must
not, because #7 verifies from Node what `apps/web` signed in a browser.

### D-9 — The record format is **version 1 and provisional until #56**

The `version` member is in the first record rather than added when it is first needed. A verifier
that meets a version it does not know must **refuse** it (`unsupported`) rather than guess at the
member set, because guessing is how a member outside the signature gets treated as though it were
inside.

"Provisional" means: while there are no records in the world, a change to this format is an **edit**.
Once #56 breaks down and records exist beyond one device, a change is a **migration**. The format is
finalised at that point and not before.

---

## Consequences

### What this buys

- A ride file taken off the device can be verified by anyone, with no server, no account and no
  cooperation from us. That is [ADR 0002](0002-local-first-architecture.md)'s central claim made
  checkable.
- [ADR 0011](0011-stream-storage.md)'s reasoning — a derived stream set may be lossy because the
  signed file is canonical — has an artefact behind it for the first time.
- The rollback path ADR 0005 §F names (export → downgrade → re-import) is now executable and is
  executed, in `packages/store/src/identity-rollback.test.ts`.

### Key loss — the stated consequence

**If the key is gone, it is gone.** It cannot be exported (D-3), so it cannot be backed up, and
IndexedDB is deletable by the athlete, by the browser under storage pressure, and by "clear browsing
data".

What survives and what does not:

| | After key loss |
|---|---|
| Records already signed | **Still verify, forever.** They carry their own public key |
| The activity files themselves | Untouched; they are not encrypted |
| Signing a **new** record as the same identity | **Impossible** |
| Continuing to ride, record and export | Unaffected |

The recovery is to **create a new identity**. The athlete's history then has two eras, both valid
and provably by different keys — which is honest, and is the same thing that happens if they move to
a new device. Nothing is silently re-signed: re-signing an old ride with a new key would be the
device asserting something it did not witness.

Mitigations deliberately **not** taken in Phase 1, so a later ADR knows they were considered: an
extractable key with a passphrase-wrapped backup (weakens D-3 for everyone to serve a recovery case
we cannot yet test end to end); a recovery phrase (needs a key derivation and a UI, and is
[#33](https://github.com/openzigs/onyourleft/issues/33)-shaped); and a second device sharing a key
(needs a transport, which Phase 1 does not have).

### Key rotation — the stated consequence

**There is no rotation in Phase 1, deliberately.** `putDeviceKey` refuses to replace a key, so
rotating is not a thing an athlete can do by accident. If one is added later it must be **additive**:
a new key, a record of the transition signed by the *old* key, and old records left alone. What must
never happen is silent replacement — every record signed by the old key would become unverifiable
against the athlete's current identity, which is the history-splitting failure D-7 exists to
prevent, arriving with our blessing instead of by accident.

### What this constrains elsewhere

- **[#7](https://github.com/openzigs/onyourleft/issues/7) must satisfy the same seam from Node**, and
  must produce byte-identical signing input. The canonicalisation is in `packages/domain` precisely
  so that it cannot diverge.
- **[#35](https://github.com/openzigs/onyourleft/issues/35)'s export** carries records and must never
  carry key material. D-3 makes that structurally true rather than a rule to remember.
- **[#37](https://github.com/openzigs/onyourleft/issues/37)'s import** must verify, and must treat
  `unsupported` differently from `signature-mismatch` in whatever it shows the athlete.
- **[#51](https://github.com/openzigs/onyourleft/issues/51)** composes the keystore at startup. It
  must call `ensureSigningKey` and not reimplement the load-then-create rule — that rule is in
  `packages/domain` for the reason it is four lines: a four-line rule copied into two adapters holds
  in one of them.
- **A second signature scheme is a format version bump**, not a widening of the algorithm member.

### What is not done here, and is not hidden

- **No key is stored outside IndexedDB.** There is no OS keychain path in a browser, and
  [#85](https://github.com/openzigs/onyourleft/issues/85)'s Capacitor shell would be where a native
  keystore is considered.
- **Records are written by tests and by #51, not yet by the recorder.** The recorder finishing a ride
  and signing its FIT file is #45's and #29's join, and it is not in this change.
- **Nothing publishes a record.** There is no transport in Phase 1 (owner decision D6). The format
  is portable; nothing carries it anywhere yet.
