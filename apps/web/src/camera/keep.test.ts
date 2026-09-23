// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The per-ride keep, over the round-trip harness rather than a stub** —
 * #384, ADR 0029 D-2.
 *
 * ⚠️ **The store here is `@onyourleft/store/testing`'s and every read goes
 * through `harness.read`, which discards every open handle first.** CLAUDE.md
 * §5's fourth cause — *"the test asserted against the object it just
 * constructed rather than a fresh read"* — is the one a stub cannot detect, and
 * this feature's payload is the one artefact in the program that nothing can
 * reconstruct if a write is lost.
 *
 * The three properties D-2 turns on are asserted by name below: off by default,
 * off again at every switch-on, and nowhere persisted.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, afterEach, beforeEach } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';
import type { StoreHarness } from '@onyourleft/store/testing';
import { cameraFrameId } from '@onyourleft/store';

import { stripComments } from '../units/no-inline-units';

import { keepThisRide } from './keep';
import { CameraController } from './session';
import type { CameraStorePort } from './store-port';
import { cleanFrameBytes, manualSchedule, scriptedCamera } from './testing';

const AGREED = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false } as const;

let harness: StoreHarness;
let minted = 0;

beforeEach(async () => {
  harness = createStoreHarness();
  minted = 0;
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

/**
 * A port over the harness's **writing** handle.
 *
 * ⚠️ The reads in every assertion below go through `harness.read` instead,
 * which discards this handle and opens a fresh one. That asymmetry is the whole
 * point of the harness and is why this helper deliberately does not offer a
 * read of its own.
 */
function portFor(): CameraStorePort {
  return {
    store: {
      putCameraFrame: async (record) =>
        harness.write(async (store) => store.putCameraFrame(record)),
      countCameraFrames: async (owner) =>
        harness.write(async (store) => store.countCameraFrames(owner)),
      deleteCameraFrames: async (owner) =>
        harness.write(async (store) => store.deleteCameraFrames(owner)),
    },
    athleteId: ATHLETE_A,
    newFrameId: () => {
      minted += 1;
      return cameraFrameId(`kept-${String(minted)}`);
    },
    now: () => unixSeconds(1_700_000_000 + minted),
  };
}

async function controllerWithKeep(): Promise<{
  controller: CameraController;
  camera: ReturnType<typeof scriptedCamera>;
}> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
    keep: keepThisRide(portFor()),
  });
  controller.agree(AGREED);
  await controller.turnOn();
  return { controller, camera };
}

async function keptOnDisk(): Promise<number> {
  return harness.read(async (store) => (await store.listCameraFrames(ATHLETE_A)).length);
}

describe('the default is that nothing is kept', () => {
  it('keeps nothing when the rider has not asked', async () => {
    const { controller } = await controllerWithKeep();
    expect(controller.state().keeping).toBe(false);

    await controller.captureOne();

    // Read on a connection nothing wrote through. A picture that had been
    // written and reported as discarded is the defect this reads back for.
    await expect(keptOnDisk()).resolves.toBe(0);
  });

  it('keeps the picture once the rider turns the switch on', async () => {
    const { controller } = await controllerWithKeep();
    controller.setKeeping(true);

    const outcome = await controller.captureOne();
    expect(outcome.taken).toBe(true);

    const read = await harness.read(async (store) => store.listCameraFrames(ATHLETE_A));
    expect(read).toHaveLength(1);
    // Byte for byte, which is the assertion a length check is not: a layer that
    // re-encoded on the way in returns a plausible JPEG of a plausible size.
    expect(read[0]?.bytes).toStrictEqual(cleanFrameBytes());
    expect(read[0]?.width).toBe(640);
  });

  it('stops keeping the moment the rider turns it off again', async () => {
    const { controller } = await controllerWithKeep();
    controller.setKeeping(true);
    await controller.captureOne();
    controller.setKeeping(false);
    await controller.captureOne();

    await expect(keptOnDisk()).resolves.toBe(1);
  });

  it('cannot be armed before the camera is on', () => {
    // A switch that took effect before a session would be reset by the session
    // starting, which reads to a rider as a control that does not work.
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      keep: keepThisRide(portFor()),
    });
    controller.agree(AGREED);

    controller.setKeeping(true);

    expect(controller.state().keeping).toBe(false);
  });
});

describe('it is per-ride, which is the whole of ADR 0029 D-2', () => {
  it('is OFF again at every switch-on', async () => {
    const { controller } = await controllerWithKeep();
    controller.setKeeping(true);
    await controller.captureOne();
    expect(await keptOnDisk()).toBe(1);

    controller.turnOff();
    await controller.turnOn();

    // ⚠️ The assertion D-2 turns on: *"the switch does not persist across
    // rides"*. Deleting the `setKeeping(false)` from `turnOn` leaves the rider
    // keeping every picture of every subsequent ride, having agreed once.
    expect(controller.state().keeping).toBe(false);
    await controller.captureOne();
    await expect(keptOnDisk()).resolves.toBe(1);
  });

  it('does not survive a fresh controller over the same store', async () => {
    const { controller } = await controllerWithKeep();
    controller.setKeeping(true);
    await controller.captureOne();

    // A second controller — a reload, in effect — over the same database.
    const second = await controllerWithKeep();
    expect(second.controller.state().keeping).toBe(false);
    await second.controller.captureOne();

    // Still one: the second session kept nothing, because nothing persisted the
    // switch. A `localStorage` key or a store column would fail here.
    await expect(keptOnDisk()).resolves.toBe(1);
  });
});

describe('the rider can get rid of them', () => {
  it('counts what this device holds, and deletes all of it', async () => {
    const { controller } = await controllerWithKeep();
    controller.setKeeping(true);
    await controller.captureOne();
    await controller.captureOne();

    await expect(controller.keptCount()).resolves.toBe(2);

    const removed = await controller.forgetKept();

    expect(removed).toBe(2);
    // ⚠️ Read back through a fresh connection. `packages/store`'s
    // `survivingFrameStoreFactory` is the store that reports this count
    // honestly and removes nothing, and only this line notices.
    await expect(keptOnDisk()).resolves.toBe(0);
  });

  it('counts nothing on a controller with no keep at all', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    await expect(controller.keptCount()).resolves.toBe(0);
    await expect(controller.forgetKept()).resolves.toBe(0);
  });
});

/* -------------------------------------------------------------------------- *
 * D-2's third property: there is no "always keep" anywhere in this client.
 * -------------------------------------------------------------------------- */

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

function sources(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      found.push(relative(SOURCE_ROOT, path));
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

describe('there is no global “always keep”', () => {
  it('has source to scan', () => {
    expect(sources().length).toBeGreaterThan(100);
  });

  it('persists the switch nowhere', () => {
    // ADR 0029 D-2: *"the switch does not persist across rides, and there is no
    // global 'always keep'."* The two ways that would actually be built are a
    // `localStorage` key and an athlete-row field, so both are scanned for by
    // the word a key would carry.
    const findings: string[] = [];
    for (const path of sources()) {
      const stripped = stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'));
      if (/(?:always|Always)Keep|keepAlways|alwaysKeepFrames/.test(stripped)) {
        findings.push(path);
      }
      // A storage key naming the keep at all. `routing/draft-storage.ts` is the
      // precedent for what one looks like in this client.
      if (/oyl\.camera\.keep/.test(stripped)) {
        findings.push(`${path} — a storage key for the keep`);
      }
    }
    expect(
      findings,
      'ADR 0029 D-2 forbids a setting: the keep is per ride and is off every time',
    ).toStrictEqual([]);
  });
});
