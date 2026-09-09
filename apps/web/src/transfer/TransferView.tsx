// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The import and export screen — the migration path in and the exit door out.
 *
 * ## Two rules this screen is bound by, both from ADR 0009
 *
 * **R5**: file transfer is the *entire* interoperability surface of this
 * project. There is no "connect your account" control here and there will not
 * be one, because there is nothing to connect to — this project integrates with
 * no platform's API. The page says so and links to the ADR that explains why,
 * so the reasoning lives somewhere a link can point at rather than being
 * improvised in a support thread.
 *
 * **R3**, the nominative fair-use template, which is a template and not a
 * wording preference: the plain word mark in the body typeface, only as much as
 * is needed, nothing implying an integration that does not exist, and the
 * non-affiliation sentence in the wording `README.md` already carries. The two
 * strings ADR 0009 approves verbatim *for this issue* are used verbatim below
 * and nowhere else. **No logo, no stylisation, no brand colour** — this file
 * introduces no image and no colour of its own, which is what makes L1
 * checkable by reading the diff.
 *
 * ## Why there is no control at all when there is no port
 *
 * #48's first criterion rejects a control that looks like the way in and cannot
 * work, *"even if the button is disabled"*. Fingerprinting a file needs
 * `crypto.subtle`, which does not exist outside a secure context, so on that
 * path `main.tsx` builds no port and this screen renders an explanation instead
 * of a file picker.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type JSX } from 'react';

import type { ActivityId, ActivitySummary } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ChartSlot } from '../design/ChartSlot';
import { StatusMessage, type StatusTone } from '../design/StatusMessage';

import { ActivityExportError, exportActivity, LOSSY_CHANNELS } from './export-activity';
import type { ActivityFileFormat } from './file-format';
import {
  importActivityFiles,
  type ImportOutcome,
  type ImportProgress,
  type ImportSource,
} from './import-batch';
import type { TransferPort } from './store-port';
import {
  MANIFEST_FILE_NAME,
  exportEverything,
  type AccountExportProgress,
  type AccountExportReport,
} from './export-everything';
import {
  ERASE_CANNOT_REACH,
  ERASE_CONFIRMATION,
  ERASE_REFUSAL_TEXT,
  ERASE_REMOVES,
  eraseDecision,
  eraseDevice,
  eraseSentence,
  type EraseRefusal,
} from './erase-device';

/** The ADR that explains why import is a file rather than a connection. */
const CLEAN_ROOM_ADR =
  'https://github.com/openzigs/onyourleft/blob/main/docs/adr/0009-clean-room-posture.md';

/** Every format offered for export, with the word a chooser shows. */
const FORMATS: readonly { readonly value: ActivityFileFormat; readonly label: string }[] = [
  { value: 'fit', label: 'FIT — carries everything stored' },
  { value: 'gpx', label: 'GPX 1.1' },
  { value: 'tcx', label: 'TCX v2' },
];

/**
 * What turns a file input into a directory input.
 *
 * @see the second input in {@link ImportPanel} for why it is spread rather
 * than written inline.
 */
const DIRECTORY_PICKER: Readonly<Record<string, string>> = { webkitdirectory: '' };

const OUTCOME_WORD: Readonly<Record<ImportOutcome['kind'], string>> = {
  imported: 'Imported',
  duplicate: 'Already here',
  failed: 'Not imported',
  cancelled: 'Cancelled',
};

export interface TransferViewProps {
  /** `undefined` where this browser cannot do it — see the module note. */
  readonly port?: TransferPort | undefined;
}

export function TransferView({ port }: TransferViewProps): JSX.Element {
  /**
   * Bumped whenever the import panel has written to the store.
   *
   * The two panels are siblings over one database — one writes it, the other
   * reads it — and a sibling's state change is not a re-render. Without this
   * counter the export panel's `useEffect` has nothing to depend on that
   * changes, so a rider who imports a ride is told, on the same screen, that
   * there is nothing on this device to export. That is CLAUDE.md §5's "a write
   * that reports success while the read cannot see it", one layer above the
   * store: the ride is on disk and the panel next to it is describing the
   * device as empty.
   *
   * A counter rather than passing the imported rides down: the export panel
   * lists what the *store* holds, and it must keep doing so after a #50 ride
   * list or a recording writes one too. What the import batch happens to
   * return is not the same question.
   */
  const [storeRevision, setStoreRevision] = useState(0);

  return (
    <>
      <h2>Import</h2>
      {port === undefined ? (
        <StatusMessage tone="danger">
          Importing a file needs Web Crypto to fingerprint it, and this browser does not offer it
          here — that is usually because the page was opened from a file rather than served over
          <span> </span>
          <code>https</code>. There is no import control on this page rather than one that cannot
          work.
        </StatusMessage>
      ) : (
        <ImportPanel
          port={port}
          onStoreChanged={() => {
            setStoreRevision((previous) => previous + 1);
          }}
        />
      )}

      <h2>Export</h2>
      {port === undefined ? (
        <p className="oyl-muted">
          Exporting needs the same local store the import above does, so it is unavailable here too.
        </p>
      ) : (
        <ExportPanel port={port} storeRevision={storeRevision} />
      )}

      <h2>Take everything with you</h2>
      {port === undefined ? (
        <p className="oyl-muted">
          This needs the same local store the panels above do, so it is unavailable here too.
        </p>
      ) : (
        <TakeEverythingPanel port={port} storeRevision={storeRevision} />
      )}

      <h2>Erase this device</h2>
      {port === undefined ? (
        <p className="oyl-muted">
          This needs the same local store the panels above do, so it is unavailable here too.
        </p>
      ) : (
        <ErasePanel port={port} storeRevision={storeRevision} />
      )}

      <h2>Why this is a file and not a connection</h2>
      <p>
        This project integrates with no other platform&rsquo;s API. Moving rides in and out is
        something you do with files, which needs no account, no paid tier and nobody&rsquo;s
        permission. The reasoning is recorded in{' '}
        <a href={CLEAN_ROOM_ADR}>ADR 0009, the clean-room posture</a>.
      </p>
      <p>
        Imports activity files exported from Strava. On Your Left is not affiliated with, endorsed
        by, or derived from Strava or Zwift.
      </p>
    </>
  );
}

/** The file picker, the run, the progress and the report. */
function ImportPanel({
  port,
  onStoreChanged,
}: {
  readonly port: TransferPort;
  /** Called once a run has written at least one ride. @see TransferView */
  readonly onStoreChanged: () => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<readonly ImportSource[]>([]);
  const [progress, setProgress] = useState<ImportProgress | undefined>(undefined);
  const [outcomes, setOutcomes] = useState<readonly ImportOutcome[]>([]);
  const [running, setRunning] = useState(false);
  const cancellation = useRef<AbortController | undefined>(undefined);

  // Abort on unmount, so navigating away from a three-hundred-file import stops
  // it rather than leaving it writing to IndexedDB behind a page nobody is
  // looking at. What is already imported stays imported, which is the same
  // contract the Cancel button has.
  useEffect(() => () => cancellation.current?.abort(), []);

  function choose(event: ChangeEvent<HTMLInputElement>): void {
    setChosen(sourcesOf(event.target.files));
    setOutcomes([]);
    setProgress(undefined);
  }

  async function start(): Promise<void> {
    const controller = new AbortController();
    cancellation.current = controller;
    setRunning(true);
    setOutcomes([]);
    setProgress(undefined);
    // Recorded as the batch runs rather than read off the report at the end,
    // so that a cancelled run — and a run that throws for a reason that is
    // about this client rather than about a file — still tells the rest of the
    // page about the rides that did land. Cancelling is not rolling back.
    let wrote = false;
    try {
      const report = await importActivityFiles({
        sources: chosen,
        store: port.store,
        athleteId: port.athleteId,
        newActivityId: () => port.newActivityId(),
        now: () => port.now(),
        digest: async (bytes) => port.digest(bytes),
        timeZone: port.timeZone,
        signal: controller.signal,
        onProgress: (update) => {
          wrote ||= update.outcome.kind === 'imported';
          setProgress(update);
        },
      });
      setOutcomes(report.outcomes);
    } finally {
      setRunning(false);
      cancellation.current = undefined;
      // Once, after the run, rather than per file: a three-hundred-file archive
      // would otherwise re-query and re-render the ride chooser three hundred
      // times while the import it is competing with is still going.
      if (wrote) {
        onStoreChanged();
      }
    }
  }

  const total = chosen.length;
  return (
    <>
      <p className="oyl-muted">
        Import a FIT, GPX or TCX file — including the bulk export from your Strava account. Choose
        as many as you like; each one is reported on its own, and one file that cannot be read does
        not stop the rest.
      </p>
      <div className="oyl-transfer__form">
        <label htmlFor="oyl-import-files">Activity files</label>
        {/*
          ⚠️ **No `accept` attribute, deliberately.** `accept=".fit,.gpx,.tcx"`
          hides from the picker exactly the files #51's second criterion is
          about: a bulk export is full of things this client cannot decode, and
          a rider who selects the whole archive and is told per file what
          happened to each is the behaviour asked for. A filter that quietly
          drops them before the batch sees them reports on nothing.
        */}
        <input
          id="oyl-import-files"
          className="oyl-input oyl-input--file"
          type="file"
          multiple
          onChange={choose}
        />

        <label htmlFor="oyl-import-folder">Or a whole folder</label>
        {/*
          The unzipped archive, in one gesture — hundreds of files across the
          directories the export was written with, which is #51's sixth
          criterion as a rider actually performs it. `webkitdirectory` is the
          only way a page gets a directory. It is non-standard and MDN records
          it as Baseline "newly available" since August 2025 (read 2026-09-06),
          which is all four engines; a browser without it shows an ordinary file
          picker, so the worst case is the input beside it. It is also what
          fills in `webkitRelativePath` — the archive-relative name `sourcesOf`
          reports each file under.

          Spread rather than written as a JSX attribute because `@types/react`
          19 does not declare it; React passes an unknown lowercase attribute
          through to the DOM unchanged.
        */}
        <input
          {...DIRECTORY_PICKER}
          id="oyl-import-folder"
          className="oyl-input oyl-input--file"
          type="file"
          multiple
          onChange={choose}
        />
      </div>
      <div className="oyl-transfer__form">
        {running ? (
          <Button
            variant="secondary"
            onClick={() => {
              cancellation.current?.abort();
            }}
          >
            Cancel import
          </Button>
        ) : (
          <Button
            onClick={() => {
              void start();
            }}
            disabled={total === 0}
          >
            {total === 0 ? 'Import' : `Import ${String(total)} file${total === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>

      {/*
        A live region rather than a bar. jsdom has no layout and a screen reader
        has no width, so a percentage rendered as a rectangle is invisible to
        both — whereas a counted sentence is read out as it changes and is what
        a test can assert on. #51 asks that progress be *visible*; a number that
        is announced is more visible than a bar that is not.
      */}
      <p className="oyl-status oyl-status--info" role="status">
        {progressSentence(progress, running, total)}
      </p>

      <ChartSlot
        caption="What happened to each file"
        columns={['File', 'Result', 'Detail']}
        rows={outcomes.map(rowOf)}
        emptyMessage="Nothing imported yet. Choose files above and every one of them is listed here by name."
      />
    </>
  );
}

/** One row of the report: the filename first, because that is what is looked up. */
function rowOf(outcome: ImportOutcome): readonly string[] {
  const detail = outcome.reason ?? (outcome.faults.length === 0 ? '' : outcome.faults.join(' '));
  return [outcome.fileName, OUTCOME_WORD[outcome.kind], detail];
}

function progressSentence(
  progress: ImportProgress | undefined,
  running: boolean,
  total: number,
): string {
  if (progress === undefined) {
    return running
      ? `Reading ${String(total)} file${total === 1 ? '' : 's'}.`
      : total === 0
        ? 'No files chosen yet.'
        : `${String(total)} file${total === 1 ? '' : 's'} ready to import.`;
  }
  const done = `${String(progress.completed)} of ${String(progress.total)} files`;
  const last = `${progress.outcome.fileName}: ${OUTCOME_WORD[progress.outcome.kind].toLowerCase()}`;
  return running ? `Importing — ${done}. Last: ${last}.` : `Finished ${done}. Last: ${last}.`;
}

/** Choose a ride, choose a format, get a file. */
function ExportPanel({
  port,
  storeRevision,
}: {
  readonly port: TransferPort;
  /** Changes when something else on this page has written a ride. @see TransferView */
  readonly storeRevision: number;
}): JSX.Element {
  const [rides, setRides] = useState<readonly ActivitySummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [format, setFormat] = useState<ActivityFileFormat>('fit');
  const [message, setMessage] = useState<{ tone: StatusTone; text: string } | undefined>(undefined);

  // ⚠️ `storeRevision` is a dependency and not an unused prop: `port` is built
  // once in `main.tsx` and never changes, so it alone would pin this list to
  // whatever was on disk when the page was opened. Removing it from here is the
  // mutation `TransferView.test.tsx`'s two-panel test goes red on.
  const load = useCallback(async (): Promise<void> => {
    const found = await port.store.listActivitySummaries(port.athleteId);
    setRides(found);
    setSelected((current) => (current === '' ? (found[0]?.id ?? '') : current));
  }, [port, storeRevision]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(): Promise<void> {
    if (selected === '') {
      return;
    }
    try {
      const { file, lost } = await exportActivity({
        store: port.store,
        athleteId: port.athleteId,
        activityId: selected as ActivityId,
        format,
      });
      port.save(file);
      // #162. The file saved either way — the encoder's contract is bytes plus
      // faults, and a lossy file is still a file the rider asked for. What
      // changes is that they are told, in the same place they are told it
      // worked, rather than finding out from a reader months later.
      //
      // `warning` rather than `success` when something was lost, because a
      // rider skimming for the green line is exactly the person who needs to
      // notice. `lost` is empty on a clean export, so this is not an
      // always-on caveat.
      setMessage(
        lost.length === 0
          ? { tone: 'success', text: `Saved ${file.fileName}.` }
          : {
              tone: 'warning',
              text: `Saved ${file.fileName}, but not everything fitted in the file — ${lost.join('; ')}.`,
            },
      );
    } catch (error: unknown) {
      setMessage({
        tone: 'warning',
        text:
          error instanceof ActivityExportError
            ? `That ride was not exported — ${error.message}.`
            : 'That ride was not exported, and the reason was not one this screen knows about.',
      });
    }
  }

  if (rides.length === 0) {
    return (
      <p className="oyl-muted">
        There are no rides on this device yet. Record one, or import one above, and it can be
        exported from here.
      </p>
    );
  }

  const lossy = LOSSY_CHANNELS[format];
  return (
    <>
      <p className="oyl-muted">
        An exported file carries your <strong>real</strong> track — the ride as it was recorded,
        with nothing removed. Privacy zones exist for what gets published, and this is your own copy
        of your own data.
      </p>
      <div className="oyl-transfer__form">
        <label htmlFor="oyl-export-ride">Ride</label>
        <select
          id="oyl-export-ride"
          className="oyl-input oyl-input--wide"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
          }}
        >
          {rides.map((ride) => (
            <option key={ride.id} value={ride.id}>
              {rideLabel(ride)}
            </option>
          ))}
        </select>

        <label htmlFor="oyl-export-format">Format</label>
        <select
          id="oyl-export-format"
          className="oyl-input oyl-input--wide"
          value={format}
          onChange={(event) => {
            setFormat(event.target.value as ActivityFileFormat);
          }}
        >
          {FORMATS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <Button
          onClick={() => {
            void run();
          }}
        >
          Export
        </Button>
      </div>
      {lossy.length === 0 ? (
        <p className="oyl-muted">FIT carries every channel this device stores.</p>
      ) : (
        <p className="oyl-muted">
          {`This format cannot carry: ${lossy.join(', ')}. The stored ride keeps them.`}
        </p>
      )}
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
    </>
  );
}

/**
 * Every ride on this device, plus a manifest, in one press.
 *
 * #35: *"this project's pitch is that it is the free, open alternative that
 * does not hold your data hostage. A migration path out is the credibility of
 * that pitch. A user who cannot leave has not chosen to stay."* The panel above
 * exports one ride; a rider leaving has a library.
 *
 * ⚠️ **It says what the archive contains before it is made, not after.** The
 * files carry the true track and the manifest carries every privacy zone —
 * correct for the athlete's own copy, and a concentration of exactly the data
 * ADR 0004 exists to protect. A rider about to put that in a cloud folder is
 * owed the sentence before they press the button, not a caveat underneath the
 * result.
 */
function TakeEverythingPanel({
  port,
  storeRevision,
}: {
  readonly port: TransferPort;
  readonly storeRevision: number;
}): JSX.Element {
  const [format, setFormat] = useState<ActivityFileFormat>('fit');
  const [progress, setProgress] = useState<AccountExportProgress | undefined>(undefined);
  const [report, setReport] = useState<AccountExportReport | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const cancel = useRef<AbortController | undefined>(undefined);

  // Reset when something else on the page writes a ride, so a report cannot
  // outlive the library it describes — the same reason the panel above takes
  // `storeRevision`.
  useEffect(() => {
    setReport(undefined);
    setProgress(undefined);
  }, [storeRevision]);

  async function run(): Promise<void> {
    const controller = new AbortController();
    cancel.current = controller;
    setRunning(true);
    setReport(undefined);
    try {
      const finished = await exportEverything({
        store: port.store,
        athleteId: port.athleteId,
        format,
        signal: controller.signal,
        onFile: (file) => {
          port.save(file);
        },
        onProgress: setProgress,
      });
      setReport(finished);
    } finally {
      setRunning(false);
      cancel.current = undefined;
    }
  }

  return (
    <>
      <p className="oyl-muted">
        One file per ride plus <code>{MANIFEST_FILE_NAME}</code>, which carries your thresholds,
        privacy zones, routes, workouts and the public half of this device&rsquo;s signing key.
      </p>
      <p className="oyl-muted">
        The archive holds your <strong>real</strong> tracks and the centres of your privacy zones.
        That is what makes it a complete copy, and it is why it deserves the same care as the rides
        themselves. Your private key is never written to any of it.
      </p>
      <div className="oyl-transfer__form">
        <label htmlFor="oyl-everything-format">Format</label>
        <select
          id="oyl-everything-format"
          className="oyl-input oyl-input--wide"
          value={format}
          disabled={running}
          onChange={(event) => {
            setFormat(event.target.value as ActivityFileFormat);
          }}
        >
          {FORMATS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          disabled={running}
          onClick={() => {
            void run();
          }}
        >
          Export everything
        </Button>
        {running ? (
          <Button
            onClick={() => {
              cancel.current?.abort();
            }}
          >
            Stop
          </Button>
        ) : null}
      </div>
      {running && progress !== undefined ? (
        <StatusMessage tone="info" live>
          {`Exported ${String(progress.completed)} of ${String(progress.total)}.`}
        </StatusMessage>
      ) : null}
      {report === undefined ? null : (
        <StatusMessage tone={report.failed === 0 ? 'success' : 'warning'} live>
          {everythingSentence(report)}
        </StatusMessage>
      )}
    </>
  );
}

/** What the finished export is told to a rider. One sentence, no jargon. */
export function everythingSentence(report: AccountExportReport): string {
  const parts = [`Saved ${String(report.exported)} ride${report.exported === 1 ? '' : 's'}`];
  if (report.failed > 0) {
    parts.push(`${String(report.failed)} could not be written`);
  }
  if (report.cancelled > 0) {
    parts.push(`${String(report.cancelled)} were not reached because you stopped it`);
  }
  if (report.continueAfter !== undefined) {
    // Said plainly rather than hidden: a rider who reads "saved 500 rides" and
    // has 900 would otherwise believe they had left with all of them.
    parts.push('there are more — run it again to continue');
  }
  return `${parts.join('; ')}.`;
}

/**
 * The one irreversible control in the product.
 *
 * Placed **after** the export panel deliberately: the order on the page is the
 * order a rider leaving should do it in, and a rider who reads this heading
 * first has already scrolled past the way to keep their history.
 *
 * ⚠️ It states what erasing cannot reach **before** the button rather than
 * after the result, and it names the signing-key consequence, which is the one
 * nobody expects — see `erase-device.ts` and ADR 0014 D-7.
 */
function ErasePanel({
  port,
  storeRevision,
}: {
  readonly port: TransferPort;
  readonly storeRevision: number;
}): JSX.Element {
  const [typed, setTyped] = useState('');
  const [holds, setHolds] = useState(false);
  const [done, setDone] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<EraseRefusal | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      const rides = await port.store.listActivitySummaries(port.athleteId, { limit: 1 });
      if (live) {
        setHolds(rides.length > 0);
      }
    })();
    return () => {
      live = false;
    };
  }, [port, storeRevision]);

  async function run(): Promise<void> {
    const decision = eraseDecision(typed, holds);
    if (!decision.ready) {
      setRefused(decision.refusal);
      return;
    }
    setRefused(undefined);
    const outcome = await eraseDevice(port.store, port.athleteId);
    setDone(eraseSentence(outcome));
    setTyped('');
    setHolds(false);
  }

  return (
    <>
      <p>
        This removes everything this device holds about you. There is no server and nothing has been
        uploaded, so there is nowhere else to ask &mdash; when this finishes, it is finished.
      </p>
      <p className="oyl-muted">What goes:</p>
      <ul>
        {ERASE_REMOVES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="oyl-muted">What this cannot reach:</p>
      <ul>
        {ERASE_CANNOT_REACH.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        <strong>
          Erasing the signing key cannot be undone, and it cannot be recreated. Rides you have
          already exported go on verifying forever, but after this the device signs as a new
          identity.
        </strong>
      </p>
      <div className="oyl-transfer__form">
        <label htmlFor="oyl-erase-confirm">{`Type “${ERASE_CONFIRMATION}” to confirm`}</label>
        <input
          id="oyl-erase-confirm"
          className="oyl-input oyl-input--wide"
          type="text"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
        <Button
          onClick={() => {
            void run();
          }}
        >
          Erase everything
        </Button>
      </div>
      {refused === undefined ? null : (
        <StatusMessage tone="warning" live>
          {ERASE_REFUSAL_TEXT[refused]}
        </StatusMessage>
      )}
      {done === undefined ? null : (
        <StatusMessage tone="success" live>
          {done}
        </StatusMessage>
      )}
    </>
  );
}

/**
 * How one ride reads in the chooser: its name, how far and how long.
 *
 * Deliberately **not** in `src/format.ts`. That module's own note records what
 * happened last time a presentation helper was exported ahead of a second
 * caller: it outlived the caller it was written for while the surviving screen
 * kept a private copy, and the two disagreed. There is exactly one caller for
 * this, here. #50 and #62 render a ride list properly, and that is when a
 * shared helper has two callers to keep in step.
 */
function rideLabel(ride: ActivitySummary): string {
  const kilometres = (ride.distance / 1000).toFixed(1);
  const minutes = Math.round(ride.movingTime / 60);
  return `${ride.name} — ${kilometres} km, ${String(minutes)} min`;
}

/**
 * The browser's `FileList` as lazy import sources.
 *
 * `file.arrayBuffer()` is not called here: the batch reads one file at a time,
 * and reading three hundred rides up front is every ride in memory at once.
 */
function sourcesOf(files: FileList | null): readonly ImportSource[] {
  if (files === null) {
    return [];
  }
  return [...files].map((file) => ({
    // `webkitRelativePath` is what the folder input above fills in, and it is
    // the name the rider recognises from their archive —
    // `activities/2019-01-10_1234567.gpx` rather than a bare filename that a
    // deep archive repeats. Empty for the plain file picker beside it, in which
    // case the bare name is the whole of it.
    //
    // ⚠️ **Tested for truthiness, not against `''`.** `lib.dom.d.ts` types
    // `webkitRelativePath` as a `string`, but it is a non-standard attribute
    // and jsdom does not implement it at all — so `=== ''` is `false` for
    // `undefined`, and every `File` a test constructs would be imported under
    // the filename `undefined`, typed as a `string` the whole way down into
    // `originalFile.key`. The store's own validation is what caught it.
    fileName: file.webkitRelativePath || file.name,
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  }));
}
