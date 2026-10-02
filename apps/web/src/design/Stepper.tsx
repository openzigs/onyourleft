// SPDX-License-Identifier: AGPL-3.0-or-later

import { Minus, Plus } from 'lucide-react';
import { useRef, type JSX, type ReactElement } from 'react';

/**
 * − value + around a number box — #994.
 *
 * The box is the caller's own `<input>`, passed as the one child, with its own
 * label, `id`, `value`, `onChange` and validity attributes untouched: typing
 * still works exactly as it did, and a step is delivered to the box as though
 * the rider had typed the new number. So a controlled box's `onChange` and an
 * uncontrolled box's form value both see it, and nothing downstream knows a
 * button was pressed.
 *
 * ⚠️ **No control here sends a trainer setpoint.** Trainer control is a
 * safety class (CLAUDE.md §6) and the ERG target form keeps its own rules
 * (#669, #567): `ride/TrainerPanel.tsx` does not use this, and
 * `Stepper.test.tsx` fails if it ever does.
 *
 * The buttons are siblings of the box, never inside its `<label>`: a button
 * inside a label is read as part of the box's name ("Weight Decrease 62.4
 * Increase").
 */
export interface StepperProps {
  /** What the number is, for the buttons' names: "pacer intensity". */
  readonly name: string;
  /** How much one press moves the number. */
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
  /**
   * Where the first press lands when the box is empty or holds no number.
   * Defaults to `min`, then 0.
   */
  readonly start?: number;
  /** The `<input>` itself. */
  readonly children: ReactElement;
}

export function Stepper(props: StepperProps): JSX.Element {
  const wrapper = useRef<HTMLSpanElement>(null);
  const press = (direction: 1 | -1): void => {
    const input = wrapper.current?.querySelector('input');
    if (input === null || input === undefined) {
      return;
    }
    const next = steppedValue(input.value, direction, props);
    if (next === input.value) {
      return;
    }
    deliver(input, next);
  };
  return (
    <span className="oyl-stepper" ref={wrapper}>
      <button
        type="button"
        className="oyl-stepper__step"
        aria-label={`Decrease ${props.name}`}
        onClick={() => {
          press(-1);
        }}
      >
        <Minus aria-hidden="true" focusable="false" size={20} />
      </button>
      {props.children}
      <button
        type="button"
        className="oyl-stepper__step"
        aria-label={`Increase ${props.name}`}
        onClick={() => {
          press(1);
        }}
      >
        <Plus aria-hidden="true" focusable="false" size={20} />
      </button>
    </span>
  );
}

/**
 * The text a box should hold after one press, from the text it holds now.
 *
 * - A number moves by `step` and is clamped to `[min, max]`; a press that
 *   the bound stops leaves the text exactly as it was.
 * - Empty, or not a number, gives the starting point (`start`, else `min`,
 *   else 0) rather than a step from nothing: the rider sees a number appear
 *   and the next press moves it.
 * - The result is written to the precision of the step or of the number
 *   typed, whichever is finer, so 0.1 + 0.2 is "0.3", 4.5 + 1 is "5.5" and a
 *   step of 1 from a whole number gives a whole number. A comma decimal is read as a point,
 *   because a decimal keypad on some phones types one.
 */
export function steppedValue(
  current: string,
  direction: 1 | -1,
  bounds: Pick<StepperProps, 'step' | 'min' | 'max' | 'start'>,
): string {
  const trimmed = current.trim().replace(',', '.');
  const parsed = trimmed === '' ? Number.NaN : Number(trimmed);
  const decimals = Math.max(
    decimalsOf(bounds.step),
    Number.isFinite(parsed) ? decimalsOf(parsed) : 0,
  );
  const next = Number.isFinite(parsed)
    ? parsed + direction * bounds.step
    : (bounds.start ?? bounds.min ?? 0);
  const clamped = Math.min(
    bounds.max ?? Number.POSITIVE_INFINITY,
    Math.max(bounds.min ?? Number.NEGATIVE_INFINITY, next),
  );
  // A press at a bound leaves the box exactly as typed, rather than
  // rewriting "3" as "3.0" and reporting a change that moved nothing.
  return clamped === parsed ? current : clamped.toFixed(decimals);
}

function decimalsOf(value: number): number {
  const text = String(value);
  const point = text.indexOf('.');
  return point < 0 ? 0 : text.length - point - 1;
}

/**
 * Put `value` in the box the way typing does: through the prototype's own
 * setter, so React's record of the last value it wrote does not swallow the
 * change, then an `input` event that bubbles to React's root listener.
 */
function deliver(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
