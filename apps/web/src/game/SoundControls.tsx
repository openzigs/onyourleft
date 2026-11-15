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
 * The MUTE is 48×48 CSS px at least since #669: it is a ride-time control on
 * the owner's list (`design/ride-time-controls.ts`, the ruling of
 * 2026-09-27), so it carries `size="ride"` — Android's 48 dp, which is not a
 * WCAG number. The SLIDER stays 44×44, the floor `.oyl-button` declares
 * (#316) and `theme.css` §`.oyl-sound` repeats for it. 44 is **SC 2.5.5
 * (Target Size (Enhanced), AAA)**; ⚠️ not SC 2.5.8, which is the AA criterion
 * and is 24×24, and which both sizes clear with room. Neither was read off a
 * table: they are for gloves on a handlebar. The browser gate measures the
 * two the three ways #316 does (`hud.browser.spec.ts`, and
 * `ride-targets.browser.spec.ts` for the mute's 48).
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
 *
 * ## ⚠️ It also shows, and clears, the master mute — #2219
 *
 * The header's *Mute all sound* (#2056, `shell/HeaderMute.tsx`) silences the
 * graph's master, cues included, and it is on the menu routes only. So a rider
 * who muted there would start a ride with every cue silent and this button
 * unpressed. It is therefore pressed while EITHER the ride's sounds or the
 * master are muted — what it says is whether the ride is heard — and a press
 * that unmutes clears both. A press that mutes is the ride's own mute, as it
 * always was, and leaves the master alone. No control is added and none moves
 * (`design/ride-time-controls.ts`).
 *
 * The master is read from storage when the controls mount: nothing on a ride
 * route writes it but this button. The press keeps the master BEFORE it calls
 * `onChange`, whose `RideCues.begin` resumes the output, and the output sets
 * its buses from the mix as it is stored at that moment.
 */

import { useState, type JSX } from 'react';

import { Button } from '../design/Button';

import { readMusicAndMaster, writeMasterMuted } from './audio-mix';
import { steppedVolume, type CuePreference } from './cue-preference';
import { deviceStorage, type PreferenceStorage } from './hud/announce-preference';

export interface SoundControlsProps {
  readonly preference: CuePreference;
  /** The rider changed something. Called from inside the press. */
  readonly onChange: (next: CuePreference) => void;
  /** Where the master mute is kept (#2219); the device's own storage when absent. */
  readonly storage?: PreferenceStorage | undefined;
}

export function SoundControls({ preference, onChange, storage }: SoundControlsProps): JSX.Element {
  const store = (): PreferenceStorage | undefined => storage ?? deviceStorage();
  const [masterMuted, setMasterMuted] = useState(() => readMusicAndMaster(store()).masterMuted);
  const silenced = preference.muted || masterMuted;
  return (
    <div className="oyl-sound" role="group" aria-label="Sounds">
      {/*
        #668: the design system's toggle rather than a hand-built button
        carrying the secondary's class. Until then the pressed state was
        `aria-pressed` and nothing a sighted rider could see.
      */}
      <Button
        variant="toggle"
        pressed={silenced}
        size="ride"
        className="oyl-sound__mute"
        onClick={() => {
          if (masterMuted) {
            // The output reads the master back from storage, so a clear the
            // device refused would show unpressed and still be silent.
            if (!writeMasterMuted(store(), false)) return;
            setMasterMuted(false);
          }
          onChange({ ...preference, muted: !silenced });
        }}
      >
        {/*
          #576: on an upright phone with a side camera paired the HUD shows
          only "Mute" — `theme.css` §"SOUNDS ON AND A SIDE CAMERA PAIRED"
          clips the rest there. #1398 does the same on an upright phone in a
          room ride (§"A ROOM RIDE WITH SOUNDS ON, ON A PHONE"), and #1409 on
          a phone on its side in a room ride with a side camera paired
          (§"#1409"); nowhere else. Clipped, not removed, so the name stays
          "Mute sounds" and begins with what is seen (SC 2.5.3).
        */}
        Mute<span className="oyl-sound__mute-more"> sounds</span>
      </Button>
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
