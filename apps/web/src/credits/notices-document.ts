// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The whole third-party notices document, read inside the app** — #664.
 *
 * The Credits screen used to link the document at
 * `notices.ts` §`THIRD_PARTY_NOTICES_URL` with `target="_blank"`. In a
 * browser that is a new tab. ⚠️ **Inside the Android shell it was a trap**,
 * read off Capacitor 8.5.2's own source: its WebView does not support a
 * second window (`Bridge.java` never turns on `setSupportMultipleWindows`
 * and implements no `onCreateWindow`), so the link loads the `.txt` over the
 * app in the ONE WebView; `Bridge.launchIntent` keeps a same-origin URL
 * there. The plain-text page has no `window.__oylAndroidBack`, so
 * `MainActivity`'s back callback reaches Android's default and the rider
 * leaves the app — and comes back to the text, with no way to the app's own
 * screens but closing it.
 *
 * So the screen renders the document itself, and this is how it reads it: a
 * dynamic `import()` of the committed file, so the bundler writes it into a
 * chunk of its own that is downloaded only when a rider asks for it, is
 * precached like every other chunk (`tools/precache/precache.ts`), and ships
 * inside the APK. Not a `fetch`: `privacy/no-network.test.ts` admits exactly
 * one module for that, and reading a file this app already carries is not a
 * reason for a second.
 *
 * ⚠️ **The file it imports is the one `check:notices` holds** — the same
 * committed `public/licences/third-party.txt` that is still served at
 * `notices.ts` §`THIRD_PARTY_NOTICES_URL` for a browser, the demo page and anybody
 * who wants the file — so there is one document, and nothing here can drift
 * from it. `notices-document.test.ts` reads both back and compares them.
 */

/** The document, verbatim, as the generator wrote it. */
export async function loadNoticesDocument(): Promise<string> {
  const module = await import('../../public/licences/third-party.txt?raw');
  return module.default;
}
