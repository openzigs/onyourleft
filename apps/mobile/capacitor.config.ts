// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Capacitor configuration for the Android shell (#87).
 *
 * ⚠️ `webDir` points at `apps/web`'s build output rather than at anything this
 * package produces. That is #85's whole premise — the mobile shell wraps *the
 * same web build*, so there is exactly one client and a divergence between the
 * two is impossible rather than merely discouraged. `pnpm --filter
 * @onyourleft/web run build` has to have run before `cap sync` will copy
 * anything, and `cap sync` says so when it has not.
 *
 * ⚠️ The application id is a **provisional** reverse-DNS identifier. Nothing is
 * published under it, no store listing claims it, and it is cheap to change
 * until one does — after that it is permanent, because Android identifies an
 * installed application by this string. Whoever opens the first store listing
 * owns that decision, not this file.
 */
const config = {
  appId: 'dev.openzigs.onyourleft',
  appName: 'On Your Left',
  webDir: '../web/dist',
  android: {
    // The shell is a wrapper around a local-first client: it reads no remote
    // origin (there is no server in Phase 1 — owner decision D6), so cleartext
    // has nothing legitimate to carry. Leaving the platform default explicit
    // is cheaper than rediscovering it from a manifest merge.
    allowMixedContent: false,
  },
};

export default config;
