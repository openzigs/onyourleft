// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The harness's own suite, for the one assertion the whole keyboard story rests
 * on.
 *
 * `activateWithKeyboard` is what turns "the control works" into "the control
 * works for someone who cannot use a pointer". If its focus check were ever
 * loosened — or if `focus()` silently did nothing, which is what happens on a
 * detached node — every keyboard test in this package would go on passing over
 * controls no keyboard can reach. So the refusal is tested directly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateWithKeyboard, mount, queryAll, type Mounted } from './mount';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('activateWithKeyboard', () => {
  it('refuses a control a keyboard cannot reach, naming it', async () => {
    const onClick = vi.fn();
    mounted = await mount(
      // A div with a click handler: works with a mouse, invisible to a
      // keyboard, and the exact shape #48 exists to stop shipping.
      <div role="button" onClick={onClick}>
        Pair a sensor
      </div>,
    );
    const target = mounted.container.querySelector<HTMLElement>('[role="button"]');

    await expect(activateWithKeyboard(target as HTMLElement)).rejects.toThrow(
      /not reachable by keyboard/,
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it('activates a control a keyboard can reach', async () => {
    const onClick = vi.fn();
    mounted = await mount(
      <button type="button" onClick={onClick}>
        Pair a sensor
      </button>,
    );
    await activateWithKeyboard(mounted.container.querySelector('button') as HTMLButtonElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('mount', () => {
  it('attaches to the document, because a detached node cannot take focus', async () => {
    mounted = await mount(<button type="button">Start</button>);
    const button = mounted.container.querySelector('button');
    button?.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe('queryAll', () => {
  it('returns an array rather than a live NodeList', async () => {
    mounted = await mount(
      <ul>
        <li>a</li>
        <li>b</li>
      </ul>,
    );
    expect(queryAll(mounted.container, 'li').map((li) => li.textContent)).toEqual(['a', 'b']);
  });
});
