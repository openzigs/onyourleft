// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The disclosure shown beside the goals field, each ride's note and the
 * documents list (#836) — ADR 0040 D-11's drafted wording, word for word.
 *
 * ⚠️ **Shown whether or not an instance is connected**, so its first sentence
 * is conditional: a rider with no instance is a supported state (ADR 0036
 * D-3(a)), and for them nothing here leaves the device through an instance.
 *
 * ⚠️ **It does not promise more than the containment holds** (#836, OWASP
 * LLM01:2025): a document from somewhere else can carry instructions aimed at
 * a model, the app treats this text as information, and no safeguard is
 * perfect. Kept visible (#666): it is about what leaves the device and who
 * reads it, so no ⓘ may hide it.
 */

/** The bold lead: where the text is kept, and where it goes. */
export const RIDER_TEXT_DISCLOSURE_LEAD =
  'What you write here is kept on this device. If you connect an instance, it goes there too, and to the model you chose.';

/** The rest of the first paragraph: what the instance does with it, and what is sent. */
export const RIDER_TEXT_DISCLOSURE_DETAIL =
  'When an instance is connected, your goals, notes and documents are copied to it when it syncs. It keeps a searchable copy so the analysis can look back at your history, and that copy is worked out by a model on that machine, not sent anywhere else to do it. When you ask for an analysis, the parts that match are sent to the model you set up — on your own computer, or, if you turned it on, a service you chose, after the details on your list are masked.';

/** The second paragraph: a model reads this text, and what that can mean. */
export const RIDER_TEXT_MODEL_WARNING =
  'A model reads this text. If a document came from somewhere else, it may contain instructions written for a model; the app treats everything here as information, not instructions, but no safeguard is perfect.';

/** Every sentence of the disclosure, for the kept-visible gate (#666). */
export const RIDER_TEXT_KEPT_VISIBLE: readonly string[] = [
  RIDER_TEXT_DISCLOSURE_LEAD,
  RIDER_TEXT_DISCLOSURE_DETAIL,
  RIDER_TEXT_MODEL_WARNING,
];
