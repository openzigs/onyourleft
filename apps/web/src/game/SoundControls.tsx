// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The mute and the volume, where a rider is when the sound plays — #400.
 *
 * ⚠️ **WCAG 2.2 SC 1.4.2 (Audio Control, Level A) is why both exist and why
 * they are HERE**, on the ride's own screen, rather than only on Settings: a
 * continuous tone plays for longer than three seconds, and a rider who cannot
 * stop it without leaving the ride has no way out. The volume is the page's
 * own, independent of the system's.
 *
 * ## Sizes, and which criterion
 *
 * Both are 44×44 CSS px at least — the mute is an `.oyl-button`, which declares
 * that (#316), and the slider declares the same floor in `theme.css`
 * §`.oyl-sound`. That clears **SC 2.5.8 (Target Size (Minimum), Level AA),
 * which is 24×24**, with room, and it is **SC 2.5.5 (Enhanced, AAA)**'s 44 —
 * chosen for gloves on a handlebar, not read off a table. The browser gate
 * measures both the three ways #316 does (`hud.browser.spec.ts`).
 *
 * ## One name each, and a state
 *
 * *Mute sounds* keeps its name and says which way it stands with
 * `aria-pressed`, as `HudPanel`'s *Trainer notice* does with `aria-expanded`:
 * a screen reader then says what the control is and whether it is on, and a
 * speech-control user has one thing to say.
 *
 * Every change is also a press, so the parent resumes a suspended audio
 * context from here (`web-audio.ts` §"What happens when it is suspended").
 */

import type { JSX } from 'react';

import { steppedVolume, type CuePreference } from './cue-preference';

export interface SoundControlsProps {
  readonly preference: CuePreference;
  /** The rider changed something. Called from inside the press. */
  readonly onChange: (next: CuePreference) => void;
}

export function SoundControls({ preference, onChange }: SoundControlsProps): JSX.Element {
  return (
    <div className="oyl-sound" role="group" aria-label="Sounds">
      <button
        type="button"
        className="oyl-button oyl-button--secondary oyl-sound__mute"
        aria-pressed={preference.muted}
        onClick={() => {
          onChange({ ...preference, muted: !preference.muted });
        }}
      >
        Mute sounds
      </button>
      <label className="oyl-sound__volume">
        {/*
          The label's WORDS are clipped inside the ride HUD (theme.css
          §`.oyl-hud .oyl-sound__label`) and shown everywhere else. They stay
          the slider's accessible name either way — clipped, never removed.
          In the HUD the group's own name and the Mute sounds button beside
          it say what the slider is, and a second line of controls would cost
          the ride's smallest layouts their room (measured: #400's own gate,
          `ride.browser.spec.ts` §"a ride with sounds on").
        */}
        <span className="oyl-sound__label">Sound volume</span>{' '}
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={Math.round(preference.volume * 100)}
          onChange={(event) => {
            const volume = steppedVolume(Number(event.currentTarget.value) / 100);
            if (volume !== undefined) onChange({ ...preference, volume });
          }}
        />
      </label>
    </div>
  );
}
