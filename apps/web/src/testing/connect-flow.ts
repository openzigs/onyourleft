// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Driving the Connect screen's flow (#2828, `views/ConnectFlow.tsx`) as a
 * rider does: paste a code, answer where it came from, fill a field, press a
 * button. Every lookup is by what the rider reads — a label, a button's name —
 * over the whole document, so a test that renders the real shell and one that
 * renders `InstanceView` alone use the same steps.
 */

import { act } from 'react';

import { CONNECT_FLOW_TEXT } from '../views/ConnectFlow';
import { queryAll, settle, submitForm, typeInto, typeIntoTextArea } from './mount';

/** The button named `name`, or a throw that names it. */
export function buttonNamed(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

/** The field labelled `label`, or a throw that names it. */
export function fieldLabelled<T extends HTMLElement>(label: string): T {
  const found = queryAll<HTMLLabelElement>(document.body, 'label').find(
    (each) => each.textContent === label,
  );
  const field = document.getElementById(found?.htmlFor ?? '');
  if (field === null) throw new Error(`no field labelled ${label}`);
  return field as T;
}

/** Press a button by its name, and let what it started settle. */
export async function pressNamed(name: string): Promise<void> {
  const pressed = buttonNamed(name);
  await act(async () => {
    pressed.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await settle();
}

/** Wait, on the real clock, until `done`, a bounded number of times: a real port's answer is real cryptography. */
export async function until(done: () => boolean): Promise<void> {
  for (let tick = 0; tick < 200 && !done(); tick += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
    });
  }
}

/** Open the paste box if the screen offers a scan first, paste `text` and press Continue. */
export async function pasteCode(text: string): Promise<void> {
  const opener = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === CONNECT_FLOW_TEXT.pasteInstead,
  );
  if (opener !== undefined) await pressNamed(CONNECT_FLOW_TEXT.pasteInstead);
  const box = fieldLabelled<HTMLTextAreaElement>(CONNECT_FLOW_TEXT.pasteLabel);
  await typeIntoTextArea(box, text);
  const form = box.closest('form');
  if (form === null) throw new Error('no paste form');
  await submitForm(form);
  await settle();
}

/** Answer the flow's one question: where the code came from. */
export async function answer(kind: keyof typeof CONNECT_FLOW_TEXT.choices): Promise<void> {
  await pressNamed(CONNECT_FLOW_TEXT.choices[kind]);
}

/** Type the optional name on a step that connects. */
export async function typeName(name: string): Promise<void> {
  await typeInto(fieldLabelled<HTMLInputElement>(CONNECT_FLOW_TEXT.nameLabel), name);
}

/**
 * The status said directly under the button `name`: the element right after
 * it, or after the paragraph that holds it (#2828: "every refusal shows
 * directly under the button that was pressed").
 */
export function saidUnder(name: string): string | undefined {
  const pressed = buttonNamed(name);
  const holder = pressed.parentElement?.tagName === 'P' ? pressed.parentElement : pressed;
  const next = holder.nextElementSibling;
  return next?.getAttribute('role') === 'status' || next?.querySelector('[role="status"]')
    ? (next.textContent ?? undefined)
    : undefined;
}
