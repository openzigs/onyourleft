// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which of the showcase's features this build has — #1653.
 *
 * Each is there when the module that provides it is, read through an export
 * only that feature's module has: the season clock's `seasonOn` (#1622), which
 * `stage.ts` tells the view the season with, the people's `PEOPLE_NEAR_MAX`
 * (#1541), and the countryside's `countrysideWithout` (#1542), the one reader
 * of the levers `player.ts` switches. A namespace import, so that a test that
 * mocks a module without its export (`showcase.test.ts`) reads `undefined`
 * here and the timeline skips its cues rather than drawing a stand-in. A real
 * build without an export would not bundle at all: `stage.ts` named-imports
 * `seasonOn` and `parseCalendarDay`.
 *
 * This says what the BUILD has. Whether a run can draw a feature — the
 * realistic world loaded, map data given — is `stage.ts`' to add.
 */

import * as countryside from '../game/land-class';
import * as people from '../game/people';
import * as season from '../game/season';
import type { ShowcaseFeature } from './showcase';

/** The features this build has, each read from its module. The realistic world is the renderer's. */
export function featuresInBuild(): ReadonlySet<ShowcaseFeature> {
  const has = new Set<ShowcaseFeature>(['realistic']);
  if (typeof (season as Partial<typeof season>).seasonOn === 'function') has.add('season');
  if (typeof (people as Partial<typeof people>).PEOPLE_NEAR_MAX === 'number') has.add('people');
  if (typeof (countryside as Partial<typeof countryside>).countrysideWithout === 'function') {
    has.add('countryside');
  }
  return has;
}
