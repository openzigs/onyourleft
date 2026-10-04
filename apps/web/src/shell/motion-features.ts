// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Motion's animation features, in a chunk of their own — #1072, ADR 0041 D-2.
 *
 * `ListDetail.tsx` hands `LazyMotion` a function that `import()`s this module,
 * so the features — the bulk of Motion — arrive only once a list–detail route
 * (Activities, Routes or Workouts, themselves a lazily loaded group) has
 * mounted, and never in the entry chunk (`tools/bundle/entry-graph.ts` fails
 * the build if any Motion module reaches it).
 *
 * `domAnimation`, not `domMax`: a card is carried into its detail with
 * transforms Motion animates from keyframes (`ListDetail.tsx` §"Carrying a
 * card into its detail"), not with `layoutId`, so no layout feature is needed.
 */

import { domAnimation } from 'motion/react';

export default domAnimation;
