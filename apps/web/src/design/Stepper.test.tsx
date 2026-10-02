// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #994: − value + around a number box. The arithmetic is pure and is held
 * here case by case; the component is held by what a SCREEN sees — a
 * controlled box's `onChange` and an uncontrolled box's form value both take
 * a step as though it had been typed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { activateWithKeyboard, mount, queryAll, typeInto, type Mounted } from '../testing/mount';

import { Stepper, steppedValue } from './Stepper';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('steppedValue', () => {
  it('moves a number by one step either way', () => {
    expect(steppedValue('2.5', 1, { step: 0.1 })).toBe('2.6');
    expect(steppedValue('2.5', -1, { step: 0.1 })).toBe('2.4');
    expect(steppedValue('60', 1, { step: 5 })).toBe('65');
  });

  it('writes the result to the finer of the step and the number typed', () => {
    expect(steppedValue('0.2', 1, { step: 0.1 })).toBe('0.3');
    expect(steppedValue('4.5', 1, { step: 1 })).toBe('5.5');
    expect(steppedValue('62.4', 1, { step: 0.5 })).toBe('62.9');
  });

  it('holds the number inside its bounds', () => {
    expect(steppedValue('10', 1, { step: 1, max: 10 })).toBe('10');
    expect(steppedValue('0', -1, { step: 1, min: 0 })).toBe('0');
    // A typed number already outside comes back in on the first press.
    expect(steppedValue('70', -1, { step: 0.1, min: 0.5, max: 10 })).toBe('10.0');
  });

  it('starts an empty box, or one that is not a number, from its starting point', () => {
    expect(steppedValue('', 1, { step: 0.5, start: 75 })).toBe('75.0');
    expect(steppedValue('abc', -1, { step: 1, min: 3 })).toBe('3');
    expect(steppedValue('  ', 1, { step: 1 })).toBe('0');
  });

  it('reads a comma decimal, as some phone keypads type one', () => {
    expect(steppedValue('2,5', 1, { step: 0.1 })).toBe('2.6');
  });
});

function Controlled({ onValue }: { readonly onValue: (value: string) => void }): JSX.Element {
  const [value, setValue] = useState('2.5');
  return (
    <main>
      <h1>Stepper</h1>
      <label htmlFor="box">Pacer intensity</label>
      <Stepper name="pacer intensity" step={0.1} min={0.5} max={3}>
        <input
          id="box"
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onValue(event.target.value);
          }}
        />
      </Stepper>
    </main>
  );
}

function button(label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(`no button named “${label}”`);
  return found;
}

function box(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('#box');
  if (found === null) throw new Error('no box');
  return found;
}

describe('Stepper', () => {
  it('hands a controlled box each step through its own onChange', async () => {
    const seen: string[] = [];
    mounted = await mount(<Controlled onValue={(value) => seen.push(value)} />);
    await activateWithKeyboard(button('Increase pacer intensity'));
    await activateWithKeyboard(button('Increase pacer intensity'));
    await activateWithKeyboard(button('Decrease pacer intensity'));
    expect(seen).toEqual(['2.6', '2.7', '2.6']);
    expect(box().value).toBe('2.6');
  });

  it('still takes typing, and steps from what was typed', async () => {
    const seen: string[] = [];
    mounted = await mount(<Controlled onValue={(value) => seen.push(value)} />);
    await typeInto(box(), '1.2');
    await activateWithKeyboard(button('Increase pacer intensity'));
    expect(box().value).toBe('1.3');
  });

  it('says nothing to onChange when a press would not move the number', async () => {
    const seen: string[] = [];
    mounted = await mount(<Controlled onValue={(value) => seen.push(value)} />);
    await typeInto(box(), '3');
    seen.length = 0;
    await activateWithKeyboard(button('Increase pacer intensity'));
    expect(seen).toEqual([]);
  });

  it('puts a step into an uncontrolled box, so a form reads it on submit', async () => {
    mounted = await mount(
      <form aria-label="Block">
        <label htmlFor="box">Minutes</label>
        <Stepper name="minutes" step={1} min={1}>
          <input id="box" name="minutes" defaultValue="4" />
        </Stepper>
      </form>,
    );
    await activateWithKeyboard(button('Increase minutes'));
    const form = document.querySelector('form');
    expect(new FormData(form as HTMLFormElement).get('minutes')).toBe('5');
  });

  it('keeps its buttons out of the box’s label, out of a submit, and audits clean', async () => {
    mounted = await mount(<Controlled onValue={() => undefined} />);
    expect(box().labels?.[0]?.textContent).toBe('Pacer intensity');
    for (const each of document.querySelectorAll('.oyl-stepper button')) {
      expect(each.closest('label')).toBeNull();
      expect(each.getAttribute('type')).toBe('button');
    }
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('is never put on the trainer’s ERG target form (#669, #567)', () => {
    // Trainer control is a safety class (CLAUDE.md §6). A step button there
    // would be a second way to send a setpoint, outside that form's own rules.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'ride', 'TrainerPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/Stepper/);
  });
});
