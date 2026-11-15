# ADR 0069: The instance's own admin pages — a browser sign-in for the owner and a TLS-only admin channel

- **Status**: **Proposed**, 2026-11-15. It decides what the owner's rulings of 2026-11-15 leave open
  and records those rulings. It becomes **Accepted** only when the owner approves it, in words, on
  its pull request; until then every other sub-issue of the epic
  [#2639](https://github.com/openzigs/onyourleft/issues/2639) stays blocked. Nothing is built by this
  ADR
- **Date**: 2026-11-15
- **Deciders**: **the owner**, whose rulings of 2026-11-15 (quoted in Context) chose the admin pages,
  the passkey sign-in, the TLS-only channel and its two exclusions, the relicensing of Operate's
  wording, and approvals on the Accounts page. The author decided what those rulings leave open, and
  each such choice is marked *the author's choice* where it is made. D-11 lists the three the author
  asks the owner to confirm or overrule
- **Issue**: [#2640](https://github.com/openzigs/onyourleft/issues/2640), sub-issue 1 of the epic
  [#2639](https://github.com/openzigs/onyourleft/issues/2639) under
  [#17](https://github.com/openzigs/onyourleft/issues/17)
- **Number**: **0069**. On 2026-11-15 `docs/adr/` holds no file numbered 0069,
  `docs/agents/conventions.md` §7 gives 0069 as the next free number, and no open pull request names
  it; #2640 claims it by its title
- **Supersedes, in part** (D-10 lists each with what stays): the owner's ruling of 2026-11-14 on
  [#2601](https://github.com/openzigs/onyourleft/issues/2601), its *"not a separate server web page
  … the instance gains no new login surface"*; [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md)
  D-7's Operate row (its amendment of 2026-11-14); ADR 0047 D-7's two phase-1 moderator rows, for
  the registration queue and its two decisions only; ADR 0047 D-8, for the routes D-2 below admits
  only; and ADR 0047 D-11's sentence that phase 1 seals the moderator actions, for the same three
  routes. It is a new ADR and not an amendment because each of these reverses a decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0047 gains one
  dated `## Amendments` entry pointing here; no ADR's body is edited
- **Leaves standing** (D-10): [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3's four
  invariants; [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) D-9
  Q9 (the operator is the athlete holding `OYL_INSTANCE_OWNER_KEY`; the deputy is not the operator);
  ADR 0047 D-6 (a pin is taken only from a source Cloudflare cannot write), D-11's rule that no web
  build loaded over `https:` is offered a sealed feature, and D-13 (a pasted key is accepted only
  sealed); [ADR 0004](0004-privacy-and-location.md) D (no coordinate in a message); the app's Operate
  area and every 2026-11-14 ruling on #2601 but the one above
- **Relates to**: [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-2 (the portable
  core), D-8 (the tunnel) and D-9 (the dependency table); ADR 0047 D-3 (primitives, not a library)

---

## Context

### What the owner ruled, quoted so it is not argued again

On 2026-11-14, on [#2601](https://github.com/openzigs/onyourleft/issues/2601), the owner placed the
admin surface in the app:

> *"It is to be an owner-only section of the app, not a separate server web page. It reuses the
> app's device-key sign-in and the sealed, end-to-end encrypted channel to the instance (ADR 0047),
> so the instance gains no new login surface."*

and ADR 0047's amendment of that day made every `/v1/operate/*` route `sealed: 'only'`, *"the
owner's admin surface, reached through the tunnel"*, answering `unavailable` with no
`OYL_INSTANCE_SECRET_KEY` *"rather than offering an admin surface unsealed"*.

On 2026-11-15 the owner partly reversed that
([#2601, comment 6896705595](https://github.com/openzigs/onyourleft/issues/2601#issuecomment-6896705595)):

> *"the instance should also serve admin screens of its own, for an operator who wants to manage the
> server without the app. They cover the same ground as Operate: status, accounts, backups, the AI
> backend, rooms, keys and logs. They are built on the same owner-only routes. They are reachable
> through the tunnel as well as on the server machine, behind the existing home-IP firewall rule,
> with a browser sign-in for the owner (a passkey or a one-time code). This partly reverses the
> 2026-11-14 choice […]. It therefore needs a new ADR before any build"*

and answered the epic's open questions the same day
([#2639](https://github.com/openzigs/onyourleft/issues/2639)):

> *"1. Sign-in: a WebAuthn passkey, enrolled with a one-time code minted from the CLI, with a fresh
> passkey assertion bound to every change. A one-time code alone is the bootstrap and break-glass.*
> *2. Channel: TLS-only for the admin pages, accepting that Cloudflare's edge sees that traffic.
> Within that: a hosted model key is never entered in the browser; the instance card is never shown
> through the tunnel. […] It supersedes part of ADR 0047 D-7, so it belongs in ADR 0069.*
> *3. Licence: the owner, as copyright holder, agrees to relicense Operate's wording and pure view
> models from AGPL-3.0-or-later to Apache-2.0 when they move into the shared package (#2644).
> ADR 0069 records this.*
> *4. Approvals: include approving and refusing new riders on the Accounts admin page (#2646)."*

and on [#2646](https://github.com/openzigs/onyourleft/issues/2646):

> *"include approving and refusing new riders on this page, with the same server-side checks as the
> app's Moderation screen (owner-only, logged, and a fresh passkey for each decision). Record in
> ADR 0069 how this page reaches the moderation routes and which rider details it shows, keeping
> them to the minimum the Moderation screen shows."*

### What exists today, read from `main` (b2d56b2b) on 2026-11-15

- **Every `/v1/operate/*` route is `sealed: 'only'` and `reaches: 'owner'`**
  (`apps/instance/src/operate/routes.ts`): the handler answers anybody but the athlete holding
  `OYL_INSTANCE_OWNER_KEY` `not_found`, the deputy included, and a plaintext request
  `sealed_required` before its body is read (`handler.ts`, steps 1 and 4). A sealed request reaches
  them through `RouteContext.dispatch`, which runs the same route table with every check the route
  declares (`route-kit.ts`).
- **The handler sets no cookie and reads none, and every response carries
  `Access-Control-Allow-Origin: *`**; `handler.ts`'s header comment says `*` is safe *because nothing
  rides on ambient authority*. A cookie session is the first ambient credential this server would
  accept.
- **The instance already serves three HTML pages** (`/legal`, `/terms`, `/report`) through
  `html.ts`. Its `PAGE_HEADERS` allow `style-src 'unsafe-inline'` and name no `script-src`, so no
  script runs on them.
- **The operator log** (`operator_log`, migration 0040) records `source` as `app` or `cli`, an
  action from the closed `OPERATOR_ACTIONS` and a `detail` from the closed `OPERATOR_DETAILS`
  (`store/sql-store.ts`). The Operate routes write `source: 'app'` themselves (`operate.ts`).
- **The moderation routes** (`moderation/routes.ts`) are `sealed: 'only'` and `reaches:
  'moderation'`; the owner is a moderator. `GET /v1/moderation/registrations` answers each pending
  athlete's id, display name, when they registered and whether they confirmed they are 18 or over,
  and the app's Moderation screen shows exactly those four (`ModerationView.tsx` §`Registrations`).
  Approve and refuse take a moderator's `reason` and write the moderation log.
- **A readable code** (`auth/identity.ts` §`readableCode`) is sixteen characters from a 31-letter
  alphabet with no `0`, `o`, `1`, `i` or `l`, in groups of four: 79 bits. Recovery codes use it.
- **The home deployment publishes no port on the host**, and `cloudflared` shares the `default`
  network with the instance at a fixed address (`deploy/home/compose.yaml`). The tunnel is run from
  a token, so its ingress rules are held in Cloudflare's dashboard, not on the box.
- **The WAF rule** in `docs/self-hosting/home-machine.md` step 5 blocks the whole hostname for every
  address but the owner's home IP. It is enforced by the edge itself.

### The problem

A browser holds no device key, and a page served through the tunnel is a page Cloudflare can
rewrite. ADR 0047's Context and D-11 already say what follows for the sealed protocol: an edge that
serves the script can remove the encryption, so a browser page served through the tunnel and
speaking the sealed protocol would protect nothing from that edge. The owner has accepted that the
edge sees the admin traffic. What remains to decide is how the browser proves it is the owner, what
the edge can and cannot do with what it sees, how the pages reach routes that refuse every plaintext
request, and what is kept out of the browser altogether.

## Decision

### D-1 — Authentication: a passkey, enrolled with a one-time code from the CLI; the code alone is bootstrap and break-glass

**The owner signs in with a WebAuthn passkey.** A passkey is enrolled in the browser, on the admin
pages, during a session opened with a **one-time code** minted on the host by
**`operator admin-code`**. The code alone also opens a session, which is how the first passkey is
enrolled and how the owner gets back in when every passkey is lost (the owner's ruling 1).

**The code** (*the author's choice*, from the existing pattern):

- `readableCode(16)`: sixteen characters of `CODE_ALPHABET`, in four groups of four, **79 bits**,
  drawn by rejection. (The epic's "80 bits of base32" is corrected here: the project's readable code
  is the one recovery codes already use.) Typed in either case, with or without hyphens or spaces,
  as a recovery code is (`normalisedCode`).
- **Lives 10 minutes. Single use.** Stored only as the SHA-256 of its normalised form, in
  `admin_code` (D-8). Minting a code **voids every unused one**, so at most one code is live.
- **Minted only on the host**, by the CLI, which prints it once and writes `admin_code_minted` to the
  operator log. The app's Operate area does not mint one (the owner's ruling names the CLI; D-11
  Q-B asks whether to add it). Whoever can run the CLI already holds more power than the code gives.
- **Redeemable on either listener** (D-5). A refused code is answered with one sentence that does
  not say whether it was unknown, used or expired, and never echoes what was typed.

**What a code session may do** (the owner's ruling 1, *"a fresh passkey assertion bound to every
change"*, read strictly): **read every page, and enrol one passkey**. Nothing else. It makes no
change on either listener, the loopback one included (D-11 Q-A explains why the planner's loopback
exception is not taken). Enrolling ends the code session, and the owner signs in with the new
passkey, which proves it works.

**The passkey** (*the author's choice* within the ruling):

- `attestation: 'none'`; `userVerification: 'required'` at enrolment and at every assertion, and the
  UV flag checked, not only requested; `residentKey: 'preferred'`; algorithms **Ed25519 (`-8`) and
  ES256 (`-7`) only**, every other one refused at enrolment.
- **The RP ID is the listener's host**: the host of `OYL_INSTANCE_ORIGIN` through the tunnel, and
  `localhost` on the loopback listener. An IP address cannot be an RP ID, so the loopback pages are
  served on `localhost` only (D-4). A passkey is bound to its RP ID, so **a passkey enrolled through
  the tunnel does not work on the loopback listener, nor the reverse**: the owner enrols one for
  each place they use. Each `admin_passkey` row stores its RP ID, and only the rows whose RP ID is
  the current one are offered.
- **The expected origin is checked exactly**: `OYL_INSTANCE_ORIGIN` through the tunnel,
  `http://localhost:<port>` on the loopback listener.
- **A change of `OYL_INSTANCE_ORIGIN`'s host invalidates every tunnel passkey** (their RP ID is
  gone): they stay listed, marked unusable, until revoked, and the owner mints a code and enrols
  again. A change of scheme or port alone changes the origin, not the RP ID; the origin check then
  refuses until the configuration is right.
- **The user handle** is 16 random bytes generated once per instance, never an athlete id; the user
  name is `owner` and the display name the instance's name.
- **The signature counter**: a counter that is non-zero and does not increase is refused and logged;
  a counter that is always zero, as synced passkeys report, is accepted.
- **At most ten passkeys** in all. `excludeCredentials` names the ones already held.
- **Revoking a passkey** is a change: from a passkey session it needs a fresh assertion (D-4), by
  any passkey, the one being revoked included; on the host, **`operator admin-passkeys list`** and
  **`operator admin-passkeys revoke <id>`** need nothing more than the shell. Revoking ends every
  session opened with that passkey.

**Recovery when every passkey is lost** is `operator admin-code` on the host, then enrol again. With
no shell on the host there is no recovery through the browser, by design.

**Who may sign in**: only the owner, and there is no user name to type. An admin session is bound
to the athlete holding `OYL_INSTANCE_OWNER_KEY` **at sign-in**, and stores that key; on every
request, a session whose stored key is not the current `OYL_INSTANCE_OWNER_KEY`, or whose athlete
no longer holds it, is ended. The deputy has no admin sign-in at all (the 2026-11-14 ruling, *"a
deputy does not see Operate"*). With no `OYL_INSTANCE_OWNER_KEY`, the admin pages answer
`unavailable`, naming the variable.

**Rejected: a WebCrypto device key in the browser, enrolled as an owner device** (the epic's option
C). Its JavaScript would be served through the edge, which could rewrite it (ADR 0047 Context,
D-11), so it adds nothing a passkey lacks and it adds a device the account's device list cannot
trust the way it trusts the app's.

### D-2 — The channel: TLS only, and the pages reach the routes in-process, as the owner

**The browser does not speak the sealed protocol.** Served through the tunnel it would be served by
the edge it is meant to hide from; served on the loopback listener there is no edge to hide from.
**The admin pages are a TLS-only channel**: TLS ends at Cloudflare's edge through the tunnel (the
owner's ruling 2 accepts that), and there is no TLS at all on the loopback listener, which never
leaves the machine.

**How a page reaches a route.** The admin layer, in `apps/instance`, dispatches to the **same**
route handlers **in-process**, through the route table, as `RouteContext.dispatch` does for an opened
sealed request, with:

- **a request it builds itself**, for a fixed `(method, path)` the page or form maps to. It never
  forwards a method, a path or a query from the browser; a path parameter is taken from a validated
  form field that must match the route's `{name}` segment shape;
- **the owner athlete as the caller**, and no bearer token minted or looked up;
- **an `admin` marker naming the channel** (`tunnel` or `loopback`), which the operator log is
  written with (D-8).

So the route's own checks run unchanged: the handler's step 4 `reaches` check (the owner passes
`'owner'` and `'moderation'`), the route's validation, its `confirm` field for a destructive action,
and its operator-log write in the same transaction as the change.

**Which routes the admin layer may reach is declared on the route, not in a list beside it**
(*the author's choice*). Every route whose `reaches` is `'owner'`, and each moderation route D-9
admits, declares **`admin: 'read' | 'change' | 'never'`**; absent means `never`, and the admin
dispatch refuses a `never` route before calling it. A route is `never` if **it carries a secret in**
or **its answer is worth something only because the edge cannot write it**. A new Operate route
therefore cannot be added without saying whether the browser reaches it, and
`moderation/choke-point.test.ts` walks the table and holds every route
to it.

**`sealed: 'only'` stays true for every HTTP client.** The marker is set only by the admin layer's
own call, never from a request. A plaintext `/v1/operate/*` or `/v1/moderation/*` request, with or
without an admin cookie, is still `sealed_required`, exactly as today.

**Never offered in the browser** (the owner's ruling 2), on either listener:

- **anything that carries a secret in**: a hosted model key is set only from the app, sealed
  (ADR 0047 D-13), or by `operator model-key`. No admin page has a key field, and the key routes are
  `never`;
- **the instance card and fingerprint through the tunnel** (ADR 0047 D-6). They are shown on the
  loopback listener's Keys page only (D-5), formatted by a code path the tunnel listener does not
  have;
- **restore**, which stays on the CLI (the 2026-11-14 ruling).

**Off by default** (*the author's choice*): `/admin` is mounted only when the operator sets
`OYL_INSTANCE_ADMIN_PAGES=on`; otherwise it is `not_found`, as any path with no route is. A new login
surface on the internet is the operator's choice to open. When on, the pages answer `unavailable`,
naming the variable, without `OYL_INSTANCE_SECRET_KEY` (as every Operate route does) or without
`OYL_INSTANCE_OWNER_KEY`. They are **not mounted on the Durable Object adapter** (ADR 0037 D-2),
which has no operator CLI to mint a code and no loopback listener.

### D-3 — What the edge sees and can do

The sub-issues are checked against this list. "The edge" is Cloudflare's edge on the tunnel
hostname, and anyone with control of the zone's Cloudflare account. None of it applies on the
loopback listener, where there is no edge; the loopback listener has its own, shorter threat list,
below.

**What the edge sees, through the tunnel:**

1. **Every admin page in full**, as the owner reads it: Status, the account counts and registration
   mode, the backups list, the AI backend's settings (never a key: D-2), rooms, the Keys page without
   the card, recent problems (redacted lines), the operator log, and the passkey list (each
   passkey's id, RP ID, when it was enrolled and last used).
2. **The registration queue** on the Accounts page (D-9): each pending rider's display name,
   account id, when they asked and whether they confirmed they are 18 or over, and **the reason the
   owner types** for approving or refusing.
3. **The session cookie** and the CSRF token, on every request.
4. **Every form the owner submits**, with its fields.
5. **Every one-time code typed there**, and every passkey ceremony's options, challenge,
   attestation and assertion.
6. **That the owner is using the admin pages**: when, how often, from which address.

**What the edge can do:**

1. **Anything a read allows, while a session lives**: replay the cookie to load any page, at any
   time, until the session ends (15 minutes idle, 2 hours at most: D-4). It cannot extend a session
   past 2 hours.
2. **While the owner is present, get the owner to approve a change other than the one shown**: it
   can rewrite the page, the form and the script, so the change the server issues a challenge for,
   and the authenticator signs, can be the edge's. An authenticator does not display what a
   challenge is for. Binding the challenge to the action (D-4) stops one assertion being spent on
   another change; it does not stop a rewritten page asking for the wrong one.
3. **Race the owner to a code it sees**: redeem it first, which gives it a code session (every
   read, and one passkey enrolment), and the owner's own redemption is refused, which the owner
   sees.
4. ⚠️ **Enrol a passkey of its own**, by redeeming a code first (3) or by rewriting the enrolment
   page while the owner enrols, substituting its own credential for the owner's. **This is the one
   way the edge can gain the power to make changes while the owner is away**, until that passkey is
   revoked. It is bounded in two ways only, and **it is not detected**
   (D-11 Q-C asks the owner to accept it): one code enrols at most one passkey and then ends, and the
   edge must be active, rewriting pages, at the moment of enrolment. Three things that look like
   detection are not, against an edge that does this: (a) *the owner's next sign-in fails* only if
   the edge left the owner without a working credential, but it can sign in with its own passkey,
   relay the real pages from that session and re-sign each step-up with its own key, so nothing
   visibly fails; (b) the sealed operator log shows exactly one `admin_passkey_enrolled` entry, which
   is the one the owner expects, and D-8 forbids naming the passkey's id, so the entry cannot tell
   the edge's credential from the owner's; (c) `operator admin-passkeys list` shows one passkey, and
   the owner has no credential id from the authenticator to compare it with. The log and the list
   are for finding a *second*, unexpected enrolment, not a substituted one.
5. **Make sign-in attempts and send forms of its own**, within the rate limits (D-4). A form with no
   valid session, CSRF token and fresh assertion changes nothing.
6. **Change the WAF rule.** The rule is enforced by the edge, so it is no defence against the edge.
   The instance does not rely on it (D-5's optional allowlist is defence in depth against the rule
   being widened by mistake, not against Cloudflare).

**What other software on the owner's machine can do, on the loopback listener** (no edge is
involved): a `localhost` cookie is sent to every port, so any other local web server the owner's
browser visits receives the admin session cookie and can replay it from a non-browser client, where
`Origin` and `Host` can be forged and `Sec-Fetch-Site` is absent, which layer 3 allows. (1) With a
**passkey session** it can read every page and cannot change anything, as it has no fresh assertion.
(2) With a **code session** it can enrol its own software passkey (RP ID `localhost`) and so gain
change power, which is why D-11 Q-A's "no" does not close this by itself: the code session's one
enrolment is the opening. Limits: the code lives ten minutes and is single-use, and a code session cannot change
anything but enrol once. A dedicated `*.localhost` host name would give host-only cookie isolation, but it
needs a browser probe of the RP ID rules before it is adopted, so it is **deferred to #2643**, not
decided here.

**What the edge cannot do:**

1. **Approve a change while the owner is not there**, except through a passkey of its own (can do
   4): every change needs a fresh passkey assertion over a challenge the server issued for that one
   change, which only the owner's authenticator can make.
2. **Make a change with a code session**, or with a session it replays: neither carries an
   assertion.
3. **Read or set a hosted model key** through the admin pages, which have no such field (D-2).
4. **Get the instance card or fingerprint** from the admin pages: the tunnel listener has no code
   path that formats them (D-2, D-5).
5. **Reach any `/v1/*` route with the admin cookie**: the API never reads it (D-4).
6. **Reach any route the admin layer does not admit** (`admin: 'never'`, D-2), nor reach one with a
   path or method of its own choosing: the admin layer maps pages to fixed routes.
7. **Restore a backup**: restore is CLI only.

**What is unchanged from ADR 0047 D-11** for every other route: the app's sealed traffic is still
opaque to the edge, and nothing the admin pages do makes a sealed route plaintext.

### D-4 — Web security of the pages

**Two cookies, one per listener** (*the author's choice*):

- **Through the tunnel**: `__Host-oyl-admin`, with `Secure`, `HttpOnly`, `SameSite=Strict`,
  `Path=/`, no `Domain`, and **no `Max-Age` or `Expires`**, so it goes when the browser closes; the
  server enforces the lifetime.
- **On the loopback listener**: a cookie of its own name, `HttpOnly`, `SameSite=Strict`, `Path=/`,
  and `Secure` where the browser accepts it on `http://localhost`. ⚠️ **Not confirmed**: whether
  every current browser accepts the `__Host-` prefix on `http://localhost`. #2643 probes Chrome,
  Firefox and Safari and records the name it chose; either way the server checks the token, not the
  name.
- **The token**: 32 random bytes, base64url, stored only as its SHA-256 in `admin_session`. A new
  token is issued at every sign-in and a cookie the browser already held is never adopted (no
  session fixation). **15 minutes idle, 2 hours absolute**, then signed out. Ended also by signing
  out, by revoking the passkey it was opened with, by `OYL_INSTANCE_OWNER_KEY` changing (D-1), and
  by enrolment for a code session.

**The API never reads the cookie.** Only the `/admin` layer reads it. A test sends a valid admin
cookie to every `/v1/*` route and asserts each answers exactly as without it. `/admin` responses
carry **no `Access-Control-Allow-Origin`** and no other CORS header, and an `OPTIONS` to `/admin` is
not a preflight the instance answers.

**CSRF: three layers**, because the cookie is the first ambient credential this server accepts:

1. `SameSite=Strict`.
2. **A synchronizer token**: 32 random bytes per session, in a hidden field of every form, compared
   in constant time, and refused when absent.
3. **The request's origin**: a `POST` is refused unless its `Origin` is exactly the listener's own
   origin (scheme, host and port) and, when the browser sends `Sec-Fetch-Site`, it is
   `same-origin`. A `POST` with no `Origin` is refused. ⚠️ **This layer is what protects the
   loopback listener from other pages on the same machine**: `http://localhost:3000` and
   `http://localhost:8788` are the **same site**, so `SameSite` does not separate them, and a
   browser sends a `localhost` cookie to every port. `Sec-Fetch-Site` is `same-site`, not
   `same-origin`, from another port, and is refused.

A `GET` never changes anything.

**`Host` is checked** on every `/admin` request (*the author's choice*), against DNS rebinding, not
for locality: through the tunnel it must be the host of `OYL_INSTANCE_ORIGIN`, and on the loopback
listener exactly `localhost:<port>`, where `<port>` is the port the process listens on and **the published host port must equal it** (the container cannot see a remapped one; #2643 adds a variable if the mapping is to differ); anything else is a page that says which address to open, with
no form and no session read.

**Headers on every `/admin` response**, errors and the script and stylesheet included:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self';
  connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` — **no
  `'unsafe-inline'` of any kind**, so the admin frame links a served stylesheet instead of
  `html.ts`'s inline `<style>`;
- `X-Frame-Options: DENY`, `Cache-Control: no-store`, `Referrer-Policy: same-origin`,
  `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`. **`same-origin`, not `no-referrer`**: a
  non-CORS form `POST` under `no-referrer` can carry `Origin: null`, which layer 3 would refuse, so
  every change and the scriptless code sign-in would fail; `same-origin` sends no referrer
  cross-origin and keeps `Origin` exact;
- **no** `Access-Control-Allow-Origin`.

`PAGE_HEADERS` for `/legal`, `/terms` and `/report` are unchanged.

**Step-up: a fresh passkey assertion bound to each change** (the owner's ruling 1). For every change
the page's script first asks `/admin` for a challenge for that form: the server stores it in the
session, bound to the action and a SHA-256 of its canonical fields, **single use, two minutes**.
The script calls `navigator.credentials.get` with it and submits the form with the assertion. The
server verifies the assertion (RP ID, exact origin, UP and UV flags, the counter, the signature) and
that the submitted fields hash to what the challenge was issued for, and only then dispatches. A
refused step-up changes nothing. This is on top of the typed confirmation Operate already asks for a
destructive action, which the route checks itself. With the script blocked, every page still reads,
and no change can be made.

**Rate limits** (*the author's choice*, through `auth/rate-limit.ts` §`createRateLimiter`): sign-in
attempts (a code redeemed, a passkey assertion begun or finished) at most **10 a minute per client
address** and **30 a minute instance-wide**; step-up challenges at most **30 a minute per session**.
The client address is read from `cf-connecting-ip` only from a trusted proxy (`client-address.ts`),
as today. At 30 guesses a minute for a code's 10 minutes, a guess at a live 79-bit code succeeds with
a chance of about 4 × 10^-22.

**Logged and coalesced.** Every sign-in that succeeds is an `admin_sign_in` entry. Refusals — a
code, a passkey assertion, a step-up, a CSRF or origin check, a rate limit — are counted in memory
and written **at most once a minute per kind**, as one `admin_refused` entry carrying the count, so
a flood cannot grow the append-only log without bound. A crash loses at most one minute's counts.

**Nothing secret and no coordinate in any page, error or log line** (ADR 0004 D, CLAUDE.md §6): no
session token, code, key value or token of any kind is rendered, and no admin string formats a
coordinate. Each page's test seeds every secret the instance holds with a marker and asserts none
appears.

**The only script** is one static file the instance serves for the passkey ceremonies and the
step-up; no inline script and no inline event handler. The pages work by keyboard and screen reader
with no script, except the ceremonies.

### D-5 — Locality: a loopback-only second listener, never an address or header check

**"On the server machine" is a second listener** that serves `/admin`, its script and its
stylesheet, and nothing else, published on the host as **`127.0.0.1:8788`** in the home compose
file (#2643). It is **not** a check of the peer's address or of a header: on Docker Desktop a
request from the host arrives from Docker's gateway address, not `127.0.0.1`, and a header is
written by whoever sends it.

⚠️ **It must not be reachable from the tunnel container** (*the author's choice*, and a condition on
#2643). The tunnel runs from a token, so its ingress rules live in Cloudflare's dashboard: if
`cloudflared` could open a connection to the second listener, the edge could route a hostname to it
and get what the loopback listener allows. #2643 places the listener where `cloudflared` has no
route to it, and proves it with a test that a connection from the tunnel container fails. As
defence in depth, the second listener also refuses a request whose peer is one of
`OYL_INSTANCE_TRUSTED_PROXIES` — an address used only to refuse, never to admit.

**What the loopback listener allows that the tunnel does not**: exactly one thing, **the instance
card and its fingerprint on the Keys page** (ADR 0047 D-6), because that page reaches the owner
from the instance with no edge between. Sign-in is the same on both, a change needs a passkey on
both (D-1), and a hosted key is entered on neither (D-2). Its passkeys are its own (RP ID
`localhost`, D-1).

**An optional allowlist for tunnel sign-ins**, `OYL_INSTANCE_ADMIN_ADDRESSES` (exact addresses,
read through the trusted proxy), refuses a tunnel sign-in from any other address. **Off by
default**: a home IP change would otherwise lock the owner out twice, at the WAF and here. It is
defence in depth for the day the WAF rule is widened to let other riders reach the API (scoped to
`/admin` by #2643), not a defence against the edge (D-3).

### D-6 — Build: server-rendered pages in `apps/instance`, and WebAuthn verified by hand against WebCrypto

**The pages** are plain HTML forms rendered by the instance, through `html.ts`'s `escapeHtml`, with
one static script for the ceremonies and one stylesheet, under `apps/instance/src/admin/`. No React,
no client bundle served by the instance, no framework. Everything there is AGPL-3.0-or-later by
path (CLAUDE.md §3).

**WebAuthn verification is written in `apps/instance` against WebCrypto, not taken from
`@simplewebauthn/server`** (*the author's choice*). Why:

- **`attestation: 'none'` shrinks the job to a fixed layout.** Verification is: parse
  `clientDataJSON` and check `type`, `challenge` and `origin`; read `authenticatorData` (the RP ID
  hash, the flags, the counter, and at enrolment the attested credential data); read **one** COSE
  key, a small CBOR map, at enrolment; and verify one signature over `authenticatorData ‖
  SHA-256(clientDataJSON)` with `Ed25519` or `ECDSA P-256` (an ES256 signature arrives DER-encoded
  and is converted to the raw form WebCrypto takes, a known trap the tests name). No attestation
  format, no certificate chain, no metadata service.
- **`@simplewebauthn/server` 14.1.0 (MIT) brings ten direct dependencies** (`@peculiar/x509`,
  `@peculiar/asn1-ecc`, `-rsa`, `-x509`, `-schema`, `-android`, `-x509-post-quantum`,
  `reflect-metadata`, `@levischuck/tiny-cbor`, `@hexagon/base64`; read from the registry on
  2026-11-15), most of them the X.509 and ASN.1 stack for the attestation formats this ADR refuses.
  Each would need an ADR 0037 D-9 row, `check:licences` and `check:notices`.
- **The project has done this before**: ADR 0047 D-3 assembles HPKE from platform primitives rather
  than adding a library. Node 26 (`.nvmrc`) has both algorithms in WebCrypto.

**The gate for it** (#2642): the CBOR reader is bounded (a nesting depth, a length cap, no
indefinite lengths, no tags, a credential id of at most 1023 bytes) and fuzzed; every check above
has a test that goes red when the check is removed; and the vectors are real, recorded from
Chromium's virtual authenticator through Playwright for both algorithms, not written by hand. A
byte flipped anywhere in a recorded assertion is refused.

**No paid service**: passkeys are a browser and platform feature (ADR 0036 D-7).

### D-7 — Delivery: a shared Apache-2.0 package for Operate's wording, and its relicensing recorded

`apps/instance` may not import `apps/web`, and no package may import an app, so **the only place
both can read the same sentence from is a package**. #2644 creates one (working name
`packages/operate-text`): platform-free, no DOM, no React, no Node builtin, no dependency. It holds
the Operate sections' labels and sentences, the closed-word tables (the registration mode, a
backup's off-box state, the tunnel's state), and the pure functions that turn a route's JSON into
rows of label and value. The app's panels and the admin pages both render from it, and a test in
each app renders the same fixture and asserts the same text.

**The relicensing.** Moving that text and code from `apps/web` (AGPL-3.0-or-later) to `packages/`
(Apache-2.0) relicenses it. **The owner, as copyright holder, agreed to it on 2026-11-15** (the
owner's ruling 3, quoted in Context). On 2026-11-15 every commit touching
`apps/web/src/views/Operate*.tsx` and `apps/web/src/instance/operate-port.ts` is the owner's own
(`git log`, 14 commits, one author). #2644 repeats that check over exactly the lines it moves, on
the day it moves them; a line any other contributor wrote is not moved without that contributor's
agreement, and is written afresh instead. The wording stays **draft** until the owner approves it,
as #2603 to #2607's panels say.

### D-8 — The operator log's new entries, and the migration

**Who took it.** `operator_log.source` gains **`admin_tunnel`** and **`admin_loopback`**, each
with `actor_athlete_id` the owner athlete (*the author's choice*: the channel is the fact an audit
of this ADR needs), **except `admin_refused`, whose actor is null**: those entries count attempts by
unknown parties, often before any session exists, and naming the owner would mislead an audit. Every Operate write dispatched by the admin layer records the channel's source,
not `app`: the route reads it from D-2's marker. The app's log panel and the admin log page name
both.

**The new actions**, added to `OPERATOR_ACTIONS` with their `OPERATOR_DETAILS` (closed, as today):

| Action | Written when | `words` | `counts` |
|---|---|---|---|
| `admin_code_minted` | `operator admin-code` mints a code (source `cli`) | `voided_unused` | — |
| `admin_sign_in` | a session opens | `code`, `passkey` | — |
| `admin_refused` | once a minute per kind, if any were refused | `code`, `passkey`, `step_up`, `csrf`, `origin`, `rate_limited` | `refused` |
| `admin_passkey_enrolled` | a passkey is enrolled | `ed25519`, `es256` | — |
| `admin_passkey_revoked` | a passkey is revoked, from a page or the CLI | — | `sessions_ended` |
| `registration_decided` | a registration is approved or refused from the Accounts page (D-9) | `approved`, `refused` | — |

No detail names an athlete, a passkey's id, a code or an address. A sign-out and a session timing
out are not logged.

**The migration** (#2641, the next free number when it lands; `0043-analysis-setting.ts` is the
newest on 2026-11-15) adds three tables and widens `operator_log`'s checks, with a working,
tested `down`. **Migration 0040 has two constraints and a trigger to handle**, which #2641's reviewer
checks: the `source` CHECK gains the two admin sources; the **`operator_log_actor` CHECK**, which
pairs `app` with a non-null actor and `cli` with a null one, is widened so `admin_tunnel` and
`admin_loopback` take an owner actor and may take a null one (for `admin_refused`); and the SQLite
table rebuild drops the **`operator_log_no_update` append-only trigger**, which the migration
recreates, with a test that an `UPDATE` is still refused:

- **`admin_code`**: the code's SHA-256, when minted, when it expires, when used (or null).
- **`admin_session`**: the token's SHA-256, the owner athlete and the owner key at sign-in, the
  channel, how it was opened (`code` or `passkey`, and which passkey), the CSRF token, whether its
  one enrolment is spent, created, last seen, and the absolute expiry; and the pending step-up
  challenge, with the action and fields hash it is bound to.
- **`admin_passkey`**: an id, the credential id (unique), the RP ID, the public key and its
  algorithm, the signature counter, the channel it was enrolled on, enrolled and last used. A
  revoked passkey's row is deleted; the operator log keeps the record.

Widening a SQLite `CHECK` rebuilds the table; the `down` refuses to run while any row holds an
`admin_*` source rather than drop audit entries, and says so.

### D-9 — Accounts: approving and refusing new riders through the moderation routes

The owner's ruling 4 and the ruling on #2646 put approvals on the Accounts page. **The admin layer
reaches exactly three moderation routes, in-process, as the owner** (D-2): `GET
/v1/moderation/registrations` (`admin: 'read'`), and `POST
/v1/moderation/registrations/{athleteId}/approve` and `…/refuse` (`admin: 'change'`). Every other
moderation route stays `never`: suspensions, reports, the moderation log, invites, room removals and
the rest stay in the app.

**The same server-side checks as the app's Moderation screen**: the route's `reaches: 'moderation'`
check (the owner is a moderator), its validation, the moderator's **reason** (required, as in the
app, and the same length limit), and its write to the **moderation log** with the owner as the
actor. Added by this channel: **a fresh passkey assertion for each decision** (D-4), and a
`registration_decided` entry in the operator log **in the same transaction** as the moderation log
row, with the channel's source (D-8), because the moderation log alone cannot tell a decision taken
through the tunnel from one taken in the app.

**Which rider details it shows: the four the Moderation screen shows, and nothing more** — the
display name, the account id (two riders may share a display name, and the moderation log names the
id), when they asked, and whether they confirmed they are 18 or over. No email, no address, no
device, no ride, no other field of the athlete row.

⚠️ **This is the one place the admin pages show other riders' personal data, and through the
tunnel the edge sees it** (D-3, sees 2). ADR 0047 D-7 sealed the registration queue in phase 1 so
that an edge holding a moderator's token could neither read it nor decide it. Through this channel
the edge **reads** it while a session lives, and **cannot decide** one without the owner's
authenticator (D-3, cannot 1). The owner chose that trade on 2026-11-15. #2646's body, which
predates the ruling and says the page shows no display name and no athlete id, gains a revision
block before it is built.

### D-10 — What this supersedes, and what it leaves standing

**Superseded in part, by name:**

1. **The owner's ruling of 2026-11-14 on #2601**, its second bullet: *"an owner-only section of the
   app, not a separate server web page […] so the instance gains no new login surface"*. The app's
   Operate area stands, sealed, as built; the instance gains **one** new login surface, `/admin`,
   for the owner only, off by default (D-2).
2. **ADR 0047 D-7's Operate row** (its amendment of 2026-11-14), where it says the `/v1/operate/*`
   routes are the owner's admin surface reached through the tunnel and that an instance does not
   offer *"an admin surface unsealed"*. The routes stay `sealed: 'only'` for every HTTP client, and
   `unavailable` without `OYL_INSTANCE_SECRET_KEY`; ADR 0069 adds a second, TLS-only way to reach
   the handlers of those marked `admin: 'read'` or `'change'`, in-process (D-2).
3. **ADR 0047 D-7's phase-1 moderator rows** (*"every other moderator action"* and *"every moderator
   read"*), for `GET /v1/moderation/registrations` and its approve and refuse routes only, reached
   through the admin layer as the owner (D-9). Every other moderator route is untouched.
4. **ADR 0047 D-8**, *"every sealed request carries, inside its plaintext, a device signature"*, for
   the routes D-2 admits only and only through the admin layer: there a session stands in for a
   read and a fresh passkey assertion for a change. A sealed request is unchanged.
5. **ADR 0047 D-11**, its sentence that phase 1 seals the moderator actions so that an edge holding
   a moderator's token cannot approve or refuse registrations or read the queue, for the same three
   routes: D-3 above states what the edge can do through the admin channel instead.

**Left standing, by name:**

- **ADR 0036 D-3's four invariants.** (a) Nothing that works with no instance starts to need one, and
  `apps/web/src/privacy/no-network.test.ts` still admits one module: the admin pages change nothing
  in the client. (b) and (c): no device copy is deleted, and the instance is not made the only place
  of any data. (d) Nothing the client refuses to send leaves through the instance: the admin pages
  carry no rider's data from the app.
- **ADR 0046 D-9 Q9**: the operator is the athlete holding `OYL_INSTANCE_OWNER_KEY`; the deputy is
  not the operator and has no admin sign-in (D-1).
- **ADR 0047 D-6**: a pin comes only from a source the edge cannot write; the card is shown only on
  the loopback listener (D-5).
- **ADR 0047 D-11's web-build rule**: no web build loaded over `https:` is offered a sealed feature.
  The admin pages are not the web client and offer no sealed feature; they are a separate channel
  that says what it does not protect.
- **ADR 0047 D-13**: a pasted key is accepted only sealed, or by the operator command; no admin page
  accepts one (D-2).
- **ADR 0004 D**, and every other 2026-11-14 ruling on #2601: a deputy does not see Operate; the
  registration mode is shown, not changed at runtime; restore stays on the CLI; every Operate route
  is `unavailable` without `OYL_INSTANCE_SECRET_KEY`.
- **No trainer control** is reachable from the admin pages (CLAUDE.md §6).

### D-11 — Questions for the owner

Each has the author's recommendation, which the ADR above already follows; the owner's answer on
the pull request decides it.

- **Q-A — May a code session make changes on the loopback listener, with no passkey?** The planner
  recommended yes (there is no edge on that path). **Recommended: no**, as D-1 says: the owner's
  ruling reads *"a fresh passkey assertion bound to every change"*; a `localhost` cookie is sent to
  every port on the machine, so any local web server the owner's browser visits receives the
  session (D-4); and a `localhost` passkey takes a minute to enrol. The CLI remains for a machine
  with no authenticator.
- **Q-B — May the app's Operate area mint an admin code**, over a sealed `POST
  /v1/operate/admin-codes`, as the epic proposed? **Recommended: not now.** The ruling names the
  CLI, and whoever enrols a passkey for the tunnel has the host at hand to mint one. It can be added
  later as an Operate route marked `admin: 'never'`.
- **Q-C — Is D-3's "can do 4" acceptable**: an edge that rewrites the enrolment page while the owner
  enrols, or races a code, can enrol a passkey of its own? The only real bounds are the two D-3
  states: one passkey per code, and the edge having to be active at the moment of enrolment. It is
  not detected afterwards. **Recommended: accept it only with one of two further limits, and the
  owner chooses**: (1) *tunnel-enrolled passkeys expire* (30 days, renewed by enrolling again), so a
  substituted one does not outlive the next enrolment; or (2) *a passkey enrolled through the tunnel
  can read but not change until `operator admin-passkeys confirm` is run on the host*, which an edge
  cannot do. The first is cheap and the second closes the hole for changes, at the cost of a host
  step per enrolment. The full answer is to enrol no passkey through the tunnel, which leaves the
  tunnel read-only; that is the alternative if the owner accepts none of these.

## Consequences

### What this enables

- The owner can run the instance from any browser, at the server machine or at home through the
  tunnel, with no app installed, on the same routes and the same owner check as Operate.
- Approving or refusing a new rider without the app, with a passkey for each decision.
- One wording for Operate in both places, from one Apache-2.0 package.

### What this costs, stated plainly

- **A new login surface on the internet**, for the owner only and off by default, and the first
  ambient credential this server accepts. D-4's three CSRF layers, its headers and the test that the
  API ignores the cookie exist because of it.
- **Through the tunnel, Cloudflare sees everything the owner sees on the admin pages**, the
  registration queue's riders included, and can ride a live session for reads (D-3). The app's
  Operate area keeps its sealed channel for every owner who prefers it.
- **A WebAuthn verifier of the project's own**, with the maintenance that implies; D-6's gate is
  the price of not carrying ten dependencies.
- **Two passkeys for an owner who uses both listeners**, because the RP IDs differ (D-1).
- **The planner's loopback exception is not taken** (D-11 Q-A), so a machine with no authenticator
  makes changes only with the CLI.

### Constraints this places on other work

- **Every new `reaches: 'owner'` route declares `admin:`** (D-2), and one that carries a secret in,
  or whose worth is that the edge cannot write it, is `never`.
- **#2641** builds D-1's code, D-4's session, CSRF, headers, `Host` check, rate limits and coalesced
  log, D-8's migration and source values, and D-2's dispatch and `OYL_INSTANCE_ADMIN_PAGES`; it
  rewrites `handler.ts`'s *"sets no cookie and reads none"* comment to say the API still reads none.
- **#2642** builds D-1's passkeys, D-4's step-up and D-6's verifier with its gate.
- **#2643** builds D-5's listener, proves the tunnel container cannot reach it, probes the
  loopback cookie name, and scopes the WAF rule in `docs/self-hosting/home-machine.md` to `/admin`.
- **#2644** builds D-7's package and repeats D-7's authorship check on the lines it moves.
- **#2646** gains a revision block for D-9 before it is built.
- **#2650**'s Keys page shows the card on the loopback listener only, and a test asserts the
  fingerprint is absent from every tunnel page.
- **#733**, the owner's device-check list, gains each page's check through the tunnel.

## What would make this ADR wrong

- **A browser that does not send `Origin` on a same-origin form `POST`**, which D-4 refuses; the
  shell's browser test (#2645) would show it.
- **Docker networking that cannot keep the tunnel container off the second listener** (D-5); then
  the card is not shown in the browser at all and D-5's one difference goes.
- **A passkey provider the owner uses that offers neither Ed25519 nor ES256**, which D-1 refuses.
- **The owner not accepting D-3's "can do 4"** (D-11 Q-C), which makes the tunnel read-only.
