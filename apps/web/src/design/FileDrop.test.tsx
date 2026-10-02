// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #994: a dropped file reaches the screen the way a chosen one does — through
 * the input's own `change`, or the form that reads the input on submit. jsdom
 * has no `DataTransfer`, so a drop is a plain event carrying a `dataTransfer`
 * of our own, with a real `FileList` taken from an input.
 */

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { mount, type Mounted } from '../testing/mount';

import { FileDrop, handOver } from './FileDrop';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * A list of files as a `FileList` presents them. jsdom can construct no
 * `FileList` and its `files` setter refuses anything else, so the input's
 * `files` is made a plain property first (`writableFiles`); what is under test
 * is that the drop hands the list over and the screen reads it back.
 */
function fileList(...names: string[]): FileList {
  const files = names.map((name) => new File(['<gpx/>'], name, { type: 'application/gpx+xml' }));
  return Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  });
}

function writableFiles(): void {
  const input = document.querySelector<HTMLInputElement>('#file');
  if (input === null) throw new Error('no file input');
  Object.defineProperty(input, 'files', { value: null, writable: true });
}

async function drag(
  target: Element,
  type: 'dragenter' | 'dragover' | 'drop',
  transfer: { types: string[]; files: FileList },
): Promise<Event> {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { ...transfer, dropEffect: 'none' },
  });
  await act(async () => {
    target.dispatchEvent(event);
    await Promise.resolve();
  });
  return event;
}

function Screen({ onFiles }: { readonly onFiles: (names: string[]) => void }): JSX.Element {
  return (
    <main>
      <h1>Import</h1>
      <label htmlFor="file">GPX file</label>
      <FileDrop hint="Or drop a GPX file here">
        <input
          id="file"
          type="file"
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])].map((file) => file.name));
          }}
        />
      </FileDrop>
    </main>
  );
}

function zone(): Element {
  const found = document.querySelector('.oyl-drop');
  if (found === null) throw new Error('no drop zone');
  return found;
}

describe('FileDrop', () => {
  it('hands a dropped file to the input, whose own change handler reads it', async () => {
    const seen: string[][] = [];
    mounted = await mount(<Screen onFiles={(names) => seen.push(names)} />);
    writableFiles();
    const drop = await drag(zone(), 'drop', { types: ['Files'], files: fileList('loop.gpx') });
    expect(drop.defaultPrevented).toBe(true);
    expect(seen).toEqual([['loop.gpx']]);
    expect(document.querySelector<HTMLInputElement>('#file')?.files?.[0]?.name).toBe('loop.gpx');
  });

  it('accepts a drag of files and draws the zone as a target while it is over', async () => {
    mounted = await mount(<Screen onFiles={() => undefined} />);
    const over = await drag(zone(), 'dragover', { types: ['Files'], files: fileList() });
    expect(over.defaultPrevented).toBe(true);
    expect(zone().hasAttribute('data-oyl-dragging')).toBe(true);
    await drag(zone(), 'drop', { types: ['Files'], files: fileList() });
    expect(zone().hasAttribute('data-oyl-dragging')).toBe(false);
  });

  it('leaves a drag of anything but files to the browser', async () => {
    const seen: string[][] = [];
    mounted = await mount(<Screen onFiles={(names) => seen.push(names)} />);
    const over = await drag(zone(), 'dragover', { types: ['text/plain'], files: fileList() });
    expect(over.defaultPrevented).toBe(false);
    expect(zone().hasAttribute('data-oyl-dragging')).toBe(false);
    const drop = await drag(zone(), 'drop', { types: ['text/plain'], files: fileList() });
    expect(drop.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);
  });

  it('keeps the input the way in, named by its own label, and audits clean', async () => {
    mounted = await mount(<Screen onFiles={() => undefined} />);
    const input = document.querySelector<HTMLInputElement>('#file');
    expect(input?.labels?.[0]?.textContent).toBe('GPX file');
    expect(zone().textContent).toContain('Or drop a GPX file here');
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('stops drawing the zone as a target when the drag leaves it', async () => {
    mounted = await mount(<Screen onFiles={() => undefined} />);
    await drag(zone(), 'dragenter', { types: ['Files'], files: fileList() });
    expect(zone().hasAttribute('data-oyl-dragging')).toBe(true);
    const leave = new Event('dragleave', { bubbles: true });
    Object.defineProperty(leave, 'relatedTarget', { value: document.body });
    await act(async () => {
      zone().dispatchEvent(leave);
      await Promise.resolve();
    });
    expect(zone().hasAttribute('data-oyl-dragging')).toBe(false);
  });

  it('leaves a drop that carries no file to the browser, and tells the screen nothing', async () => {
    const seen: string[][] = [];
    mounted = await mount(<Screen onFiles={(names) => seen.push(names)} />);
    const drop = await drag(zone(), 'drop', { types: ['Files'], files: fileList() });
    expect(drop.defaultPrevented).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('handOver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A `DataTransfer` stand-in, since jsdom has none: the list it builds. */
  function stubTransfer(): void {
    vi.stubGlobal(
      'DataTransfer',
      class {
        private readonly added: File[] = [];
        readonly items = { add: (file: File) => this.added.push(file) };
        get files(): FileList {
          return fileList(...this.added.map((file) => file.name));
        }
      },
    );
  }

  function input(multiple: boolean): HTMLInputElement {
    const element = document.createElement('input');
    element.type = 'file';
    element.multiple = multiple;
    Object.defineProperty(element, 'files', { value: null, writable: true });
    return element;
  }

  it('gives a single-file input only the first of several, as its picker would', () => {
    stubTransfer();
    const single = input(false);
    handOver(single, fileList('first.gpx', 'second.gpx'));
    expect([...(single.files ?? [])].map((file) => file.name)).toEqual(['first.gpx']);
  });

  it('gives a multiple-file input every one, and sends one change either way', () => {
    stubTransfer();
    const many = input(true);
    const changes = vi.fn();
    many.addEventListener('change', changes);
    handOver(many, fileList('first.gpx', 'second.gpx'));
    expect([...(many.files ?? [])].map((file) => file.name)).toEqual(['first.gpx', 'second.gpx']);
    expect(changes).toHaveBeenCalledTimes(1);
  });
});
