# The packages

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the `packages/` part of the §2 layout tree and the paragraph on which packages exist, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you work in any package under `packages/` (and read that package's own README).**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

From the layout tree of CLAUDE.md §2, from `packages/`:

```
packages/             Apache-2.0, without exception
  domain/             units, core types, validation, signing, analysis (#25)
    analysis/           the power-duration curve and the critical-power fit (#75),
                        the training zones (#78), the per-ride load metrics
                        (#76) and the fitness/fatigue series (#77) — whose
                        NAMES are a trademark question, see §6
    identity/           the record format, the canonical bytes, verification (#61)
    recording/          the recording session state machine and stream merge (#45)
    route/              the route profile (#89) — elevation and gradient as a
                        function of distance, the three windows it is built
                        from, and the loop wrap; and since #326 `wind.ts` — the
                        heading at a distance and the wind resolved against it,
                        which is the ONE place a wind vector becomes a headwind.
                        Here because `packages/physics` says that resolution
                        "needs a course and a compass and this package has
                        neither", and because the rider and the bot pacer must
                        read one implementation of it
    routing/            the engine-agnostic routing interface (#70) — the
                        named product options a rider chooses, and the one
                        place an engine's numbers are checked before anything
                        believes them. Here rather than in a client because
                        ADR 0010 D-4 says the interface outlives the transport
    pacer/              the bot pacer (#92) — the pacing rule at a fixed 75 kg,
                        and the gap to the rider as two unwrapped odometers
    trainer/            the gradient setpoint driver (#90) — where the rider is
                        on the route, the grade there, and whether it is worth
                        a write yet
    ghost/              racing your own previous attempt (#93) — a replay of
                        recorded distance against recorded time, never a
                        re-simulation, and no athlete id anywhere in it
    workout/            structured workouts (#14) — the model, the timeline a
                        player looks up rather than replays, the ERG
                        spiral-of-death rule, the player itself, which emits an
                        intent and writes nothing, and since #202 the file
                        format: one key that is both identity and version, an
                        unknown key refused rather than ignored, and the bound
                        that stops an expansion allocating two million
                        segments. ADR 0017, and §6
    segment/            the segment model (#64), the matcher (#66) and the effort
                        comparison (#67) — endpoints and bearings, the cell
                        prefilter and, since #291, the margin that makes it
                        conservative at a cell line rather than only at a
                        cell's shape, discrete Fréchet, the effort with its
                        three-state visibility, and where the time went
  fit/                FIT / GPX / TCX codec (#29-#32)
    tools/uploads/      the six files #138 asks a person to upload (#111) — this
                        package's own encoder output, built from the synthetic
                        corpus, and the one of the six that is expected to be
                        refused
    src/route/          route import (#89) and export (#74) — the #32 decoder
                        composed with the profile, the refusals a rider can act
                        on, and the GPX and TCX course writers
  sensors/            sensor abstraction and BLE transport (#39-#44) — BLE only
    src/                the transport-agnostic abstraction; no platform API at all
    protocol/           the GATT profile clients (#41, #42) — service UUIDs, payload
                        decoding, and since #90 the simulation writer and the
                        choice of control point on a machine offering two, and
                        since #14 the ERG writer, which cannot send a Reset
                        because the method is not on the type it holds
    web-bluetooth/      the browser transport (#40) — the one place a BluetoothDevice exists
  physics/            cycling power/speed model, Martin et al. 1998 (#88), and
                      the synthetic rider that composes #92's rule with it; and
                      since #487 the coefficient set a ride runs (`riding.ts`,
                      moved out of `apps/web/src/game/rider.ts` so a race room
                      runs the game's own set), `PHYSICS_VERSION`, and the race
                      room's plausibility rule (`plausibility.ts`, ADR 0028 D-2
                      rules 1–4, Q3's ceilings as a parameter default).
                      ⚠️ A breach FLAGS and never rejects, and an inadmissible
                      report coasts the rider at zero — never their last power
  protocol/           the race-room wire format (#768) — every message, the
                      encoder, a bounded decoder that refuses rather than
                      throws, and the version handshake. ⚠️ NO production
                      dependency, not even a workspace one: a room passes its
                      `PHYSICS_VERSION` in, and `physics-agreement.test.ts`
                      holds the restated bounds equal to physics'. A report
                      carries power, never a position, and no message carries
                      a coordinate (`coordinates.test.ts`)
  store/              local activity, stream, recording-checkpoint, signed-record,
                      segment, effort and route store, and the round-trip harness
                      (#26-#28, #46, #61, #64, #66, #89); since #388 the side
                      camera's post-ride report at schema version 12 —
                      sentences only, one per ride; and since #800, at
                      version 13, that report's pose summary (differences
                      only, `null` where none was kept) and one model
                      write-up per ride. ⚠️ Version 13 is the FIRST record
                      migration: `SCHEMA_MIGRATIONS` is not empty and
                      `ActivityStore` runs `upgradeWith` as a version's
                      `.upgrade()`. Since #881 (#776, #893's review), at
                      version 14, the SYNC BASE: what this device and its
                      instance last agreed on, two digests a ride and an
                      item. ⚠️ A ride's base row OUTLIVES `deleteActivity` on
                      purpose — it is the device's record that a synced ride
                      was deleted here — and goes with `deleteAthlete`.
                      Since #793, at version 15 (the SECOND record
                      migration), every ride's "may be raced" consent,
                      `mayBeRaced`, off by default: never the share setting
                      (ADR 0021 D-5.1). `listRaceableAttempts` is the
                      consent-scoped cross-rider read and
                      `activity-store.race-consent.test.ts` its test, red
                      against `consentIgnoredStoreFactory`. ⚠️ Nothing calls
                      it yet — #331, in a LATER pull request, and it must not
                      touch `activity-store.ghost-scope.test.ts` in the same
                      one (ADR 0039 D-2.3). Since #836, at version 16, `riderTexts`: the rider's goals,
                      a note per ride and their documents, plain text, limits
                      in CHARACTERS (`rider-text.ts`). ⚠️ Every athlete's goals
                      share the key `goals`: only the athlete tells them apart.
                      A goal's or a document's sync base row names NO ride
                      (`activityId: null`)

```


**`apps/web`, `apps/mobile`, `apps/instance`, `packages/domain`, `packages/sensors`, `packages/fit`,
`packages/store`, `packages/physics` and — since [#768](https://github.com/openzigs/onyourleft/issues/768)
— `packages/protocol` exist.** `apps/instance` was created by
[#767](https://github.com/openzigs/onyourleft/issues/767) on 2026-09-29, the first package that
listens on a socket (ADR 0036).
The first two were created by [#23](https://github.com/openzigs/onyourleft/issues/23) along with the
workspace, the toolchain and the lockfile, `packages/sensors` by
[#39](https://github.com/openzigs/onyourleft/issues/39), `packages/store` by
[#26](https://github.com/openzigs/onyourleft/issues/26), `packages/fit` by
[#107](https://github.com/openzigs/onyourleft/issues/107), `packages/physics` by
[#88](https://github.com/openzigs/onyourleft/issues/88). ⚠️ **`packages/matching` existed
between #65 and #66 and does not any more** — it was the #65 spike, and #66 hardened its algorithm
into `packages/domain/src/segment/` and deleted it, which is the fate
[`docs/spikes/0001-segment-matching.md`](../spikes/0001-segment-matching.md) gave it. A reviewer
who remembers this paragraph naming it is reading the old one. ⚠️ **`apps/mobile` now DOES
exist**, and this sentence used to say it did not:
[#87](https://github.com/openzigs/onyourleft/issues/87) created it ahead of
[#85](https://github.com/openzigs/onyourleft/issues/85), because #87's criteria are about the
Android shell and there was nothing to put them in. §4b is where what it has and has **not** proved
is recorded. The layout is fixed here
because ~30 sub-issues reference it by name, and the workspace globs and lint boundaries already
cover the paths, so a package arrives inside the rules rather than beside them.
