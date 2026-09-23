// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The camera port, inside the Android shell**
 * ([#383](https://github.com/openzigs/onyourleft/issues/383)).
 *
 * The shape is `support/shell-support.ts`'s, which is #284's, which is the one
 * #382 names as the worked example: `apps/mobile` supplies what only Android
 * knows as **data**, and this module composes it with the browser capture path
 * into a {@link CameraPort}.
 *
 * ## Why the capture path is the browser's on both platforms
 *
 * `apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'`, so the APK
 * ships this bundle and `getUserMedia` inside the WebView is answered by
 * Chromium. Capacitor's bridge turns the WebView's permission request into
 * Android's runtime one. So there is **one** capture implementation and it is
 * `browser-camera.ts`; `apps/mobile/src/camera/camera.ts` records why writing a
 * second one would be worse than not — a platform camera hands back the
 * sensor's own JPEG, and ADR 0029 D-9's whole guarantee is that a frame is
 * re-encoded from raw pixels rather than filtered.
 *
 * ## So what does this module actually change
 *
 * **One sentence.** A rider who refuses the camera on Android is told to fix it
 * in Android's Settings, under Apps, under Permissions — not in "this device's
 * settings", which is right for a browser and useless in a garage. That is the
 * same reason `support/shell-support.ts` exists rather than the Devices screen
 * reusing the browser's notice: *"every branch of the browser notice is **about
 * browsers** … and none of it is true on a phone running the shell"*.
 *
 * ⚠️ **And it is ONE function, not a wrapped port.** The first version of this
 * module also exported a `shellCameraPort(inner, wording)` that delegated all
 * three methods to the browser port unchanged — a wrapper that changed nothing,
 * which is the kind of seam #284's review deleted from `shell-support.ts` for
 * being *"an export whose only caller is its own file"*. What the shell
 * genuinely supplies is the wording, so that is what it supplies; the port it
 * runs is `browserCameraPort` on both platforms, because inside the WebView
 * that is the thing that actually opens a camera.
 */

import type { CameraNotice, CameraProblemKind } from './camera-port';
import { cameraNotice } from './notice';

/**
 * The wording `apps/mobile` supplies.
 *
 * Passed rather than imported, for the reason `support/shell-support.ts` gives:
 * `main.tsx` reaches `@onyourleft/mobile` through an `import()` behind
 * `isNativeShell`, so a browser downloads no Capacitor — and a module that
 * named the package statically would undo that for every visitor.
 * `no-capacitor-in-the-browser.test.ts` is what checks it rather than trusting
 * this paragraph.
 */
export interface ShellCameraWording {
  readonly title: string;
  readonly explanation: string;
  readonly instruction: string | null;
}

/**
 * The notice for a problem, with Android's own sentence where it differs.
 *
 * ⚠️ **Total over {@link CameraProblemKind} by falling through to the shared
 * table**, rather than by a second table of its own. Only `not-permitted` is
 * answered differently on Android; every other state means the same thing on
 * both platforms, and a second copy of a sentence that did not need to differ
 * is how two platforms drift apart — `apps/mobile/src/camera/camera.ts`
 * §`ANDROID_CAMERA_DENIED` makes the same point from the other side.
 */
export function shellCameraNotice(
  kind: CameraProblemKind,
  denied: ShellCameraWording,
): CameraNotice {
  if (kind !== 'not-permitted') {
    return cameraNotice(kind);
  }
  return {
    title: denied.title,
    explanation: denied.explanation,
    instruction: denied.instruction,
    // A refused permission is always recoverable: it is fixed outside the app
    // and asking again afterwards is the whole point of the instruction.
    recoverable: true,
  };
}
