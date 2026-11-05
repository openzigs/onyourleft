// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Join voice on Discord**, as the HUD shows it — #875. When and where it is
 * shown is `game/room-voice.ts`'s; this is what it is. {@link VoiceNotice} is
 * it as a notice of its own (a group ride); {@link VoiceButton}, as a button
 * beside *Start the race* while the race waits on its line.
 *
 * - `target="_blank"`, so inside the Android shell the system opens it
 *   (`views/AboutView.tsx` §the source link), not the WebView the ride runs in;
 *   `rel="noreferrer"`, so Discord is not told which page sent the rider.
 * - **In a group ride, an inline link in a sentence**, as every notice's text
 *   is set: it takes a notice's place on a phone and no more (`theme.css`
 *   §".oyl-hud__notices"), and WCAG 2.2 SC 2.5.5 and 2.5.8 except a target in
 *   a sentence.
 * - **On a race's start line, a button** — the owner's ruling of 2026-11-04,
 *   *"Make it a button first"*: a secondary {@link ButtonLink} at the
 *   ride-time 48 px, still a link (it opens Discord), on a panel of the HUD's
 *   own surface so it reads over a bright sky (`theme.css` §"A RACE'S VOICE
 *   BUTTON, ON ITS LINE"). Its whole text is its name.
 * - Not `live`: a link to press, not a fault to hear (`announce.ts`).
 */

import type { JSX } from 'react';

import { ButtonLink } from '../../design/Button';
import { StatusMessage } from '../../design/StatusMessage';
import { VOICE_NOTICE_LABEL, VOICE_TEXT } from '../room-voice';

/** The link as a notice of its own, labelled *Voice*. */
export function VoiceNotice({ invite }: { readonly invite: string }): JSX.Element {
  return (
    <StatusMessage tone="info" label={VOICE_NOTICE_LABEL}>
      <a href={invite} target="_blank" rel="noreferrer">
        {VOICE_TEXT.link}
      </a>
      {VOICE_TEXT.after}
    </StatusMessage>
  );
}

/**
 * The link as a race's button, on its panel. Its two halves are each a box of
 * their own, so where it is narrow it breaks between them.
 */
export function VoiceButton({ invite }: { readonly invite: string }): JSX.Element {
  return (
    <span className="oyl-hud__voice">
      <ButtonLink href={invite} variant="secondary" size="ride" external>
        <span className="oyl-hud__voice-words">{VOICE_TEXT.link}</span>
        <span className="oyl-hud__voice-words">{VOICE_TEXT.after}</span>
      </ButtonLink>
    </span>
  );
}
