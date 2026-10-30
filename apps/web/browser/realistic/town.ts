// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page's mapped town, planned as `GameView`'s press
 * plans a ride's corridor — #1581 — with the levers that change its plans
 * read here, at load: since #1634 `urban-class`, since #1660
 * `split-roofs`, since #1782 `house-archetypes`, since #1785
 * `roof-variants`, since #1786 `dormer-variants` and since #1784
 * `archetype-porches`. Its own module so that a test reads the plans the page
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
import { NO_URBAN_CLASS, urbanClassMap, type UrbanClassMap } from '../../src/game/urban-class';
import type { WorldCorridor } from '../../src/game/world-data/corridor';
import type { RouteProfile } from '@onyourleft/domain';

import {
  archetypePorchesWithLevers,
  dormerVariantsWithLevers,
  houseArchetypesWithLevers,
  roofVariantsWithLevers,
  splitRoofsWithLevers,
  urbanClassWithLevers,
  type Lever,
} from './config';

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
): {
  readonly land: LandClassMask;
  readonly plans: readonly FootprintPlan[];
  /** #1637: the urban class the plans were built with, which the lots and streets read. */
  readonly urban: UrbanClassMap;
} {
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
    // #1660: the L-, T-, U- and Z-shaped houses' split roofs, #1782: the houses'
    // archetypes, #1785: their roof variants, #1786: their dormers, and #1784: their
    // porches and eaves, unless their lever is off.
    {
      splitRoofs: splitRoofsWithLevers(leversOff),
      houseArchetypes: houseArchetypesWithLevers(leversOff),
      roofVariants: roofVariantsWithLevers(leversOff),
      dormerVariants: dormerVariantsWithLevers(leversOff),
      archetypePorches: archetypePorchesWithLevers(leversOff),
    },
  );
  return { land, plans, urban };
}
