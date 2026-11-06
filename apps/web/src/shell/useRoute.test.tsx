// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * How a change of fragment reaches React — #945.
 *
 * jsdom has no View Transition API, so whether a transition RAN is the browser
 * gate's (`browser/motion.browser.spec.ts`). What this pins is the half that
 * decides it: a navigation the caller allows is applied inside
 * `startTransition`, one it refuses is not, and the caller is asked with the
 * route on screen and the route asked for — with the caller's LATEST answer,
 * which is how `AppShell`'s `immersive` reaches a navigation made mid-ride.
 */

import { addTransitionType, startTransition, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';

import type { RouteMatch } from './routes';
import { useRoute, type MayAnimate, type RouteUpdates } from './useRoute';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    startTransition: vi.fn(actual.startTransition),
    addTransitionType: vi.fn(actual.addTransitionType),
  };
});

const transitions = vi.mocked(startTransition);
const types = vi.mocked(addTransitionType);

let shown: string[] = [];
let mounted: Mounted | undefined;

function Probe(props: { mayAnimate?: MayAnimate; updates?: RouteUpdates }): JSX.Element {
  const match = useRoute(props.mayAnimate, props.updates);
  shown.push(match.route.id);
  return <p>{match.route.id}</p>;
}

async function navigate(hash: string): Promise<void> {
  globalThis.location.hash = hash;
  await settle();
}

beforeEach(async () => {
  globalThis.location.hash = '#/';
  // Let the `hashchange` that assignment queued be delivered before anything
  // subscribes, or the first test to mount hears it as a navigation.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  shown = [];
  transitions.mockClear();
  types.mockClear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

describe('useRoute (#945)', () => {
  it('renders the fragment on the first render, not after an effect', async () => {
    globalThis.location.hash = '#/about';
    mounted = await mount(<Probe />);
    expect(shown[0]).toBe('about');
  });

  it('applies an allowed navigation inside startTransition, and asks with both routes', async () => {
    const asked: [string, string][] = [];
    const allow: MayAnimate = (from: RouteMatch, to: RouteMatch) => {
      asked.push([from.route.id, to.route.id]);
      return true;
    };
    mounted = await mount(<Probe mayAnimate={allow} />);
    await navigate('#/activities');
    expect(asked).toEqual([['home', 'activities']]);
    expect(transitions).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toBe('activities');
  });

  it('announces which way each animated navigation goes, inside its transition (#2054)', async () => {
    let inside = false;
    const during: boolean[] = [];
    transitions.mockImplementation((scope) => {
      inside = true;
      try {
        // The router's scope is synchronous; an async action would return a promise.
        void scope();
      } finally {
        inside = false;
      }
    });
    types.mockImplementation(() => {
      during.push(inside);
    });
    try {
      globalThis.location.hash = '#/about';
      mounted = await mount(<Probe mayAnimate={() => true} />);
      await navigate('#/about/credits');
      await navigate('#/about');
      await navigate('#/activities');
      expect(types.mock.calls).toEqual([['oyl-deeper'], ['oyl-back'], ['oyl-across']]);
      // Inside `startTransition`: a type added outside one is dropped by React.
      expect(during).toEqual([true, true, true]);
    } finally {
      transitions.mockRestore();
      types.mockRestore();
    }
  });

  it('applies a refused navigation outside startTransition, and still applies it', async () => {
    mounted = await mount(<Probe mayAnimate={() => false} />);
    await navigate('#/ride');
    expect(transitions).not.toHaveBeenCalled();
    expect(types).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toBe('ride');
  });

  it('asks the caller’s latest answer, so a ride that took the screen is heard', async () => {
    mounted = await mount(<Probe mayAnimate={() => true} />);
    await mounted.rerender(<Probe mayAnimate={() => false} />);
    await navigate('#/activities');
    expect(transitions).not.toHaveBeenCalled();
  });

  it('never uses a transition under the synchronous control, whatever the caller says', async () => {
    mounted = await mount(<Probe mayAnimate={() => true} updates="synchronous" />);
    await navigate('#/activities');
    expect(transitions).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toBe('activities');
  });

  it('applies a change made between the first render and the subscription', async () => {
    function Changer(): JSX.Element {
      const match = useRoute();
      shown.push(match.route.id);
      if (globalThis.location.hash === '#/') {
        // During render, before any effect has subscribed: no `hashchange`
        // this hook could hear.
        history.replaceState(null, '', '#/settings');
      }
      return <p>{match.route.id}</p>;
    }
    mounted = await mount(<Changer />);
    await settle();
    expect(shown[0]).toBe('home');
    expect(mounted.container.textContent).toBe('settings');
  });
});
