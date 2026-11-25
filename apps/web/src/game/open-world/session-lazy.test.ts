// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The default loader of the lazy open-world port hands the session the ride's
 * street-name function — PR #3169. The wiring test gives the port its own
 * loader, so this runs the default one over a mocked `./session`.
 */

import { describe, expect, it, vi } from 'vitest';

import { createOpenWorldEntry } from './entry';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';

const created = vi.hoisted(() => vi.fn());
vi.mock('./session', () => ({ createOpenWorldSession: created }));

import { lazyOpenWorldSessions } from './session-lazy';

describe('the lazy port’s default loader — PR #3169', () => {
  it('passes the start and the ride’s street names to the session it creates', async () => {
    created.mockReturnValue({ ready: Promise.resolve({ kind: 'stopped' }), stop: () => undefined });
    const start = fixtureStart(START_COLUMN, START_ROW);
    const streetName = (): string => 'Placeholder Street';
    const sessions = lazyOpenWorldSessions({
      entry: createOpenWorldEntry(),
      basemap: () => undefined,
      mapTilesOn: () => true,
    });
    await sessions.open(start, { streetName }).ready;
    expect(created).toHaveBeenCalledTimes(1);
    const options = created.mock.calls[0]?.[0] as { start: unknown; streetName: unknown };
    expect(options.start).toBe(start);
    expect(options.streetName).toBe(streetName);
  });
});
