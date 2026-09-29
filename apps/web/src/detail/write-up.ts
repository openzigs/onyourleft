// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a ride's page says about a model's write-up, and how a saved one is
 * made safe to show** — [#805](https://github.com/openzigs/onyourleft/issues/805),
 * epic #795, [ADR 0035](../../../../docs/adr/0035-model-written-ride-write-ups.md).
 *
 * ## Two kinds of text, and only one of them is ours
 *
 * Every constant here is **app text** under ADR 0030 (ADR 0035 D-3): the
 * framing, every state sentence and every label. `camera/no-absolute-angles.ts`
 * scans this file like every other, with no exemption. The model's words are
 * never in source: they arrive from the store, are screened again by
 * {@link shownWriteUp}, and are handed to a React text node by
 * `RideWriteUpSection.tsx` — never as markup (ADR 0029 D-8).
 *
 * ## Screened before shown, even from the store
 *
 * A saved row is not trusted because the code that wrote it screened it: a row
 * can be hand-edited, restored from another build's export or written by a
 * build whose screen was weaker. {@link shownWriteUp} runs the row's text
 * through the same screen a fresh reply passes (`camera/write-up-screen.ts`),
 * and a row that fails is withheld WHOLE, with {@link WRITE_UP_WITHHELD_SAVED}
 * in its place and none of its words.
 */

import type { RideWriteUpRecord, RideWriteUpSourceRecord } from '@onyourleft/store';

import { HOSTED_CONSENT } from '../camera/hosted-model';
import { passedScreen, screenSavedWriteUp, type ScreenedWriteUp } from '../camera/write-up-screen';

/**
 * ADR 0035 D-9 A, the framing shown above every write-up — the owner's
 * approved wording, word for word, in two parts because the first is bold.
 * `write-up.test.ts` pins it against the ADR itself.
 */
export const WRITE_UP_FRAMING_LEAD = "Written by the model you chose, from this ride's numbers.";
export const WRITE_UP_FRAMING_REST =
  'This app did not write it and cannot check it. It can be wrong. It is not medical advice.';

/**
 * ADR 0035 D-9 B, the own-computer paragraph as the privacy policy carries it
 * (#802), as ADR 0035's 2026-09-29 amendment completed it (#845) — shown beside the ask control when the rider's own computer is
 * offered, so what will be sent is said where the press is, in the approved
 * words. Pinned against the ADR by `write-up.test.ts`.
 */
export const COMPUTER_SENDS_LEAD =
  'A ride sent to your own computer, when you ask for an analysis.';
export const COMPUTER_SENDS =
  "When you press the button on a ride's page, that ride's numbers go to the computer you set up: " +
  'heart rate, cadence and power, your weight and watts per kilogram, your threshold power, if you ' +
  "set one, how long the ride lasted, its distance, and each section's gradient and total " +
  'climb, and how it went section by section. If the side camera ' +
  'filmed the ride, and you agreed to the camera, it also gets how a few measurements of your ' +
  'riding position changed between the start and the end of filming. Never a picture. Nothing is ' +
  'sent until you press the button, and nothing is sent in the background.';

/**
 * ADR 0035 D-9 C, the hosted consent, as it stands beside the hosted ask on a
 * ride's page (#803, carried from #838's review, where only its first sentence
 * stood there): the headline, the three paragraphs and *"You do not need
 * this"*, word for word from `camera/hosted-model.ts` §`HOSTED_CONSENT`.
 *
 * ⚠️ **All but C's last sentence, on purpose.** *"This is off. It stays off
 * until you turn it on…"* describes the switch on the Camera page, and the
 * hosted ask is offered only while that switch is ON — so on this page it
 * would be false. `write-up.test.ts` pins the rest against the ADR, in order
 * and with nothing between.
 */
export const HOSTED_SENDS: readonly string[] = [
  HOSTED_CONSENT.headline,
  ...HOSTED_CONSENT.paragraphs,
  HOSTED_CONSENT.notNeeded,
];

/**
 * The fallback (#805): no model set up. One sentence, a link to where one can
 * be, and no vendor or model name (ADR 0031 D-4).
 */
export const WRITE_UP_SET_UP_BEFORE =
  'A model of your own can write about this ride. Set up a computer or a service on the';
export const WRITE_UP_SET_UP_LINK = 'Camera page';
export const WRITE_UP_SET_UP_AFTER = 'to ask it.';

/** A model is set up and nothing has been kept for this ride. Must not read like a write-up. */
export const WRITE_UP_NOT_ASKED = 'This ride has no write-up yet.';

/**
 * A saved write-up the screen would not pass. It names no finding and quotes
 * nothing. ⚠️ **Must not read like a failed ask**: nothing failed today, and
 * the rider asking again may get the same result.
 */
export const WRITE_UP_WITHHELD_SAVED =
  'The write-up saved with this ride is not shown. It did not pass this app’s checks on what may be shown, such as the angle of a joint, which this app does not show. None of it is shown here.';

/** A saved row this build cannot read. */
export const WRITE_UP_UNREADABLE =
  'This ride has a write-up saved that this version of the app cannot read, so it is not shown.';

/**
 * Above a saved write-up after an ask that did not replace it (the owner's
 * ruling of 2026-09-29 on #805: a failed, timed-out or withheld run keeps the
 * earlier write-up, and says why above it).
 */
export const WRITE_UP_EARLIER =
  'This is the earlier write-up of this ride. The attempt above did not replace it.';

/** Where the write-up was asked, in words — never by colour alone. */
export const WRITE_UP_SOURCE_TEXT: Readonly<Record<RideWriteUpSourceRecord, string>> = {
  computer: 'It was written by the model on your own computer.',
  hosted: 'It was written by a service you chose, on your own key.',
};

/** Whether the side camera's summary was part of what the model was sent. */
export const WRITE_UP_POSE_TEXT: Readonly<Record<'included' | 'left-out', string>> = {
  included: 'It was sent the side camera’s summary of this ride as well as the ride’s numbers.',
  'left-out': 'It was sent the ride’s numbers only, not a side camera summary.',
};

/**
 * Which sections the model could not describe, counted from one as a rider
 * counts, or `undefined` when it described them all.
 */
export function missingSectionsText(missing: readonly number[]): string | undefined {
  if (missing.length === 0) {
    return undefined;
  }
  const counted = missing.map((section) => String(section + 1));
  if (counted.length === 1) {
    return `Section ${counted[0] ?? ''} could not be analysed, so the write-up says nothing about it.`;
  }
  const last = counted[counted.length - 1] ?? '';
  const list = `${counted.slice(0, -1).join(', ')} and ${last}`;
  return `Sections ${list} could not be analysed, so the write-up says nothing about them.`;
}

/** A saved write-up, as the page may show it. */
export type ShownWriteUp =
  | {
      readonly kind: 'shown';
      /** Screened again, just now. Plain text for a text node, and nothing else. */
      readonly text: ScreenedWriteUp;
      readonly source: RideWriteUpSourceRecord;
      readonly includedPose: boolean;
      readonly missingSections: readonly number[];
    }
  /** It failed the screen: nothing of it is shown. */
  | { readonly kind: 'withheld' };

/** The saved row, screened again — see the file comment. */
export function shownWriteUp(record: RideWriteUpRecord): ShownWriteUp {
  const screened = screenSavedWriteUp(record.text);
  if (!passedScreen(screened)) {
    return { kind: 'withheld' };
  }
  return {
    kind: 'shown',
    text: screened,
    source: record.source,
    includedPose: record.includedPose,
    missingSections: record.missingSections,
  };
}
