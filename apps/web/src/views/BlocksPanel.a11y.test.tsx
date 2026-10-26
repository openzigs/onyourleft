// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Riders you blocked* on the Instance screen — #1529: every block the
 * instance lists, by the name it was made under, with *Unblock*; a press asks
 * first; *Unblock {name}* sends that block's handle and nothing else; the
 * list is read back from the port afterwards, not edited here; the answer
 * takes focus; *Cancel* sends nothing and puts focus back. Audited listed,
 * asking and answered. That the instance lifts the block, and the result
 * names the two again, is `net/rooms-sealed.test.ts` §"#1516".
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { BlocksPort, HeldBlock, UnblockAnswer } from '../instance/blocks-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { BLOCKS_TEXT, BlocksPanel } from './BlocksPanel';

const ANN: HeldBlock = { handle: 'a'.repeat(32), name: 'Ann', blockedAt: 1_790_000_000 };
const UNNAMED: HeldBlock = { handle: 'b'.repeat(32), name: null, blockedAt: 1_789_000_000 };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A port over a list the instance holds: unblocking takes the block off it, as the instance does. */
async function panel(held: readonly HeldBlock[], answer: UnblockAnswer = { kind: 'unblocked' }) {
  let list = [...held];
  const sent: string[] = [];
  const port: BlocksPort = {
    read: () => Promise.resolve({ kind: 'blocks', blocks: list }),
    unblock: (handle) => {
      sent.push(handle);
      if (answer.kind === 'unblocked') list = list.filter((each) => each.handle !== handle);
      return Promise.resolve(answer);
    },
  };
  mounted = await mount(
    <main>
      <h1>Instance</h1>
      <BlocksPanel port={port} />
    </main>,
  );
  await settle();
  return sent;
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const button = (name: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) => text(each) === name);

const rows = (): string[] => [...document.querySelectorAll('li')].map(text);

async function press(name: string): Promise<void> {
  const target = button(name);
  expect(target, name).toBeDefined();
  await act(async () => {
    target?.click();
    await Promise.resolve();
  });
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

describe('Riders you blocked — #1529', () => {
  it('lists every block by the name it was made under, or says none was kept, each with Unblock', async () => {
    await panel([ANN, UNNAMED]);
    expect(text(document.querySelector('h2'))).toBe(BLOCKS_TEXT.heading);
    expect(rows()).toEqual([
      'Ann, blocked 2026-09-21 Unblock Ann',
      `${BLOCKS_TEXT.unnamed}, blocked 2026-09-10 Unblock this rider`,
    ]);
    // The visible word first, so a voice command of what is seen reaches it (SC 2.5.3).
    expect(button('Unblock Ann')?.firstChild?.textContent).toBe(BLOCKS_TEXT.open);
    expect(audit()).toBe('');
  });

  it('shows nothing to a rider with no block', async () => {
    await panel([]);
    expect(document.querySelector('h2')).toBeNull();
  });

  it('asks first, then sends that block’s handle alone, reads the list back, and moves focus to the answer', async () => {
    const sent = await panel([ANN, UNNAMED]);
    await press('Unblock Ann');
    expect(sent).toEqual([]);
    expect(document.body.textContent).toContain(BLOCKS_TEXT.question('Ann', 'Ann'));
    expect(text(document.activeElement)).toBe(BLOCKS_TEXT.confirm('Ann'));
    expect(audit()).toBe('');

    await press(BLOCKS_TEXT.confirm('Ann'));
    expect(sent).toEqual([ANN.handle]);
    expect(text(document.activeElement)).toBe(BLOCKS_TEXT.unblocked('Ann'));
    // Read back from the port: Ann is gone, the other block is untouched.
    expect(rows()).toEqual([`${BLOCKS_TEXT.unnamed}, blocked 2026-09-10 Unblock this rider`]);
    expect(audit()).toBe('');
  });

  it('keeps the panel, and says so, once the last block is undone', async () => {
    await panel([UNNAMED]);
    await press('Unblock this rider');
    expect(document.body.textContent).toContain(BLOCKS_TEXT.question('This rider', 'this rider'));
    await press(BLOCKS_TEXT.confirm('this rider'));
    expect(rows()).toEqual([]);
    expect(text(document.activeElement)).toBe(BLOCKS_TEXT.unblocked('This rider'));
  });

  it('says a block was not undone when the instance did not answer, and keeps it listed', async () => {
    const sent = await panel([ANN], { kind: 'unreachable' });
    await press('Unblock Ann');
    await press(BLOCKS_TEXT.confirm('Ann'));
    expect(sent).toEqual([ANN.handle]);
    expect(text(document.activeElement)).toBe(BLOCKS_TEXT.unreachable);
    expect(button('Unblock Ann')).toBeDefined();
  });

  it('sends nothing on Cancel, and puts focus back on Unblock', async () => {
    const sent = await panel([ANN]);
    await press('Unblock Ann');
    await press(BLOCKS_TEXT.cancel);
    expect(sent).toEqual([]);
    expect(document.body.textContent).not.toContain(BLOCKS_TEXT.question('Ann', 'Ann'));
    expect(document.activeElement).toBe(button('Unblock Ann'));
  });
});
