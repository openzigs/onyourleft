// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
} from 'react';

import {
  expandWorkout,
  type Workout,
  type WorkoutBlock,
  type WorkoutTimeline,
} from '@onyourleft/domain';
import type { WorkoutId, WorkoutRecord } from '@onyourleft/store';

import { ConfirmDialog } from '../design/ConfirmDialog';
import { Button } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { FileDrop } from '../design/FileDrop';
import { SectionHeading } from '../design/SectionHelp';
// The part's own module, not the kit's index: this list reaches only what it draws (#941).
import { WorkoutShape } from '../design/illustration/WorkoutShape';
import { StatusMessage } from '../design/StatusMessage';
import { Stepper } from '../design/Stepper';
import type { DownloadableFile } from '../transfer/store-port';
import {
  blockFromDraft,
  EMPTY_DRAFT,
  workoutToSave,
  type BlockDraft,
  type BuildRefusal,
} from '../workouts/build';
import { BlockChart } from '../workouts/BlockChart';
import { blockText, workoutRow, type WorkoutRow } from '../workouts/library';
import { WORKOUT_LIST_LIMIT, type WorkoutPort } from '../workouts/store-port';
import { exportedWorkout, workoutFromFile } from '../workouts/transfer';
import {
  CREATE_HEADING_ID,
  CreateLink,
  ListDetail,
  SELECTED_HEADING_ID,
} from '../shell/ListDetail';
import { hrefFor, hrefForSelection, routeById } from '../shell/routes';

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
 * and there is no workout file format — ADR 0009 and docs/agents/scope-and-ip.md §6 record why,
 * and #202 is the issue that settles it.
 *
 * **Colour carries nothing.** A block's kind is a word in its own cell, for
 * `AnalysisView.tsx`'s reason, and the workout's shape is a sentence — see
 * `library.ts` for why the words are the primary form and not a fallback.
 * Since #1043 a block chart sits beside those words, on a saved workout and in
 * the builder, `aria-hidden` and repeating them (`workouts/BlockChart.tsx`).
 *
 * **A list beside its detail — #670.** The saved workouts are the list;
 * choosing one (`#/workouts/selected/<id>`) puts it, with its export and its
 * delete, at the head of the detail pane, above the builder and the import
 * that the pane always holds. A workout not in the list the screen read is
 * read on its own (`store-port.ts` §`getWorkout`, whose first caller this is).
 *
 * ⚠️ **Nothing here rides a workout.** Choosing one and running it against a
 * trainer is the ride screen's, and it is the remaining slice of #14: this
 * screen is the library and the builder. The loop that would run it exists and
 * is tested (`workout/session.ts`); what is missing is the control on the ride
 * screen that starts it.
 */

/** The words for a block kind, in the order the picker offers them. */
const BLOCK_KINDS: readonly { readonly kind: BlockDraft['kind']; readonly label: string }[] = [
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
  /** The selected workout's id, from `#/workouts/selected/<id>` — #670. */
  readonly selected?: string | undefined;
}

/** A selected workout that was not in the list, read on its own. */
type Fetched =
  | { readonly id: string; readonly kind: 'found'; readonly entry: WorkoutEntry }
  | { readonly id: string; readonly kind: 'missing' }
  | { readonly id: string; readonly kind: 'failed' };

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

/** A workout in the list: its entry, and what its card draws. */
interface ListedWorkout extends WorkoutEntry {
  /**
   * The workout expanded, for the card's drawn shape — #941. From the record
   * already in hand: drawing it costs no read. It is expanded once per load
   * and handed to `workoutRow`, which would otherwise expand it again.
   */
  readonly timeline: WorkoutTimeline;
}

/**
 * A card's drawing — #941: the blocks as bars of relative height, from the
 * timeline the list already expanded. Decoration: no number reaches it, and
 * the card's words carry the workout.
 *
 * `memo`, because the timeline is the one the list read set into state, and
 * the builder beside the list re-renders this view on every keystroke: without
 * it every card's outline (up to `WORKOUT_LIST_LIMIT` of them) is drawn again
 * for a character typed into a name.
 */
const WorkoutCardArt = memo(function WorkoutCardArt({
  timeline,
}: {
  readonly timeline: WorkoutTimeline;
}): JSX.Element {
  return (
    <div className="oyl-shape-card__art tw:h-(--oyl-shape-card-art-height)">
      <WorkoutShape workout={timeline} className="tw:block tw:size-full" />
    </div>
  );
});

/**
 * A workout's block chart — #1043 — or nothing, for one that cannot be expanded.
 *
 * The builder hands it blocks that are each valid but may not yet make a
 * rideable workout (none at all, or more than `MAXIMUM_SEGMENTS` between them):
 * `expandWorkout` refuses those, and the builder's own refusal is what says so
 * when the rider presses *Save workout*. Drawn from the blocks as they stand,
 * so it follows every add and remove.
 */
const WorkoutBlockChart = memo(function WorkoutBlockChart({
  blocks,
}: {
  readonly blocks: Workout['blocks'];
}): JSX.Element | null {
  const timeline = useMemo((): WorkoutTimeline | undefined => {
    // An empty builder is not expanded at all: there is nothing to draw, and
    // `expandWorkout` would only throw (#941's count of expansions per load).
    if (blocks.length === 0) return undefined;
    try {
      return expandWorkout({ name: '', blocks });
    } catch {
      return undefined;
    }
  }, [blocks]);
  return timeline === undefined ? null : <BlockChart segments={timeline.segments} />;
});

/**
 * A new workout's id: `workout-` and a random UUID, never the clock (#1100).
 * Since saved workouts sync both ways across a rider's devices, an id is a
 * key on the instance, and one minted from a device's clock in milliseconds
 * — as it was until then — collides when two devices save in the same
 * millisecond, and the instance would then hold whichever synced last.
 * `crypto.randomUUID`, as a ride's and a route's id are (`main.tsx`).
 */
const newWorkoutId = (): WorkoutId => `workout-${globalThis.crypto.randomUUID()}` as WorkoutId;

export function WorkoutsView({ port, now, save, selected }: WorkoutsViewProps): JSX.Element {
  const [entries, setEntries] = useState<readonly ListedWorkout[] | undefined>(undefined);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<BuildRefusal | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<BlockDraft>(EMPTY_DRAFT);
  const [blocks, setBlocks] = useState<readonly WorkoutBlock[]>([]);
  /*
   * ⚠️ In state rather than read off the form, since #670's second review: a
   * chosen workout takes the builder's place in the detail pane, so the name
   * box is UNMOUNTED while one is shown — and an uncontrolled box came back
   * empty, with the blocks it was named for still listed above it.
   */
  const [name, setName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<WorkoutRow | undefined>(undefined);
  const [fileFault, setFileFault] = useState<string | undefined>(undefined);
  const [fileNote, setFileNote] = useState<string | undefined>(undefined);
  const [exported, setExported] = useState<string | undefined>(undefined);
  const [fetched, setFetched] = useState<Fetched | undefined>(undefined);
  const listCaptionId = useId();

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
      setEntries(
        list.map((record) => {
          const timeline = expandWorkout(record.workout);
          return { row: workoutRow(record, timeline), record, timeline };
        }),
      );
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

  /*
   * Choosing a workout clears what the builder last SAID — #670's second
   * review. Those messages are drawn in the builder, which is not on screen
   * while a workout is chosen, and coming back re-mounted a live region still
   * holding "Saved …" from a save long past. Cleared on choosing rather than
   * on every change of `selected`, because deleting the chosen workout sets
   * "Deleted …" and THEN lets go of the selection, and that sentence is the
   * one the builder should show on arrival.
   */
  useEffect(() => {
    if (selected === undefined) return;
    setSaved(undefined);
    setRefusal(undefined);
    setFileNote(undefined);
    setFileFault(undefined);
  }, [selected]);

  /*
   * #723: what the chosen workout's own page last said goes with it. The
   * "Delete …?" confirmation and the "….json is ready" note belong to ONE
   * workout, and moving straight from it to another — a second list link, at
   * two panes, with no stop at the list between — kept both, so the next
   * workout's page asked to delete the previous one by name. Cleared on EVERY
   * change of `selected`, unlike the builder's messages above: nothing here is
   * set in the same turn as a change of selection that should survive it
   * (`onDelete` clears both itself before it lets the selection go).
   */
  useEffect(() => {
    setPendingDelete(undefined);
    setExported(undefined);
  }, [selected]);

  const inList =
    selected === undefined ? undefined : entries?.find((entry) => entry.row.id === selected);
  const readAlone = selected !== undefined && entries !== undefined && inList === undefined;
  useEffect(() => {
    if (!readAlone || port === undefined || selected === undefined) {
      return undefined;
    }
    let live = true;
    port.store.getWorkout(port.athleteId, selected as WorkoutId).then(
      (record) => {
        if (!live) return;
        if (record === undefined) {
          setFetched({ id: selected, kind: 'missing' });
          return;
        }
        try {
          setFetched({ id: selected, kind: 'found', entry: { row: workoutRow(record), record } });
        } catch {
          setFetched({ id: selected, kind: 'failed' });
        }
      },
      () => {
        if (live) setFetched({ id: selected, kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
    // `entries` is here so a reload — after a delete — reads the workout again.
  }, [readAlone, port, selected, entries]);

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
      const outcome = workoutToSave({
        id: newWorkoutId(),
        owner: port.athleteId,
        name,
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
      /*
       * #723: the name goes with the blocks. The builder is a fresh workout
       * after a save — no blocks, the default draft — and a name left in the
       * box read as a workout of that name with nothing in it, which the next
       * one built here would silently inherit: two different workouts under
       * one name in the list. "Saved “…”." below still says what was saved.
       */
      setName('');
      await reload();
    },
    [blocks, clock, name, port, reload],
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
      setExported(`${file.fileName} is ready. It holds the workout, not any ride you did of it.`);
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
        id: newWorkoutId(),
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
      setExported(undefined);
      setSaved(`Deleted “${row.name}”.`);
      await reload();
      // The selection named what was just deleted; the list is where to be.
      if (selected === row.id) {
        globalThis.location.hash = hrefFor(routeById('workouts'));
      }
    },
    [port, reload, selected],
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

  const shown: Fetched | { readonly kind: 'found'; readonly entry: WorkoutEntry } | undefined =
    inList !== undefined
      ? { kind: 'found', entry: inList }
      : fetched?.id === selected
        ? fetched
        : undefined;

  const listed =
    entries === undefined ? (
      <p>Reading your workouts…</p>
    ) : (
      <>
        {loadFault === undefined ? null : <StatusMessage tone="warning">{loadFault}</StatusMessage>}
        {entries.length === 0 ? (
          // #943: with nothing saved, *Build a workout* is the empty state's
          // one action rather than a line above it.
          <EmptyState
            art="workout"
            heading="Your first workout"
            level={3}
            action={
              <CreateLink route={routeById('workouts')} selection={selected}>
                Build a workout
              </CreateLink>
            }
          >
            <p>No workouts saved on this device yet.</p>
          </EmptyState>
        ) : (
          <>
            <p className="oyl-muted" id={listCaptionId}>
              Workouts saved on this device, newest first.
            </p>
            <ul className="oyl-pane-list" aria-labelledby={listCaptionId}>
              {entries.map(({ row, timeline }) => (
                <li
                  key={row.id}
                  className="oyl-pane-list__item oyl-shape-card tw:grid tw:grid-cols-1"
                >
                  <a
                    className="tw:justify-self-start"
                    href={hrefForSelection(routeById('workouts'), row.id)}
                    data-oyl-select={row.id}
                    aria-current={row.id === selected ? 'true' : undefined}
                  >
                    {row.name}
                  </a>
                  <p className="oyl-muted tw:mb-0">
                    {row.duration} · hardest: {hardestText(row)}
                  </p>
                  <WorkoutCardArt timeline={timeline} />
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );

  const list = (
    <>
      {entries?.length === 0 ? null : (
        <p>
          <CreateLink route={routeById('workouts')} selection={selected}>
            Build a workout
          </CreateLink>
        </p>
      )}
      {listed}
    </>
  );

  const chosen =
    selected === undefined ? null : shown === undefined ? (
      <p>Reading this workout…</p>
    ) : shown.kind === 'found' ? (
      <div className="oyl-selected">
        <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
          {shown.entry.row.name}
        </h2>
        <dl className="oyl-activity-card__facts">
          <div>
            <dt>Length</dt>
            <dd>{shown.entry.row.duration}</dd>
          </div>
          <div>
            <dt>Hardest</dt>
            <dd>{hardestText(shown.entry.row)}</dd>
          </div>
          <div>
            <dt>Shape</dt>
            <dd>{shown.entry.row.shape}</dd>
          </div>
        </dl>

        <p>
          {save === undefined ? null : (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                onExport(shown.entry.record);
              }}
            >
              Export {shown.entry.row.name}
            </Button>
          )}{' '}
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setPendingDelete(shown.entry.row);
            }}
          >
            Delete {shown.entry.row.name}
          </Button>
        </p>
        {/* #1043: below the workout's own controls, so it pushes none of them down. */}
        <WorkoutBlockChart blocks={shown.entry.record.workout.blocks} />
        {exported === undefined ? null : (
          <StatusMessage tone="success" live>
            {exported}
          </StatusMessage>
        )}
        <ConfirmDialog
          open={pendingDelete !== undefined}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDelete(undefined);
            }
          }}
          title={`Delete “${pendingDelete?.name ?? ''}”?`}
          confirmLabel={`Delete “${pendingDelete?.name ?? ''}”`}
          cancelLabel="Keep it"
          onConfirm={() => {
            if (pendingDelete !== undefined) {
              void onDelete(pendingDelete);
            }
          }}
        >
          <p>
            This removes the workout from this device. It does not affect any ride you have already
            recorded.
          </p>
        </ConfirmDialog>
      </div>
    ) : (
      <div className="oyl-selected">
        <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
          {shown.kind === 'missing' ? 'Workout not found' : 'This workout could not be read'}
        </h2>
        <p>
          {shown.kind === 'missing'
            ? 'No workout with that address is saved on this device. It may have been deleted, ' +
              'or the link may have come from another device — workouts are never copied ' +
              'between them.'
            : 'It is stored on this device and could not be read back. Reload the page to try ' +
              'again.'}
        </p>
      </div>
    );

  return (
    <ListDetail
      route={routeById('workouts')}
      selection={selected}
      listLabel="Saved workouts"
      detailLabel="Workout"
      backLabel="All workouts"
      detailWithoutSelection
      list={list}
      detail={
        chosen ?? (
          // #1014: building one and importing one sit side by side where the
          // pane is wide enough (`theme.css` §"A screen of sections").
          <div className="oyl-sections">
            <div>
              <h2 id={CREATE_HEADING_ID} tabIndex={-1}>
                Build a workout
              </h2>

              {/*
            #1087: *Save workout*, its name and the line a save writes come
            FIRST, above the block list, so the builder's one primary does not
            move down with every block. Below the list it was about 120 px
            under the fold on a phone with four blocks, and 66 px above it on
            the owner's tablet in landscape, 16 px over the 50 px floor, which a
            fifth block would have spent (`controls-first.browser.spec.ts`
            §"#1050"). A rider names and saves what the list below holds.
          */}
              <form aria-label="Save this workout" onSubmit={(event) => void onSave(event)}>
                <p>
                  <label htmlFor="workout-name">Name</label>
                  <input
                    id="workout-name"
                    name="name"
                    type="text"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                </p>
                <Button type="submit">Save workout</Button>
              </form>

              {/*
            Live since #670's review: each appears because the rider pressed
            *Save workout*, *Add block* or confirmed a delete, which is what
            `StatusMessage` §`live` is for — and without it the one sentence
            saying a save happened was never announced.
          */}
              {refusal === undefined ? null : (
                <StatusMessage tone="warning" live>
                  {refusal.message}
                </StatusMessage>
              )}
              {saved === undefined ? null : (
                <StatusMessage tone="success" live>
                  {saved}
                </StatusMessage>
              )}

              <h3>This workout</h3>
              {blocks.length === 0 ? (
                <p>No blocks yet. Add one below.</p>
              ) : (
                <ol>
                  {blocks.map((block, index) => (
                    <li key={`${block.kind}-${String(index)}`}>
                      {blockText(block)}{' '}
                      <Button
                        variant="secondary"
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
              {/*
            #1050: the chart goes BELOW *Save workout*, for the saved
            workout's reason above (#1043): drawn above the form it moved the
            builder's one primary down by its 6rem. Since #1087 the form is
            above the list too, and the chart follows the list it draws.
          */}
              <WorkoutBlockChart blocks={blocks} />

              {/*
            #670: the workout, its name and *Save workout* come BEFORE the
            form that adds a block, so the pane's one primary is on screen on
            arrival on a landscape tablet — below the block form it was 72 px
            under the fold there. The sentence about targets goes with the
            form whose boxes take them, and not above the name box: on a
            phone's one pane it put the first control under the fold on the
            CI runner's fonts.
          */}
              {/*
            Every form here is named: #670's audit of a populated screen —
            the first, since the route loop renders it with no store — found
            three unnamed forms, which a landmark list cannot tell apart.
          */}
              <form aria-label="Add a block" onSubmit={onAddBlock}>
                {/* #1013: what a block does to the trainer is the section's one line;
                why targets are a percentage is its help. */}
                <SectionHeading
                  level={3}
                  help={
                    <p>
                      Targets are a percentage of your own threshold power, so the same workout
                      works whatever shape you are in.
                    </p>
                  }
                >
                  Add a block
                </SectionHeading>
                <p>A free-ride block releases the trainer instead of holding a target.</p>
                <p>
                  <label htmlFor="block-kind">Kind</label>
                  <select
                    id="block-kind"
                    name="kind"
                    value={draft.kind}
                    onChange={(event) =>
                      setDraft({ ...draft, kind: event.target.value as BlockDraft['kind'] })
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
                  <Stepper name="minutes" step={1} min={1}>
                    <input
                      id="block-minutes"
                      name="minutes"
                      type="text"
                      inputMode="decimal"
                      value={draft.minutes}
                      onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
                    />
                  </Stepper>
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
                    <Stepper name="target percentage" step={5} min={0}>
                      <input
                        id="block-percent"
                        name="percent"
                        type="text"
                        inputMode="decimal"
                        value={draft.percent}
                        onChange={(event) => setDraft({ ...draft, percent: event.target.value })}
                      />
                    </Stepper>
                  </p>
                ) : null}
                {draft.kind === 'ramp' ? (
                  <p>
                    <label htmlFor="block-to-percent">Finishing target, % of threshold</label>
                    <Stepper name="finishing target percentage" step={5} min={0}>
                      <input
                        id="block-to-percent"
                        name="toPercent"
                        type="text"
                        inputMode="decimal"
                        value={draft.toPercent}
                        onChange={(event) => setDraft({ ...draft, toPercent: event.target.value })}
                      />
                    </Stepper>
                  </p>
                ) : null}
                {draft.kind === 'intervals' ? (
                  <>
                    <p>
                      <label htmlFor="block-repeats">How many times</label>
                      <Stepper name="number of repeats" step={1} min={1}>
                        <input
                          id="block-repeats"
                          name="repeats"
                          type="text"
                          inputMode="numeric"
                          value={draft.repeats}
                          onChange={(event) => setDraft({ ...draft, repeats: event.target.value })}
                        />
                      </Stepper>
                    </p>
                    <p>
                      <label htmlFor="block-easy-minutes">Recovery, minutes</label>
                      <Stepper name="recovery minutes" step={1} min={1}>
                        <input
                          id="block-easy-minutes"
                          name="easyMinutes"
                          type="text"
                          inputMode="decimal"
                          value={draft.easyMinutes}
                          onChange={(event) =>
                            setDraft({ ...draft, easyMinutes: event.target.value })
                          }
                        />
                      </Stepper>
                    </p>
                    <p>
                      <label htmlFor="block-easy-percent">Recovery target, % of threshold</label>
                      <Stepper name="recovery target percentage" step={5} min={0}>
                        <input
                          id="block-easy-percent"
                          name="easyPercent"
                          type="text"
                          inputMode="decimal"
                          value={draft.easyPercent}
                          onChange={(event) =>
                            setDraft({ ...draft, easyPercent: event.target.value })
                          }
                        />
                      </Stepper>
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
                <Button variant="secondary" type="submit">
                  Add block
                </Button>
              </form>
            </div>

            <div>
              <SectionHeading
                level={2}
                help={<p>Files from other training apps are not read yet.</p>}
              >
                Import a workout
              </SectionHeading>
              <p>
                A workout file written by On Your Left. The file is read on this device and never
                sent anywhere.
              </p>
              <form aria-label="Import a workout" onSubmit={(event) => void onImport(event)}>
                <p>
                  <label htmlFor="workout-file" id="workout-file-label">
                    Workout file
                  </label>
                  <FileDrop hint="Or drop a workout file here" labelId="workout-file-label">
                    <input
                      id="workout-file"
                      name="file"
                      type="file"
                      accept=".json,application/json"
                    />
                  </FileDrop>
                </p>
                <Button variant="secondary" type="submit">
                  Import workout
                </Button>
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
            </div>
          </div>
        )
      }
    />
  );
}

/** The hardest target in words, or that there is none. */
function hardestText(row: WorkoutRow): string {
  return row.hardestPercent === undefined
    ? 'No target'
    : `${String(row.hardestPercent)}% of threshold`;
}
