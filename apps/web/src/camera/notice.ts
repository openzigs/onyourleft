// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a rider is told when the camera will not work, and the rule that
 * nothing else may be said** (#382,
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-8).
 *
 * Five states, five fixed sentences, and **no interpolation anywhere in this
 * file**. That is the whole design, and it is the enforcement half of D-8:
 *
 * > a message about imagery may name **that there was an image** and **what
 * > went wrong with it**, and must never carry the image, a part of it, a
 * > rendering of it, or a locator for it.
 *
 * A platform's own error is the thing most likely to break that rule without
 * anybody noticing. `getUserMedia` rejects with a `DOMException` whose message
 * can name a device; a canvas encoder can reject with a string containing a
 * data URL; a future Capacitor plugin could hand back a cache path. Every one
 * of those reads like a useful diagnostic and every one of them is a locator.
 * So the mapping is one-way: `browser-camera.ts` classifies a rejection into a
 * {@link CameraProblemKind} and **throws the platform's own message away**,
 * and this table is the only source of the words a rider sees.
 *
 * ⚠️ **The refusal is a screen, not a dead control** — #87's criterion 8
 * precedent, which #382 carries forward. A rider who denied the permission
 * meets an explanation naming the one thing to do outside this app, not a
 * button that does nothing and not an error code.
 *
 * ⚠️ **No sentence here names a body, a joint, a posture or a benefit.**
 * [ADR 0030](../../../../docs/adr/0030-what-the-app-may-say-about-a-body.md)
 * binds every string this feature adds, and its 2026-09-23 amendment makes the
 * six general-wellness conditions obligations rather than a framing to avoid.
 * An error message has nothing to gain by describing what the camera would have
 * been looking at, so it does not.
 */

import type { CameraNotice, CameraProblemKind } from './camera-port';

/**
 * The sentences, one per kind.
 *
 * ⚠️ **Total over {@link CameraProblemKind} rather than defaulted.** A
 * `Record` with every member forces a new kind to arrive with its words; a
 * lookup with a fallback would render `undefined` at a rider the day somebody
 * added one. `support/shell-support.ts` §`INSTRUCTION` keeps its unreachable
 * branch for the same reason and says so plainly.
 */
export const CAMERA_NOTICES: Readonly<Record<CameraProblemKind, CameraNotice>> = {
  unsupported: {
    title: 'This browser cannot use a camera here',
    explanation:
      'A camera needs a secure connection and a browser that offers one to a page. This one ' +
      'does not, so there is nothing to switch on.',
    // Nothing the rider does on this device changes it, so there is no
    // instruction — the same call `permissionNotice` makes for a stack with no
    // Bluetooth at all: "a retry button here would be an invitation to keep
    // pressing something that cannot work".
    instruction: null,
    recoverable: false,
  },
  'no-camera': {
    title: 'This device has no camera',
    explanation:
      'Nothing has been refused. The browser answered that there is no camera attached to this ' +
      'device.',
    instruction: 'Plug in a camera, or use a device that has one, and check again.',
    recoverable: true,
  },
  'not-permitted': {
    title: 'The camera was not allowed',
    explanation:
      'This device refused the camera to On Your Left. That is a permission held outside this ' +
      'app, so nothing here can change it.',
    instruction:
      'Open this device’s settings, find On Your Left, and allow the camera. Then check again.',
    recoverable: true,
  },
  unavailable: {
    title: 'The camera could not be opened',
    explanation:
      'The camera is there and allowed, and it would not start. Something else on this device ' +
      'usually has it.',
    instruction: 'Close anything else that might be using the camera, then check again.',
    recoverable: true,
  },
  'no-consent': {
    title: 'The camera is off',
    explanation:
      'It stays off until you turn it on, and it has never been on. Nothing has been captured ' +
      'and there is nothing on this device to remove.',
    // The action is the consent control on the same screen. Prose telling a
    // rider to press the button beside this sentence is noise.
    instruction: null,
    recoverable: true,
  },
};

/** The notice for a kind. Total, so there is no `undefined` to render. */
export function cameraNotice(kind: CameraProblemKind): CameraNotice {
  return CAMERA_NOTICES[kind];
}

/**
 * The message a {@link CameraCaptureError} carries for a kind.
 *
 * The title and the explanation, joined — a sentence a caller could log, in
 * which every word came from the table above. It exists so that the throw site
 * has nothing to compose and therefore nothing to accidentally compose the
 * platform's error into.
 */
export function cameraProblemMessage(kind: CameraProblemKind): string {
  const notice = CAMERA_NOTICES[kind];
  return `${notice.title}. ${notice.explanation}`;
}

/**
 * The shapes D-8 forbids, as patterns, so the rule is a test rather than a
 * reading.
 *
 * ⚠️ **Written down here rather than inside the test** because two consumers
 * need it: `notice.test.ts`, which walks this table, and
 * `no-frame-in-messages.test.ts`, which walks **every string this module
 * produces** including the ones `session.ts` and `CameraView.tsx` add. A
 * pattern list that lived in one of them would leave the other checking
 * something else.
 *
 * Each entry is a way a frame or a locator for one gets into a string:
 *
 * - a `data:` URL is the frame itself, base64'd;
 * - a `blob:` URL is a handle to the frame, and is a locator D-8 names;
 * - `base64` is what somebody writes when they are about to do the first;
 * - a filesystem path and a cache key are the other two locators D-8 names.
 */
export const FORBIDDEN_IN_A_CAMERA_MESSAGE: readonly { name: string; pattern: RegExp }[] = [
  { name: 'a data URL', pattern: /data:\s*image\//i },
  { name: 'an object URL', pattern: /blob:/i },
  { name: 'base64 image bytes', pattern: /base64/i },
  // A path with at least two segments, so an ordinary sentence containing a
  // slash — "on/off", a date — is not a hit. A one-segment match would fire on
  // prose and a noisy rule gets deleted.
  { name: 'a filesystem or URL path', pattern: /[\w.]+\/[\w.]+\/[\w.]+/ },
  { name: 'a cache key', pattern: /cache[-\s]?key/i },
];

/** Every forbidden shape found in `text`, by name. Empty means clean. */
export function frameLeaksIn(text: string): readonly string[] {
  return FORBIDDEN_IN_A_CAMERA_MESSAGE.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}
