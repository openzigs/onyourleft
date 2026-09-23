// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the Android shell knows about a camera that a browser does not**
 * ([#383](https://github.com/openzigs/onyourleft/issues/383)).
 *
 * ## Why there is no `CameraPort` implementation here
 *
 * #383's first criterion reads *"`apps/mobile/src/camera/` implements
 * `apps/web/src/camera/camera-port.ts` **unchanged**"*, and taken literally
 * that is not possible: `apps/web` already declares `@onyourleft/mobile` as a
 * dependency (`main.tsx` reaches the BLE transport through an `import()` behind
 * `isNativeShell`), so a `camera-port.ts` import from here would be a
 * **workspace cycle**. The interface is not widened to suit the platform, which
 * is what that criterion is actually protecting; it is simply satisfied on the
 * other side of the seam.
 *
 * So the shape is the one #382 itself names as the worked example —
 * `apps/web/src/support/shell-support-port.ts` + `shell-support.ts` +
 * `apps/mobile/src/index.ts` — and it is the shape #284 already uses for the
 * Devices screen's Bluetooth answer: **this module exports data and wording,
 * `apps/web/src/camera/shell-camera.ts` composes it into the port.**
 *
 * ## And there is a second reason, which is the one that actually matters
 *
 * ⚠️ **Inside the Capacitor shell, the camera that opens is the WebView's.**
 * `capacitor.config.ts` sets `webDir: '../web/dist'`, so the APK ships
 * `apps/web`'s bundle; `getUserMedia` inside that WebView is answered by
 * Chromium, and Capacitor's bridge handles the WebView's permission request by
 * asking Android for the runtime grant. There is no second capture path to
 * write, and writing one — a plugin, a native `ImageCapture` — would be the
 * thing ADR 0029 D-9 most warns against, because a platform camera hands back
 * **the sensor's own JPEG**, with every marker the device felt like writing in
 * it. `apps/web/src/frame.ts`'s refusal would then fire on every capture.
 *
 * What Android genuinely adds is three facts, and they are what this file is:
 *
 * 1. the **manifest** declares `CAMERA`, which no browser has;
 * 2. a refusal is fixed **in Android's own settings**, not in a site setting,
 *    so the browser wording is wrong here in a way a rider cannot act on;
 * 3. the device may have **no camera at all** and still run this app —
 *    `uses-feature … required="false"`, which is what keeps it installable on
 *    a device that never wanted the feature.
 *
 * ## No plugin, and that is a dependency decision recorded rather than taken
 *
 * #383: *"Prefer **no plugin**."* None is added. `@capacitor/camera` would be a
 * new dependency, a new licence to check against `apps/mobile`'s path, a new
 * `pnpm-workspace.yaml` install-script decision, and — the part that is not
 * about process — a second capture path with the metadata problem above.
 */

/** What a rider is told when the camera will not work **on Android**. */
export interface CameraPermissionNotice {
  /** What happened, not what the rider did wrong. */
  readonly title: string;
  /** Why, in one sentence, in the rider's terms rather than Android's. */
  readonly explanation: string;
  /** The one thing to do outside this app, or `null` when there is none. */
  readonly instruction: string | null;
}

/**
 * The refusal wording for the Android shell.
 *
 * ⚠️ **It differs from `apps/web/src/camera/notice.ts`'s in exactly one way and
 * that way is the point.** The browser's sentence says *"open this device's
 * settings, find On Your Left, and allow the camera"*, which is right for a
 * browser and nearly right here; Android's own path is more specific and a
 * rider in a garage needs the specific one. Everything else — the refusal to
 * name an error code, the refusal to carry anything of a frame (ADR 0029 D-8) —
 * is identical, because it is the same rule.
 *
 * ⚠️ **It is NOT the whole notice set.** Only the states Android answers
 * differently are here; `no-consent`, `no-camera` and `unavailable` mean the
 * same thing on both platforms and stay in one place. A second copy of a
 * sentence that did not need to differ is how two platforms drift.
 */
export const ANDROID_CAMERA_DENIED: CameraPermissionNotice = {
  title: 'The camera was not allowed',
  // Says what the permission is FOR, the way `permission/notice.ts` does for
  // Bluetooth: Android's own prompt says "Camera", which tells a rider nothing
  // about why a cycling app wants one.
  explanation:
    'Android asks before an app can use the camera. On Your Left uses it to take still pictures of you while you ride, on this device, and nothing is sent anywhere.',
  instruction:
    'Open Settings, then Apps, then On Your Left, then Permissions, and allow Camera. Then check again.',
};

/**
 * What this build's own manifest declares about the camera.
 *
 * ⚠️ **Written down rather than read, and the difference is what
 * `apps/mobile/src/android/merged-manifest.ts` exists for.** A running app
 * cannot read its own manifest through the WebView, so this is a **claim** —
 * and the claim is checked against the manifest the Gradle merge actually
 * ships by `merged-manifest.test.ts`, on a machine that has built one. CI has
 * not (CLAUDE.md §4c), so there it skips, loudly, naming the paths.
 *
 * The pair is the point. `required: false` on the feature is what keeps the app
 * installable on a device with no camera, and a build that declared the
 * permission without it would be an app Google Play filters off every such
 * device — for a feature a rider need never turn on.
 */
export const ANDROID_CAMERA_MANIFEST = {
  permission: 'android.permission.CAMERA',
  feature: 'android.hardware.camera',
  featureRequired: false,
} as const;

/**
 * Whether Android asks for the camera permission at app start.
 *
 * ⚠️ **`false`, and it is a constant rather than a comment because #383 asks
 * for a test.** *"A camera permission prompt on first launch of a cycling app
 * is the thing that gets an app uninstalled, and nothing in the manifest
 * prevents it."* What prevents it here is that nothing in the start-up path
 * touches the port at all: `main.tsx` constructs a `CameraController` with no
 * consent, and `CameraController.turnOn` refuses before reaching the port. The
 * prompt is raised by the WebView's first `getUserMedia`, which is reached only
 * from the Camera screen's own control.
 *
 * `camera.test.ts` §"the permission is not requested at app start" and
 * `apps/web/src/camera/session.test.ts` §"the camera is off by default" are the
 * two halves of that, and the second is the one that could actually regress.
 */
export const ANDROID_ASKS_FOR_CAMERA_AT_START = false;
