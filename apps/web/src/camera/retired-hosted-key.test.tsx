// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **No hosted key left on any device** — #1103's third criterion.
 *
 * A key a device kept before #1103 (`oyl.hosted-model.v1`, #518) is deleted
 * on the first launch, before anything is drawn, and the rider is told once,
 * on the Camera page. Each case seeds the device's real `localStorage` the
 * way the old Camera page wrote it, and reads it back through the same
 * storage after the launch path ran. `retired-hosted-key-main.test.ts` holds
 * that `main.tsx` runs that path before it draws anything.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CameraView } from '../views/CameraView';
import { INSTANCE_ROUTE } from '../shell/routes';
import { mount, settle, type Mounted } from '../testing/mount';

import {
  readRetiredKeyNotice,
  RETIRED_HOSTED_MODEL_STORAGE_KEY,
  RETIRED_KEY_BEFORE,
  RETIRED_KEY_NOTICE_STORAGE_KEY,
  retireDeviceHostedKey,
  retiredHostedKeyEraser,
  type RetiredKeyStorage,
} from './retired-hosted-key';
import { CameraController } from './session';
import { manualSchedule, scriptedCamera } from './testing';
import { browserSecureWindow } from './secure-window-testing';

/** A key the way `camera/hosted-model.ts` §`writeHostedModel` stored one, until #1103. */
const OLD_ROW = JSON.stringify({
  address: 'https://models.example.invalid',
  model: 'a-model',
  key: 'fixture-hosted-key-DO-NOT-LEAK-0123456789',
});

let mounted: Mounted | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
});

async function openCamera(): Promise<void> {
  const controller = new CameraController({
    secureWindow: browserSecureWindow(),
    port: scriptedCamera().port,
    schedule: manualSchedule().schedule,
  });
  mounted = await mount(<CameraView controller={controller} />);
  await settle();
}

describe('the first launch after #1103', () => {
  it('deletes the key this device kept, and tells the rider once, on the Camera page', async () => {
    localStorage.setItem(RETIRED_HOSTED_MODEL_STORAGE_KEY, OLD_ROW);

    // What `main.tsx` §`render` does before it draws anything.
    retireDeviceHostedKey(localStorage);
    expect(localStorage.getItem(RETIRED_HOSTED_MODEL_STORAGE_KEY)).toBeNull();
    // And nothing of the key is anywhere in the device's storage.
    expect(JSON.stringify({ ...localStorage })).not.toContain('fixture-hosted-key');

    await openCamera();
    const notice = [...document.querySelectorAll('p')].find((paragraph) =>
      (paragraph.textContent ?? '').includes(RETIRED_KEY_BEFORE),
    );
    expect(notice, 'the one sentence is not on the Camera page').toBeDefined();
    const link = notice?.querySelector('a');
    expect(link?.textContent).toBe(INSTANCE_ROUTE.title);
    expect(link?.getAttribute('href')).toBe(`#${INSTANCE_ROUTE.path}`);
    // Shown, and the note taken away: the storage is empty again.
    expect(localStorage.length).toBe(0);

    // Once: the next visit says nothing.
    mounted?.unmount();
    await openCamera();
    expect(document.body.textContent).not.toContain(RETIRED_KEY_BEFORE);
  });

  it('says nothing, and leaves nothing, on a device that held no key', async () => {
    localStorage.setItem('oyl.theme.v1', '"dark"');
    retireDeviceHostedKey(localStorage);
    expect(readRetiredKeyNotice(localStorage)).toBe(false);
    await openCamera();
    expect(document.body.textContent).not.toContain(RETIRED_KEY_BEFORE);
    // Nothing else on the device is touched.
    expect(localStorage.getItem('oyl.theme.v1')).toBe('"dark"');
  });

  it('touches nothing but the key: the rider’s other settings stay', () => {
    localStorage.setItem(RETIRED_HOSTED_MODEL_STORAGE_KEY, OLD_ROW);
    localStorage.setItem('oyl.analysis-endpoint.v1', '{"address":"http://192.168.1.20:8080"}');
    retireDeviceHostedKey(localStorage);
    expect(localStorage.getItem('oyl.analysis-endpoint.v1')).not.toBeNull();
    expect(localStorage.getItem(RETIRED_KEY_NOTICE_STORAGE_KEY)).toBe('yes');
  });

  it('never throws on storage that refuses, and has nothing to do without any', () => {
    const refusing: RetiredKeyStorage = {
      getItem: () => OLD_ROW,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('refused');
      },
    };
    expect(() => {
      retireDeviceHostedKey(refusing);
    }).not.toThrow();
    expect(() => {
      retireDeviceHostedKey(undefined);
    }).not.toThrow();
    expect(readRetiredKeyNotice(undefined)).toBe(false);
  });
});

describe('an erase', () => {
  it('forgets a key still here, and the note, if either is somehow left', () => {
    localStorage.setItem(RETIRED_HOSTED_MODEL_STORAGE_KEY, OLD_ROW);
    localStorage.setItem(RETIRED_KEY_NOTICE_STORAGE_KEY, 'yes');
    retiredHostedKeyEraser(localStorage).forget();
    expect(localStorage.getItem(RETIRED_HOSTED_MODEL_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RETIRED_KEY_NOTICE_STORAGE_KEY)).toBeNull();
  });
});
