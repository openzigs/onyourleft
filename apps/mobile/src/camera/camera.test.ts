// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the Android shell says about a camera, and the one thing it refuses to
 * say (#383).
 *
 * ⚠️ **There is no capture path under test here because there is none to
 * test.** `camera.ts` says why at length: the WebView's own `getUserMedia` is
 * what opens a camera inside the shell, so the implementation is
 * `apps/web/src/camera/browser-camera.ts` on both platforms, and a native one
 * would hand back the sensor's own JPEG — the thing ADR 0029 D-9's re-encode
 * exists to avoid. What is Android's own is the wording and the manifest claim,
 * and those are what this file checks.
 */

import { describe, expect, it } from 'vitest';

import {
  ANDROID_ASKS_FOR_CAMERA_AT_START,
  ANDROID_CAMERA_DENIED,
  ANDROID_CAMERA_MANIFEST,
} from './camera';

describe('what a rider is told when Android refuses the camera', () => {
  it('says what happened rather than what the rider did wrong', () => {
    expect(ANDROID_CAMERA_DENIED.title).toBe('The camera was not allowed');
    expect(ANDROID_CAMERA_DENIED.explanation.length).toBeGreaterThan(60);
  });

  it('names what the permission is FOR, which Android’s own prompt does not', () => {
    // The same call `permission/notice.ts` makes about "Nearby devices": the
    // platform's prompt says "Camera", which tells a rider nothing about why a
    // cycling app wants one.
    expect(ANDROID_CAMERA_DENIED.explanation).toContain('while you ride');
    expect(ANDROID_CAMERA_DENIED.explanation).toContain('nothing is sent anywhere');
  });

  it('names ANDROID’s own path, which is the whole reason this wording exists', () => {
    // The browser's sentence says "this device's settings", which is right for
    // a browser and useless in a garage. If this ever reads the same as
    // `apps/web/src/camera/notice.ts`'s, the module has stopped earning its
    // place — see `apps/web/src/camera/shell-camera.ts`.
    const instruction = ANDROID_CAMERA_DENIED.instruction ?? '';
    expect(instruction).toContain('Settings');
    expect(instruction).toContain('Permissions');
    expect(instruction).toContain('Camera');
  });

  it('names no error code and carries nothing of a picture', () => {
    // ADR 0029 D-8, which binds this wording exactly as it binds the shared
    // table: a message about imagery may name that there was an image and what
    // went wrong with it, and never the image, a part of it, a rendering of it
    // or a locator for it.
    const whole = `${ANDROID_CAMERA_DENIED.title} ${ANDROID_CAMERA_DENIED.explanation} ${ANDROID_CAMERA_DENIED.instruction ?? ''}`;
    expect(whole).not.toMatch(/SecurityException|DOMException|NotAllowedError|0x[0-9a-f]+/i);
    expect(whole).not.toMatch(/data:image\/|blob:|base64/i);
  });
});

describe('what this build claims about its own manifest', () => {
  it('names the permission and the feature it must travel with', () => {
    expect(ANDROID_CAMERA_MANIFEST.permission).toBe('android.permission.CAMERA');
    expect(ANDROID_CAMERA_MANIFEST.feature).toBe('android.hardware.camera');
  });

  it('claims the feature is OPTIONAL, which is what keeps the app installable', () => {
    // The claim; `merged-manifest.test.ts` is what checks it against the
    // manifest the Gradle merge actually ships, on a machine that has built
    // one. A permission implies a REQUIRED feature to Google Play, and a
    // required camera is an app absent from a store listing on every device
    // without one — for a feature that is off by default.
    expect(ANDROID_CAMERA_MANIFEST.featureRequired).toBe(false);
  });
});

describe('start-up', () => {
  it('asks for nothing', () => {
    // #383: *"a test asserts the permission is not requested at app start"*.
    // The half that could regress is `apps/web/src/camera/session.test.ts`
    // §"the camera is off by default", which asserts the port recorded no call
    // at all — this is the statement of intent that test holds the code to.
    expect(ANDROID_ASKS_FOR_CAMERA_AT_START).toBe(false);
  });
});
