// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the Camera page asks about the rider's instance, to offer it the
 * side camera's pictures** —
 * [#1106](https://github.com/openzigs/onyourleft/issues/1106).
 *
 * Two questions, and neither sends a picture: which instance this device is
 * signed in to, if any, and — only on a press — which hosted service the
 * rider's own key there is for, so that the consent to send pictures on can
 * NAME it (the owner's ruling 3). The switches themselves are stored on this
 * device (`instance-pose.ts`); nothing here stores anything.
 *
 * ## Why a `*-port.ts`, and the names
 *
 * docs/agents/wiring-gate.md §4j: `check:wiring` watches every `*-port.ts`,
 * so a method here that no production code calls is a red `WIRE003`. The
 * names are distinctive for `camera-port.ts`' measured reason.
 */

import type { HostedKeyService } from '../instance/hosted-service';

/** Which hosted service a picture could be sent on to: the one the rider's own key is for. */
export type HostedPictureService = HostedKeyService;

/** What `views/SideInstancePictures.tsx` reads. */
export interface SideInstancePicturesPort {
  /**
   * The origin of the instance this device is signed in to, or `undefined`
   * for none. Read as the page draws; sends nothing. What the rider agrees to
   * is stored against it (`instance-pose.ts` §`SIDE_INSTANCE_STORAGE_KEY`).
   */
  sideInstanceOrigin(): string | undefined;
  /**
   * Ask the instance, sealed, which hosted service the rider's own key is for.
   * ⚠️ Only on a press: opening the Camera page sends nothing.
   */
  askHostedPictureService(): Promise<HostedPictureService>;
}
