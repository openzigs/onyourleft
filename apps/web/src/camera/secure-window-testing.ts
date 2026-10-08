// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A browser's secure window, for a test or a harness that builds a
 * `CameraController` — #1061, from #1123's review (N1).
 *
 * `CameraControllerOptions.secureWindow` is REQUIRED, so that dropping the
 * Android shell's flag owner from `main.tsx` is a type error rather than a
 * silent build. Everything that is not the shell passes what a browser gets:
 * {@link NO_SECURE_WINDOW}, which asks the platform for nothing. A test about
 * the flag builds its own {@link SecureWindow} over a scripted port instead.
 */

import { SecureWindow } from './secure-window';
import { NO_SECURE_WINDOW } from './secure-window-port';

/** A secure window that asks the platform for nothing, always in the foreground. */
export function browserSecureWindow(): SecureWindow {
  return new SecureWindow(NO_SECURE_WINDOW, {
    inForeground: () => true,
    onForeground: () => () => undefined,
  });
}
