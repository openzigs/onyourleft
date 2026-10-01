// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #950: the one Radix primitive in the client, and what it is there for —
 * behaviour. A dialog whose focus can wander back to the page behind it is a
 * dialog a keyboard or screen-reader user can lose themselves out of while the
 * page is inert, so the trap is asserted both ways it can leak: Tab past the
 * last control, and focus moved outside by anything at all.
 *
 * ⚠️ jsdom does not move focus on Tab. What it does deliver is the keydown,
 * and Radix's `FocusScope` wraps focus in its own keydown handler, which is
 * the handler under test. `browser/confirm-dialog.browser.spec.ts` presses
 * the real Tab key in Chromium.
 */

import { useState, type JSX } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { ConfirmDialog } from './ConfirmDialog';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function Harness({ onConfirm }: { readonly onConfirm: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete it
      </button>
      <a href="#elsewhere">Somewhere else on the page</a>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete “Tuesday hills”?"
        confirmLabel="Delete the ride"
        cancelLabel="Keep the ride"
        onConfirm={onConfirm}
      >
        <p>Deleting a ride cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}

function button(text: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === text,
  );
  if (found === undefined) {
    throw new Error(`no button “${text}”`);
  }
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

async function press(key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

async function opened(onConfirm = vi.fn()): Promise<void> {
  mounted = await mount(<Harness onConfirm={onConfirm} />);
  await activateWithKeyboard(button('Delete it'));
  await settle();
}

describe('ConfirmDialog — #950', () => {
  it('is a modal alertdialog named by its question and described by its sentence', async () => {
    await opened();
    const shown = dialog();
    expect(shown).not.toBeNull();
    expect(shown?.getAttribute('aria-modal')).toBe('true');
    const named = document.getElementById(shown?.getAttribute('aria-labelledby') ?? '');
    const described = document.getElementById(shown?.getAttribute('aria-describedby') ?? '');
    expect(named?.textContent).toBe('Delete “Tuesday hills”?');
    expect(described?.textContent).toBe('Deleting a ride cannot be undone.');
  });

  it('renders nothing while closed', async () => {
    mounted = await mount(<Harness onConfirm={vi.fn()} />);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain('cannot be undone');
  });

  it('opens on the choice that keeps things as they are', async () => {
    await opened();
    expect(document.activeElement?.textContent).toBe('Keep the ride');
  });

  it('keeps Tab inside: past the last control it comes back to the first, and back again', async () => {
    await opened();
    const keep = button('Keep the ride');
    const remove = button('Delete the ride');

    remove.focus();
    await press('Tab');
    expect(document.activeElement).toBe(keep);

    keep.focus();
    await press('Tab', true);
    expect(document.activeElement).toBe(remove);
  });

  it('pulls focus back when anything moves it outside', async () => {
    await opened();
    const outside = queryAll<HTMLAnchorElement>(document.body, 'a').find(
      (each) => each.textContent === 'Somewhere else on the page',
    );
    await act(async () => {
      outside?.focus();
      await Promise.resolve();
    });
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });

  it('hides the page behind it from a screen reader while it is open', async () => {
    await opened();
    // Radix's `aria-hidden` on everything outside the dialog's portal.
    expect(mounted?.container.getAttribute('aria-hidden')).toBe('true');
  });

  it('passes the accessibility audit while open — the dialog is what it audits', async () => {
    await opened();
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toStrictEqual([]);
  });

  it('closes on Escape, confirms nothing, and gives focus back to what opened it', async () => {
    const onConfirm = vi.fn();
    await opened(onConfirm);
    await press('Escape');
    await settle();
    expect(dialog()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button('Delete it'));
  });

  it('confirms once, on its own words, and closes', async () => {
    const onConfirm = vi.fn();
    await opened(onConfirm);
    await activateWithKeyboard(button('Delete the ride'));
    await settle();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});
