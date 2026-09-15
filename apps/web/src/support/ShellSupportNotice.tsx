// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider is told about Bluetooth **inside the Android shell** (#284).
 *
 * The shell's counterpart to {@link BluetoothSupportNotice}, and a separate
 * component rather than a second shape of it because every branch of that one
 * is about browsers — Safari's and Firefox's published positions,
 * `chrome://flags`, "open this app in Chrome" — and none of it is true on a
 * phone whose BLE stack is a Capacitor plugin. `shell-support.ts` records the
 * decision in full.
 *
 * ## The wording is not written here
 *
 * `title` and `explanation` are `apps/mobile`'s `permissionNotice`, written for
 * #87's eighth criterion and tested there; `instruction` is
 * `shell-support.ts`'s mapping of the action that notice carries. This file
 * renders them and adds no sentence about a permission, so the copy a rider
 * reads on a phone has exactly one home.
 *
 * ## What it must not promise
 *
 * The browser notice's working-path list is wrong here in both directions:
 * Android needs no press per device, and it *does* need a runtime permission a
 * browser never asks for. The `available` branch below therefore states only
 * what is true of this build on a phone today — and deliberately **not** that
 * sensors reconnect on their own. `ANDROID_TRAITS.canReconnectWithoutUserGesture`
 * is `true` about the platform, and nothing in this client seeds the transport's
 * `seen` set from storage, so there is no automatic reconnection to promise.
 * CLAUDE.md §8 says not to build one; saying we had would be worse.
 */

import type { JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import type { ShellSupport } from './shell-support-port';

export interface ShellSupportNoticeProps {
  /** `undefined` while the read is in flight. */
  readonly support: ShellSupport | undefined;
  readonly onRecheck: () => void;
}

/**
 * The constraints that apply even when everything works. Never hidden.
 *
 * ADR 0003 D-7's fifth rule — "do not hide the constraints in the working path
 * either" — with the platform's own constraints rather than a browser's.
 */
function WorkingPathConstraints(): JSX.Element {
  return (
    <ul>
      <li>
        Sensors are paired on the Ride screen, one at a time, and the pairing is for this session:
        after the app is closed, each device is chosen again.
      </li>
      <li>
        Plan for about three sensors at once. The limit belongs to the phone’s Bluetooth adapter and
        is shared with whatever else is paired to it, not to this app.
      </li>
    </ul>
  );
}

/**
 * "Check again", with the rest of its name supplied for anyone reading it out
 * of context — the same rule {@link BluetoothSupportNotice} follows, and for
 * the same WCAG 2.2 SC 2.5.3 reason: the visible label is the prefix of the
 * accessible name, so speech control still works on the words a rider sees.
 */
function RecheckButton({ onRecheck }: { readonly onRecheck: () => void }): JSX.Element {
  return (
    <Button variant="secondary" onClick={onRecheck}>
      Check again
      <VisuallyHidden> for Bluetooth on this phone</VisuallyHidden>
    </Button>
  );
}

/** The notice for one shell support state. */
export function ShellSupportNotice({ support, onRecheck }: ShellSupportNoticeProps): JSX.Element {
  if (support === undefined) {
    return (
      <StatusMessage tone="info" label="Checking" live>
        Asking this phone about Bluetooth.
      </StatusMessage>
    );
  }

  if (support.notice === null) {
    return (
      <>
        <StatusMessage tone="success" label="Bluetooth is available">
          This phone can pair sensors. A couple of things it cannot do, before you start:
        </StatusMessage>
        <WorkingPathConstraints />
      </>
    );
  }

  const { title, explanation, instruction, recoverable } = support.notice;
  return (
    <>
      {/* `danger` only where nothing can be done. A radio that is switched off
          and a permission that has not been granted are both a step away from
          working, and a red message about a one-tap fix reads as a broken app. */}
      <StatusMessage tone={recoverable ? 'warning' : 'danger'} label={title}>
        {explanation}
      </StatusMessage>
      {instruction === null ? null : <p>{instruction}</p>}
      {recoverable ? <RecheckButton onRecheck={onRecheck} /> : null}
    </>
  );
}
