# ADR 0047: End-to-end encryption between the app and its instance

- **Status**: **Proposed**, 2026-10-08. It decides the scheme the owner asked for on 2026-10-07 and
  asks the owner six questions (§"Open questions for the owner"), each with a recommended answer.
  Nothing is built by this ADR, and nothing it decides binds work until the owner accepts it.
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
an answer to a request the device made. So **a reply is sealed under a key and base nonce exported
from that request's HPKE context**, RFC 9180 §9.8:

```
response_key   = Context.Export("oyl response key v1",   16)
response_nonce = Context.Export("oyl response nonce v1", 12)
```

and AES-128-GCM with `nonce = response_nonce XOR I2OSP(seq, 12)`, `seq` counting from 0 per reply
message, exactly as RFC 9180's own `ComputeNonce`. Only the holder of the request's ephemeral
private key — the device, for the life of that one request — can derive them.

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
5. **Mutation-verified** under `CLAUDE.md` §5: at minimum, dropping the `"HPKE-v1"` label, swapping
   the Extract salt and IKM, skipping the XOR of the sequence number, and reusing `base_nonce` for a
   reply must each turn a vector red.

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
    "keyId": "<16 hex>", "encryptionKey": "<64 hex>",
    "notBefore": 1790000000, "notAfter": 1792592000 }
  ```

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

- **So a backup carries the keys, as ciphertext**: `operator backup`'s `VACUUM INTO` copies the
  table, and `operator restore` brings them back, so **a restored instance keeps every device's
  pin**. A separate key file was rejected because #791's backup copies the database and the blobs
  and nothing else: the file would either be missed (a restore breaks every pin) or need a third
  backup path to keep in step.
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

**Rotating the encryption key** (*the author's choice* of the numbers):

- **Automatically every 30 days**: a new X25519 key and statement (`notAfter` 30 days on), made by
  the HTTP process, the one writer (ADR 0037 D-5). Devices re-read `/v1/instance/keys` at sign-in
  and at least daily, and seal to the newest statement that verifies.
- **The old key is kept for decryption for 7 days after its successor exists** (the overlap), so a
  device that has not refreshed still works, then its private half is **deleted** — not marked,
  deleted, and gone from the next backup. A request sealed to a key outside its overlap is refused
  `instance_key_unknown` (D-9); the device re-reads the statements and re-seals.
- **On demand**: `operator instance-key rotate`, and `operator instance-key rotate --drop-old`,
  which deletes the old private half at once — the answer to a suspected leak of the encryption key
  (D-10).
- ⚠️ **Why deletion matters**: `base` mode has no forward secrecy against the recipient's key. Anyone
  who recorded ciphertext and later obtains an encryption private key reads every request sealed to
  it and every reply exported from those requests (D-2). Deleting old keys on schedule bounds that
  window to about 37 days of traffic.

**Rotating the identity key** is rare and has two forms:

- **Planned**: `operator instance-key rotate-identity` makes a new identity key and an
  **endorsement** — the new identity's public key and fingerprint signed by the **old** identity
  key, purpose `oyl-instance-identity-rotation-v1`. A device that pinned the old key verifies the
  endorsement, re-pins to the new one, and tells the rider in one sentence that the instance's key
  changed and was vouched for by the one it trusted. The old identity key's private half is deleted
  once the endorsement is made.
- **Compromised**: `operator instance-key rotate-identity --compromised` makes **no** endorsement,
  because a stolen old key could endorse anybody. Every device must re-pin out of band (D-6), and
  refuses sealed traffic until it does.

### D-6 — How a device pins the instance's identity key

**A pin is the instance identity key's fingerprint, stored on the device beside the instance
account** (`apps/web/src/instance/sign-in.ts` §`InstanceAccount`, which gains it), and never
replaced silently. **It is taken from a source Cloudflare cannot write**, because the app cannot
tell whether its own request went through the edge (Context): *the author's choice*, and the reason
#1179's *"ideally on the home network"* is met by an **out-of-band card** rather than by the
network.

**The instance card** is the string `oyl-instance:<origin>#<fingerprint, base32>`, shown as text and
as a QR code. It carries nothing secret. It reaches a device from one of three places:

1. **The operator command** `operator instance-key show`, on the box — how the **first** device
   pins (#772's first sign-in, which is the operator's own in every real deployment).
2. **A device that has already pinned**, inside the **link code screen** (#773): the code and the
   card together, one QR. The new device pins what the old device's **screen** shows, which is
   exactly the property #1179 asks of linking — a card the edge never touched.
3. **An invite** (`identity.ts` §`mintInvite`), minted on a moderator's device that has pinned,
   carries the card the same way, so an invited rider pins at registration.

**What a device does with it:**

- **On first sign-in or link**, the device reads `/v1/instance/keys`, verifies each statement's
  signature under the identity key **in the card**, and pins only if the fingerprint of the key
  that signed matches the card. A mismatch is a **loud refusal** in the app's words — *"This
  instance's key is not the one on the card you were given. Nothing was sent."* — and nothing sealed
  is sent. Draft wording, for the owner (D-14 Q6).
- **A device with no card** — a rider who typed only an address — may sign in exactly as today
  (#772 is unchanged), and **holds no pin**. With no pin, **no sealed route is used**: the app
  says that the features that need it (D-7, phase 1) need the instance's card, and where to get it.
  Whether such a device may instead pin on first use is the owner's (D-14 Q1); this ADR's answer
  is **no**.
- **On every later use**, a statement that does not verify under the pinned key, or a
  `/v1/instance/keys` whose identity differs, is refused loudly and **never re-pinned**. The only
  ways a pin changes are a verified endorsement (D-5, planned rotation), or the rider scanning a new
  card, which the app treats as a deliberate act: it shows the old and new fingerprints and asks.
- **A recovered device** (#773's recovery code, every device lost) has no device to show it a card,
  so it pins from the operator or from an invite-style card the operator sends. The recovery code
  itself carries no fingerprint, because it was shown at registration and may be years old.

### D-7 — What is sealed, in two phases

**Phase 1, which #1179 ships, and without which #1095, #1097's in-app key, and #1101 do not ship**
(the owner's rulings):

| Payload | Route (inner, D-9) | Direction sealed |
|---|---|---|
| A pasted API key, a rider's own or the shared one set from the app (ADR 0046 D-9) | the key routes #1097 adds | request; the key is never sent back |
| The synced privacy zones and words-to-mask list (ADR 0046 D-10, #1101) | push and pull | both |
| Each analysis job's input, every SSE event's text, the result, resume and cancel (ADR 0046 D-6, D-11, D-12, #1095) | every job route | both |
| The rider's recorded hosted consent and the endpoint it names (ADR 0046 D-9, Q10) | the consent routes | both |
| **The account export** (#35), because from #1101 on it carries the masking data (ADR 0046 D-10) | `/v1/account/export` | reply |

and the rule that makes the table hold: **a payload in phase 1 has no plaintext route at all.** No
plaintext twin is kept "for old clients", because Cloudflare holds the bearer token (D-11) and could
call one.

**Phase 2, the sync payloads**: the sync manifest, items, tombstones and ride uploads with their
original files (#37, #38, #776, #881), the device list, display names and the sign-in response that
carries the session token. When phase 2 is done, **every route that reaches an athlete's own data is
sealed**, and the plaintext routes left are the ones that carry nothing personal: `/health`,
`/ready`, `/source`, `/openapi.json`, `/licences/third-party.txt`, `/instance`,
`/v1/instance/keys` and the sign-in challenge. Phase 2 is its own issue, filed by #1179, and is
not a condition of phase 1.

**Out of scope, named so nobody assumes otherwise**: room sockets (#782), whose reports carry power
and never a position (`packages/protocol`), and `/metrics`, which is the operator's and carries no
athlete data. A room is the owner's to rule on separately (D-14 Q5).

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

*The author's choice*, over two alternatives:

- **A second, "sealed" session token issued only inside a ciphertext** — rejected: it is a second
  secret with its own lifecycle, revocation and storage, and until phase 2 ends the sign-in that
  would issue it is itself plaintext.
- **The bearer token moved inside the ciphertext** — rejected for phase 1, because plaintext routes
  still send it in a header (D-11), so the edge still has it; and the instance wants the session
  checked **before** it does a Diffie–Hellman for the request (D-9).

### D-9 — The wire: one sealed endpoint, the AAD, replay and ordering

- **One endpoint**, `POST /v1/sealed`, *the author's choice*. The **inner method and path are inside
  the ciphertext**, so the edge cannot see which operation a rider performed — setting a key,
  syncing a word list or starting a job all look alike. The instance dispatches the opened request
  through the **same route table** (`apps/instance/src/routes.ts`), where a sealed-only route is
  marked so and unreachable any other way; `openapi.json` (#36) documents those routes with that
  mark.
- **The envelope** is JSON, `{ "v": 1, "keyId": "…", "enc": "<base64url>", "ct": "<base64url>" }`,
  so the existing body-size limits and JSON parsing apply before any cryptography.
- **The order of checks on the instance**: the bearer session (a hash and a lookup, as today) and
  the rate limits **first**, so an unauthenticated flood costs no X25519; then `keyId` (unknown or
  outside its overlap → plaintext `instance_key_unknown`, carrying nothing else); then `Open`; then
  the device signature (D-8); then freshness and replay; then the inner route.
- **HPKE `info`** is `"oyl-sealed-v1"`. **The AAD of the request** is the RFC 8785 bytes of
  `{ "purpose": "oyl-sealed-aad-v1", "direction": "request", "instanceOrigin", "keyId",
  "tokenSha256" }`, where `tokenSha256` is the SHA-256 the instance already stores for the session.
  So a ciphertext moved to another session, another instance or another key does not open. **The
  AAD of each reply message** is the same with `"direction": "response"`, the request's `enc`, and,
  for a stream, the event's id and kind.
- **Replay**: the signed `issuedAt` must be within **120 s** of the instance's clock, and the
  SHA-256 of `enc` is recorded, per instance, for **10 minutes**; a second request with the same
  `enc` is refused `replayed` without running anything. An X25519 ephemeral public key is fresh per
  request, so a repeat is a replay and nothing else. (*The author's choice* of both windows: twice
  the challenge's 60 s, and five times the skew.) A replayed request could not be read by whoever
  replays it anyway — the reply is sealed to the original ephemeral key (D-2) — but it could have
  side effects, such as starting a second paid job; the record stops those.
- **Ordering within a stream**: SSE events are sealed with consecutive sequence numbers from the
  request's exported key (D-2), so a dropped, duplicated or reordered event fails to open, and the
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
| **A device** | Its pin is public. It holds no instance secret and no HPKE context beyond a request in flight (D-2), so **no past reply can be decrypted from it**. Whoever holds it unlocked can make sealed requests as that device, as they could make any request today | Revoke its key (`identity.ts` §`revokeDevice`, #773). Its signatures then fail D-8 on its next sealed request. Nothing new to build |
| **The instance encryption key** (one private half leaks) | Every request sealed to that key **that somebody recorded**, and every reply exported from those requests (D-5's forward-secrecy note), for that key's life | `operator instance-key rotate --drop-old`. Devices follow the new statement automatically, because the identity key is untouched |
| **The instance identity key** | Nothing recorded. It lets whoever holds it sign an encryption key of their own, so the edge could intercept **future** sealed traffic | `rotate-identity --compromised`; every device re-pins from a card (D-6) and refuses sealed traffic until it does |
| **The operator secret** | Both private keys, wrapped in any backup, and every model key at rest (ADR 0046 D-9) | A new operator secret, `instance-key reset`, every device re-pins, every model key re-entered. Stated in the operator guide |
| **The box itself** | **Everything**, as today: an instance decrypts what it receives to use it, holds the operator secret in its environment, and stores the masking data and job rows in clear (ADR 0046) | Nothing in this ADR protects against the operator or the box. **End-to-end means device-to-instance, not device-to-device** |

### D-11 — The honest limits: what Cloudflare still sees

Even with both phases shipped, the edge still sees:

- **That a rider is talking to this instance**: their IP address, when, how often, and for how
  long; the size of each sealed message to within its padding bucket (D-9); and the timing of each
  SSE event, which leaks roughly how many sections a write-up had and how long each took.
- **The bearer session token**, in the `Authorization` header, **decided: it stays outside the
  ciphertext**. Checking it before any Diffie–Hellman is what keeps an unauthenticated flood cheap
  (D-9), and while phase 1's plaintext routes exist it travels in their headers regardless. What
  makes the edge's copy useless **on sealed routes** is D-8's signature. ⚠️ **On plaintext routes it
  is not useless**: until phase 2 ships, the edge could use a token it saw to call the sync routes
  as the rider — which carry only what the edge can already read in transit on those same routes.
  Phase 2 closes that.
- **Every plaintext route's whole content** until phase 2: the sync payloads, the sign-in response
  (and so the session token itself), and the device list.
- **Nothing about a web build served through the tunnel** is protected at all, because the edge
  could serve different code (Context). So: **the web client fetches `/v1/instance/keys` and seals
  only when it was not itself loaded from the instance's own origin**; a web build served by the
  instance through the tunnel shows the phase 1 features as unavailable with a sentence, rather than
  offering an encryption that the edge could remove. Today no instance serves the web client, so
  this is a rule for the day one does.

### D-12 — Camera pictures are not admitted to the tunnel by this ADR

[ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6 rejects the Cloudflare Tunnel for a picture
by name, and says it is reversible only by a superseding ADR arguing *"that the operator cannot read
the payload"*. A sealed picture would make that argument for the payload. **This ADR does not make
it**, because the owner ruled on 2026-10-07 (ADR 0046 D-14(d), Q3) that *"Pictures travel only over
the home network or a WireGuard-class overlay, never through the Cloudflare tunnel (ADR 0029
D-6)"*, and because a picture's size and timing are themselves revealing in a way D-11's padding
does not answer. ADR 0029 D-6 stands. Whether it should change is D-14 Q4.

### D-13 — The home-network rule for a pasted key can be lifted once phase 1 ships, on one condition

ADR 0046 D-9's *"Until #1179 ships, the instance accepts a pasted key … only from a request on the
home network, or through the operator command"* is the owner's ruling, so **lifting it is the
owner's** (D-14 Q2). This ADR proposes the condition under which it can be:

> **A pasted key may be accepted through the tunnel only in a sealed request (D-9) carrying a valid
> device signature (D-8), from a device whose pin came from a card or an endorsement (D-6), never
> from a pin taken on first use.**

and the plaintext key route is **removed**, not kept beside the sealed one, so the home-network
placement code (#1097) has nothing left to guard for keys. The operator command stays.

### D-14 — Open questions for the owner

Each has a recommended answer. Nothing in #1179's build that depends on one is merged before it is
answered.

1. **May a device with no card pin the instance's key on first use?** It would let a rider who
   typed only an address use the phase 1 features, at the cost that an edge which substituted a
   key at that moment reads everything that device ever seals. **Recommended: no.** A rider without
   a card gets one from the operator or from a linked device's screen (D-6), and the app says so.
2. **Once phase 1 ships, does D-13's condition lift ADR 0046 D-9's home-network-only rule for a
   pasted key?** **Recommended: yes, on D-13's condition exactly**, with the plaintext key route
   removed. Until the owner says so, the home-network rule stands beside sealing, which costs
   nothing but convenience.
3. **Is the encryption key's rotation of 30 days, with a 7-day overlap, acceptable?** Shorter bounds
   what a leaked key exposes; longer means fewer statements to fetch. **Recommended: 30 and 7.**
4. **Should a later ADR admit sealed camera pictures through the tunnel?** **Recommended: no, not
   now.** ADR 0029 D-6 and the Q3 ruling stand; a picture's size and timing leak more than text's,
   and the home network or an overlay already serve the case.
5. **Do room sockets (#782) need sealing?** They carry power and never a position, and a race is
   shared with other riders anyway. **Recommended: no**, recorded as out of scope (D-7), and
   revisited if a room ever carries anything personal.
6. **The rider-facing sentences**: the mismatch refusal (D-6), the "this needs the instance's card"
   notice, the planned-rotation notice, and the web-build notice (D-11) are **draft wording** for
   the owner to approve, in #1179's build, as `apps/web`'s other new text is (#880's convention).
   **Recommended: approve them in the build's pull request**, not here, where they would be read
   without the screens they sit on.

---

## Consequences

### What this enables

- **ADR 0046's analysis can ship**: #1101's masking sync and #1095's job stream are unblocked by
  phase 1, and a pasted key can be set from the app away from home once the owner answers Q2.
- **Cloudflare sees ciphertext for the payloads the owner named**, and, once phase 2 ships, for
  every route that carries an athlete's data.
- **The instance can be moved behind any proxy** without the proxy being trusted with content.

### What this costs, stated plainly

- **Hand-assembled HPKE.** About two hundred lines of key schedule and framing in `packages/domain`
  that must never be wrong. The RFC's vectors and the mutations of D-3 are the defence; a review that
  finds a defect they missed moves the program to `@hpke/core` (D-3).
- **The instance now holds private keys**, and the operator secret now protects them as well as the
  model keys. Losing that secret means every device re-pins (D-5).
- **A card is a new step.** The first device needs the operator command; every other device gets it
  from a screen. A rider who only ever typed an address cannot use the phase 1 features until they
  have one (D-6, Q1).
- **One Ed25519 signature and one X25519 per sealed request** on the device, and one X25519 and one
  verification per sealed request on the instance, plus a ten-minute replay record. Small against a
  model call; stated rather than measured, and #1179 measures it.
- **No forward secrecy against the instance's encryption key** in `base` mode, bounded by rotation
  and deletion to about 37 days (D-5).
- **Metadata remains** (D-11): who, when, how much, and the bearer token.
- **A web build served through the tunnel gets none of this** (D-11).

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| [#1179](https://github.com/openzigs/onyourleft/issues/1179) | Builds phase 1: the `packages/domain` HPKE module and its port, both WebCrypto implementations, D-3's vector gate and mutations, the key table and its migration, the operator `instance-key` commands, `/v1/instance/keys`, `/v1/sealed` and the route mark, the pin and the card in the app, the replay record, and the rewrite of `auth/crypto.ts`'s header. Files phase 2 as its own issue |
| #1097 | The operator secret it builds also wraps the instance's keys (D-5); its in-app key route is sealed-only (D-7, D-13) |
| #1095 | Its routes and SSE stream are sealed-only, with D-9's sequence, `end` event and resume |
| #1101 | Its push and pull are sealed-only; the account export becomes sealed in the same change (D-7) |
| #773 | The link code screen carries the card (D-6) |
| #776, #881, #37, #38 | Phase 2: sealed when that issue ships, with no plaintext twin left behind |
| `apps/web/src/privacy/no-network.test.ts` | Unchanged: sealing goes through `instance-transport.ts`, the one module, and adds no network call |
