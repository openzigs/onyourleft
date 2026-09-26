# Letting a computer of your own look at your pictures

**Written 2026-09-23, for [#387](https://github.com/openzigs/onyourleft/issues/387).** This is for a
rider who wants the app to send a picture from its camera to a computer they own, so that a vision
model running there can look at it. It is **optional**, it is **off** until you set it up, and the
app works in full without it.

> ⚠️ **What this build does with the answer, today: almost nothing.** The one thing on the Camera
> page is a connection check — the app sends one picture, asks the model to reply with the word
> *ready*, and tells you whether it did. What the model says is **not shown**. The report that
> uses a model's answers is [#388](https://github.com/openzigs/onyourleft/issues/388), and what
> it may say about your body is decided by
> [ADR 0030](adr/0030-what-the-app-may-say-about-a-body.md) before it is written.

## What you are setting up, and whose it is

**The computer is yours.** On Your Left runs no server, and this is not one: not an account, not a
service of ours, and not the sync server this project may one day run
([#7](https://github.com/openzigs/onyourleft/issues/7)), which does not exist. We never see the
picture. The app sends it straight from your phone or browser to the address you type.

**We do not ship or maintain the software on that computer.** You install a model server yourself.
Two that are open source (both MIT) and speak the request format this app uses — the
OpenAI-compatible chat format, with a picture attached — are:

- **`llama.cpp`**'s `llama-server`
- **Ollama**

The app names neither of them anywhere in its code, and has no list of servers or models to choose
from ([ADR 0031](adr/0031-model-licences-and-the-hosted-model-hole.md) D-4). You type the address
and the model name.

## ⚠️ A downloaded model file is untrusted input — to your computer, not to the app

A model is a large file you download from somebody else and hand to a parser on your computer. That
parser is where the risk is, and **it lands on you rather than on this app**, which never sees the
file:

- On **2026-05-15** an advisory published six vulnerabilities in `llama.cpp`'s GGUF file parser
  (V-01 to V-06, one of them rated critical), with no CVE numbers assigned and no fix recorded in
  the advisory itself: *"Security Advisory: Multiple Vulnerabilities in llama.cpp GGUF Format
  Parsers"*, [oss-sec 2026 Q2/546](https://seclists.org/oss-sec/2026/q2/546), read 2026-09-23.
  Other GGUF readers — Ollama loads the same format — should be assumed to be in the same position
  until their own projects say otherwise.
- **This project has not handled that for you and cannot.** Download models only from a publisher
  you trust, keep your model server up to date, and do not run it as an administrator.

**And choose a model whose licence is open.** Several vision models good enough for this are
Apache-2.0 or MIT and run at 4-bit on a machine with 16–24 GB of memory. ADR 0031 D-2 lists the
ones this project checked, with the date it checked them. It also records why a model under a
licence that is not open source (Kimi K3 is the worked example) is never one this app suggests.

## Setting it up

1. **Run a model server on your computer, listening on your network** — not only on the computer
   itself. For example (check your version's own `--help`; flags change):

   - `llama.cpp`: `llama-server -m <model>.gguf --mmproj <projector>.gguf --host 0.0.0.0 --port 8080`
     — a vision model needs its projector file as well as the model.
   - Ollama: set `OLLAMA_HOST=0.0.0.0` so it listens beyond the computer itself, and pull a vision
     model. ⚠️ Ollama only answers a web page from an origin it has been told about: in a browser,
     add the address in the browser's own address bar to `OLLAMA_ORIGINS`. The Android app sends
     its request from the app itself rather than from a web page (see below), so it needs no
     origin added.

   Listening on `0.0.0.0` means **anything on your network** can use that server. On a home network
   that is usually your own devices; on a shared one it is everybody's.

2. **Find the computer's address on your network** — something like `192.168.1.20`, or, in a
   browser only, a name ending in `.local`. **In the Android app use the numbers**: a name is
   refused there (see below).

3. **In the app, open the Camera page**, agree to the camera, and under **Your own computer** enter
   the address with its port (for example `http://192.168.1.20:8080`) and the model's name exactly
   as your server knows it. Tick **Send pictures to this computer when I ask**, and press **Save
   this computer**.

4. **Turn the camera on and press "Send one picture to check the connection."** The app tells you
   whether your computer answered and understood.

### What the app will and will not accept as an address

Only an address that is **on your own network by its spelling**: a private address (`10.…`,
`172.16.…`–`172.31.…`, `192.168.…`), a link-local one (`169.254.…`), `localhost`, the
`100.64.…`–`100.127.…` range an encrypted WireGuard-based network (such as Tailscale or NetBird)
gives its devices, a private IPv6 address, or a name ending in `.local`, `.home.arpa` or
`.internal`.

⚠️ **The Android app accepts less: a private address written as numbers, and nothing else.** No
`.local`, `.home.arpa` or `.internal` name, no `localhost` and no `127.…`. In the Android app the
picture is sent by the app itself, outside its web view (the web view refuses a plain `http://`
request from a secure page), and a name would then be looked up by whatever the phone's network
says, which could point anywhere. A number is where it says it is. A name is refused before
anything is sent, and the app tells you so when you check the connection.

**It refuses everything else**, including a plain name like `my-pc` and any address on the
internet. That is deliberate: the promise this feature is built on is *"no network except a local
endpoint you configured and switched on"*, and a service on the internet is not local. There is no
way in this app to send a picture to a hosted AI service.

## What leaves your device, exactly

One still picture, and a fixed sentence asking the model to reply *ready*. Nothing else — no ride,
no position, no heart rate, no name and no identifier. The picture is re-encoded from its pixels
when it is taken, so it carries no location or device metadata. It is sent only when you press the
button, and on your phone it is thrown away afterwards unless you turned on "keep the pictures from
this ride". On your computer, what happens to it is up to the software you installed.

**Anyone else in the room is in the picture.** The Camera page says so before the camera is ever
turned on.

## The side camera's pictures, if you switch that on

Once a computer is saved and switched on, the Camera page offers a second switch, **Send the side
camera's pictures to this computer**, off to begin with. Beside it the app says what it does:

> While the side camera is filming, every picture it takes — about five a second — goes to your
> computer, instead of being looked at on this tablet. What your computer does with them is up to
> your computer.

It takes effect the next time you pair a side camera. Each picture goes to the same address, over
the same path, one at a time; a picture that arrives while your computer is still busy with the
last is thrown away unsent. Switching either switch off, or forgetting the computer, stops the next
picture being sent, and the rest of that session's pictures are not looked at.

**What your computer is asked, and what it must answer.** Each picture goes with a fixed sentence
asking for the rider's near side, as JSON and nothing else:

```json
{"rider":true,"nearSide":"left","landmarks":{"ear":[0.41,0.18],"shoulder":[0.45,0.30],
 "elbow":[0.55,0.38],"wrist":[0.63,0.40],"hip":[0.40,0.52],"knee":[0.52,0.62],
 "ankle":[0.49,0.84],"heel":[0.46,0.86],"toe":[0.53,0.87]}}
```

`x` then `y`, each a share of the picture from its top-left corner between 0 and 1; `null` for a
point that cannot be seen; `nearSide` is the rider's own left or right; and `{"rider":false}` when
nobody is riding. The answer is the model server's usual chat reply, with this as its message. The
app **refuses** anything else — prose, an extra key, a missing landmark, a number outside the
picture — and counts that picture as unreadable; a fenced ```` ```json ```` block around the object
is the one wrapping it accepts. It may also be a program of your own that answers this directly
instead of a model.

⚠️ **Whether a general vision model answers this well has not been measured.** Asking a model for
coordinates is not the same as running a pose model, and the tablet's own pose model is the one
this app was measured with. That is why this switch is off by default.

If your computer cannot be reached, refuses, or is not a model server, the tablet stops sending
for the rest of that session and says so on the side-camera screen. It does the same when two
pictures in a row go thirty seconds without an answer. One slow picture is allowed, because the
first answer also waits for the model to load. In the Android app a picture given up on this way
has still been sent: the app stops waiting for the answer, but it cannot stop the upload.

## How it travels, and what that means

- **On your own network, it is not encrypted unless the address starts with `https://`.** A model
  server on a home computer usually has no certificate, so the picture crosses your network as
  plain data. Anyone able to watch your home network could see it.
- **Away from home**, the way this project permits is a WireGuard-class encrypted network between
  your devices (Tailscale, NetBird, or WireGuard itself): its relays carry data they cannot read.
- ⚠️ **Not Cloudflare Tunnel.** Cloudflare's tunnel decrypts traffic at Cloudflare's own servers —
  that is how it works, not a mistake in setting it up — so a photograph of you in your home would
  exist unencrypted on somebody else's infrastructure every time. The app refuses such an address
  anyway, because it is a name on the internet. [ADR 0029](adr/0029-camera-imagery-as-a-data-class.md)
  D-6 is the decision.

## When it does not connect

| The app says | Usually |
|---|---|
| *could not be reached* | the computer is off or asleep; the address or port is wrong; the phone is on a different network (a guest network, or mobile data); the server is listening only on the computer itself; or Ollama was not told the app's origin |
| *refused the request* | the server is asking for a key. This app sends none |
| *not a model server this app can talk to* | the port belongs to something else |
| *reported an error* | the model name is wrong, or the model cannot read pictures |
| *has not answered yet* | the first request after starting a server loads the model, which can take a minute. If it answers, the message changes by itself |

⚠️ **Browsers ask first.** Chrome and other Chromium browsers ask for permission before a page may
reach a device on your local network, and may block a plain `http://` address from a secure page
until you allow it. Allow it for this app if you want this to work.

⚠️ **Inside the Android app, the web view refuses this, so the app goes round it.** Measured on
2026-09-25 (validation 0002 Part AF): the app's web page is a secure one, and the phone's web view
blocked its plain `http://` request to a computer on the network before it left the tablet. Since
[#553](https://github.com/openzigs/onyourleft/issues/553) the Android app sends the request itself
instead, outside the web view, and only to a private address written as numbers. ⚠️ **That route
has not yet been re-measured on the tablet**; Part AF says what to run.

## Turning it off

Untick **Send pictures to this computer when I ask** and save, untick **Send the side camera's
pictures to this computer**, or press **Forget this computer**. Switching the computer off and
forgetting it both also switch off the side camera's switch, so switching the computer back on
later does not start sending the side camera's pictures again until you tick that switch again. Nothing is sent afterwards. Erasing this device does not reach a copy of a picture your computer
already has — the app says so before you erase.
