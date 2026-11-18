// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Scanning the instance card inside the app — #2785, ADR 0047 D-6.
 *
 * A "frame" here is a QR code drawn into pixels (`camera/testing.ts`
 * §`photographedCode`) and read by the REAL decoder (`side-link-qr.ts`
 * §`pairingCodeFromPixels`, through `session.ts` §`readPairingCode`). The
 * card it carries is offered through the REAL port, and what is kept is read
 * back from the device's storage through `sealedRouteGate`, which is how every
 * sealed feature looks the pin up — never from what a call returned.
 */

import {
  base32Unpadded,
  INSTANCE_KEY_PURPOSE,
  instanceIdentityFingerprint,
  instanceKeyId,
  toHex,
  type Sha256,
  type SignatureVerifier,
} from '@onyourleft/domain';
import { webCryptoHpkePrimitives } from '@onyourleft/store';
import { act, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CameraController } from '../camera/session';
import { browserSecureWindow } from '../camera/secure-window-testing';
import { pairingCodeModules } from '../camera/side-link-qr';
import {
  manualSchedule,
  photographedCode,
  scriptedCamera,
  type ScriptedCamera,
} from '../camera/testing';
import { codeWithCard, INSTANCE_KEY_TEXT, sealedRouteGate } from '../instance/instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstancePort,
  type InstanceStorage,
} from '../instance/instance-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY, readInstanceAccount } from '../instance/sign-in';
import { LOADED_LOCALLY, scriptedInstance } from '../instance/testing';
import { mount, settle, typeIntoTextArea, type Mounted } from '../testing/mount';
import { CARD_SCAN_TEXT, CardScanner } from './CardScanner';
import { InstanceKeys } from './InstanceKeys';
import { OWNER_CLAIM_TEXT } from './OwnerClaim';
import { CONNECT_SCANNED_TEXT, InstanceView, LINK_FIELD_LABEL } from './InstanceView';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const ORIGIN = 'https://instance.example.org';
const CODE = 'abcd-efgh-jkmn-pqrs';

/** A digest that is the input, folded: the same fingerprint every time, without a real hash. */
const sha256: Sha256 = (bytes) => {
  const out = new Uint8Array(32);
  bytes.forEach((byte, index) => {
    out[index % 32] = ((out[index % 32] ?? 0) + byte * (index + 1)) & 0xff;
  });
  return Promise.resolve(out);
};
const verifier: SignatureVerifier = { algorithm: 'Ed25519', verify: () => Promise.resolve(true) };

/** The card of an identity key, as the instance's operator would hand it out. */
async function cardOf(identityKey: string): Promise<{ card: string; fingerprint: string }> {
  const fingerprint = base32Unpadded(
    await instanceIdentityFingerprint(sha256, ORIGIN, identityKey),
  );
  return { card: `oyl-instance:${ORIGIN}#${fingerprint}`, fingerprint };
}

const SERVED_IDENTITY = 'aa'.repeat(32);
const OTHER_IDENTITY = 'cc'.repeat(32);

/**
 * The REAL port for a device signed in to {@link ORIGIN}, holding `pin` or no
 * pin, against an instance that serves keys signed by {@link SERVED_IDENTITY}.
 */
async function realPort(pin?: string): Promise<{ port: InstancePort; storage: InstanceStorage }> {
  const map = new Map<string, string>([
    [
      INSTANCE_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        origin: ORIGIN,
        instanceAthleteId: 'a',
        ...(pin === undefined ? {} : { pin }),
      }),
    ],
    [INSTANCE_SESSION_STORAGE_KEY, JSON.stringify({ origin: ORIGIN, token: 't' })],
  ]);
  const storage: InstanceStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  const pair = await webCryptoHpkePrimitives.generateX25519KeyPair();
  const statement = {
    purpose: INSTANCE_KEY_PURPOSE,
    instanceOrigin: ORIGIN,
    keyId: await instanceKeyId(sha256, pair.publicKey),
    encryptionKey: toHex(pair.publicKey),
    serial: 1,
    notBefore: 1_789_999_000,
    issuedAt: 1_789_999_000,
    notAfter: 1_790_100_000,
  };
  const port = createInstancePort({
    storage,
    loadedFrom: LOADED_LOCALLY,
    ensureLocalAthlete: () => Promise.resolve(),
    signingKey: () => Promise.reject(new Error('nothing here signs')),
    sha256,
    verifier,
    now: () => 1_790_000_000_000,
    send: (url) => {
      if (new URL(url).pathname !== '/v1/instance/keys') {
        return Promise.reject(new Error(`this instance answers only its keys, not ${url}`));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            identityKey: SERVED_IDENTITY,
            statements: [{ statement, signature: 'bb'.repeat(64) }],
            endorsements: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    },
  });
  return { port, storage };
}

/** What the device's camera shows: a QR code of `text`, or a blank wall. */
function cameraShowing(): {
  readonly camera: ScriptedCamera;
  readonly show: (text: string | undefined) => void;
} {
  let showing: string | undefined;
  const camera = scriptedCamera({
    codePixels: () =>
      showing === undefined
        ? { width: 4, height: 4, rgba: new Uint8ClampedArray(64).fill(255) }
        : photographedCode(pairingCodeModules(showing)),
  });
  return {
    camera,
    show: (text) => {
      showing = text;
    },
  };
}

function agreed(camera: ScriptedCamera, options: { loadCodeReader?: () => Promise<never> } = {}) {
  const controller = new CameraController({
    secureWindow: browserSecureWindow(),
    port: camera.port,
    // No liveness poll: nothing here is about a track ending on its own.
    schedule: () => () => undefined,
    ...options,
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true });
  return controller;
}

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

function button(name: string): HTMLButtonElement {
  const found = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

async function press(name: string): Promise<void> {
  const pressed = button(name);
  await act(async () => {
    pressed.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await settle();
}

/**
 * Wait, on the real clock, until `done` — the scan reads every 300 ms, and the
 * port's answer is real cryptography — a bounded number of times.
 */
async function until(done: () => boolean): Promise<void> {
  for (let tick = 0; tick < 100 && !done(); tick += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
    });
  }
}

function boxes(): HTMLTextAreaElement[] {
  return [...(mounted?.container.querySelectorAll('textarea') ?? [])];
}

/** A timer the test owns: every tick is a call the test makes. */
function ownedTicks() {
  const ticks = new Set<() => void>();
  return {
    every: (tick: () => void): (() => void) => {
      ticks.add(tick);
      return () => {
        ticks.delete(tick);
      };
    },
    running: (): number => ticks.size,
    fire: async (): Promise<void> => {
      for (const tick of ticks) tick();
      await settle();
    },
  };
}

function codeReads(camera: ScriptedCamera): number {
  return camera.calls.filter((call) => call === 'code').length;
}

describe('a scanned card pins exactly as a pasted one (#2785, D-6)', () => {
  it('pins the card of a scanned card-and-code line, read back as the sealed routes read it', async () => {
    const { port, storage } = await realPort();
    const { card, fingerprint } = await cardOf(SERVED_IDENTITY);
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceKeys port={port} camera={agreed(camera)} />);
    await settle();
    expect(sealedRouteGate(readInstanceAccount(storage), LOADED_LOCALLY).kind).toBe('needs-card');
    show(codeWithCard(card, CODE));
    await press(CARD_SCAN_TEXT.start);
    await until(() => readInstanceAccount(storage)?.pin !== undefined);
    expect(sealedRouteGate(readInstanceAccount(storage), LOADED_LOCALLY)).toEqual({
      kind: 'open',
      pin: fingerprint,
    });
    // The card box holds what was offered: the card, without the code a
    // connected device has no use for.
    expect(boxes()[0]?.value).toBe(card);
    expect(camera.liveStreams()).toBe(0);
  });

  it('fills the line box with the card and its code on the Connect form, and links from it on the press', async () => {
    const scripted = scriptedInstance();
    const { card } = await cardOf(SERVED_IDENTITY);
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceView port={scripted.port} camera={agreed(camera)} />);
    await settle();
    show(`  ${codeWithCard(card, CODE.toUpperCase())}\n`);
    await press(CARD_SCAN_TEXT.start);
    await until(() => text().includes(CONNECT_SCANNED_TEXT.line));
    const [cardBox, lineBox, claimBox] = boxes();
    expect(lineBox?.value).toBe(codeWithCard(card, CODE));
    expect(cardBox?.value).toBe('');
    // #2823: the same line is what the owner's setup page shows as a claim, so
    // it is in the claim box too, and the press says which it is.
    expect(claimBox?.value).toBe(codeWithCard(card, CODE));
    // Nothing was sent by the scan: the form's own sentence is kept.
    expect(scripted.calls.filter((call) => !call.startsWith('current'))).toEqual([]);
    await press('Add this device');
    expect(scripted.calls).toContain(`link ${codeWithCard(card, CODE)}`);
    expect(scripted.held.connected).toBe(true);
  });

  it('fills only the claim box from the claim form’s own scanner, and claims on the press (#2823)', async () => {
    const scripted = scriptedInstance();
    const { card } = await cardOf(SERVED_IDENTITY);
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceView port={scripted.port} camera={agreed(camera)} />);
    await settle();
    show(`  ${codeWithCard(card, CODE)}\n`);
    await press(OWNER_CLAIM_TEXT.scan);
    await until(() => boxes()[2]?.value !== '');
    const [cardBox, lineBox, claimBox] = boxes();
    expect(claimBox?.value).toBe(codeWithCard(card, CODE));
    expect(cardBox?.value).toBe('');
    expect(lineBox?.value).toBe('');
    expect(camera.liveStreams()).toBe(0);
    expect(scripted.calls.filter((call) => !call.startsWith('current'))).toEqual([]);
    await press(OWNER_CLAIM_TEXT.claim);
    expect(scripted.calls).toContain(`claimOwner ${codeWithCard(card, CODE)}`);
  });

  it('puts a scanned card alone in the card box on the Connect form, and sends nothing', async () => {
    const scripted = scriptedInstance();
    const { card } = await cardOf(SERVED_IDENTITY);
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceView port={scripted.port} camera={agreed(camera)} />);
    await settle();
    show(card);
    await press(CARD_SCAN_TEXT.start);
    await until(() => text().includes(CONNECT_SCANNED_TEXT.card));
    const [cardBox, lineBox, claimBox] = boxes();
    expect(cardBox?.value).toBe(card);
    expect(lineBox?.value).toBe('');
    expect(claimBox?.value).toBe('');
    expect(scripted.calls.filter((call) => !call.startsWith('current'))).toEqual([]);
    // A rider's own edit takes the sentence away: it described the scan.
    await typeIntoTextArea(cardBox!, `${card} `);
    expect(text()).not.toContain(CONNECT_SCANNED_TEXT.card);
    expect(text()).toContain(LINK_FIELD_LABEL);
  });

  it('takes a refusal from an earlier press away when a scan fills a box', async () => {
    const scripted = scriptedInstance({
      connectAnswer: { kind: 'refused', text: 'The instance would not have you.' },
    });
    const { card } = await cardOf(SERVED_IDENTITY);
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceView port={scripted.port} camera={agreed(camera)} />);
    await settle();
    await press('Connect');
    await until(() => text().includes('The instance would not have you.'));
    show(card);
    await press(CARD_SCAN_TEXT.start);
    await until(() => text().includes(CONNECT_SCANNED_TEXT.card));
    expect(text()).not.toContain('The instance would not have you.');
  });

  it('does not say a card was read when the code is not card-shaped', async () => {
    const scripted = scriptedInstance();
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceView port={scripted.port} camera={agreed(camera)} />);
    await settle();
    show('https://example.org/wifi');
    await press(CARD_SCAN_TEXT.start);
    await until(() => boxes()[0]?.value === 'https://example.org/wifi');
    await settle();
    expect(text()).not.toContain(CONNECT_SCANNED_TEXT.card);
    expect(scripted.calls.filter((call) => !call.startsWith('current'))).toEqual([]);
  });

  it('keeps the pin and says what paste says, for a card with a different fingerprint', async () => {
    const pinned = await cardOf(SERVED_IDENTITY);
    const other = await cardOf(OTHER_IDENTITY);
    const { port, storage } = await realPort(pinned.fingerprint);
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceKeys port={port} camera={agreed(camera)} />);
    await settle();
    show(codeWithCard(other.card, CODE));
    await press(CARD_SCAN_TEXT.start);
    await until(() => text().includes(INSTANCE_KEY_TEXT.mismatch));
    expect(text()).toContain(INSTANCE_KEY_TEXT.mismatch);
    expect(readInstanceAccount(storage)?.pin).toBe(pinned.fingerprint);
    const scanned = refusalText();

    // The same card pasted, on a fresh screen over a fresh port.
    mounted.unmount();
    const pasted = await realPort(pinned.fingerprint);
    mounted = await mount(<InstanceKeys port={pasted.port} />);
    await settle();
    await typeIntoTextArea(boxes()[0]!, other.card);
    await press('Use this card');
    await until(() => refusalText() !== undefined);
    expect(refusalText()).toBe(scanned);
    expect(readInstanceAccount(pasted.storage)?.pin).toBe(pinned.fingerprint);
  });

  it.each([
    [
      'one base32 character changed',
      (card: string) =>
        `${card.slice(0, -2)}${card.at(-2) === 'A' ? 'B' : 'A'}${card.at(-1) ?? ''}`,
    ],
    ['truncated', (card: string) => card.slice(0, -5)],
  ])('refuses a card %s, as paste does, and pins nothing', async (_, damage) => {
    const { card } = await cardOf(SERVED_IDENTITY);
    const damaged = damage(card);
    expect(damaged).not.toBe(card);
    const { port, storage } = await realPort();
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceKeys port={port} camera={agreed(camera)} />);
    await settle();
    show(damaged);
    await press(CARD_SCAN_TEXT.start);
    await until(() => refusalText() !== undefined);
    const scanned = refusalText();
    expect(scanned).toBeDefined();
    expect(readInstanceAccount(storage)?.pin).toBeUndefined();

    mounted.unmount();
    const pasted = await realPort();
    mounted = await mount(<InstanceKeys port={pasted.port} />);
    await settle();
    await typeIntoTextArea(boxes()[0]!, damaged);
    await press('Use this card');
    await until(() => refusalText() !== undefined);
    expect(refusalText()).toBe(scanned);
    expect(readInstanceAccount(pasted.storage)?.pin).toBeUndefined();
  });
});

/** The text of the "Card not used" refusal, or `undefined` when there is none. */
function refusalText(): string | undefined {
  const found = [...(mounted?.container.querySelectorAll('[role="status"]') ?? [])].find((each) =>
    each.textContent?.includes('Card not used'),
  );
  return found?.textContent ?? undefined;
}

/** The scanner on its own, with a timer the test owns. */
async function scanner(
  controller: CameraController,
  timer: ReturnType<typeof ownedTicks>,
  scanned: string[] = [],
): Promise<void> {
  function Screen(): JSX.Element {
    return (
      <>
        <textarea aria-label="The card" />
        <CardScanner
          controller={controller}
          every={timer.every}
          onScanned={(read) => {
            scanned.push(read);
          }}
        />
      </>
    );
  }
  mounted = await mount(<Screen />);
}

describe('no frame outlives the scanner (#2785, ADR 0033 D-4)', () => {
  it('stops the camera it turned on, and reads no frame, once the scanner is closed', async () => {
    const { camera } = cameraShowing();
    const controller = agreed(camera);
    const timer = ownedTicks();
    await scanner(controller, timer);
    await press(CARD_SCAN_TEXT.start);
    expect(camera.liveStreams()).toBe(1);
    expect(camera.facings).toEqual(['environment']);
    const video = mounted?.container.querySelector('video');
    // The back camera's picture is shown as seen, not as a mirror.
    expect(video?.classList.contains('oyl-scan-viewfinder__video--as-seen')).toBe(true);
    expect(text()).toContain(CARD_SCAN_TEXT.caption);
    await timer.fire();
    expect(codeReads(camera)).toBe(1);
    await press(CARD_SCAN_TEXT.close);
    expect(camera.liveStreams()).toBe(0);
    expect(camera.calls).toContain('preview-detached');
    expect(timer.running()).toBe(0);
    await timer.fire();
    expect(codeReads(camera)).toBe(1);
    expect(controller.state().captured).toBe(0);
    // Focus is back on the control that started the scan.
    expect(document.activeElement).toBe(button(CARD_SCAN_TEXT.start));
  });

  it('stops the camera and reads no frame once the screen goes away mid-scan', async () => {
    const { camera } = cameraShowing();
    const timer = ownedTicks();
    await scanner(agreed(camera), timer);
    await press(CARD_SCAN_TEXT.start);
    expect(camera.liveStreams()).toBe(1);
    mounted?.unmount();
    mounted = undefined;
    expect(camera.liveStreams()).toBe(0);
    expect(timer.running()).toBe(0);
  });

  it('gives back a camera that came on after the screen went away', async () => {
    const camera = scriptedCamera({ holdStarts: true });
    const timer = ownedTicks();
    await scanner(agreed(camera), timer);
    await press(CARD_SCAN_TEXT.start);
    await press(CARD_SCAN_TEXT.start);
    mounted?.unmount();
    mounted = undefined;
    camera.releaseStarts();
    await settle();
    expect(camera.calls.filter((call) => call === 'start')).toEqual(['start']);
    expect(camera.liveStreams()).toBe(0);
  });

  it('stops the camera once a code is read, and hands the code over once', async () => {
    const { camera, show } = cameraShowing();
    const timer = ownedTicks();
    const scanned: string[] = [];
    await scanner(agreed(camera), timer, scanned);
    await press(CARD_SCAN_TEXT.start);
    show('oyl-instance:https://instance.example.org#X');
    await timer.fire();
    expect(scanned).toEqual(['oyl-instance:https://instance.example.org#X']);
    expect(camera.liveStreams()).toBe(0);
    expect(timer.running()).toBe(0);
  });

  it('leaves on a back camera the rider already had on, and turns a front one back', async () => {
    const { camera } = cameraShowing();
    const controller = agreed(camera);
    await controller.turnOn('environment');
    const timer = ownedTicks();
    await scanner(controller, timer);
    await press(CARD_SCAN_TEXT.start);
    await press(CARD_SCAN_TEXT.close);
    expect(controller.state().live).toBe(true);
    expect(camera.facings).toEqual(['environment']);

    await controller.turnOn('user');
    await press(CARD_SCAN_TEXT.start);
    expect(controller.state().facing).toBe('environment');
    await press(CARD_SCAN_TEXT.close);
    await settle();
    expect(controller.state().facing).toBe('user');
    expect(camera.liveStreams()).toBe(1);
  });
});

describe('a scan while a card is being checked (#2785)', () => {
  it('fills the box and offers nothing more until the first card’s answer is in', async () => {
    const scripted = scriptedInstance({ connected: true });
    const offered: string[] = [];
    const port: InstancePort = {
      ...scripted.port,
      offerCard: (card) => {
        offered.push(card);
        return new Promise(() => undefined);
      },
    };
    const { camera, show } = cameraShowing();
    mounted = await mount(<InstanceKeys port={port} camera={agreed(camera)} />);
    await settle();
    const first = (await cardOf(SERVED_IDENTITY)).card;
    const second = (await cardOf(OTHER_IDENTITY)).card;
    await typeIntoTextArea(boxes()[0]!, first);
    await press('Use this card');
    show(second);
    await press(CARD_SCAN_TEXT.start);
    await until(() => boxes()[0]?.value === second);
    expect(boxes()[0]?.value).toBe(second);
    expect(offered).toEqual([first]);
  });
});

describe('when the camera cannot scan, the paste box is what is left (#2785)', () => {
  it('turns the rider’s front camera back on when the back one will not open', async () => {
    const camera = scriptedCamera({ startFails: 'unavailable', startFailsFacing: 'environment' });
    const controller = agreed(camera);
    await controller.turnOn('user');
    await scanner(controller, ownedTicks());
    await press(CARD_SCAN_TEXT.start);
    await settle();
    expect(text()).toContain(CARD_SCAN_TEXT.camera);
    expect(camera.facings).toEqual(['user', 'environment', 'user']);
    expect(controller.state().facing).toBe('user');
  });

  it('says so in a plain sentence when camera permission is denied, and keeps the box', async () => {
    const camera = scriptedCamera({ permission: 'not-permitted' });
    await scanner(agreed(camera), ownedTicks());
    await press(CARD_SCAN_TEXT.start);
    expect(text()).toContain(CARD_SCAN_TEXT.camera);
    expect(mounted?.container.querySelector('textarea')).not.toBeNull();
    expect(mounted?.container.querySelector('video')).toBeNull();
    expect(camera.liveStreams()).toBe(0);
    // The start button stays, so the rider can try again after allowing it.
    expect(button(CARD_SCAN_TEXT.start)).toBeDefined();
  });

  it('closes and says so when the camera stops under the scan', async () => {
    const { camera } = cameraShowing();
    const controller = agreed(camera);
    const timer = ownedTicks();
    await scanner(controller, timer);
    await press(CARD_SCAN_TEXT.start);
    expect(text()).toContain(CARD_SCAN_TEXT.looking);
    // The agreement taken back on another screen, which stops the camera.
    await act(async () => {
      controller.revoke();
      await Promise.resolve();
    });
    await settle();
    expect(text()).toContain(CARD_SCAN_TEXT.stopped);
    expect(text()).not.toContain(CARD_SCAN_TEXT.looking);
    expect(timer.running()).toBe(0);
    expect(camera.liveStreams()).toBe(0);
  });

  it('does not ask for the rider’s earlier camera again once the camera stopped under the scan', async () => {
    const { camera } = cameraShowing();
    const polling = manualSchedule();
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: camera.port,
      schedule: polling.schedule,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true });
    await controller.turnOn('user');
    await scanner(controller, ownedTicks());
    await press(CARD_SCAN_TEXT.start);
    // The track ends under the scan, as the OS camera indicator's revoke does;
    // the liveness poll is what hears it.
    await act(async () => {
      camera.endTheTrack();
      polling.fire();
      await Promise.resolve();
    });
    await settle();
    expect(text()).toContain(CARD_SCAN_TEXT.stopped);
    expect(camera.facings).toEqual(['user', 'environment']);
    expect(camera.liveStreams()).toBe(0);
  });

  it('says nothing of a stopped camera when the rider closed the scanner', async () => {
    const { camera } = cameraShowing();
    await scanner(agreed(camera), ownedTicks());
    await press(CARD_SCAN_TEXT.start);
    await press(CARD_SCAN_TEXT.close);
    expect(text()).not.toContain(CARD_SCAN_TEXT.stopped);
  });

  it('asks for the camera agreement first, without touching the camera', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: camera.port,
      schedule: () => () => undefined,
    });
    await scanner(controller, ownedTicks());
    await press(CARD_SCAN_TEXT.start);
    expect(text()).toContain(CARD_SCAN_TEXT['no-consent']);
    expect(camera.calls).toEqual([]);
  });

  it('stops, turns the camera off and says so when the code reader will not load', async () => {
    const camera = scriptedCamera();
    const timer = ownedTicks();
    await scanner(
      agreed(camera, { loadCodeReader: () => Promise.reject(new Error('no chunk')) }),
      timer,
    );
    await press(CARD_SCAN_TEXT.start);
    await timer.fire();
    expect(text()).toContain(CARD_SCAN_TEXT.reader);
    expect(camera.liveStreams()).toBe(0);
  });

  it('draws no scanner where the device has no camera to scan with', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(() => button(CARD_SCAN_TEXT.start)).toThrow();
    expect(() => button(OWNER_CLAIM_TEXT.scan)).toThrow();
    // The card, the other device's line and the owner's claim (#2823): each pasted.
    expect(boxes().length).toBe(3);
  });
});
