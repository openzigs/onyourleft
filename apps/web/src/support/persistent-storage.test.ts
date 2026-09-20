// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetPersistenceRequest,
  readPersistence,
  requestPersistence,
  requestPersistenceOnce,
  type StorageManagerLike,
} from './persistent-storage';

beforeEach(() => {
  forgetPersistenceRequest();
});

function storage(options: {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}): StorageManagerLike {
  return options;
}

describe('reading whether this origin is persistent', () => {
  it('reports persistent when the browser says so', async () => {
    await expect(
      readPersistence(storage({ persisted: () => Promise.resolve(true) })),
    ).resolves.toBe('persistent');
  });

  it('reports best-effort when it does not', async () => {
    await expect(
      readPersistence(storage({ persisted: () => Promise.resolve(false) })),
    ).resolves.toBe('best-effort');
  });

  it('reports unsupported where there is no Storage API at all', async () => {
    await expect(readPersistence(undefined)).resolves.toBe('unsupported');
  });

  it('reports unsupported where the object is there and the method is not', async () => {
    await expect(readPersistence(storage({}))).resolves.toBe('unsupported');
  });

  it('treats a throwing probe as unsupported rather than as a failure', async () => {
    // `readAvailability`'s posture (#40): a browser that exposes the object and
    // refuses the call is telling us it does not have the feature, in the only
    // way it can. The app must be fully usable afterwards, so this resolves.
    await expect(
      readPersistence(
        storage({
          persisted: () => {
            throw new Error('not implemented');
          },
        }),
      ),
    ).resolves.toBe('unsupported');
  });
});

describe('asking for persistence', () => {
  it('asks, and reports the grant', async () => {
    let asked = 0;
    const state = await requestPersistence(
      storage({
        persisted: () => Promise.resolve(false),
        persist: () => {
          asked += 1;
          return Promise.resolve(true);
        },
      }),
    );
    expect(state).toBe('persistent');
    expect(asked).toBe(1);
  });

  it('does not ask when the answer is already yes', async () => {
    // Asking when it is already granted is a prompt some browsers show a rider
    // for no reason at all.
    let asked = 0;
    const state = await requestPersistence(
      storage({
        persisted: () => Promise.resolve(true),
        persist: () => {
          asked += 1;
          return Promise.resolve(true);
        },
      }),
    );
    expect(state).toBe('persistent');
    expect(asked).toBe(0);
  });

  it('handles a refusal without throwing', async () => {
    await expect(
      requestPersistence(
        storage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) }),
      ),
    ).resolves.toBe('best-effort');
  });

  it('handles a `persist` that rejects', async () => {
    await expect(
      requestPersistence(
        storage({
          persisted: () => Promise.resolve(false),
          persist: () => Promise.reject(new Error('denied')),
        }),
      ),
    ).resolves.toBe('best-effort');
  });

  it('asks nothing where the API is absent, and does not reject', async () => {
    await expect(requestPersistence(undefined)).resolves.toBe('unsupported');
  });
});

describe('asking exactly once per session', () => {
  it('makes one request however many callers there are', async () => {
    // ⚠️ #409's first criterion. The documented way to be re-evaluated is to
    // ask again LATER, after the rider has engaged with the site — a caller
    // that asked in a loop would be a caller that never stops being denied.
    let asked = 0;
    const once = storage({
      persisted: () => Promise.resolve(false),
      persist: () => {
        asked += 1;
        return Promise.resolve(false);
      },
    });
    const answers = await Promise.all([
      requestPersistenceOnce(once),
      requestPersistenceOnce(once),
      requestPersistenceOnce(once),
    ]);
    expect(asked).toBe(1);
    expect(answers).toEqual(['best-effort', 'best-effort', 'best-effort']);
  });

  it('shares the request rather than the result, so two racing callers do not both ask', async () => {
    let asked = 0;
    let settle: ((granted: boolean) => void) | undefined;
    const slow = storage({
      persisted: () => Promise.resolve(false),
      persist: () => {
        asked += 1;
        return new Promise<boolean>((resolve) => {
          settle = resolve;
        });
      },
    });
    const first = requestPersistenceOnce(slow);
    const second = requestPersistenceOnce(slow);
    // ⚠️ The memo is on the PROMISE, and this is what says so: the second
    // caller is handed the first one's in-flight request rather than starting
    // its own. Memoising the result instead would let two callers who arrive
    // before the first answer both ask.
    expect(first).toBe(second);
    // Let the `persisted()` read and the `persist()` call both run.
    for (let turn = 0; turn < 10; turn += 1) {
      await Promise.resolve();
    }
    expect(asked).toBe(1);
    settle?.(true);
    await expect(first).resolves.toBe('persistent');
    await expect(second).resolves.toBe('persistent');
  });
});
