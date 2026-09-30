// SPDX-License-Identifier: AGPL-3.0-or-later

/** The words of the two boxes of the rider's own text (#836): the goals, and a ride's note. */

import type { RiderTextBoxWords } from './RiderTextBox';

/** The goals, on the Settings screen. */
export const GOALS_WORDS: RiderTextBoxWords = {
  heading: 'Goals and notes',
  label: 'Your goals, and anything the ride analysis should know about you',
  saved: 'Saved. The analysis can look back on it once your instance has it.',
  cleared: 'Cleared. Your goals are removed from your instance at the next sync.',
  save: 'Save goals',
};

/** A ride's note, on the ride's page. */
export const NOTE_WORDS: RiderTextBoxWords = {
  heading: 'Your note on this ride',
  label: 'How the ride went, in your own words',
  saved: 'Saved with this ride.',
  cleared: 'Cleared. The note is removed from your instance at the next sync.',
  save: 'Save note',
};
