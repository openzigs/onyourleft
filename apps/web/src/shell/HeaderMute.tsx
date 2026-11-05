// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one-press mute in the header — #2056.
 *
 * ## ⚠️ WCAG 2.2 SC 1.4.2 (Audio Control, Level A) is why it is here
 *
 * Music plays in the menus by default (owner ruling 2 of 2026-11-03, #2058),
 * and audio that plays by itself for more than three seconds needs a way to
 * stop it. This is that way: one press, on every menu route, and the first
 * thing after the skip link in the tab order. It silences the graph's MASTER
 * (`game/web-audio.ts` §"The graph"), so music, the menus' sounds and the
 * ride's cues all stop; the three volumes are on Settings.
 *
 * ## Only on a menu route
 *
 * `AppShell` renders it beside the wordmark everywhere but the two ride routes
 * (`route-motion.ts` §`RIDE_ROUTE_IDS`). There the ride's own *Mute sounds*
 * and volume (`game/SoundControls.tsx`) stay as they are, and nothing on a
 * ride-time screen moves (`design/ride-time-controls.ts`).
 *
 * ## On a phone, an icon at the end of the title's line
 *
 * Below the rail breakpoint the header is zero tall (#671), and a row of its
 * own pushed a page's first control under the bar. So there `theme.css` draws
 * it beside the `h1`, as the screen's ⓘ is drawn, with its words clipped —
 * never removed, so the name is still *Mute all sound*.
 *
 * ## One name, and a state
 *
 * *Mute all sound* keeps its name and says which way it stands with
 * `aria-pressed`, as *Mute sounds* on the ride does; the icon beside the words
 * changes with it and is hidden from assistive technology.
 *
 * ## It reaches a sound already playing, and starts nothing
 *
 * The press keeps the choice (`audio-mix.ts` §`writeMasterMuted`), then asks
 * the output to set its buses from it ({@link CueOutput.applyMix}) — which
 * never makes a context, so a mute pressed before anything has played starts
 * no audio thread. A graph built later reads the stored mute when it is made.
 */

import { Volume2, VolumeX } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { readMusicAndMaster, writeMasterMuted } from '../game/audio-mix';
import type { CueOutput } from '../game/audio-port';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import { sharedCueOutput } from '../game/web-audio';

/** The control's name, which does not change when it is pressed. */
export const HEADER_MUTE_NAME = 'Mute all sound';

export interface HeaderMuteProps {
  /** Where the mix is kept; the device's own storage when absent. */
  readonly storage?: PreferenceStorage | undefined;
  /** The output whose buses follow the press; the app's shared one when absent. */
  readonly output?: CueOutput | undefined;
}

export function HeaderMute({ storage, output }: HeaderMuteProps): JSX.Element {
  const store = (): PreferenceStorage | undefined => storage ?? deviceStorage();
  const [muted, setMuted] = useState(() => readMusicAndMaster(store()).masterMuted);
  const Icon = muted ? VolumeX : Volume2;
  return (
    <Button
      variant="toggle"
      pressed={muted}
      className="oyl-header__mute"
      onClick={() => {
        const next = !muted;
        setMuted(next);
        writeMasterMuted(store(), next);
        (output ?? sharedCueOutput()).applyMix();
      }}
    >
      <Icon aria-hidden="true" focusable="false" size={20} />{' '}
      {/* Clipped on a phone, never removed: still the button's name (theme.css). */}
      <span className="oyl-header__mute-words">{HEADER_MUTE_NAME}</span>
    </Button>
  );
}
