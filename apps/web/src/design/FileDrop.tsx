// SPDX-License-Identifier: AGPL-3.0-or-later

import { X } from 'lucide-react';
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type InputHTMLAttributes,
  type JSX,
  type ReactElement,
} from 'react';

/**
 * A drop zone around a file input — #994.
 *
 * The input is the caller's own `<input type="file">`, passed as the one
 * child, and it stays the way in: since #1030 it is drawn by `FilePicker`
 * below — a styled button with the input laid invisibly over it — and a
 * keyboard, a screen reader and a phone all use it exactly as before. On a window wide enough to drag a
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
  readonly children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  /** The styled button's words; `FilePicker`'s default when absent. */
  readonly choose?: string;
  /** The `id` of the screen's own `<label>` for the input — see `FilePicker`. */
  readonly labelId: string;
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
      <FilePicker choose={props.choose} labelId={props.labelId}>
        {props.children}
      </FilePicker>
      <span className="oyl-drop__hint">{props.hint}</span>
    </span>
  );
}

/**
 * A file input drawn as a button, with what was chosen as a chip — #1030.
 *
 * On the tablet the browser's own *"Choose File · No file chosen"* read as a
 * web form. The input is still the control — the caller's own element, named
 * by the caller's own label, in the tab order, opened by Enter and Space and
 * by a press — but it is laid OVER a styled button at `opacity: 0`
 * (`theme.css` §"A FILE PICKER"), so a press on the button is a press on the
 * input and the platform opens its picker, with no `click()` from script. Its
 * keyboard focus is drawn on the button by a sibling selector.
 *
 * The button's words are `aria-hidden`, so a screen reader does not hear them
 * twice, but they ARE in the input's name — #1038, WCAG 2.2 SC 2.5.3 (Label
 * in Name): a speech-input user says the words they see on the control,
 * "click Choose file", and the name has to contain them. The input is named
 * by `aria-labelledby` over the screen's own label and then the button —
 * "Activity files Choose files" — which is why {@link FilePickerProps.labelId}
 * is required: a picker cannot be added without naming its label, and the
 * label keeps its `htmlFor`, so a press on it still reaches the input. The
 * platform's own button had the same gap (its words were never in the
 * label); now that the words are ours, so is closing it.
 *
 * Once something is chosen its name — or how many, for several — is shown as
 * a chip with a remove button, which empties the input, tells the screen
 * through the input's own `change`, and puts focus back on the input. The
 * chip is read from the input at each `change` and cleared on its form's
 * `reset`, so a screen that empties the input in its handler (Documents does,
 * so the same file can be chosen twice) shows no chip at all.
 *
 * ⚠️ **The caller's contract.** The chip follows the input only through those
 * two events. A screen that empties the input in script anywhere else — a
 * `value = ''` outside its own `change` handler, or a second picker taking
 * over the selection (Files' files and folder pickers, #1030's review) — must
 * dispatch a bubbling `change` on it afterwards, or the chip goes on naming
 * files that are no longer chosen. And a screen with two pickers keeps ONE
 * selection: each picker draws only its own input's chip, so the screen
 * empties the other input when one is chosen, and ignores an empty `change`
 * from a picker that was not holding the selection.
 */
export interface FilePickerProps {
  /** The `<input type="file">` itself. */
  readonly children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  /** The button's words: "Choose file", or "Choose files" for a `multiple` input. */
  readonly choose?: string | undefined;
  /**
   * The `id` of the screen's own `<label>` for the input (#1038). The input's
   * name is that label's words and then the button's.
   */
  readonly labelId: string;
}

export function FilePicker(props: FilePickerProps): JSX.Element {
  const holder = useRef<HTMLSpanElement>(null);
  const buttonId = useId();
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const input = (): HTMLInputElement | null =>
    holder.current?.querySelector<HTMLInputElement>('input[type="file"]') ?? null;
  const read = (): void => {
    setChosen(chosenText(input()?.files ?? null));
  };
  useEffect(() => {
    const form = input()?.form ?? null;
    if (form === null) {
      return undefined;
    }
    const reset = (): void => {
      setChosen(undefined);
    };
    form.addEventListener('reset', reset);
    return () => {
      form.removeEventListener('reset', reset);
    };
  }, []);
  const child = props.children;
  const words = props.choose ?? (child.props.multiple === true ? 'Choose files' : 'Choose file');
  // A space either side, so the button's words are never run into the
  // label's or a drop zone's hint as text (`testing/route-sentences.ts`).
  return (
    <>
      {' '}
      <span className="oyl-file" ref={holder} onChange={read}>
        {cloneElement(child, {
          className: ['oyl-file__input', child.props.className].filter(Boolean).join(' '),
          'aria-labelledby': `${props.labelId} ${buttonId}`,
        })}
        <span className="oyl-file__button" id={buttonId} aria-hidden="true">
          {words}
        </span>
      </span>
      {chosen !== undefined && (
        <span className="oyl-file__chip">
          <span className="oyl-file__name">{chosen}</span>
          <button
            type="button"
            className="oyl-file__remove"
            aria-label={`Remove ${chosen}`}
            onClick={() => {
              const element = input();
              setChosen(undefined);
              if (element === null) {
                return;
              }
              element.value = '';
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.focus();
            }}
          >
            <X aria-hidden="true" focusable="false" />
          </button>
        </span>
      )}{' '}
    </>
  );
}

/** What the chip says: the one file's name, or how many there are. */
export function chosenText(files: FileList | null): string | undefined {
  const count = files?.length ?? 0;
  if (count === 0) {
    return undefined;
  }
  return count === 1 ? (files?.[0]?.name ?? '1 file') : `${String(count)} files`;
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
