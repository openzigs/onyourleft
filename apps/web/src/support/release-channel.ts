// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which channel this copy of the Android app came from — #1745.
 *
 * The app reaches riders two ways: Google Play, from the App Bundle, and the
 * direct download, the APK attached to a GitHub Release. Play re-signs what it
 * serves with Google's app signing key and the APK is signed with the upload
 * key, so **the two cannot update each other**, and moving between them means
 * uninstalling — which deletes the rides on the device
 * (`apps/mobile/RELEASE.md` §11). A rider can only act on that if the app says
 * which one they have.
 *
 * ⚠️ **Read from the build, never typed.** `.github/workflows/release.yml`
 * builds the web client once per channel with `VITE_OYL_RELEASE_CHANNEL` set,
 * and packages the `direct` build into the APK and the `play` build into the
 * App Bundle. A build that sets nothing — a browser deployment, `cap run` on a
 * developer's machine — reads as `undefined`, and the About page says so rather
 * than guessing.
 */

export type ReleaseChannel = 'play' | 'direct';

/** The bundler environment this reads, named so a test can supply it. */
export interface ReleaseChannelEnvironment {
  readonly VITE_OYL_RELEASE_CHANNEL?: string | undefined;
}

/**
 * The channel a build was made for. Anything but the two names reads as none,
 * so a misspelt value in the workflow says "not a release" rather than
 * claiming a channel.
 */
export function readReleaseChannel(
  environment: ReleaseChannelEnvironment,
): ReleaseChannel | undefined {
  const value = environment.VITE_OYL_RELEASE_CHANNEL?.trim();
  return value === 'play' || value === 'direct' ? value : undefined;
}

/** Read the real bundler environment. */
export function buildReleaseChannel(): ReleaseChannel | undefined {
  return readReleaseChannel({
    VITE_OYL_RELEASE_CHANNEL: import.meta.env.VITE_OYL_RELEASE_CHANNEL as string | undefined,
  });
}

const SWITCHING =
  'Moving from one to the other means uninstalling this app first, and uninstalling deletes the ' +
  'rides on this device — export them, or sync them with an instance, before you switch.';

/** What the About page tells a rider in the Android app about where their copy came from. */
export function releaseChannelText(channel: ReleaseChannel | undefined): string {
  switch (channel) {
    case 'play':
      return (
        'This copy was installed from Google Play. The app is also offered as a direct download, ' +
        'an APK file from its releases on GitHub, and the two cannot update each other, because ' +
        `each is signed with a different key. ${SWITCHING}`
      );
    case 'direct':
      return (
        'This copy is the direct download: an APK file, installed from outside Google Play. The ' +
        'copy on Google Play and this one cannot update each other, because each is signed with a ' +
        `different key. ${SWITCHING}`
      );
    case undefined:
      return (
        'This copy was not built by a release, so it is neither the Google Play copy nor the ' +
        'direct download, and neither of those can update it. Moving to one of them means ' +
        'uninstalling this app first, and uninstalling deletes the rides on this device — export ' +
        'them, or sync them with an instance, before you switch.'
      );
  }
}
