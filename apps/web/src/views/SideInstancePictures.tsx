// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The Camera page's section for the rider's instance** —
 * [#1106](https://github.com/openzigs/onyourleft/issues/1106): two switches,
 * both off until the rider turns them on, each with the sentence it is
 * consent to BESIDE it rather than behind it (`CameraView.tsx`
 * §`SideAnalyserSwitch`'s rule).
 *
 * 1. Send the side camera's pictures to my instance — named by its address,
 *    and stored against it, so signing in to another instance later is not
 *    agreement to send that one pictures
 *    (`instance-pose.ts` §`SIDE_INSTANCE_CONSENT`).
 * 2. Under it, and only once the instance has said which service the rider's
 *    own key is for: send them on to that service, **named**
 *    (`instance-pose.ts` §`sideInstanceHostedConsent`). The name is asked for
 *    on a press — opening this page sends nothing.
 *
 * ⚠️ **A consent names ONE service.** It is stored as the origin it named. If
 * the rider's key is later for another service, the stored consent no longer
 * matches: the switch shows off for the new service, and the instance refuses
 * the pictures until the rider agrees to the new name or withdraws.
 *
 * ⚠️ **Rendered only once the camera is agreed to**, and with no control at
 * all on a device that is not signed in to an instance — a disabled switch is
 * out of the tab order and never says why (`views/DevicesView.tsx`'s rule).
 */

import { useEffect, useState, type JSX } from 'react';

import {
  hostedServiceHost,
  readSideInstanceChoice,
  SIDE_INSTANCE_CONSENT,
  SIDE_INSTANCE_WHAT_IS_SENT,
  sideInstanceHostedConsent,
  writeSideInstanceHostedConsent,
  writeSideInstanceSwitch,
} from '../camera/instance-pose';
import type { HostedPictureService, SideInstancePicturesPort } from '../camera/side-instance-port';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

/** Said where this device has no instance to send to. */
export const SIDE_INSTANCE_NOT_SIGNED_IN =
  'This device is not signed in to an instance, so there is nowhere to send them. The side ' +
  'camera’s pictures are looked at on this tablet.';

/** The instance, as the switch names it: its host, or its address whole if that cannot be read. */
function instanceHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Said when the rider holds no key of their own on their instance. */
export const SIDE_INSTANCE_NO_KEY =
  'Your instance holds no key of your own for a hosted service, so pictures can only be looked ' +
  'at by the model on your instance. Nothing is sent on.';

/** The first switch's state, in words. Neither says where else a picture goes: another switch may say. */
export const SIDE_INSTANCE_ON_TEXT =
  'On. The next time you pair a side camera, its pictures go to your instance.';
export const SIDE_INSTANCE_OFF_TEXT =
  'Off. No picture is sent to your instance. A side camera already sending them has stopped.';

/**
 * Said when the stored consent names another service than the rider's key is
 * for now: nothing is sent on, and nothing is looked at, until they choose.
 */
export function sideInstanceConsentMoved(agreed: string, now: string): string {
  return (
    `Your key is now for ${now}, and what you agreed to was ${agreed}. Nothing is sent to ` +
    `${now}, and your instance will not look at the side camera’s pictures, until you agree ` +
    'below or withdraw what you agreed to.'
  );
}

export function SideInstancePictures({
  port,
  revision,
  onSwitched,
}: {
  readonly port: SideInstancePicturesPort;
  /** Changes when another section changed a switch this one shows. */
  readonly revision: number;
  /** Called after this section switched the instance ON, so the computer's switch can go off. */
  readonly onSwitched: (on: boolean) => void;
}): JSX.Element {
  const instanceOrigin = port.sideInstanceOrigin();
  const [choice, setChoice] = useState(() => readSideInstanceChoice(instanceOrigin));
  const [service, setService] = useState<HostedPictureService | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    setChoice(readSideInstanceChoice(instanceOrigin));
  }, [revision, instanceOrigin]);

  const on = choice !== undefined;
  const agreedOrigin = choice?.source === 'instance-hosted' ? choice.endpoint : undefined;
  const agreedHost = agreedOrigin === undefined ? undefined : hostedServiceHost(agreedOrigin);
  // The service a consent would name now: what the instance said, or what was agreed to before.
  const offered =
    service?.kind === 'held'
      ? { origin: service.origin, host: service.host }
      : agreedOrigin !== undefined && agreedHost !== undefined && service === undefined
        ? { origin: agreedOrigin, host: agreedHost }
        : undefined;
  const moved =
    service?.kind === 'held' && agreedOrigin !== undefined && agreedOrigin !== service.origin;

  const ask = (): void => {
    setAsking(true);
    void port
      .askHostedPictureService()
      .then(setService)
      .catch(() => {
        setService(undefined);
      })
      .finally(() => {
        setAsking(false);
      });
  };

  return (
    <section aria-labelledby="oyl-camera-instance">
      <h3 id="oyl-camera-instance">Your instance</h3>
      {/* What is sent, to where, sealed, and not kept — never tucked (#666). */}
      <p data-oyl-kept-visible="">{SIDE_INSTANCE_WHAT_IS_SENT}</p>
      {instanceOrigin === undefined ? (
        <p>{SIDE_INSTANCE_NOT_SIGNED_IN}</p>
      ) : (
        <>
          <p id="oyl-side-instance-consent">{SIDE_INSTANCE_CONSENT}</p>
          <p>
            <label className="oyl-announce__switch">
              <input
                type="checkbox"
                checked={on}
                aria-describedby="oyl-side-instance-consent"
                onChange={(event) => {
                  const kept = writeSideInstanceSwitch(
                    event.target.checked ? instanceOrigin : undefined,
                  );
                  setChoice(readSideInstanceChoice(instanceOrigin));
                  if (!event.target.checked) {
                    setService(undefined);
                  }
                  onSwitched(kept && event.target.checked);
                }}
              />{' '}
              Send the side camera’s pictures to my instance, {instanceHost(instanceOrigin)}
            </label>
          </p>
          <p>{on ? SIDE_INSTANCE_ON_TEXT : SIDE_INSTANCE_OFF_TEXT}</p>
          {on ? (
            <>
              <h4 id="oyl-side-instance-hosted">A hosted service, on your own key</h4>
              <p>
                Your instance can send the pictures on to a hosted service instead of using its own
                model, but only one you hold your own key for, and only if you agree to it by name.
                Pressing the button asks your instance which service your key is for; it sends no
                picture.
              </p>
              <p>
                <Button variant="secondary" onClick={ask} disabled={asking}>
                  Ask my instance which service my key is for
                </Button>
              </p>
              {service?.kind === 'unavailable' ? (
                <StatusMessage tone="warning" live>
                  {service.text}
                </StatusMessage>
              ) : null}
              {service?.kind === 'none' ? (
                <StatusMessage tone="info" live>
                  {SIDE_INSTANCE_NO_KEY}
                </StatusMessage>
              ) : null}
              {moved && agreedHost !== undefined && service.kind === 'held' ? (
                <StatusMessage tone="warning" live>
                  {sideInstanceConsentMoved(agreedHost, service.host)}
                </StatusMessage>
              ) : null}
              {service?.kind === 'none' && agreedHost !== undefined ? (
                <p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      writeSideInstanceHostedConsent(undefined);
                      setChoice(readSideInstanceChoice(instanceOrigin));
                    }}
                  >
                    Withdraw what I agreed to for {agreedHost}
                  </Button>
                </p>
              ) : null}
              {offered === undefined ? null : (
                <>
                  <div id="oyl-side-instance-hosted-consent">
                    {sideInstanceHostedConsent(offered.host).map((paragraph, index) =>
                      index === 0 ? (
                        <p key={paragraph}>
                          <strong>{paragraph}</strong>
                        </p>
                      ) : (
                        <p key={paragraph}>{paragraph}</p>
                      ),
                    )}
                  </div>
                  <p>
                    <label className="oyl-announce__switch">
                      <input
                        type="checkbox"
                        checked={agreedOrigin === offered.origin}
                        aria-describedby="oyl-side-instance-hosted-consent"
                        onChange={(event) => {
                          writeSideInstanceHostedConsent(
                            event.target.checked ? offered.origin : undefined,
                          );
                          setChoice(readSideInstanceChoice(instanceOrigin));
                        }}
                      />{' '}
                      Send the side camera’s pictures on to {offered.host}
                    </label>
                  </p>
                  <p>
                    {agreedOrigin === offered.origin
                      ? `On. The next picture your instance is sent goes on to ${offered.host}.`
                      : `Off. No picture is sent on to ${offered.host}.`}
                  </p>
                </>
              )}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
