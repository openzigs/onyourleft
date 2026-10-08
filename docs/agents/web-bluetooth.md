# Web Bluetooth's limits

An agent-instruction topic file. The root [`CLAUDE.md`](../../CLAUDE.md) holds the always-on rules and the map;
this file holds the two §8 paragraphs on what Web Bluetooth cannot do, moved out of the root verbatim on 2026-10-07 (#1170) so that it is loaded
only when it is needed. **Read it when you design pairing or reconnection, await a GATT promise, detect Bluetooth support, or plan how many sensors a rider connects.**

Same authority as the root. In the text below, "this file" and "CLAUDE.md" mean the root, the
area `CLAUDE.md` files and `docs/agents/` together, and a bare section number such as "§7" is
found through the root's topic map.

---


## 8. Known gotchas — Web Bluetooth

**Web Bluetooth constraints are product constraints, not bugs.** No Safari (desktop or iOS), no
Firefox, anywhere, ever — `caniuse` `usage_perc_y` was **76.46% when read on 2026-09-02** (a
browser-share figure that drifts monthly; re-read it rather than quoting this), so roughly a quarter
of visitors cannot use the core feature. `requestDevice()` needs a **user gesture per device** and cannot be called
programmatically; there is **no silent reconnect that is shippable in 2026** — `getDevices()`,
`watchAdvertisements()` and Persistent Device Permissions all exist behind `chrome://flags`, with
`watchAdvertisements` absent on ChromeOS and Linux entirely, so the product conclusion is unchanged:
do not build automatic reconnection; it is unavailable in Web Workers; and there is no
background operation. **Plan for ~3 concurrent connections**, not 7. Do not design a UI that hides
any of this.

**And `'bluetooth' in navigator` is not the feature detect.** Chrome on Linux exposes the object and
WebBluetoothCG's own status file says *"Linux is partially implemented and not supported"*. #40's
`readAvailability` requires both `requestDevice` and `getAvailability` to be callable and treats a
`getAvailability` that throws as `unsupported`. **Web Bluetooth also specifies no timeout for any
operation, and `gattserverdisconnected` fires only for a link that was up** — so a device switched
off during `gatt.connect()` produces no event and no rejection. #40's queue bounds every operation
for that reason; anything else awaiting a GATT promise must too.
