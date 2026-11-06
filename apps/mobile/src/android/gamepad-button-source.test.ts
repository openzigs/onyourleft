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
 * Since #1893 the same is done to `dispatchKeyEvent` and every method it
 * calls, so the dispatch itself runs over stub key events, with
 * `BridgeActivity`'s parts (`getBridge`, `super.dispatchKeyEvent`) and
 * `forwardButton` handed in: a held button whose pad is unplugged is
 * released on the page even when `getDevice()` finds nothing, and no key
 * but KEYCODE_BUTTON_1 to 16 has its device asked for.
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
  'KeyEvent.ACTION_DOWN': 0,
  'KeyEvent.ACTION_UP': 1,
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

/**
 * A method's body as JavaScript: Android's constants by value, a local's
 * declared type as `let`, and the superclass's dispatch as the host's.
 */
function translated(signature: string): string {
  let body = bodyOf(signature);
  for (const [name, value] of Object.entries(ANDROID)) {
    // Whole names only: KEYCODE_BUTTON_1 is a prefix of KEYCODE_BUTTON_16.
    body = body.replace(new RegExp(`\\b${name.replace('.', '\\.')}\\b`, 'g'), String(value));
  }
  body = body.replace(/\b(?:boolean|int|Bridge|InputDevice)\s+(?=\w+\s*=)/g, 'let ');
  body = body.replace(/\bsuper\.dispatchKeyEvent\(/g, 'superDispatch(');
  // Anything Android left in it is a constant this test does not know: fail, never guess.
  expect(body, signature).not.toMatch(/\b(?:KeyEvent|InputDevice)\./);
  // And any Java declaration left is a type this test does not know.
  expect(body, signature).not.toMatch(
    /\b(?:byte|char|short|int|long|float|double|boolean|[A-Z]\w*)\s+\w+\s*=[^=]/,
  );
  return body;
}

const SIGNATURES = {
  dispatchKeyEvent: 'public boolean dispatchKeyEvent(KeyEvent event)',
  forwardedButton: 'static int forwardedButton(int keyCode, int source)',
  sourcesOf: 'static int sourcesOf(KeyEvent event)',
  isNumberedButton: 'static boolean isNumberedButton(int keyCode)',
  sentDown: 'static int sentDown(int down, int keyCode)',
} as const;

/** The one Java program every case runs: the methods the dispatch calls, each translated. */
const PROGRAM = `'use strict';(function (host) {
  const getBridge = host.getBridge;
  const forwardButton = host.forwardButton;
  const superDispatch = host.superDispatch;
  let buttonsDown = 0;
  function forwardedButton(keyCode, source) {${translated(SIGNATURES.forwardedButton)}}
  function sourcesOf(event) {${translated(SIGNATURES.sourcesOf)}}
  function isNumberedButton(keyCode) {${translated(SIGNATURES.isNumberedButton)}}
  function sentDown(down, keyCode) {${translated(SIGNATURES.sentDown)}}
  return {
    dispatchKeyEvent(event) {${translated(SIGNATURES.dispatchKeyEvent)}},
    forwardedButton, sourcesOf,
  };
})`;

/** What the program needs of `BridgeActivity`. */
interface Host {
  getBridge(): { getWebView(): object | null } | null;
  forwardButton(webView: object, button: number, pressed: boolean): void;
  superDispatch(event: KeyEventStub): boolean;
}

/** The parts of `android.view.KeyEvent` the activity reads. */
interface KeyEventStub {
  getKeyCode(): number;
  getAction(): number;
  getRepeatCount(): number;
  getSource(): number;
  getDevice(): { getSources(): number } | null;
}

/** What the program returns; none of it reads `this`. */
interface Program {
  readonly dispatchKeyEvent: (event: KeyEventStub) => boolean;
  readonly forwardedButton: (keyCode: number, source: number) => number;
  readonly sourcesOf: (event: KeyEventStub) => number;
}

/** A fresh context with no globals: the program reaches nothing but what `host` hands it. */
function program(host: Host): Program {
  return (runInNewContext(PROGRAM) as (host: Host) => Program)(host);
}

const NO_HOST: Host = {
  getBridge: () => null,
  forwardButton: () => undefined,
  superDispatch: () => false,
};

/** `MainActivity.forwardedButton`, translated to JavaScript and run. */
const { forwardedButton } = program(NO_HOST);

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

const ACTION_DOWN = 0;
const ACTION_UP = 1;

/** A key event as Android hands the activity one; `device` `null` is a device `getDevice()` no longer finds. */
function keyEvent(
  keyCode: number,
  action: number,
  options: {
    readonly source?: number;
    readonly device?: number | null;
    readonly repeat?: number;
  } = {},
): KeyEventStub & { readonly devicesAsked: () => number } {
  let asked = 0;
  const device = options.device === undefined ? GENERIC_PAD : options.device;
  return {
    getKeyCode: () => keyCode,
    getAction: () => action,
    getRepeatCount: () => options.repeat ?? 0,
    getSource: () => options.source ?? SOURCE_KEYBOARD,
    getDevice: () => {
      asked += 1;
      return device === null ? null : { getSources: () => device };
    },
    devicesAsked: () => asked,
  };
}

/** One `MainActivity`, run: what it sent the page, and how many events it passed to `super`. */
function newActivity(options: { readonly webView?: boolean } = {}): {
  readonly dispatch: (event: KeyEventStub) => boolean;
  readonly sent: [number, boolean][];
  readonly toSuper: () => number;
} {
  const webView = {};
  const sent: [number, boolean][] = [];
  let toSuper = 0;
  const run = program({
    getBridge: () => ({ getWebView: () => (options.webView === false ? null : webView) }),
    forwardButton: (view, button, pressed) => {
      expect(view).toBe(webView);
      sent.push([button, pressed]);
    },
    superDispatch: () => {
      toSuper += 1;
      return false;
    },
  });
  return { dispatch: (event) => run.dispatchKeyEvent(event), sent, toSuper: () => toSuper };
}

describe('how MainActivity forwards them (#1858)', () => {
  it('overrides the activity’s key dispatch, and keeps the buttons sent down on the activity', () => {
    expect(activity).toMatch(/@Override\s+public boolean dispatchKeyEvent\(KeyEvent event\)/);
    // The program's `buttonsDown` stands for this field: one per activity, from no button.
    expect(activity).toMatch(/\n {4}private int buttonsDown;\n/);
  });

  it('judges the pad by its device too: a generic pad’s buttons carry the keyboard source alone', () => {
    // Measured on the owner's tablet, 2026-10-30: the Twin USB receiver (KEYBOARD | JOYSTICK)
    // raised BTN_TOP and the rest as key events whose own source was plain KEYBOARD, and
    // forwarding on the event's source alone dropped every press.
    const page = newActivity();
    expect(
      page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_DOWN, { device: GENERIC_PAD })),
    ).toBe(true);
    expect(page.sent).toEqual([[4, true]]);
  });

  it('runs sourcesOf over a stub event: a device with a joystick, a device with none, and none (#1893)', () => {
    const { sourcesOf } = program(NO_HOST);
    expect(sourcesOf(keyEvent(KEYCODE_BUTTON_1, ACTION_DOWN, { device: SOURCE_JOYSTICK }))).toBe(
      SOURCE_KEYBOARD | SOURCE_JOYSTICK,
    );
    expect(sourcesOf(keyEvent(KEYCODE_BUTTON_1, ACTION_DOWN, { device: 0 }))).toBe(SOURCE_KEYBOARD);
    expect(sourcesOf(keyEvent(KEYCODE_BUTTON_1, ACTION_DOWN, { device: null }))).toBe(
      SOURCE_KEYBOARD,
    );
    expect(
      sourcesOf(keyEvent(KEYCODE_BUTTON_1, ACTION_DOWN, { source: SOURCE_GAMEPAD, device: null })),
    ).toBe(SOURCE_GAMEPAD);
  });

  it('sends a first press as down and a release as up, and a held button’s repeats not at all', () => {
    const page = newActivity();
    const code = KEYCODE_BUTTON_1 + 1;
    expect(page.dispatch(keyEvent(code, ACTION_DOWN))).toBe(true);
    expect(page.dispatch(keyEvent(code, ACTION_DOWN, { repeat: 1 }))).toBe(true);
    expect(page.dispatch(keyEvent(code, ACTION_DOWN, { repeat: 7 }))).toBe(true);
    expect(page.dispatch(keyEvent(code, ACTION_UP))).toBe(true);
    expect(page.sent).toEqual([
      [2, true],
      [2, false],
    ]);
    expect(page.toSuper()).toBe(0);
  });

  it('sends a held button’s release when its pad is unplugged and getDevice() finds nothing (#1893)', () => {
    const page = newActivity();
    page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_DOWN));
    page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 1, ACTION_DOWN));
    // Android's cancelled releases, from a device it no longer lists: the event's source is plain KEYBOARD.
    expect(page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_UP, { device: null }))).toBe(true);
    expect(page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 1, ACTION_UP, { device: 0 }))).toBe(true);
    expect(page.sent).toEqual([
      [4, true],
      [2, true],
      [4, false],
      [2, false],
    ]);
    expect(page.toSuper()).toBe(0);
  });

  it('leaves a numbered release it never sent down, from no pad, on its existing path (#1893)', () => {
    const page = newActivity();
    expect(page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_UP, { device: null }))).toBe(false);
    // Sent down and up once: a second release from no pad is not the page's either.
    page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_DOWN));
    page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_UP));
    expect(page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_UP, { device: null }))).toBe(false);
    // Nor a press from no pad, though that button was sent down before.
    expect(page.dispatch(keyEvent(KEYCODE_BUTTON_1 + 3, ACTION_DOWN, { device: null }))).toBe(
      false,
    );
    expect(page.sent).toEqual([
      [4, true],
      [4, false],
    ]);
    expect(page.toSuper()).toBe(3);
  });

  it('remembers the buttons each activity sent down, not another’s (#1893)', () => {
    const first = newActivity();
    const second = newActivity();
    first.dispatch(keyEvent(KEYCODE_BUTTON_1, ACTION_DOWN));
    expect(second.dispatch(keyEvent(KEYCODE_BUTTON_1, ACTION_UP, { device: null }))).toBe(false);
    expect(first.dispatch(keyEvent(KEYCODE_BUTTON_1, ACTION_UP, { device: null }))).toBe(true);
  });

  it('asks no device of any key but KEYCODE_BUTTON_1 to 16, and passes every one to super (#1893)', () => {
    let checked = 0;
    for (let code = 0; code <= 400; code += 1) {
      const numbered = code >= KEYCODE_BUTTON_1 && code < KEYCODE_BUTTON_1 + FORWARDED_BUTTONS;
      for (const source of [SOURCE_KEYBOARD, XBOX_PAD, GENERIC_PAD]) {
        for (const action of [ACTION_DOWN, ACTION_UP]) {
          const page = newActivity();
          const event = keyEvent(code, action, { source });
          const consumed = page.dispatch(event);
          if (numbered) {
            // Non-vacuity: a numbered code is judged by its device.
            expect(event.devicesAsked(), `key code ${String(code)}`).toBe(1);
            continue;
          }
          expect(event.devicesAsked(), `key code ${String(code)}`).toBe(0);
          expect(consumed).toBe(false);
          expect(page.toSuper()).toBe(1);
          expect(page.sent).toEqual([]);
          checked += 1;
        }
      }
    }
    expect(checked).toBe((401 - FORWARDED_BUTTONS) * 6);
    for (const code of [KEYCODE_VOLUME_UP, KEYCODE_VOLUME_DOWN, KEYCODE_A, KEYCODE_BUTTON_A]) {
      expect(code < KEYCODE_BUTTON_1 || code >= KEYCODE_BUTTON_1 + FORWARDED_BUTTONS).toBe(true);
    }
  });

  it('passes a numbered button to super while there is no WebView to send it to', () => {
    const page = newActivity({ webView: false });
    expect(page.dispatch(keyEvent(KEYCODE_BUTTON_1, ACTION_DOWN))).toBe(false);
    expect(page.sent).toEqual([]);
    expect(page.toSuper()).toBe(1);
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
