# Spike 0002: What #15 can and cannot be verified from, measured 2026-09-09

> ⚠️ **A spike write-up is not an ADR and decides nothing.** It is a dated measurement that
> [ADR 0018](../adr/0018-native-client-platform.md) and
> [#15](https://github.com/openzigs/onyourleft/issues/15) rest on, and it ages the way a measurement
> does. `CLAUDE.md` §7: do not renumber it, and do not edit a finding out of it — if a later run
> contradicts this, that is a **second write-up**.

## Why this exists

[#15](https://github.com/openzigs/onyourleft/issues/15) has six acceptance criteria. Two of them are
checkable from a container and four are not, and the difference is not obvious from reading them —
three of the four *sound* like software questions and are actually hardware ones. Somebody will
eventually be told "complete #15" and will need to know, before they start, which parts have a
route and which do not.

This is that list, with what each blocked one actually needs.

## Method

Read `#15`'s acceptance criteria one at a time against the repository and this environment on
2026-09-09. Where a criterion was checkable, it was checked and the check committed. Where it was
not, the specific missing thing is named rather than "needs hardware".

## Findings

| # | Criterion | Status | What it needs |
| --- | --- | --- | --- |
| 1 | #39's sensor interface used **with no changes to the interface itself** | ⚠️ **True today, not asserted** | See below |
| 2 | 2-hour backgrounded ride, sample count within a stated tolerance of a simultaneous foreground recording | ❌ **Blocked** | A phone, a real BLE trainer, and two hours |
| 3 | A phone call, a low-battery event and an OS memory-pressure kill each leave a recoverable partial ride | ❌ **Blocked** | A phone; the third needs a way to induce memory pressure (`adb shell am send-trim-memory`) |
| 4 | Reaches an iPhone and records from a real BLE trainer, device model and iOS version in the PR | ❌ **Blocked** | An iPhone, a Mac, Xcode, a $99/yr Apple Developer membership, a trainer |
| 5 | No ANT+ code, dependency, permission or string anywhere in the client, asserted by grep in CI | ✅ **Done, and a hole was found** | — |
| 6 | Mobile and web byte-identical in FIT output for the same input stream, asserted by a shared fixture | ✅ **Done** | — |

### Criterion 5 — the rule did not cover the word "dependency"

`SCOPE001` scanned `source_files` under `packages/` and `apps/`, which is the SPDX-header extension
list: `.ts .tsx .js .jsx .mjs .cjs .css .sh .kt .kts .java .gradle .xml`. That covers three of the
four words in the criterion — **code** by the extension list, **permission** by `*.xml` reaching an
`AndroidManifest.xml` since #87, **string** by both.

⚠️ **It did not cover `package.json`,** because `source_files` returns no `.json` at all. So
`"ant-plus": "^1.0.0"` in a manifest passed a rule whose issue calls it *"what stops the scope
quietly returning"*. Fixed in the same pull request as this write-up, with a fixture that fails and
a second asserting a dependency merely *containing* those letters still passes.

### Criterion 6 — asserted structurally, not by encoding twice

`apps/web/src/transfer/cross-client-fit.test.ts`. Encoding the same fixture twice and comparing
would compare a function with itself; what actually makes the bytes identical is that
`capacitor.config.ts` sets `webDir: '../web/dist'`, so the shell ships this build. The test asserts
the bytes **and** that fact, plus that `apps/mobile` declares no codec dependency and names the
codec nowhere in its source.

### Criterion 1 — true, and worth saying why it is not asserted here

`apps/mobile/src/ble/` implements `packages/sensors`' interface and the interface has not changed;
`fitness-machine-channel.test.ts` and `transport.test.ts` already exercise it. What #15 asks for is
a **diff**-shaped assertion — "adapter additions only" — which is a claim about a change rather than
about a state, and a test cannot make it. It is a reviewer's question at the time an adapter lands,
and the place it is written down is `CLAUDE.md` §4h.

### The one thing that is a software question and still cannot be answered

⚠️ **Whether a backgrounded WebView keeps delivering BLE notification callbacks into JavaScript.**
#15's revision block corrects the spike's original framing here and the correction is the most
important sentence in the epic: a foreground service keeps the *process* alive and `BluetoothGatt`
connections are held by the process, so **connections survive**. The open question is the callback
path, and if the WebView is suspended the connections stay open while the samples go nowhere.

That is a silent failure — software that looks like it is working and loses an hour — and it is
[ADR 0018](../adr/0018-native-client-platform.md) D-4's condition. It cannot be answered without a
device, and it cannot be *inferred* from the fact that the Android foreground service exists.

## What was deliberately not done

**`npx cap add ios` was not run.** It writes an Xcode project, a Podfile and a workspace, none of
which can be compiled here — no Mac, no Xcode, no membership. `apps/mobile/README.md` §4 records
what committing an unbuildable Android tree already cost: six of eight criteria unverifiable, and a
`gradle-wrapper.jar` whose checksum could not be checked. A second, larger unbuildable tree would
produce green typechecks and green tests over code no build has ever seen, which is the false pass
that file exists to warn about. ADR 0018 D-5 makes it a rule rather than a judgement call.

## What would settle the blocked four

One person, one afternoon, with: an Android phone, an iPhone, a Mac with Xcode, an Apple Developer
membership, and any FTMS trainer. Criteria 2 and 3 on Android first — the cheaper loop, and
`adb dumpsys` gives ground truth — then 4 on iOS. Criterion 2's tolerance must be **stated and
measured**, not demonstrated: #15 is explicit that a sample count is the result and "background
recording works" is not.
