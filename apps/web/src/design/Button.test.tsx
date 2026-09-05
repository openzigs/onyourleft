// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateWithKeyboard, mount, type Mounted } from '../testing/mount';

import { Button } from './Button';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('Button', () => {
  it('is a real button element, so a keyboard can operate it', async () => {
    const onClick = vi.fn();
    mounted = await mount(<Button onClick={onClick}>Start a ride</Button>);
    const button = mounted.container.querySelector('button');
    expect(button).not.toBeNull();

    // `activateWithKeyboard` refuses anything it cannot focus first. A `div`
    // with an `onClick` fails here; that is the whole assertion.
    await activateWithKeyboard(button as HTMLButtonElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type="button", not the HTML default of submit', async () => {
    // A type-less button inside a form submits it. With no server that is a
    // page reload that discards whatever was on screen.
    mounted = await mount(<Button>Start</Button>);
    expect(mounted.container.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it('carries a description through aria-describedby when given one', async () => {
    mounted = await mount(
      <>
        <p id="why">Needs a paired sensor first.</p>
        <Button describedBy="why">Start</Button>
      </>,
    );
    expect(mounted.container.querySelector('button')?.getAttribute('aria-describedby')).toBe('why');
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    mounted = await mount(
      <Button onClick={onClick} disabled>
        Start
      </Button>,
    );
    mounted.container.querySelector('button')?.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
