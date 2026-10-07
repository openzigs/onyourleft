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

import { accessibleName, auditAccessibility, formatViolations } from '../a11y/audit';
import { mount, type Mounted } from '../testing/mount';

import { chosenText, FileDrop, FilePicker, handOver } from './FileDrop';

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
      <label htmlFor="file" id="file-label">
        GPX file
      </label>
      <FileDrop hint="Or drop a GPX file here" labelId="file-label">
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

describe('FilePicker — #1030', () => {
  /**
   * Make `#file`'s `files` writable, and emptied by a write to `value` as a
   * browser's is — jsdom's own setter refuses a list it did not build.
   */
  function choosable(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('#file');
    if (input === null) throw new Error('no file input');
    let files: FileList | null = null;
    Object.defineProperty(input, 'files', {
      get: () => files,
      set: (next: FileList | null) => {
        files = next;
      },
    });
    Object.defineProperty(input, 'value', {
      get: () => (files === null || files.length === 0 ? '' : 'C:\\fakepath\\x'),
      set: (next: string) => {
        if (next === '') files = fileList();
      },
    });
    return input;
  }

  async function choose(input: HTMLInputElement, ...names: string[]): Promise<void> {
    await act(async () => {
      handOver(input, fileList(...names));
      await Promise.resolve();
    });
  }

  function chip(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.oyl-file__chip');
  }

  it('draws a button over which the input is laid, and keeps the input the way in', async () => {
    mounted = await mount(<Screen onFiles={() => undefined} />);
    const input = document.querySelector<HTMLInputElement>('#file');
    const button = document.querySelector('.oyl-file__button');
    expect(input?.classList.contains('oyl-file__input')).toBe(true);
    expect(button?.textContent).toBe('Choose file');
    expect(button?.getAttribute('aria-hidden')).toBe('true');
    // The input precedes the button: theme.css draws its focus on the sibling.
    expect(input?.nextElementSibling).toBe(button);
    expect(input?.labels?.[0]?.textContent).toBe('GPX file');
    expect(chip()).toBeNull();
  });

  it('shows the chosen file as a chip, and its remove button empties the input', async () => {
    const seen: string[][] = [];
    mounted = await mount(<Screen onFiles={(names) => seen.push(names)} />);
    const input = choosable();
    await choose(input, 'loop.gpx');
    expect(chip()?.textContent).toBe('loop.gpx');
    const remove = chip()?.querySelector('button');
    expect(remove?.getAttribute('aria-label')).toBe('Remove loop.gpx');
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
    await act(async () => {
      remove?.click();
      await Promise.resolve();
    });
    expect(chip()).toBeNull();
    expect(input.files?.length).toBe(0);
    // The screen is told, through the input's own change, that nothing is chosen.
    expect(seen).toEqual([['loop.gpx'], []]);
    expect(document.activeElement).toBe(input);
  });

  it('shows no chip when the screen empties the input in its own handler', async () => {
    function Consumes(): JSX.Element {
      return (
        <main>
          <h1>Documents</h1>
          <label htmlFor="file" id="file-label">
            Add a document
          </label>
          <FilePicker labelId="file-label">
            <input
              id="file"
              type="file"
              onChange={(event) => {
                event.currentTarget.value = '';
              }}
            />
          </FilePicker>
        </main>
      );
    }
    mounted = await mount(<Consumes />);
    await choose(choosable(), 'notes.txt');
    expect(chip()).toBeNull();
  });

  it('clears the chip when its form is reset', async () => {
    mounted = await mount(
      <main>
        <h1>Import</h1>
        <form aria-label="Import">
          <label htmlFor="file" id="file-label">
            GPX file
          </label>
          <FilePicker labelId="file-label">
            <input id="file" type="file" />
          </FilePicker>
          <button type="reset">Reset</button>
        </form>
      </main>,
    );
    await choose(choosable(), 'loop.gpx');
    expect(chip()).not.toBeNull();
    await act(async () => {
      document.querySelector('form')?.dispatchEvent(new Event('reset', { bubbles: true }));
      await Promise.resolve();
    });
    expect(chip()).toBeNull();
  });

  it('says "Choose files" for a multiple input, and counts several in the chip', async () => {
    mounted = await mount(
      <main>
        <h1>Files</h1>
        <label htmlFor="file" id="file-label">
          Activity files
        </label>
        <FilePicker labelId="file-label">
          <input id="file" type="file" multiple className="oyl-input" />
        </FilePicker>
      </main>,
    );
    expect(document.querySelector('.oyl-file__button')?.textContent).toBe('Choose files');
    expect(document.querySelector('#file')?.className).toBe('oyl-file__input oyl-input');
    await choose(choosable(), 'a.fit', 'b.fit', 'c.fit');
    expect(chip()?.textContent).toBe('3 files');
  });

  it("takes the button's words from the caller", async () => {
    mounted = await mount(
      <main>
        <h1>Files</h1>
        <label htmlFor="file" id="file-label">
          A folder
        </label>
        <FilePicker choose="Choose a folder" labelId="file-label">
          <input id="file" type="file" multiple />
        </FilePicker>
      </main>,
    );
    expect(document.querySelector('.oyl-file__button')?.textContent).toBe('Choose a folder');
  });

  // #1038, WCAG 2.2 SC 2.5.3: a speech-input user says the words they SEE on
  // the control, so the input's name holds the button's words as well as the
  // screen's label — and the words are still hidden from a screen reader as
  // text of their own, so they are not heard twice.
  for (const [choose, multiple, words] of [
    [undefined, false, 'Choose file'],
    [undefined, true, 'Choose files'],
    ['Choose a folder', true, 'Choose a folder'],
  ] as const) {
    it(`names the input with its label AND "${words}", the words on the button`, async () => {
      mounted = await mount(
        <main>
          <h1>Files</h1>
          <label htmlFor="file" id="file-label">
            Activity files
          </label>
          <FilePicker choose={choose} labelId="file-label">
            <input id="file" type="file" multiple={multiple} />
          </FilePicker>
        </main>,
      );
      const input = choosable();
      const button = document.querySelector('.oyl-file__button');
      expect(button?.textContent).toBe(words);
      expect(button?.getAttribute('aria-hidden')).toBe('true');
      expect(accessibleName(input)).toBe(`Activity files ${words}`);
      // The label still points at the input, so a press on it opens the picker.
      expect(input.labels?.[0]?.id).toBe('file-label');
      expect(formatViolations(auditAccessibility(document))).toBe('');
    });
  }

  it('says nothing for an empty choice', () => {
    expect(chosenText(null)).toBeUndefined();
    expect(chosenText(fileList())).toBeUndefined();
    expect(chosenText(fileList('one.gpx'))).toBe('one.gpx');
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
