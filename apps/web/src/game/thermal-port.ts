// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the game may ask the platform about heat — #247.
 *
 * `quality.ts` has two inputs and until #247 only one of them was ever
 * supplied. `QualitySample.thermalHeadroom` is Android's own forecast,
 * `PowerManager.getThermalHeadroom()` (API 30+), and nothing in the shipped app
 * read it: `apps/mobile/src/index.ts` exported the BLE transport and the
 * permission wording and nothing else, so `HEADROOM_REDUCE_ABOVE` and
 * `HEADROOM_RESTORE_BELOW` could not fire on any device
 * (`docs/validation/0002-android-shell-and-game.md` Part E).
 *
 * The shape is CLAUDE.md §4h's: a port here, the Capacitor half in
 * `apps/mobile/src/thermal/`, composed in `main.tsx` behind `isNativeShell` so
 * a browser downloads no line of it.
 *
 * ⚠️ **A `*-port.ts` on purpose.** The port reaches `GameView` as an optional
 * prop threaded through JSX, which `check-wiring.mjs` §Limits says the gate
 * cannot follow. The suffix makes `readThermalHeadroom` a `WIRE003` target, so
 * a `GameView` that stopped asking is a red gate. A `main.tsx` that stopped
 * passing the Android port is NOT, and `thermal.test.ts` is what stands there.
 */

/**
 * The platform's thermal forecast, on whatever platform this is.
 *
 * - **`undefined`**: the platform has no forecast. That is every browser, every
 *   Android below API 30, and a plugin that is not there. `quality.ts` treats it
 *   as "no opinion", never as "cool".
 * - **`NaN`**: the platform has the API and gave no number. Some vendors never
 *   implemented it, and Android returns `NaN` to a caller that asks too often.
 *   It is **passed through unchanged** so `quality.ts`'s own NaN rule decides,
 *   rather than being masked into `undefined` or into a number here.
 * - **A number**: Android's forecast, 0 upwards, where 1.0 means throttling is
 *   imminent. Not clamped: a value over 1 is the platform saying it is already
 *   throttling, and that is the reading the ladder most needs.
 */
export interface ThermalPort {
  readThermalHeadroom(): Promise<number | undefined>;
}

/**
 * The web implementation: there is no forecast in a browser, and saying so is
 * the honest answer. `undefined`, never a number that looks cool.
 */
export const BROWSER_THERMAL: ThermalPort = {
  readThermalHeadroom: () => Promise.resolve(undefined),
};
