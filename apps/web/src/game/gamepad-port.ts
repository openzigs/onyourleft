// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What Delivery reads of a gamepad, through the W3C Gamepad API — #1821,
 * resting on the owner's ruling DL12 of 2026-10-27 and DL7 as revised on
 * 2026-10-28 (epic #1803): a Bluetooth or USB gamepad pairs with the
 * operating system as an ordinary input device, and the app needs no
 * protocol code and none of the rider's BLE connections.
 *
 * ## A port, so a test passes a double
 *
 * jsdom has no `navigator.getGamepads()`, and no test here can hold a real
 * pad. So `delivery/gamepad-input.ts` decides every intent from
 * {@link PadSnapshot}s, and `hud/GamepadIntents.tsx` polls through
 * {@link GamepadPort}; {@link navigatorGamepads} is the one place that names
 * the platform.
 *
 * ⚠️ **A `*-port.ts` on purpose**: `check:wiring` then requires both of its
 * methods to have a production caller (§4j, `WIRE003`). `GamepadIntents`
 * calls both.
 *
 * ## Polled, and silent until a press
 *
 * The API has no event per press: a page reads `getGamepads()` once per
 * animation frame. A pad is not listed at all until one of its buttons has
 * been pressed while the page could see it, and `gamepadconnected` fires
 * then; `gamepaddisconnected` fires when it goes. {@link GamepadPort.onConnectionChange}
 * carries both, so the HUD polls only while a pad is there.
 *
 * ⚠️ **Whether the Android shell's WebView delivers gamepads at all is
 * unmeasured**: that is spike 0027 (#1819), on the owner's tablet. This
 * works in a desktop browser, which is all that is tested here.
 *
 * ## Untrusted input
 *
 * A pad is a device that may not be what it claims (CLAUDE.md §6): its axes
 * may be NaN or outside −1..1, and it may report any number of buttons. This
 * file only copies the reading; `gamepad-input.ts` bounds it. A browser that
 * refuses the API (a permissions policy without `gamepad`) throws from
 * `getGamepads()`, and that reads here as no pads.
 */

/** One pad as one poll read it: the parts of `Gamepad` Delivery reads, and nothing else. */
export interface PadSnapshot {
  readonly connected: boolean;
  /** `'standard'` when the browser maps the pad to the W3C layout; anything else is a layout nobody here knows. */
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export interface GamepadPort {
  /** Every pad, as `navigator.getGamepads()` lists them: one slot per index, `null` where there is none. */
  pads(): readonly (PadSnapshot | null)[];
  /** Calls `listener` when a pad connects or disconnects. Returns what stops it. */
  onConnectionChange(listener: () => void): () => void;
}

/** What {@link navigatorGamepads} needs of the page: `window`, in production. */
export interface GamepadHost {
  readonly navigator: {
    readonly getGamepads?: (() => readonly (PadSnapshot | null)[]) | undefined;
  };
  addEventListener(type: 'gamepadconnected' | 'gamepaddisconnected', listener: () => void): void;
  removeEventListener(type: 'gamepadconnected' | 'gamepaddisconnected', listener: () => void): void;
}

/** The platform's pads, through `host` — `window` in production. */
export function navigatorGamepads(host: GamepadHost): GamepadPort {
  return {
    pads: () => {
      const read = host.navigator.getGamepads;
      if (typeof read !== 'function') return [];
      try {
        return read.call(host.navigator);
      } catch {
        // A permissions policy that refuses `gamepad` throws a SecurityError: no pads.
        return [];
      }
    },
    onConnectionChange: (listener) => {
      host.addEventListener('gamepadconnected', listener);
      host.addEventListener('gamepaddisconnected', listener);
      return () => {
        host.removeEventListener('gamepadconnected', listener);
        host.removeEventListener('gamepaddisconnected', listener);
      };
    },
  };
}
