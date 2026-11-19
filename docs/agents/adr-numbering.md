# The ADR numbering record

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the record of ADR numbers from the "ADRs" bullet of §7, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you are about to write an ADR and need to know which numbers were taken, by what, and why some were reserved (the next free number itself stays in the root).**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

## Which numbers were taken, and by what (from CLAUDE.md §7, "ADRs")

  ⚠️ **0085 is [ADR 0085](../adr/0085-ggbotnets-psx-style-cars-for-the-realistic-worlds-cars.md)**,
  taken by [#2847](https://github.com/openzigs/onyourleft/issues/2847) on 2026-11-19 for GGBotNet's
  PSX Style Cars as the realistic world's cars, on the owner's rulings on #2847 of 2026-11-18 and
  2026-11-19, and **Accepted** on them. It supersedes in part ADR 0049 D-10's In table, and ADR 0049
  gained one dated `## Amendments` entry pointing here. The ADR number note of 2026-11-19 on #2847
  gave this lane 0085: **0081 is claimed** by #2836's lane, written in the open pull request
  [#2873](https://github.com/openzigs/onyourleft/pull/2873); 0082 is ADR 0082 (#2794, pull request
  #2802); **0083 is claimed** by the open pull request [#2864](https://github.com/openzigs/onyourleft/pull/2864)
  and **0084** by the open pull request [#2863](https://github.com/openzigs/onyourleft/pull/2863).
  So the next free number is **0086**. #2847's pull request #2872 first wrote this ADR as 0081 and
  was renumbered on review, before merge; a reviewer who remembers 0081 meaning the PSX cars is
  reading that first draft.
  ⚠️ **0079 is [ADR 0079](../adr/0079-remote-access-without-a-domain-and-no-lan-only-http.md)**,
  taken by [#2790](https://github.com/openzigs/onyourleft/issues/2790) on 2026-11-18 for remote
  access without a domain (the owner's tailnet by default, a domain optional) and the refusal of
  LAN-only `http://`, on the owner's ruling of 2026-10-27 on #15 and the lane note of 2026-11-18 on
  #2790. It was **Accepted** on 2026-11-18 by the owner on its pull request
  [#2806](https://github.com/openzigs/onyourleft/pull/2806), and it supersedes nothing. #2790's title claimed 0079, and the pull request
  [#2795](https://github.com/openzigs/onyourleft/pull/2795) (#2780) recorded it as reserved for
  #2790 while writing 0080. It skipped **0078**, which the open pull request
  [#2793](https://github.com/openzigs/onyourleft/pull/2793) (#2777) writes; **0075, 0076 and 0077
  stay claimed** by #2670, #2767 and #2762, **0080** by #2795, and **0057 and 0058** by #1748 and
  #1752. The lane note expected 0081, and 0081 is still free.
  ⚠️ **0080 is [ADR 0080](../adr/0080-first-run-setup-and-owner-claim-on-the-loopback-listener.md)**,
  taken by [#2780](https://github.com/openzigs/onyourleft/issues/2780) on 2026-11-17 for first-run
  setup and the owner's claim on the loopback listener, on the owner's ruling of that day on the epic
  [#2779](https://github.com/openzigs/onyourleft/issues/2779). It is **Proposed** until the owner
  approves it on its pull request. It supersedes in part ADR 0069 D-5 and D-1, ADR 0046 D-9 Q9 and
  the 2026-11-14 ruling on #2601 about the registration mode. ADR 0046, ADR 0047 and ADR 0069 each
  gained one dated `## Amendments` entry pointing here. ⚠️ **#2780's title names 0078, and 0078 had
  gone**: the open pull request [#2793](https://github.com/openzigs/onyourleft/pull/2793) (#2777)
  writes `0078-a-floor-under-the-ai-pacers-intent.md`, and **0079 was claimed by
  [#2790](https://github.com/openzigs/onyourleft/issues/2790)'s title** (it is ADR 0079 now, above). 0075, 0076 and 0077 are
  written in the open pull requests [#2670](https://github.com/openzigs/onyourleft/pull/2670),
  [#2767](https://github.com/openzigs/onyourleft/pull/2767) and
  [#2762](https://github.com/openzigs/onyourleft/pull/2762), 0070 is ADR 0070 (#2684, below), and **0057 and
  0058 stay claimed** by #1748 and #1752. **The next free number is 0081**, which no issue or pull request claims; **0082 is claimed** by the open pull request [#2802](https://github.com/openzigs/onyourleft/pull/2802) (#2794), so the number after 0081 is **0083**. A reviewer who remembers
  this file offering 0075, 0078 or 0079 is reading the old file.
  ⚠️ **0070 is [ADR 0070](../adr/0070-houses-on-inferred-built-up-land-in-a-suburb-mapped-only-by-its-streets.md)**,
  taken by [#2684](https://github.com/openzigs/onyourleft/issues/2684) on 2026-11-15 for houses on
  inferred built-up land in a suburb that OpenStreetMap maps only by its streets, on the owner's
  ruling of that day on #2684, and claimed from then until its pull request
  [#2694](https://github.com/openzigs/onyourleft/pull/2694) merged. It was **Proposed**, and the
  owner accepted it on 2026-11-17 on #2694. It supersedes ADR 0054 D-5.1 in part, as an ADR rather
  than an amendment, because ADR 0013 D-3 sends a reversed decision to a new ADR; ADR 0054 gained
  one dated `## Amendments` entry pointing here. 0071 to 0074 are ADRs 0071 to 0074 (below);
  **0075 is claimed** by the open pull request [#2670](https://github.com/openzigs/onyourleft/pull/2670)
  (#2600), **0076** by [#2767](https://github.com/openzigs/onyourleft/pull/2767) (#2759) and
  **0077** by [#2762](https://github.com/openzigs/onyourleft/pull/2762) (#2760); **0057 and 0058
  stay claimed** by #1748 and #1752. The next free number was then 0078. A reviewer who remembers
  this file offering 0071 or 0075 is reading the old file.
  ⚠️ **0074 is [ADR 0074](../adr/0074-a-sprint-instinct-behind-the-models-moves.md)**, taken by
  [#2710](https://github.com/openzigs/onyourleft/issues/2710) in its pull request
  [#2724](https://github.com/openzigs/onyourleft/pull/2724) on 2026-11-16 for a sprint instinct
  behind the model's moves, accepted the same day on the owner's ruling on #2724. It supersedes in
  part ADR 0073 D-3.5, which gained one dated `## Amendments` entry pointing to it. No open issue or
  pull request named it. **0057 and 0058 stay claimed** by #1748 and #1752 and 0070 by #2684; 0072
  is ADR 0072 (#2712, below). The next free number was then 0075. A reviewer who remembers this file offering 0074 is
  reading the old file.
  ⚠️ **0073 is [ADR 0073](../adr/0073-ai-bots-race-with-strategy-freedom-inside-the-bodys-limits.md)**,
  taken by [#2720](https://github.com/openzigs/onyourleft/issues/2720) on 2026-11-16 for AI bots
  racing with strategy freedom inside the body's limits, on the owner's ruling of that day on the
  epic [#2706](https://github.com/openzigs/onyourleft/issues/2706). It is **Proposed** until the
  owner approves it, before #2710 merges. It supersedes in part ADR 0071 D-3.6, as an ADR rather
  than an amendment, because ADR 0013 D-3 sends a reversed decision to a new ADR; ADR 0071 gained
  one dated `## Amendments` entry pointing here. #2720 claimed it by its title. ⚠️ **It skipped
  0072**, which this file then still offered as the next free number: **0072 is claimed by
  [#2712](https://github.com/openzigs/onyourleft/issues/2712)** (the AI pacer), whose title names it
  and which ADR 0071 D-2 cites. **0057 and 0058 stay claimed** by #1748 and #1752, and 0070 by
  #2684. The next free number was then 0074. A reviewer who remembers this file offering 0072 or
  0073 is reading the old file.
  ⚠️ **0072 is [ADR 0072](../adr/0072-a-model-directs-the-bot-pacer-during-a-ride.md)**,
  taken by [#2712](https://github.com/openzigs/onyourleft/issues/2712) on 2026-11-16 for a model
  directing the bot pacer during a ride, on the owner's ruling of that day (*"We are fine with the
  patent. Put it in."*). It was **Proposed**, and the owner accepted it on 2026-11-16 (its D-11). It
  supersedes, for an AI-pacer ride, #92 criterion 6, ADR 0066 D-1.1's second half, ADR 0071 D-2 and
  D-1.1's "one place", and ADR 0046 D-7, as an ADR rather than amendments, because ADR 0013 D-3 sends
  a reversed decision to a new ADR; ADR 0066, ADR 0071 and ADR 0046 each gained one dated
  `## Amendments` entry pointing here. #2712's lane note claimed it. **0073 is ADR 0073**
  ([#2720](https://github.com/openzigs/onyourleft/issues/2720), above), 0070 is claimed by
  #2684, and **0057 and 0058 stay claimed** by #1748 and #1752. The next free number was then 0074. A
  reviewer who remembers this file offering 0072 is reading the old file.
  ⚠️ **0071 is [ADR 0071](../adr/0071-model-chosen-lap-race-bot-tactics-during-a-ride.md)**,
  taken by [#2707](https://github.com/openzigs/onyourleft/issues/2707) on 2026-11-16 for
  model-chosen lap-race bot tactics during a ride, on the owner's ruling of that day on the epic
  [#2706](https://github.com/openzigs/onyourleft/issues/2706). It is **Proposed** until the owner
  approves it on its pull request. It supersedes in part ADR 0067 D-6.2 and ADR 0046 D-7 and D-9,
  as an ADR rather than amendments, because ADR 0013 D-3 sends a reversed decision to a new ADR;
  ADR 0046 and ADR 0067 each gained one dated `## Amendments` entry pointing here. #2707 claimed it
  by its title. ⚠️ **It skipped 0070**, which this file then still offered as the next free number:
  **0070 is claimed by [#2684](https://github.com/openzigs/onyourleft/issues/2684)**, whose open
  pull request [#2694](https://github.com/openzigs/onyourleft/pull/2694) writes ADR 0070 (houses on
  inferred built-up land in a suburb mapped only by its streets). **0057 and 0058 stay claimed** by
  #1748 and #1752. The next free number was then 0072. A reviewer who remembers this file offering
  0070 or 0071 is reading the old file.
  ⚠️ **0069 is [ADR 0069](../adr/0069-the-instances-own-admin-pages-and-a-tls-only-admin-channel.md)**,
  taken by [#2640](https://github.com/openzigs/onyourleft/issues/2640) on 2026-11-15 for the
  instance's own admin pages: a browser sign-in for the owner and a TLS-only admin channel, on the
  owner's rulings of 2026-11-15 on [#2601](https://github.com/openzigs/onyourleft/issues/2601),
  [#2639](https://github.com/openzigs/onyourleft/issues/2639) and
  [#2646](https://github.com/openzigs/onyourleft/issues/2646). It is **Proposed** until the owner
  approves it on its pull request. It supersedes, in part, the owner's ruling of 2026-11-14 on #2601
  (*"no new login surface"*) and ADR 0047 D-7's Operate row, D-7's two phase-1 moderator rows, D-8
  and D-11, as an ADR rather than amendments, because ADR 0013 D-3 sends a reversed decision to a new
  ADR; ADR 0047 gained one dated `## Amendments` entry pointing here. #2640 claimed it by its title.
  It took the next free number after 0068; **0057 and 0058 stay claimed** by #1748 and #1752.
  The next free number was then 0070. A reviewer who remembers this file offering 0069 is reading the
  old file.
  ⚠️ **0068 is [ADR 0068](../adr/0068-a-delivery-round-holds-the-realistic-worlds-floor.md)**,
  taken by [#2513](https://github.com/openzigs/onyourleft/issues/2513) on 2026-11-12 for a Delivery
  round holding the realistic world's floor. It is **Accepted** (2026-11-12), on the owner's
  [ruling of that day](https://github.com/openzigs/onyourleft/pull/2530#issuecomment-6828858146) on #2530. It supersedes ADR 0026 D-3's step out of realism, only while a
  round runs, as an ADR rather than an amendment, because ADR 0013 D-3 sends a reversed decision to
  a new ADR. It took the next free number after 0067; **0057 and 0058 stay claimed** by #1748 and
  #1752. The next free number was then 0069. A reviewer who remembers this file offering 0068 is
  reading the old file.
  ⚠️ **0067 is [ADR 0067](../adr/0067-lap-race-bots-race-with-a-strategy-that-reads-the-race.md)**,
  taken by [#2457](https://github.com/openzigs/onyourleft/issues/2457) on 2026-11-11 for lap-race
  bots racing with a strategy that reads the race, on the owner's ruling of 2026-11-10 on
  [#2455](https://github.com/openzigs/onyourleft/issues/2455) that there can be no rule on racing
  strategy. It is **Accepted** (2026-11-11): the owner ruled on its D-8 on its pull request, (b)
  for R-3 and the rest as recommended. It supersedes ADR 0060 D-9 and ADR 0061 D-1 to D-4, D-6, D-8.1, D-8.5 and D-8.6, and, under
  its D-3 answer (b), which the owner chose, ADR 0066 D-1.5's and D-4's lap-race clauses, D-2 and D-6's last bullet, and
  ADR 0038 D-5's "Out" bullet, as an ADR rather than amendments, because ADR 0013 D-3 sends a reversed
  decision to a new ADR. It took the next free number after 0066; **0057 and 0058 stay claimed** by
  #1748 and #1752. The next free number was then 0068. A reviewer who remembers this file offering
  0067 is reading the old file.
  ⚠️ **0066 is [ADR 0066](../adr/0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md)**,
  taken by [#2424](https://github.com/openzigs/onyourleft/issues/2424) on 2026-11-10 for the bot
  pacer and the rider's own ghost giving a draft in a solo ride, on the owner's ruling of 2026-11-09
  on the epic [#2421](https://github.com/openzigs/onyourleft/issues/2421). It is **Accepted** for
  what that ruling answers, and its author's recommendations are Proposed until the owner confirms
  them (its D-9). It supersedes the first sentence of ADR 0038 D-5's "Out" bullet for those two, as
  an ADR rather than an amendment, because ADR 0013 D-3 sends a reversed decision to a new ADR. It
  took the next free number after 0065; **0057 and 0058 stay claimed** by #1748 and #1752. The
  next free number was then 0067. A reviewer who remembers this file offering 0066 is reading the
  old file.
  ⚠️ **0065 is [ADR 0065](../adr/0065-built-in-delivery-levels-shipped-in-the-app-under-odbl.md)**,
  taken by [#2360](https://github.com/openzigs/onyourleft/issues/2360) on 2026-11-08 for the
  built-in Delivery levels (short town rounds with their houses baked in, committed and shipped in
  the app under ODbL 1.0, solo only, with their obstacle roster), on the owner's rulings and answers
  of that day on #2359 and #2360. It is **Accepted**, on the owner's ruling of the same day on
  #2371. It supersedes in
  part ADR 0064 D-1, D-6.2, D-7.2 and D-8.1, ADR 0032 D-1 item 2, ADR 0056 D-2.4 and ADR 0012 D-4,
  as an ADR rather than an amendment to ADR 0064, because ADR 0013 D-3 sends a changed decision to
  a new ADR. It took the next free number after 0064; **0057 and 0058 stay claimed** by #1748 and
  #1752. The next free number was then 0066. A reviewer who remembers this file offering 0065 is
  reading the old file.
  ⚠️ **0064 is [ADR 0064](../adr/0064-built-in-lap-race-circuits-shipped-in-the-app-under-odbl.md)**,
  taken by [#2293](https://github.com/openzigs/onyourleft/issues/2293) on 2026-11-06 for the lap
  race's built-in circuits (short loops drawn on the project's own basemap, committed and shipped in
  the app under ODbL 1.0, for solo bot races only), on the owner's ruling of that day. It was
  **Accepted** the same day, on the owner's [ruling](https://github.com/openzigs/onyourleft/pull/2297#issuecomment-6700261818)
  on #2297, and it supersedes ADR 0032 D-1 item 2 and ADR 0012 D-4 in part, as an ADR rather than the amendment the issue named, because ADR 0013 D-3 sends a reversed
  decision to a new ADR. It took the next free number after 0063; **0057 and 0058 stay claimed** by
  #1748 and #1752. The next free number was then 0065. A reviewer who remembers this file offering 0064
  is reading the old file.
  ⚠️ **0063 is [ADR 0063](../adr/0063-the-design-system-direction-hi-vis.md)**, taken by
  [#2036](https://github.com/openzigs/onyourleft/issues/2036) on 2026-11-03 for the design system's
  direction (Hi-Vis: the palette, the zones, dark first, type, motion, sound and no new runtime UI
  dependency), on the owner's
  [choice of direction A](https://github.com/openzigs/onyourleft/issues/2035#issuecomment-6619125271)
  on #2035 and the rulings of that day on #2030 and #2032. It is **Proposed** until the owner accepts
  it. It took the next free number after 0062, which #2036 named by its title when it was filed;
  **0057 and 0058 stay claimed** by #1748 and #1752. The next free number was then 0064. A reviewer
  who remembers this file offering 0063 is reading the old file.
  ⚠️ **0062 is [ADR 0062](../adr/0062-we-build-our-own-basemap-archive-from-openstreetmap.md)**,
  taken by [#1557](https://github.com/openzigs/onyourleft/issues/1557) on 2026-11-01, in pull request
  [#1991](https://github.com/openzigs/onyourleft/pull/1991), for building the project's own basemap
  archive from OpenStreetMap, and **accepted on the owner's
  [ruling of the same day](https://github.com/openzigs/onyourleft/pull/1991#issuecomment-6562146716)**
  that ADR 0010 D-1's *"We do not generate"* be superseded by a new ADR rather than amended. It took
  the next free number after 0061; **0057 and 0058 stay claimed** by #1748 and #1752. The next free
  number was then 0063. A reviewer who remembers this file offering 0062 is reading the old file.
  ⚠️ **0061 is [ADR 0061](../adr/0061-lap-race-bots-a-course-only-energy-plan-never-another-racer.md)**,
  taken by [#1960](https://github.com/openzigs/onyourleft/issues/1960) on 2026-11-01 for the lap-race
  bots' course-only energy plan, and **accepted on the owner's
  [ruling of the same day](https://github.com/openzigs/onyourleft/pull/1984#issuecomment-6557317199)** on #1984, with every D-7 recommendation as written. The owner
  had ruled on [#1977](https://github.com/openzigs/onyourleft/pull/1977) that day that the plan is a new
  ADR rather than an amendment to ADR 0060. It took the next free number after 0060; **0057 and 0058
  stay claimed** by #1748 and #1752. The next free number was then 0062. A reviewer who remembers this
  file offering 0061 is reading the old file.
  ⚠️ **0060 is [ADR 0060](../adr/0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)**,
  taken by [#1895](https://github.com/openzigs/onyourleft/issues/1895) on 2026-10-30 for the lap
  race (the epic [#1894](https://github.com/openzigs/onyourleft/issues/1894)), and **accepted on the
  owner's ruling of the same day**, with every D-14 recommendation as written. It took the next free number after 0059; **0057 and 0058 stay claimed** by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752). The next free number was then 0061. A
  reviewer who remembers this file offering 0060 is reading the old file.
  ⚠️ **0059 is [ADR 0059](../adr/0059-delivery-a-parcel-round-game-mode.md)**, taken by
  [#1804](https://github.com/openzigs/onyourleft/issues/1804) on 2026-10-28 for Delivery, the
  parcel-round game mode, on the owner's rulings DL1, DL4, DL5, DL6, DL6b and DL11 of 2026-10-27 on
  the epic [#1803](https://github.com/openzigs/onyourleft/issues/1803). The owner **accepted** it the
  same day. It skipped **0057, claimed by [#1748](https://github.com/openzigs/onyourleft/issues/1748)**
  (store fees the publisher pays), and **0058, claimed by
  [#1752](https://github.com/openzigs/onyourleft/issues/1752)** (iOS screen capture on the camera
  screens), each by its title and both unwritten on that day. The next free number was then 0060. A
  reviewer who remembers this file offering 0057 is reading the old file.
  ⚠️ **0055 is [ADR 0055](../adr/0055-place-kinds-and-ranks-from-the-corridor-never-a-name.md)**,
  taken by [#1631](https://github.com/openzigs/onyourleft/issues/1631) on 2026-10-24 for the `places`
  layer's kind and rank read from the corridor tiles already fetched, never a name, on the owner's
  ruling (a) of that day on [#1628](https://github.com/openzigs/onyourleft/issues/1628). It was
  claimed by #1631 when that issue was filed, and was **accepted** by the owner there on 2026-10-25.
  It supersedes ADR 0054 D-2.2 in part. A reviewer who remembers this sentence offering 0055 is
  reading the old file.
  ⚠️ **0056 is [ADR 0056](../adr/0056-the-demos-shipped-map-under-odbl.md)**, taken by
  [#1644](https://github.com/openzigs/onyourleft/issues/1644) on 2026-10-24 for the demo's shipped
  map under ODbL 1.0, on the owner's rulings of that day on
  [#1643](https://github.com/openzigs/onyourleft/issues/1643), and **accepted** by the owner on 2026-10-25. It supersedes ADR 0054 D-1 item 2 and D-3.5 in part, for the demo build only.
  ⚠️ **0054 is [ADR 0054](../adr/0054-towns-from-real-map-data.md)**, taken by
  [#1538](https://github.com/openzigs/onyourleft/issues/1538) on 2026-10-21 for towns from real map
  data, on the owner's ruling of that day on [#1533](https://github.com/openzigs/onyourleft/issues/1533),
  and **Accepted** by the owner that day. It supersedes ADR 0032 D-1 in part and is the successor
  to ADR 0012 that ADR 0012 D-3.2 requires. A reviewer who remembers this sentence offering 0054 is
  reading the old file.
  ⚠️ **0053 is [ADR 0053](../adr/0053-the-fit-lap-mark-a-developer-field-of-our-own.md)**, taken by
  [#1320](https://github.com/openzigs/onyourleft/issues/1320) on 2026-10-21 for the FIT lap mark, a
  developer field of this client's own, and **accepted on the owner's ruling of that day on
  [#1520](https://github.com/openzigs/onyourleft/pull/1520)**. It relates to ADR 0006 and does not
  amend it. A reviewer who remembers this sentence offering 0053 is reading the old file.
  ⚠️ **0052 is [ADR 0052](../adr/0052-the-phones-tilt-on-the-side-camera-link-and-adr-0044-accepted.md)**,
  taken by [#1122](https://github.com/openzigs/onyourleft/issues/1122) on 2026-10-16 for the side-camera
  phone's tilt message and ADR 0044's acceptance, and **accepted on the owner's rulings of 2026-10-03
  and 2026-10-04**. It widens ADR 0033 D-3 by one message. A reviewer who remembers this sentence
  offering 0052 is reading the old file.
  ⚠️ **0051 is [ADR 0051](../adr/0051-live-race-standings.md)**, taken by
  [#1347](https://github.com/openzigs/onyourleft/issues/1347) on 2026-10-14 for live race standings,
  and **accepted on the owner's ruling on that issue**. It supersedes ADR 0028 D-7.7 and, for live
  racers only, ADR 0007 D4's second ❌. A reviewer who remembers this sentence offering 0051 is
  reading the old file.
  ⚠️ **0050 is [ADR 0050](../adr/0050-side-camera-pictures-to-the-riders-instance-sealed.md)**, taken by
  [#1106](https://github.com/openzigs/onyourleft/issues/1106) on 2026-10-12 for the side camera's
  pictures going to the rider's instance, sealed, and **accepted on the owner's decisions on that
  issue**. It supersedes ADR 0029 D-6 and D-7, ADR 0047 D-14 Q4 and ADR 0046 D-1 for that one
  payload. It was drafted as amendments that offered 0049; a reviewer who remembers this sentence
  offering 0050 is reading the old file.
  ⚠️ **0049 is [ADR 0049](../adr/0049-open-asset-sources-for-the-realistic-world.md)**, taken by
  [#1275](https://github.com/openzigs/onyourleft/issues/1275) on 2026-10-11 for more open asset
  sources for the realistic world and the meaning of "AI-generated", and **accepted on the owner's
  ruling on that issue**. It supersedes ADR 0026 D-4's source list. A reviewer who remembers this
  sentence offering 0049 is reading the old file.
  ⚠️ **0048 is [ADR 0048](../adr/0048-workouts-that-change-during-the-ride.md)**, taken by
  [#1233](https://github.com/openzigs/onyourleft/issues/1233) on 2026-10-09 for workouts that change
  during the ride (a heart-rate hold on the device, and re-plans an instance agent may only
  propose), and **accepted on the owner's rulings of the same day**. A reviewer who remembers this
  sentence offering 0048 is reading the old file.
  ⚠️ **0047 is [ADR 0047](../adr/0047-end-to-end-encryption-between-the-app-and-its-instance.md)**,
  taken by [#1179](https://github.com/openzigs/onyourleft/issues/1179) on 2026-10-08 for end-to-end
  encryption between the app and its instance, and **accepted by the owner on 2026-10-08**. A
  reviewer who remembers this sentence offering 0047, or calling it Proposed, is reading the old file.
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
