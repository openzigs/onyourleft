// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the athlete is told about Bluetooth in this browser.
 *
 * This component *is* #48's first acceptance criterion. Every branch names the
 * browsers that do work, says whose limitation it is, and — where anything can
 * be done — says what. [ADR 0003](../../../../docs/adr/0003-platform-support-matrix.md)
 * decision D-7 is the source of every rule the copy follows:
 *
 * > "Your browser is not supported" is useless. … Say the limitation is the
 * > browser's, not the user's. … Distinguish permanent from pending.
 *
 * ## The copy is checked, not just written
 *
 * `BluetoothSupportNotice.test.tsx` asserts that the unsupported branches name
 * a browser that works and never blame the reader, because copy is the part of
 * an accessibility feature that rots first: a later edit that shortens this to
 * "Bluetooth unavailable" would pass every structural rule in `a11y/audit.ts`
 * and fail the criterion completely.
 *
 * ## Every figure here is re-read, not remembered
 *
 * ADR 0003's own closing note: `caniuse`'s `usage_perc_y` "moves monthly and
 * should be re-read before it is quoted anywhere user-facing". So this copy
 * quotes **no percentage**. It names browsers and platforms, which change on
 * the scale of years, and leaves the share figure to the ADR where it carries
 * the date it was read on.
 */

import type { JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import type { BluetoothSupport } from './bluetooth-support';

/**
 * The browsers Web Bluetooth actually ships in, without a flag.
 *
 * From WebBluetoothCG's implementation status by way of ADR 0003's sources
 * table: shipped unflagged on Android, Chrome OS, macOS and Windows.
 */
const WORKING_BROWSERS =
  'Chrome, Edge, Opera or Samsung Internet, on Android, Chrome OS, macOS or Windows';

export interface BluetoothSupportNoticeProps {
  /** `undefined` while the probe is in flight. */
  readonly support: BluetoothSupport | undefined;
  readonly onRecheck: () => void;
}

/**
 * "Check again", with the rest of its name supplied for anyone reading it out
 * of context.
 *
 * A screen-reader user listing the buttons on a page hears each one's
 * accessible name and nothing around it, and "Check again" alone does not say
 * check what. The visible label stays the short one — WCAG 2.2 SC 2.5.3 asks
 * that the visible label be part of the accessible name, and it is the prefix
 * here, so speech control still works on the words a user can see.
 */
function RecheckButton({ onRecheck }: { readonly onRecheck: () => void }): JSX.Element {
  return (
    <Button variant="secondary" onClick={onRecheck}>
      Check again
      <VisuallyHidden> for Bluetooth support</VisuallyHidden>
    </Button>
  );
}

/** The constraints that apply even when everything works. Never hidden. */
function WorkingPathConstraints(): JSX.Element {
  return (
    <ul>
      <li>
        Pairing needs one press per device. The browser opens its own chooser and will not let a
        page open it without a press, so three sensors is three presses.
      </li>
      <li>
        There is no silent reconnect. After a reload, or after this tab is closed, each device has
        to be chosen again.
      </li>
      <li>
        Recording stops if the browser suspends this tab. Keep it open and in front while you ride.
      </li>
      <li>
        Plan for about three sensors at once. The limit belongs to the Bluetooth adapter, not to
        this app.
      </li>
    </ul>
  );
}

/**
 * The notice for one support state.
 *
 * Returns the working-path constraints rather than `null` when everything is
 * fine: D-7's fifth rule is "do not hide the constraints in the working path
 * either", and a component that rendered nothing on success would be exactly
 * the UI that implies a "pair everything" button could exist.
 */
export function BluetoothSupportNotice({
  support,
  onRecheck,
}: BluetoothSupportNoticeProps): JSX.Element {
  if (support === undefined) {
    return (
      <StatusMessage tone="info" label="Checking" live>
        Looking for Bluetooth in this browser.
      </StatusMessage>
    );
  }

  switch (support.kind) {
    case 'available':
      return (
        <>
          <StatusMessage tone="success" label="Bluetooth is available">
            This browser can pair sensors. A few things it cannot do, before you start:
          </StatusMessage>
          <WorkingPathConstraints />
        </>
      );

    case 'absent':
      return (
        <>
          <StatusMessage tone="danger" label="This browser has no Bluetooth support">
            Safari and Firefox have no Web Bluetooth implementation at all, on any platform, and
            both vendors have published positions against adding one. Nothing you have done is wrong
            and there is no setting that turns it on. Every browser on iPhone and iPad is Safari
            underneath, so this is the same answer there whichever one you use.
          </StatusMessage>
          <p>
            To record a ride, open this app in {WORKING_BROWSERS}. Native apps for iPhone and
            Android are planned and are the only path that will ever work on an iPhone.
          </p>
          <p className="oyl-muted">
            Everything else here works: rides already on this device stay readable, and files can
            still be imported and exported.
          </p>
        </>
      );

    case 'incomplete':
      return (
        <>
          <StatusMessage tone="warning" label="Bluetooth is only partly implemented here">
            This browser exposes the Bluetooth API but cannot drive an adapter with it. That is
            Chrome on Linux in its default configuration, where support is explicitly incomplete.
          </StatusMessage>
          <p>To use it on Linux you need all three of:</p>
          <ul>
            <li>
              the <code>#enable-experimental-web-platform-features</code> flag turned on in
              <code> chrome://flags</code>, then a restart;
            </li>
            <li>Linux kernel 3.19 or newer;</li>
            <li>BlueZ 5.41 or newer.</li>
          </ul>
          <p>On any other system, open this app in {WORKING_BROWSERS} instead.</p>
          <RecheckButton onRecheck={onRecheck} />
        </>
      );

    case 'adapter-unavailable':
      return (
        <>
          <StatusMessage tone="warning" label="Bluetooth is switched off">
            This browser supports Bluetooth and the adapter is not currently available. Switch
            Bluetooth on in your system settings, then check again.
          </StatusMessage>
          <RecheckButton onRecheck={onRecheck} />
        </>
      );

    case 'not-permitted':
      return (
        <>
          <StatusMessage tone="warning" label="Bluetooth is blocked for this page">
            The browser supports Bluetooth but is refusing it to this page — that normally means the
            app is embedded in another site that has not allowed it. Open the app in its own tab and
            check again.
          </StatusMessage>
          <RecheckButton onRecheck={onRecheck} />
        </>
      );

    case 'insecure-context':
      return (
        <>
          <StatusMessage tone="warning" label="This page is not on a secure connection">
            Browsers withhold Bluetooth from pages served over plain HTTP. Your browser may well
            support it — it is the address that is the problem. Open the app over HTTPS, or on{' '}
            <code>localhost</code>, then check again.
          </StatusMessage>
          <RecheckButton onRecheck={onRecheck} />
        </>
      );
  }
}
