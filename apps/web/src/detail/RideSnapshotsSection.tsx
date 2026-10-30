// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A ride's side-camera snapshots, closed until the rider opens them** —
 * [#1063](https://github.com/openzigs/onyourleft/issues/1063),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-3, D-6 and D-12, and
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md)
 * D-11.
 *
 * ## Closed by default, and nothing mounted until it is opened (D-6)
 *
 * The owner's answer of 2026-10-04: *"on a ride's page the snapshot section is
 * closed by default, and no picture is mounted until it is opened"*. So the
 * page's default render reads a COUNT — `countRideSnapshots`, which decodes no
 * picture — and says it in words. Only when the rider opens the section are
 * the pictures read, an object URL made for each, and Android's secure window
 * flag held (D-12). Closing the section, or leaving the page, revokes every
 * URL and gives the flag back. A ride with no snapshot renders nothing here.
 *
 * ## What a snapshot is shown with, and without
 *
 * With the outline it was shown with, drawn over it from the numbers its row
 * keeps (D-3), never burned in. **Never** with where in the ride it was taken
 * or any reading (D-3), so no time is printed beside it; and never with an
 * angle (D-9).
 *
 * ## Deleting one (D-3)
 *
 * Two presses, so a slip cannot destroy a picture nothing can re-create; then
 * the list is read again from the store, so what the rider sees afterwards is
 * what the store holds rather than what this screen assumed.
 *
 * ## Errors (ADR 0029 D-8)
 *
 * A failure says a read or a delete failed, and carries nothing of the
 * picture, its URL, or the store's message.
 */

import { useCallback, useEffect, useLayoutEffect, useState, type JSX } from 'react';

import type { ActivityId, CameraFrameId, CameraFrameRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { storedOutline } from '../camera/live-outline';
import type { RideSnapshotsPort } from './ride-snapshots-port';

/** The section's heading. */
export const RIDE_SNAPSHOTS_HEADING = 'Side-camera snapshots';
const HEADING_ID = 'oyl-ride-snapshots-heading';

/** What the closed section says: how many, in words, and nothing else. */
export function snapshotCountText(count: number): string {
  return count === 1
    ? 'This ride has 1 snapshot from the side camera. Open to show it.'
    : `This ride has ${String(count)} snapshots from the side camera. Open to show them.`;
}

/** Each picture's text alternative: what it is, never what it shows. */
export function snapshotAlt(ordinal: number, of: number): string {
  return `Side-camera snapshot ${String(ordinal)} of ${String(of)} from this ride`;
}

/** Said when the store could not be read or written; names nothing of the picture (D-8). */
export const SNAPSHOTS_UNREADABLE = 'The snapshots could not be read from this device.';
export const SNAPSHOT_NOT_DELETED =
  'That snapshot could not be deleted. It is still on this device.';
/** Said where the platform cannot make an image source (D-1's object URL). */
export const SNAPSHOTS_NOT_SHOWABLE = 'This browser cannot show a kept picture.';

export interface RideSnapshotsSectionProps {
  readonly port: RideSnapshotsPort | undefined;
  readonly activityId: ActivityId;
}

export function RideSnapshotsSection({
  port,
  activityId,
}: RideSnapshotsSectionProps): JSX.Element | null {
  const [count, setCount] = useState<number | 'failed' | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (port === undefined) {
      return undefined;
    }
    let live = true;
    port.store.countRideSnapshots(port.athleteId, activityId).then(
      (counted) => {
        if (live) {
          setCount(counted);
        }
      },
      () => {
        if (live) {
          setCount('failed');
        }
      },
    );
    return () => {
      live = false;
    };
  }, [port, activityId, revision]);

  const changed = useCallback(() => {
    setRevision((before) => before + 1);
  }, []);

  if (port === undefined || count === undefined || count === 0) {
    return null;
  }
  return (
    <div role="group" aria-labelledby={HEADING_ID} data-oyl-ride-snapshots="">
      <h3 id={HEADING_ID}>{RIDE_SNAPSHOTS_HEADING}</h3>
      {count === 'failed' ? (
        <StatusMessage tone="warning">{SNAPSHOTS_UNREADABLE}</StatusMessage>
      ) : (
        <details
          open={open}
          onToggle={(event) => {
            setOpen(event.currentTarget.open);
          }}
        >
          <summary>{snapshotCountText(count)}</summary>
          {/* Nothing is read, made or mounted until the section is open (D-6). */}
          {open ? (
            <OpenSnapshots
              port={port}
              activityId={activityId}
              revision={revision}
              onChange={changed}
            />
          ) : null}
        </details>
      )}
    </div>
  );
}

type Shown =
  | { readonly kind: 'reading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly frames: readonly { readonly frame: CameraFrameRecord; readonly url: string }[];
    };

function OpenSnapshots({
  port,
  activityId,
  revision,
  onChange,
}: {
  readonly port: RideSnapshotsPort;
  readonly activityId: ActivityId;
  readonly revision: number;
  readonly onChange: () => void;
}): JSX.Element {
  const [shown, setShown] = useState<Shown>({ kind: 'reading' });
  const [armed, setArmed] = useState<CameraFrameId | undefined>(undefined);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const urls = port.objectUrls;

  // D-12: a camera picture is on the screen while this is mounted. A layout
  // effect, so it is asked for before the first picture paints.
  useLayoutEffect(() => port.holdSecureWindow(), [port]);

  useEffect(() => {
    if (urls === undefined) {
      return undefined;
    }
    let live = true;
    const made: string[] = [];
    port.store.listRideSnapshots(port.athleteId, activityId).then(
      (frames) => {
        if (!live) {
          return;
        }
        const withUrls = frames.map((frame) => {
          const url = urls.create(frame.bytes, frame.mediaType);
          made.push(url);
          return { frame, url };
        });
        setShown({ kind: 'ready', frames: withUrls });
      },
      () => {
        if (live) {
          setShown({ kind: 'failed' });
        }
      },
    );
    return () => {
      live = false;
      // Every URL this read made goes with it: on closing, on leaving the
      // page, and before the next read after a delete (D-1's table).
      for (const url of made) {
        urls.revoke(url);
      }
    };
  }, [port, urls, activityId, revision]);

  if (urls === undefined) {
    return <StatusMessage tone="info">{SNAPSHOTS_NOT_SHOWABLE}</StatusMessage>;
  }
  if (shown.kind === 'reading') {
    return <p className="oyl-muted">Reading the snapshots from this device…</p>;
  }
  if (shown.kind === 'failed') {
    return <StatusMessage tone="warning">{SNAPSHOTS_UNREADABLE}</StatusMessage>;
  }

  const remove = async (id: CameraFrameId): Promise<void> => {
    setArmed(undefined);
    try {
      const removed = await port.store.deleteRideSnapshot(port.athleteId, activityId, id);
      setDeleteFailed(!removed);
    } catch {
      setDeleteFailed(true);
    }
    onChange();
  };

  const total = shown.frames.length;
  return (
    <>
      {deleteFailed ? <StatusMessage tone="warning">{SNAPSHOT_NOT_DELETED}</StatusMessage> : null}
      {shown.frames.map(({ frame, url }, index) => {
        const outline = frame.outline === null ? undefined : storedOutline(frame.outline);
        const aspect =
          frame.outline?.aspect ?? (frame.height > 0 ? frame.width / frame.height : 16 / 9);
        return (
          <figure key={frame.id} className="oyl-framing" data-oyl-snapshot={frame.id}>
            <div className="oyl-framing__picture" style={{ aspectRatio: String(aspect) }}>
              <img
                className="oyl-framing__video"
                src={url}
                alt={snapshotAlt(index + 1, total)}
                width={frame.width}
                height={frame.height}
              />
              {outline === undefined ? null : (
                <svg
                  className="oyl-framing__overlay"
                  viewBox={`0 0 ${String(aspect)} 1`}
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <g className="oyl-framing__outline">
                    {outline.bones.map((bone) => (
                      <line
                        key={`${String(bone.x1)},${String(bone.y1)},${String(bone.x2)},${String(bone.y2)}`}
                        x1={bone.x1}
                        y1={bone.y1}
                        x2={bone.x2}
                        y2={bone.y2}
                      />
                    ))}
                    {outline.joints.map((joint) => (
                      <circle
                        key={joint.name}
                        className="oyl-framing__joint"
                        cx={joint.x}
                        cy={joint.y}
                        r={0.008}
                      />
                    ))}
                  </g>
                </svg>
              )}
            </div>
            <figcaption>
              {outline === undefined
                ? 'The tablet did not find you in this picture, so there is no outline.'
                : 'The dotted line, with a dot at each point, is where the tablet found you in this picture.'}
            </figcaption>
            {armed === frame.id ? (
              <p>
                <span>
                  Delete snapshot {String(index + 1)} from this device? It cannot be brought
                  back.{' '}
                </span>
                <Button variant="danger" onClick={() => void remove(frame.id)}>
                  {`Yes, delete snapshot ${String(index + 1)}`}
                </Button>{' '}
                <Button
                  variant="secondary"
                  onClick={() => {
                    setArmed(undefined);
                  }}
                >
                  Keep it
                </Button>
              </p>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setArmed(frame.id);
                }}
              >
                {`Delete snapshot ${String(index + 1)}`}
              </Button>
            )}
          </figure>
        );
      })}
    </>
  );
}
