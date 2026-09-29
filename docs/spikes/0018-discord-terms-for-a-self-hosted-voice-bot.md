# Spike 0018: Discord's Developer Terms, Developer Policy and Social SDK Terms, read first-hand for a self-hosted operator's voice bot

- **Date read**: **2026-09-29.** Every source in §9 was read on that day. The repository was read on
  `main` at `a33c177f`.
- **Issue**: [#873](https://github.com/openzigs/onyourleft/issues/873), filed from
  [spike 0017](0017-voice-chat-for-rooms.md) §8.3 item 6 after the owner chose **option A** on
  2026-09-29 ([#794](https://github.com/openzigs/onyourleft/issues/794)). Epic
  [#16](https://github.com/openzigs/onyourleft/issues/16).
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."* This one is a **reading** of three legal documents and
  five pages of API documentation. It is **not legal advice**, and nothing here was checked by
  counsel.
- **Why a second write-up rather than an edit to 0017**: 0017 §3.4 and §4.1 say the Developer Terms
  were not read and the Social SDK Terms answered `403`. Those were true on the day and stay true of
  that read. `CLAUDE.md` §7: *"if a later run contradicts it, that is a second write-up."* Spike 0017
  is not edited.
- **Why 0018**: `docs/spikes/` holds 0001–0008 and 0010–0017 on `main`. **0009 is claimed** by
  [#471](https://github.com/openzigs/onyourleft/pull/471), still open. No other open pull request and
  no remote branch carries a file under `docs/spikes/` that `main` lacks (checked with
  `gh pr diff --name-only` on every open pull request and `git ls-tree` on every remote branch).

> ## ⚠️ The answer in one paragraph
>
> **Option A can ship, with changes; nothing read forbids the pattern.** A bot that creates a voice
> channel per room, makes temporary invites, and deletes both when the room closes is ordinary use
> of the documented REST API. Adding a rider to a server with `guilds.join` is allowed **with the
> rider's explicit, clearly labelled permission** (Developer Policy rule 1 names *"adding the account
> to a server"* as its example). **The developer is the operator.** Each operator who runs the bot
> accepts the Developer Terms for their own Application, and this project, as the author of the
> code, is not a party unless it runs an instance itself. **Nine things in the design have to
> change or be added (§7).** The largest four: (1) **no Application ID, client ID, client secret or
> token may be in this repository or in a web build**, because the Terms say *"developer credentials
> may not be embedded in open source projects"* and list the Application ID as a credential; (2)
> **API Data must be encrypted at rest**, and the instance's SQLite database and its backups are not
> encrypted today; (3) **each operator must publish a privacy policy** that covers Discord data and
> link it in the Developer Portal and from the app; (4) **honouring rate limits is a term of the
> licence**, not only good engineering, so the "small amount of code" 0017 §3.4 described is
> required. **One question could not be settled by reading.** The Social SDK Terms define "the
> Discord Social SDK" to include *"Discord login or authentication methods, Discord account linking"*.
> If that covers plain OAuth2 account linking, the public-room design would bind the operator to
> those terms too, including a clause against developing anything that *"could, directly or
> indirectly, compete with … other Discord services"*. **Recommendation: ship private-room voice
> (link only, no OAuth2) first, and hold public-room account linking until Discord's developer
> support answers that question in writing (§8).** The Social SDK licence grant is recorded
> first-hand in §6. It confirms the wording 0017 took from a search summary and adds to it.

---

## 1. What #873 asks, and where it is answered

| # | #873's criterion | Where | State |
| --- | --- | --- | --- |
| 1 | Read the Developer Terms of Service and Developer Policy **in substance** for a bot run by a self-hosted operator: what an operator agrees to, data retention, rate limits, and anything forbidding the pattern | §3, §4, §5 | **Done.** Both read in full, first-hand, on 2026-09-29 (§2 says how, given the `403`) |
| 2 | Read the Social SDK Terms first-hand, and record the licence grant either way | §6 | **Done.** Read in full; the grant is quoted |
| 3 | Record the findings with dates, and say whether option A can ship as designed | the whole document; §7, §8 | **Done.** It can ship **with the changes in §7**. One question (§8, Q1) could not be settled by reading and holds back public-room account linking only |

---

## 2. How the pages were read, given the `403`

This matters because 0017's S7 was a `403`, and because a first-hand read and a summary are
different evidence (`CLAUDE.md` §6's trademark section is the precedent for saying which is which).

- **The HTML pages are behind a Cloudflare challenge, and a script cannot read them.** On 2026-09-29,
  `https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service` and
  `…/developer-policy` answered `301 Moved Permanently` to `docs.discord.com/…`, which redirected to
  `support-dev.discord.com/hc/articles/8562894815383-…` and `…/8563934450327-…`. Those answered
  **`403`** with a page titled *"Just a moment..."*, which is Cloudflare's browser challenge. The
  Social SDK Terms page (`…/30225844245271-…`) did the same.
- **The same articles were read through the help centre's own JSON API, on the same host.**
  `support-dev.discord.com` is a Zendesk help centre, and
  `https://support-dev.discord.com/api/v2/help_center/en-us/articles/<id>.json` answered **`200`**
  for all three, with the article's title, URL, body and edit dates. **This is Discord's own server
  returning the article's own body**, so it is counted here as a **first-hand** read. The body was
  HTML, converted to text for reading. Every quotation below is from that text. ⚠️ It is not the
  page as a browser renders it: a banner, a sidebar or a linked sub-page that is not in the article
  body would not be in it.
- **The API documentation was read as Markdown.** `docs.discord.com` serves each page's source at
  `<page>.md` (the Mintlify convention its own `llms.txt` index names). Every page read that way
  answered `200` with `text/markdown`.
- **Nothing was read from memory.** One figure came from a search result and then a first-hand read:
  the per-server caps in §5.3, from Discord's *Account Caps* article, read through the same JSON API
  on `support.discord.com`.

---

## 3. Who "the developer" is when an operator runs this project's code

**The operator.** The Developer Terms (effective 2024-07-08, last updated 2024-06-06; S1) bind whoever
accepts them or operates an Application:

> *"By accepting these Developer Terms of Service, creating or operating an Application, or otherwise
> accessing or using our APIs, you agree to comply with the Terms"* (§1(a))

> *"'Application' (or 'app') means any application (including any bot, game, activity, website, or
> other client) that accesses or uses our APIs or to which we have assigned an Application ID. 'your
> Application' means any Application that you own or operate."* (§13)

A self-hosted operator creates their own Application in the Developer Portal, holds its bot token,
and runs the instance that calls the API. **They are "you".** This project writes code and runs
nothing for them, so it accepts nothing on their behalf. **Where the owner runs an instance, the
owner is "you" for that instance**, and every obligation in §4 and §5 is theirs.

Three consequences follow for how the code is written:

1. **Each operator must register their own Application.** The Terms forbid sharing credentials
   across Applications: *"You will use any developer credentials (such as your Application ID,
   passwords, keys, tokens, and client secrets) we assign to you solely with your Application … (and
   will not permit or enable any other Application to use them)"* (§2(d)).
2. **No credential may be in this repository.** The same clause ends: *"For the avoidance of doubt,
   developer credentials may not be embedded in open source projects."* ⚠️ **The Application ID is
   named as a credential.** So the OAuth2 client ID, which is the Application ID, must also come from
   the operator's configuration at run time. It must not be written into `apps/web`, a build-time
   variable, a fixture or a test. 0017 §3.5 already made the token and guild ID environment
   variables. This extends the rule to the client ID and client secret.
3. **The operator is responsible for the Application's users.** *"You are solely responsible for your
   Application … You will require users to comply with all applicable laws and regulations and the
   Terms (including our Terms of Service)"* (§3(b)). The operator page #789 requires has to say so.

The Terms are also **assignable only with Discord's consent** (§12(f)), and a self-hosted operator
cannot take over another operator's Application. That supports rule 1 above: every instance has its
own.

---

## 4. What an operator agrees to — the Developer Terms, in substance (S1)

Only the clauses that bear on a voice bot are listed. The Terms also incorporate the Developer
Policy (§5 below), Discord's user Terms of Service and Community Guidelines, and the API
documentation. **Discord's user Terms of Service and Community Guidelines were not read for this
spike**; the Developer Policy quotes the parts of them it relies on.

| Clause | What it says (quoted) | What it means for option A |
| --- | --- | --- |
| §1(a) Age | *"you are at least 13 years of age and meet the minimum age required by the laws in your country"* | Applies to the **operator**. Not a design constraint |
| §2(a) Licence | *"a limited, non-exclusive, non-sublicensable, non-transferable, non-assignable, revocable license to access and use the APIs … solely as necessary to integrate with, develop, and operate your Application"* | The whole of option A rests on a **revocable** licence. §9(a) lets Discord end it *"at our convenience upon notice to you"*. Option C (0017 §7) remains the exit, which is why 0017 deferred it rather than rejecting it |
| §2(b) Restrictions | Not to access the APIs in a way that *"(iv) exceeds any API rate, call, or other usage limits we set in our sole discretion … or that we believe constitutes excessive or abusive usage"*; and not to *"redistribute, rent, lease, sell, or syndicate access to the APIs"* | **Honouring rate limits is a term, not only good practice** (§5.2 below). Riders never call the API themselves, so the instance does not syndicate access to it |
| §2(d) Credentials | Quoted in §3. Also: *"you will keep API keys and tokens encrypted in any files or other materials accessible by third parties (other than your Service Providers …)"* | No credential in the repository. A token in an operator's own `.env` on their own machine is not accessible to third parties. A hosting provider that can read it is a Service Provider (§12(a)) |
| §3(a) App Content licence | Discord receives a licence to *"App Content"*: *"any data … that you … add to our services … (including as submitted, posted, or displayed by or through your Application)"* | **A channel name and an invite are App Content.** Nothing a rider typed should become a channel name (§7, item 8) |
| §4 Rights | *"You represent and warrant that you have obtained and will maintain all necessary rights (including from your users) … to access, use, and otherwise process users' API Data"* | The rider's consent screen for account linking is where those rights come from (§5.1, rule 1) |
| §5(a) Privacy policy | *"You will provide and adhere to a privacy policy for your Application that … clearly, accurately, and fully describes to users of your Application what data you collect, how you use and share such data with us and third parties, and how users can request deletion of such data."* And: *"You will maintain publicly available, up-to-date links to your privacy policy in the Developer Portal and make it easily accessible to users from your Application."* It names GDPR, UK GDPR, LGPD, CCPA and CPRA | **Every operator needs a published privacy policy that covers Discord**, linked in the Portal and from the app. For the owner's instance, that is `docs/privacy-policy.md` under #778. For anybody else's, the operator page must say it is theirs to write |
| §5(b) Sharing | API Data may be shared only with a Service Provider, where law requires it, or *"when a user of your Application expressly directs you to share their API Data with the third party"* | The instance shares no API Data. It stores a channel ID and invite per room, and a Discord user ID for each linked rider |
| §5(b) **Retention** | *"you will … promptly delete the API Data when: (a) retaining it is no longer necessary for your Application's stated … functionality …; (b) you stop operating your Application …; (c) we request you delete it; (d) the applicable user requests you delete it"*. And: *"You will give users an easily accessible way to ask for their API Data to be modified and deleted."* | Channel IDs and invites are deleted when the room closes, which 0017 already does. A linked rider's Discord user ID is deleted on **unlink**, on **account erasure** (#35), and when the operator **turns voice off**. OAuth2 tokens are API Data too: *"API Data includes your developer credentials and access tokens"* (§13). So **do not keep them** (§7, item 4) |
| §5(c) **Security** | *"These efforts will include: (i) encryption of the data at rest and (ii) maintaining administrative, physical, and technical safeguards"*. The operator must notify users of unauthorised access *"to the extent required by applicable laws"*, and must *"promptly notify us"* of any incident involving API Data | ⚠️ **ADR 0037 D-5's SQLite database is not encrypted at rest, and neither are its Litestream backups.** Any API Data the instance keeps must be. §7, item 3, and §8, Q2 |
| §6 Monitoring and App Review | Discord may monitor API use, and may require App Review *"when use of your Application reaches certain thresholds"* | See §5.3: the documented threshold is 100 servers, and each operator's bot is in one |
| §9(a) Inactive tokens | *"we may also limit, suspend, or terminate your Application's access tokens … that have not been used or accessed within at least the prior 30-day period, with or without notice to you"* | ⚠️ **An instance with no voice room for 30 days can find its bot token dead.** The bot must treat `401` as "voice is off" and say so in the operator log, not retry (which also matters for §5.2's invalid-request limit) |
| §9(b) After termination | Stop using the APIs and credentials and *"delete any cached or stored API Data"* | The operator page must say what "turning voice off" deletes |
| §10(c) Indemnity | The operator indemnifies Discord for claims relating to *"access to or use of the APIs or API Data by you … your Application, or your users"* | A risk the operator carries, including the owner for their own instance. Not a design constraint |
| §11 International transfers | For personal data from Discord's EU entity, standard contractual clauses (Module One, controller to controller) apply automatically, with the operator as *"data importer"* | The operator is a **controller** of any rider data they obtain from Discord. The privacy policy (#778) has to be written on that basis |
| §12(e) Disputes | Discord's user Terms' arbitration clause applies; *"the date for emailing an opt-out notice is within 30 days of July 8, 2024 or when you first create an Application, whichever is later"* | ⚠️ **A 30-day window opens when an operator creates their Application.** Whether to opt out is a legal choice for each operator. §8, Q4 |

---

## 5. The Developer Policy, and the API's own limits

### 5.1 The Developer Policy (effective 2024-07-08; S2)

It is incorporated into the Developer Terms. Each rule that touches option A:

| Rule | Quoted | Effect on option A |
| --- | --- | --- |
| 1 | *"Do not modify a Discord user's account without explicit permission from the Discord user. Functionality that intends to make any changes to a Discord account (e.g., adding the account to a server) must clearly and properly inform the Discord account owner of the changes and receive explicit permission to enact the changes."* | **This rule allows `guilds.join` and sets its condition.** The linking screen must say, before Discord's own consent screen, that linking **adds the rider's account to the operator's server** (named), and gives it a role per room. §7, item 5 |
| 2 | *"Do not initiate processes on a user or server's behalf without first obtaining their permission. The manner of providing the option for permission must be clearly labeled and apparent"* | The *Join voice on Discord* control is that permission for link-only riders, provided it says it opens Discord (0017 §8.3 item 2 already requires this) |
| 3 | *"Your Application must respect user decisions to opt out of or block the Application"* | Unlinking must remove the stored ID, and should revoke the grant (§7, item 4) |
| 5, 6, 7 | No unsolicited direct messages, no marketing, no contact outside Discord *"using API Data"* | **The bot sends no messages at all.** Keep it that way. A linked rider's Discord ID must never be used to contact them |
| 9 | *"Do not direct your Application to people who are under the age of 13 or the minimum age required by the laws in their applicable countries."* | Public rooms are 18+ (owner ruling Q5, 2026-09-28). For private rooms the instance obtains no API Data about any rider. §8, Q3 |
| 10 | *"Unless your Application is labeled as age-restricted, you will make sure your Application is appropriate for users under the age of 18"*; no enabling harassment | A ride room's voice channel is not adult content. The 18+ rule on public rooms is a moderation choice, not an age-restriction label |
| 13 | *"Do not misrepresent or fraudulently manipulate engagement. This includes … the inflation of server membership with bot or user accounts."* | Adding riders who asked to join a room's voice is not inflation. Temporary invites and deleting channels keep the server from filling with idle members |
| closing | Developers must *"provide users of their Application with a way to report issues or violations relating to the Application or its use … and … review such reports and take appropriate action"* | **#789's report route has to cover voice**, and each operator is the one who reviews it |
| 15 | *"Do not use API Data for any purpose outside of what is necessary to provide your stated functionality."* | A linked rider's Discord ID is used to add them, give and take roles, and disconnect them. Nothing else. No analytics |
| 16 | No profiling of users *"or their relationships with other users"*; and no transmitting to Discord data *"that includes protected health information … or other sensitive information"* | ⚠️ **Never put ride data into anything sent to Discord**: not a channel name, not a topic, not an audit-log reason. Heart rate is health data. §7, item 8 |
| 17, 18 | No disclosing API Data to data brokers or advertisers; no selling it | Nothing in the design does |
| API Limits | Discord may limit *"the number of API requests that you may make, or the number of users you may serve … at our sole discretion. You agree to, and will not attempt to circumvent, such limitations"* | See §5.2 |

**Nothing in the Developer Policy forbids** a bot creating temporary voice channels, creating
invites, deleting both, or adding consenting users to a server.

### 5.2 Rate limits (S3)

- **Per-route and global limits exist, and the numbers are deliberately not published per route.**
  *"Because rate limits depend on a variety of factors and are subject to change, **rate limits
  should not be hard coded into your app**. Instead, your app should parse response headers"*
  (`X-RateLimit-Limit`, `-Remaining`, `-Reset`, `-Reset-After`, `-Bucket`, and on a `429`,
  `-Global` and `-Scope`).
- **On a `429`**, *"Your application should rely on the `Retry-After` header or `retry_after` field
  to determine when to retry the request."*
- **Global limit**: *"All bots can make up to 50 requests per second to our API."* A room makes about
  six requests in its life (0017 §3.6), so this is not a design constraint.
- ⚠️ **Invalid-request limit**: *"IP addresses that make too many invalid HTTP requests are
  automatically and temporarily restricted from accessing the Discord API. Currently, this limit is
  **10,000 per 10 minutes**. An invalid request is one that results in **401**, **403**, or **429**
  statuses."* The page says to avoid `401`s by *"stopping further requests after a token becomes
  invalid"* and `403`s by *"inspecting role or channel permissions"*. ⚠️ **The ban is per IP
  address.** On the owner's home connection that IP is shared with everything else in the house.
  A bot that retries a dead token in a loop could get the house's address restricted from Discord's
  API.

**So the bot must**: read the headers and wait out an exhausted bucket; honour `retry_after` on a
`429`; stop on the first `401` and turn voice off; and never retry a `403` or a `404`. Under §2(b)
of the Terms, exceeding the limits is a breach, not just a failed request.

### 5.3 Caps that bound the design (S4, S5, S7)

| Cap | Figure | Source | What it bounds |
| --- | --- | --- | --- |
| Channels per server (voice, text and categories) | **500** | *Discord Account Caps, Server Caps, and More* (S7) | Concurrent voice rooms per operator, less the server's own channels |
| Channels in one category | **50** | S7 | ⚠️ **If the bot files room channels under one category, 50 concurrent voice rooms is the ceiling.** Use no category, or several |
| Roles per server | **250** | S7 | Concurrent **public** rooms under account linking (one role per room, 0017 §3.3), less the server's own roles |
| Unique invite codes per server | **999** | S7 | Invites must be deleted with their room. ⚠️ **Whether deleting a channel deletes its invites was not established by these reads**; the bot should delete them explicitly, or a test against the real API should settle it |
| Membership Screening | *"this endpoint will default to adding new members as `pending` … Members that are `pending` will have to complete membership screening before they become full members that can talk"* | S4, Add Guild Member | ⚠️ **An operator's server with Membership Screening on would admit linked riders who cannot speak.** The operator page must say to turn it off, or the bot must refuse to start voice when it is on |
| Servers before verification | *"Verification is required for your app to scale past 100 servers"*, and requires the owner's identity through Stripe | *How Do I Get My App Verified?* (S6) | **None.** Each operator's bot is in one server |
| Two-factor authentication | *"For bots with elevated permissions … we enforce two-factor authentication on the owner's account when added to guilds that have server-wide 2FA enabled."* | S3 (OAuth2 page) | The operator page should say the operator's Discord account may need 2FA. `MANAGE_CHANNELS`, `MANAGE_ROLES` and `KICK_MEMBERS` are marked elevated |
| OAuth2 access token lifetime | `expires_in: 604800` in the documented examples (7 days), with a refresh token | S3 | Only matters if tokens are kept, which §7 item 4 says not to do |

**No gateway intent is needed**, so the privileged-intent rules for bots in 100 or more servers do
not apply. 0017 §3.2's design makes no gateway connection. The *Bot vs User Accounts* note on the
OAuth2 page (S3) forbids *"automating standard user accounts"*. The design uses a bot account only.

---

## 6. The Social SDK Terms, read first-hand (S8)

**Effective 2025-03-17.** The article's own edit date is 2025-03-19.

### 6.1 The licence grant

> *"Subject to your compliance with the Terms, we grant you a limited, non-exclusive,
> non-transferable, non-assignable, revocable license to use the Discord Social SDK and associated
> Documentation and to distribute the Discord Social SDK as integrated into your Application, in each
> case, solely in accordance with the Documentation as necessary for you to develop, operate,
> maintain and support the Integrations as expressly authorized under the Terms. The foregoing
> license is not sublicensable, except to your Service Providers … As between you and us, we own all
> right, title and interest in and to the Discord Social SDK, associated Documentation, and all
> improvements, modifications and derivative works based upon any of the foregoing (and to the extent
> that any such rights do not automatically vest in Discord, such rights are hereby irrevocably and
> automatically assigned by you to Discord)."* (§2(a))

**This confirms the wording spike 0017 took from a search engine's summary**, and adds three things
the summary did not have: the grant is **not sublicensable**; Discord **owns derivative works**; and
rights in them are **assigned to Discord**.

### 6.2 What else it says that matters

- **Restrictions** (§2(b)): no reverse engineering; no modifying, copying or redistributing the SDK;
  and *"(vii) use the Discord Social SDK for benchmarking or competitive analysis … or to develop,
  commercialize, license or sell any product, service or technology that could, directly or
  indirectly, compete with the Discord Social SDK or other Discord services."* A breach must be
  reported *"within 24 hours"*.
- **Integration Requirements** (§3(a)): Discord may test the implementation and require fixes
  *"to our satisfaction"* before launch.
- **Age** (§3(b)): *"You will ensure that your Application does not support or authorize individuals
  who are under the age of 13 to utilize the Integrations."*
- **Data** (§5(a)): the developer and Discord are **independent controllers**. Personal data about a
  user *"who has not linked their account"* may be processed only as far as the Integration needs.
- **Termination** (§6): Discord may *"terminate these SDK Terms or revoke or limit your access to the
  Discord Social SDK for any reason and for any period of time, without notice to you."*

**For option B, this settles what 0017 §4.2 argued.** The grant is revocable, not sublicensable, not
OSI, and claims derivative works. 0017 rejected B, and nothing here changes that.

### 6.3 ⚠️ Does it reach option A's account linking? Not settled by reading

The Social SDK Terms define their own scope widely:

> *"These Discord Social SDK Terms … apply to your access to and use of any and all of Discord's APIs
> and SDKs designed to enable Discord's social integrations (the 'Integrations') within your
> Application … These Integrations may include: Discord's unified friends list, **Discord login or
> authentication methods, Discord account linking** and provisional accounts, rich presence and game
> detection, cross-platform game invites, and other authorized social integrations"*

And the Developer Terms: *"If you access or use our Social SDK, the Terms include our Social SDK
Terms."*

The public-room design in 0017 §3.3 has riders **link their Discord account** through OAuth2
(`identify` + `guilds.join`). OAuth2 is general API documentation (`/developers/topics/oauth2`). It
predates the Social SDK and is not part of its pages. **The better reading is that plain OAuth2 is not
"designed to enable Discord's social integrations"**, so the Social SDK Terms do not apply to it. But
the words *"Discord login or authentication methods, Discord account linking"* are broad enough to
make that uncertain. What follows if they do apply:

- clause §2(b)(vii) would bind the operator not to develop anything that *"could, directly or
  indirectly, compete with … other Discord services"*. ⚠️ **The owner both operates an instance and
  maintains this project**, which includes a deferred voice option of its own (0017 §7, option C)
  and multiplayer rooms. That is the case where the clause would bite;
- §3(a)'s Integration Requirements and Discord's right to test before launch;
- §3(b)'s under-13 rule (already met: public rooms are 18+).

**The private-room design (link only) uses no login and no account linking**, so it is outside this
question whichever reading is right. §8, Q1.

---

## 7. What has to change in option A, and what is added

Each item cites the clause that requires it. None of them changes 0017's architecture: REST only,
no dependency, the channel living exactly as long as the room.

| # | Change | Required by | Lands in (0017 §8.3 draft numbering) |
| --- | --- | --- | --- |
| 1 | **No Application ID, client ID, client secret or bot token in the repository or in a web build.** All come from the operator's environment at run time. `.env.example` lists them **empty**. The instance, not `apps/web`, builds the OAuth2 authorize URL | Terms §2(d) | 1 (bot), 4 (linking) |
| 2 | **Each operator publishes a privacy policy** that names Discord, what it receives, what the instance keeps, and how to have it deleted. It is linked in the Developer Portal and from the app. For the owner's instance, `docs/privacy-policy.md` | Terms §5(a) | 5 (disclosures, #778) |
| 3 | **API Data encrypted at rest**, backups included: the channel ID and invite per room, and each linked rider's Discord user ID | Terms §5(c) | 1 and 4. §8, Q2 |
| 4 | **Keep no OAuth2 token.** Add the rider to the operator's server **once, at link time**, with the fresh access token, then **revoke** it (the token revocation URL, S3). After that the bot works with the bot token only: roles, disconnects and removal need no user token. Store only the Discord user ID, and delete it on unlink, on account erasure (#35) and when the operator turns voice off | Terms §5(b), §13 (tokens are API Data); Policy rule 3 | 4 |
| 5 | **A consent screen before Discord's own**: that linking adds the account to *this operator's* named server, gives it a role per room, and can remove it. Linking is never automatic | Policy rules 1 and 2 | 4 |
| 6 | **Rate limits honoured as a term**: read the headers, wait out a bucket, honour `retry_after`, stop on the first `401` and turn voice off, never retry a `403` or `404`. No limit hard-coded | Terms §2(b)(iv); Policy *API Limits*; S3 | 1 |
| 7 | **A dead token means voice is off**, not an error loop, because a token unused for 30 days may be suspended and repeated `401`s count toward the per-IP ban | Terms §9(a); S3 | 1 |
| 8 | **Nothing a rider typed, and no ride data, in anything sent to Discord.** A channel name is derived from the room's opaque ID, with no topic and no audit-log reason carrying personal data | Terms §3(a); Policy rules 10 and 16 | 1 |
| 9 | **Capacity**: no single category for room channels (50-channel cap); a cap on concurrent voice rooms below the server's 500 channels, and on public rooms below 250 roles; invites deleted explicitly; the bot refuses to start voice if the server has Membership Screening on | S7; S4 | 1, 3 |
| — | **The operator page** (#789) gains: the operator accepts Discord's Developer Terms for their own Application; their privacy policy; the report route; the 30-day token note; 2FA; Membership Screening; the arbitration opt-out window (§8, Q4) | Terms §1(a), §3(b), §5, §9(a), §12(e); Policy closing rule | 3, 5 |

---

## 8. Can option A ship as designed?

**Not exactly as designed. It can ship with §7's changes, and nothing read forbids the pattern.**

- **Private rooms (A-link)**: **yes**, with items 1, 2, 3, 6, 7, 8 and 9. No rider data reaches the
  instance from Discord, and no user token exists. The Social SDK question does not arise.
- **Public rooms (A-linked)**: **yes in principle**, with items 4 and 5 as well. **Recommended to wait
  for Q1** before the linking sub-issue ships.

### Questions this reading could not settle

The owner was unavailable overnight on 2026-09-29. The coordinator instructed that the recommended
answer be taken for each open question and recorded. Each **recommended answer** below is therefore
the working assumption for the sub-issues. It is reversible, and it is also listed under *"Decisions
taken without the owner"* in the pull request that carries this spike. Q4 is not a design question.
It is a legal choice for each operator, and it is **not** decided here.

| # | Question | Recommended answer (taken as the working assumption) | Why |
| --- | --- | --- | --- |
| Q1 | Do the Social SDK Terms, with their non-compete clause §2(b)(vii), reach plain OAuth2 account linking (§6.3)? | **Ship private-room voice first. Hold public-room account linking until Discord's developer support answers in writing** whether an Application that uses only OAuth2 `identify` + `guilds.join`, and no Social SDK library, is subject to the Social SDK Terms. Keep the answer with this spike's successor. If support will not answer, the owner decides with counsel | Private rooms do not need linking. Asking costs a support ticket, and guessing wrong could bind the project's maintainer to a non-compete |
| Q2 | How is API Data encrypted at rest on the instance (§7 item 3)? | **Application-level encryption of the Discord columns** with a key from the operator's environment, **plus** a requirement on the operator page for encrypted backups. Not "the operator should use full-disk encryption" alone | The instance cannot check a disk. It can check that it encrypts its own columns, in a test. Litestream backups leave the box (ADR 0037 D-5) and must not carry plaintext |
| Q3 | Should a private-room voice link need an age check? | **No.** Discord's own users must be at least 13, private-room voice gives the instance no API Data about any rider, and public rooms keep their 18+ rule | Policy rule 9 is about directing the Application at under-13s. A link to a Discord channel, shown to riders a room admitted, does not do that |
| Q4 | Should an operator opt out of Discord's arbitration clause within 30 days of creating their Application (Terms §12(e))? | **Not decided here.** The operator page should state that the window exists and where the Terms describe it | A legal choice that belongs to each operator, the owner included, and not something a pull request can take |

---

## 9. Sources

| # | Source | Read | Result |
| --- | --- | --- | --- |
| S1 | *Discord Developer Terms of Service*. `https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service` (`301` → `docs.discord.com` → `support-dev.discord.com/hc/articles/8562894815383-…`, **`403`**, Cloudflare challenge). Read through `https://support-dev.discord.com/api/v2/help_center/en-us/articles/8562894815383.json` | 2026-09-29 | **`200`, first-hand, in full.** *"Effective date: July 8, 2024 / Last updated: June 6, 2024"*; article last edited 2025-03-17 |
| S2 | *Discord Developer Policy*. `…/developer-policy` (same redirects, **`403`**). Read through `…/articles/8563934450327.json` | 2026-09-29 | **`200`, first-hand, in full.** *"Effective date: July 8, 2024 / Last updated: June 6, 2024"*; article last edited 2024-08-02 |
| S3 | *OAuth2* and *Rate Limits*. `https://docs.discord.com/developers/topics/oauth2.md`, `…/topics/rate-limits.md` | 2026-09-29 | **`200`, first-hand** (`text/markdown`): scopes, the code grant, token lifetime and revocation, bot vs user accounts, 2FA; per-route, global (50/s) and invalid-request (10 000 per 10 minutes) limits |
| S4 | *Guild* and *Channel* resources. `https://docs.discord.com/developers/resources/guild.md`, `…/resources/channel.md` | 2026-09-29 | **`200`, first-hand**: Add Guild Member (`guilds.join`, the bot token from the same application, `CREATE_INSTANT_INVITE`, Membership Screening `pending`); invite parameters. **No numeric channel cap on either page** |
| S5 | *Permissions*. `https://docs.discord.com/developers/topics/permissions.md` | 2026-09-29 | **`200`, first-hand.** Used only to confirm which permissions are elevated |
| S6 | *How Do I Get My App Verified?* `https://support-dev.discord.com/hc/en-us/articles/23926564536471`, read through `…/articles/23926564536471.json` | 2026-09-29 | **`200`, first-hand**: verification is required *"to scale past 100 servers"*, with identity through Stripe |
| S7 | *Discord Account Caps, Server Caps, and More*. `https://support.discord.com/hc/en-us/articles/33694251638295`, found through a web search and then read through `https://support.discord.com/api/v2/help_center/en-us/articles/33694251638295.json` | 2026-09-29 | **`200`, first-hand** (article last edited 2026-03-02): 500 channels, 50 per category, 250 roles, 999 unique invite codes per server. The search result's own summary was not relied on |
| S8 | *Discord Social SDK Terms*. `https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms` (**`403`**, Cloudflare challenge, as in spike 0017 S7). Read through `…/articles/30225844245271.json` | 2026-09-29 | **`200`, first-hand, in full.** *"Effective: March 17, 2025"*; article last edited 2025-03-19 |
| S9 | This repository at `a33c177f`: spike 0017; ADR 0037 D-5; `docs/privacy-policy.md`; issues #794 (the owner's ruling), #873 | 2026-09-29 | §3, §7 |

**Not read**: Discord's user Terms of Service, Privacy Policy and Community Guidelines (incorporated
into the Developer Terms; the parts the Developer Policy relies on are quoted from the Policy itself),
the *Monetization Terms* (the bot charges nothing), and the Brand Guidelines (§8(b) of the Terms
requires attribution *"as required by Discord"*; the voice link's wording should be checked against
them when it is written, under 0017 §8.3 item 2).
