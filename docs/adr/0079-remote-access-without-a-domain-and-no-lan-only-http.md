# ADR 0079: Remote access without a domain — the owner's tailnet by default, a domain optional, and no LAN-only `http://`

- **Status**: **Accepted**, 2026-11-18, by the owner on #2806, with the answers recorded in D-11.
  Proposed 2026-11-18. [#2791](https://github.com/openzigs/onyourleft/issues/2791) and
  [#2805](https://github.com/openzigs/onyourleft/issues/2805) are unblocked by it. Nothing is built
  by this ADR
- **Date**: 2026-11-18
- **Deciders**: **the owner**, whose rulings are quoted in Context: that self-hosting never needs a
  paid service (2026-10-27, on #15), and that the easy-setup work goes on (2026-11-17 and
  2026-11-18, on #2779 and #2790). The owner was not present when this was written. **The author**
  decided everything those rulings leave open, including the epic's open questions 3 and 4, which
  are recorded here as **Maintainer decisions** with the reason for each until the owner rules.
  Each such choice is marked *the author's choice* where it is made, and D-10 lists the ones the
  owner is asked to confirm or overrule
- **Issue**: [#2790](https://github.com/openzigs/onyourleft/issues/2790), Phase 3 of the epic
  [#2779](https://github.com/openzigs/onyourleft/issues/2779)
- **Number**: **0079**, which #2790's title claims. On 2026-11-18 `docs/adr/` on `main` (9d1b5f392)
  holds no file numbered 0079; the open pull request
  [#2795](https://github.com/openzigs/onyourleft/pull/2795) (#2780) writes 0080 and records 0079 as
  *"Reserved, not written. Claimed by #2790's title"*; the open pull request
  [#2793](https://github.com/openzigs/onyourleft/pull/2793) (#2777) writes 0078; and 0075, 0076 and
  0077 are written in the open pull requests #2670, #2767 and #2762. The owner's lane note of
  2026-11-18 on #2790 expected 0081. *The author's reading*: 0081 is the next free number **after**
  this ADR, because 0079 is #2790's own claim; taking 0081 would leave 0079 reserved for an issue
  that is closed, and #2795's record already says it is this issue's
- **Supersedes**: **nothing**. Every rule below either reads an existing decision (D-1 reads ADR 0036
  D-7) or adds a constraint to a path that did not exist when the earlier ADRs were written. No ADR
  gains an amendment and no ADR's body is edited
- **Leaves standing**: [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3's four invariants
  and D-7; [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-8 (the Cloudflare tunnel's
  constraints, which still bind that path); [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md)
  D-6 (the pin comes only from a card), D-11 and D-13;
  [ADR 0069](0069-the-instances-own-admin-pages-and-a-tls-only-admin-channel.md) D-1 to D-5;
  ADR 0080 (in #2795: setup on the loopback listener);
  [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)'s ruling of
  2026-10-07 that a WireGuard-class overlay is not the home network;
  [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6; and `apps/web/src/instance/address.ts`
- **Relates to**: #1748, which reserves ADR 0057 for the carve-out that store fees the **publisher**
  pays are outside D-7 (D-1 below is the other half of the same ruling); #2791 (the Cloudflare
  tunnel created from an API token); #2805 (the tailnet path, filed with this ADR); ADR 0029 D-6,
  which already permits a WireGuard-class overlay for camera pictures. Whether pictures may use the
  tailnet of D-2 is **not** decided here

---

## Context

### What the owner has ruled, quoted so it is not argued again

ADR 0036 D-7, 2026-09-29: *"Lifting D6 implies no paid hosting. […] No issue may take a paid service
as a prerequisite."*

On 2026-10-27, on [#15](https://github.com/openzigs/onyourleft/issues/15#issuecomment-6439217385),
ruling D-2: *"a **new ADR** says store fees the publisher pays (Apple's $99 a year, Play's one-off
fee) are outside D-7. Riding, recording and self-hosting never need a paid service."* #1748 writes
the first sentence's ADR. This ADR applies the second sentence to remote access.

On 2026-11-15, on [#2601](https://github.com/openzigs/onyourleft/issues/2601#issuecomment-6896705595),
the admin pages are *"reachable through the tunnel as well as on the server machine, behind the
existing home-IP firewall rule"* (quoted in ADR 0069's Context).

On 2026-11-17 the owner asked for setup a non-technical person can manage, and the epic #2779 was
planned from that. Its open questions 3 and 4 are this ADR's: *"Does the yearly cost of a domain
breach ADR 0036 D-7? If so, Tailscale Funnel (free, needs an account) may be the default remote
path"* and *"Is LAN-only `http://` acceptable for sealed routes, or must LAN need TLS?"* On
2026-11-18 the owner wrote, of the epic, *"Can we do next phase of install or anything on that set
of epics"*, and started this issue the same day.

### What exists today, read from `main` (9d1b5f392) on 2026-11-18

- **The app talks only to `https:`, or to `http:` on its own loopback.** `address.ts` refuses every
  other `http://` address with `not-encrypted`, before any request is built, and gives the reason:
  inside the Android shell the app is served from `https://localhost`, so a plain `http://`
  instance is mixed content and the WebView refuses it.
- **`no-network.test.ts` governs network primitives and modules, not schemes.** It permits exactly
  one `fetch` and one `WebSocket`, both in `instance/instance-transport.ts` (ADR 0036 D-3(a)), and
  nothing in it reads whether an address is `http:` or `https:`.
- **The home deployment cannot start without a Cloudflare tunnel.** `apps/instance/deploy/home/compose.yaml`
  runs the `tunnel` service with `TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?…}`, so a missing token
  stops `docker compose`. `docs/self-hosting/home-machine.md` asks for *"a Cloudflare account (free)
  with a domain on it"* and a public hostname on that domain. **Today's home install therefore
  needs a domain**, which is the expert step and the bill the epic names.
- **The tunnel is the only thing keeping strangers out.** The WAF rule in `home-machine.md` step 5
  blocks the whole hostname for every address but the owner's home IP, and it is enforced by
  Cloudflare's edge, which terminates TLS and sees every plaintext route (ADR 0047 D-11, ADR 0069
  D-3).
- **Three things bind one origin.** The instance card is `oyl-instance:<origin>#<fingerprint>`
  (ADR 0047 D-6); an admin passkey's RP ID is the host of `OYL_INSTANCE_ORIGIN` (ADR 0069 D-1); and
  a device statement names the origin (ADR 0014 D-8). `OYL_INSTANCE_ORIGIN` holds one value.
- **The instance learns a rider's address from a header a trusted proxy sets**:
  `OYL_INSTANCE_CLIENT_ADDRESS_HEADER` (`cf-connecting-ip` behind Cloudflare) believed only from
  `OYL_INSTANCE_TRUSTED_PROXIES` (`config.ts`, `client-address.ts`).
- **Two long-lived responses must survive the path.** An analysis job's events are Server-Sent
  Events (`analysis/routes.ts`, `streamAnalysisJob`, `text/event-stream`, sealed), and a room is a
  WebSocket (ADR 0037 D-3) with a 30-second keepalive (ADR 0037 D-8.1).

### What was checked outside the repository, on 2026-11-18

Each line is what the page says, not what the author expects:

- **Cloudflare Quick Tunnels** (developers.cloudflare.com, *TryCloudflare*): *"You do not need a
  Cloudflare account or domain"*; *"The hostname changes each time you create a Quick Tunnel"*;
  *"Quick Tunnels do not support Server-Sent Events (SSE)"*; at most 200 in-flight requests.
- **Tailscale Funnel** (tailscale.com/kb/1223/funnel): *"Funnel can only listen on ports `443`,
  `8443`, and `10000`"*; the Tailscale server on the device *"terminates the TLS connection"*, and
  *"Funnel relay servers do not decrypt the traffic between public devices and your device"*;
  *"Traffic sent over a Funnel is subject to non-configurable bandwidth limits"*, with no figures;
  it needs MagicDNS, HTTPS certificates and a `funnel` node attribute; *"Tailscale Funnel is
  available for all plans"*; it is in beta.
- **Tailscale Serve** (tailscale.com/kb/1312/serve): a port last configured with `serve` *"will be
  completely private"* to the tailnet; tailnet requests carry `Tailscale-User-*` identity headers,
  Funnel requests carry none, and incoming copies are stripped. **The page says nothing about
  WebSockets, Server-Sent Events or a client-address header.**
- **Tailscale HTTPS certificates** (tailscale.com/kb/1153/enabling-https): issued by Let's Encrypt
  through a DNS-01 challenge whose TXT record Tailscale creates on `ts.net`; the certificate's and
  the ACME account's private keys *"are generated and stored locally on your machine"* and
  *"Tailscale never sees them"*; and every certificate's name, so the machine name and the tailnet
  name, is published in the public Certificate Transparency logs.
- **Tailscale's Personal plan** (tailscale.com/pricing): free, *"Up to 6 users"*, *"Unlimited user
  devices"*, and *"only suitable for non-commercial use"*. The client is BSD-3-Clause; the
  coordination service is proprietary.
- **Headscale** (headscale.net, features): its feature list names no HTTPS certificates for MagicDNS
  names, and links Funnel and Serve to open issues (#1040, #1921) rather than listing them as
  supported.
- **Android's network security configuration** (developer.android.com): an app targeting API 24 or
  later trusts the system CAs only, not user-added ones, unless it opts in with
  `<certificates src="user"/>`; from API 28 cleartext traffic is off by default. This app's manifest nonetheless allows cleartext app-wide (#553); see D-6.

### What nobody has verified

- That **SSE and WebSockets pass through `tailscale serve`** and through Funnel unbuffered. Nothing
  above says so. #2805 measures it before it builds anything else (its first criterion).
- **Which header, if any, `serve` and Funnel put the client's address in.**
- **Funnel's bandwidth limit**, against ADR 0037 D-8.3's ≈ 0.36 Mbit/s per 50-rider room.
- Whether **two devices on one LAN** talk directly over it when both are on the tailnet, as
  Tailscale's design intends, rather than through a relay.
- Whether the **Android WebView** treats a `100.64.0.0/10` tailnet address as a local-network
  request it gates. Instance traffic would reach a `ts.net` name; how the WebView classifies what
  it resolves to is a tablet check.
- Whether **Docker Desktop's bridge network lets mDNS reach the LAN** (the issue's question). D-7
  makes it moot, so it stays unverified.

### The problem

A non-technical owner needs one stable `https://` origin that the tablet trusts, with no domain to
buy, that does not hand the admin pages or the card to a party that could rewrite them, and that
carries a sealed SSE stream and a room's WebSocket. Every candidate the issue names is judged below
against the same seven tests:

| Test | Where it comes from |
|---|---|
| **Paid** — does any step need money? | ADR 0036 D-7; the owner's ruling of 2026-10-27 |
| **Account** — does any step need an account, and whose? | ADR 0036 D-7 as the issue reads it |
| **Canonical** — does a rider with no instance still lose nothing? | ADR 0036 D-3 |
| **Pin** — can the path ever be the source of a pin? | ADR 0047 D-6 |
| **Origin** — is the origin stable, so cards, passkeys and statements keep working? | ADR 0047 D-6, ADR 0069 D-1 |
| **Edge** — who terminates TLS, and who could read or rewrite the admin pages? | ADR 0069 D-3 |
| **SSE** — does an analysis job's stream arrive? | `apps/instance/src/analysis/` |

## Decision

### D-1 — A domain is a paid service under ADR 0036 D-7, so no setup path may need one (Maintainer decision)

**A domain registration is a paid service** for ADR 0036 D-7, and no issue may make one a
prerequisite of installing, pairing with or reaching an instance. The reasons:

- A domain is bought from a registrar, by the year, and stops working when the fee is not paid.
  That is a paid service by any reading; whether it is "hosting" does not matter, because the
  owner's ruling of 2026-10-27 says *"self-hosting never need[s] a paid service"*, which is wider
  than hosting.
- The ruling's only carve-out is store fees the **publisher** pays (#1748, ADR 0057 when written).
  A domain is paid by each **self-hoster**, which is the case the second sentence of that ruling
  excludes.
- Read the other way, D-7 would be empty for exactly the person this epic is for.

**What does not count as a paid service: a free account at a third party.** Cloudflare's free
account is one already, and the home deployment has needed it since #807. A free account is a
cost in trust and in dependence on that party's terms, and the *Account* row of each option below
says whose it is; it is not a bill. *The author's choice*: the issue lists "paid or account" as one
test, and D-7's words name only payment.

**What follows:**

1. **A Cloudflare named tunnel stays supported, for an owner who has a domain** (D-4). The project's
   own instance has one, and that is the owner's choice, not a prerequisite anyone else inherits.
2. **The home compose file must start with no Cloudflare token.** The `tunnel` service becomes a
   profile (#2805), so that no domain is needed to run the instance at all.
3. **The setup wizard's default remote step needs no domain** (D-2).

### D-2 — The no-domain default is the owner's tailnet, served with `tailscale serve`, Funnel off (Maintainer decision)

**The instance is reached at `https://<machine>.<tailnet>.ts.net`**, on port 443, served by
`tailscale serve` from a `tailscale` container beside it (#2805). **Every device that uses the
instance joins the owner's tailnet**: the tablet runs the Tailscale app, signed in to a household member's own account invited into the
owner's tailnet (not to the owner's account; see the Account row). Nothing outside the tailnet can reach
the instance at all, which is the home-IP WAF rule's job done by membership instead of by an
address.

| Test | The tailnet path |
|---|---|
| **Paid** | No. The Personal plan is free: 6 users, unlimited devices. |
| **Account** | One Tailscale account for the owner; each other rider is one of the 6 users, invited into the tailnet, or has a device shared to them. **A rider never signs in to the owner's own account**, because that gives their device the owner's identity across the whole tailnet. #2805 must also set a tailnet access rule (ACL) that lets non-owner devices reach only the instance's port, and documents both. The plan is for non-commercial use only. |
| **Canonical** | Unchanged: the path is only how an instance is reached. A rider with no tailnet is a rider with no instance, who loses nothing (ADR 0036 D-3(a)). |
| **Pin** | Never. The card still comes only from the loopback listener or a pinned device (D-9). |
| **Origin** | Stable while the machine and tailnet names stay the same. Renaming either is an origin change (D-8). |
| **Edge** | TLS terminates on the node, in `tailscaled`, with a private key Tailscale never sees. Relays forward WireGuard ciphertext. Nobody sits where Cloudflare's edge sits by design; see below for what Tailscale could do by an active attack. |
| **SSE** | **Unverified.** #2805's first criterion measures it, and a WebSocket too, before the rest is built. |

**What Tailscale, the company, could still do**, stated so that it is not mistaken for nothing:

- **Add a node to the tailnet.** Its coordination service hands out the node keys, so a node it
  adds can reach the instance as any member can. Tailscale's optional Tailnet Lock is the defence;
  #2805 documents it and does not require it.
- **Obtain a certificate for the instance's name.** It controls `ts.net`'s DNS, which is how the
  DNS-01 challenge is met. A certificate issued that way is published in the Certificate
  Transparency logs, as every public certificate is. To read traffic it would need both this and a
  node in the path: an **active, logged attack**, where Cloudflare's edge reads the same traffic
  passively, by design.
- **Sealed routes stay sealed** against either. They are opened only with the key the card pins
  (ADR 0047 D-6), whatever carries them.

**The serve configuration lives on the box**, in a file #2805 writes, not in a dashboard. *The
author's reading* of Tailscale's documentation is that the coordination service cannot add a
`serve` route to another port on the node. That is unverified, so **ADR 0069 D-5's condition
applies to the `tailscale` container as it does to `cloudflared`**: it has no route to the loopback
admin listener, and #2805 proves that with a connection that fails.

**A tailnet request is not on the home network.** ADR 0046's ruling of 2026-10-07 already says
*"WireGuard-class overlays do not count"*, and nothing here changes it. Requests reach the instance
from the `tailscale` container's address on the compose network, so #2805 names that container as
a trusted proxy and finds out which header carries the rider's address. If `serve` sets none, the PR
says what the rate limits key on instead.

**The admin pages work on the tailnet unchanged.** Their RP ID is the `ts.net` host (ADR 0069 D-1),
the tailnet keeps everybody else out, and ADR 0069 D-2 to D-5 apply as written. ADR 0069 D-3's list
of what "the edge" sees describes Cloudflare. On this path nobody sees those pages passively, and
the two active attacks above are what remains.

**Why the tailnet and not Funnel as the default** (*the author's choice*, D-10 Q-2): the epic
suggested Funnel. But Funnel puts the instance on the public internet with no edge rule in front of
it, under a name anybody can find in the Certificate Transparency logs. Today the owner's instance
is closed to everyone but the home address. The tailnet keeps that posture, Funnel ends it. The
tailnet costs one app install on each rider device, and that is the trade this ADR takes.

### D-3 — Funnel is an opt-in, for riders who will not join the tailnet, and `/admin` is not served on the public listener while it is on

**The owner may turn Funnel on** for the instance's public listener, so that a rider who is not on
the tailnet reaches the same `ts.net` origin from anywhere. It is never on by default.

| Test | Funnel |
|---|---|
| **Paid** | No. Funnel *"is available for all plans"*. |
| **Account** | The owner's Tailscale account only. Riders need nothing installed. |
| **Canonical** | Unchanged. |
| **Pin** | Never (D-9). |
| **Origin** | The same `ts.net` origin as D-2, so turning Funnel on or off is not an origin change. |
| **Edge** | TLS terminates on the node and relays do not decrypt. **But no edge rule keeps anybody out**: the instance is on the public internet, and its name is in the Certificate Transparency logs. |
| **SSE** | **Unverified**, as D-2. |

**While Funnel is on, `/admin` is not served on the public listener.** The owner's ruling
of 2026-11-15 put the remote admin pages *"behind the existing home-IP firewall rule"*. Funnel has
no such rule. The instance cannot tell a Funnel request from a tailnet one except by the presence of
a `Tailscale-User-*` header, and ADR 0069 D-5 refuses to decide locality from a header. So #2805
gives the instance one setting naming the remote path (`tailnet`, `funnel` or `cloudflare`), and
**while that setting is `funnel` the public listener answers every `/admin` path with 404**, and the
setting is the only thing that decides it. **Nothing else turns off**: `OYL_INSTANCE_ADMIN_PAGES`
and the loopback admin listener (`OYL_INSTANCE_ADMIN_LOOPBACK_PORT`, which `server-config.ts` ties to
admin pages being on) stay as the owner set them, so the owner still has the loopback pages on the
host, and the loopback card that D-9 names as the server-side pin source is still served. A
start-up refusal on `OYL_INSTANCE_ADMIN_PAGES=on` is **not** made, because it would remove the
loopback listener as well, and ADR 0080 (#2795) lifts that tie only until setup is done. The app's
sealed Operate area is unaffected. *The author's choice*, D-10 Q-3.

**Funnel's bandwidth limit is unknown** and not configurable. A room's upload (ADR 0037 D-8.3) may
not fit it. #2805 says so where Funnel is offered and does not promise rooms over it.

### D-4 — A Cloudflare named tunnel stays supported for an owner with a domain, and #2791 stands as that option

| Test | Cloudflare named tunnel |
|---|---|
| **Paid** | **Yes, the domain** (D-1). So it is an option, never a prerequisite. |
| **Account** | A free Cloudflare account. |
| **Canonical** | Unchanged. |
| **Pin** | Never: the card is never shown through the tunnel (ADR 0069 D-2, D-5). |
| **Origin** | Stable: the owner's own hostname. |
| **Edge** | Cloudflare's edge terminates TLS and sees and can rewrite every plaintext route and admin page (ADR 0047 D-11, ADR 0069 D-3), behind the home-IP WAF rule. Unchanged. |
| **SSE** | Yes: ADR 0047 D-11 already describes the edge seeing a job's SSE event timing on this path. Cloudflare documents the SSE limit for Quick Tunnels only. |

**#2791 stands**: a wizard step that creates the tunnel from a scoped API token, offered as *"I
have a domain on Cloudflare"*, beside D-2's step and never ahead of it. Its criterion about
changing an origin that is already set is D-8's rule.

### D-5 — Rejected: a Quick Tunnel, Headscale as a supported path, and a local certificate authority

- **A Cloudflare Quick Tunnel is rejected.** It needs no account and no domain, but its hostname
  changes on every start. Each change breaks the card's origin, every passkey's RP ID and every
  statement naming the origin (D-8), so each restart would need every device to re-pair. It also
  does not carry SSE, so no write-up would arrive.
- **Headscale is not a supported path.** It is BSD-3-Clause and free, but it needs a server the
  riders can reach from outside, which is either a paid machine or a port forwarded from home, an
  expert step that carrier-grade NAT often makes impossible. Its feature list names no HTTPS
  certificates for MagicDNS names, so it would need a domain anyway. No wizard step is built for
  it. An expert may still run one: the instance does not know or care what serves its origin.
- **A local certificate authority is rejected.** A CA the instance makes would have to be installed
  on every tablet, which is an expert step behind Android's security warnings. Android apps
  targeting API 24 or later do not trust user-added CAs, so the app would have to opt in with
  `<certificates src="user"/>`, which trusts **every** user-installed CA for all of the app's
  traffic, not only ours. And the CA's private key on the box could mint a certificate for any name
  the tablet visits.

### D-6 — LAN-only `http://` is refused; `address.ts` and `no-network.test.ts` do not change

**The app does not talk to an instance at a LAN `http://` address, for sealed routes or any other.**
The ruling the issue offers, that sealed transport (ADR 0047) makes `http://` on a private LAN
acceptable for sealed routes, **is not made**:

1. **The Android app could not use it anyway.** It is served from `https://localhost`, so an
   `http://` request is mixed content and the WebView refuses it (`address.ts`), and the
   WebView sets `allowMixedContent: false`. Allowing it means turning on mixed content in the WebView
   for every origin, or sending instance traffic around the WebView through a native module. The
   second is a second network module, which ADR 0036 D-3(a) says is a change to that ADR, not a
   review note. **The manifest does allow cleartext app-wide** (`usesCleartextTraffic="true"`, #553),
   and `apps/mobile/src/http/analysis-http.ts` is a native-HTTP module that `no-network.test.ts`
   permits for LAN plaintext. That is the #553 precedent, and it is **deliberately not extended** to
   instance traffic, for reasons 2 to 4.
2. **Sealing does not cover the session token.** The bearer token rides in the `Authorization`
   header of every request, sealed or not, and until ADR 0047's phase 2 it is a full credential on
   the plaintext routes (D-11). Over `http://`, anybody on the Wi-Fi reads it and can do everything
   D-11 lists for the edge: read the account summary, change the display name, block and report
   riders, and mint room tickets.
3. **A passkey needs a secure context.** The admin pages over LAN `http://` could not sign the owner
   in (ADR 0069 D-1). On the host itself, `http://localhost` is already a secure context and
   already served (ADR 0069 D-5).
4. **A LAN address is not an origin that lasts.** A router hands it out and may change it, and every
   change breaks what D-8 lists, as a Quick Tunnel's would.

**So `address.ts` is unchanged**, including its `not-encrypted` refusal and its loopback exception,
and **`no-network.test.ts` is unchanged**: the tailnet and Funnel paths reach an `https://` origin
through the same `instance-transport.ts`, and add no primitive and no module.

**What a LAN-only household does instead: the tailnet (D-2).** The instance and the tablet both run
Tailscale, and the tablet reaches `https://<machine>.<tailnet>.ts.net`. Between two devices on the
same LAN the WireGuard connection is normally direct, though nobody has measured that here. The
traffic is encrypted whichever way it goes. Only Tailscale's coordination service is outside the
house, and it sees device keys and metadata, not traffic.

**A household with no internet connection at all** has no instance features, because the tailnet
needs the coordination service to set up. Everything else works as today: recording, trainer
control, the game and the library need no instance (ADR 0036 D-3(a)).

### D-7 — mDNS discovery (`_oyl._tcp`) is not filed

The issue asks whether to file it as two sub-issues. **It is not filed** (*the author's choice*,
D-10 Q-5):

- With D-6, discovery would find a LAN `http://` address the app refuses to use.
- On the tailnet, the name is already stable and MagicDNS resolves it. The card QR carries the
  origin in any case, so after one scan there is nothing left to discover.
- An mDNS answer comes from anybody on the LAN, so it could never be a pin source (ADR 0047 D-6).
  At best it could fill in an address, which the card already does.
- It would add a dependency and a multicast path through Docker Desktop that nobody has verified.

It is revisited only if a superseding ADR allows LAN `http://`.

### D-8 — One origin per instance, and changing the path is a re-pairing

**An instance is served at one origin at a time** (*the author's choice*). `OYL_INSTANCE_ORIGIN`
holds one value, and the card, the passkeys' RP ID and every device statement are bound to it. An
instance reachable at two origins would have two cards that differ only in the origin, passkeys
that work on one and not the other, and statements that name either.

**Moving from one path to another, or renaming the machine or the tailnet, changes the origin.** The
identity key and its fingerprint do not change, but every device scans the new card, and every
admin passkey for the old host stops working until the owner enrols one for the new host
(ADR 0069 D-1). **The wizard says so plainly before it changes an origin that is already set**,
whichever path it is setting up (#2791's criterion 4, #2805).

### D-9 — None of these paths is ever a pin source

ADR 0047 D-6 takes a pin only *"from a source Cloudflare cannot write"*: the card on the loopback
listener (ADR 0069 D-5, ADR 0080 in #2795), or a card a pinned device composes from its own pin.
None of the paths here (tailnet, Funnel, Cloudflare, mDNS) can write either of those card sources, so
each path's operator is excluded from being a pin source. A `ts.net` name, a Funnel URL, a Cloudflare hostname and an mDNS
answer are each an address and never a pin, and nothing in #2791 or #2805 may fetch the card
through them.

### D-10 — Questions for the owner

- **Q-1 (the epic's question 3)**: is a domain a paid service under ADR 0036 D-7? **Recorded as a
  Maintainer decision: yes** (D-1). If the owner rules no, D-2 and D-3 stay as options, and the
  Cloudflare tunnel may become the default again.
- **Q-2**: is the tailnet, with Funnel off, the right default (D-2), rather than Funnel as the epic
  suggested? **Recorded as a Maintainer decision: the tailnet**, because it keeps the instance
  closed to strangers.
- **Q-3**: is `/admin` not served on the public listener while Funnel is on (D-3)? **Recorded:
  yes.**
- **Q-4 (the epic's question 4)**: is LAN-only `http://` refused, for sealed routes too (D-6)?
  **Recorded as a Maintainer decision: refused.**
- **Q-5**: is mDNS discovery left unfiled (D-7)? **Recorded: yes.**
- **Q-6**: is Tailscale's non-commercial term acceptable for the default path? A household fits it.
  A club or business running an instance would need a paid Tailscale plan or the domain path, and
  that is the operator's choice, not a prerequisite an issue takes.

### D-11 — The owner's answers

**Owner ruling, 2026-11-18:** the owner was asked Q-1 to Q-6 in plain words, each with its
recommendation (*"Do you approve 1–6 as recommended?"*), and answered *"Yes"*. So:

- **Q-1**: a domain is a paid service under ADR 0036 D-7, so no issue may require one. The
  Cloudflare tunnel stays an option (D-1).
- **Q-2**: the default is the owner's tailnet with Funnel off (D-2).
- **Q-3**: `/admin` is not served on the public listener while Funnel is on (D-3).
- **Q-4**: LAN-only `http://` is refused, sealed routes included (D-6).
- **Q-5**: mDNS discovery is left unfiled (D-7).
- **Q-6**: Tailscale's non-commercial term is acceptable for the default path. A club or business
  chooses a paid plan or the domain path.

## Consequences

### What this enables

- **An install with no domain and no bill**: one free account, one app on each rider's device, and
  a stable `https://` origin the tablet trusts without a pasted certificate.
- **A private instance without a home-IP rule**: membership of the tailnet keeps strangers out, and
  it keeps working when the home address changes.
- **No TLS termination by a third party on the default path**, which is stronger than today on
  ADR 0069 D-3's terms.

### What this costs, stated plainly

- **A second app on every rider device.** On Android only one VPN runs at a time, so a rider who
  already uses another VPN must choose, or use Funnel.
- **A second proprietary control plane.** The project already depends on Cloudflare's; the default
  path now depends on Tailscale's instead, and on its free plan staying as it is.
- **Machine and tailnet names in public logs.** #2805 advises a machine name that says nothing
  about the owner.
- **Funnel's unknown bandwidth**, so rooms over Funnel are not promised.
- **Two paths to support in the wizard and the docs** instead of one, plus a third that experts run
  by hand.

### Constraints this places on other work

| Issue | What it must do |
|---|---|
| #2805 | Builds D-1 (the `tunnel` profile), D-2 (the `tailscale` profile and wizard step) and D-3 (the remote-path setting and the `/admin` 404 on the public listener while it reads `funnel`). Measures SSE, WebSocket and the client-address header **first**. Proves the `tailscale` container cannot reach the loopback listener. Documents the tailnet path first in `docs/self-hosting/home-machine.md`. |
| #2791 | Stands as the domain option (D-4). Is offered beside #2805's step, never ahead of it, and keeps its origin-change warning (D-8). |
| #2784 | Unchanged by this ADR. Its wizard is where #2805's and #2791's steps go. |
| `address.ts`, `no-network.test.ts` | Unchanged (D-6). |

## What would make this ADR wrong

- **`tailscale serve` buffers SSE or breaks a WebSocket.** Then the tailnet path cannot carry a
  write-up or a room, and D-2 needs another default. #2805 finds out before it builds.
- **Tailscale's free plan loses Funnel, HTTPS certificates or stable names, or stops being free.**
  Then D-1 leaves no no-domain path, and the owner decides between D-1 and the domain.
- **The coordination service can change a node's `serve` routes.** Then Tailscale is an edge with
  the routing power ADR 0069 D-5 guards against. D-5's condition on the container is the
  defence, and it must hold.
- **The Android WebView refuses or gates requests to a tailnet address.** Then the tablet cannot
  use D-2 without a change this ADR did not foresee. That is a tablet check (#733's kind) before
  #2805 merges.
- **A domain turns out to be needed after all**, for example because a wizard step can only be
  made safe on a hostname the owner controls. Then D-1 becomes the owner's decision, as ADR 0036's
  *"What would make this ADR wrong"* already says of hosting.
