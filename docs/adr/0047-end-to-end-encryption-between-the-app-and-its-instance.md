# ADR 0047: End-to-end encryption between the app and its instance

- **Status**: **Proposed**, 2026-10-08. It decides the scheme the owner asked for on 2026-10-07 and
  asked the owner eight questions (§"The owner's questions, answered"), and **the owner ruled on all
  eight on 2026-10-08** (D-14, quoted there). It stays Proposed because the owner approves the whole
  ADR separately. Nothing is built by this ADR, and nothing it decides binds work until the owner
  accepts it.
  [#1179](https://github.com/openzigs/onyourleft/issues/1179) builds it afterwards
- **Date**: 2026-10-08
- **Deciders**: **the owner**, whose ruling of 2026-10-07 (quoted in Context) chose application-layer
  end-to-end encryption and named what it must cover. The author decided the construction, the key
  handling and the wire shape that ruling leaves open, and each is marked *the author's choice*
  where it is made
- **Issue**: [#1179](https://github.com/openzigs/onyourleft/issues/1179), which also covers the
  build
- **Number**: **0047**, the next free number on `main` on 2026-10-08
  ([`docs/agents/conventions.md`](../agents/conventions.md) §7, and
  [`docs/architecture.md`](../architecture.md)'s ownership table). No open pull request claimed it
- **Supersedes**: nothing. It does **not** supersede [ADR 0029](0029-camera-imagery-as-a-data-class.md)
  D-6, and says why in D-12
- **Amends**: nothing. No existing ADR is edited or gains an amendment in this pull request. When
  this ADR is accepted and #1179 lands, [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)'s
  D-9 *"until #1179 ships"* clause stops applying in the way D-11 below says, and an amendment to
  ADR 0046 recording that belongs to the pull request that ships it, not to this one
- **Relates to**: [ADR 0014](0014-portable-identity.md) (the device key),
  [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6 (which transport a picture may travel),
  [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3 (the four invariants),
  [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-2, D-8 and D-9 (the portable core,
  the tunnel, the dependency table), [ADR 0040](0040-a-history-index-on-the-riders-instance.md) D-6
  (what counts as a local address), and
  [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) D-9, D-10, D-11 and
  D-14(d)

---

## Context

### The problem, in one sentence

The home deployment ([ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-8, #807) is
reached through a Cloudflare Tunnel, and Cloudflare terminates TLS at its edge
([ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6 records the reading, from five sources), so
every request and response between the app and its instance exists in plaintext on Cloudflare's
infrastructure.

### What the owner decided, quoted so it is not argued again

The owner's Q11 ruling on [PR #1114](https://github.com/openzigs/onyourleft/pull/1114), 2026-10-07,
as ADR 0046 D-9 quotes it:

> *"encrypt at the application layer, end to end: the instance holds a key pair, each device pins
> its public key when linked, and a pasted API key, the synced privacy zones and words-to-mask list,
> and each job's input and result are encrypted so Cloudflare sees only ciphertext. Tracked in
> https://github.com/openzigs/onyourleft/issues/1179. Until it ships, a pasted key is accepted only
> on the home network or through the operator command."*

And the fourth ruling of the same day, as ADR 0046 D-10 quotes it:

> *"#1101 (masking sync) and #1095 (the job stream) do not ship before #1179. Privacy-zone centres,
> the words-to-mask list and job text never cross Cloudflare's edge readable."*

Issue #1179's body adds: replies are encrypted to the device; the sync payloads (#776, #881) come
next; the construction is a standard, vetted one *"(e.g. HPKE, RFC 9180)"*; WebCrypto in the client,
*"`node:crypto` on the instance"*; no new dependency without an ADR 0037 D-9 row; and the ADR owes
key rotation and revocation, what a lost device means, and replay protection.

### Why it is sound here, and the limit of that

The app's code reaches a rider in the APK and in the local build, not through Cloudflare, so the
edge cannot swap the code that does the encrypting (#1179's own argument). That holds for the
Android app and for a web build served from somewhere other than the tunnel. ⚠️ **It does not hold
for a web build served through the tunnel itself**: an edge that can rewrite the JavaScript can
rewrite the encryption out of it. D-13 says what follows.

### What exists today, read for this ADR on 2026-10-08

- **The device key** is Ed25519, a non-extractable `CryptoKey` in IndexedDB
  (`packages/store/src/web-crypto.ts`, header and §`createWebCryptoKeystore`;
  [ADR 0014](0014-portable-identity.md) D-1, D-3). ⚠️ #1179's prompt for this ADR called it ECDSA;
  it is not. It **signs** and it **cannot do Diffie–Hellman**: X25519 needs a different key, and an
  Ed25519 private key could be converted to one only from its bytes, which a non-extractable key
  never yields. That rules out HPKE's `auth` mode with the existing key (D-2).
- **What a device signs to an instance** is `packages/domain/src/identity/device-statement.ts`
  §`DeviceStatement` — RFC 8785 canonical JSON of `{purpose, instanceOrigin, nonce, publicKey,
  issuedAt}`, with four purposes (`oyl-auth-v1`, `oyl-link-v1`, `oyl-recover-v1`,
  `oyl-erase-account-v1`), canonicalised once in `packages/domain` so both sides sign and verify the
  same bytes (ADR 0014 D-8).
- **The instance's cryptography is all WebCrypto, through `globalThis.crypto`**
  (`apps/instance/src/auth/crypto.ts`, header): *"nothing here names `node:crypto` and the Durable
  Object adapter (#781) mounts it unchanged."* And: *"⚠️ The instance never holds a private key."*
  This ADR makes that second sentence false, on purpose (D-5).
- **Sessions** are a random 32-byte bearer token, of which the instance stores only the SHA-256
  (`apps/instance/src/auth/identity.ts` §`openSession`, `crypto.ts` §`sha256Hex`), and a session row
  names its device key (`identity.ts`, the session lookup that checks `key.revokedAt` and
  `key.athleteId`). Challenges live 60 s and are single use (§`CHALLENGE_LIFETIME_SECONDS`).
- **Linking** (#773): a signed-in device mints a link code (`identity.ts` §`mintLinkCode`, 5
  minutes, sixteen characters from a 31-letter alphabet, §`readableCode`); the new device signs an
  `oyl-link-v1` statement with **its own** key and posts it with the code
  (`apps/web/src/instance/sign-in.ts` §`linkThisDevice`). An **invite** (§`mintInvite`, 7 days) is
  minted by a moderator in `invite` registration mode.
- **The client's one module for instance traffic** is `apps/web/src/instance/instance-transport.ts`
  (ADR 0036 D-3(a)), and the addresses it will reach are `https:` or loopback `http:` only
  (`apps/web/src/instance/address.ts`, header). ⚠️ **So the app cannot tell whether a request went
  through Cloudflare**: the home deployment's `https:` name is the tunnel's, and the app has no
  certificate path to reach the box directly on the LAN. "Pin on the home network", as #1179 hopes,
  is therefore not something the app can check by itself. D-6 answers it another way.
- **Backups** are `VACUUM INTO` of the SQLite database plus the blobs
  (`apps/instance/src/store/backup.ts`, #791), driven by the operator CLI
  (`apps/instance/src/operator/cli.ts`: `migrate`, `backup`, `restore`, `verify`, `room-open`).
- **The operator secret** that encrypts model keys at rest is ADR 0046 D-9's (an environment
  variable, the owner's Q6 ruling), and is **not built yet**: #1097 is open.

### What the platforms offer, read on 2026-10-08

| Primitive | Browser WebCrypto | Android System WebView | Node 24 WebCrypto | Source |
|---|---|---|---|---|
| **X25519** (`deriveBits`) | Chrome 133 (February 2025), Firefox, Safari | follows Chromium's milestone | **stable since v23.5.0 / v22.13.0** | Igalia's write-up and the Blink intent to ship (search, 2026-10-08); Node 24 `webcrypto.md` history table, read 2026-10-08 |
| **Ed25519** (already required) | Chrome 137, Firefox 129, Safari 17 | follows Chromium | stable since v23.5.0 | `packages/store/src/web-crypto.ts` header; Node docs |
| **ECDH P-256** | everywhere | everywhere | stable | WebCrypto Level 1 |
| **HMAC-SHA-256** | everywhere | everywhere | stable | Node docs |
| **HKDF** | as `deriveBits` only, Extract and Expand **fused** | the same | the same | Node docs; WebCrypto spec |
| **AES-GCM** | everywhere | everywhere | stable | Node docs |
| **ChaCha20-Poly1305** | **absent** from every browser's WebCrypto | absent | **experimental**, "Modern Algorithms", since v24.7.0 | Node 24 `webcrypto.md` history table |

Two consequences carry the construction:

1. **Any WebView that can sign in can do X25519.** The device key already needs Ed25519 (Chrome
   137), which shipped four milestones after X25519 (Chrome 133). X25519 adds no device the app
   does not already exclude.
2. **WebCrypto's HKDF cannot do HPKE's key schedule directly.** RFC 9180 calls `LabeledExtract`
   and `LabeledExpand` separately, with a PRK carried between them; WebCrypto exposes only the
   fused HKDF. Both halves are one HMAC each (RFC 5869 §2.2 and §2.3), so the key schedule is built
   on **HMAC-SHA-256**, which every platform has.

⚠️ **What could not be confirmed**: X25519 under `workerd` (the Durable Object adapter, #781) was
not read. It does not matter today: the Durable Object adapter serves rooms only, and rooms are
outside this ADR (D-12). Chromium's own status page (chromestatus.com) did not render for the
fetcher; the Chrome 133 figure rests on Igalia's write-up and the Blink intent to ship, read through
a search, not on Chromium's page itself.

### RFC 9180, read on 2026-10-08

From [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html): KEM `0x0020` is DHKEM(X25519,
HKDF-SHA256) with `Nenc = Npk = Nsecret = 32`; KDF `0x0001` is HKDF-SHA256; AEAD `0x0001` is
AES-128-GCM (`Nk = 16`, `Nn = 12`, `Nt = 16`), `0x0002` AES-256-GCM, `0x0003` ChaCha20Poly1305;
modes `base = 0x00`, `psk = 0x01`, `auth = 0x02`, `auth_psk = 0x03`. `LabeledExtract` and
`LabeledExpand` prefix `"HPKE-v1"` and the `suite_id`. Each context's nonce is its `base_nonce` XOR
the sequence number, and a sequence number past its limit is an error (§5.2). §5.3 defines
`Export`; **§9.8 describes bidirectional encryption by exporting a response key and nonce from the
request's context.** §9.7.3: *"HPKE provides no other replay protection"* beyond in-order
decryption within one context. §9.5: HPKE's AEADs are not key-committing. **Appendix A.1** carries
test vectors for exactly DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, in all four modes,
with exporter vectors.

---

## Decision

### D-1 — The construction is HPKE, RFC 9180, suite `0x0020 / 0x0001 / 0x0001`, mode `base`

**Every sealed message is HPKE (RFC 9180) with DHKEM(X25519, HKDF-SHA256) (`0x0020`), HKDF-SHA256
(`0x0001`) and AES-128-GCM (`0x0001`), in `mode_base` (`0x00`).**

- **X25519** because it is in every WebCrypto this app can already run in (Context, consequence 1),
  its public keys are 32 bytes, and it has no point-validation pitfalls of the kind a hand-assembled
  P-256 decoder would carry.
- **HKDF-SHA256** because HMAC-SHA-256 is everywhere and SHA-256 is already this program's hash.
- **AES-128-GCM rather than AES-256-GCM**, *the author's choice*, for one reason: RFC 9180
  Appendix A.1 has test vectors for **exactly this suite**, so the gate (D-3) is the RFC's own
  numbers and not a third party's file. X25519 is a ~128-bit-security KEM, so a 256-bit AEAD key
  adds nothing the KEM does not already cap.
- **`base` mode** because the device has no Diffie–Hellman key to authenticate with (Context), and
  the sender is authenticated another way, inside the ciphertext (D-8).

**Rejected:**

| Alternative | Why not |
|---|---|
| ChaCha20-Poly1305 (`0x0003`) | Absent from every browser's WebCrypto; experimental in Node since v24.7.0. A software ChaCha20 would be hand-rolled cipher code, which is a different order of risk from composing platform primitives |
| DHKEM(P-256) (`0x0010`) | Works everywhere, but buys no device X25519 lacks (Context, consequence 1), and its 65-byte uncompressed points bring a decoding and validation surface X25519 does not have |
| `auth` mode, with a new device X25519 key | A second device key with its own lifecycle through register, link, revoke and recover (#772, #773) — to authenticate a sender the Ed25519 signature inside the ciphertext already authenticates (D-8) |
| `psk` / `auth_psk` | There is no pre-shared secret, and a low-entropy one would meet RFC 9180 §9.5's partitioning caveat |
| TLS to the box with a certificate the app pins, Cloudflare in front as a TCP relay | The tunnel terminates TLS at the edge by design ([ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6); a pass-through mode would be a different deployment (#807), and the app's `https:` stack offers no pinning API in a WebView |
| A hand-designed ECDH + AES-GCM scheme | Exactly what HPKE exists so that nobody writes; the vectors in D-3 are only available for a standard |
| Encrypting with the device's Ed25519 key | Impossible: a signing key, and non-extractable (Context) |

### D-2 — Replies are sealed with keys exported from the request's own context; there is no device encryption key

The device is never sent anything the instance initiates: every response, SSE events included, is
an answer to a request the device made. So **a reply is sealed under keys derived from a secret
exported from that request's HPKE context** (RFC 9180 §9.8) **and a random nonce the instance
chooses for that reply**, exactly as Oblivious HTTP derives its response keys
([RFC 9458](https://www.rfc-editor.org/rfc/rfc9458) §4.4), with HKDF-SHA256 as the KDF:

```
secret         = Context.Export("oyl response v1", 16)          # Nk
response_nonce = 16 random bytes, chosen by the instance, per reply   # max(Nn, Nk)
prk            = HKDF-Extract(salt = enc || response_nonce, ikm = secret)
key            = HKDF-Expand(prk, "key",   16)                  # Nk
base_nonce     = HKDF-Expand(prk, "nonce", 12)                  # Nn
```

`response_nonce` travels **in clear** at the head of the reply (the response envelope, or the first
event of a stream, D-9). Each message is AES-128-GCM with `nonce = base_nonce XOR I2OSP(seq, 12)`,
`seq` counting from 0 **per reply — one response, or one whole stream, whose events take
consecutive numbers** — exactly as RFC 9180's own `ComputeNonce`.

⚠️ **Why the instance's nonce is not optional.** Without it the reply's key and nonce would be a
pure function of the request, so an instance that answered **the same request twice** — a replay
let through by a replay record lost in a restart, or a retry of a request whose first answer was
never delivered — would seal two different plaintexts under one AES-GCM (key, nonce) pair. GCM then
leaks the XOR of the two plaintexts and its GHASH key, and whoever holds both ciphertexts can forge
reply messages under that key. RFC 9458 §6.5 (*"Replay Attacks"*, in the section's own body rather
than either of its subsections) gives exactly this reason for its server-chosen
`response_nonce`: it *"ensures that responses have unique AEAD keys and nonces even when requests
are replayed"*. D-9's replay record is still required, durable and atomic, but for side effects
(a second paid job), not for the AEAD's safety, which no longer depends on an operational property.

**Who can derive a reply's keys**: the device, which holds the request's ephemeral private key for
the life of that one request; **and the instance, or anyone else holding the encryption private key
the request was sealed to**, which can re-derive the request's context from `enc` and so the
exported secret. `response_nonce` is public and adds no secrecy — it adds uniqueness. That second
holder is D-5's forward-secrecy note, and is why deleting an encryption key matters.

- **The device keeps no HPKE secret beyond its request.** The ephemeral private key and the context
  are held in memory for one request or one stream and dropped; they are never written to
  IndexedDB, `localStorage` or a log. A stream that drops is resumed by a **new** sealed request
  (D-9), never by a kept context.
- **Rejected: a device X25519 key published to the instance**, which #1179's prompt offered as the
  alternative. It is the only design that would let the instance send unprompted, and nothing needs
  that; it would add a key to every link, revocation and recovery path, and it would put a
  long-lived decryption key on the device whose loss exposes every reply ever sealed to it, where an
  exported key exposes one reply.

### D-3 — HPKE is assembled from platform primitives, once, in `packages/domain`, and RFC 9180's vectors are the gate

**There is no new dependency.** HPKE's key schedule, `Seal`, `Open`, `Export`, the sequence counter
and its overflow error, and the framing of D-7 are written once, in `packages/domain`
(Apache-2.0, platform-free), **against a narrow primitives port**, in the shape of
`packages/domain/src/identity/seam.ts` (ADR 0014 D-8): the package owns the algorithm and cannot
name `crypto`, and the caller injects the primitive. The port has six members, and no more:
generate an X25519 key pair, X25519 `deriveBits`, HMAC-SHA-256, AES-128-GCM seal, AES-128-GCM open,
and random bytes. HKDF-Extract and HKDF-Expand are built on the HMAC member (Context, consequence 2).

**The port's `deriveBits` contract includes RFC 9180 §7.1.4's rule**: *"recipients MUST check
whether the Diffie-Hellman shared secret is the all-zero value and abort if so"*. Both sides apply
it — the device on `Encap`, the instance on `Decap` — so a low-order public key (the all-zero key
among them) is a refusal, never a shared secret. WebCrypto's Secure Curves `deriveBits` is specified
to throw on an all-zero output; the module checks the 32 bytes itself as well, so the rule does
not rest on every platform implementing that line.

**Two implementations of the port, both over WebCrypto**, in the places the Ed25519 ones already
live: `packages/store/src/web-crypto.ts` for the client and `apps/instance/src/auth/crypto.ts` for
the instance. Both are `crypto.subtle`; neither names `node:crypto`.

⚠️ **That departs from #1179's *"`node:crypto` on the instance"*, deliberately**: the instance's
core is written to mount unchanged under `workerd` (ADR 0037 D-2), `auth/crypto.ts` already says it
names no `node:crypto` for that reason, and `eslint.config.js` refuses a Node builtin in the core
(`CLAUDE.md` §4d). Node 24's WebCrypto has every primitive needed (Context).

**The gate is the RFC's own numbers**, and #1179's build owes it:

1. **RFC 9180 Appendix A.1, `mode_base`**, run through **each** port implementation, not through a
   stand-in: the shared secret, the key schedule's `key`, `base_nonce` and `exporter_secret`, every
   listed encryption by sequence number, and every exporter value. The test imports the vector's
   fixed ephemeral key, so `Encap` takes an injected ephemeral key pair **in tests only**, behind a
   name the production callers cannot reach (the `*-testing.ts` convention).
2. **Every A.1 ciphertext with one byte flipped, every AAD with one byte flipped, and a sequence
   number out of order** must fail to open.
3. **The sequence limit** raises rather than wraps (§5.2), shown at a lowered limit in a test.
4. **A client-sealed request opened by the instance's implementation and a reply the other way**, in
   one test that runs both implementations in Node, so the two cannot drift apart unseen.
5. **A low-order point is refused by each port implementation**: one test feeds the all-zero X25519
   public key (and at least one other small-order point) to `Encap` and to `Decap` through **each**
   implementation and requires a refusal. It is the one DHKEM rule the A.1 vectors cannot exercise.
6. **One request answered twice yields two different reply keys**: the instance's implementation
   seals two replies to one opened request and the test requires different `response_nonce`s and
   different ciphertexts for the same plaintext (D-2).
7. **Mutation-verified** under `CLAUDE.md` §5: at minimum, dropping the `"HPKE-v1"` label, swapping
   the Extract salt and IKM, skipping the XOR of the sequence number, reusing `base_nonce` for a
   reply, **dropping the instance's `response_nonce` from the reply's salt**, and **skipping the
   all-zero check** must each turn a test red.

**Rejected: `@hpke/core`** (1.9.0, MIT, depending on `@hpke/common`, read with `npm view` on
2026-10-08), which is WebCrypto-backed and would also pass the vectors. It would be the **first
cryptography dependency in the program**, which [ADR 0014](0014-portable-identity.md) D-2 kept at
zero, in the APK's closure and the instance's, and in `packages/` if the shared module took it. The
composition this ADR asks for is a key schedule over platform primitives, not a cipher, and the RFC
publishes vectors for exactly this suite. **If a reviewer of #1179's build finds the hand-assembled
module wrong in a way the vectors did not catch, the fallback is `@hpke/core` with an ADR 0037 D-9
row and a `check:notices` entry**, not a second hand-written attempt. Its code was not read for this
ADR.

### D-4 — The instance has two long-term keys: an identity key the device pins, and an encryption key it rotates

- **The instance identity key**: an **Ed25519** key pair. **This is what a device pins.** It never
  encrypts anything; it signs the instance's current encryption keys.
- **The instance encryption key**: an **X25519** key pair, the HPKE recipient key of D-1. It is
  published only inside an **instance key statement** the identity key signs — RFC 8785 canonical
  JSON of

  ```json
  { "purpose": "oyl-instance-key-v1", "instanceOrigin": "https://ride.example",
    "keyId": "<16 hex>", "encryptionKey": "<64 hex>", "serial": 1790000000,
    "notBefore": 1790000000, "issuedAt": 1790086400, "notAfter": 1790259200 }
  ```

  where `serial` is **that encryption key's** place in the order the instance made its keys — a
  whole number, the same in every statement for that key, and strictly greater than the serial of
  every key the instance made before it (D-5) — `notBefore` is when that key was made by the box's
  clock, and `issuedAt` and `notAfter` are when **this statement** was signed and when it stops
  verifying (D-5: a statement lives 48 hours and is re-signed daily). **A device orders keys by
  `serial` alone**; `notBefore` is the box's wall time, recorded for the operator and never compared
  with a device's clock (D-5).

  canonicalised in `packages/domain` beside `device-statement.ts`, with a purpose no device
  statement and no activity record carries, for `device-statement.ts`'s own reason.
  `keyId` is the first 8 bytes of SHA-256 over the encryption public key.
- **Served at** `GET /v1/instance/keys` as the current statement and any still inside its overlap
  (D-5), each with its signature. Plaintext: every byte of it is public, and what makes it
  trustworthy is the pinned signature, not the transport.

*The author's choice*, and the reason for two keys rather than the one the owner's ruling names
(*"the instance holds a key pair"*): **an X25519 key cannot sign, so it cannot vouch for its own
successor.** With one key, every rotation would be a re-pin on every device. With an identity key
that is rotated only when it must be, the encryption key can be rotated on a schedule (D-5) and
devices follow without a rider doing anything. The owner's ruling is still exactly met: the
instance holds a key pair the device pins, and the payloads are encrypted to the instance's key.

### D-5 — Where the instance's private keys live, and how they rotate

**Storage.** Both private halves are kept in the instance's SQLite database, in a table of their own
created by a migration with a tested `down` (ADR 0037 D-5, D-6), **wrapped with AES-256-GCM under a
key derived (HKDF-SHA-256, its own `info` label) from the operator secret** ADR 0046 D-9 introduces
and #1097 builds — the same secret, never a second one. Unwrapped only into memory, imported as
non-extractable `CryptoKey`s, never logged (`apps/instance/src/log.ts` §`redacted`), never in an
error, `/metrics` or an export.

- **Each wrap is bound to what it is.** The AES-256-GCM **nonce is 12 random bytes, fresh for every
  wrap** (a rotation re-wraps nothing; it wraps a new key under a new nonce), and the **AAD is the
  RFC 8785 bytes of `{ "purpose": "oyl-instance-key-wrap-v1", "role": "identity" | "encryption",
  "keyId", "instanceOrigin" }`**. So a row swapped between roles in the database, moved to another
  key's row, or copied to another instance that shares the operator secret fails to unwrap, rather
  than being imported as the wrong key.

- **So a backup carries the keys, as ciphertext**: `operator backup`'s `VACUUM INTO` copies the
  table, and `operator restore` brings them back, so **a restored instance keeps every device's
  pin**. A separate key file was rejected because #791's backup copies the database and the blobs
  and nothing else: the file would either be missed (a restore breaks every pin) or need a third
  backup path to keep in step.
- ⚠️ **`operator restore` rotates the encryption key as its last step.** A backup made before the
  latest rotation restores a newest encryption key whose `serial` is **lower** than one every
  device has already verified, and the newer key's private half is gone with the restore. Under
  the no-going-back rule below every device would refuse every statement served, get
  `instance_key_unknown`, re-read and be refused again, and sealing would stop until the next
  scheduled rotation, up to 30 days later. So `restore`, once the database and blobs are back and
  `verify` passes, makes a new encryption key and statement under the serial rule below (a serial
  of at least the current Unix time), which is higher than any a device has seen from a box whose
  clock was right. The identity key is restored unchanged, so every pin holds. ⚠️ **The one case
  that rule cannot see**: a key made while the box's clock ran ahead carries a serial ahead of the
  time, and a restore from a backup older than that key, once the clock is right, can issue a
  serial below it. A device refusing that names the serial it holds (below), and
  `operator instance-key rotate --serial-above <n>` makes a key above it.
- **Rejected: the key in an environment variable.** The operator would have to generate and paste
  it, every rotation would be a restart and an edit of `.env`, and the variable would be one more
  secret in the compose file. One operator secret wrapping keys the instance manages is less for an
  operator to get wrong.
- **No operator secret, no sealed routes.** An instance started without the operator secret answers
  every sealed route `unavailable`, naming the variable, and serves everything else. It never
  generates keys it could not wrap, and never falls back to plaintext.
- **A lost operator secret loses the keys.** The instance then cannot unwrap either key; the operator
  runs `operator instance-key reset`, which makes a new identity key, and **every device must re-pin**
  (D-6). Stated plainly, in `docs/operating-an-instance.md`, by #1179.
- ⚠️ **`apps/instance/src/auth/crypto.ts`'s *"The instance never holds a private key"* becomes
  false**, and its header is rewritten by #1179 in the same pull request that adds the keys.

**The keys are made** on first start once the operator secret is set, or by
`operator instance-key init`. **The identity key's fingerprint** — SHA-256 over
`"oyl-instance-identity-v1" || instanceOrigin || identityPublicKey` — is printed by
`operator instance-key show`, with the instance card (D-6).

**Rotating the encryption key** (the numbers **ruled by the owner**, D-14 Q3):

- **Automatically every 30 days**: a new X25519 key and its first statement, made by the HTTP
  process, the one writer (ADR 0037 D-5).
- **Statements are short-lived and re-signed daily**, **ruled by the owner** (D-14 Q3): **a
  statement's `notAfter` is its `issuedAt` plus 48 hours**, and once a day the instance signs a
  fresh statement for its **current** encryption key. It stops re-signing a key the moment that
  key has a successor. So a statement for a superseded key stops verifying at most 48 hours after
  the successor exists, whether the rotation was scheduled or on demand, and the old key's private
  half, kept 7 days (below), outlives every statement that was ever signed for it. Statement
  validity and key deletion are therefore two separate bounds, and the one that limits an active
  edge is the 48 hours (D-10). The cost is one Ed25519 signature a day, and that a device must
  re-read `/v1/instance/keys` before sealing if the statement it holds is past its `notAfter`.
  Devices re-read at sign-in and at least daily anyway. *Rejected*: one statement per key valid for
  the key's whole 37-day life, which an earlier draft of this ADR chose: against an edge holding a
  leaked encryption key it let an unrefreshed device be held on that key for up to 37 days, and
  after an on-demand rotation the statement outlived the key it named.
- **At start, before it seals or serves anything**, *the author's choice*: the instance checks its
  keys against its own clock, so one that has been **off for more than 48 hours** — normal for a
  home machine away for a trip or a dead disk — does not come back with nothing but expired
  statements and wait for a daily timer. If the current encryption key is past its 30 days it
  **rotates first**; then, if the newest statement for the current key has less than 24 hours left,
  or none is in date, it **signs a fresh one** before `/v1/sealed` and `/v1/instance/keys` answer.
  The daily re-sign is also scheduled from that rule (less than 24 hours left), not from the time
  of the last run. **A key's `serial` is `max(now in Unix seconds, the highest serial it has ever
  issued + 1)`**, a counter the clock only seeds: so a box whose clock was ahead and was then **put
  back** still issues keys higher than any a device has seen, and the no-going-back rule below never
  refuses an honest instance. **`notBefore`, `issuedAt` and `notAfter` are the box's clock as it
  is**, *the author's choice* over an earlier draft of this ADR that ran them through the same
  `max`: a statement signed after the clock was put back then carried an `issuedAt` and a
  `notBefore` up to the whole correction ahead of every correctly set phone, and the device refused
  it as from the future, blaming the phone, for as long as the correction (review G2).
- **A device never compares `serial` or `notBefore` with its own clock, and accepts an `issuedAt`
  in its own future**: ordering is the serial's job and validity is `notAfter`'s. What keeps the
  48-hour bound of the next bullet honest against a box whose clock runs ahead (whose `notAfter`
  would be ahead too) is the device's own clock: **a device trusts a statement until its `notAfter`
  or 48 hours after the device first verified it, whichever is earlier**, and re-reads
  `/v1/instance/keys` before sealing to one past either.
- **What a device says when it refuses a key statement** names the cause rather than a generic
  error, *draft wording, approved in the build's pull request (D-14 Q6)*: a statement past its
  `notAfter` with nothing newer served — *"Your instance's keys have expired. It may have been off
  for a while; it renews them when it starts. If it is running, check this phone's date and time,
  and ask its operator to restart it and to check its clock."*; and a key whose serial is lower than one the device has seen — *"Your
  instance offered an older key than it has used before. Nothing was sent. If its operator restored
  a backup, they can fix this with the number N."*, N being the serial the device holds, which
  `operator instance-key rotate --serial-above N` takes (above). **The older-key refusal never names
  the phone's clock**, because no clock decides it: keys are ordered by serial. The expired refusal
  names both clocks, because either can cause it (a box behind, or a phone ahead, by more than a
  statement's 48 hours), and a statement in the phone's future is never refused at all. A phone
  whose clock is wrong is told so by `stale_request`, which carries the instance's time sealed
  (D-9). The app re-reads
  `/v1/instance/keys` once before saying either.
- **A device never goes back.** It seals to the verified statement whose key has the highest
  `serial`, and **it stores, per instance, the highest key `serial` and its `keyId` it has ever
  verified, and never seals to a key with a lower serial**, whatever `/v1/instance/keys` serves
  later. (A re-signed statement for the same key carries the same `serial`, so daily re-signing
  never trips this rule.) An edge that strips
  the newest statement from the response therefore cannot move a device that has once seen it back
  onto an older key. A statement past its `notAfter` is never used.
- **The old key is kept for decryption for 7 days after its successor exists** (the overlap), so a
  device that has not refreshed still works, then its private half is **deleted** — not marked,
  deleted, and gone from the next backup. A request sealed to a key outside its overlap is refused
  `instance_key_unknown` (D-9); the device re-reads the statements and re-seals.
- **On demand**: `operator instance-key rotate`, and `operator instance-key rotate --drop-old`,
  which deletes the old private half at once — the answer to a suspected leak of the encryption key
  (D-10). ⚠️ **Deletion stops the instance reading the old key; it does not stop a device sealing
  to it.** The old key's last statement still verifies under the identity key until its
  `notAfter`, and an edge that holds the leaked private key can keep serving it — and forge the
  plaintext `instance_key_unknown` — to a device that has **not yet** seen the successor. Against
  an active edge, statement validity, not deletion, bounds the exposure: **at most 48 hours** from
  the rotation for such a device, because the instance signs nothing for the old key after it
  (above), unless the edge also holds the identity key (D-10).
- ⚠️ **Why deletion matters all the same**: `base` mode has no forward secrecy against the
  recipient's key. Anyone who recorded ciphertext and later obtains an encryption private key reads
  every request sealed to it and every reply derived from those requests (D-2). Deleting old keys
  on schedule bounds that window to about 37 days of traffic.

**Rotating the identity key** is rare and has two forms:

- **Planned**: `operator instance-key rotate-identity` makes a new identity key and an
  **endorsement** — the new identity's public key and fingerprint signed by the **old** identity
  key, purpose `oyl-instance-identity-rotation-v1`. A device that pinned the old key verifies the
  endorsement and then **does not re-pin by itself**: it stops sending sealed requests and asks the
  rider to confirm the new key **against a new card** (D-6), showing the old and new fingerprints;
  the endorsement only tells it that a new card is expected and which fingerprint the card must
  carry. **Ruled by the owner** (D-14 Q8: *"a planned identity-key rotation needs a new instance
  card, not an automatic re-pin"*), because the alternative — re-pinning on
  the endorsement alone — hands a stolen identity key a silent takeover: it can endorse the
  attacker's key, the edge serves that endorsement, and every device follows (D-10). The old
  identity key's private half is deleted once the endorsement is made.
- **Compromised**: `operator instance-key rotate-identity --compromised` makes **no** endorsement,
  because a stolen old key could endorse anybody. Every device must re-pin from a new card (D-6).
  ⚠️ **The operator's command cannot reach a device by itself**: the only channel to a device that
  does not yet know is the one the attacker controls, and a stolen identity key can sign encryption
  key statements of its own that the device accepts under its pin. So a device stops trusting the
  stolen key only when **the rider is told out of band** — by the operator, through whatever channel
  they share — and scans a new card. D-10 states this as a limit.

### D-6 — How a device pins the instance's identity key

**A pin is the instance identity key's fingerprint, stored on the device beside the instance
account** (`apps/web/src/instance/sign-in.ts` §`InstanceAccount`, which gains it), and never
replaced silently. **It is taken from a source Cloudflare cannot write**, because the app cannot
tell whether its own request went through the edge (Context): *the author's choice*, and the reason
#1179's *"ideally on the home network"* is met by an **out-of-band card** rather than by the
network.

**The instance card** is the string `oyl-instance:<origin>#<fingerprint, base32>`, shown as text and
as a QR code. It carries nothing secret. ⚠️ **The `oyl-instance:` prefix is a label inside the
string, not a URL scheme the app registers with the operating system**: the card is scanned or
pasted **inside the app**, on the screen that asks for it, and never opened as a link, because any
app may claim a custom scheme (D-8, the mailed token) and the card's whole worth is that nothing
between the source and the app could change it. **The fingerprint is the full 256-bit SHA-256 of D-5,
written as 52 characters of unpadded RFC 4648 base32, and is never truncated** — not on the card,
not in the QR code, not in a comparison: a short fingerprint is a second-preimage target, and an
edge that can serve keys has all the time it wants to search for one. It reaches a device from one
of three places:

1. **The operator command** `operator instance-key show`, on the box — how the **first** device
   pins (#772's first sign-in, which is the operator's own in every real deployment).
2. **A device that has already pinned**, inside the **link code screen** (#773): the code and the
   card together, one QR. The new device pins what the old device's **screen** shows, which is
   exactly the property #1179 asks of linking — a card the edge never touched.
3. **An invite** (`identity.ts` §`mintInvite`), minted on a moderator's device that has pinned,
   carries the card the same way, so an invited rider pins at registration.

⚠️ **In sources 2 and 3 the card is composed on the device, from its own stored pin**, and is never
fetched from the instance or taken from any response — an invite or link code that passed through
the tunnel could otherwise carry a card the edge wrote. And ⚠️ **an invite's card is only as
trustworthy as the channel that carries the invite to the new rider**: a moderator who pastes an
invite into a chat service hands that service the power to substitute the card. The app says so
where an invite is shared; the trade is the same as Q1's, one step removed.

**What a device does with it:**

- **On first sign-in or link**, the device reads `/v1/instance/keys`, verifies each statement's
  signature under the identity key **in the card**, and pins only if the fingerprint of the key
  that signed matches the card. A mismatch is a **loud refusal** in the app's words — *"This
  instance's key is not the one on the card you were given. Nothing was sent."* — and nothing sealed
  is sent. Draft wording, approved in the build's pull request (D-14 Q6).
- **A device with no card** — a rider who typed only an address — may sign in **to an athlete it
  already belongs to** exactly as today (#772), and **holds no pin**. With no pin, **no sealed route
  is used**: the app says that the features that need it (D-7, phase 1) need the instance's card,
  and where to get it. ⚠️ **It cannot register a new athlete through the tunnel**: registration's
  answer carries the recovery codes (`apps/instance/src/auth/routes.ts`, `POST /v1/auth/session`,
  `recoveryCodes`), which are sealed in phase 1 (D-7). Whether such a device may instead pin on
  first use was the owner's to rule, and **the owner ruled no** (D-14 Q1: *"A device pins only from
  an instance card"*).
- **On every later use**, a statement that does not verify under the pinned key, or a
  `/v1/instance/keys` whose identity differs, is refused loudly and **never re-pinned**. The only
  way a pin changes is the rider scanning a new card, which the app treats as a deliberate act: it
  shows the old and new fingerprints and asks. A verified endorsement (D-5, planned rotation) makes
  the app ask for that card; it does not replace it (D-14 Q8).
- **A recovered device** (#773's recovery code, every device lost) has no device to show it a card,
  so it pins from the operator or from an invite-style card the operator sends. The recovery code
  itself carries no fingerprint, because it was shown at registration and may be years old.

### D-7 — What is sealed, in two phases

**Phase 1, which #1179 ships, and without which #1095, #1097's in-app key, and #1101 do not ship**
(the owner's rulings). It has four parts: the payloads the owner named, **every route that adds or
removes a device key or carries a recovery secret** (without which D-8's sender check can be walked
around, below), **every route that serves the athlete's synced history**, and **every moderator
route** (below).

| Payload | Route (inner, D-9) | Direction sealed |
|---|---|---|
| A pasted API key, a rider's own or the shared one set from the app (ADR 0046 D-9) | the key routes #1097 adds | request; the key is never sent back |
| The synced privacy zones and words-to-mask list (ADR 0046 D-10, #1101) | push and pull | both |
| Each analysis job's input, every SSE event's text, the result, resume and cancel (ADR 0046 D-6, D-11, D-12, #1095) | every job route | both |
| The rider's recorded hosted consent and the endpoint it names (ADR 0046 D-9, Q10) | the consent routes | both |
| **The account export** (#35), because from #1101 on it carries the masking data (ADR 0046 D-10) | `GET /v1/account/export` | reply |
| **Minting a link code** (#773) | `POST /v1/auth/link-codes` | both: the code is in the reply |
| **Linking a device** with that code | `POST /v1/auth/link` | request (no session yet: D-8, D-9) |
| **Recovering** with a recovery code or a mailed token, and **asking for** a mailed token | `POST /v1/auth/recover`, `POST /v1/auth/recover/email` | request (no session yet) |
| **Registering** a new athlete: the recovery codes and any recovery address | `POST /v1/auth/session` **when the key is new** | both |
| **Giving and confirming a recovery address** | `POST /v1/auth/recovery-email`, `POST /v1/auth/recovery-email/confirm` | request |
| **Revoking a device key** (any key, not only the last) | `POST /v1/auth/devices/{publicKey}/revoke` | request |
| **Deleting the account**, whose step-up carries a recovery code (`identity.ts` §`stepUp`) | `DELETE /v1/account` | request |
| **Minting an invite** (a moderator's) | `POST /v1/moderation/invites` | both: the code is in the reply |
| **Every other moderator action**: suspending and lifting a suspension, hiding a display name, approving and refusing a registration, dismissing a report | `POST /v1/moderation/athletes/{athleteId}/suspend`, `…/unsuspend`, `…/hide-display-name`, `POST /v1/moderation/registrations/{athleteId}/approve`, `…/refuse`, `POST /v1/moderation/reports/{reportId}/dismiss` | both: each request carries the moderator's reason, and the reply its log id |
| **Every moderator read**: the report queue (other riders' report text), the registrations awaiting approval, the suspended list and the moderation log | `GET /v1/moderation/reports`, `GET /v1/moderation/registrations`, `GET /v1/moderation/suspended`, `GET /v1/moderation/log` | reply |
| **The synced history**: manifest, records and their original files, items (`write-up` and `side-camera-report` among them), tombstones, race consent, the athlete's activities and streams | every route `apps/instance/src/sync/routes.ts` declares | both |
| **History search** (ADR 0040), whose answer is passages of past write-ups and notes | `POST /v1/history/search` | both |

and the rule that makes the table hold: **a payload in phase 1 has no plaintext route at all.** No
plaintext twin is kept "for old clients", because Cloudflare holds the bearer token (D-11) and could
call one. `POST /v1/auth/session` is the one route that is in the table for some requests and not
others: a key the instance already holds still signs in through it in plaintext until phase 2 (the
answer is a session token, which the edge already sees in every header, D-11), while **a key it
has not seen is refused `sealed_required` in plaintext and registers only sealed**. An instance with
no keys (no operator secret, D-5) has no sealed routes and registers in plaintext exactly as today;
that is stated in the operator guide as what an instance without the secret exposes.

**Why the key and recovery routes are in phase 1**:
today `mintLinkCode` needs only the bearer session (`identity.ts` §`mintLinkCode`: the caller and
nothing else), so an edge holding a rider's token could mint a code, post it to `/v1/auth/link`
with an `oyl-link-v1` statement signed by **its own** key (§`link` → §`addKey`), sign in as that
key, and pass every check D-8 makes — its own key is the session's key. A recovery code seen in
plaintext (at registration, at `/v1/auth/recover`, or in a step-up or last-key revoke, where it is
checked and **not** spent) gives the same, and so does binding the edge's own address through the
bearer-only recovery-email routes and recovering by mail. A code the new device sent through a
plaintext `/v1/auth/link` could be raced. And a device key that is not the last can be revoked with
the bearer token alone, which is a lock-out. Sealing and device-signing every one of these routes
(D-8) means the secrets they move cross the edge only as ciphertext, and an edge with nothing but a
token can no longer add, recover or remove a key.

**Why every moderator route is in phase 1** — every route `apps/instance/src/moderation/routes.ts`
declares `reaches: 'moderation'`, which the table above names one by one: each is a bearer-session
route today, and a moderator is told apart only by the device key their session names
(`identity.ts` §`IdentityOptions.moderators`). So an edge holding a moderator's token could
**suspend any rider** — which ends every one of that rider's sessions and refuses every one of
their keys, the lock-out that puts revoke in phase 1, applied to anyone — approve accounts it
registered itself in approval mode, hide display names, dismiss reports, and read other riders'
reports and the moderation log. Sealed and signed by the moderator's device key (D-8), none of that
is open to a token alone. The rider-facing half, `POST /v1/reports` and the blocks routes, moves
only the rider's own report and block list and is phase 2.

**Why sync is sealed in phase 1, and how that costs nothing now**, **ruled by the owner** (D-14
Q7: *"Sync, ride uploads included, waits for #1179 and ships sealed only"*): a finished job's result is a `ScreenedWriteUp` the device keeps and syncs as a
`write-up` item (`apps/instance/src/sync/routes.ts`'s item kinds; `sync.ts`: *"Kept byte for byte:
a write-up is the device's screened copy (#776)"*), a `side-camera-report` item carries the pose
summary, and a ride's original file usually starts and ends at the rider's home, so it discloses the
very privacy-zone centre the owner ruled must never cross the edge readable. Leaving any of these
plaintext would break the owner's fourth ruling the first time a device synced. And
`apps/instance/src/instance.ts` **hands the handler no sync today** — every sync route answers
`unavailable` on a running instance, and no client calls one (#777) — so marking those routes
sealed-only in the route table now means sync is sealed from the day it is wired, with no plaintext
version ever shipped and nothing to migrate. The cost is that sync waits for #1179. History search
is in the table for the same reason: its answer is passages of the same write-ups and notes.

**Phase 2, what is left**: the sign-in answer for a key the instance already holds, `/v1/auth/account`,
the device list, the display name, the adult confirmation, the suspended athlete's way-out session
(`POST /v1/auth/leave-session`, sessionless like sign-in: D-8, D-9), a rider's own blocks and reports (`GET`, `POST` and `DELETE /v1/blocks…`, `POST /v1/reports`), the
room routes' HTTP side, and three session and profile routes, each placed for a reason:

- **`GET /v1/auth/session`** (*"Who this session is"*): it moves no secret and changes nothing, so
  it is not phase 1's. It is sealed in phase 2 for the reason the other two routes here are: **its
  answer names the athlete behind the token** — their id and public projection — which is what
  sealing the sign-in answer hides, and leaving this route plaintext would hand it back to the edge
  on the next call. (Its `reaches: 'own'` tag is not the reason: `/health`, `/ready`, `/source` and
  `/openapi.json` declare the same tag and stay plaintext.)
- **`DELETE /v1/auth/session`** (sign out): ending a session hands nobody anything, and an edge that
  wanted to cut a rider off can already do so by not forwarding, so it is not phase 1's. It is
  sealed and device-signed in phase 2 so that the token alone ends no session either, which is
  phase 2's claim that the token opens nothing.
- **`GET /v1/athletes/{athleteId}`** (another rider's public projection): its answer is what any
  rider may see, but the request says **which athlete a rider is looking at**, which is who they
  ride with; sealed in phase 2, not phase 1, because it is neither a payload the owner named nor a
  route that changes a key or a secret.

⚠️ **Sealing the sign-in answer does not hide the session token**: the
token still rides in every `POST /v1/sealed`'s `Authorization` header (D-11, decided), so the edge
reads it after phase 2 exactly as before. What phase 2 ends is the token's **usefulness** — once
every route that reaches an athlete is sealed and device-signed, the token alone opens none of them
— not its **visibility**.

When phase 2 is done, **every route that reaches an athlete's own data is sealed**, and the plaintext routes
left are the ones that carry nothing personal: `/health`, `/ready`, `/source`, `/openapi.json`,
`/licences/third-party.txt`, `/instance`, `/v1/instance/keys` and the sign-in challenge. Phase 2's
sealed sign-in, and the sealed `leave-session` (whose request is an `oyl-auth-v1` statement signed
by a live device key, as for signing in), have no session yet; both follow the sessionless rule of
D-8 and D-9, exactly as link and recovery do in phase 1. Phase 2 is its own issue, filed by #1179, and is not a condition of
phase 1.

**Out of scope, named so nobody assumes otherwise**: room sockets (#782), whose reports carry power
and never a position (`packages/protocol`), and `/metrics`, which is the operator's and carries no
athlete data. **The owner ruled the room sockets are not sealed, and their HTTP routes are, in
phase 2** (D-14 Q5).

### D-8 — The sender is the device, proved inside the ciphertext

`base` mode lets **anyone** seal to the instance — Cloudflare included — and Cloudflare holds every
bearer token (D-11). A sealed request authenticated by the token alone would therefore let the edge
**start an analysis job as the rider and read its result**, because the result is sealed to the
context of whoever sent the request (D-2). So:

**Every sealed request carries, inside its plaintext, a device signature** by the session's device
key (the ADR 0014 key, non-extractable, through `sign-in.ts`'s existing `SigningKey`), over a new
`packages/domain` statement with its own purpose:

```json
{ "purpose": "oyl-sealed-request-v1", "instanceOrigin": "https://ride.example",
  "keyId": "<16 hex>", "enc": "<64 hex>", "method": "POST", "path": "/v1/…",
  "issuedAt": 1790000000, "bodySha256": "<64 hex>" }
```

The instance, after opening the ciphertext, checks the signature under **the device key the
session row names** — not a key the request claims — and refuses with `bad_signature` otherwise.
Because the signature covers `enc`, it is bound to this one HPKE context; because it travels inside
the ciphertext, the edge never sees it and cannot move it into a request of its own. The
`oyl-sealed-request-v1` purpose is distinct from the four device-statement purposes, so no sign-in,
link, recovery or erase statement verifies as a sealed request, nor the reverse.

**A sealed request with no session yet** — registering, linking and recovering in phase 1, and
phase 2's sign-in and the suspended athlete's way-out (`leave-session`) — cannot name a session's
key. There the sealed-request statement is signed by
**the key the inner statement adds or signs in with** (the `publicKey` of its `oyl-auth-v1`,
`oyl-link-v1` or `oyl-recover-v1` statement; `leave-session` carries an `oyl-auth-v1`), the instance requires the two to name the same key,
and the AAD's `tokenSha256` is `null` (D-9). That proves only that whoever sent the request holds
that key — and the edge can always seal a request of its own with a key of its own. **What stops it
is that it has nothing to put inside**: the link code, the recovery codes and the mailed token now
cross the edge only as ciphertext (D-7), or by mail in a form no browser fetches through the edge
(below), so an edge that never saw one cannot use one, and a new device's sealed `/v1/auth/link`
cannot be raced by an edge that cannot read the code in it.

**Asking for a recovery mail is sealed and not signed**, *the author's choice*.
`POST /v1/auth/recover/email`'s request is `{ address }` and nothing else (`auth/routes.ts`): it
carries no device statement, so there is no key for the sealed-request rule above to name. Its
envelope therefore carries **no** sealed-request statement; it is the one sessionless route that
admits one without, and D-9's dispatch admits that only for this inner path. That is safe because
the request moves no secret to whoever sends it: the token goes to the address an athlete bound
(`identity.ts` §`requestEmailRecovery`), the answer is `204` whether or not the address is held,
and the edge could seal the same request itself whenever it liked. What sealing
buys is that the edge does not learn **which address** a rider is recovering. **Its inner
plaintext carries an unsigned `issuedAt`** beside `{ address }`, *the author's choice*, checked
against the same 120 s window as every signed one (D-9, refused `stale_request`). Unsigned is
enough here: the AEAD binds it to this envelope's `enc`, so an edge without the recipient key
cannot change it, and so an envelope the edge kept cannot be replayed once D-9's 10-minute replay
record has forgotten its `enc` — without it, an edge could replay one envelope for as long as its
`keyId` is accepted (up to about 37 days) and have the instance mail fresh tokens to an address the
edge cannot read. Within the window the durable `enc` record refuses a replay, and the per-address
and per-client limits that bound the mail today (`emailPerAddress`, `perAddress`) bound a fresh
request. *Rejected*: making the device sign it with the
fresh key it will recover with, which the instance could check but not tie to anything — the token,
not the key, is what binds the later `recover`.

**The mailed token reaches only the app, never a page fetched through the edge**, *the author's
choice*, and a constraint on whoever writes the mail. `RecoveryMailer` (`identity.ts`) is supplied
by the operator, and the routes call what it sends a *link* (`auth/routes.ts`: *"Email a
single-use recovery link"*, *"Follow the link mailed to a recovery address"*). If that link were an
`https:` URL on the instance's origin — the obvious way to write one — a rider who opened it would
send the token **through the tunnel in plaintext**, and the edge could redeem it in a sealed
`recover` signed with a key of its own: an account takeover. So **both tokens a mailer carries —
the recovery token and the address-confirmation token — reach the device only as text the rider
types into the app — a typed code, and no link of any kind**, and the app sends them only inside a
sealed request (`recover`, `recovery-email/confirm`, D-7). The mail names no URL on the instance's
origin or any other web origin. ⚠️ **A custom URL scheme is rejected too**, *the author's choice*
over an earlier draft of this ADR that allowed one: on Android any installed app may declare the
same scheme in an intent filter, and the rider may be offered it, or it may be chosen for them —
RFC 8252 (OAuth 2.0 for Native Apps) warns of exactly this for private-use scheme redirects. An app
that caught the link would hold the token and could seal its own `recover` with a key of its own,
an account takeover moved from the edge to the phone. A typed code goes only where the rider types
it. #1179 rewrites those two route
summaries to say *code* rather than *link*, documents the rule for a mailer author in
`docs/operating-an-instance.md`, and the app refuses to treat any `https:` URL as a recovery or
confirmation link. ⚠️ An Android App Link is an `https:` URL and is **rejected** for this: on a
device without the app, or where the association has not been verified, it opens in a browser and
the browser fetches it through the edge. Nothing needs migrating: `apps/instance/src/instance.ts`
hands the identity service no mailer today, so email recovery answers `not_found` on every running
instance. ⚠️ **The mail itself is outside sealing**: whoever carries it reads the code. In
particular, mail routed through **Cloudflare Email Routing** — on the operator's sending domain or
the rider's own — crosses Cloudflare readable, and the edge could then redeem the code in a sealed
`recover` with a key of its own. The operator guide says that an instance's mail should not be
routed through Cloudflare, and that a rider whose address domain uses Cloudflare Email Routing
should not rely on email recovery against an edge they do not trust; nothing in the app can see
how a mail travelled.

**So, with phase 1 shipped, an edge holding nothing but a rider's bearer token cannot** start a job,
read the masking data, the export or the synced history, mint a link code or an invite, add,
recover or revoke a key, change the recovery address, delete the account, or — with a moderator's
token — act as a moderator or read the moderator's queues: every one of those is sealed and signed
by a device key the edge does not hold. D-11 says what the token still buys it.

⚠️ **One residue, stated rather than hidden: what the edge may already have done before phase 1
shipped.** With nothing but a token, an edge could then have (a) learned a recovery code or an
invite that crossed in plaintext (registration's answer, a plaintext recovery or step-up); (b)
**added a device key of its own**, through the bearer-only link-code mint and a plaintext
`/v1/auth/link` signed by its own key (`identity.ts` §`mintLinkCode`, §`link` → §`addKey`); and (c)
**bound a recovery address of its own**, through the bearer-only `POST /v1/auth/recovery-email` and
`/confirm`, whose confirmation token is mailed to the address the edge gave. New codes undo only
(a). A key from (b) signs sealed requests as a genuine device key, which D-8 cannot tell from the
rider's own; an address from (c) is enough for a sealed `recover/email` and `recover` after phase 1.
⚠️ **A key from (b) cannot be told apart from the rider's own cryptographically**: it was added
by the instance's own link route, it signs with a real device key, and nothing in it records that
the edge rather than the rider minted the code. No check on the instance can find it. **The
rider's review is the control**, and it is built so that it cannot be taken silently on the
rider's behalf. Two mechanisms make it so: a **one-off review** on each device of an account that
predates the pin, and, from phase 1 on and for every account, an **account-change notice** on every
device for every account-security change another key makes. The notice is what makes the review
safe to lose: a key the edge added may get to the review first, but nothing it does afterwards, or
does instead, goes unreported.

**The account-change log.** From phase 1 the instance records, per athlete, **every
account-security change**, each with its time and **the device key whose sealed, device-signed
request authorised it** (D-8 checks the signature under that key, so the instance knows which key
it was; a `recover`, which has no session, records the key it added and how: by recovery code or
by mailed token):

- the recovery codes **replaced**;
- a recovery address **bound** (at `/confirm`) or **cleared**;
- a link code **minted**, and a key **added** by linking with it;
- a key **added by `recover`**;
- a key **revoked**.

It is read only sealed, and it is the athlete's: the account export carries it, and the account's
deletion deletes it. #1179 adds the table and its migration.

**The account-change notice.** At each sealed use, a device is shown **every entry made by a key
other than its own** since that device last acknowledged the log — *"On 3 October the key added on
12 September bound a recovery address and minted a link code. If that was not you, revoke that
key."*, and for a key added — *"A new key was added to your account on 3 October, by a link code
from the key added on 12 September."* — draft wording, approved in the build's pull request (D-14
Q6). **The acknowledgement is per device**: it is a sealed request signed by that device's own key,
and moves only that device's mark, so no other key — an edge-added one included — can mark a notice
seen on the rider's behalf. A device that has not acknowledged keeps being shown the entries. So the
*"a new key was added to your account"* notice reaches every other device from phase 1 on, which
also covers a `recover` after the pin (a key added through an address or codes the edge holds).

**Revoking a key the notice named** — and, so that the answer to a notice cannot be done halfway,
revoking **any** key, through the sealed, device-signed revoke route (D-7) — does more than today's
revoke (`identity.ts` §`revokeDevice`), *the author's choice*: in one transaction it

1. **revokes** that key, ending its sessions;
2. **replaces the recovery codes** (the new codes go to the device that asked, sealed);
3. **clears any recovery address that key bound**, and any confirmation it has pending;
4. **voids every unredeemed link code that key minted**;

and then **shows the device list again**, with every key added since the revoked key's first
sealed use marked — and, specially, any key added with a link code it minted or by a `recover`
through an address it bound — and asks the rider to revoke any they do not recognise, the same way.
Each of those changes is itself logged and so shown on the rider's other devices.

**The one-off review**, offered **per device, not per athlete**: every device of an athlete whose
account predates the pin is asked at its own first sealed use, **whether or not another of the
athlete's keys has already done the review** — so a key the edge added cannot complete it once,
quietly, and have it counted as done for the rider. It covers what happened **before** the log
existed, which no notice can name. The review:

1. **replaces the athlete's recovery codes**, so the old ones stop working;
2. **clears the bound recovery address** in the same request, so an address the edge bound recovers
   nothing; the rider gives and confirms one again, sealed (D-7), if they want email recovery;
3. **shows the device list, always** — read sealed, as part of the review, though the plain device
   list is phase 2 — with each key's `addedAt` and when it was **last used** (a sealed request or a
   sign-in it signed; the instance records the time per key from phase 1, a column #1179 adds), and
   the keys added before the pin marked, and **asks the rider to revoke any key they do not
   recognise**, through the revoke above.

The first device to do the review replaces the codes and clears the address; a later device's
review does not replace them again unless the rider asks, but it is still shown the device list,
and the replacement and the clearing are entries in the log, so **the later device is also shown
them as account-change notices naming the key that made them**. So the silent variant reviewer G1
traced — an edge-added key takes the review first, **then binds an address of its own or mints a
link code and links a second key** — is named on the rider's own screens: the review's codes and
clearing, the new address, the minted code and the second key are each an entry made by a key
other than the rider's device. Revoking the named key clears its address and voids its codes, and
the list marks the second key.

Then D-8's *"an edge with nothing but a token can no longer add, recover or remove a key"* holds for
accounts that predate phase 1 as well, **once every device of the rider has done the review and the
rider has revoked what they do not recognise**, and from then on any change another key makes is
reported on every device. ⚠️ What stays is the **noisy** variant: a key the edge added is a real
device key until the rider revokes it, so it can revoke the rider's own keys first. That is a
lock-out the app cannot undo for the rider (a rider with a recovery code or a bound address of
their own recovers from it, and the recovery is logged), and it is why the review and the notices
are shown at each device's first sealed use rather than tucked away. An invite expires in 7 days on
its own. The wording of the review and the notices, and their place, are approved in the build's
pull request (D-14 Q6).

*The author's choice*, over two alternatives:

- **A second, "sealed" session token issued only inside a ciphertext** — rejected: it is a second
  secret with its own lifecycle, revocation and storage, and until phase 2 ends the sign-in that
  would issue it is itself plaintext.
- **The bearer token moved inside the ciphertext** — rejected for phase 1, because plaintext routes
  still send it in a header (D-11), so the edge still has it; and the instance wants the session
  checked **before** it does a Diffie–Hellman for a request that has one (D-9).

### D-9 — The wire: one sealed endpoint, the AAD, replay and ordering

- **One endpoint**, `POST /v1/sealed`, *the author's choice*. The **inner method and path are inside
  the ciphertext**, so the edge cannot see from the **request** which operation a rider performed
  — setting a key, syncing a word list or starting a job all look alike on the way in. ⚠️ **The
  reply is not alike**: a job answers with a long-lived `text/event-stream` whose duration and event
  cadence the edge sees, where a key or masking request answers once, so the edge can tell a job
  from the rest by the response's shape (D-11). The instance dispatches the opened request
  through the **same route table** (`apps/instance/src/routes.ts`), where a sealed-only route is
  marked so and unreachable any other way; `openapi.json` (#36) documents those routes with that
  mark.
- **The envelope** is JSON, `{ "v": 1, "keyId": "…", "enc": "<base64url>", "ct": "<base64url>" }`,
  so a body-size limit and JSON parsing apply before any cryptography. ⚠️ **That limit is not
  `config.bodyLimitBytes` unchanged** (1 MiB by default, `apps/instance/src/config.ts`
  §`DEFAULT_BODY_LIMIT_BYTES`): `POST /v1/sync/records` already carries the original file as base64
  inside JSON, and sealing pads that body up to its bucket (below) and base64url-encodes it again in
  `ct`, about 4/3 × 4/3 ≈ 1.78 times the raw file. So `/v1/sealed`'s outer limit is **the inner
  limit, plus the inner framing (method, path, statement, signature), rounded up to its padding
  bucket, plus the 16-byte tag, times 4/3, plus the envelope's own fields**, computed from the same
  configured limit, and checked before any cryptography; the inner limit is then applied to the
  opened body exactly as the plaintext route applied it, so a file the plaintext route accepts is
  accepted sealed and nothing larger. **A reply** is
  `{ "v": 1, "nonce": "<base64url>", "ct": "<base64url>" }`, `nonce` being D-2's `response_nonce`;
  a stream's first event carries the `nonce` and every event after it only its `ct`.
- **The order of checks on the instance**, for a request that carries a bearer session: the session
  (a hash and a lookup, as today) and the rate limits **first**, so an unauthenticated flood costs
  no X25519; then `keyId` (unknown or outside its overlap → plaintext `instance_key_unknown`,
  carrying nothing else); then `Open`; then the device signature (D-8); then freshness and replay;
  then the inner route. **For a sessionless sealed request** (D-8: registering, linking,
  recovering, asking for a recovery mail, and in phase 2 signing in and the suspended athlete's
way-out), which has no session to check, what
  replaces that first step is a **per-client-address rate limit on sessionless sealed requests**,
  counted before any X25519, on the model of `identity.ts`'s existing per-address limiters
  (`perAddress`, `registrations`); the inner route's own limits then apply as today. A flood from
  many addresses still costs one X25519 per request up to those limits, which is the price of a
  route that has no session to show.
  - ⚠️ **That limit is per rider only through `apps/instance/src/client-address.ts`.** Behind
    `cloudflared` every request arrives from one peer, so the address is the rider's only when the
    operator sets `OYL_INSTANCE_CLIENT_ADDRESS_HEADER` and the peer is loopback or listed in
    `OYL_INSTANCE_TRUSTED_PROXIES` — which the home deployment does
    (`apps/instance/deploy/home/compose.yaml`: `cf-connecting-ip`, and the tunnel container's
    address). Without it there is one shared bucket, and one flood refuses registration, linking
    and recovery for every rider; the operator guide says so where it documents sealing.
  - ⚠️ **The edge writes that header**, so the limit protects the instance from the internet and
    not from the edge, which can choose any address it likes. That costs nothing new: an edge can
    deny service to every rider anyway, by not forwarding.
  - **A sessionless envelope is dispatched only to the sessionless routes named here** —
    `POST /v1/auth/session` (for a key the instance has not seen in phase 1, and any key in phase
    2), `POST /v1/auth/link`, `POST /v1/auth/recover`, `POST /v1/auth/recover/email` and, in phase
    2, `POST /v1/auth/leave-session` (signed, like sign-in, by the key its `oyl-auth-v1` statement
    names, D-8) — and only `recover/email` without a sealed-request statement (D-8). Any other inner path in an envelope
    with no `Authorization` header is refused `unauthenticated` after `Open`, sealed, so a
    sessionless envelope can never reach a session route, nor one with a fallback.
- **HPKE `info`** is `"oyl-sealed-v1"`. **The AAD of the request** is the RFC 8785 bytes of
  `{ "purpose": "oyl-sealed-aad-v1", "direction": "request", "instanceOrigin", "keyId",
  "tokenSha256" }`, where `tokenSha256` is the SHA-256 the instance already stores for the session,
  or `null` for a sessionless request. So a ciphertext moved to another session, another instance or
  another key does not open. **The AAD of each reply message** is the same with `"direction":
  "response"`, the request's `enc` and the reply's `response_nonce`. **A stream event's id and kind
  travel only inside its ciphertext**, *the author's choice*: the SSE frame on the wire carries a
  `data:` line and nothing else — no `event:` field and no `id:` field — so the edge learns no
  event's kind (section, progress, `end`…) and no id beyond the count it can make anyway. Nothing
  about the event needs to be known before opening it, because its position is already bound by the
  sequence number in the AEAD nonce (D-2); so the reply AAD carries no event id or kind, and the
  opened event's own id and kind are what the device acts on and what resume names.
- **Replay**: the signed `issuedAt` must be within **120 s** of the instance's clock (and, for
  `recover/email`, which carries no statement, the unsigned `issuedAt` in its plaintext, D-8), and
  the
  SHA-256 of `enc` is recorded, per instance, for **10 minutes**; a second request with the same
  `enc` is refused `replayed` without running anything. **The record is durable and atomic**: a
  table in the instance's SQLite database, written by the HTTP process (the one writer, ADR 0037
  D-5), where the check and the insert are **one statement** (an insert that fails on the primary
  key) made **before** the inner route runs. It survives a restart, so `deploy.sh`'s few seconds of
  restart do not open a window inside the 120 s in which a replay is accepted; rows older than
  10 minutes are deleted. Its only job is side effects: D-2's `response_nonce` already makes a
  second answer to one request safe for the AEAD. An X25519 ephemeral public key is fresh per
  request, so a repeat is a replay and nothing else. (*The author's choice* of both windows: twice
  the challenge's 60 s, and five times the skew.) A replayed request could not be read by whoever
  replays it anyway — the reply is sealed to the original ephemeral key (D-2) — but it could have
  side effects, such as starting a second paid job; the record stops those.
- **A request outside the 120 s window is refused `stale_request`**, sealed (it is after `Open`),
  carrying the instance's own time in Unix seconds and nothing else, and nothing runs. ⚠️ **This is
  a new clock requirement, on the phone and on the box**: today the instance checks only that a
  device statement's `issuedAt` is a whole number (`apps/instance/src/auth/identity.ts`), and
  freshness comes from the single-use challenge; from phase 1, a phone or a box whose clock is more
  than 2 minutes off fails **every** sealed request, revoke and recovery included. So the device,
  on `stale_request`, compares the instance's time with its own: it **re-signs once** with
  `issuedAt` taken from the instance's clock (the replay record still bounds replays, because only
  the device can sign). **It keeps that offset**, per instance, and signs every later sealed
  request with its own clock plus the offset, so a phone a few minutes off pays the second round
  trip once rather than on every request; the offset is replaced only by a later sealed
  `stale_request`, and never taken from a plaintext answer such as `/v1/instance/keys`, which the
  edge could write. If the difference is more than 5 minutes it also tells the rider —
  *"This phone's clock is off by about N minutes from your instance's. Sealed requests may fail
  until the date and time are set automatically."* (draft wording, approved in the build's pull
  request, D-14 Q6). A second
  `stale_request` on the re-signed request means the box's clock is moving, and the app says
  *"Your instance's clock looks wrong; ask its operator to check it."* The operator guide states the
  requirement for the box: its clock set by NTP, which the home deployment's host already does.
- **Ordering within a stream**: SSE events are sealed with consecutive sequence numbers under the
  one reply key D-2 derives for the stream, so a dropped, duplicated or reordered event fails to open, and the
  device treats that as a dropped stream. **Every stream ends with a sealed `end` event**, so a
  stream cut short by the edge is told apart from one that finished. **Resume** is a new sealed
  request naming the last event id the device opened, inside the ciphertext.
- **Errors**: a refusal before `Open` is a plaintext code and nothing else; every answer after it,
  refusals included, is sealed.
- **Padding**, *the author's choice*: each sealed plaintext is padded to the next power of two from
  256 bytes up to 64 KiB, then to a multiple of 64 KiB; a pasted key's request is padded to at least
  1 KiB, so its length does not name its provider. Each SSE event is padded to a multiple of 256
  bytes. The padding is inside the AEAD and its length is checked on opening.

### D-10 — What a lost device, a lost key and a compromised instance mean

| What is lost or taken | What it exposes | What is done |
|---|---|---|
| **A device** | Its pin is public. It holds no instance secret and no HPKE context beyond a request in flight (D-2), so **no past reply can be decrypted from it**. Whoever holds it unlocked can make sealed requests as that device, as they could make any request today | Revoke its key from another device (`identity.ts` §`revokeDevice`, #773), through the sealed, device-signed revoke route (D-7). Its signatures then fail D-8 on its next sealed request |
| **A key the edge added, or a recovery address it bound, before phase 1** | Through the bearer-only link and recovery-email routes as they are today (D-8's residue): a key that signs sealed requests as a genuine device key, and an address that recovers the account by mail | The sealed review (D-8), **per device**: new recovery codes and the address cleared by the first device to do it, and on **every** device the device list, with each key's added-at and last-used, and the rider asked to revoke what they do not recognise. From phase 1, **every account-security change made by a key other than the device's own** — codes replaced, an address bound or cleared, a link code minted, a key added by link or by recover, a key revoked — is shown on that device as a notice naming the key, until that device itself acknowledges it, so a key that takes the review first and then binds an address, mints a link code or links a second key is named on the rider's own screens. **Revoking a key** also replaces the codes, clears any address it bound, voids the link codes it minted, and shows the device list again with the keys added since its first sealed use marked. ⚠️ Such a key cannot be told from the rider's own cryptographically, so the rider's review and the notices are the only control. Until the rider revokes it, it can still revoke the rider's own keys first, a lock-out the app cannot undo for them |
| **The instance encryption key** (one private half leaks) | Every request sealed to that key **that somebody recorded**, and every reply derived from those requests (D-5's forward-secrecy note), for that key's life. ⚠️ **And, against an active edge, future requests too**: an edge holding the leaked key can withhold the successor's statement and keep serving the old key's last one, which verifies until its `notAfter`, so a device that has **not yet** seen the successor keeps sealing to the leaked key until then: **at most 48 hours after the rotation** (D-5), because the instance signs nothing for a superseded key | `operator instance-key rotate --drop-old`. A device that has seen the new statement never seals to the old key again (D-5's no-going-back rule), so against a **passive** observer devices follow at their next daily refresh, and against an edge that holds only the leaked key no device seals to it more than 48 hours after the rotation. An edge that also holds the identity key can sign statements of its own, which is the next row |
| **The instance identity key** | Nothing recorded. It lets whoever holds it sign an encryption key statement of their own — which every device accepts under its pin — or an endorsement of their own identity key, so the edge could intercept **future** sealed traffic | `rotate-identity --compromised`, and every device re-pins from a new card (D-6). ⚠️ **Honest limit: identity-key compromise plus an edge is a silent takeover of future sealed traffic until the rider is told out of band.** The operator's command changes nothing a device can observe, because the only channel to it is the one the attacker holds; a device learns to refuse only when the operator reaches the rider some other way and the rider scans a new card. Requiring the rider to confirm even a planned, endorsed re-pin against a new card (D-5, D-14 Q8) stops a stolen key's endorsement being followed silently; it cannot stop a stolen key's encryption statements |
| **The operator secret** | Both private keys, wrapped in any backup, and every model key at rest (ADR 0046 D-9) | A new operator secret, `instance-key reset`, every device re-pins, every model key re-entered. Stated in the operator guide |
| **The box itself** | **Everything**, as today: an instance decrypts what it receives to use it, holds the operator secret in its environment, and stores the masking data and job rows in clear (ADR 0046) | Nothing in this ADR protects against the operator or the box. **End-to-end means device-to-instance, not device-to-device** |

### D-11 — The honest limits: what Cloudflare still sees

Even with both phases shipped, the edge still sees:

- **That a rider is talking to this instance**: their IP address, when, how often, and for how
  long; the size of each sealed message to within its padding bucket (D-9); and the timing and
  count of each SSE event, which leaks roughly how many sections a write-up had and how long each
  took — though not any event's kind, which travels only inside its ciphertext (D-9).
- **Whether a sealed request had a session**: a sessionless envelope carries no `Authorization`
  header (D-9), so the edge can tell registering, linking, recovering and asking for a recovery
  mail — and, in phase 2, signing in and a suspended athlete's way-out — from every other sealed request, though not which of them.
- **The shape of each reply**: whether it is one answer or a `text/event-stream`, and how long the
  stream stays open. A job is the only sealed operation that streams, so **the edge can tell a job
  from a key, masking or sync request** by its response, though not which job or what it says.
  "All look alike" in D-9 is true of the request only.
- **The bearer session token**, in the `Authorization` header, **decided: it stays outside the
  ciphertext**, in every phase. Checking it before any Diffie–Hellman is what keeps an
  unauthenticated flood cheap (D-9), so it rides in the header of every `POST /v1/sealed` as well as
  of every plaintext route. ⚠️ **Phase 2 does not make it secret**: sealing the sign-in answer hides
  the token in that one reply, and the edge reads the same token in the next sealed request's header.
  What makes the edge's copy useless **on sealed routes** is D-8's signature, and what phase 2 ends
  is its usefulness, not its visibility. ⚠️ **On the routes still
  plaintext it is a full credential, and its real size is this**: until phase 2 the edge can call
  them as the rider, at any time and not only while it watches — read the account summary and the
  device list, change the display name, confirm adulthood, take the suspended athlete's way-out
  session, block and report other riders, sign the session out, and mint room tickets, so join a
  room and ride in it as the rider. ⚠️ **It would have been much larger**: had the sync routes been
  left plaintext, the token would have let the edge read the rider's **whole stored history** (not
  only what passed while it watched), **write** to it (push items, ingest rides) and **delete** from
  it (tombstones); and had the link and recovery routes been left bearer-only, it would have let the
  edge **add a device of its own** (D-7, D-8); and had the moderator routes been left plaintext, a
  moderator's token would have let the edge **suspend any rider** (ending their sessions and
  refusing their keys), lift a suspension, hide display names, approve or refuse registrations —
  its own included — dismiss reports, and read the report queue, the registrations awaiting
  approval, the suspended list and the moderation log (D-7). Phase 1 seals all of those for that
  reason. Phase 2 closes the rest.
- **Every plaintext route's whole content** until phase 2: the sign-in answer for an existing key
  (and so the session token itself, which it would read in the next request's header anyway), the
  account summary, the device list, the display name, and a rider's own blocks and reports.
- **Nothing about a web build whose JavaScript reaches the rider through an edge that also sees this
  traffic** is protected at all, because that edge could serve different code (Context) — and that
  is true whether the build is served by the instance through the tunnel, by Cloudflare Pages, or by
  any proxy on the same zone. **The app cannot check which edges its own code passed through**, so
  the rule is decided by where the build was loaded from, which it can read: **sealed features are
  offered only in the Android app and in a web build loaded from a loopback address or from a file
  the rider installed**; a web build loaded over `https:` from any host — the instance's own origin
  or any other — shows the phase 1 features as unavailable with a sentence, rather than offering an
  encryption an edge could remove. Today no instance serves the web client, so this is a rule for
  the day one does, and for any hosted web build.

### D-12 — Camera pictures are not admitted to the tunnel by this ADR

[ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6 rejects the Cloudflare Tunnel for a picture
by name, and says it is reversible only by a superseding ADR arguing *"that the operator cannot read
the payload"*. A sealed picture would make that argument for the payload. **This ADR does not make
it**, because the owner ruled on 2026-10-07 (ADR 0046 D-14(d), Q3) that *"Pictures travel only over
the home network or a WireGuard-class overlay, never through the Cloudflare tunnel (ADR 0029
D-6)"*, and because a picture's size and timing are themselves revealing in a way D-11's padding
does not answer. ADR 0029 D-6 stands, and **the owner ruled it stays** (D-14 Q4: *"camera pictures
stay off the tunnel, even sealed"*).

### D-13 — The home-network rule for a pasted key is lifted once phase 1 ships, on one condition

ADR 0046 D-9's *"Until #1179 ships, the instance accepts a pasted key … only from a request on the
home network, or through the operator command"* is the owner's ruling, so lifting it was the
owner's, and **the owner ruled on 2026-10-08** (D-14 Q2): *"once phase 1 ships, a pasted key may
come from anywhere, sealed. Until then it is accepted only from the home network."* The condition
this ADR puts on "sealed" is:

> **A pasted key may be accepted through the tunnel only in a sealed request (D-9) carrying a valid
> device signature (D-8), from a device whose pin came from a card (D-6).** Since the owner ruled
> that a device pins only from a card (D-14 Q1), there is no other kind of pin.

and the plaintext key route is **removed**, not kept beside the sealed one, so the home-network
placement code (#1097) has nothing left to guard for keys once phase 1 ships, and #1179 removes
that check from the key route in the same change. The operator command stays.

⚠️ **Before phase 1 ships**, #1097's plaintext home-network route is the owner's ruling and is
untouched by this ADR. **From the day phase 1 ships**, D-7's rule applies — no plaintext key route
survives, on the home network or anywhere else — and the key is accepted sealed from anywhere.

### D-14 — The owner's questions, answered

This ADR asked the owner eight questions, each with a recommended answer. **The owner answered all
eight on 2026-10-08**, in a comment on this ADR's pull request
([#1183, comment 6058845719](https://github.com/openzigs/onyourleft/pull/1183#issuecomment-6058845719)),
quoted verbatim:

> **Owner rulings, 2026-10-08, on ADR 0047's questions (D-14):**
> - **Q7 (sync waits):** yes. Sync, ride uploads included, waits for #1179 and ships sealed only; #777 waits with it.
> - **Q1:** no pinning on first use. A device pins only from an instance card.
> - **Q2:** once phase 1 ships, a pasted key may come from anywhere, sealed. Until then it is accepted only from the home network.
> - **Q3:** the encryption key rotates every 30 days, the old one is kept 7 days, and statements are re-signed daily with a 48-hour lifetime.
> - **Q4:** camera pictures stay off the tunnel, even sealed. ADR 0029 D-6 stands.
> - **Q5:** the race-room sockets are not sealed. Their HTTP routes are, in phase 2.
> - **Q6:** the owner approves the rider-facing wording in the build's pull request.
> - **Q8:** a planned identity-key rotation needs a new instance card, not an automatic re-pin.

Every ruling is the answer this ADR recommended, so no decision above changes; each is marked
*ruled* where it is made. The questions are kept below as they were asked, with the ruling after
each, so the reasoning the owner ruled on stays readable. **Status stays Proposed**: the owner
approves the ADR as a whole separately.

1. **May a device with no card pin the instance's key on first use?** It would let a rider who
   typed only an address use the phase 1 features — and **register** through the tunnel, which
   phase 1 seals (D-7) — at the cost that an edge which substituted a key at that moment reads
   everything that device ever seals, its recovery codes included. **Recommended: no. Ruled: no** (*"A device pins only from an instance card"*). A rider
   without a card gets one from the operator, from a linked device's screen, or in an invite (D-6),
   and the app says so. On an instance with open registration that means the operator publishes the
   card somewhere of their own; and an invite's card is only as trustworthy as the channel the
   invite travelled through (D-6), which is the same trade one step removed.
2. **Once phase 1 ships, does D-13's condition lift ADR 0046 D-9's home-network-only rule for a
   pasted key?** **Recommended: yes, on D-13's condition exactly. Ruled: yes** (*"once phase 1 ships, a pasted
   key may come from anywhere, sealed. Until then it is accepted only from the home network"*).
   No plaintext key route survives phase 1, on the home network or anywhere else, because D-7 keeps
   no plaintext twin (D-13).
3. **Are a 30-day encryption key, kept 7 days after its successor, and 48-hour statements re-signed
   daily acceptable?** The key's life (about 37 days) bounds what a leaked key exposes of recorded
   traffic (D-5's forward-secrecy note); the statement's 48 hours bound how long an edge holding a
   leaked key, and not the identity key, can keep an unrefreshed device sealing to it after a
   rotation (D-10). Shorter statements cost a signature more often and a device that has been
   offline a re-read before it seals; one statement for the key's whole life, the alternative
   D-5 rejects, would let that edge hold a device for up to 37 days. **Recommended and ruled: 30 days, 7
   days and 48 hours, re-signed daily.**
4. **Should a later ADR admit sealed camera pictures through the tunnel?** **Recommended: no, not
   now. Ruled: no** (*"camera pictures stay off the tunnel, even sealed"*). ADR 0029 D-6 and the Q3 ruling stand; a picture's size and timing leak more than text's,
   and the home network or an overlay already serve the case.
5. **Do room sockets (#782) need sealing?** They carry power and never a position, and a race is
   shared with other riders anyway. **Recommended and ruled: no**, recorded as out of scope (D-7), and
   revisited if a room ever carries anything personal. The rooms' HTTP routes, whose ticket a token
   can mint (D-11), are phase 2.
6. **The rider-facing sentences**: the mismatch refusal (D-6), the "this needs the instance's card"
   notice, the "confirm the new card" notice of a planned rotation (D-5), the expired-key,
   older-key and clock refusals (D-5, D-9), the per-device account review that replaces the
   recovery codes, clears the recovery address and asks the rider to revoke keys they do not
   recognise, and the account-change notices ("this key replaced your codes", "bound an address",
   "minted a link code", "a new key was added to your account") on every other device (D-8), the mail's "type this code into the app" text (D-8),
   and the web-build notice (D-11) are **draft wording** for the owner to
   approve, in #1179's build, as `apps/web`'s other new text is (#880's convention).
   **Recommended and ruled: approved in the build's pull request**, not here, where they would be read
   without the screens they sit on.
7. **Does sync — ride uploads with their original files included — wait for #1179 and ship sealed
   only, rather than shipping plaintext first with its sealing deferred to phase 2?** A ride's
   original file usually starts and ends at the rider's home, so a plaintext upload discloses the
   privacy-zone centre the fourth ruling says never crosses the edge readable, and `write-up` and
   `side-camera-report` items carry job text and the pose summary (D-7). **Recommended and ruled: yes, sealed
   only, from the day it is wired** — which this ADR already decides (D-7), and which costs no
   migration because `instance.ts` hands the handler no sync today. The cost the owner is asked to
   accept is that sync (#777's client half included) cannot ship before #1179, and the owner
   accepted it (*"#777 waits with it"*).
8. **Should a planned identity rotation re-pin a device on the old key's endorsement alone, without
   the rider?** Automatic re-pinning makes a planned rotation invisible to riders, but a stolen
   identity key can endorse the attacker's key, the edge serves that endorsement, and every device
   follows, so `--compromised` cannot reach them (D-10). **Recommended and ruled: no — an endorsed re-pin
   needs the rider to confirm it against a new card** (D-5, D-6), with the endorsement telling the
   app which fingerprint to expect. Identity rotation is rare, so the cost is one card per device on
   a rare day. It does not cure an identity key stolen *without* a rotation, whose own encryption
   statements a device accepts; D-10 states that limit.

---

## Consequences

### What this enables

- **ADR 0046's analysis can ship**: #1101's masking sync and #1095's job stream are unblocked by
  phase 1, and a pasted key can be set from the app away from home, sealed, once phase 1 ships
  (the owner's Q2 ruling).
- **Cloudflare sees ciphertext for the payloads the owner named**, for every route that adds,
  recovers or removes a device key, for every moderator route, and for the synced history; and, once phase 2 ships, for every
  route that carries an athlete's data.
- **The instance can be moved behind any proxy** without the proxy being trusted with content.

### What this costs, stated plainly

- **Hand-assembled HPKE.** About two hundred lines of key schedule and framing in `packages/domain`
  that must never be wrong. The RFC's vectors and the mutations of D-3 are the defence; a review that
  finds a defect they missed moves the program to `@hpke/core` (D-3).
- **The instance now holds private keys**, and the operator secret now protects them as well as the
  model keys. Losing that secret means every device re-pins (D-5).
- **A card is a new step.** The first device needs the operator command; every other device gets it
  from a screen. A rider who only ever typed an address cannot use the phase 1 features, or
  register through the tunnel, until they have one (D-6, Q1). A planned identity rotation asks
  every rider for a new card (D-5, Q8).
- **An account that predates phase 1 needs a review on each of its devices** (D-8), because what an
  edge did with a token before then is not undone by sealing, and a key it added cannot be told
  from the rider's own by any check.
- **Every account-security change is logged and shown on every other device** (D-8): codes
  replaced, an address bound or cleared, a link code minted, a key added or revoked, each naming the
  key that made it and shown until that device acknowledges it. That is a new table, a per-device
  acknowledgement, and a notice a rider sees after every change made from another of their own
  devices, which is the price of naming the ones they did not make. Revoking a key now also replaces
  the recovery codes, so a rider revoking a lost phone gets new codes too.
- **Phones and the box need a correct clock** (D-9): a clock more than 2 minutes off fails every
  sealed request until the device re-signs with the instance's time, and the app says which clock
  is wrong.
- **Sync waits for #1179** (D-7, Q7), and linking, recovery and device revocation change shape:
  each becomes sealed and device-signed, which #773's and #772's existing tests must follow.
- **One Ed25519 signature and one X25519 per sealed request** on the device, and one X25519 and one
  verification per sealed request on the instance, plus a durable ten-minute replay record (one
  SQLite insert a request). Small against a model call; stated rather than measured, and #1179
  measures it.
- **No forward secrecy against the instance's encryption key** in `base` mode, bounded by rotation
  and deletion to about 37 days (D-5); against an active edge holding a leaked encryption key, an
  unrefreshed device can be held on it for up to 48 hours after the rotation (D-10). The instance
  signs one statement a day to keep that bound (D-5).
- **A stolen identity key plus the edge is a silent takeover of future sealed traffic until the
  rider is told out of band** (D-10).
- **Metadata remains** (D-11): who, when, how much, which replies are jobs, and the bearer token,
  which on the routes phase 2 has not yet sealed is still a credential.
- **A web build loaded over `https:` from any host gets none of this** (D-11).

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#1179](https://github.com/openzigs/onyourleft/issues/1179) | Builds phase 1: the `packages/domain` HPKE module and its port, both WebCrypto implementations, D-3's vector gate and mutations, the key table and its migration, the operator `instance-key` commands, the daily re-signing of 48-hour statements and the rotation `operator restore` ends with (D-5), `/v1/instance/keys`, `/v1/sealed` and the route mark, the sealed-only mark on every route D-7's table names (the identity routes, every `/v1/moderation/*` route, the sync routes and history search included), the sessionless rule of D-8 and D-9 and its dispatch to the named routes only, the outer body limit of D-9, the pin and the card in the app, the durable replay record, the per-device sealed account review with each key's last-used time, the account-change log with its per-device acknowledgement and its notices on every other device, and the revoke that also replaces the codes, clears the revoked key's address and voids its link codes (D-8), the unsigned `issuedAt` in `recover/email` and the `stale_request` refusal (D-8, D-9), the start-time re-sign or rotation, the key `serial` and the device's 48-hour cap from its own first verification (D-5), the device's kept clock offset (D-9), the sessionless dispatch of `leave-session` in phase 2 (D-9), the mail rule — a typed code only, never a link — in the two route summaries and `docs/operating-an-instance.md` (D-8), and the rewrite of `auth/crypto.ts`'s header. Files phase 2 as its own issue |
| #1097 | The operator secret it builds also wraps the instance's keys (D-5); its in-app key route is sealed-only (D-7, D-13) |
| #1095 | Its routes and SSE stream are sealed-only, with D-9's sequence, `end` event and resume |
| #1101 | Its push and pull are sealed-only; the account export becomes sealed in the same change (D-7) |
| #772, #773 | Registration, link-code minting, linking, recovery, recovery-email and device revocation are sealed and device-signed (D-7, D-8); the link code screen carries the card (D-6); a recovery or confirmation mail carries a typed code and no link of any kind (D-8) |
| #83 (moderation) | Every `/v1/moderation/*` route is sealed-only and signed by the moderator's device key (D-7); the rider's own blocks and reports are phase 2 |
| #776, #881, #37, #38, #777 | Phase 1: every sync route is sealed-only from the day `instance.ts` hands the handler a sync, so sync is never served in plaintext (D-7, Q7) |
| #835 | `POST /v1/history/search` is sealed-only (D-7) |
| `apps/web/src/privacy/no-network.test.ts` | Unchanged: sealing goes through `instance-transport.ts`, the one module, and adds no network call |
