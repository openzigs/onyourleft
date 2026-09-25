# Spike 0011: A host-only WebRTC data channel on the home LAN, with one Android device

- **Date measured**: **2026-09-25.** Every figure below was produced on that day with the devices in
  §2. Nothing here is quoted from documentation unless it says so
- **Issue**: [#532](https://github.com/openzigs/onyourleft/issues/532), a **partial** answer. It
  feeds [ADR 0033](../adr/0033-side-camera-link.md) D-1's condition and
  [#529](https://github.com/openzigs/onyourleft/issues/529)
- **Status of this document**: a **spike write-up**. `CLAUDE.md` §7: *"A spike write-up is not an ADR
  and does not decide anything — it is a dated measurement that an ADR or an issue may then rest on,
  and it ages the way a measurement does."*

> ## ⚠️ The pair #532 is about was NOT measured
>
> #532 asks whether **two Android WebViews** (the shell on the tablet and the shell on a phone) can
> open a host-only data channel. **Only one Android device was available**, the owner's Pixel
> Tablet. So the WebView ↔ WebView pair is **unmeasured**, and nothing below is a result for it.
> What was measured is three pairs that each have a Mac at one end. §6 says what they predict for
> the true pair and why that is a prediction and not a finding. The pull request that lands this
> file says `Refs #532`, not a closing keyword, and **no amendment is appended to ADR 0033**: its
> D-1 table asks for #532's result, and a partial result is not one.

---

## 1. The answer, for the pairs measured

| Pair | Data channel opens? | How it connected | 10 min at 5 frames/s |
|---|---|---|---|
| **1. Chrome ↔ Chrome, both on the Mac** | **Yes**, 7–9 ms after the remote description | Both ends offered only an mDNS `.local` candidate, and each resolved the other's | 3000 of 3000 frames, none reordered, echo RTT p50 **1.0 ms**. The path was the Mac's **loopback**, so this says nothing about Wi-Fi |
| **2. Chrome on the tablet ↔ Chrome on the Mac**, over Wi-Fi | **Yes**, 60–77 ms | The tablet offered its **raw IPv4 address, not an mDNS name**. The Mac offered an mDNS name, which **the tablet could not resolve**. The Mac dialled the tablet, and the tablet learned the Mac as a peer-reflexive candidate | 2999 of 3000 frames, **1 lost**, none reordered, echo RTT p50 **41 ms**, p99 94 ms |
| **3. The On Your Left app's WebView on the tablet ↔ Chrome on the Mac**, over Wi-Fi | **Yes**, 64–93 ms | **Exactly as pair 2**: raw IPv4 from the WebView, an mDNS name from the Mac that the WebView could not resolve, a peer-reflexive path | 3000 of 3000 frames, none lost or reordered, echo RTT p50 **47 ms**, p99 119 ms |

**The one finding that matters most for #532**: on this tablet, **neither Chrome nor the Android
System WebView can resolve a Chrome mDNS candidate name.** Both log
`Failed to resolve address for <uuid>.local., errorcode: -105` (§4.4). Pairs 2 and 3 connected
**only because the Android end did not hide its own address**, so the Mac could dial it. A
controlled run that withheld the Android end's candidate, so that only the Android end could dial,
**stayed at ICE `new` for 30 seconds and never opened**, in both Chrome and the WebView. The same
run between two Mac Chromes opened in 6 ms.

**What that points to** (§6): for the pairs measured, **works with a named condition**. The
condition is that **at least one end publishes a raw private address**, because an Android end
cannot resolve an mDNS name. For WebView ↔ WebView, both ends were seen publishing raw addresses,
so the condition would hold. But that is **one Android device and one WebView build**, and the pair
was not run.

---

## 2. Devices, versions and network

| | |
|---|---|
| **Tablet** | Google **Pixel Tablet** (`tangorpro`), serial 3822105H80BY3Z, **Android 17** (API 37), build `CP2A.260705.006`, on Wi-Fi at `192.168.68.69/22`, IPv6 link-local only |
| **Chrome on the tablet** | `com.android.chrome` **153.0.8010.52** |
| **Android System WebView** | `com.google.android.webview` **153.0.8010.36**. UA `…; wv) … Chrome/153.0.8010.36` |
| **The app** | `dev.openzigs.onyourleft` versionName 1.0, a **debug** build (`DEBUGGABLE`), serving the client at `https://localhost/`. Not reinstalled, not restarted and not navigated (§3.3) |
| **Mac** | macOS **26.6.2** (25G83), Wi-Fi `en0` at `192.168.68.65/22`. **Google Chrome 154.0.8037.57**, run as separate headless instances, each with its own throwaway profile. That is two profiles, not two tabs, for pair 1 |
| **Router** | Gateway `192.168.68.1`, MAC OUI `3c:52:a1` (TP-Link). A `192.168.68.0/22` LAN is TP-Link Deco's default. **The model was not read.** One SSID, both devices on it, and **no client isolation**, since pairs 2 and 3 worked. No global IPv6 on this LAN |
| **mDNS across the Wi-Fi** | Multicast does cross it: the tablet's own OS resolver answered `ping MacBook-Pro.local` with `192.168.68.65`, and the router answers that name `NXDOMAIN` by unicast DNS, so it came from mDNS. See §4.4 for why this does not help WebRTC |

---

## 3. Method

### 3.1 The probe

A throwaway page and script, served from the Mac by a 20-line Node HTTP server on
`0.0.0.0:8532`. **None of it is committed.** Everything in the ICE and channel set-up is ADR 0033's
design, not a convenience:

- `new RTCPeerConnection({ iceServers: [] })`. No STUN, no TURN (D-1).
- Two channels on one connection, created by the **tablet's role** (the offerer), as D-3 has it:
  - `control`: `{ ordered: true }`, reliable
  - `frames`: `{ ordered: false, maxRetransmits: 0 }`, unordered with no retransmission
- **No trickle ICE.** Each side waits for `iceGatheringState === 'complete'` before its SDP is taken,
  as D-1's single QR code requires.
- **Signalling.** The driver read the offer SDP out of one page and wrote it into the other, then
  did the same with the answer, over the Chrome DevTools Protocol. That is the stand-in for the two
  QR codes. It carries the same bytes a QR code would, all at once and out of band, and no
  signalling server exists.
- **The stream.** The **phone's role** (the answerer, always a Mac Chrome here) sent one binary
  message every 200 ms, **5 per second**. Each was **15,000–25,000 bytes**, uniform random, with a
  16-byte header (kind, sequence number, sender's `performance.now()`), for **600 s**. The receiver
  counted frames, bytes, gaps, duplicates and reordering (a sequence number lower than the highest
  already seen). It echoed a 16-byte message back **on `frames`**, and the sender measured the round
  trip on its own clock. So no clock synchronisation between devices is assumed. Separately, a JSON
  ping went once a second on `control` and was answered on `control`.
- **Stats.** `getStats()` was read after the channels opened and again after the stream: every local
  and remote candidate, every candidate pair, and the selected pair. `pc.sctp.maxMessageSize` was
  also read.

### 3.2 How each page was loaded, and which path the peer traffic took

| Pair | Page load | Signalling | Peer path |
|---|---|---|---|
| 1 | `http://192.168.68.65:8532/` from the Mac's own address | CDP over loopback | **Loopback** (`lo0`), per `nettop` |
| 2 | `http://192.168.68.65:8532/` **over Wi-Fi** from `192.168.68.69`, per the server log. **No `adb reverse`** | CDP over `adb forward` (USB) to `chrome_devtools_remote` | **Wi-Fi**, tablet `192.168.68.69` ↔ Mac `192.168.68.65` |
| 3 | **No page load.** The probe script was evaluated into the app's own `https://localhost/` page (§3.3) | CDP over `adb forward` (USB) to `webview_devtools_remote_<pid>` | **Wi-Fi**, as pair 2 |

`adb reverse` was never used. The USB cable carried only DevTools traffic, never a peer packet. A
peer path over USB is not possible anyway: the only candidates offered were Wi-Fi and loopback
addresses.

### 3.3 Why the app's WebView was not navigated

The obvious way to reach a WebView is to navigate it to the probe page. **That was not done.**
Capacitor hands a navigation away from its own host to an external intent unless the host is on
`server.allowNavigation`, and changing that means changing the app. It was not needed either. The
app is a debug build, so its WebView exposes `webview_devtools_remote_<pid>` (the same socket
`apps/mobile/tools/webview-probe.mjs` uses). The probe's source was **evaluated into the running
`https://localhost/` page**, `window.__p` was deleted again at the end, and `location.href` was
read back as `https://localhost/` with `__p` `undefined`. So **pair 3 ran in the shell's real
origin, as a secure context, inside the shell's real WebView**, which is closer to #529's product
than a navigated page would have been. One difference remains, and it is inherent to a debug build:
a release build has no DevTools socket, and nothing here was measured on one.

### 3.4 Two controls, each run as its own short session

- **`strip`**: the offerer's candidate lines were **deleted** from the offer before the answerer saw
  it. The answerer then cannot dial, so a channel opens **only if the offerer can resolve the
  answerer's candidate and dial it.** With a Mac Chrome answerer, that tests exactly whether the
  offerer can resolve a Chrome mDNS name. This is the question #532 asks.
- **`camera`**: before creating the connection, each Mac Chrome ran `getUserMedia({video: true})`,
  with Chrome's fake device and fake permission prompt, on `http://localhost:8532/` (a secure
  context), and stopped the track at once. This tests ADR 0033 D-1's stated expectation that
  hiding stops once a page has camera access. **It was run on the Mac only**, because the Android
  end was already publishing a raw address without any camera access (§4.2). Running it there would
  have turned on the owner's tablet camera to answer a question the plain run had already answered.

---

## 4. Raw results

### 4.1 Connection set-up

| Run | Offer gather (ms) | Answer gather (ms) | Channels open after `setRemoteDescription` (offerer / answerer, ms) | ICE `checking` → `connected` at the offerer (ms) |
|---|---|---|---|---|
| Pair 1, 10 s | 138 | 5 | 8 / 9 | 2 |
| Pair 1, 600 s | 128 | 4 | 7 / 8 | 1 |
| Pair 1, `camera` | 127 | 2 | 8 / 9 | 1 |
| Pair 1, `strip` | 127 | 125 | 6 / 7 | 1 |
| Pair 2, 15 s | 146 | 50 | 66 / 77 | 34 |
| Pair 2, 600 s | 132 | 102 | 60 / 74 | 26 |
| Pair 2, `strip` | 132 | 120 | **never** (ICE stayed `new` for 30 s) | — |
| Pair 3, 15 s | 137 | 120 | 64 / 71 | 25 |
| Pair 3, 600 s | 146 | 138 | 70 / 93 | 28 |
| Pair 3, `strip` (run twice) | 148, 142 | 119, 128 | **never** (ICE stayed `new` for 30 s, both times) | — |

Gathering host candidates took **about 130–150 ms** on both platforms. D-1's *"host candidates
gather within milliseconds"* is true in spirit only: it is not the cost that matters, and a person
holding a phone to a QR code will not notice it.

### 4.2 Candidates, and whether they are mDNS names

The candidate lines from each SDP, as copied from the runs:

| End | SDP candidate |
|---|---|
| Mac Chrome (every plain run) | `… udp 2113937151 1d978fc7-….local 53649 typ host … network-cost 999`. **One IPv4 host candidate, an mDNS name** |
| Mac Chrome, after camera access | `… udp 2122260223 192.168.68.65 51491 typ host … network-id 1 network-cost 10` **and** `… tcp 1518280447 192.168.68.65 9 typ host tcptype active …`. **A raw address, and now a TCP candidate too** |
| Tablet Chrome 153 (every run) | `… udp 2113937151 192.168.68.69 56865 typ host … network-cost 999`. **A raw address, with no camera access** |
| Tablet WebView 153 (every run) | `… udp 2113937151 192.168.68.69 60170 typ host … network-cost 999`. **A raw address, with no camera access** |

How to read that:

- **Mac Chrome hides its address behind mDNS until the page has camera access, and then stops.**
  D-1's expectation is **confirmed on desktop Chrome 154**. Its own log explains the switch:
  `FilteringNetworkManager received permission status: denied` is followed by allocation on a
  single `Wildcard` network with a `.local` name. With the permission granted, the real `en0`
  network is enumerated (`network-id 1`, `networkType: wifi` in stats).
- **The Android end did not hide its address at all**, in Chrome or in the WebView. It had no camera
  permission and was on an insecure `http://` origin in pair 2. The priority (`2113937151`) and the
  `network-cost 999` with no `network-id` are the same as the Mac's wildcard, non-enumerating mode,
  but the address is real. **Why is not established.** The likeliest explanation is that this
  Chromium build on Android has no mDNS responder to register a name with, so it falls back to the
  address. That was not read in the source, so it is an explanation, not a finding.
- **IPv6.** No SDP carried an IPv6 candidate. The LAN has link-local IPv6 only, and no end offered a
  link-local address. `getStats()` on the Android end also listed
  `address: "::"` UDP and `0.0.0.0`/`::` TCP port 9 "host" entries that were **not in the SDP**.
  They were never used and look like the wildcard sockets' own bookkeeping. #529's D-4 decoder only
  ever sees the SDP, so they do not reach it.

### 4.3 The 10-minute streams

`frames` channel, `{ordered: false, maxRetransmits: 0}`, 5 messages per second of 15–25 KB, 600 s.
The receiver is the offerer (the tablet's role).

| | Pair 1 (Mac ↔ Mac, loopback) | Pair 2 (tablet Chrome ↔ Mac) | Pair 3 (tablet WebView ↔ Mac) |
|---|---|---|---|
| Frames sent / received | 3000 / 3000 | 3000 / **2999** | 3000 / 3000 |
| Lost | 0 | **1** (and its echo) | 0 |
| Reordered | 0 | 0 | 0 |
| Duplicated | 0 | 0 | 0 |
| Gaps over 1 s at the receiver | 0 | 0 | 0 |
| Payload received | 60.14 MB | 60.21 MB | 60.02 MB |
| Goodput at the receiver | 802 kbit/s | 803 kbit/s | 801 kbit/s |
| Frame rate at the receiver | 5.00/s | 5.00/s | 5.00/s |
| Sender's peak `bufferedAmount` | 0 | 0 | 0 |
| Echo RTT on `frames`: min / p50 / p90 / p99 / max (ms) | 0.6 / 1.0 / 1.4 / 1.7 / 2.9 | 21.4 / **41.3** / 49.8 / 94.0 / 198.1 | 23.6 / **47.4** / 55.7 / 118.6 / 161.0 |
| Ping RTT on `control`, reliable and ordered: n / p50 / p99 / max (ms) | 600 / 0.9 / 1.6 / 1.8 | 600 / 32.2 / 68.6 / 144.4 | 600 / 37.9 / 87.1 / 159.4 |
| ICE's own RTT, last reading (ms) | ~0 | 12 | 12 |
| Connectivity checks, sent / answered | 230 / 230 | 230 / 230 | 230 / 230 |
| State at the end | connected | connected | connected |

Notes on those numbers:

- **The load is trivial for this LAN.** About 0.8 Mbit/s never put a byte into `bufferedAmount`, so
  what #527 asks for (5 frames/s at about 256 px) is far inside what this Wi-Fi carries. This is
  **one quiet evening on one router**. It says nothing about a congested network, a 2.4 GHz band or
  a phone at the far end of a room.
- **The application-level RTT (~40 ms) is about three times ICE's own (~12 ms)**, and an ICMP ping
  from the tablet to the Mac took 8 ms. The difference is on the tablet: its JavaScript event loop
  and Wi-Fi power saving. **Not investigated.** It does not matter for frames that are analysed and
  discarded, and it matters only a little for a `start`/`stop` command.
- **The one lost frame in pair 2 is what `maxRetransmits: 0` is for.** A frame dropped on the air
  stayed dropped, and nothing queued behind it. 1 in 3000 over 10 minutes is the only loss seen.
- **`sctp.maxMessageSize` was 262144 bytes on every end**, Android included. A 25 KB frame fits in
  one message with a wide margin. D-3's *"#530 checks the size rather than assuming it"* still
  stands, because this is one pair of builds.

### 4.4 Why the Android end cannot use an mDNS candidate

In both `strip` runs the Android end had the Mac's `.local` candidate and nothing else, and it never
produced a candidate pair. `getStats()` listed **no remote candidate at all**. `adb logcat` on the
tablet during those runs:

```text
E chromium: [ERROR:services/network/p2p/socket_manager.cc:145] Failed to resolve address for c40803e4-16ed-41c7-8094-405a553e03ff.local., errorcode: -105
W chromium: [WARNING:third_party/webrtc/p2p/base/p2p_transport_channel.cc:1283] Failed to resolve ICE candidate hostname c40803e4-16ed-41c7-8094-405a553e03ff.local with error -1
```

That is Chrome (its network service logged the first line, its renderer the second). The WebView run logged **the same two lines**, the first from **the app's own process** (pid 8170, `dev.openzigs.onyourleft`, where the WebView runs its network service) and the second from its renderer, for that run's own `<uuid>.local`.
`-105` is `ERR_NAME_NOT_RESOLVED`.

In pairs 2 and 3 the same failure happened silently. The Android end's only remote candidate was
`prflx` for the whole 10 minutes, so it never resolved the Mac's name. It learned the Mac's address
from the Mac's own connectivity check.

Three more observations narrow it down. None of them is an explanation:

- **Multicast DNS does cross this Wi-Fi.** `ping MacBook-Pro.local` from the tablet resolved to
  `192.168.68.65`, and the router's unicast DNS answers that name `NXDOMAIN`.
- **But the tablet's OS resolver could not resolve a live Chrome candidate name either.**
  `ping 9fed2d4c-3136-416d-bace-83ccefdf92ac.local` from the tablet gave `unknown host`, while the
  Mac Chrome that owned that name was still holding it open. The Mac's own resolver
  (`dscacheutil`) answered `192.168.68.65` for the same name at the same moment.
- So the failure may be in Android's resolver, in how Mac Chrome's responder answers a query from
  another host, or both. **Resolving that needs a packet capture of port 5353 on this Wi-Fi, which
  was not possible here** (§5).

---

## 5. Did anything leave the LAN

**The peer path: no, on every piece of evidence available. But one piece a reader would expect is
missing: there is no packet capture.** `tcpdump` needs `/dev/bpf*`, which is root-only on this Mac,
and `sudo` needs a password nobody in the loop had. The tablet is not rooted. What there is instead:

1. **Configuration.** `iceServers: []`. With no server configured, an ICE agent has nowhere to send
   a STUN or TURN request except a peer's candidate.
2. **Every candidate and every candidate pair, from both ends** (`getStats()`, before and after each
   stream). Local candidates were `host` only: no `srflx`, no `relay`. Remote candidates were
   `host` or `prflx`. In pairs 2 and 3 there was **exactly one candidate pair, tablet
   `192.168.68.69` ↔ Mac**, with 230 checks sent and 230 answered. Nothing else was ever probed.
3. **The Mac's own WebRTC log**, taken with
   `--vmodule=*/p2p/*=1,*connection.cc=1,*port.cc=1,*basic_port_allocator*=1` for pair 3's 600 s
   run. It shows `AllocationSequence: Relay ports disabled, skipping` and **3664 connection
   log lines, every one naming a single remote, `host:udp:192.168.68.x:60170`**, which is the
   tablet's candidate. (Chrome redacts the last octet in its own log.)
4. **`nettop`**, sampling UDP flows every 30 s through pair 3's 600 s run. The Mac Chrome's ICE
   socket, `*:58958` on `en0` (the port in its SDP), moved **62.56 MB out and 1.60 MB in**, which
   matches 60.02 MB of frames plus headers, DTLS and SCTP overhead, and the echoes. Being
   unconnected, that socket shows no remote address in `nettop`, which is why item 3 is the
   evidence for its destinations.

⚠️ **The same `nettop` sampling also shows the headless Mac Chrome itself making QUIC connections to
Google on port 443** (`142.250.x`, `142.251.x`), a few kilobytes each, even with
`--disable-background-networking` and component updates off. **Those are the browser's own
background traffic and not the peer path.** They are connected sockets to port 443 from other
source ports, and a real rider's browser makes them too. But this is exactly the kind of thing a
reader should not have to take on trust. **A capture on the router, or `tcpdump` with root on either
end, is still owed** to make #532's third criterion airtight.

---

## 6. What this points to, and what it does not

ADR 0033 D-1's table has three outcomes: **works**, **works with a named condition**, and **does not
work**.

**For the three pairs measured, the evidence points to *works with a named condition*.** The
condition:

> **At least one of the two ends must publish a raw private address**, because the Android end
> cannot resolve a Chrome mDNS candidate name (§4.4). The router must also pass unicast traffic
> between two Wi-Fi clients, which this one does. A router with client isolation was not tested.

**What that predicts for the unmeasured pairs:**

| Pair | Prediction | How firm |
|---|---|---|
| **WebView (tablet) ↔ WebView (phone)**, the pair #532 is about | **Should connect.** The tablet's WebView published its raw address with no camera access. If the phone's WebView does the same, as the same WebView build did here, both ends can dial and nothing needs resolving. D-1's design gives the phone camera access anyway, which removes hiding on desktop Chrome | **Unmeasured.** One Android device, one WebView build (153.0.8010.36), Android 17. A phone on another Android version or WebView channel might hide its address, and then this pair meets §4.4 head-on: **two ends that each publish a name the other cannot resolve connect over nothing** |
| Android shell (tablet) ↔ desktop Chrome as the phone | Measured as pair 3, with roles as D-1 has them. Works | Measured |
| Desktop Chrome ↔ desktop Chrome on **two different machines** | Pair 1 ran on **one** machine, over loopback, so it is not evidence for this. D-1's phone always has camera access, which un-hides its address on desktop Chrome (§4.2). If either end has that, one end dials | **Unmeasured** |
| Anything with Safari or iOS | Not touched. There is no iOS client (ADR 0018) | **Unmeasured** |

**Consequences for #529, noted and not decided here:**

- **D-4's candidate filter has to accept a raw private IPv4 host candidate**, because that is what
  both Android ends offer. It already does. Its `.local` acceptance is still needed for a desktop
  end, and a `.local` candidate from the far end cannot be used by an Android end (§4.4). The
  pairing screen's *"no usable candidate"* sentence therefore needs a second case: **both ends offered
  only names**.
- **Once a page has camera access, desktop Chrome also offers a TCP host candidate** (`tcptype
  active`, port 9). D-4 says *"host candidates"* without naming a protocol, so #529 should decide
  whether the encoder omits TCP ones or accepts them.
- **The TCP candidate and the IPv6 behaviour were seen once each.** A dual-stack LAN with a global
  IPv6 prefix was not available.

**Why this is not recorded in ADR 0033 yet.** D-1 says #532's result is appended as an amendment.
This is not #532's result. It is three pairs that are not the pair #532 names, plus a prediction.
The amendment belongs to whoever runs §7.

---

## 7. What remains, for whoever has a second Android device

1. **The true pair**: the shell on the tablet ↔ the shell on an Android **phone**, same method
   (§3.1), 10 minutes at 5/s. Use each device's DevTools socket and evaluate into `https://localhost/`
   rather than navigating (§3.3). Record the phone's Android version and **WebView version**. The
   first thing to read is **whether the phone's SDP carries a raw address or a `.local` name**.
2. **The same pair with each end's candidate withheld in turn** (`strip`, §3.4). If either direction
   fails and the other connects, the pairing works only in one direction, and that is a named
   condition in its own right.
3. **A packet capture** on the router or with root on the Mac, filtered for anything not in
   `192.168.68.0/22` and for UDP 3478/19302. It should also capture port 5353, to settle §4.4's
   open question about which side's mDNS fails.
4. **A router with client isolation on** (most have a guest-network switch). It is expected to fail,
   and the failure is the wording the pairing screen owes the rider.
5. **A release build.** Everything here ran in a debug build because that is what exposes DevTools.
   WebRTC does not depend on that flag, but this was not shown.

---

## 8. Reproducing it

The probe was about 250 lines across four files in a temporary directory: a static server, a page
script, a DevTools driver and a summariser. **It is committed nowhere**, per #532's own component
note. The parts that matter are all in §3: the `RTCPeerConnection` and channel options, the message
shape, the order of operations, how each target was reached, and the two controls. Anyone
re-running it needs:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$PATH:$ANDROID_HOME/platform-tools"
adb forward tcp:9401 localabstract:chrome_devtools_remote            # Chrome on the device
adb forward tcp:9402 localabstract:webview_devtools_remote_"$(adb shell pidof dev.openzigs.onyourleft)"
adb logcat -c && adb logcat | grep -E 'Failed to resolve|\.local'     # §4.4
# … run, then:
adb forward --remove-all
```

Android Chrome refuses `PUT /json/new` (*"Could not create new page"*), so a tab is opened with
`Target.createTarget` on the browser's own WebSocket instead, and closed afterwards by its target id.
A WebView is only reachable while its app is in the foreground. Before the app was brought forward,
its DevTools endpoint accepted the connection and then never answered.

**Left as found on the tablet**: both `adb forward` rules removed, no `adb reverse` rule ever set,
the two probe tabs opened in Chrome closed by target id and no other tab touched,
`stay_on_while_plugged_in` put back to `0` after being set to `7` for the runs, Chrome brought back
to the foreground as it was at the start, and the app neither reinstalled nor restarted, its page
still at `https://localhost/`.
