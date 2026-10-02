// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type DragEvent, type JSX, type ReactElement } from 'react';

/**
 * A drop zone around a file input — #994.
 *
 * The input is the caller's own `<input type="file">`, passed as the one
 * child, and it stays the way in: its button is drawn as a secondary button
 * (`theme.css` §"The file input's button"), and a keyboard, a screen reader
 * and a phone all use it exactly as before. On a window wide enough to drag a
 * file onto (`theme.css` §"A DROP ZONE"), the zone is drawn round it with one
 * line saying so.
 *
 * A dropped file is handed to the INPUT — its `files` set and a `change` event
 * sent — so the screen's own handler, or the form that reads the input on
 * submit, takes it as though it was chosen. No second import path exists to
 * drift from the first. A drop with more files than the input accepts
 * (`multiple` absent) hands over the first only, as the picker would.
 *
 * A `span` rather than a `div`, because the screens put a file input inside a
 * `<p>` and a block there would be hoisted out of it by the parser.
 *
 * The hint is plain text, not a control, and says nothing the button does not:
 * dropping is a pointer's shortcut to the same thing.
 */
export interface FileDropProps {
  /** The line drawn in the zone on a tablet: "Or drop a GPX file here". */
  readonly hint: string;
  /** The `<input type="file">` itself. */
  readonly children: ReactElement;
}

export function FileDrop(props: FileDropProps): JSX.Element {
  const zone = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState(false);
  const accepts = (event: DragEvent): boolean =>
    [...event.dataTransfer.types].includes('Files') &&
    (zone.current?.querySelector('input[type="file"]') ?? null) !== null;
  // A zone is a drop target only while each `dragenter` and `dragover` is
  // cancelled; an uncancelled one leaves the browser's own drop, which opens
  // the file in place of the app.
  const over = (event: DragEvent): void => {
    if (!accepts(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  return (
    <span
      className="oyl-drop"
      ref={zone}
      data-oyl-dragging={dragging ? '' : undefined}
      onDragEnter={(event) => {
        over(event);
      }}
      onDragOver={(event) => {
        over(event);
      }}
      onDragLeave={(event) => {
        if (!zone.current?.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        setDragging(false);
        const input = zone.current?.querySelector<HTMLInputElement>('input[type="file"]');
        if (input === null || input === undefined || event.dataTransfer.files.length === 0) {
          return;
        }
        event.preventDefault();
        handOver(input, event.dataTransfer.files);
      }}
    >
      {props.children}
      <span className="oyl-drop__hint">{props.hint}</span>
    </span>
  );
}

/**
 * Give `files` to `input` as though they had been chosen in its picker.
 *
 * A `FileList` cannot be constructed, so a `DataTransfer` builds one; that is
 * the platform's own way, and jsdom has no `DataTransfer`, so a test hands a
 * list in through the drop event and this sets it directly when it can.
 */
export function handOver(input: HTMLInputElement, files: FileList): void {
  input.files = input.multiple || files.length <= 1 ? files : firstOnly(files);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function firstOnly(files: FileList): FileList {
  const first = files[0];
  if (typeof DataTransfer === 'undefined' || first === undefined) {
    return files;
  }
  const transfer = new DataTransfer();
  transfer.items.add(first);
  return transfer.files;
}
