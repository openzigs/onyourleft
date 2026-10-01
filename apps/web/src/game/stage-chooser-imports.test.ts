// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the pre-ride chooser imports — #940.
 *
 * The chooser is in the `ride` lazy chunk (#674) and runs before any ride:
 * it must not pull the renderer, three.js or the map in with it, and the
 * route shapes it draws come from the profiles it already holds, so there is
 * nothing to fetch. `GameView.tsx` loads the renderer through a loader prop for
 * exactly this reason; the chooser's own module is the one this walks, so a
 * static import of either from it — or from anything it imports — is red here.
 * `privacy/no-network.test.ts` is the network half, unchanged.
 */

import { describe, expect, it } from 'vitest';

import { importWalk } from '../camera/import-walk-testing';

describe('#940 — what the chooser imports', () => {
  it('reaches no renderer, no map and no three.js', () => {
    const closure = importWalk().closure(['game/StageChooser.tsx']);
    const reached = [...closure.modules];
    // The walk itself, held: it read the chooser and what the cards draw with.
    expect(reached).toContain('game/StageChooser.tsx');
    expect(reached).toContain('design/illustration/ProfileShape.tsx');
    for (const path of reached) {
      expect(path, (closure.chainTo(path) ?? []).join(' → ')).not.toMatch(
        /^game\/three-renderer\.ts$|^map\/|^game\/GameView\.tsx$/,
      );
    }
    for (const bare of closure.bare) {
      expect(bare).not.toMatch(/^three(\/|$)|^maplibre-gl$|^pmtiles$/);
    }
  });
});
