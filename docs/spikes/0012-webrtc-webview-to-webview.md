# Spike 0012: A host-only WebRTC data channel between the app's WebView on two Android devices

- **Date measured**: **2026-09-25.** Every figure below was produced on that day with the devices in
  §2. Nothing here is quoted from documentation unless it says so
- **Issue**: [#532](https://github.com/openzigs/onyourleft/issues/532), the pair
  [spike 0011](0011-webrtc-host-only-on-the-lan.md) could not measure. It feeds
  [ADR 0033](../adr/0033-side-camera-link.md) D-1's condition and
  [#529](https://github.com/openzigs/onyourleft/issues/529)
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."*
- **Method**: spike 0011's, reused unchanged (§3). This write-up says what differs and does not
  repeat the rest

---

## 1. The answer, for the pair #532 is about

**The On Your Left app's WebView on a Pixel Tablet and the same app's WebView on a Pixel 8 open a
host-only data channel directly, in both directions, with nothing to resolve.**

| | Tablet offers, phone answers (ADR 0033 D-1's roles) | Phone offers, tablet answers |
|---|---|---|
| Data channel opens? | **Yes**, in all 8 runs that were meant to | **Yes**, in all 7 runs |
| Offerer's channels open after it applies the answer | 110–120 ms | 72–130 ms |
| What each end offered | One UDP IPv4 host candidate, **its raw private address**, on both ends. No `.local` name, no IPv6, no TCP | The same |
| Candidate pair used | Tablet `192.168.68.69` ↔ phone `192.168.68.51`, **`host` ↔ `host`** on both ends' view. The only pair either end formed | The same |
| Only the tablet can dial (the phone never sees the tablet's candidate) | **Opens** | **Opens** |
| Only the phone can dial (the tablet never sees the phone's candidate) | **Opens** | **Opens** |
| Both ends' candidates withheld (the control that must fail) | **Never opens**, ICE stayed `new` for 30 s | not run |
| 10 minutes, 5 frames/s of 15–25 KB, phone → tablet | 3000 of 3000, none lost, reordered or duplicated. Echo RTT p50 **71.6 ms**, p99 136.2 ms | 3000 of 3000, none lost, reordered or duplicated. Echo RTT p50 **64.0 ms**, p99 153.2 ms |

**Why it works, and why spike 0011's failure does not arise here.** Spike 0011 found that an
Android end cannot resolve a Chrome mDNS `.local` candidate name, and that pairs with Android in
them connected only because the Android end published its raw address. **Both ends of this pair are
Android, and both published their raw address in every run**, so no name was ever offered and none
ever had to be resolved. Either end could dial the other on its own (§4.3). That held **with no
camera access at all** on the phone, and camera access on the tablet changed nothing (§4.5).

**What that points to** (§6): for this pair, on this router, the evidence points to **works with a
named condition**, and the condition is the one ADR 0033 D-1 already gives as its example: **the
router must not isolate Wi-Fi clients from each other.** That was not tested (§7). Spike 0011's
own condition, *"at least one end must publish a raw private address"*, is met by both ends of this
pair in every run, so it does not bind the Android ↔ Android case. It still binds any pairing where
one end is desktop Chrome.

⚠️ **One of #532's five acceptance criteria is still not met**: *"a packet capture or a router log
shows no third-party host"*. There was no capture (§5). So the pull request that lands this says
`Refs #532`, not a closing keyword, and **no amendment is appended to ADR 0033** here.

---

## 2. Devices, versions and network

| | |
|---|---|
| **Tablet** | Google **Pixel Tablet** (`tangorpro`), **Android 17** (API 37), build `CP2A.260705.006`. Wi-Fi `192.168.68.69/22`, IPv6 link-local only. On **USB** for `adb` throughout |
| **Phone** | Google **Pixel 8** (`shiba`), **Android 17** (API 37), build `CP2A.260805.005`. Wi-Fi `192.168.68.51/22`, IPv6 link-local only. On **`adb` over Wi-Fi** throughout (§3.2), and on battery once its cable was unplugged |
| **Android System WebView, both** | `com.google.android.webview` **153.0.8010.36**. UA `…; wv) … Chrome/153.0.8010.36`. The same build on both, so this is one WebView version, not two |
| **The app, both** | `dev.openzigs.onyourleft` versionName 1.0, a **debug** build (`DEBUGGABLE`) reported as built from `main` at `2b84996` and installed that day, serving the client at `https://localhost/`. Not reinstalled, not restarted, not navigated |
| **App permissions** | Tablet: `CAMERA` **granted**. Phone: `CAMERA` **not granted**. Both: `INTERNET` only otherwise. No multicast permission on either |
| **Router** | TP-Link (MAC OUI `3c:52:a1`), gateway `192.168.68.1`, a `/22`. **The model was not read.** Both devices were associated to **the same access point on its 5 GHz radio** (5200 MHz, Wi-Fi 6), RSSI −29 dBm (tablet) and −43 dBm (phone) at the start. No client isolation, since the link opened. No global IPv6 on this LAN. The SSID and BSSID are deliberately not recorded here |
| **DNS** | The Wi-Fi network hands both devices **the ISP's two public resolvers directly**, not the router. §5 says why that matters |
| **Mac** (driver only) | macOS 26.6.2, `192.168.68.65/22`. It carried DevTools traffic and nothing else. **No Mac browser took part in any run** |

The owner was not using either app during the runs. The tablet's app was on `#/camera` **with the
camera off** (its *Turn the camera on* button showing, no `<video>` in the page) and its screen
dozing when this started. The phone's app was on `#/`.

---

## 3. Method

### 3.1 The probe: spike 0011 §3.1, unchanged

`new RTCPeerConnection({ iceServers: [] })`. The offerer creates `control` (`{ ordered: true }`) and
`frames` (`{ ordered: false, maxRetransmits: 0 }`), as ADR 0033 D-3 has them. **No trickle**: each
side waits for `iceGatheringState === 'complete'` before its SDP is taken. The driver read the offer
out of one page and wrote it into the other, then carried the answer back, over the Chrome DevTools
Protocol. That is the stand-in for the two QR codes: the same bytes, all at once, out of band, and no
signalling server.

The stream is 0011's too: one binary message every 200 ms, uniform random 15,000–25,000 bytes with a
16-byte header (kind, sequence number, sender's `performance.now()`), 3000 messages. The receiver
counts frames, bytes, reordering, duplicates and gaps over 1 s, and echoes 16 bytes back on
`frames`. The sender measures the echo round trip on its own clock, so no clock synchronisation
between devices is assumed. A JSON ping goes once a second on `control` and is answered on
`control`. `getStats()` is read after the channels open and again after the stream.

**One deliberate difference from 0011**: **the phone sends the frames in both directions of the
test**, because in the product (D-3) pictures only ever go phone → tablet. In 0011 the answerer sent,
because the answerer was always the Mac.

### 3.2 How each WebView was reached

Both ends were the **running app's own `https://localhost/` page**, reached through its debug
DevTools socket (`webview_devtools_remote_<pid>`) with `adb forward`, exactly as 0011 §3.3 did for
the tablet. The probe's source was evaluated into the page, and at the end `window.__p` was deleted
and `location.href` read back unchanged on both (§8). Neither WebView was navigated, so both runs
were in the shell's real origin, as a secure context.

⚠️ **The phone's `adb` moved to Wi-Fi before the first run**, because its USB cable was unreliable
(`adb tcpip 5555`, then `adb connect 192.168.68.51:5555`). Every result in this document was taken
after that move; no run was split across it. **So the phone's DevTools traffic, and with it the
signalling, crossed the same Wi-Fi as the peer traffic**, Mac ↔ phone. That is a few kilobytes per
exchange plus one 30-second status poll during the streams. It is not the peer path: the peer path
is tablet ↔ phone and never touched the Mac (§4.2). It did share the air with it.

`adb reverse` was never used, and no peer packet could cross USB: the only candidates offered were
the two Wi-Fi addresses.

### 3.3 The controls

- **`strip`, each direction and each end** (0011 §7.2). The offerer's candidate lines were deleted
  from the offer before the answerer saw it (*only the offerer can dial*), or the answerer's were
  deleted from the answer before the offerer saw it (*only the answerer can dial*). Run with each
  device as offerer, so **each device was, in turn, the only one that could dial**.
- **Both stripped**: neither end sees any candidate of the other. This one **must** fail. It exists
  so that a green `strip` cannot be explained by the stripping not having happened.
- **Camera before and after** (§4.5), on the tablet only. The phone's app does not hold `CAMERA`, so
  `getUserMedia` there would have raised Android's permission prompt on the owner's phone. It was
  **not called**, and nothing was pressed on either device's screen.

---

## 4. Raw results

### 4.1 Connection set-up

"Open" is measured on the **offerer**, from applying the answer to both channels open. The answerer's
own figure includes the driver carrying its answer back over DevTools, so it is not a property of
the link and is left out.

| Run | Offerer | Offer gather (ms) | Answer gather (ms) | ICE `connected` after answer applied (ms) | Channels open after answer applied (ms) |
|---|---|---|---|---|---|
| A, plain ×3 | tablet | 131, 131, 136 | 110, 141, 148 | 23, 28, 29 | 110, 111, 120 |
| A, 10-min stream | tablet | 137 | 145 | 53 | 114 |
| A, only the tablet dials | tablet | 133 | 141 | 27 | 102 |
| A, only the phone dials | tablet | 138 | 140 | 16 | 74 |
| A, both stripped | tablet | 139 | 146 | **never** (ICE `new` for 30 s) | **never** |
| B, plain ×3 | phone | 130, 136, 140 | 32, 56, 68 | 27, 32, 37 | 72, 87, 130 |
| B, 10-min stream | phone | 134 | 64 | 34 | 126 |
| B, only the phone dials | phone | 139 | 138 | 76 | 138 |
| B, only the tablet dials | phone | 140 | 38 | 37 | 120 |
| C, camera opened after the offer (D-1's order) | tablet | 136 | 153 | 32 | 103 |
| C, camera opened before the offer | tablet | 126 | 70 | 56 | 158 |
| C, camera opened before the answer | phone | 134 | 49 (tablet) | 31 | 111 |

Both WebViews gathered an **offer** in **126–140 ms**. The tablet gathered an **answer** in 32–68 ms
except when the offer carried no candidate (138 ms); the phone took 70–153 ms. Either way a person
holding a phone to a QR code will not notice it. Every run but the control opened.

### 4.2 Candidates

The candidate lines from the SDPs, identical in form in every one of the 16 runs apart from the port:

| End | SDP candidate |
|---|---|
| Tablet WebView 153 | `… 1 udp 2113937151 192.168.68.69 <port> typ host generation 0 network-cost 999` |
| Phone WebView 153 | `… 1 udp 2113937151 192.168.68.51 <port> typ host generation 0 network-cost 999` |

- **Raw private IPv4 on both ends, never a `.local` name.** The phone's page had **no camera access
  at all**: `navigator.permissions.query({ name: 'camera' })` answered `prompt`, `enumerateDevices()`
  returned an unlabelled video input, and the app does not hold `CAMERA`. So D-1's worry, that an end
  hides its address until it has camera access, did not apply to either Android end.
- **No TCP candidate and no IPv6 candidate in any SDP.** `getStats()` on each end also listed a
  `::` UDP and `0.0.0.0`/`::` TCP port 9 "host" entry that is **not in the SDP**, as 0011 §4.2
  recorded for the tablet. None was ever in a candidate pair.
- **The pair.** In every plain run each end formed **exactly one candidate pair**, its own host
  candidate with the other's, and both sides saw the remote as `host`. In a stripped run the side
  that had been denied the other's candidate learned it as `prflx` from the incoming check, and
  still formed one pair. Over each 10-minute stream the pair carried **241 connectivity checks sent
  and 241 answered** each way, and nothing else was probed.
- `sctp.maxMessageSize` was **262144** on both ends.

### 4.3 One-sided controls

| Direction | Only the tablet can dial | Only the phone can dial |
|---|---|---|
| Tablet offers | Opens, 102 ms | Opens, 74 ms |
| Phone offers | Opens, 120 ms | Opens, 138 ms |
| Neither can dial | **Never opens**, 30 s | |

**Each device can reach the other on its own**, whichever of them offered. So this pair does not
depend on either end being the one that dials, which is the property spike 0011 found missing when
the far end was desktop Chrome. And the both-stripped control failed as it must, with no candidate
pair ever formed, so the four green cells are not an artefact of the stripping being skipped.

`logcat` on both devices, filtered for Chromium, WebRTC, `p2p`, `.local`, mDNS and the resolver,
through every run: **no `Failed to resolve` line and no `.local` name from the app's processes at
all**, where 0011 §4.4 logged one per stripped run. The only mDNS lines were the phone's own
system process answering the Mac's multicast queries, presumably for wireless debugging; that is the
OS, not the app, and it carried no WebRTC name.

### 4.4 The 10-minute streams

`frames` channel, `{ordered: false, maxRetransmits: 0}`, 5 messages per second of 15–25 KB, 600 s,
**always sent by the phone**.

| | A: tablet offered, phone sent | B: phone offered and sent |
|---|---|---|
| Frames sent / received | 3000 / 3000 | 3000 / 3000 |
| Lost / reordered / duplicated | 0 / 0 / 0 | 0 / 0 / 0 |
| Gaps over 1 s at the receiver | 0 | 0 |
| Payload received | 59.73 MB | 60.08 MB |
| Goodput (payload × 8 / 600 s) | 796 kbit/s | 801 kbit/s |
| Frame rate at the receiver | 5.00/s | 5.00/s |
| Sender's peak `bufferedAmount` | 24,999 bytes (the one frame just handed to `send()`) | 24,996 bytes (the same) |
| Echo RTT on `frames`: min / p50 / p90 / p95 / p99 / max (ms) | 35.7 / **71.6** / 84.7 / 94.7 / 136.2 / 221.3 | 34.6 / **64.0** / 87.8 / 112.1 / 153.2 / 250.2 |
| Ping RTT on `control`, reliable and ordered: n / p50 / p95 / p99 / max (ms) | 600 / 30.5 / 41.2 / 57.5 / 74.4 | 600 / 27.4 / 46.3 / 72.4 / 89.7 |
| ICE's own mean RTT over the run (ms) | 21.8 | 20.5 |
| Bytes on the selected pair, phone → tablet / back | 62.51 MB / 1.58 MB | 62.87 MB / 1.59 MB |
| State at the end | connected | connected |

Notes:

- **The load is trivial for this Wi-Fi**, as it was in 0011. The sender's `bufferedAmount` never held
  more than the frame it had just queued. This is **one afternoon on one router**, both devices near
  the access point on 5 GHz. It says nothing about a congested network, a 2.4 GHz band or a phone at
  the far end of a house.
- **The frame echo (64–72 ms p50) is slower than 0011's Mac pairs (41–47 ms), and that is expected,
  not a finding.** It crosses two Android event loops and two radios in power-saving mode, where 0011
  crossed one. The echo also rides behind a 15–25 KB frame. The reliable `control` ping, which
  carries a few bytes, was 27–31 ms p50, and ICE's own checks about 21 ms. An ICMP ping between the
  two devices, taken **after** the runs with the screens allowed to sleep again, gave min 10 ms and
  mean 49–78 ms, so Wi-Fi power saving plausibly accounts for most of the spread. **Not
  investigated further**: a frame for a pose model is analysed and discarded, and a *start* or
  *stop* taking 30 ms is invisible to a person.
- **No loss at all in 6000 frames**, where 0011 lost 1 in 3000 over the tablet's link to a Mac.
  Neither figure is a loss rate; both are "rare on a quiet evening".

### 4.5 Camera access and the candidates (ADR 0033 D-1's expectation)

| Run | Tablet's candidate |
|---|---|
| Plain, no `getUserMedia` in the run | `udp 2113937151 192.168.68.69 … network-cost 999` |
| Camera opened **after** the tablet's offer was gathered, before the answer was applied (D-1's order) | the same, and the pair after connecting was the same host ↔ host pair |
| Camera opened **before** the tablet created its connection, tablet offering | the same |
| Camera opened **before** the tablet answered, phone offering | the same |

`getUserMedia({ video: true })` in the tablet's app page returned one track in 184–249 ms **with no
prompt** (the app already holds `CAMERA`, and the shell granted the page's request), and the track
was stopped at once. The camera was on for well under a second each time, three times.

**On WebView 153, camera access changes nothing about the candidates, in either order.** That is
the opposite of desktop Chrome 154 in 0011 §4.2, which switched from a `.local` name to its raw
address, gained a `network-id`, and added a TCP candidate once its page had camera access. The
WebView published its raw address before and after, with the same priority and the same
`network-cost 999`, and never added a TCP candidate.

⚠️ **Two limits on that.** The tablet's page was not a clean *never had access* baseline:
`enumerateDevices()` already returned **labelled** video inputs there before any run, which usually
means the page had been granted the camera earlier in its life. The phone's page is the clean
baseline, and it published its raw address with no access at all; but **its camera could not be
opened**, so *"after camera access"* was measured on one device only.

---

## 5. Did anything leave the LAN

**The peer path: no, on every piece of evidence available, and this time from both Android ends.
But there is still no packet capture**: neither device is rooted, and the Mac cannot see
tablet ↔ phone traffic at all. What there is:

1. **Configuration.** `iceServers: []` on both ends. With no server configured, an ICE agent has
   nowhere to send a STUN or TURN request except a peer's candidate.
2. **Every candidate and candidate pair, from both ends** (`getStats()`, after the channels opened
   and after each stream). Local candidates `host` only, no `srflx`, no `relay`. Remote candidates
   `host`, or `prflx` in a stripped run. **Exactly one pair on each end, tablet ↔ phone**, 241 checks
   each way over ten minutes, and the bytes on that pair match the stream's payload plus DTLS, SCTP
   and the echoes (§4.4).
3. **Both devices' socket tables for the app's own uid**, read from `/proc/net/{udp,udp6,tcp,tcp6}`
   every 30 s through both 10-minute streams (23 samples per device per stream). The WebView's
   network service runs in the app's process, so its WebRTC sockets carry the app's uid. Throughout,
   the app held **exactly two sockets per device: one unconnected UDP socket on `0.0.0.0` and one on
   `::`, on the ports its SDP advertised, and no TCP socket of any kind** — so no HTTPS, no QUIC and
   no connected UDP from the app during the streams. Between runs it held none. ⚠️ An unconnected
   UDP socket can send to anyone, and `/proc` cannot show where it sent; item 2 is the evidence for
   the destinations, as the Mac's WebRTC log was in 0011.
4. **No name was looked up.** No `.local` candidate was ever offered by either end (§4.2), and
   `logcat` shows no resolution attempt from the app (§4.3). So spike 0011 §5's open question, whether
   a failed `.local` lookup falls back to unicast DNS and leaves the LAN, **does not arise for this
   pair**.

⚠️ **That open question is sharper than 0011 knew, for pairs that do carry a name.** This Wi-Fi hands
its clients the **ISP's public resolvers directly** (§2), not the router. So if an Android end ever
does try a `.local` candidate name by unicast DNS, the query goes straight to a third party off the
LAN, not to a router that might answer it. It does not happen for Android ↔ Android. It could for a
desktop-Chrome end whose name an Android end tries to resolve, and only a capture of port 53 settles
it (§7).

**A capture on the router, or with root on either device, is still owed** for #532's third
criterion.

---

## 6. What this points to, and what it does not

ADR 0033 D-1's table has three outcomes: **works**, **works with a named condition**, and **does not
work**.

**For the pair #532 names, the app's WebView on one Android device ↔ the app's WebView on another,
the evidence points to *works with a named condition*.** The condition:

> **The router must pass unicast traffic between two Wi-Fi clients**, that is, it must not isolate
> them. This router does. A router with client isolation on was not tested, and a host-only link
> cannot work across it by construction (so neither could D-2's local socket).

Spike 0011's condition, **at least one end must publish a raw private address**, was met by **both**
Android ends in every run, with or without camera access, so it does not bind this pair. The two
spikes together read:

| Pair | Result | Source |
|---|---|---|
| **App WebView (tablet) ↔ app WebView (phone)** | **Opens both ways, either end can dial alone, 0 of 6000 frames lost** | this spike |
| App WebView (tablet) ↔ desktop Chrome | Opens, but only because the Android end publishes its raw address; the Android end cannot dial a desktop `.local` name | 0011 pair 3 |
| Android Chrome (tablet) ↔ desktop Chrome | The same | 0011 pair 2 |
| Desktop Chrome ↔ desktop Chrome, two machines | **Unmeasured** | 0011 §6 |

**Consequences for #529, noted and not decided here:**

- **The candidate the decoder will see from an Android end is a raw private IPv4 UDP host
  candidate, and nothing else.** No `.local` name, no TCP candidate and no IPv6 candidate appeared in
  any SDP from either WebView. ADR 0033 D-4's accepted set covers it, and D-4's encoder rule (omit
  what is not accepted) has nothing to omit on this pair.
- **The TCP question 0011 §6 raised is a desktop-Chrome question only.** A WebView end never offered
  a TCP candidate, even with camera access. #529 still has to decide it before the decoder is written,
  because a desktop-Chrome phone always offers one.
- **Camera order does not matter on the WebView.** The tablet gathering its offer before its camera
  opens (D-1) produced the same candidate as the other orders.
- **No new permission.** Both apps opened the link under their existing permissions, and the phone
  did so **without `CAMERA`**. Nothing here needs multicast, so ADR 0033 D-10's *"only if needed"*
  manifest row stays unneeded for this pair.
- **The pairing screen still owes the rider a sentence for when ICE fails**, which on this pair
  would most likely mean client isolation (0011 §7.4).

**Why no amendment is appended to ADR 0033 here.** D-1 says #532's result is appended as an
amendment. This spike measures the pair #532 is about, but #532's third criterion (a capture or a
router log) is still open, and so is the one condition named above. The amendment can cite this
spike and 0011 once those are in, or earlier if the owner chooses to record the result as it
stands.

---

## 7. What remains

1. **A packet capture** on the router, or with root on either device, during a pairing and a stream:
   anything not in `192.168.68.0/22`, UDP 3478/19302, port 5353, and DNS on port 53 for `*.local`.
   This is #532's third criterion, and it is still the only one not met. For a pair with a
   desktop-Chrome end it also settles §5's unicast-`.local` question, which this pair never reaches.
2. **A router with client isolation on** (a guest network will usually do). Expected to fail; the
   failure is the wording the pairing screen owes the rider, and it turns this spike's condition from
   an argument into a measurement.
3. **A release build.** Both apps were debug builds, because that is what exposes DevTools. WebRTC
   does not depend on that flag, but this was not shown.
4. **Other Android versions and WebView channels.** Both devices ran Android 17 and the same WebView,
   153.0.8010.36. Spike 0011 §4.2's unconfirmed lead, that Chromium's `enable_mdns` build flag is off
   on Android, would make the raw-address behaviour a property of the build rather than of the
   device. It is still unconfirmed; this spike is consistent with it and does not test it.
5. **The phone with its screen off or the app in the background.** Every run had both apps in the
   foreground with the screens on. ADR 0033's tripod phone shows a filming sign while filming, so the
   foreground case is the product's, but a phone that sleeps mid-session was not measured.
6. **A harder radio**: 2.4 GHz, a congested network, the phone across a room, two access points.
7. **Desktop Chrome ↔ desktop Chrome on two machines**, still unmeasured from 0011.

---

## 8. Reproducing it

The probe was about 400 lines across a page script, a DevTools driver, a socket sampler and a
summariser in a temporary directory. **It is committed nowhere**, per #532's component note. §3 has
everything that matters: the `RTCPeerConnection` and channel options, the message shape, the order
of operations, how each end was reached, and the controls.

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$PATH:$ANDROID_HOME/platform-tools"
# one forward per device; -s is the device's serial, or ip:port under adb over Wi-Fi
adb -s <tablet> forward tcp:9411 localabstract:webview_devtools_remote_"$(adb -s <tablet> shell pidof dev.openzigs.onyourleft)"
adb -s <phone>  forward tcp:9412 localabstract:webview_devtools_remote_"$(adb -s <phone> shell pidof dev.openzigs.onyourleft)"
adb -s <device> shell cat /proc/net/udp      # the app's sockets: filter column 8 on its uid (§5 item 3)
# … run, then remove exactly the two forwards (see below)
adb -s <tablet> forward --remove tcp:9411
adb -s <phone>  forward --remove tcp:9412
```

⚠️ **`adb -s <serial> forward --remove-all` removes every device's forwards, not only that
device's.** It dropped the tablet's forward while only the phone's was meant, which is why the lines
above remove one port each.

A WebView's DevTools endpoint answers only while its app is in the foreground (0011 §8); with the
phone off USB, the screen has to be kept on some other way than `stay_on_while_plugged_in`.

**Left as found on both devices**: the probe deleted from both pages (`typeof window.__p` read back
`undefined`) and `location.href` read back as `https://localhost/#/camera` on the tablet and
`https://localhost/` on the phone; the tablet's camera off, as it was found, with no `<video>` in the
page; both `adb forward` rules removed and no `adb reverse` rule ever set; `stay_on_while_plugged_in`
put back to `0` on both after being set to `7` for the runs; the phone's screen timeout unchanged;
neither app reinstalled, restarted or navigated; nothing pressed on either screen. **The phone was
left on `adb` over Wi-Fi at `192.168.68.51:5555`**, as the move in §3.2 was meant to be lasting.
