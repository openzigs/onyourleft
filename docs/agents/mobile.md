# The Android shell

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the `apps/mobile` part of the §2 layout tree, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you work in `apps/mobile` (also read `apps/mobile/README.md` and `apps/mobile/RELEASE.md`).**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

From the layout tree of CLAUDE.md §2, under `apps/`:

```
  mobile/             Capacitor shell wrapping the same web build (#85, #87)
    android/            the generated Android project, plus the connectedDevice
                        foreground service and its plugin bridge — MIT template
                        output, whose provenance and licence obligation are
                        apps/mobile/README.md §2 and whose exemptions are .spdx-exempt
    src/android/        reading a manifest as a document — NOT merging one (#87),
                        and since #318 reading the one the Gradle merge actually
                        ships: which file is the artefact, the reviewed list the
                        three injected permissions are checked against, and the
                        loud skip where nobody has run Gradle — which is CI and
                        every clean clone. Since #95 it also holds the Data
                        Safety answers filed on Play, written down as data, and
                        the rule that says whether "no location collection" is
                        still true of a permission list — run against fixtures,
                        against the reviewed list and against the merged
                        manifest itself; plus the two facts about a
                        tag-triggered workflow no pull request could otherwise
                        check, the target API floor being one number in three
                        languages and every action being pinned to a commit.
                        Since #672 `resources.ts` reads a `res/values*` file
                        the same way, and `night-colours.test.ts` holds
                        `oyl_canvas` in `res/values` and `res/values-night` to
                        `apps/web`'s two `canvas` tokens — imported by a
                        relative path, app to app, which the boundary rule
                        permits and the workspace cannot spell otherwise
                        (`@onyourleft/web` already depends on this package) —
                        and the launch theme, the window and `MainActivity`'s
                        WebView background to use it
    src/index.ts        what the shell offers the client that runs inside it —
                        the reason this package is no longer an island (§4h)
    src/ble/            the Capacitor transport against #39's interface,
                        unchanged, the one file that names BleClient, and the
                        Android side of the FTMS control point — the write
                        that is acknowledged, and the sibling that is not
    src/permission/     what a rider is told when Bluetooth will not work (#87)
    src/http/           the ONE native HTTP request the shell makes (#553): a
                        picture to the rider's own computer, outside the
                        WebView that blocks it as mixed content. What limits
                        where it goes is the web transport, and
                        `no-network.test.ts` permits `CapacitorHttp` here only
    tools/              the one thing here that talks to a phone rather than
                        running on one (#410) — `webview-probe.mjs` evaluates an
                        expression inside the shell's WebView over adb, which is
                        the only way to read the origin, `crypto.subtle` and the
                        service-worker registration a measurement needs.
                        ⚠️ NOT under `scripts/` and that is deliberate: that
                        directory is the bare-clone set and this needs adb, a
                        phone and a DEBUG build, so it could never be a
                        repository check. ⚠️ It asks nothing — the questions
                        live in `docs/validation/0002` Part P as expressions, so
                        the tool has no opinion to go stale and nothing
                        decidable to test. Since #616 it also holds
                        `realistic-sampler.sh`, which runs ON the tablet (GPU
                        DVFS clock, SurfaceFlinger present times, skin, CPU,
                        meminfo), and `realistic-summary.mjs`, which turns its
                        output into a row of validation 0002 Part AH — the one
                        instrument every #615 issue is measured with. The
                        summary's arithmetic IS decidable, so it has a Vitest
                        suite (`tools/**/*.test.mjs`, in the mobile project)
```
