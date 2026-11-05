// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Join voice on Discord**, as the HUD shows it — #875. When and where it is
 * shown is `game/room-voice.ts`'s; this is what it is: the link, and words
 * after it that say it opens Discord. {@link VoiceNotice} is it as a notice of
 * its own (a group ride); {@link VoiceLine}, as the last line of a race's
 * notice while the race waits on its line.
 *
 * - `target="_blank"`, so inside the Android shell the system opens it
 *   (`views/AboutView.tsx` §the source link), not the WebView the ride runs in;
 *   `rel="noreferrer"`, so Discord is not told which page sent the rider.
 * - **An inline link in a sentence**, as every notice's text is set, rather
 *   than a button of its own: it takes a notice's place on a phone and no
 *   more (`theme.css` §".oyl-hud__notices"), and WCAG 2.2 SC 2.5.5 and 2.5.8
 *   except a target in a sentence.
 * - Not `live`: a link to press, not a fault to hear (`announce.ts`).
 */

import type { JSX } from 'react';

import { StatusMessage } from '../../design/StatusMessage';
import { VOICE_NOTICE_LABEL, VOICE_TEXT } from '../room-voice';

function VoiceLink({ invite }: { readonly invite: string }): JSX.Element {
  return (
    <>
      <a href={invite} target="_blank" rel="noreferrer">
        {VOICE_TEXT.link}
      </a>
      {VOICE_TEXT.after}
    </>
  );
}

/** The link as a notice of its own, labelled *Voice*. */
export function VoiceNotice({ invite }: { readonly invite: string }): JSX.Element {
  return (
    <StatusMessage tone="info" label={VOICE_NOTICE_LABEL}>
      <VoiceLink invite={invite} />
    </StatusMessage>
  );
}

/** The link as the last line of a race's notice: one line, no label of its own. */
export function VoiceLine({ invite }: { readonly invite: string }): JSX.Element {
  return (
    <p className="oyl-hud__voice">
      <VoiceLink invite={invite} />
    </p>
  );
}
