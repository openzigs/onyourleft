// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The YouTube feature tour's words — #3074. `demo:video -- --preset youtube`
 * renders it; `docs/demo-video.md` says how.
 *
 * ⚠️ **Every line is a claim the product makes on the day of the render.** Edit
 * the words freely; `caption-claims.ts` (run by `pnpm run test` and by
 * `demo:video:check`) refuses:
 *
 * - a caption naming a `feature` its scene does not show: `climb` is checked
 *   by riding the scene, `group` needs two riders or more in the camera's
 *   frame for the caption's whole time, and `map-data` a
 *   scene marked `route: true` (and the page draws it only when the render was
 *   given a baked route);
 * - a load-metric trademark, a competitor's name, or "validated", "accurate
 *   to" or "professional fit" (CLAUDE.md section 6, ADR 0030 R6);
 * - captions that overlap, or sit less than a second apart, in one scene, or
 *   run past its end, or stay up for under three seconds.
 *
 * Times are seconds from the scene's start. Each scene is a preset
 * (`src/demo/presets.ts`) ridden from its start; the video ends on the closing
 * card, with the project's address, and the map credit when a scene rode a
 * baked route.
 */

import type { CaptionScript } from '../../src/demo/caption-script';

export const YOUTUBE_CAPTIONS: CaptionScript = {
  id: 'youtube',
  scenes: [
    {
      id: 'opening',
      preset: 'climb',
      seconds: 20,
      route: true,
      captions: [
        {
          at: 0.5,
          seconds: 6,
          placement: 'title',
          text: 'On Your Left — free, open-source indoor and outdoor cycling',
        },
        {
          at: 8,
          seconds: 7,
          text: 'Ride your own routes as a 3D world, built from OpenStreetMap',
          feature: 'map-data',
        },
      ],
    },
    {
      id: 'hill',
      preset: 'hill',
      seconds: 20,
      captions: [
        {
          at: 4,
          seconds: 7,
          text: 'Controls your smart trainer over Bluetooth: feel every climb',
          feature: 'climb',
        },
        // Waits for the junction pop-up and the stable scenery to merge, and
        // for a scene that shows a junction:
        // { at: 13, seconds: 6, text: 'Open world: pick your turn at every junction' },
      ],
    },
    {
      id: 'group',
      preset: 'group',
      seconds: 41,
      captions: [
        // No demo scene shows a bot or a pacer yet (the demo's HUD has no
        // pacer line), so these wait for one:
        // { at: 2, seconds: 6, text: 'Race bots, or ride with a pacer that reads the road' },
        // No demo scene shows Delivery yet:
        // { at: 9.5, seconds: 6, text: 'Delivery: a game mode where you throw parcels on your round' },
        {
          at: 18,
          seconds: 8,
          text: 'No subscription. Your rides stay on your device; self-hosting is optional',
        },
        // The roadside shot, from 37 s, is the one that frames all four riders.
        { at: 37, seconds: 3.5, text: 'Ride as a group', feature: 'group' },
      ],
    },
  ],
};
