// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The first-paint intro ends once, animated only on a menu route with motion
 * allowed — #2053.
 *
 * jsdom runs no CSS animation, so the element's animations are stood in for
 * on the element itself and finished by the test; whether the intro is still
 * in the document is read back from the document. That the browser runs the
 * keyframes, at most 200 ms each, is `motion.browser.spec.ts` §"#2053".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { endIntro, introAnimates, INTRO_ID, INTRO_LEAVING, type IntroStart } from './intro';

const HOME: IntroStart = { firstRoute: 'home', lessMotion: false, failed: false };

/** A stand-in animation whose `finished` the test settles. */
function animation(): { readonly animation: Animation; readonly finish: () => void } {
  let finish = (): void => undefined;
  const finished = new Promise<Animation>((resolve) => {
    finish = () => {
      resolve({} as Animation);
    };
  });
  return { animation: { finished } as Animation, finish: () => finish() };
}

let intro: HTMLElement;

beforeEach(() => {
  intro = document.createElement('div');
  intro.id = INTRO_ID;
  document.body.append(intro);
});

afterEach(() => {
  intro.remove();
});

const present = (): boolean => document.getElementById(INTRO_ID) !== null;

describe('whether the intro animates (#2053)', () => {
  it('animates on a menu route with motion allowed', () => {
    expect(introAnimates(HOME)).toBe(true);
    expect(introAnimates({ ...HOME, firstRoute: 'activities' })).toBe(true);
  });

  it('never on a ride route', () => {
    expect(introAnimates({ ...HOME, firstRoute: 'ride' })).toBe(false);
    expect(introAnimates({ ...HOME, firstRoute: 'game' })).toBe(false);
  });

  it('never for a rider who asked for less motion, or after a failed render', () => {
    expect(introAnimates({ ...HOME, lessMotion: true })).toBe(false);
    expect(introAnimates({ ...HOME, failed: true })).toBe(false);
  });
});

describe('ending the intro (#2053)', () => {
  it('on Home, starts the way out and removes it only once its animations end', async () => {
    const fade = animation();
    const grow = animation();
    let asked: GetAnimationsOptions | undefined;
    intro.getAnimations = (options) => {
      asked = options;
      // Only once the attribute that starts them is on.
      return intro.getAttribute(INTRO_LEAVING) === 'leaving'
        ? [fade.animation, grow.animation]
        : [];
    };
    endIntro(intro, HOME);
    expect(intro.getAttribute(INTRO_LEAVING)).toBe('leaving');
    expect(asked).toEqual({ subtree: true });
    await Promise.resolve();
    expect(present()).toBe(true);
    fade.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(present()).toBe(true);
    grow.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(present()).toBe(false);
  });

  it('removes it once a cancelled animation settles too', async () => {
    let cancel = (): void => undefined;
    const finished = new Promise<Animation>((_, reject) => {
      cancel = () => {
        reject(new DOMException('cancelled', 'AbortError'));
      };
    });
    intro.getAnimations = () => [{ finished } as Animation];
    endIntro(intro, HOME);
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(present()).toBe(false);
  });

  it('removes it at once when nothing would animate it', () => {
    // jsdom's own: no Web Animations at all.
    endIntro(intro, HOME);
    expect(present()).toBe(false);
  });

  for (const [why, start] of [
    ['a ride route', { ...HOME, firstRoute: 'ride' }],
    ['the game', { ...HOME, firstRoute: 'game' }],
    ['less motion', { ...HOME, lessMotion: true }],
    ['a failed first render', { ...HOME, failed: true }],
  ] as const) {
    it(`removes it at once, with no way out started, for ${why}`, () => {
      let asked = false;
      intro.getAnimations = () => {
        asked = true;
        return [animation().animation];
      };
      endIntro(intro, start);
      expect(present()).toBe(false);
      expect(intro.hasAttribute(INTRO_LEAVING)).toBe(false);
      expect(asked).toBe(false);
    });
  }

  it('does nothing a second time, or with no intro in the page', () => {
    endIntro(intro, { ...HOME, firstRoute: 'ride' });
    expect(present()).toBe(false);
    // Once per cold start: a later call finds it gone and starts nothing.
    endIntro(intro, HOME);
    expect(intro.hasAttribute(INTRO_LEAVING)).toBe(false);
    expect(() => {
      endIntro(null, HOME);
    }).not.toThrow();
  });
});
