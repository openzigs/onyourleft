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
 * Spike 0027 (#1819) measured the Android shell's WebView on the owner's
 * tablet: it lists a standard pad with every button, and a generic pad with
 * its axes but none of its buttons.
 *
 * ## The shell's numbered buttons (#1858)
 *
 * Android raises a generic pad's buttons as KEYCODE_BUTTON_1 to 16, and the
 * WebView drops them. So `MainActivity.java` forwards each press and release
 * of one, from a joystick or a gamepad, by calling
 * {@link FORWARDED_BUTTON_GLOBAL} on the page with the button's number and
 * whether it is down. With `shell` set, the port installs that function while
 * a listener is subscribed, and {@link GamepadPort.pads} lists the buttons
 * first, in slot 0, as one pad of their own: `mapping` is
 * {@link FORWARDED_MAPPING}, and button `n` is at index `n − 1`, as a
 * browser lists a generic pad's. The slot is `null` while no button is down,
 * so the HUD stops polling, and each press or release calls the listener,
 * which wakes it. Without `shell` — every browser — the list is the
 * platform's, and nothing is installed.
 *
 * ⚠️ **A press and its release between two polls still counts**: a press is
 * held for the next read as well as while it is down, so a tap shorter than
 * a frame is one throw, not none.
 *
 * ## Untrusted input
 *
 * A pad is a device that may not be what it claims (CLAUDE.md §6): its axes
 * may be NaN or outside −1..1, and it may report any number of buttons. This
 * file only copies the reading; `gamepad-input.ts` bounds it. A browser that
 * refuses the API (a permissions policy without `gamepad`) throws from
 * `getGamepads()`, and that reads here as no pads. A forwarded button is
 * bounded on both sides: `MainActivity` sends only 1 to 16, and here
 * anything but an integer from 1 to 16 and a literal `true` or `false` is
 * dropped.
 */

/**
 * The name of the function `MainActivity.java` calls on the page's `window`
 * for each numbered button. `apps/mobile/src/android/gamepad-button-source.test.ts`
 * holds the Java to this name.
 *
 * @test-facing its caller is `MainActivity.java`, which no TypeScript can name; the shell's source test and this module's tests read it to hold the Java and the page to one name.
 */
export const FORWARDED_BUTTON_GLOBAL = '__oylGamepadButton';

/** The `mapping` of the pad the shell's forwarded buttons are listed as. Not a W3C value: no browser reports it. */
export const FORWARDED_MAPPING = 'oyl-android-numbered';

/** How many numbered buttons Android has: KEYCODE_BUTTON_1 to KEYCODE_BUTTON_16. */
export const FORWARDED_BUTTONS = 16;

/** What `MainActivity` calls: a button number and whether it is down, both untrusted. */
type ForwardButton = (button: unknown, pressed: unknown) => void;

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
  /** Installed by a shell port while it has a listener; see the module header. */
  [FORWARDED_BUTTON_GLOBAL]?: ForwardButton | undefined;
}

/** A button number `MainActivity` may send: an integer from 1 to {@link FORWARDED_BUTTONS}. */
function isButtonNumber(button: unknown): button is number {
  return (
    Number.isInteger(button) && (button as number) >= 1 && (button as number) <= FORWARDED_BUTTONS
  );
}

/**
 * The platform's pads, through `host` — `window` in production — and, when
 * `shell` is set (`support/capacitor.ts` §`isNativeShell`), the numbered
 * buttons the Android shell forwards, in slot 0.
 */
export function navigatorGamepads(host: GamepadHost, shell = false): GamepadPort {
  const down = new Set<number>();
  /** Pressed since the last read: read as down once more, so a tap between polls counts. */
  const pressedSinceRead = new Set<number>();
  const platform = (): readonly (PadSnapshot | null)[] => {
    const read = host.navigator.getGamepads;
    if (typeof read !== 'function') return [];
    try {
      return read.call(host.navigator);
    } catch {
      // A permissions policy that refuses `gamepad` throws a SecurityError: no pads.
      return [];
    }
  };
  const forwarded = (): PadSnapshot | null => {
    if (down.size === 0 && pressedSinceRead.size === 0) return null;
    const buttons = Array.from({ length: FORWARDED_BUTTONS }, (_, index) => ({
      pressed: down.has(index + 1) || pressedSinceRead.has(index + 1),
    }));
    pressedSinceRead.clear();
    return { connected: true, mapping: FORWARDED_MAPPING, axes: [], buttons };
  };
  return {
    pads: () => (shell ? [forwarded(), ...platform()] : platform()),
    onConnectionChange: (listener) => {
      host.addEventListener('gamepadconnected', listener);
      host.addEventListener('gamepaddisconnected', listener);
      const forward: ForwardButton | undefined = shell
        ? (button, isDown) => {
            if (!isButtonNumber(button) || typeof isDown !== 'boolean') return;
            if (!isDown) down.delete(button);
            else if (!down.has(button)) {
              down.add(button);
              pressedSinceRead.add(button);
            }
            listener();
          }
        : undefined;
      if (forward !== undefined) host[FORWARDED_BUTTON_GLOBAL] = forward;
      return () => {
        host.removeEventListener('gamepadconnected', listener);
        host.removeEventListener('gamepaddisconnected', listener);
        if (forward !== undefined && host[FORWARDED_BUTTON_GLOBAL] === forward) {
          host[FORWARDED_BUTTON_GLOBAL] = undefined;
        }
      };
    },
  };
}
