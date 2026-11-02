// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether this browser says it is online, and keeps saying so as that changes
 * (#2003).
 *
 * A saved route's map is drawn from the basemap archive over the network, and
 * ADR 0024 D-2 does not precache it, so offline the map would be the route's
 * line on a plain box. `MapPanel.tsx` says the map is unavailable instead, and
 * this is what tells it: `navigator.onLine` when the page opens, and the
 * window's `online` and `offline` events after that, so the map is drawn the
 * moment the device is back.
 *
 * ⚠️ **`false` is trustworthy and `true` is not.** A browser that says it is
 * offline has no network; one that says it is online may still reach nothing
 * (a captive portal, a dead router), and the Android shell's WebView reports
 * `true` with no network at all (`game/realistic-assets.ts` §`worldNotice`,
 * validation 0002 Part P). In those cases the map is drawn and its streets do
 * not arrive — the line on a plain box this hook exists to avoid, and no worse
 * than a ride's page.
 */

import { useEffect, useState } from 'react';

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** `true` unless the browser says it is offline. Follows the window's `online` and `offline` events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline);
  useEffect(() => {
    const update = (): void => {
      setOnline(isOnline());
    };
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
