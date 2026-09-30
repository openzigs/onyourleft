// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/MoreAbout';
import { StatusMessage } from '../design/StatusMessage';
import type {
  DevicesOutcome,
  InstanceDevice,
  InstancePort,
  InstanceState,
} from '../instance/instance-port';
import type { ModerationPort, ModerationStanding } from '../instance/moderation-port';
import { hrefFor, routeById } from '../shell/routes';

/**
 * The Connect screen (#777, #778): an instance's address, signing in with this
 * device's key, what the instance holds, this athlete's devices on it (#773),
 * and disconnecting.
 *
 * ## Before anything is sent, the rider is told what will be
 *
 * #778's criterion: before sign-in the screen lists what the instance will
 * receive, and that list is **kept visible** — never in a `<details>` — because
 * it says what leaves the device and to whom (#666's ruling). It stays on the
 * screen once connected too, as what the instance goes on receiving.
 * {@link INSTANCE_KEPT_VISIBLE} is the list, and
 * `a11y/kept-visible.a11y.test.tsx` holds it to this route.
 *
 * ## What is shown is what the instance says
 *
 * The instance's name and the rider's display name come from
 * `InstancePort.current`, which reads them from the instance — never from the
 * form — so after a reload the screen says what the instance holds (#777).
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval**
 * (#880): it is new disclosure text.
 */

/** What an instance receives from this app, in this version. Kept visible. */
export const INSTANCE_RECEIVES: readonly string[] = [
  'This device’s public key, which is how the instance knows it is you. The private key never leaves this device.',
  'The name other riders will see, if you type one. It is sent each time you press Connect with a name typed, and the instance keeps it only if it has not seen this device before. An instance keeps your earlier names there too, for moderation.',
  'Your internet address and your device or browser type, as any server you connect to sees them.',
  'Nothing else of yours: connecting sends no ride, route, position or heart rate.',
];

export const INSTANCE_RECEIVES_LEAD = 'What the instance receives from this app';

/** Who holds it. Kept visible. */
export const INSTANCE_BELONGS_TO_ITS_OPERATOR =
  'An instance belongs to whoever runs it, and they decide how long it keeps what it receives. ' +
  'The project’s own instance runs on its maintainer’s computer at home, and its traffic passes ' +
  'through Cloudflare, which decrypts it on the way.';

/** Nothing leaves until the press. */
export const NOTHING_SENT_UNTIL_CONNECT = 'Nothing is sent until you press Connect.';

/** Public rooms — ruling Q5 of 2026-09-28. Kept visible. */
export const PUBLIC_ROOMS_ADULTS_ONLY =
  'Public rooms, where an instance offers them, are for adults only: you will be asked to confirm ' +
  'you are 18 or over before you join one.';

/** Voice chat — #778's comment of 2026-09-29, #794 option A. Kept visible. */
export const VOICE_CHAT_IS_DISCORD =
  'Voice chat in a room, where an instance offers it, happens on Discord, a separate service you ' +
  'choose to use: Discord receives your voice, and other riders in the voice channel see your ' +
  'Discord username and picture. If you link your Discord account, the instance keeps your ' +
  'Discord id with your account.';

/** Disconnecting — #777's criterion, in words. Kept visible. */
export const DISCONNECT_KEEPS_RIDES =
  'Disconnecting removes the instance’s address and this device’s sign-in from this device, and ' +
  'ends the sign-in on the instance. Every ride stays on this device. What the instance already ' +
  'holds stays there: this app cannot remove it, so ask whoever runs the instance. For the ' +
  'project’s own instance, that is its maintainer, as the privacy policy’s Contact section says.';

/** Every sentence this route must never tuck away, connected or not — #666. */
export const INSTANCE_KEPT_VISIBLE: readonly string[] = [
  INSTANCE_RECEIVES_LEAD,
  ...INSTANCE_RECEIVES,
  INSTANCE_BELONGS_TO_ITS_OPERATOR,
  PUBLIC_ROOMS_ADULTS_ONLY,
  VOICE_CHAT_IS_DISCORD,
];

/** And once connected — #666. */
export const INSTANCE_CONNECTED_KEPT_VISIBLE: readonly string[] = [DISCONNECT_KEEPS_RIDES];

/** Said where there is no port: nothing on this platform can connect. */
export const INSTANCE_NO_PORT =
  'This app cannot connect to an instance here, because this browser has no local store to ' +
  'keep a sign-in in.';

/** The recovery codes, shown once — ruling Q1 of 2026-09-28. */
export const RECOVERY_CODES_LEAD =
  'Write these recovery codes down and keep them somewhere safe. Each one adds a new device to ' +
  'your account once, if you ever lose every device you have. They are shown only now.';

/** A key, shortened to what a rider can compare by eye. */
function fingerprint(publicKey: string): string {
  return `${publicKey.slice(0, 8)}…${publicKey.slice(-8)}`;
}

/** A day, in UTC, so the screen says the same thing wherever it is read. */
function day(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function Receives(): JSX.Element {
  return (
    <KeptVisible>
      <h2>{INSTANCE_RECEIVES_LEAD}</h2>
      <ul>
        {INSTANCE_RECEIVES.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
      <p>{INSTANCE_BELONGS_TO_ITS_OPERATOR}</p>
      <p>{PUBLIC_ROOMS_ADULTS_ONLY}</p>
      <p>{VOICE_CHAT_IS_DISCORD}</p>
    </KeptVisible>
  );
}

function DeviceList({ outcome }: { readonly outcome: DevicesOutcome | undefined }): JSX.Element {
  if (outcome === undefined) return <p className="oyl-muted">Reading your devices…</p>;
  if (outcome.kind === 'unavailable') {
    return <StatusMessage tone="warning">{outcome.text}</StatusMessage>;
  }
  return (
    <ul className="oyl-instance__devices">
      {outcome.devices.map((device: InstanceDevice) => (
        <li key={device.publicKey}>
          <strong>{device.thisDevice ? 'This device' : 'Another device'}</strong>{' '}
          <code>{fingerprint(device.publicKey)}</code>. Added {day(device.addedAt)}; last used{' '}
          {device.lastUsedAt === null ? 'never' : day(device.lastUsedAt)}
          {device.revokedAt === null ? '.' : `; removed ${day(device.revokedAt)}.`}
        </li>
      ))}
    </ul>
  );
}

/** The Instance screen's link to Moderation, drawn for the instance's moderator only (#955). */
export const MODERATE_LINK_TEXT = 'Moderate this instance';

export function InstanceView({
  port,
  moderation,
}: {
  readonly port?: InstancePort | undefined;
  /** Asked, once connected, whether this account moderates the instance (#955). */
  readonly moderation?: ModerationPort | undefined;
}): JSX.Element {
  const [state, setState] = useState<InstanceState | undefined>(undefined);
  const [standing, setStanding] = useState<ModerationStanding | undefined>(undefined);
  const [devices, setDevices] = useState<DevicesOutcome | undefined>(undefined);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | undefined>(undefined);
  const addressId = useId();
  const nameId = useId();

  const read = useCallback(async (): Promise<void> => {
    if (port === undefined) return;
    const now = await port.current();
    setState(now);
    setStanding(undefined);
    if (now.kind === 'connected') {
      setDevices(undefined);
      setDevices(await port.devices());
      if (moderation !== undefined) setStanding(await moderation.standing());
    }
  }, [port, moderation]);

  useEffect(() => {
    void read();
  }, [read]);

  if (port === undefined) {
    return (
      <StatusMessage tone="warning" label="No local store">
        {INSTANCE_NO_PORT}
      </StatusMessage>
    );
  }

  async function connect(): Promise<void> {
    if (port === undefined) return;
    setBusy(true);
    setRefusal(undefined);
    const outcome = await port.connect(address, name);
    setBusy(false);
    if (outcome.kind === 'refused') {
      setRefusal(outcome.text);
      return;
    }
    setRecoveryCodes(outcome.recoveryCodes);
    // ⚠️ What the screen now shows is READ BACK from the instance, not the form.
    await read();
  }

  async function disconnect(): Promise<void> {
    if (port === undefined) return;
    setBusy(true);
    await port.disconnect();
    setBusy(false);
    setRecoveryCodes(undefined);
    setDevices(undefined);
    await read();
  }

  if (state === undefined) {
    return <p className="oyl-muted">Reading this device’s connection…</p>;
  }

  if (state.kind === 'not-connected') {
    return (
      <section className="oyl-panel" aria-labelledby="oyl-instance-connect">
        <h2 id="oyl-instance-connect">Connect</h2>
        <form
          className="oyl-trainer__form"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <p>
            <label htmlFor={addressId}>Instance address</label>{' '}
            <input
              className="oyl-input"
              id={addressId}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://ride.example"
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setRefusal(undefined);
              }}
            />
          </p>
          <p>
            <label htmlFor={nameId}>The name other riders will see (optional)</label>{' '}
            <input
              className="oyl-input"
              id={nameId}
              autoComplete="nickname"
              maxLength={64}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setRefusal(undefined);
              }}
            />
          </p>
          <Receives />
          <p className="oyl-muted">{NOTHING_SENT_UNTIL_CONNECT}</p>
          <Button type="submit" disabled={busy}>
            Connect
          </Button>
        </form>
        {refusal === undefined ? null : (
          <StatusMessage tone="danger" label="Not connected" live>
            {refusal}
          </StatusMessage>
        )}
      </section>
    );
  }

  const disconnectControl = (
    <>
      <KeptVisible>
        <p>{DISCONNECT_KEEPS_RIDES}</p>
      </KeptVisible>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          void disconnect();
        }}
      >
        Disconnect
      </Button>
    </>
  );

  return (
    <>
      {state.kind === 'connected' ? (
        <section className="oyl-panel" aria-labelledby="oyl-instance-connected">
          <h2 id="oyl-instance-connected">Connected</h2>
          <dl className="oyl-instance__facts">
            <dt>Instance</dt>
            <dd>{state.instanceName ?? 'This instance has no name'}</dd>
            <dt>Address</dt>
            <dd>{state.origin}</dd>
            <dt>Your name there</dt>
            <dd>{state.displayName}</dd>
          </dl>
          {/* Controls first (#666): the one action on this state is here, not
              under the device list. */}
          {disconnectControl}
          {/* #955: only the instance's moderator is offered the link. */}
          {standing === 'moderator' ? (
            <p>
              <a href={hrefFor(routeById('moderation'))}>{MODERATE_LINK_TEXT}</a>
            </p>
          ) : null}
          {state.sourceUrl === null ? null : (
            <p>
              <a href={state.sourceUrl} target="_blank" rel="noreferrer">
                Get the source code of this instance
              </a>{' '}
              (opens in a new tab).
            </p>
          )}
        </section>
      ) : (
        <section className="oyl-panel" aria-labelledby="oyl-instance-not-signed-in">
          <h2 id="oyl-instance-not-signed-in">Not signed in</h2>
          <StatusMessage tone="warning" label="Not signed in" live>
            {state.kind === 'signed-out'
              ? `The instance at ${state.origin} no longer accepts this device’s sign-in. Disconnect, then connect again.`
              : `The instance at ${state.origin} did not answer. It may be down, or this device may be offline.`}
          </StatusMessage>
          {disconnectControl}
        </section>
      )}

      {recoveryCodes === undefined || recoveryCodes.length === 0 ? null : (
        <section className="oyl-panel" aria-labelledby="oyl-instance-recovery">
          <h2 id="oyl-instance-recovery">Your recovery codes</h2>
          <p>{RECOVERY_CODES_LEAD}</p>
          <ul className="oyl-instance__codes">
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() => {
              setRecoveryCodes(undefined);
            }}
          >
            I have written them down
          </Button>
        </section>
      )}

      {state.kind === 'connected' ? (
        <section className="oyl-panel" aria-labelledby="oyl-instance-devices">
          <h2 id="oyl-instance-devices">Your devices on this instance</h2>
          <DeviceList outcome={devices} />
        </section>
      ) : null}

      <Receives />
    </>
  );
}
