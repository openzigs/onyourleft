// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a rider asks for a Delivery throw — #1810, resting on the owner's
 * rulings DL3 and DL4 of 2026-10-27 (epic #1803), recorded as ADR 0059 D-5.
 *
 * ## Three intents, and nothing else
 *
 * A key or a press on the HUD's throw control (`hud/ThrowControl.tsx`) asks
 * for one of {@link THROW_INTENTS}: throw **left**, throw **right**, or throw
 * toward the side **the next house** on the round stands on. That is all an
 * input can ask for. It cannot reach the trainer (ADR 0059 D-2), and the test
 * holds the intent type to exactly these three, so a fourth is a review
 * question rather than an accident. Which side *the next house* is on, and
 * what a throw does once asked for, are `throw.ts`'s (§`throwSideFor`).
 *
 * ⚠️ **It imports nothing**, and that is load-bearing: the HUD imports this
 * module, and an import of `throw.ts` or `round.ts` from here would put both
 * on the production path before #1816 runs a round (`check:wiring`).
 *
 * ## Keys: what the web view already receives
 *
 * Spike 0026 route A: a Bluetooth remote or ring the system pairs as a
 * keyboard sends key events that the WebView delivers to the page, with no
 * shell change and no permission. ⚠️ **Which keys a given remote sends is
 * unmeasured** (the tablet step for #733 is where it is written down), and
 * volume and media keys are not bound here: whether they reach the page at
 * all waits for spike #1819 (owner ruling 2026-10-28, DL7 revised).
 *
 * {@link THROW_KEYS} is this project's own proposed map, for the owner's
 * approval in #1810's pull request. A one-button remote most often sends
 * Enter or Space, so those throw toward the next house, which is the one
 * throw that needs no choice; a presentation clicker's two buttons send
 * Page Up and Page Down, so those throw left and right; and a keyboard's
 * arrows do the same as a clicker's, with the up arrow toward the next house.
 *
 * ## A focused control keeps its key
 *
 * {@link intentOfKey} takes no key a focused control would act on: none at
 * all from a form field, where a key types or moves a value, and no Enter or
 * Space from a button, a link or any other control those keys activate. So
 * Enter on a focused *Pause* pauses and throws nothing. It takes nothing with
 * Ctrl, Alt or Meta held (a browser or system shortcut), nothing a handler
 * already took (`defaultPrevented`), and nothing from a held key's repeats: a
 * held key throws once.
 *
 * ## The touch lock is not this module's
 *
 * Keys are never stopped by the #1432 lock, and a press on the throw control
 * is a tap the lock refuses like any other: no throw control carries
 * `TOUCH_LOCK_EXEMPT` (ADR 0059 D-5). That is the HUD's, and its test's.
 */

/** Every throw an input can ask for. @see ThrowIntent */
export const THROW_INTENTS = ['left', 'right', 'next-house'] as const;

/** A throw the rider asked for: to a side, or toward the side the next house is on. */
export type ThrowIntent = (typeof THROW_INTENTS)[number];

/**
 * The default key map, by `KeyboardEvent.key`. This project's own, for the
 * owner's approval in #1810's pull request; the header says why each key.
 */
export const THROW_KEYS: Readonly<Record<string, ThrowIntent>> = Object.freeze({
  ArrowLeft: 'left',
  PageUp: 'left',
  ArrowRight: 'right',
  PageDown: 'right',
  ArrowUp: 'next-house',
  Enter: 'next-house',
  ' ': 'next-house',
});

/** Where every key is the field's own: it types, or moves a value. */
const FIELD = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

/** What Enter or Space activates when it has focus. */
const ACTIVATED_BY_KEY =
  'button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], ' +
  '[role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"]';

/** The parts of a key event {@link intentOfKey} reads. */
export type ThrowKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'target' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented'
>;

/**
 * The throw a key asks for, or `undefined` when it asks for none — because it
 * is not in {@link THROW_KEYS}, or because it belongs to a focused control, a
 * shortcut, a handler that already took it, or a held key's repeat.
 */
export function intentOfKey(event: ThrowKeyEvent): ThrowIntent | undefined {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
    return undefined;
  }
  const intent = Object.hasOwn(THROW_KEYS, event.key) ? THROW_KEYS[event.key] : undefined;
  if (intent === undefined) return undefined;
  const target = event.target;
  if (target instanceof Element) {
    if (target.closest(FIELD) !== null) return undefined;
    if ((event.key === 'Enter' || event.key === ' ') && target.closest(ACTIVATED_BY_KEY) !== null) {
      return undefined;
    }
  }
  return intent;
}
