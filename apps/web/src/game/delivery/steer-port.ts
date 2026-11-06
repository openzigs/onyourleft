// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HUD's steering keys hand a Delivery round — #1820.
 *
 * The port is `../steer-port.ts`', lifted out of this file by #1901 so a lap
 * race takes lane changes through the same one; this re-exports it, so
 * Delivery and its tests read it where they always did. Its one method, and
 * why it has only one, are documented there.
 */

export type { SteerInputPort } from '../steer-port';
