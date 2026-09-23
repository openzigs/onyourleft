// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ADR 0029 D-8, as a test over every string this module can produce.
 *
 * ⚠️ **The population is derived, not listed.** `CAMERA_NOTICES` is walked, and
 * the walk is asserted to have found something first — a table that had been
 * emptied would otherwise make every assertion below pass over nothing, which
 * is the vacuous shape this repository keeps finding.
 */

import { describe, expect, it } from 'vitest';

import type { CameraProblemKind } from './camera-port';
import {
  CAMERA_NOTICES,
  cameraNotice,
  cameraProblemMessage,
  frameLeaksIn,
  FORBIDDEN_IN_A_CAMERA_MESSAGE,
} from './notice';

const KINDS: readonly CameraProblemKind[] = [
  'unsupported',
  'no-camera',
  'not-permitted',
  'unavailable',
  'no-consent',
];

describe('the notice table', () => {
  it('has an entry for every problem a camera can have', () => {
    expect(Object.keys(CAMERA_NOTICES).sort()).toStrictEqual([...KINDS].sort());
  });

  it('gives every one of them a title and an explanation worth reading', () => {
    for (const kind of KINDS) {
      const notice = cameraNotice(kind);
      expect(notice.title.length, kind).toBeGreaterThan(10);
      expect(notice.explanation.length, kind).toBeGreaterThan(40);
    }
  });

  it('names no error code as the whole of a message', () => {
    // #382: *"A test asserts the explanation renders and names no error code as
    // its only content."* A `DOMException` name is the shape that would get
    // here — `NotAllowedError` is the one `browser-camera.ts` maps and throws
    // away — so the assertion is that none of them appears at all.
    for (const kind of KINDS) {
      const notice = cameraNotice(kind);
      const whole = `${notice.title} ${notice.explanation} ${notice.instruction ?? ''}`;
      expect(whole, kind).not.toMatch(
        /NotAllowedError|NotFoundError|OverconstrainedError|DOMException|0x[0-9a-f]+/i,
      );
    }
  });

  it('offers an action exactly where one could help', () => {
    // The two with no instruction are the two where nothing the rider does
    // outside the app changes the answer: a stack with no camera API, and a
    // consent the screen beside the sentence is already asking for.
    expect(cameraNotice('unsupported').instruction).toBeNull();
    expect(cameraNotice('no-consent').instruction).toBeNull();
    for (const kind of ['no-camera', 'not-permitted', 'unavailable'] as const) {
      expect(cameraNotice(kind).instruction, kind).not.toBeNull();
    }
  });

  it('marks the one state nothing can recover from', () => {
    expect(cameraNotice('unsupported').recoverable).toBe(false);
    for (const kind of KINDS.filter((each) => each !== 'unsupported')) {
      expect(cameraNotice(kind).recoverable, kind).toBe(true);
    }
  });
});

describe('the D-8 scan', () => {
  it('knows what it is looking for', () => {
    // The vacuous pass: an empty pattern list would make every assertion below
    // report a clean string, which is the strongest possible privacy claim on
    // no evidence at all.
    expect(FORBIDDEN_IN_A_CAMERA_MESSAGE.length).toBeGreaterThanOrEqual(5);
  });

  it('catches every shape ADR 0029 D-8 forbids', () => {
    expect(frameLeaksIn('the picture: data:image/jpeg;base64,AAAA')).toContain('a data URL');
    expect(frameLeaksIn('could not read blob:http://x/abc')).toContain('an object URL');
    expect(frameLeaksIn('/var/data/oyl/frame-3.jpg')).toContain('a filesystem or URL path');
    expect(frameLeaksIn('cache key oyl-frames-1')).toContain('a cache key');
  });

  it('does not fire on ordinary prose', () => {
    expect(
      frameLeaksIn('The camera could not be opened. Close anything else using it.'),
    ).toStrictEqual([]);
  });

  it('finds nothing in any message this module produces', () => {
    for (const kind of KINDS) {
      const notice = cameraNotice(kind);
      for (const text of [notice.title, notice.explanation, notice.instruction ?? '']) {
        expect(frameLeaksIn(text), `${kind}: ${text}`).toStrictEqual([]);
      }
      expect(frameLeaksIn(cameraProblemMessage(kind)), kind).toStrictEqual([]);
    }
  });
});
