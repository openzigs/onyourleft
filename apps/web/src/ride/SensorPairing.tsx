// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pairing a trainer and each sensor, and saying what is connected — #659.
 *
 * ## One pairing implementation, and it is the ride controller's
 *
 * Until #659 the pairing buttons were on the Ride screen (`views/RideView.tsx`
 * §`SensorList`), while Home's *"Pair one on Devices"* and the More tab both
 * landed on a Devices screen that said *"Not built yet"* and offered no
 * control — a new rider who followed the app's own link hit a dead end. The
 * owner ruled (2026-09-27) that pairing lives on Devices.
 *
 * So {@link PairingPanel} is that block, MOVED rather than copied: it drives
 * the same {@link RideController} — `pair`, `unpair` — that the Ride screen
 * drove, through the same transport `main.tsx` §`buildPlatform` chose (Web
 * Bluetooth in a browser, the Capacitor transport in the shell, CLAUDE.md
 * §4h). The controller is mounted above the router (`ride/RideSession.tsx`),
 * so a device paired here is the device the Ride screen shows. The Ride screen
 * renders {@link ConnectedSensors}, which is read-only and links here: there
 * is no second pairing implementation to drift.
 *
 * ## Controls first, the limits beneath them
 *
 * The owner's ruling 3 on #654: the pairing list and its buttons come first,
 * and the paragraphs on what Bluetooth here cannot do go beneath them in a
 * native `<details>`. Three things stay visible outside it, one line each,
 * because ADR 0003 D-7 rule 5 says the working path's constraints are not to
 * be hidden: **one user gesture per device** — which is also what explains why
 * there are four buttons rather than one (CLAUDE.md §8) — and, where the
 * platform has them, **no silent reconnect** and **no background recording**
 * ({@link PairingPanelProps.limits}). The longer prose stays inside.
 *
 * ⚠️ **No control goes inside that `<details>`.** Every control a rider needs
 * to pair is above it, which is the ruling. `a11y/audit.ts`
 * §`tabbableElements` has modelled a closed disclosure since #665, so this is
 * no longer about the audit being fooled; it is that a *Check again* tucked
 * away is a control a rider whose radio is off never finds. The children
 * `DevicesView` passes in are the support notice in its can-pair state, which
 * renders no control; every state with one keeps its notice visible.
 *
 * ## State is words, never only colour
 *
 * WCAG 2.2 SC 1.4.1. Every row says what it is in text — *Connected*, *Not
 * paired* — and nothing here paints a state with a colour at all, so the dark
 * theme (#654 P1-f) has nothing of this file's to re-check.
 * `views/DevicesView.test.tsx` fails if a row's state is missing from its
 * text — *"names … in the row's own text"* and *"gives every state different
 * words"*.
 *
 * ## A garage, since #942
 *
 * Each kind of device is a CARD (epic #935): the illustration kit's
 * {@link SensorGlyph} beside its name, then what is paired in it and in what
 * state, then its controls. ⚠️ **Presentation only.** The rows are the same
 * rows in the same order with the same buttons calling the same controller
 * methods; `DevicesView.pairing.a11y.test.tsx` holds a snapshot of the calls
 * pairing and forgetting one device make, taken before the cards. The glyph is
 * `aria-hidden` decoration and never changes with a state: the state is the
 * words, and the same test reads them with every decoration removed.
 */

import type { JSX, ReactNode } from 'react';

import type { ConnectionState } from '@onyourleft/sensors';

import { Button } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { KeptVisible } from '../design/KeptVisible';
// The part's own file, not the kit's index, which names every part.
import { SensorGlyph, type SensorGlyphKind } from '../design/illustration/SensorGlyph';
import { StatusMessage } from '../design/StatusMessage';
import { hrefFor, routeById } from '../shell/routes';
import type { PairedSensor, PairingRole, RideController, RideSnapshot } from './controller';
import { useRideSnapshot } from './useRideController';

/** One row per kind of device, in the order #49's revision block asks for. */
export const PAIRING_STEPS: readonly {
  readonly role: PairingRole;
  /** What the row is, as a rider names it. */
  readonly kind: string;
  /** The button — its own words, so a screen reader listing buttons hears which. */
  readonly label: string;
}[] = [
  { role: 'trainer', kind: 'Smart trainer', label: 'Pair a smart trainer' },
  { role: 'heart-rate', kind: 'Heart rate strap', label: 'Pair a heart rate strap' },
  { role: 'power-meter', kind: 'Power meter', label: 'Pair a power meter' },
  {
    role: 'speed-cadence',
    kind: 'Speed or cadence sensor',
    label: 'Pair a speed or cadence sensor',
  },
];

/** The trainer row's button label, which the empty garage's action shares (#943). */
const TRAINER_PAIRING_LABEL = PAIRING_STEPS.find((step) => step.role === 'trainer')?.label ?? '';

/** Which of the kit's glyphs each kind of device wears on its card (#942). */
const GLYPH_FOR: Readonly<Record<PairingRole, SensorGlyphKind>> = {
  trainer: 'trainer',
  'heart-rate': 'heart-rate',
  'power-meter': 'power',
  'speed-cadence': 'cadence',
};

/** What the Devices screen says when nothing is paired at all — #943. */
const START_WITH_THE_TRAINER =
  'Start with your smart trainer: it is the one device here this app can control, and it ' +
  'often reports your power and cadence too.';

/** The words for a row with nothing paired in it. */
export const NOT_PAIRED = 'Not paired';

/**
 * Web Bluetooth's one-gesture-per-device rule, as the pairing list says it —
 * CLAUDE.md §8, ADR 0003 D-7 rule 5. Never inside the disclosure beneath the
 * list (#659), and held there by `a11y/kept-visible.a11y.test.tsx` (#666).
 */
export const ONE_GESTURE_PER_DEVICE =
  'Bluetooth needs one user gesture per device: each one is its own button and its own prompt, ' +
  'and there is no way to pair them all at once.';

/**
 * What a connection state means to somebody on a bike, in words — SC 1.4.1.
 *
 * `disconnected` says what to do, because on Web Bluetooth there is no silent
 * reconnect (CLAUDE.md §8): the rider forgets it and pairs it again.
 */
export function connectionWords(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Reconnecting';
    case 'unavailable':
      return 'Unavailable — Bluetooth is off or blocked';
    case 'disconnected':
      return 'Disconnected — forget it and pair it again to reconnect';
  }
}

export interface PairingPanelProps {
  readonly controller: RideController;
  /** The disclosure's label — "this browser" or "this phone". */
  readonly summary: string;
  /**
   * The working path's constraints beyond the one gesture, one short sentence
   * each, rendered VISIBLY beside it — ADR 0003 D-7 rule 5. Per platform,
   * because they differ: a browser has no silent reconnect and no background
   * recording, and the shell's own list is `ShellSupportNotice`'s.
   */
  readonly limits: readonly string[];
  /**
   * What goes inside the disclosure ahead of the connection count. ⚠️ Must
   * render nothing focusable — see this file's header.
   */
  readonly children?: ReactNode;
}

/** The Devices screen's pairing block. */
export function PairingPanel({
  controller,
  summary,
  limits,
  children,
}: PairingPanelProps): JSX.Element {
  const snapshot = useRideSnapshot(controller);
  return (
    <>
      {snapshot.pairingError === undefined ? null : (
        <StatusMessage tone="warning" label="Pairing" live>
          {snapshot.pairingError}
        </StatusMessage>
      )}
      {snapshot.sensors.length === 0 ? (
        // #943: the garage with nothing in it. Its one action pairs the
        // trainer — the row below does the same, and a rider who reads the
        // rows first loses nothing — and it is this screen's only primary:
        // every row's control is secondary. Since #987's review it wears the
        // trainer row's OWN label, read from `PAIRING_STEPS`, so the two
        // controls that do one thing have one name (WCAG 2.2 SC 3.2.4) and
        // cannot drift apart.
        <EmptyState
          art="trainer"
          heading="Nothing paired yet"
          level={3}
          action={
            <Button
              onClick={() => {
                void controller.pair('trainer');
              }}
            >
              {TRAINER_PAIRING_LABEL}
            </Button>
          }
        >
          <p>{START_WITH_THE_TRAINER}</p>
        </EmptyState>
      ) : null}
      <ul className="oyl-pairing tw:mt-0">
        {PAIRING_STEPS.map((step) => (
          <PairingRow
            key={step.role}
            step={step}
            sensors={snapshot.sensors.filter((sensor) => sensor.role === step.role)}
            controller={controller}
          />
        ))}
      </ul>
      <KeptVisible>
        <p>{ONE_GESTURE_PER_DEVICE}</p>
        {limits.map((limit) => (
          <p key={limit}>{limit}</p>
        ))}
      </KeptVisible>
      <details className="oyl-details">
        <summary>{summary}</summary>
        {children}
        <p>
          Bluetooth here will hold about {snapshot.connectionsRemaining} more connection
          {snapshot.connectionsRemaining === 1 ? '' : 's'}. A trainer usually reports power and
          cadence itself, so pairing one is often all you need.
        </p>
        <p>
          Forget drops the connection and lets go of the device, so it has to be chosen again to
          come back. A ride that is recording carries on without it. Forgetting the trainer lets it
          go first, as End ERG does, and ends a workout that is running.
        </p>
      </details>
    </>
  );
}

function PairingRow({
  step,
  sensors,
  controller,
}: {
  readonly step: (typeof PAIRING_STEPS)[number];
  readonly sensors: readonly PairedSensor[];
  readonly controller: RideController;
}): JSX.Element {
  return (
    <li className="oyl-pairing__row tw:bg-surface-raised tw:rounded-card">
      <SensorGlyph kind={GLYPH_FOR[step.role]} className="oyl-pairing__glyph" />
      <div className="oyl-pairing__body">
        <h3 className="oyl-pairing__kind">{step.kind}</h3>
        {sensors.length === 0 ? (
          <p className="oyl-pairing__state">{NOT_PAIRED}</p>
        ) : (
          <ul className="oyl-sensor-list">
            {sensors.map((sensor) => (
              <li key={sensor.id}>
                <p className="oyl-pairing__state">
                  {sensor.name}: {connectionWords(sensor.state)}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void controller.unpair(sensor.id);
                  }}
                >
                  Forget {sensor.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            void controller.pair(step.role);
          }}
        >
          {step.label}
        </Button>
      </div>
    </li>
  );
}

/**
 * What is connected, for the Ride screen — read-only, and a link to Devices.
 *
 * ⚠️ **No pairing control here, deliberately** (#659). The controller is
 * mounted above the router, so pairing on Devices and coming back is one tap
 * and the connection is still there; a second set of buttons would be a
 * second pairing surface to keep in step with the first.
 */
export function ConnectedSensors({ snapshot }: { readonly snapshot: RideSnapshot }): JSX.Element {
  const devices = hrefFor(routeById('devices'));
  if (snapshot.sensors.length === 0) {
    return (
      <p>
        Nothing is paired yet. <a href={devices}>Pair a trainer or a sensor on Devices</a>.
      </p>
    );
  }
  return (
    <>
      <ul className="oyl-sensor-list">
        {snapshot.sensors.map((sensor) => (
          <li key={sensor.id}>
            {sensor.name}: {connectionWords(sensor.state)}
          </li>
        ))}
      </ul>
      <p>
        <a href={devices}>Pair or forget devices on Devices</a>
      </p>
    </>
  );
}
