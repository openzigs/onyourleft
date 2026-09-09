# Validation 0001 — a trainer, three sensors, and two upload accounts

**Status:** procedure written, **not yet run**. Every result table below is empty on purpose.
**Written:** 2026-09-09, against `main` at the merge of #220.
**Discharges, when run:** [#134](https://github.com/openzigs/onyourleft/issues/134) part 2,
[#137](https://github.com/openzigs/onyourleft/issues/137) in full,
[#138](https://github.com/openzigs/onyourleft/issues/138) in full.

---

## What this is, and what it is not

**It is a script for one afternoon.** Three issues in this repository need bytes that came off
real hardware and files that a real platform accepted, and none of them can be discharged by an
agent. Everything that *could* be prepared in advance has been: the capture tool, the six upload
files, and this procedure. What is left is a person, a bike, a trainer and about ninety minutes.

**It is not an ADR and it decides nothing.** Like a spike write-up it is dated and it ages: a
result here describes one trainer's firmware on one day. `ADR00*` rules are scoped to `docs/adr/`
and do not apply.

**It is not a substitute for reading `SECURITY.md` §"Trainer control".** CLAUDE.md §6:

> Trainer control is a safety issue, not only a security one. A smart trainer applies physical
> resistance to a person who is pedalling.

---

## ⚠️ Safety, and why the steps are in this order

**#137 lists its five checks in the order it thought of them. This document deliberately runs them
in a different order, and the reordering is the safety design.**

The two checks that can hurt somebody are *"an ERG target is actually held"* — which applies real
resistance — and *"disconnect mid-ERG"*, which asks what a trainer does when the link drops while
it is holding a target. The honest answer to the second is **nobody knows**, which is exactly why
#137 files it: *"If it keeps applying resistance, a rider is pushing against a load nothing can now
change."*

So:

1. **Everything that only reads runs first.** T1–T3 write nothing that changes resistance.
2. **The one test that leaves a trainer in an unknown state runs last** (T7), when nothing after
   it depends on the trainer being in a known one.
3. **T7 is run at the lowest target the trainer will hold, with the rider off the bike.** The
   question is what the *trainer* does, and a person pedalling adds nothing to the answer.
4. **Have the power switch within reach for T6 and T7.** Pulling mains power is the recovery, and
   it is the recovery precisely because the failure being tested is that nothing else works.

> ⚠️ **If the trainer keeps applying resistance after the link drops, stop and write it down
> before doing anything else.** That is the finding, it is the highest-severity one in the set, and
> it is the input to a product decision (a timeout? a wind-down? a refusal to enter ERG at all
> without one?) that cannot be made without it.

**Do not clip in for T7.** Flat pedals or bare feet, or stand beside the bike.

---

## What you need

| | |
|---|---|
| A smart trainer | FTMS (`0x1826`). Note the model **and firmware version** before you start — the Device Information Service is optional and many trainers do not serve it |
| A power meter | Cycling Power Service (`0x1818`), ideally **not** the trainer, so #134's "at least one real power meter" is a second device |
| A speed/cadence sensor | Cycling Speed and Cadence (`0x1816`) |
| A heart rate strap | Heart Rate Service (`0x180D`) |
| A laptop running Chrome or Edge | **Not Safari, not Firefox** — neither implements Web Bluetooth and neither intends to (CLAUDE.md §8) |
| A second app that can control the trainer | The trainer vendor's own phone app is easiest. Needed for T6 |
| Two platform accounts | Strava, plus Garmin Connect or TrainingPeaks — for part C |

⚠️ **Web Bluetooth is withheld outside a secure context.** `localhost` counts; a page served over
plain HTTP from one machine to another does not. Run the harness on the same machine you pair from.

---

## Before the session — about ten minutes, and worth doing the day before

```bash
nvm install && nvm use
corepack enable pnpm
pnpm install --frozen-lockfile

# The capture page. Serves browser/dist on http://127.0.0.1:4319.
pnpm --filter @onyourleft/web exec vite build --config vite.browser.config.ts
pnpm --filter @onyourleft/web exec vite preview --config vite.browser.config.ts --host 127.0.0.1 --port 4319 --strictPort

# In another terminal: the six files part C uploads. Written to
# packages/fit/dist/validation-uploads, which is gitignored — regenerate, do not commit.
pnpm --filter @onyourleft/fit run uploads:generate
```

Open <http://127.0.0.1:4319/capture.html>. It should say Bluetooth is available. If it does not,
the message names the reason and there is no point taking the bike out.

---

## Part A — the sensors (#134)

#134 wants *"frames captured from at least one real power meter and one real speed/cadence sensor,
committed as fixtures with the device and firmware recorded"*, and *"any deviation from the
specification documented next to the fixture rather than worked around silently in the decoder"*.

**A1.** Type the hardware into the box at the top of the capture page. Model and firmware, as you
read them off the device or its own app. Nothing about the hardware reaches the file unless you
put it there — the capture deliberately records **no device name**, because a trainer's advertised
name is routinely its owner's and the file is destined for a public repository.

**A2.** Pair each sensor in turn — *Pair a power source*, *Pair a speed/cadence sensor*, *Pair a
heart rate strap*. Each needs its own click: Web Bluetooth requires a user gesture **per device**
and a chooser cannot be opened programmatically.

**A3.** Pedal for **two minutes** with all three streaming. Then stop pedalling for thirty seconds
and start again — a dropout and a re-acquisition are the frames the decoder is least likely to have
seen. Then coast for thirty seconds, so a zero-power frame is in there.

**A4.** Press *Download the capture*. You now have `capture-1.json`.

**A5.** Read it before you commit it. It should contain no device name and no wall-clock instant —
every event is an offset in milliseconds from the start.

### What to do with the file

Commit it under `packages/sensors/fixtures/` with the hardware named in the file itself and a row
in a README beside it, the way `packages/fit/fixtures/README.md` §5 does for the FIT corpus. Then,
for every frame that does **not** decode the way the specification says it should, write the
deviation down next to the fixture. #134 is explicit that this is the requirement — a deviation
worked around silently in the decoder is the failure mode, not the deviation.

### A results

| | Device, firmware | Frames captured | Deviations from the spec |
|---|---|---|---|
| Power meter | | | |
| Speed/cadence | | | |
| Heart rate | | | |

---

## Part B — the trainer (#137)

Run these **in this order**. The order is the safety design; see above.

### T1 — the CCCD is `0x0002`, not `0x0001`

Press *Open the fitness machine and take control*. The page reports the supported power range, the
resistance range and which of ERG and gradient the feature bits allow.

`enableControlPointIndications()` writes `0x0002` to the control point's Client Characteristic
Configuration descriptor. **Indications, not notifications** — an indication is acknowledged at the
ATT layer and a notification is not. #137: *"A trainer that silently ignores `0x0001` is the
failure that presents as broken hardware."*

**Passes when** control is granted and the page says so. If the machine never answers, the
procedure times out after five seconds and the page reports a refusal rather than hanging.

- [ ] Control granted
- [ ] Power range as reported by the machine: `______ – ______ W`, increment `______ W`
- [ ] Resistance range: `______ – ______`, increment `______`
- [ ] ERG offered: yes / no  ·  Gradient offered: yes / no

⚠️ **Write down the range and the increment even if they look obvious.** A hard-coded range is the
assumption #43's criteria forbid, and the increment is the field that gets it wrong invisibly: a
trainer with a 5 W step asked for 251 W does something unspecified with the 1.

### T2 — a rejected command is reported as rejected

**Read this first, because the obvious test does not work and that is a design decision, not a
gap.** `createTrainerControl` bounds and quantises a setpoint **before** it writes: an out-of-range
target is clamped on this side and never reaches the wire, and a control offered by a feature bit
the machine did not set is not offered at all. So most "bad" values cannot produce a machine-side
refusal, by construction.

What does: **another client holding control.** Take control from the vendor's phone app, then set a
target here. FTMS answers `Control Not Permitted` (`0x05`), and the client must surface a refusal
rather than reporting success.

1. With this page holding control, take control in the vendor app.
2. Set a target here — type a low number, 100 W or the machine's minimum, and press *Set target*.
3. The log should show a **refusal**, naming a reason. It must not show a confirmed target.

- [ ] The client reported a refusal rather than success
- [ ] Response code the machine sent: `______`
- [ ] What the page said to the rider: `________________________________`

If instead the client reported success, that is a serious finding: it means a rider's screen would
show a target the machine is not holding. Stop and write it down.

### T3 — control taken by another client is noticed

This is the other half of T2, and the capture already has the evidence.

FTMS §4.16.2.1 ends control permission with the connection, and a machine that revokes control
sends a Fitness Machine Status notification. `createTrainerControl` listens for it, drops its
belief that it has control, and — because `reacquireControl` defaults to `true` — asks for it back.

- [ ] The page stopped claiming control when the other app took it
- [ ] It re-requested control, and the log shows the request
- [ ] Whether the machine granted it back: yes / no

### T4 — an ERG target is actually held

**The first step that applies real resistance.** Get on the bike.

1. Make sure no other app holds control (close the vendor app).
2. Set a target well away from what you would produce incidentally — 150 W is a good start.
3. Pedal at **60 rpm** for a minute, then at **95 rpm** for a minute, *without changing gear*.

An ERG trainer holds the wattage across both cadences. #137: *"pedal at a cadence well away from
the one that would produce it incidentally, and confirm the trainer holds the wattage."*

- [ ] Held at 60 rpm: reported `______ W` against a target of `______ W`
- [ ] Held at 95 rpm: reported `______ W`
- [ ] Time to settle after the target changed: `______ s`

⚠️ **If the resistance climbs while your cadence falls and you cannot get on top of it, stop
pedalling.** That is the ERG spiral of death, `packages/domain/src/workout/erg-safety.ts` is what
detects it, and observing one here is a useful result — record the cadence it started at.

### T5 — the setpoint is quantised, and the quantisation is the machine's own

Ask for a target that is **not** a multiple of the increment T1 reported — 152 W on a 5 W trainer.

- [ ] Asked for `______ W`, client wrote `______ W`, machine confirmed `______ W`

### T6 — a target survives a clean reconnection

Set a target, then switch the trainer off at the wall and on again while the page is open.

FTMS ends control permission with the connection, so control does **not** survive. What should
happen is that the channel re-resolves its characteristics on the new link, the client reports
control lost, and a fresh Request Control is needed.

- [ ] The page reported the link lost
- [ ] After reconnecting, it did **not** claim to still hold a target
- [ ] Whether the trainer was still applying the old resistance while disconnected: yes / no

### T7 — disconnect mid-ERG ⚠️ **run this last, off the bike**

**The highest-severity case in this document and the one no simulator settles.**

1. **Get off the bike.** Flat pedals or standing beside it. Do not clip in.
2. Set the **lowest** target the trainer will hold — the minimum T1 reported.
3. Have the trainer's power switch within reach.
4. Now break the link *without* switching the trainer off: switch Bluetooth off on the laptop, or
   walk it out of range, or close the tab.
5. Turn the cranks **by hand** and feel whether resistance is still being applied.

- [ ] Resistance after the link dropped: still applied / released / wound down over `______ s`
- [ ] If still applied: for how long, and what ended it: `________________________________`
- [ ] What ended it: the trainer's own timeout / power cycle / never

**This result is the input to a product decision.** If a real trainer keeps applying resistance
indefinitely, then entering ERG mode is a commitment a rider cannot exit by closing a laptop lid,
and the client has to do something about it — a keepalive, a wind-down before disconnect, or a
refusal to enter ERG at all on a machine that behaves this way. File the decision as an issue with
this result quoted in it; do not decide it here.

---

## Part C — the encoded files (#138)

`pnpm --filter @onyourleft/fit run uploads:generate` writes six files to
`packages/fit/dist/validation-uploads`. They are **encoder output**, not corpus fixtures forwarded:
each is decoded from the #29 synthetic corpus and re-encoded by this package, because #138's
criterion is about *this package's* files.

⚠️ **Every coordinate in them is inside a synthetic test region and none of them is anybody's
ride.** ADR 0004 decision G, and `tools/uploads/uploads.test.ts` asserts it over the artefacts
rather than over the corpus, because the artefacts are what travel. Do **not** substitute a real
ride: an upload is irreversible, and uploading a real ride to two platforms to test an encoder
would defeat the privacy posture the rest of this repository is careful about.

Upload each file by hand. For each, record whether it was accepted, and — if it was — whether
distance, elapsed time, moving time and every channel are right.

### ⚠️ One of the six is expected to be refused, and that is the question

`indoor-no-position.gpx` contains **`<trkpt>` elements with no `lat` and no `lon`**, because GPX
1.1 has no way to express a sample without a position. GPX 1.1's `wptType` declares both attributes
`use="required"`, so the document is schema-invalid.

That is a **deliberate** choice with two rejected alternatives, both worse: writing `0,0` puts the
ride in the Gulf of Guinea (`packages/fit/src/xml/track.ts` says so), and dropping every sample
yields an empty track carrying nothing. This project's own decoder reads the file back happily —
which is exactly the encoder-and-decoder-wrong-in-the-same-direction blind spot CLAUDE.md §5 names,
and the reason a third-party importer is the only thing that settles it.

**So whichever way this goes, it is a result:**

- **Accepted** — record it, and the choice stands.
- **Refused** — record the platform's own message and open an issue. The candidates are (a) refuse
  to export GPX for a ride with no position at all, and say so on the export screen through the
  existing "what the file could not carry" path, or (b) write an empty `<trkseg>`. Both need a
  decision; neither should be made from this document.

### C results

| File | Strava | Second platform (name it) | Notes / the platform's own message |
|---|---|---|---|
| `outdoor-ride.fit` | | | |
| `outdoor-ride.tcx` | | | |
| `outdoor-ride.gpx` | | | |
| `indoor-no-position.fit` | | | |
| `indoor-no-position.tcx` | | | |
| `indoor-no-position.gpx` | | | |

Any rejection is *"recorded with the platform's own message, and either fixed or documented as a
known limitation in `packages/fit/README.md`"* — #138's last criterion, verbatim.

---

## After the session

1. **Commit the capture** as a fixture, with the hardware and firmware named in the file and a row
   in a README beside it.
2. **Fill in every table above and commit this document**, including the rows that came back
   uninteresting. A blank row a year from now is indistinguishable from a step nobody ran.
3. **Change the Status line at the top** to say when it was run and on what.
4. **Close #134, #137 and #138** against the results, or say on each which of its criteria is still
   open and why.
5. **File a separate issue for each product decision this raises** — T7 especially. A result is
   evidence; it is not a decision, and this file is not the place to make one.

---

## What this procedure cannot establish

Said here rather than discovered later:

- **Nothing about iOS.** Web Bluetooth ships in no Safari, so this whole procedure is Chromium-only
  and always will be. iOS is [ADR 0018](../adr/0018-native-client-platform.md)'s problem.
- **Nothing about Android.** The Capacitor transport is a different code path with a different
  plugin under it. Its FTMS control point is `apps/mobile/src/ble/fitness-machine-channel.ts`, and
  it needs its own session on a phone.
- **Nothing about background recording.** That is
  [spike 0002](../spikes/0002-background-recording.md)'s blocked column.
- **Nothing about frame rate or thermal behaviour.** ADR 0008 D-2's rendering gate was **waived**,
  not passed, and a 60-minute run on the device floor is still outstanding.
- **Nothing about more than three concurrent BLE connections.** Web Bluetooth's practical budget is
  about three, not seven (CLAUDE.md §8), and pairing four devices is a test of that limit rather
  than of anything in this document.
