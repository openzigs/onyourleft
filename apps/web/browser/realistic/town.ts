// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page's mapped town, planned as `GameView`'s press
 * plans a ride's corridor — #1581 — with the levers that change its plans
 * read here, at load: since #1634 `urban-class` and since #1660
 * `split-roofs`. Its own module so that a test reads the plans the page
 * draws, and a lever parsed but not handed to the planner is a red test
 * (`town.test.ts`).
 */

import {
  FOOTPRINT_MAX_VERTICES,
  footprintPlans,
  type FootprintPlan,
} from '../../src/game/footprint-buildings';
import { landClassMask, type LandClassMask } from '../../src/game/land-class';
import type { CorridorOrigin } from '../../src/game/terrain';
import { NO_URBAN_CLASS, urbanClassMap } from '../../src/game/urban-class';
import type { WorldCorridor } from '../../src/game/world-data/corridor';
import type { RouteProfile } from '@onyourleft/domain';

import { splitRoofsWithLevers, urbanClassWithLevers, type Lever } from './config';

/** A town's corridor, on its own road. */
export interface TownFixture {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly corridor: WorldCorridor;
}

/** The town's land-class mask and its plans, with `leversOff` switched off. */
export function plannedTown(
  town: TownFixture,
  leversOff: readonly Lever[],
): { readonly land: LandClassMask; readonly plans: readonly FootprintPlan[] } {
  const land = landClassMask(town.corridor);
  // #1634: its urban class, as the press builds it, unless the lever is off.
  const urban = urbanClassWithLevers(leversOff)
    ? urbanClassMap(town.corridor, land, town.profile)
    : NO_URBAN_CLASS;
  const { plans } = footprintPlans(
    town.corridor,
    land,
    town.profile,
    town.origin,
    FOOTPRINT_MAX_VERTICES,
    urban,
    // #1660: the L-, T-, U- and Z-shaped houses' split roofs, unless the lever is off.
    { splitRoofs: splitRoofsWithLevers(leversOff) },
  );
  return { land, plans };
}
