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
    // origin (there is no server in Phase 1 — owner decision D6), so the PAGE
    // has nothing legitimate to load over cleartext. Leaving the platform
    // default explicit is cheaper than rediscovering it from a manifest merge.
    //
    // ⚠️ Since #553 the APP does send one thing in cleartext — a picture to
    // the rider's own computer on their network — and it goes through
    // Capacitor's native HTTP, not the WebView, so this stays false: the
    // owner's 2026-09-26 ruling keeps it on everywhere else. The manifest's
    // `usesCleartextTraffic` says what that costs and what limits it.
    allowMixedContent: false,
  },
  plugins: {
    // #2050: the launch splash is held until the page has painted, so a rider
    // never sees the bare canvas between the system splash and Home. The owner
    // chose the official `@capacitor/splash-screen` plugin (pinned 8.0.2) over
    // calling `installSplashScreen` in `MainActivity` by hand.
    //
    // The plugin's keep-on-screen condition is cleared by whichever comes
    // first: the page calling `SplashScreen.hide()` once its first frame has
    // painted (#2051), or `launchShowDuration` passing.
    //
    // ⚠️ `launchAutoHide` is TRUE, which the issue's plugin path wrote as
    // false. In 8.0.2 the duration is only ever applied when auto-hide is on
    // (`SplashScreen.java`, `showWithAndroid12API`): with it off, a page that
    // crashed before it could call `hide()` would hold the splash for ever,
    // which the same issue rules out. With it on, `hide()` still releases the
    // splash early. `launch-splash.test.ts` reads the installed plugin to hold
    // both facts.
    SplashScreen: {
      launchAutoHide: true,
      // 3 s, the issue's proposed bound, counted from the window's first
      // frame: long enough for Home on the tablet, and the most a broken page
      // can hold a rider at the splash.
      launchShowDuration: 3000,
      // #2127: NO exit fade of the plugin's own, and not its implicit 200 ms
      // (`SplashScreenConfig.java`). A positive value makes 8.0.2 register an
      // exit-animation listener, and with one Android copies its splash into
      // the app's own window for the app to fade. The hold cancels that
      // window's drawing, so on a warm start the copy showed before its logo:
      // a near-black frame, then the logo fading over Home. With none, the
      // splash stays in the system's window until Home has drawn, and Android
      // plays its own exit.
      launchFadeOutDuration: 0,
    },
  },
};

export default config;
