// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The names the Devices harness's scripted devices advertise — #659.
 *
 * A module of its own because `devices.browser.spec.ts` runs in Node under
 * Playwright's transform, and importing them from `devices-harness.tsx` would
 * pull the whole client, its stylesheet and its model files into that
 * process. Both halves read them from here, so they cannot disagree.
 */

export const TRAINER_NAME = 'KICKR 1F2A';
export const STRAP_NAME = 'HRM 04B1';
