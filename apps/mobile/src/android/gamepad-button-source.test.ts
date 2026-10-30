// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `MainActivity` forwards a generic gamepad's numbered buttons to the page,
 * and every other key event takes its existing path — #1858.
 *
 * CI does not build Android, so this reads the source, as `back-source.test.ts`
 * does, and goes one step further for the decision itself:
 * `MainActivity.forwardedButton` is written as integer arithmetic and `if`s
 * only, so its body is lifted out of the Java, Android's constants are
 * substituted by their published values ({@link ANDROID}, from
 * `android.view.KeyEvent` and `android.view.InputDevice`), and it is RUN over
 * each class of key event #1858 names: the volume keys, a keyboard's key, a
 * named gamepad button, and the numbered ones. A body this cannot translate
 * fails here rather than passing unread.
 *
 * The page's function name is the one `apps/web/src/game/gamepad-port.ts`
 * exports — imported by a relative path, app to app, for
 * `night-colours.test.ts`' reason. Whether a pad throws on a device is #1858's
 * tablet step, run by the maintainer with the owner.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { FORWARDED_BUTTON_GLOBAL, FORWARDED_BUTTONS } from '../../../web/src/game/gamepad-port';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');
const activity = readFileSync(join(SOURCE, 'MainActivity.java'), 'utf8');

/** The Android constants the predicate may name, at their values in the Android SDK. */
const ANDROID: Readonly<Record<string, number>> = {
  'KeyEvent.KEYCODE_BUTTON_1': 188,
  'KeyEvent.KEYCODE_BUTTON_16': 203,
  'InputDevice.SOURCE_JOYSTICK': 0x01000000 | 0x00000010,
  'InputDevice.SOURCE_GAMEPAD': 0x00000400 | 0x00000001,
};

const KEYCODE_VOLUME_UP = 24;
const KEYCODE_VOLUME_DOWN = 25;
const KEYCODE_A = 29;
const KEYCODE_BUTTON_A = 96;
const KEYCODE_BUTTON_B = 97;
const KEYCODE_BUTTON_1 = 188;
const SOURCE_KEYBOARD = 0x00000100 | 0x00000001;
const SOURCE_DPAD = 0x00000200 | 0x00000001;
const SOURCE_GAMEPAD = 0x00000400 | 0x00000001;
const SOURCE_JOYSTICK = 0x01000000 | 0x00000010;
/** Spike 0027's generic USB pad: Android lists its source as KEYBOARD | JOYSTICK. */
const GENERIC_PAD = SOURCE_KEYBOARD | SOURCE_JOYSTICK;
/** Spike 0027's Xbox pad: KEYBOARD | GAMEPAD | JOYSTICK. */
const XBOX_PAD = SOURCE_KEYBOARD | SOURCE_GAMEPAD | SOURCE_JOYSTICK;

/** The body of a method of `MainActivity`, from its signature to its closing brace. */
function bodyOf(signature: string): string {
  const start = activity.indexOf(signature);
  expect(start, `${signature} is in MainActivity.java`).toBeGreaterThan(-1);
  const open = activity.indexOf('{', start);
  let depth = 0;
  for (let at = open; at < activity.length; at += 1) {
    if (activity[at] === '{') depth += 1;
    if (activity[at] === '}') depth -= 1;
    if (depth === 0) return activity.slice(open + 1, at);
  }
  throw new Error(`${signature} has no closing brace`);
}

/** `MainActivity.forwardedButton`, translated to JavaScript and run. */
const forwardedButton = ((): ((keyCode: number, source: number) => number) => {
  let body = bodyOf('static int forwardedButton(int keyCode, int source)');
  for (const [name, value] of Object.entries(ANDROID)) {
    // Whole names only: KEYCODE_BUTTON_1 is a prefix of KEYCODE_BUTTON_16.
    body = body.replace(new RegExp(`\\b${name.replace('.', '\\.')}\\b`, 'g'), String(value));
  }
  body = body.replace(/\b(?:boolean|int)\s+(?=\w+\s*=)/g, 'const ');
  // Anything Android left in it is a constant this test does not know: fail, never guess.
  expect(body).not.toMatch(/\b(?:KeyEvent|InputDevice)\./);
  // A fresh context with no globals: the body can reach nothing but its two arguments.
  return runInNewContext(`'use strict';(function (keyCode, source) {${body}})`) as (
    keyCode: number,
    source: number,
  ) => number;
})();

describe('which key events MainActivity forwards to the page (#1858)', () => {
  it('forwards KEYCODE_BUTTON_1 to 16 from a joystick or a gamepad, as 1 to 16', () => {
    for (let button = 1; button <= FORWARDED_BUTTONS; button += 1) {
      const code = KEYCODE_BUTTON_1 + button - 1;
      for (const source of [GENERIC_PAD, XBOX_PAD, SOURCE_JOYSTICK, SOURCE_GAMEPAD]) {
        expect(forwardedButton(code, source)).toBe(button);
      }
    }
  });

  it('forwards no code either side of the numbered buttons: outside 1 to 16 is dropped', () => {
    expect(forwardedButton(KEYCODE_BUTTON_1 - 1, GENERIC_PAD)).toBe(0);
    expect(forwardedButton(KEYCODE_BUTTON_1 + FORWARDED_BUTTONS, GENERIC_PAD)).toBe(0);
    expect(forwardedButton(-1, GENERIC_PAD)).toBe(0);
    expect(forwardedButton(0x7fffffff, GENERIC_PAD)).toBe(0);
    // Every key code from 0 to 400, past the last one Android defines, from a pad.
    for (let code = 0; code <= 400; code += 1) {
      const button = code - KEYCODE_BUTTON_1 + 1;
      const expected = button >= 1 && button <= FORWARDED_BUTTONS ? button : 0;
      expect(forwardedButton(code, XBOX_PAD), `key code ${String(code)}`).toBe(expected);
    }
  });

  it.each([
    ['the volume up key', KEYCODE_VOLUME_UP, SOURCE_KEYBOARD],
    ['the volume down key', KEYCODE_VOLUME_DOWN, SOURCE_KEYBOARD],
    ['a keyboard key', KEYCODE_A, SOURCE_KEYBOARD],
    ['a named gamepad button, A', KEYCODE_BUTTON_A, XBOX_PAD],
    ['a named gamepad button, B', KEYCODE_BUTTON_B, SOURCE_GAMEPAD],
  ] as const)('leaves %s on its existing path', (_, code, source) => {
    expect(forwardedButton(code, source)).toBe(0);
  });

  it('leaves a numbered code from anything but a joystick or a gamepad on its existing path', () => {
    for (const source of [SOURCE_KEYBOARD, SOURCE_DPAD, 0]) {
      expect(forwardedButton(KEYCODE_BUTTON_1, source)).toBe(0);
    }
  });
});

describe('how MainActivity forwards them (#1858)', () => {
  const dispatch = bodyOf('public boolean dispatchKeyEvent(KeyEvent event)');

  it('judges the pad by its device too: a generic pad’s buttons carry the keyboard source alone', () => {
    // Measured on the owner's tablet, 2026-10-30: the Twin USB receiver (KEYBOARD | JOYSTICK)
    // raised BTN_TOP and the rest as key events whose own source was plain KEYBOARD, and
    // forwarding on the event's source alone dropped every press.
    const sources = bodyOf('static int sourcesOf(KeyEvent event)');
    expect(sources).toMatch(
      /return event\.getSource\(\) \| \(device == null \? 0 : device\.getSources\(\)\);/,
    );
    expect(sources).toContain('InputDevice device = event.getDevice();');
    // What dispatch hands forwardedButton for that pad: the keyboard event's source, or'd with
    // the device's, forwards; a keyboard's own numbered code (none exists) would not.
    expect(forwardedButton(KEYCODE_BUTTON_1 + 3, SOURCE_KEYBOARD | GENERIC_PAD)).toBe(4);
    expect(forwardedButton(KEYCODE_BUTTON_1 + 3, SOURCE_KEYBOARD)).toBe(0);
  });

  it('overrides the activity’s key dispatch, and sends every event it does not forward to super', () => {
    expect(activity).toMatch(/@Override\s+public boolean dispatchKeyEvent\(KeyEvent event\)/);
    expect(dispatch).toContain(
      'int button = forwardedButton(event.getKeyCode(), sourcesOf(event));',
    );
    expect(dispatch).toMatch(
      /if \(button == 0 \|\| bridge == null \|\| bridge\.getWebView\(\) == null\) \{\s*return super\.dispatchKeyEvent\(event\);\s*\}/,
    );
    // The only other way out consumes the event, after forwarding it.
    expect(dispatch.match(/return /g)).toHaveLength(2);
    expect(dispatch.trimEnd()).toMatch(/return true;$/);
  });

  it('sends a first press as down and a release as up, and a held button’s repeats not at all', () => {
    expect(dispatch).toMatch(
      /if \(action == KeyEvent\.ACTION_DOWN && event\.getRepeatCount\(\) == 0\) \{\s*forwardButton\(bridge\.getWebView\(\), button, true\);\s*\} else if \(action == KeyEvent\.ACTION_UP\) \{\s*forwardButton\(bridge\.getWebView\(\), button, false\);\s*\}/,
    );
  });

  it('calls the function the page installs, with only a number and a boolean in the script', () => {
    const forward = bodyOf(
      'private static void forwardButton(WebView webView, int button, boolean pressed)',
    );
    expect(forward).toContain(`var f=window.${FORWARDED_BUTTON_GLOBAL};`);
    expect(forward).toContain("try{if(typeof f==='function'){f(");
    expect(forward).toContain('(pressed ? "true" : "false")');
    expect(forward).toContain('}}catch(e){}})()');
    // Concatenated into the script: the int and the constant boolean, nothing else.
    const joined = [...forward.matchAll(/\+\s*([^\s"+][^+]*?)\s*(?=\+|,\s*null)/g)].map((m) =>
      m[1]?.trim(),
    );
    expect(joined).toEqual(['button', '(pressed ? "true" : "false")']);
  });
});
