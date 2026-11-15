// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's own music player's controls, in the header — #2073.
 *
 * *Previous track*, *Pause music* or *Play music*, and *Next track*, for
 * whichever app Android sends media keys to. Rendered by `AppShell` on a menu
 * route only, and only once {@link OtherPlayer} has seen other audio this
 * visit (`other-player.ts` says when, and why it then stays).
 *
 * Each is a real `Button` with its words visible, so its name is what a rider
 * reads and can say (`VisuallyHidden`'s rule); the icon beside the words is
 * hidden from assistive technology. The group's label says whose player it
 * is, because *Pause music* alone could be read as our own music.
 *
 * ⚠️ **48 px targets**, by the issue, through `oyl-other-player__button`
 * rather than `Button`'s `size="ride"`: that size is the ride-time ruling's
 * own list (`design/ride-time-controls.ts`), and these are never on a ride.
 * `browser/other-player.browser.spec.ts` measures them.
 */

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';

import type { OtherPlayer, OtherPlayerPress } from './other-player';

/** The group's name: whose player these control. */
export const OTHER_PLAYER_GROUP_NAME = 'Your music app';

export const PREVIOUS_TRACK_NAME = 'Previous track';
export const NEXT_TRACK_NAME = 'Next track';
export const PAUSE_MUSIC_NAME = 'Pause music';
export const PLAY_MUSIC_NAME = 'Play music';

export interface OtherPlayerControlsProps {
  readonly player: OtherPlayer;
}

/**
 * A control's name, its first word always shown and the rest folded off the
 * screen on a phone (`theme.css` §`.oyl-other-player__rest`), where three full
 * names took two rows. Folded, never removed: the name is still the whole of
 * it, and what a rider sees is its start (WCAG 2.2 SC 2.5.3, Label in Name).
 * Exported for its test only.
 */
export function Name({ name }: { readonly name: string }): JSX.Element {
  const space = name.indexOf(' ');
  // One word has nothing to fold, and `slice(0, -1)` would drop its last letter.
  if (space === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, space)}
      <span className="oyl-other-player__rest">{name.slice(space)}</span>
    </>
  );
}

export function OtherPlayerControls({ player }: OtherPlayerControlsProps): JSX.Element | null {
  const { seen, playing } = useSyncExternalStore(player.subscribe, player.getSnapshot);
  if (!seen) return null;
  const press = (which: OtherPlayerPress) => () => {
    void player.press(which);
  };
  const PlayPause = playing ? Pause : Play;
  return (
    <div className="oyl-other-player" role="group" aria-label={OTHER_PLAYER_GROUP_NAME}>
      <Button variant="secondary" className="oyl-other-player__button" onClick={press('previous')}>
        <SkipBack aria-hidden="true" focusable="false" size={20} />
        <Name name={PREVIOUS_TRACK_NAME} />
      </Button>
      <Button
        variant="secondary"
        className="oyl-other-player__button"
        onClick={press('play-pause')}
      >
        <PlayPause aria-hidden="true" focusable="false" size={20} />
        <Name name={playing ? PAUSE_MUSIC_NAME : PLAY_MUSIC_NAME} />
      </Button>
      <Button variant="secondary" className="oyl-other-player__button" onClick={press('next')}>
        <SkipForward aria-hidden="true" focusable="false" size={20} />
        <Name name={NEXT_TRACK_NAME} />
      </Button>
    </div>
  );
}
