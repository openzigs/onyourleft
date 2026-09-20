// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  registerServiceWorker,
  type ServiceWorkerContainerLike,
  type ServiceWorkerRegistrationLike,
} from './register';

function registration(): ServiceWorkerRegistrationLike {
  return {
    installing: null,
    waiting: null,
    active: null,
    addEventListener: () => undefined,
  };
}

/**
 * A container whose `register` records what it was asked for.
 *
 * Typed as the real interface and spied on separately, because
 * `vi.fn`'s own type is a callable-and-constructable union that does not
 * satisfy a plain function signature.
 */
function container(): {
  container: ServiceWorkerContainerLike;
  calls: { script: string; scope: string | undefined }[];
} {
  const calls: { script: string; scope: string | undefined }[] = [];
  return {
    container: {
      register: (script, options) => {
        calls.push({ script, scope: options?.scope });
        return Promise.resolve(registration());
      },
    },
    calls,
  };
}

const REQUEST = { script: '/sw.js', scope: '/' } as const;

describe('whether a worker is registered at all', () => {
  it('registers in a browser, once, at the build’s own base path', async () => {
    const browser = container();
    const outcome = await registerServiceWorker({
      ...REQUEST,
      container: browser.container,
      nativeShell: false,
    });
    expect(outcome.kind).toBe('registered');
    expect(browser.calls).toEqual([{ script: '/sw.js', scope: '/' }]);
  });

  it('registers NOTHING inside the Android shell — ADR 0024 D-4', async () => {
    // ⚠️ `cap sync` copies `apps/web/dist` into the APK, so every asset is
    // already local there and a worker would put a cache in front of files
    // that cannot be fetched over a network anyway. Worse than redundant: an
    // APK update replaces the asset tree while a registered worker would still
    // hold the previous build under the same origin, which is D-3's failure
    // mode by a route D-3's rider-gestured reload cannot reach.
    const shell = container();
    const outcome = await registerServiceWorker({
      ...REQUEST,
      container: shell.container,
      nativeShell: true,
    });
    expect(outcome).toEqual({ kind: 'native-shell' });
    expect(shell.calls).toEqual([]);
  });

  it('says so, rather than throwing, where the browser has no serviceWorker', async () => {
    // A private window, plain HTTP, an engine without one. The client works
    // perfectly well with no worker — that is what shipped until this epic.
    const outcome = await registerServiceWorker({
      ...REQUEST,
      container: undefined,
      nativeShell: false,
    });
    expect(outcome).toEqual({ kind: 'unsupported' });
  });

  it('survives a browser that has one and refuses this registration', async () => {
    const refusing = {
      register: () => Promise.reject(new Error('The document is in an invalid state')),
    } as unknown as ServiceWorkerContainerLike;
    const outcome = await registerServiceWorker({
      ...REQUEST,
      container: refusing,
      nativeShell: false,
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'The document is in an invalid state' });
  });

  it('survives a rejection that is not an Error', async () => {
    // A browser is entitled to reject with a `DOMException` or with a bare
    // string, and this branch exists because the `reason: 'unknown'` fallback
    // in `register.ts` would otherwise be unreachable.
    const odd = {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of the case
      register: () => Promise.reject('nope'),
    } as unknown as ServiceWorkerContainerLike;
    await expect(
      registerServiceWorker({ ...REQUEST, container: odd, nativeShell: false }),
    ).resolves.toEqual({ kind: 'failed', reason: 'unknown' });
  });
});
