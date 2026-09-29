# Spike 0017: Voice chat for rooms — a Discord bot, the Discord Social SDK, or WebRTC of our own

- **Date read**: **2026-09-29.** Every source in §9 was read on that day unless its row says
  otherwise. Every package licence was read with `npm view <name> license` on that day, and every
  repository licence with `gh api repos/<owner>/<repo>`. The repository was read on `main` at
  `12fb177`.
- **Issue**: [#794](https://github.com/openzigs/onyourleft/issues/794), from the owner's request of
  2026-09-28 to look at hooking in Discord so riders can talk to each other during group rides and
  races. [ADR 0038](../adr/0038-drafting-in-the-first-multiplayer-release.md) records the same
  evening's acceptance: *"Voice chat is to be evaluated in #794."*
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."* §8 **recommends**. The owner decides. **Nothing is built**
  (#794's fourth criterion), no product file changes, and **no issue is filed**: §8.3's list is a
  draft until the owner chooses.
- **Why 0017**: `docs/spikes/` holds 0001–0008 and 0010–0016 on `main`. **0009 is claimed** by
  [#471](https://github.com/openzigs/onyourleft/pull/471), which is still open. No open pull request
  or remote branch carries a 0017.
- **What was measured**: nothing. This is a **read**, of documentation, licences and this
  repository. Every claim about how a device behaves is marked as unverified and put in §5 as a
  check for a person with a phone.

> ## ⚠️ The answer in one paragraph
>
> **Recommend option A: a Discord bot on the instance, with the app showing a link.** Read on
> 2026-09-29, the bot needs **no dependency at all**. The instance runs Node 24
> ([ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) D-1), and every call the bot
> makes is a REST request that Node's own `fetch` can send. The instance also already knows when a
> room closes, so it can delete the room's voice channel then. It does not need to watch the
> channel empty through Discord's gateway, as TempVoice-style bots do. No voice goes through the
> owner's home upload link, which ADR 0037 D-8 names as the scarce resource. **Two findings change
> the plan #794 sketched.** (1) **A link alone cannot enforce a ban.** Without knowing a rider's
> Discord account, the instance can revoke an invite, but it cannot disconnect a rider who has
> already joined, and it cannot stop an invite being forwarded. The only remedy without identity is
> to rotate the channel: delete it and give a new link to the riders who remain. That is enough for
> a **private** room, where a leaked invite is no worse than a leaked room code. For **public** rooms
> (18+, moderated, #789) the rider has to link their Discord account (OAuth2 `identify` and
> `guilds.join`), so that a ban removes a role and disconnects them. (2) **Spike 0005 records a room
> as having "no audio".** Voice between riders is not a *cycling class delivered as audio from a
> server*, which is the claim element that row answers. But it changes a sentence the patent read
> rests on, so the owner should see it before anything ships (§6). **Reject option B.** The Social
> SDK has no JavaScript or web build, its licence is a limited, revocable grant that `DEP001` fails
> closed, and it would give Discord every rider's voice and identity, including riders with no
> Discord account. **Defer option C, do not reject it.** Chromium's WebRTC already does echo
> cancellation and noise suppression, which #794 lists as work to build. The real costs are the
> relay's bandwidth on a home connection, a TURN server, and moderating voice ourselves. **The
> owner's choice is not recorded here, because it has not been made.**

---

## 1. The question, and what #794 owes

| # | #794's acceptance criterion | Where this document answers it | State |
| --- | --- | --- | --- |
| 1 | Each option evaluated with dated sources, and every dependency's licence read | §3, §4, §5, §9 | **Done.** Every licence in the §3.4 table was read on 2026-09-29 |
| 2 | A recommendation made, and **the owner's choice recorded**. If B, the ADR issue filed | §8 | **Recommendation made. Owner's choice not recorded**: it has not been made. The pull request carrying this spike says `Refs #794`, not `Closes`, for that reason (`CLAUDE.md` §7) |
| 3 | If A is chosen, implementation sub-issues filed: the bot, the voice link in the app, moderation hooks, disclosures | §8.3 | **Drafted, not filed.** They depend on criterion 2 |
| 4 | Nothing is built | — | **Held.** This change adds documentation only |

---

## 2. What exists today that voice would touch — read from `main` at `12fb177`

| Piece | Where | What it means for voice |
| --- | --- | --- |
| The instance server | `apps/instance` (AGPL-3.0-or-later) | Node 24 (ADR 0037 D-1). Its manifest says *"Nothing but Node itself at runtime"*, and its runtime dependencies are three workspace packages and `kysely`. ADR 0037's constraint table: *"no dependency outside D-9 without a row like D-9's"*. **So a bot library is a licence and review decision, and the bot does not need one (§3.4)** |
| How the instance is configured | `apps/instance/src/config.ts` | `main.ts` reads `process.env` **by name**, so `ENV001` sees every variable, and a configuration that is wrong stops the instance at start-up. A bot token fits this shape (§3.5) |
| What the instance logs | `apps/instance/src/log.ts` | The method, the matched route, the status and the time taken. **Never** a path, a query, a header or a body, and an exception by its **name** only. A token sent in an `Authorization` header to Discord never passes through this logger. §3.5 lists the one way it could |
| The room protocol | `packages/protocol/src/messages.ts` (Apache-2.0) | `Hello` carries an opaque admission `ticket`; the room answers `Welcome` or `Refuse` (`ticket-refused`, `room-full`, `room-closed`, …). **A voice link would be one more optional field sent after admission**, never before, so a refused rider never sees it |
| Identity | #775, #855 (in progress) | Device keys, with an athlete account that binds them. **There is no Discord identity anywhere, and ADR 0028 D-6.2 says a ban must bind the athlete, not the key.** §3.3 is where that meets Discord |
| Moderation | #789 (not built) | A host removes a rider from their room. A moderator removes, hides a name or suspends. Every action writes an audit entry. **A removed rider's ticket is refused on rejoin.** Voice has to follow the same actions, or a removed rider keeps talking to the riders who removed them |
| Disclosures | #778 (not built) | The privacy policy, Play Data Safety and in-app text must name what leaves the device, to whom. Public rooms are **18+, self-declared** (owner ruling Q5, 2026-09-28) |
| The patent read | [spike 0005](0005-live-racing-patent-read.md) | Its table of what a room is says: *"There is no class, no course content, no video, **no audio** and nobody leading it"*. §6 |
| Opening a link from the app | `apps/web/src/views/AboutView.tsx` | Links use `target="_blank"` so that, inside the Android shell, *"following it … hands the URL to the system browser rather than navigating the WebView the app is running in"*. A voice link would do the same. Whether Android then opens the Discord app is a device check (§5, V2) |

---

## 3. Option A — a Discord bot on the instance; the app shows a link

### 3.1 What the bot has to do, and the endpoints it needs

All from Discord's API reference, read 2026-09-29 (§9, S1–S3).

| Step | Endpoint | Permission the bot needs |
| --- | --- | --- |
| A room opens: make its voice channel | `POST /guilds/{guild.id}/channels` (type voice) | `MANAGE_CHANNELS` |
| Make a link for it | `POST /channels/{channel.id}/invites`. `max_age` defaults to 86 400 s and is at most 604 800 s (7 days); `max_uses` is 0 (unlimited) to 100; `temporary` *"only grants temporary membership"*; `unique` never reuses an existing invite | `CREATE_INSTANT_INVITE` |
| Restrict the channel to a role or a person | `PUT /channels/{channel.id}/permissions/{overwrite.id}` (a role or user id, with `allow` and `deny` bits) | `MANAGE_ROLES` |
| The room closes: remove the channel | `DELETE /channels/{channel.id}` | `MANAGE_CHANNELS` |
| **Linked riders only**: add them to the server with the room's role | `PUT /guilds/{guild.id}/members/{user.id}`. This needs *"a valid oauth2 access token for the user with the `guilds.join` scope"*, and the bot must be a member with `CREATE_INSTANT_INVITE`. Assigning roles here also needs `MANAGE_ROLES` | as stated |
| **Linked riders only**: disconnect a removed rider | `PATCH /guilds/{guild.id}/members/{user.id}` with `channel_id: null`: *"this will force the target user to be disconnected from voice"* | `MOVE_MEMBERS` |
| **Linked riders only**: take the room's role away, or remove them from the server | `DELETE /guilds/{guild.id}/members/{user.id}/roles/{role.id}`, `DELETE /guilds/{guild.id}/members/{user.id}` | `MANAGE_ROLES`, `KICK_MEMBERS` |

### 3.2 Finding: the lifecycle needs no gateway connection

#794 describes the TempVoice and VoiceMaster pattern: *"deletes it when empty"*. Those bots find
out a channel is empty from Discord's **gateway**, a WebSocket carrying voice-state events. The REST
API has **no endpoint that lists who is in a channel**: it can return **one** user's voice state
(`GET /guilds/{guild.id}/voice-states/{user.id}`), not a channel's (S2).

**The instance does not need to know when the channel is empty. It knows when the room closes.** A
room's lifetime is the instance's own state (#784: the route blob is *"deleted from the instance
when the room closes (after its grace period)"*). The voice channel can be created and deleted at the
same two points. That makes the bot a handful of REST calls made by code that already runs, with:

- no long-lived outbound connection;
- no gateway intents to request;
- no reconnect logic;
- nothing that has to stay running while no room is open.

The cost is that a channel lives until the room closes rather than until the last person leaves,
which does not matter.

⚠️ **The one reason to add the gateway later** is to find out which Discord user used which invite,
for public rooms without account linking. Bots do this by comparing invite use counts before and
after each join, and that breaks when two riders join at once. §3.3 recommends linking instead,
which needs no gateway either.

### 3.3 Finding: a link alone cannot make a ban hold

#794 asks that *"a banned rider loses the voice link"*. That holds only for a rider who has not yet
used the link. Discord's model has two layers:

1. An **invite** makes someone a member of the Discord server.
2. **Channel permissions** decide which members can see and join which channel.

If the instance does not know a rider's Discord account, it cannot tell Discord which member is
which rider. Two designs follow:

| | **A-link: link only** (no Discord identity reaches the instance) | **A-linked: the rider links their Discord account** (OAuth2 `identify` + `guilds.join`) |
| --- | --- | --- |
| What the rider does | Presses *Join voice on Discord*. Discord opens and they join through a temporary, room-scoped invite | Links their Discord account once, in Settings. After that, *Join voice* opens the channel, which they can already join |
| What the instance holds | A channel id and an invite per room | Also a Discord user id per linked athlete, which is **a new data class** (§7) |
| A rider removed or banned **before** joining voice | ✅ Their ticket is refused, so they never receive the link | ✅ As link-only, and they never get the room's role |
| A rider removed or banned **while in** voice | ❌ The instance cannot find them. **Remedy: rotate.** Delete the channel, which disconnects everyone, create a new one, and send the new link to the riders who remain. Everyone has to rejoin | ✅ Remove the role, then `PATCH` `channel_id: null`. Only that rider is disconnected |
| An invite forwarded to a stranger | ❌ Anyone with the link can join until `max_uses` or `max_age` runs out. **Mitigated** by setting `max_uses` to the room's size and rotating on removal | ✅ The channel denies everyone without the room's role. An invite gets a stranger into the server, not into the room |
| A member of room X joining room Y's channel | ❌ Every room channel has to be joinable by the whole server, because the bot cannot give out per-room roles. **Mitigated, not fixed**, by temporary invites (members who were never given a role do not stay members) | ✅ One role per room |
| Suits | **Private rooms.** Riders who share a room code already trust each other, and a leaked invite is no worse than a leaked code | **Public rooms** (18+, moderated, #789). ADR 0028 D-6.2: a ban has to bind the athlete |

⚠️ **Discord moderates its own service as well.** A ban on our instance does not ban anyone from
Discord, and a Discord ban does not ban anyone from a room. Two moderation systems apply to one
voice channel, and the operator page #789 requires must say so.

### 3.4 Dependencies, and every licence read

Read on 2026-09-29 with `npm view <name> version license` (and `dependencies` for each closure).

| Choice | What it pulls in | Licences in its closure | Under `apps/instance` (ADR 0015, ADR 0025 D-5) |
| --- | --- | --- | --- |
| **Node's own `fetch`** (recommended) | nothing | — | **Nothing to review.** Keeps the manifest's *"Nothing but Node itself"* and needs no ADR 0037 D-9 row |
| `@discordjs/rest` 2.6.3 | `@discordjs/util` 1.2.0, `@discordjs/collection` 2.1.1, `discord-api-types` 0.38.56, `@sapphire/snowflake` 3.5.5, `@sapphire/async-queue` 1.5.5, `@vladfrangu/async_event_emitter` 2.4.7, `magic-bytes.js` 1.13.1, `tslib` 2.8.1, `undici` ^6 | Apache-2.0 (the `@discordjs` packages), MIT (the rest), **0BSD** (`tslib`) | Permissive, plus 0BSD, which is on ADR 0015 D-2's *weak* list. **Admitted** in a distributed closure under `apps/`. Needs a D-9 row |
| `discord.js` 14.27.0 | all of the above, plus `@discordjs/ws` (→ `ws` 8.22.0), `@discordjs/builders` 1.14.1 (→ `@sapphire/shapeshift` ^4 → `lodash` 4.18.1, `fast-deep-equal` 3.1.3; `ts-mixer` 6.0.4), `@discordjs/formatters` 0.6.2, `lodash.snakecase` 4.1.1 | Apache-2.0, MIT, 0BSD | Admitted, as above. **A gateway client the bot does not need (§3.2)** |
| `eris` 0.18.0 | `ws` | MIT | Admitted. Its repository was last pushed on 2025-09-28 (`gh api`), a year before this read |
| `oceanic.js` 1.15.0 | `tslib`, `ws` | MIT, 0BSD | Admitted |

Repository licences were cross-checked with `gh api`: `discordjs/discord.js` Apache-2.0,
`abalabahaha/eris` MIT, `OceanicJS/Oceanic` MIT. **Nothing in any of these closures is copyleft or
non-OSI**, so none of them needs a licence ruling. The recommendation is still to use none of them:
about six REST calls are not worth a dependency tree, and the rate-limit handling
`@discordjs/rest` would add (queueing, honouring `429` and `retry_after`) is a small amount of code
at a room's rate of about one request a minute.

⚠️ **Discord's own terms apply whichever library is used.** The Discord Developer Terms of Service
and Developer Policy bind the operator of the bot application. **They were not read for this spike**
beyond the fact that they exist (S6). Reading them is a sub-issue in §8.3.

### 3.5 The bot token is a secret the instance holds

- It arrives as an environment variable, say `OYL_INSTANCE_DISCORD_BOT_TOKEN`, read by name in
  `main.ts`. It is listed in `.env.example` with an **empty** value (`ENV001`), next to the guild id,
  which is not secret.
- **Unset means voice is off**, not an error: an instance with no Discord configuration still starts,
  and rooms show no voice link. This is the reverse of `config.ts`'s rule for the source URL, and it
  is deliberate: voice is optional, and the §13 source offer is not.
- It travels only in the `Authorization: Bot …` header of requests to `discord.com`. `log.ts` logs
  none of the instance's **outbound** requests, and none of any request's headers.
- ⚠️ **The one way it could leak is an error message.** An exception thrown while calling Discord
  must be logged by name only, as `log.ts` already does for inbound requests. A test in `log.test.ts`
  style should call the bot against a double that throws an error whose message contains the token,
  and read every line written.
- The token belongs to a bot account, which should be scoped to one server and have only the
  permissions in §3.1. Discord bot tokens do not expire on their own, so a leaked token has to be
  reset in the Developer Portal (S6). The operator page should say where.

### 3.6 What option A costs

- **The rider needs a Discord account and the Discord app.** Riders who have neither get no voice.
- **Discord receives the voice and the Discord identity of every rider who joins.** That is the
  rider's choice, per room, and has to be disclosed as such (#778).
- **Riders talk in another app.** On Android they use Discord alongside the game, and how well that
  works is §5's question.
- **The owner operates a Discord server and a bot application**, and is responsible for them under
  Discord's terms.
- **Nothing on the home upload link.** Voice goes rider → Discord → rider. The instance makes about
  six HTTPS requests per room.

---

## 4. Option B — the Discord Social SDK inside the app

### 4.1 What it is — read 2026-09-29

- **Languages** (S4): *"The SDK is available for C++, Unity, and Unreal Engine."* The compatibility
  page lists Standalone C++ (C++20+), Unity 2021.3+ and Unreal Engine 5.5+, and **no web,
  JavaScript or browser build**.
- **Platforms** (S5): Android 7.0+ and iOS 15.1+ are *Generally Available*. Linux is *Experimental*.
- **Features** (S4): account linking, rich presence, game invites, direct messages, and *"Lobbies
  and Voice Chat"* on Discord's infrastructure. **Provisional accounts** let players without a
  Discord account take part: *"regardless of whether they have or want a Discord account."*
- **Terms** (S7): the *Discord Social SDK Terms*, effective 2025-03-17. ⚠️ **The primary page
  answered `403 Forbidden` to this read.** What follows comes from a search engine's summary of it
  and should be read first-hand before anyone relies on it: *"a limited, non-exclusive,
  non-transferable, non-assignable, revocable license to use the Discord Social SDK … and to
  distribute the Discord Social SDK as integrated into [the] Application."*

### 4.2 Why it is rejected

1. **It cannot run in this client as it is.** Everything this app draws is `apps/web`, running in a
   WebView (§4h of `CLAUDE.md`). The SDK has no JavaScript build, so it would need a **native
   Capacitor plugin** wrapping the C++ SDK on Android, and another later on iOS. The browser build
   would have no voice at all.
2. **Its licence is not open source.** A revocable, non-transferable grant is not OSI-approved.
   `CLAUDE.md` §3: *"Anything non-OSI … fails everywhere and needs an ADR before it is even
   discussed."* ⚠️ **No gate here would catch it.** `DEP001` reads the npm graph, and §4g says it
   *"cannot see native dependencies"*. The APK's native closure is checked only against the reviewed
   `apps/mobile/native-closure.json`, and not in CI. So this licence would be caught by review or
   not at all.
3. **It sits badly with ADR 0025's app-store permission.** That permission is granted by this
   project's copyright holders over their own AGPL code. A proprietary binary linked into the APK is
   not theirs to license. ADR 0025 D-5 was written about third-party **copyleft**, but its point
   applies here too: the project cannot grant permissions over code it does not own. Combining a
   proprietary library with an AGPL application is a question for the copyright holders, and so for
   every contributor. It is not something a pull request can settle.
4. **It gives Discord more than option A does.** Voice and identity reach Discord through code this
   project ships and cannot inspect. With provisional accounts, **a rider who never agreed to
   anything with Discord still gets a Discord record**. The privacy claim that holds for option A,
   that Discord sees only riders who chose it, does not hold here.

**If the owner still wants B**, #794 requires an ADR issue. Its content is §4.2 items 2 and 3. It is
not filed, because nothing recommends B.

---

## 5. Open questions on the device — a procedure with empty cells

None of these can be answered from documentation. They are for a person with the owner's tablet or
an Android phone, the APK, and the Discord app. **Every cell is empty.**

| # | Question | How to check | Result |
| --- | --- | --- | --- |
| V1 | Does Discord's voice keep running while this app is in the foreground and recording a ride (the `connectedDevice` foreground service, #524)? | Join a voice channel from a second phone, open the app, ride for 20 minutes with the screen on, and listen for drop-outs from the other end. Then repeat with the screen off | |
| V2 | Does *Join voice on Discord*, opened with `target="_blank"` from the Android shell, open the Discord app, or a browser tab? | Press it with the Discord app installed, then with it uninstalled | |
| V3 | Do the ride's own sounds (#400) duck, get ducked, or stop while Discord holds the audio? | Turn sounds on, join voice, and trigger a climb cue | |
| V4 | Do Bluetooth headphones and the trainer and heart-rate straps work together? Classic Bluetooth audio and BLE share one radio | Ride with Bluetooth headphones on voice and the trainer in ERG. Look for missing readings in the HUD, and at the saved ride's gaps afterwards | |
| V5 | Can a rider be heard over a trainer and a fan? | Record the other end for a minute at 250 W with the fan on | |

The Discord app does show a *"Voice connected"* notification on Android, which suggests it runs voice
in a foreground service. That comes from Discord's own notification settings page (S8). **It was not
checked on a device and is not evidence for V1.**

---

## 6. The patent read, and why the owner should see it

[Spike 0005](0005-live-racing-patent-read.md) §1.1 describes a room as having *"no class, no course
content, no video, no audio and nobody leading it"*. The claim elements that row answers (§3.1–§3.3 of
that spike) are about **class content sent from a server**: *"sending digital video and audio content
comprising the selected cycling class from a server"*, a class *"led by at least one instructor"*,
and *"content … comprising video content and audio content and at least one synchronizing signal"*.

Voice between riders is not class content, it is not sent by this project's server under option A,
and it carries no synchronising signal. **This spike does not find that voice brings any of those
elements back.** Two things are still worth the owner's attention, because spike 0005 §3.1 and §4 say the
*cycling class* element carries **the whole distance** between this design and US 9,174,085 claim 1:

- **Voice makes it easy to lead.** A rider talking a group through efforts is close to an
  instructor, even though the product has no instructor role. [ADR 0028](../adr/0028-racing-fairness.md)
  D-7.2 (*"No instructor, and nobody leading a session"*) is about what the product builds, and
  nothing in §8 builds a leader. But the product would then carry voice in a room, which spike
  0005's table says it does not.
- **Option C sends audio through this project's server.** A TURN relay carries riders' voice through
  the instance. It is still not class content, but it is audio sent from a server this project
  operates, which is nearer to that element's wording than option A is.

This is a note for the owner, **not a legal reading**. Spike 0005 is not edited: a later finding is a
new write-up (`CLAUDE.md` §7).

---

## 7. Option C — our own voice over WebRTC

### 7.1 What it needs

| Part | What exists | What is missing |
| --- | --- | --- |
| Capture and playback | Chromium's `getUserMedia`. Its `echoCancellation`, `noiseSuppression` and `autoGainControl` constraints are built into WebRTC. **#794 lists "building echo cancellation, noise suppression" as work; they come with the platform.** How well they cope with a trainer and a fan is unmeasured (V5 applies here too) | Nothing to build. Tuning, maybe |
| A peer connection between two WebViews | [Spike 0012](0012-webrtc-webview-to-webview.md) and [spike 0011](0011-webrtc-host-only-on-the-lan.md): a data channel between WebViews on **one LAN** with host candidates only | **Everything across the internet**: STUN to find a public address (a third party, or ours), and TURN when both riders are behind NAT that blocks a direct path |
| Signalling | The room's WebSocket (ADR 0037 D-3) could carry offers and answers | Protocol messages, and their tests |
| A relay | `coturn` (its LICENSE is a BSD-3-Clause-style text, which `gh api` reports as `NOASSERTION`), or `pion/turn` (MIT) | Running one next to the instance, with credentials |
| Moderation | Entirely ours: the instance can drop a rider's media at once | Building it |
| Disclosure | Voice stays within the project's own infrastructure | A new data class in #778: audio, relayed but never stored |

### 7.2 What it costs the home upload link — arithmetic, not measurement

Assume Opus at **32 kbit/s** per voice. This figure was **chosen**, not measured, and the formulas
matter more than the result.

- **A full mesh with no relay**: each rider uploads to every other rider, so `(N−1) × 32` kbit/s,
  which is 288 kbit/s in a 10-rider room. The instance uploads nothing, but the whole room fails if
  any pair cannot connect.
- **Every voice relayed through the box (an SFU or TURN for every pair)**: the box uploads
  `N × (N−1) × 32` kbit/s, which is **2.88 Mbit/s** for one 10-rider room and **12.2 Mbit/s** for one
  20-rider room.

ADR 0037 D-8 says the owner's upload *"has not been measured"* and binds before memory does, and
spike 0013 puts a home connection at tens of rooms. At these figures, **one relayed 20-rider room
uses more upload than the room traffic of every room on the box.** That is why C is deferred rather
than chosen: its cost falls on exactly the resource ADR 0037 says is scarce.

### 7.3 Why it is deferred rather than rejected

C is the only option with no third party in it and no Discord account required. If Discord's terms,
its data handling, or requiring a Discord account turn out to be unacceptable, C is the way out. A
mesh for **small private** rooms, with TURN only for the pairs that need it, costs far less than
§7.2's worst case. §7.2's arithmetic is the reason not to start there.

---

## 8. Recommendation

### 8.1 What this spike recommends

1. **Option A, REST only, with no dependency**: Node's `fetch` against the §3.1 endpoints. The
   channel lives exactly as long as the room (§3.2).
2. **Private rooms first, link only (A-link).** A temporary invite with `max_uses` set to the room's
   size and `max_age` set to the room's expected lifetime, sent in `Welcome` after admission, and
   rotated when a rider is removed.
3. **Public rooms only with account linking (A-linked)**, so that a ban binds (§3.3). Until linking
   exists, public rooms get no voice.
4. **Voice is off unless the instance is configured for it**, and it is **opt-in per room for each
   rider**. The app sends nothing about Discord anywhere unless the rider links an account.
5. **Reject B**, for §4.2's four reasons.
6. **Defer C**, for §7.2's arithmetic, and revisit it if A's third party is not acceptable.

### 8.2 The owner's choice

**Not made, and not recorded.** #794's second criterion stays open until the owner answers on the
issue.

### 8.3 Draft sub-issues, to file if the owner chooses A (not filed)

1. **The voice bot in `apps/instance`**: channel, invite and rotation over REST with no dependency;
   the token and guild id as environment variables (unset means off); a test that proves an error
   carrying the token is logged by name only; the channel deleted when the room closes, asserted
   against a double of Discord's API. Blocked by #784.
2. **The voice link in the app**: an optional field in `Welcome` (`packages/protocol`); a *Join voice
   on Discord* link in the room screen, opened with `target="_blank"`, that says it opens Discord;
   never shown before admission; `test:a11y`. Blocked by #784 and #778.
3. **Moderation hooks**: #789's remove and ban rotate the channel (link only) or remove the role and
   disconnect the rider (linked). The audit entry records the voice action too. Blocked by #789.
4. **Account linking for public rooms**: OAuth2 `identify` + `guilds.join`; what the instance stores
   (a Discord user id per athlete, erased with the account, #35); unlinking. Blocked by #775.
5. **Disclosures**: the privacy policy, Play Data Safety and the in-app sentence name Discord as a
   third party the rider chooses, and what it receives (voice; for linked riders, their Discord id
   joined to their athlete). The operator page covers the two moderation systems (§3.3). Folded into
   #778, or filed beside it.
6. **Read Discord's Developer Terms of Service and Developer Policy** for a bot run by a self-hosted
   operator, and the Social SDK Terms first-hand (§4.1), before 1 ships.
7. **Validation**: §5's V1–V5 on the owner's tablet, results in `docs/validation/`.

---

## 9. Sources

| # | Source | Read | What it gave |
| --- | --- | --- | --- |
| S1 | Discord API reference, *Guild* resource — `https://docs.discord.com/developers/resources/guild` | 2026-09-29 | Create Guild Channel; Modify Guild Member (`channel_id: null` disconnects); Add Guild Member (`guilds.join`); role and member removal. **No per-guild channel limit stated on that page** |
| S2 | Discord API reference, *Voice* resource — `https://docs.discord.com/developers/resources/voice` | 2026-09-29 | Voice state for one user only (`/voice-states/@me`, `/voice-states/{user.id}`); no per-channel list |
| S3 | Discord API reference, *Channel* resource — `https://docs.discord.com/developers/resources/channel` | 2026-09-29 | Create Channel Invite and its parameters; Delete Channel; Edit Channel Permissions |
| S4 | *Social Layer for Games* — `https://docs.discord.com/developers/platform/social-layer` | 2026-09-29 | Languages, features, provisional accounts |
| S5 | *Platform Compatibility* — `https://docs.discord.com/developers/discord-social-sdk/core-concepts/platform-compatibility` | 2026-09-29 | The platform table; no web |
| S6 | Discord Developer Terms of Service (`https://support-dev.discord.com/`) | 2026-09-29, **existence only** | Not read in substance. §8.3 item 6 |
| S7 | *Discord Social SDK Terms* — `https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms` | 2026-09-29, **`403 Forbidden`** | The effective date and licence grant, through a search engine's summary only |
| S8 | Discord, *[Mobile] Notifications Settings 101* — `https://support.discord.com/hc/en-us/articles/218892547` | 2026-09-29, through a search summary | The *"Voice connected"* notification. Not evidence for V1 |
| S9 | npm registry, `npm view` for every package in §3.4 | 2026-09-29 | Versions, licences and dependency lists |
| S10 | GitHub API, `gh api repos/…` for `discordjs/discord.js`, `abalabahaha/eris`, `OceanicJS/Oceanic`, `coturn/coturn`, `pion/turn` | 2026-09-29 | Repository licences; last-push dates |
| S11 | This repository at `12fb177` — ADR 0028, 0036, 0037, 0038; spikes 0005, 0011, 0012, 0013; `apps/instance/src/config.ts`, `log.ts`; `packages/protocol/src/messages.ts`; issues #778, #784, #789 | 2026-09-29 | §2 |
