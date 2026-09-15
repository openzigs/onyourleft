// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the routes screen's import form said, and the route it makes — #296.
 *
 * ## Why the form reading is a module rather than three lines in the handler
 *
 * Because of what #296 actually was. `RouteProfile.loop` has worked since #89,
 * `packages/store` has round-tripped it since #73, and three shipped features
 * read it — #253's wrapped road markers, #285's `on lap 2` and #287's `25% of
 * lap 2`. Every one of them was **unreachable**, because no production caller
 * ever passed `loop: true` to `routeFromGpx`. The defect was entirely in the
 * wiring, and the wiring is exactly what no test in this repository could see:
 * `testing/mount.tsx` explains, at length and from a previous false pass, that
 * **jsdom cannot put a file into a `<input type="file">`**, so a test that
 * submits this screen's import form can never get as far as a decoded route.
 *
 * So the step from *a submitted form* to *a route to save* is here, taking a
 * `FormData` it is handed rather than one it builds. A test constructs one with
 * a real `File` in it and drives the whole path; `RoutesView.test.tsx` builds
 * another out of the **rendered** form to pin the field names the two halves
 * agree on. What is left unwitnessed is one expression —
 * `new FormData(event.currentTarget)` — which is as small as this can be made.
 *
 * ## The loop is declared, not inferred
 *
 * #296 asks whether the geometry could decide it, since the ends are right
 * there and 25 m is already the threshold. **It does not**, and the reason is
 * that inferring changes what an existing import means: a rider's out-and-back
 * that happens to finish in the same car park would silently start wrapping,
 * and a ride round a lake that ends 30 m along the towpath would silently not —
 * with nothing on either screen to say which happened or why. A tick box is a
 * claim the rider made and the refusal below is the only place the geometry
 * gets a vote. The route builder (#71) is deliberately untouched: a rider who
 * draws back to their start has said it with the geometry, and what that should
 * mean is its own question with its own screen.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { RouteId, RouteRecord } from '@onyourleft/store';

import { routeFromGpx, type SaveOutcome } from './save';

/** The file input's `name`. Shared so the form and the reader cannot drift. */
export const FILE_FIELD = 'file';

/** The loop checkbox's `name`. Same reason. */
export const LOOP_FIELD = 'loop';

/** What a rider is told when they pressed Import without choosing anything. */
export const CHOOSE_A_FILE = 'Choose a GPX file to import.';

/** What a rider is told when the file they chose could not be read off the disk. */
export const FILE_NOT_READABLE =
  'That file could not be read from your device. Choose it again and retry.';

/**
 * The file a rider chose, or `undefined` because they chose none.
 *
 * ⚠️ **`instanceof File` is NOT the test, and this is the HTML specification
 * rather than a quirk**: a file input with no selection still appends an entry
 * holding a `File` with an empty name, a type of `application/octet-stream` and
 * no body. So the obvious guard passes, the empty body reaches the decoder, and
 * a rider who pressed Import by mistake is told their file is not valid GPX —
 * which sends them to look at a file they never chose. The name is the
 * discriminator: a chosen file always has one.
 *
 * Found in #202's review of the identical guard on the workouts screen.
 */
export function chosenFile(form: FormData): File | undefined {
  const value = form.get(FILE_FIELD);
  return value instanceof File && value.name !== '' ? value : undefined;
}

/**
 * Whether the rider said this route is a loop.
 *
 * ⚠️ **Presence, not the value.** A browser sends `on` for a ticked checkbox
 * with no `value` of its own and sends that `value` when it has one, so a reader
 * comparing against `'on'` would drop the rider's answer the day somebody adds
 * an attribute. An unticked box sends nothing at all, which is why absence is
 * the whole of "no".
 */
export function loopChosen(form: FormData): boolean {
  return form.get(LOOP_FIELD) !== null;
}

/** Everything about the route that does not come out of the form. */
export interface FormImportOptions {
  readonly id: RouteId;
  readonly owner: RouteRecord['createdBy'];
  /** Passed in rather than read: nothing here consults a clock. */
  readonly now: UnixSeconds;
}

/**
 * Turn a submitted import form into a route to save, or say why not.
 *
 * **Never throws.** Every failure a form or a file can produce comes back as a
 * refusal carrying a sentence, because the caller is a submit handler and an
 * exception there replaces the screen with nothing.
 */
export async function routeFromImportForm(
  form: FormData,
  options: FormImportOptions,
): Promise<SaveOutcome> {
  const file = chosenFile(form);
  if (file === undefined) {
    return { status: 'refused', refusal: { code: 'unreadable-file', message: CHOOSE_A_FILE } };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    // A real case rather than defensive padding: a `File` is a handle onto
    // something on disk, and a browser rejects the read when it has moved or
    // changed since the picker handed it over. Unhandled, it is a rejected
    // promise inside a click handler and the screen simply does nothing.
    return { status: 'refused', refusal: { code: 'unreadable-file', message: FILE_NOT_READABLE } };
  }

  return routeFromGpx(text, {
    id: options.id,
    owner: options.owner,
    fileName: file.name,
    now: options.now,
    loop: loopChosen(form),
  });
}
