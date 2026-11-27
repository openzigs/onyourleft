// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which channel this copy of the app came from — #1745, and the iOS app's
 * since #3239.
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

import { platformCapacitor, shellKind, type ShellKind } from './capacitor';

export type ReleaseChannel = 'play' | 'direct' | 'app-store' | 'testflight';

/**
 * Every name {@link readReleaseChannel} accepts. #3239 added the iOS app's two:
 * `app-store` and `testflight`, which the iOS release build sets (#1778).
 */
const RELEASE_CHANNELS: readonly ReleaseChannel[] = ['play', 'direct', 'app-store', 'testflight'];

/** The bundler environment this reads, named so a test can supply it. */
export interface ReleaseChannelEnvironment {
  readonly VITE_OYL_RELEASE_CHANNEL?: string | undefined;
}

/**
 * The channel a build was made for. Anything but the four names reads as none,
 * so a misspelt value in the workflow says "not a release" rather than
 * claiming a channel.
 */
export function readReleaseChannel(
  environment: ReleaseChannelEnvironment,
): ReleaseChannel | undefined {
  const value = environment.VITE_OYL_RELEASE_CHANNEL?.trim();
  return RELEASE_CHANNELS.find((channel) => channel === value);
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

/**
 * The iOS app's sentence on moving between its two channels — #3239. Nothing
 * here claims what installing one over the other keeps: that is Apple's to
 * decide and is not measured. ⚠️ **Draft wording for the owner.**
 */
const IOS_SWITCHING =
  'Export your rides, or sync them with an instance, before you move from one to the other.';

/**
 * What the About page tells a rider in a native app about where their copy
 * came from.
 *
 * @param kind which native shell (#3239), read from the real Capacitor global
 * unless a caller says: it decides only what a build with no channel says,
 * because a channel already names its own platform.
 */
export function releaseChannelText(
  channel: ReleaseChannel | undefined,
  kind: ShellKind | undefined = shellKind(platformCapacitor()),
): string {
  switch (channel) {
    case 'app-store':
      return (
        'This copy was installed from the App Store. Test builds of the app come through ' +
        `TestFlight instead. ${IOS_SWITCHING}`
      );
    case 'testflight':
      return (
        'This copy is a test build, installed through TestFlight rather than the App Store. ' +
        IOS_SWITCHING
      );
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
      if (kind === 'ios') {
        return (
          'This copy was not built by a release, so it is neither the App Store copy nor a ' +
          'TestFlight build. Export your rides, or sync them with an instance, before you ' +
          'replace it with one of them.'
        );
      }
      return (
        'This copy was not built by a release, so it is neither the Google Play copy nor the ' +
        'direct download, and neither of those can update it. Moving to one of them means ' +
        'uninstalling this app first, and uninstalling deletes the rides on this device — export ' +
        'them, or sync them with an instance, before you switch.'
      );
  }
}
