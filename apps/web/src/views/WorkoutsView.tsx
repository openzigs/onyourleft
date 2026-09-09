// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import type { WorkoutBlock } from '@onyourleft/domain';
import type { WorkoutId, WorkoutRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { DownloadableFile } from '../transfer/store-port';
import {
  blockFromDraft,
  EMPTY_DRAFT,
  workoutToSave,
  type BlockDraft,
  type BuildRefusal,
} from '../workouts/build';
import { blockText, workoutRow, type WorkoutRow } from '../workouts/library';
import { WORKOUT_LIST_LIMIT, type WorkoutPort } from '../workouts/store-port';
import { exportedWorkout, workoutFromFile } from '../workouts/transfer';

/**
 * Workouts (#14) — the ones this device holds, and building a new one.
 *
 * ## What this screen is careful about
 *
 * **A percentage box is labelled as one and converted once.** `build.ts` is
 * where a typed `110` becomes `1.1 × threshold`, and this screen never does
 * that arithmetic itself. The two numbers are a factor of a hundred apart and
 * both are valid as far as every type in the program is concerned, which is
 * why the conversion has exactly one home.
 *
 * **A refusal is shown and nothing is written.** `SegmentsView.tsx`'s rule: a
 * screen that showed one thing and stored another would be lying in whichever
 * direction was convenient. Every refusal here comes back from a pure function
 * that is tested on its own.
 *
 * **Blocks are added one at a time and listed in order.** A workout is built
 * up rather than typed into one box, because the alternative is a text format,
 * and there is no workout file format — ADR 0009 and CLAUDE.md §6 record why,
 * and #202 is the issue that settles it.
 *
 * **Colour carries nothing.** A block's kind is a word in its own cell, for
 * `AnalysisView.tsx`'s reason, and the workout's shape is a sentence rather
 * than a chart — see `library.ts` for why the words are the primary form and
 * not a fallback.
 *
 * ⚠️ **Nothing here rides a workout.** Choosing one and running it against a
 * trainer is the ride screen's, and it is the remaining slice of #14: this
 * screen is the library and the builder. The loop that would run it exists and
 * is tested (`workout/session.ts`); what is missing is the control on the ride
 * screen that starts it.
 */

/** One text field of a submitted form. See `SegmentsView.tsx` for why this narrows. */
function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** The words for a block kind, in the order the picker offers them. */
const BLOCK_KINDS: readonly { readonly kind: WorkoutBlock['kind']; readonly label: string }[] = [
  { kind: 'steady', label: 'Steady' },
  { kind: 'intervals', label: 'Intervals' },
  { kind: 'ramp', label: 'Ramp' },
  { kind: 'free-ride', label: 'Free ride' },
];

export interface WorkoutsViewProps {
  /**
   * `undefined` where this browser has no local store — the same shape every
   * other screen's port has, and for the same reason: the accessibility suite
   * renders every route on a machine with no IndexedDB worth the name.
   */
  readonly port?: WorkoutPort | undefined;
  /** Injected so the suite can assert what was written. `main.tsx` passes the real clock. */
  readonly now?: () => number;
  /**
   * Hands a file to the browser to download. `undefined` where this build has
   * no way to save one, and the export control is then not offered at all
   * rather than offered and inert — `RoutesView.tsx`'s rule.
   */
  readonly save?: ((file: DownloadableFile) => void) | undefined;
}

/**
 * A listed workout, and the record it came from.
 *
 * ⚠️ **Both, rather than the row alone.** A `WorkoutRow` is a summary built for
 * reading — a duration in words, a shape in a sentence — and nothing in it can
 * be encoded back into a file. Keeping the record beside it means export
 * re-encodes what the list already decoded instead of reading the store a
 * second time, which is the call `RoutesView.tsx` makes for a much heavier row.
 */
interface WorkoutEntry {
  readonly row: WorkoutRow;
  readonly record: WorkoutRecord;
}

export function WorkoutsView({ port, now, save }: WorkoutsViewProps): JSX.Element {
  const [entries, setEntries] = useState<readonly WorkoutEntry[] | undefined>(undefined);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<BuildRefusal | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<BlockDraft>(EMPTY_DRAFT);
  const [blocks, setBlocks] = useState<readonly WorkoutBlock[]>([]);
  const [pendingDelete, setPendingDelete] = useState<WorkoutRow | undefined>(undefined);
  const [fileFault, setFileFault] = useState<string | undefined>(undefined);
  const [fileNote, setFileNote] = useState<string | undefined>(undefined);

  const clock = useCallback((): number => (now === undefined ? Date.now() / 1000 : now()), [now]);

  const reload = useCallback(async (): Promise<void> => {
    if (port === undefined) {
      setEntries([]);
      return;
    }
    try {
      const list = await port.store.listWorkouts(port.athleteId, WORKOUT_LIST_LIMIT);
      // ⚠️ `workoutRow` expands each workout, and `expandWorkout` validates.
      // A row that cannot be expanded is a row that could not be ridden, so the
      // list reports the failure rather than rendering a name a rider could
      // press.
      setEntries(list.map((record) => ({ row: workoutRow(record), record })));
      setLoadFault(undefined);
    } catch {
      // A store that throws is what "offline" looks like on this device: there
      // is no network to be offline from, and the screen says so rather than
      // rendering nothing.
      setEntries([]);
      setLoadFault(
        'Your saved workouts could not be read on this device. Everything here is stored ' +
          'locally, so this is not a connection problem — reload the page to try again.',
      );
    }
  }, [port]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onAddBlock = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const outcome = blockFromDraft(draft);
      if (outcome.status === 'refused') {
        setRefusal(outcome.refusal);
        setSaved(undefined);
        return;
      }
      setBlocks((current) => [...current, outcome.value]);
      // The kind is kept and everything else cleared: a rider adding six
      // intervals blocks should not re-pick "Intervals" six times, and a rider
      // who wanted a different kind is one click from it.
      setDraft({ ...EMPTY_DRAFT, kind: draft.kind });
      setRefusal(undefined);
      setSaved(undefined);
    },
    [draft],
  );

  const onRemoveBlock = useCallback((index: number): void => {
    setBlocks((current) => current.filter((_, at) => at !== index));
    setSaved(undefined);
  }, []);

  const onSave = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (port === undefined) return;
      const form = new FormData(event.currentTarget);
      const outcome = workoutToSave({
        id: `workout-${String(Math.round(clock() * 1000))}` as WorkoutId,
        owner: port.athleteId,
        name: fieldOf(form, 'name'),
        blocks,
        now: clock(),
      });
      if (outcome.status === 'refused') {
        setRefusal(outcome.refusal);
        setSaved(undefined);
        return;
      }
      await port.store.putWorkout(outcome.value);
      setRefusal(undefined);
      setSaved(`Saved “${outcome.value.name}”.`);
      setBlocks([]);
      setDraft(EMPTY_DRAFT);
      await reload();
    },
    [blocks, clock, port, reload],
  );

  /**
   * ⚠️ **Re-encodes from the record already in hand.** The list read decoded it
   * — that is what `WORKOUT_LIST_LIMIT` budgets for — so reading the store
   * again would decode the same blocks to produce the same bytes.
   */
  const onExport = useCallback(
    (record: WorkoutRecord): void => {
      if (save === undefined) return;
      const file = exportedWorkout(record);
      save(file);
      setFileFault(undefined);
      setFileNote(`${file.fileName} is ready. It holds the workout, not any ride you did of it.`);
    },
    [save],
  );

  const onImport = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (port === undefined) return;
      const chosen = new FormData(event.currentTarget).get('file');
      // ⚠️ `instanceof File` is NOT the test for "a file was chosen", and this
      // is the HTML specification rather than a quirk: a file input with no
      // selection still appends an entry, holding a `File` with an empty name,
      // a type of `application/octet-stream` and no body. So the obvious guard
      // passes, the empty body reaches the decoder, and a rider who pressed
      // import without choosing anything is told their file is not valid JSON.
      // The name is the discriminator — a chosen file always has one.
      if (!(chosen instanceof File) || chosen.name === '') {
        setFileNote(undefined);
        setFileFault('Choose a workout file to import.');
        return;
      }
      const outcome = workoutFromFile(await chosen.text(), {
        id: `workout-${String(Math.round(clock() * 1000))}` as WorkoutId,
        owner: port.athleteId,
        now: clock(),
      });
      if (outcome.status === 'refused') {
        // Shown and nothing written. The refusal is a value a pure function
        // returned, which is what lets the test assert the sentence a rider
        // sees rather than that some error happened.
        setFileNote(undefined);
        setFileFault(outcome.refusal.message);
        return;
      }
      await port.store.putWorkout(outcome.record);
      setFileFault(undefined);
      setFileNote(`Imported \u201C${outcome.record.name}\u201D.`);
      await reload();
    },
    [clock, port, reload],
  );

  const onDelete = useCallback(
    async (row: WorkoutRow): Promise<void> => {
      if (port === undefined) return;
      await port.store.deleteWorkout(port.athleteId, row.id as WorkoutId);
      setPendingDelete(undefined);
      setSaved(`Deleted “${row.name}”.`);
      await reload();
    },
    [port, reload],
  );

  if (port === undefined) {
    return (
      <section>
        <h2>Workouts are not available in this browser</h2>
        <p>
          Workouts are stored on this device, and this browser has no local store this app can use.
          Nothing has been lost — a browser with local storage available will show your workouts.
        </p>
      </section>
    );
  }

  const needsTarget =
    draft.kind === 'steady' || draft.kind === 'ramp' || draft.kind === 'intervals';

  return (
    <section>
      <h2>Build a workout</h2>
      <p>
        Targets are a percentage of your own threshold power, so the same workout works whatever
        shape you are in. A free-ride block releases the trainer instead of holding a target.
      </p>

      <form onSubmit={onAddBlock}>
        <h3>Add a block</h3>
        <p>
          <label htmlFor="block-kind">Kind</label>
          <select
            id="block-kind"
            name="kind"
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value as WorkoutBlock['kind'] })
            }
          >
            {BLOCK_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="block-minutes">
            {draft.kind === 'intervals' ? 'Hard interval, minutes' : 'Minutes'}
          </label>
          <input
            id="block-minutes"
            name="minutes"
            type="text"
            inputMode="decimal"
            value={draft.minutes}
            onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
          />
        </p>
        {needsTarget ? (
          <p>
            <label htmlFor="block-percent">
              {draft.kind === 'ramp'
                ? 'Starting target, % of threshold'
                : draft.kind === 'intervals'
                  ? 'Hard target, % of threshold'
                  : 'Target, % of threshold'}
            </label>
            <input
              id="block-percent"
              name="percent"
              type="text"
              inputMode="decimal"
              value={draft.percent}
              onChange={(event) => setDraft({ ...draft, percent: event.target.value })}
            />
          </p>
        ) : null}
        {draft.kind === 'ramp' ? (
          <p>
            <label htmlFor="block-to-percent">Finishing target, % of threshold</label>
            <input
              id="block-to-percent"
              name="toPercent"
              type="text"
              inputMode="decimal"
              value={draft.toPercent}
              onChange={(event) => setDraft({ ...draft, toPercent: event.target.value })}
            />
          </p>
        ) : null}
        {draft.kind === 'intervals' ? (
          <>
            <p>
              <label htmlFor="block-repeats">How many times</label>
              <input
                id="block-repeats"
                name="repeats"
                type="text"
                inputMode="numeric"
                value={draft.repeats}
                onChange={(event) => setDraft({ ...draft, repeats: event.target.value })}
              />
            </p>
            <p>
              <label htmlFor="block-easy-minutes">Recovery, minutes</label>
              <input
                id="block-easy-minutes"
                name="easyMinutes"
                type="text"
                inputMode="decimal"
                value={draft.easyMinutes}
                onChange={(event) => setDraft({ ...draft, easyMinutes: event.target.value })}
              />
            </p>
            <p>
              <label htmlFor="block-easy-percent">Recovery target, % of threshold</label>
              <input
                id="block-easy-percent"
                name="easyPercent"
                type="text"
                inputMode="decimal"
                value={draft.easyPercent}
                onChange={(event) => setDraft({ ...draft, easyPercent: event.target.value })}
              />
            </p>
          </>
        ) : null}
        <p>
          <label htmlFor="block-label">Label, optional</label>
          <input
            id="block-label"
            name="label"
            type="text"
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </p>
        <Button type="submit">Add block</Button>
      </form>

      <h3>This workout</h3>
      {blocks.length === 0 ? (
        <p>No blocks yet. Add one above.</p>
      ) : (
        <ol>
          {blocks.map((block, index) => (
            <li key={`${block.kind}-${String(index)}`}>
              {blockText(block)}{' '}
              <Button
                type="button"
                onClick={() => {
                  onRemoveBlock(index);
                }}
              >
                Remove block {String(index + 1)}
              </Button>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={(event) => void onSave(event)}>
        <p>
          <label htmlFor="workout-name">Name</label>
          <input id="workout-name" name="name" type="text" />
        </p>
        <Button type="submit">Save workout</Button>
      </form>

      {refusal === undefined ? null : (
        <StatusMessage tone="warning">{refusal.message}</StatusMessage>
      )}
      {saved === undefined ? null : <StatusMessage tone="success">{saved}</StatusMessage>}

      <h2>Import a workout</h2>
      <p>
        A workout file written by On Your Left. The file is read on this device and never sent
        anywhere. Files from other training apps are not read yet.
      </p>
      <form onSubmit={(event) => void onImport(event)}>
        <p>
          <label htmlFor="workout-file">Workout file</label>
          <input id="workout-file" name="file" type="file" accept=".json,application/json" />
        </p>
        <Button type="submit">Import workout</Button>
      </form>

      {fileFault === undefined ? null : (
        <StatusMessage tone="warning" live>
          {fileFault}
        </StatusMessage>
      )}
      {fileNote === undefined ? null : (
        <StatusMessage tone="success" live>
          {fileNote}
        </StatusMessage>
      )}

      <h2>Saved workouts</h2>
      {loadFault === undefined ? null : <StatusMessage tone="warning">{loadFault}</StatusMessage>}
      {entries === undefined ? (
        <p>Reading your workouts…</p>
      ) : entries.length === 0 ? (
        <p>No workouts saved on this device yet.</p>
      ) : (
        <table>
          <caption>Workouts saved on this device, newest first.</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Length</th>
              <th scope="col">Hardest</th>
              <th scope="col">Shape</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ row, record }) => (
              <tr key={row.id}>
                <th scope="row">{row.name}</th>
                <td>{row.duration}</td>
                <td>
                  {row.hardestPercent === undefined
                    ? 'No target'
                    : `${String(row.hardestPercent)}% of threshold`}
                </td>
                <td>{row.shape}</td>
                <td>
                  {save === undefined ? null : (
                    <Button
                      type="button"
                      onClick={() => {
                        onExport(record);
                      }}
                    >
                      Export {row.name}
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={() => {
                      setPendingDelete(row);
                    }}
                  >
                    Delete {row.name}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pendingDelete === undefined ? null : (
        <section>
          <h3>Delete “{pendingDelete.name}”?</h3>
          <p>
            This removes the workout from this device. It does not affect any ride you have already
            recorded.
          </p>
          <Button
            type="button"
            onClick={() => {
              void onDelete(pendingDelete);
            }}
          >
            Delete “{pendingDelete.name}”
          </Button>
          <Button
            type="button"
            onClick={() => {
              setPendingDelete(undefined);
            }}
          >
            Keep it
          </Button>
        </section>
      )}
    </section>
  );
}
