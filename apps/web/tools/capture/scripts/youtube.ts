// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo video's words and scenes — #3156, epic #3151.
 *
 * ```sh
 * pnpm --filter @onyourleft/web run capture -- --script youtube \
 *   --start <lat>,<lon> --archive /path/to/basemap.pmtiles
 * ```
 *
 * renders the whole video as one MP4, with an `.srt` of every caption and a
 * chapter list beside it (`docs/demo-video.md` §"The scene script").
 *
 * ⚠️ **Every line is a claim the product makes on the day of the render, and
 * the owner approves every line before the final render** (as on #3084).
 * Edit the words freely; `video-script.ts` §`scriptProblems` (run by
 * `pnpm run test` and by `capture` before it renders a frame) refuses:
 *
 * - a caption claiming a feature (`delivery`, `lap-race`, `workout`,
 *   `junction`, `pacer`, `instance`) its scene does not ride, and a callout
 *   to a panel only such a scene draws;
 * - a load-metric trademark, a competitor's name, or "validated", "accurate
 *   to" or "professional fit" (CLAUDE.md section 6, ADR 0030 R6);
 * - a caption up for under 3 or over 6 seconds, run past its scene, or less
 *   than a second from the next; a scene under 6 seconds; a chapter under 10.
 *
 * A scene is a capture scene (`src/game/capture-scene.ts`) ridden from its
 * start, written from `from` seconds in. Times are seconds from the scene's
 * first frame. A `callout` names the HUD panel it explains
 * (`video-script.ts` §`CALLOUT_PANELS`) and is drawn beside it with a leader
 * line, wherever the panel is at the frame's size; every caption keeps clear
 * of the panel it explains and of the map credit, or the render stops.
 *
 * The epic's scenes 9 (group ride) and 11 (after the ride, the AI write-up)
 * need a self-hosted instance and come from #3155, which the owner holds;
 * they are left out here, where the comments mark them.
 */

import type { VideoScript } from '../video-script';

export const YOUTUBE_SCRIPT: VideoScript = {
  id: 'youtube',
  scenes: [
    // 1. Cold open: the world at speed, then the title.
    {
      id: 'opening',
      chapter: 'On Your Left',
      capture: 'route-hud',
      from: 4,
      seconds: 10,
      captions: [
        {
          at: 1,
          seconds: 6,
          placement: 'title',
          text: 'On Your Left — free, open-source indoor and outdoor cycling',
        },
      ],
    },
    // 2. The HUD, one panel at a time.
    {
      id: 'hud',
      chapter: 'The HUD',
      capture: 'route-hud',
      from: 14,
      seconds: 31,
      captions: [
        {
          at: 1,
          seconds: 5,
          callout: 'readings',
          text: 'Power, cadence and heart rate, live from your sensors',
        },
        { at: 7, seconds: 5, callout: 'gradient', text: 'The gradient under your wheels' },
        {
          at: 13,
          seconds: 5,
          callout: 'elevation',
          text: 'The climb profile ahead, and how far along the route you are',
        },
        { at: 19, seconds: 5, callout: 'map', text: 'The whole route, and where you are on it' },
        {
          at: 25,
          seconds: 5,
          callout: 'calories',
          text: 'Ride totals, with calories estimated from your power',
        },
      ],
    },
    // 3. Smart trainer.
    {
      id: 'trainer',
      chapter: 'Smart trainer',
      capture: 'route-hud',
      from: 60,
      seconds: 12,
      captions: [
        {
          at: 2,
          seconds: 6,
          callout: 'gradient',
          text: 'Controls your smart trainer over Bluetooth: feel every climb',
        },
      ],
    },
    // 4. Workouts.
    {
      id: 'workout',
      chapter: 'Workouts',
      capture: 'workout',
      from: 4,
      seconds: 14,
      captions: [
        {
          at: 1,
          seconds: 6,
          callout: 'workout',
          text: 'Structured workouts: tailor the length and intensity',
        },
        {
          at: 8,
          seconds: 5,
          feature: 'workout',
          text: 'The trainer holds each target power for you',
        },
      ],
    },
    // 5. Pacer and ghost.
    {
      id: 'pacer',
      chapter: 'Pacer and ghost',
      capture: 'pacer',
      from: 3,
      seconds: 14,
      captions: [
        { at: 1, seconds: 5, callout: 'pacer', text: 'Ride with a pacer at the effort you choose' },
        { at: 7, seconds: 5, callout: 'best', text: 'Or race your own best ride' },
      ],
    },
    // 6. Free ride.
    {
      id: 'free-ride',
      chapter: 'Free ride',
      capture: 'free-ride',
      seconds: 16,
      captions: [
        {
          at: 3,
          seconds: 6,
          feature: 'junction',
          text: 'Open world: pick your turn at every junction',
        },
        { at: 10, seconds: 5, text: 'Real streets, built from OpenStreetMap data' },
      ],
    },
    // 7. Delivery.
    {
      id: 'delivery',
      chapter: 'Delivery',
      capture: 'delivery',
      seconds: 16,
      captions: [
        {
          at: 1,
          seconds: 6,
          callout: 'throw',
          text: 'Delivery: throw a parcel to each house on your round',
        },
        { at: 9, seconds: 5, callout: 'houses', text: 'Houses left, the next one, and your score' },
      ],
    },
    // 8. Lap race.
    {
      id: 'lap-race',
      chapter: 'Lap race',
      capture: 'lap-race',
      from: 12,
      seconds: 16,
      captions: [
        {
          at: 1,
          seconds: 6,
          callout: 'standings',
          text: 'Lap races on built-in circuits, against bots',
        },
        { at: 9, seconds: 5, callout: 'item', text: 'Pick up items around the lap, and use them' },
      ],
    },
    // 9. Group ride: needs an instance, #3155.
    // 10. Worlds.
    {
      id: 'worlds',
      chapter: 'Worlds',
      capture: 'route-hud',
      from: 120,
      seconds: 10,
      captions: [
        {
          at: 2,
          seconds: 6,
          text: 'Any route you import becomes a world to ride, drawn on your device',
        },
      ],
    },
    // 11. After the ride, the AI write-up: needs an instance, #3155.
    // 12. Closing card.
    {
      id: 'closing',
      chapter: 'Free and open',
      capture: 'route-hud',
      seconds: 12,
      captions: [
        {
          at: 0.5,
          seconds: 4.5,
          text: 'No subscription. Your rides are kept on your device; self-hosting is optional',
        },
        {
          at: 6,
          seconds: 6,
          placement: 'card',
          text: 'Free and open source',
        },
      ],
    },
  ],
};
