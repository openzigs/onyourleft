// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { DRAFT_STORAGE_KEY } from '../routing/draft-storage';
import { ALL_ROUTES } from '../shell/routes';

import { openRoute } from './hierarchy-walk';

describe('openRoute — #864', () => {
  afterEach(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  });

  it('takes the populated fixture’s route draft away when the shell is unmounted', async () => {
    const builder = ALL_ROUTES.find((route) => route.id === 'route-builder');
    if (builder === undefined) throw new Error('the route table has no route builder');
    const mounted = await openRoute(builder, true);
    // The control: the fixture did write it, so its absence below is the unmount's.
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();

    mounted.unmount();

    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });
});
