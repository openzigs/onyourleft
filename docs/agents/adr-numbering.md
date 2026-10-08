# The ADR numbering record

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the record of ADR numbers from the "ADRs" bullet of §7, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you are about to write an ADR and need to know which numbers were taken, by what, and why some were reserved (the next free number itself stays in the root).**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

## Which numbers were taken, and by what (from CLAUDE.md §7, "ADRs")

  ⚠️ **0047 is [ADR 0047](../adr/0047-end-to-end-encryption-between-the-app-and-its-instance.md)**,
  taken by [#1179](https://github.com/openzigs/onyourleft/issues/1179) on 2026-10-08 for end-to-end
  encryption between the app and its instance, **Proposed** until the owner accepts it. A reviewer who
  remembers this sentence offering 0047 is reading the old file.
  ⚠️ **0046 is [ADR 0046](../adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)**,
  taken by [#1093](https://github.com/openzigs/onyourleft/issues/1093) on 2026-10-04 for AI analysis
  on the rider's instance as a tool-calling agent, and **accepted by the owner on 2026-10-07**. It
  took 0046 rather than 0044 because 0044 and 0045 were already claimed by the epic
  [#1055](https://github.com/openzigs/onyourleft/issues/1055). A reviewer who remembers this sentence
  offering 0046 is reading the old file.
  ⚠️ **0045 is [ADR 0045](../adr/0045-fit-from-one-side-camera.md)**, taken by
  [#1059](https://github.com/openzigs/onyourleft/issues/1059) on 2026-10-04 for fit from one side
  camera, and **0044 is [ADR 0044](../adr/0044-side-camera-live-view-and-snapshot.md)**, taken by
  [#1058](https://github.com/openzigs/onyourleft/issues/1058) the same day for the side camera's live
  view and snapshot. Epic [#1055](https://github.com/openzigs/onyourleft/issues/1055) reserved both on
  2026-10-03. A reviewer who remembers this sentence offering 0044 or 0045 is reading the old file.
  ⚠️ **0043 is [ADR 0043](../adr/0043-ofl-display-typeface.md)**, taken by
  [#991](https://github.com/openzigs/onyourleft/issues/991) on 2026-10-02 for the OFL display face. A
  reviewer who remembers this sentence offering 0043 is reading the old file.
  ⚠️ **0042 is [ADR 0042](../adr/0042-tailwind-and-radix-over-the-tokens.md)**, taken by
  [#950](https://github.com/openzigs/onyourleft/issues/950) for Tailwind CSS and Radix over the
  tokens. A reviewer who remembers this sentence offering 0042 is reading the old file.
  ⚠️ **0041 is [ADR 0041](../adr/0041-motion-for-menu-animation.md)**, taken by
  [#936](https://github.com/openzigs/onyourleft/issues/936) for Motion in the menus. A reviewer who
  remembers this sentence offering 0041 is reading the old file.
  ⚠️ **0040 is [ADR 0040](../adr/0040-a-history-index-on-the-riders-instance.md)**, taken by
  [#834](https://github.com/openzigs/onyourleft/issues/834) on 2026-09-29 for the history index on
  the rider's instance. A reviewer who remembers this sentence offering 0040 is reading the old file.
  ⚠️ **0036 to 0039 are [ADR 0036](../adr/0036-a-self-hostable-instance-server-now.md) to
  [ADR 0039](../adr/0039-racing-another-riders-ghost-on-consent.md)**, reserved and written together
  by [#825](https://github.com/openzigs/onyourleft/issues/825) on 2026-09-29 for the race-server
  decisions: the instance server now (owner decision D6 lifted), its runtime and transport, drafting,
  and the cross-rider ghost on consent. A reviewer who remembers this sentence offering 0036 is
  reading the old file.
  ⚠️ **0035 is [ADR 0035](../adr/0035-model-written-ride-write-ups.md)**, taken by
  [#796](https://github.com/openzigs/onyourleft/issues/796) for a ride write-up written by the
  rider's own model, and **0034 is [ADR 0034](../adr/0034-lucide-icons.md)**, reserved for
  [#673](https://github.com/openzigs/onyourleft/issues/673) and written by it on 2026-09-29 (bundle
  [#857](https://github.com/openzigs/onyourleft/issues/857)): icons come from Lucide. A reviewer who
  remembers this sentence calling 0034 reserved and unwritten is reading the old file.
  ⚠️ **0033 is [ADR 0033](../adr/0033-side-camera-link.md)**, taken by
  [#527](https://github.com/openzigs/onyourleft/issues/527) for the side-camera link. A reviewer who
  remembers this sentence offering 0033 is reading the old file.
  ⚠️ **0032 is [ADR 0032](../adr/0032-external-data-for-the-game-world.md)**, taken by
  [#248](https://github.com/openzigs/onyourleft/issues/248) — the trainer game's world takes **no**
  external data source. It took 0032 rather than 0029 because **0029, 0030 and 0031 were taken the
  same day** by the camera-decision work
  ([#378](https://github.com/openzigs/onyourleft/issues/378)–[#381](https://github.com/openzigs/onyourleft/issues/381))
  in a parallel pull request, and two branches taking "the next free number" at once collide on a
  document that cannot be renumbered. ⚠️ **0021 is now WRITTEN and is no longer a live
  reservation** — [ADR 0021](../adr/0021-racing-another-riders-ghost.md),
  [#330](https://github.com/openzigs/onyourleft/issues/330), 2026-09-22 — and a reviewer who
  remembers the paragraph below calling it reserved-and-unwritten is reading the old file. ⚠️ **It
  does NOT supersede [ADR 0007](../adr/0007-patent-posture.md) D4**, whatever #330's title says:
  D4's ❌ on a ghost of another rider stands, [#331](https://github.com/openzigs/onyourleft/issues/331)
  stays blocked, and ADR 0021 **D-7** is the question put to the owner. ADR 0007 gained its first
  `## Amendments` entry in the same change.
  ⚠️ **0031 is [ADR 0031](../adr/0031-model-licences-and-the-hosted-model-hole.md)**, taken by
  [#380](https://github.com/openzigs/onyourleft/issues/380) for model licences, committed and hosted.
  ⚠️ **0030 is [ADR 0030](../adr/0030-what-the-app-may-say-about-a-body.md)**, taken by
  [#379](https://github.com/openzigs/onyourleft/issues/379) for what the app may say about a rider's
  body.
  ⚠️ **0029 is [ADR 0029](../adr/0029-camera-imagery-as-a-data-class.md)**, taken by
  [#378](https://github.com/openzigs/onyourleft/issues/378) for camera imagery as its own data class;
  a reviewer who remembers this sentence offering 0029 is reading the old file.
  ⚠️ **0028 is [ADR 0028](../adr/0028-racing-fairness.md)**, taken by
  [#465](https://github.com/openzigs/onyourleft/issues/465) for how a race between riders is fair.
  ⚠️ It was **Accepted with five questions explicitly left to the owner**, which is a shape no other
  ADR here has — and a reviewer who remembers those questions being OPEN is reading the old file:
  [#488](https://github.com/openzigs/onyourleft/issues/488) appended a dated amendment on
  2026-09-22 answering all six. Read the **amendment** rather than §"What the owner has not
  decided", which is now a record of what was asked: **Q5 changed D-4** (W/kg categories are
  deferred, not shipped, so the Q3 plausibility flags are the only guard in the first cut) and
  **Q6 lifted D-0's counsel block** while its "#7, no server in Phase 1" block stood, so nothing
  could be built then. ⚠️ **That last block is lifted too** —
  [ADR 0036](../adr/0036-a-self-hostable-instance-server-now.md) D-4, 2026-09-29 — and a reviewer
  who remembers it standing is reading the old file.
  ⚠️ **0027 is [ADR 0027](../adr/0027-a-tab-left-behind-by-another-tabs-update.md)**, taken by
  [#483](https://github.com/openzigs/onyourleft/issues/483) for the state a tab is left in when
  ANOTHER tab's update takes over — a reviewer who remembers this sentence offering 0027 is reading
  the old file.
  ⚠️ **0026 is [ADR 0026](../adr/0026-realistic-game-world.md)**, taken by
  [#431](https://github.com/openzigs/onyourleft/issues/431) for the realistic game world; a reviewer
  who remembers this sentence offering 0026 is reading the old file.
  ⚠️ **0025 is [ADR 0025](../adr/0025-app-store-additional-permission.md)**, taken by
  [#432](https://github.com/openzigs/onyourleft/issues/432) for the app-store additional permission.
  ⚠️ **0024 is [ADR 0024](../adr/0024-offline-and-caching-posture.md)**, taken by
  [#403](https://github.com/openzigs/onyourleft/issues/403) for the offline and caching posture; a
  reviewer who remembers this sentence offering 0024 is reading the old file.
  ⚠️ **0023 is [ADR 0023](../adr/0023-cc-by-assets-and-attribution.md)**, taken by
  [#357](https://github.com/openzigs/onyourleft/issues/357) for the CC-BY asset ruling, and a reviewer who
  remembers this sentence offering 0023 is reading the old file.
  ⚠️ This sentence said *"every number from 0001 to 0020 is now written and the next free number is
  0021 — there is no live reservation"*, and then that **0021 was a live reservation** claimed by
  [#330](https://github.com/openzigs/onyourleft/issues/330) and not yet written. **Both are now the
  old file**: #330 wrote it on 2026-09-22 and the reservation is consumed — see the 0032 paragraph
  above for what it does and does not decide. **0022 is [ADR 0022](../adr/0022-game-scenery-model-pack.md)**, taken by
  [#340](https://github.com/openzigs/onyourleft/issues/340) for the game's CC0 model pack — it took
  0022 rather than 0021 precisely because this paragraph was stale, and a written ADR cannot be
  renumbered without breaking citations, so the `ADR001` collision would have landed on #330. The
  *check* this bullet asks for is `docs/architecture.md`'s reservation table, not this sentence; a
  claim that never reaches that table is a claim nobody can check. ⚠️ **0020 is
  [ADR 0020](../adr/0020-display-units.md)**, taken by
  [#238](https://github.com/openzigs/onyourleft/issues/238) for the display-unit switch; a reviewer
  who remembers this paragraph offering 0018, 0019 or 0020 is reading an old one. **0019 is
  [ADR 0019](../adr/0019-signed-records-in-an-export.md)**, taken by
  [#221](https://github.com/openzigs/onyourleft/issues/221) for how a signed activity record travels
  in an export.
  **0018 is [ADR 0018](../adr/0018-native-client-platform.md)**, taken by
  [#15](https://github.com/openzigs/onyourleft/issues/15) for the native-client platform question. ⚠️ `0012` **was**
  reserved and is no longer: [#64](https://github.com/openzigs/onyourleft/issues/64) consumed it
  with [ADR 0012](../adr/0012-data-licence.md), the data licence, which is the destination
  ADR 0001's *Data* deferral had no number for
  ([#119](https://github.com/openzigs/onyourleft/issues/119)). A reviewer who remembers this
  paragraph telling them to skip 0012 is reading the old one.
