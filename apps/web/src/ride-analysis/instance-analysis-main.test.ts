// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **`main.tsx` builds the instance write-up port and hands it to the shell**
 * (#1102). `instance-analysis-wiring.test.tsx` drives the port the way this
 * says `main.tsx` builds it; this holds `main.tsx` to building it so — in a
 * Node file, because the source scan needs the file system and that one runs
 * in jsdom.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOURCE_ROOT } from '../camera/import-walk-testing';
import { stripComments } from '../units/no-inline-units';

const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
const builder = main.slice(
  main.indexOf('function buildInstanceAnalysis('),
  main.indexOf('async function buildCameraController('),
);

describe('main.tsx builds the instance write-up port (#1102)', () => {
  it('finds the builder, so the checks below are not over nothing', () => {
    expect(builder).toContain('createInstanceAnalysis({');
    expect(builder.length).toBeGreaterThan(100);
  });

  it('runs every job over the sealed session the Connect screen keeps (#1192)', () => {
    expect(builder).toMatch(/heldSealedSession\(\{/);
    expect(builder).toMatch(/session: async \(\) => jobSessionOf\(await sealed\(\)\)/);
    expect(builder).toMatch(/connected: \(\) => heldInstanceSession\(storage\) !== undefined/);
  });

  it('builds it over the local store, the local athlete and the camera’s consent, read at the press', () => {
    expect(builder).toMatch(/store: localStore\(\)/);
    expect(builder).toMatch(/athleteId: LOCAL_ATHLETE/);
    // #1229: the sync base a start reads to name a synced ride.
    expect(builder).toMatch(/syncBase: localStore\(\)/);
    expect(builder).toMatch(
      /cameraConsented: \(\) => camera\?\.state\(\)\.consent\.local \?\? false/,
    );
  });

  it('watches the recording, so the page lets go of a job during a ride (ADR 0035 D-8)', () => {
    expect(builder).toMatch(
      /inProgress: \(\) => rideInProgress\(rideController\.getSnapshot\(\)\.phase\)/,
    );
  });

  it('passes it to the shell', () => {
    expect(main).toMatch(
      /const instanceAnalysis = buildInstanceAnalysis\(camera, rideController\);/,
    );
    expect(main).toMatch(
      /\{\.\.\.\(instanceAnalysis === undefined \? \{\} : \{ instanceAnalysis \}\)\}/,
    );
  });
});

describe('main.tsx builds the hosted source and the hosted-settings port (#1251)', () => {
  it('offers hosted from the note for the instance signed in to NOW, and sends the list through the job’s own session', () => {
    expect(builder).toMatch(
      /endpoint: \(\) => readHostedOffer\(storage, readInstanceAccount\(storage\)\?\.origin\)/,
    );
    expect(builder).toMatch(
      /sendGuard: \(session\) =>\s+sendMaskingGuard\(session\.channel, session\.token, \(\) =>\s+readMaskingGuard\(localStore\(\), LOCAL_ATHLETE\),/,
    );
  });

  it('builds the settings port over the sealed session, this device’s storage and its own masking list', () => {
    const settings = main.slice(
      main.indexOf('function buildHostedSettings('),
      main.indexOf('function buildSidePictures('),
    );
    expect(settings).toContain('createHostedSettingsPort({');
    expect(settings).toMatch(/session: heldSealedSession\(\{/);
    expect(settings).toMatch(/guard: \(\) => readMaskingGuard\(localStore\(\), LOCAL_ATHLETE\)/);
    expect(settings).toMatch(/\bstorage,/);
  });

  it('passes the settings port to the shell', () => {
    expect(main).toMatch(/const hostedSettings = buildHostedSettings\(\);/);
    expect(main).toMatch(
      /\{\.\.\.\(hostedSettings === undefined \? \{\} : \{ hostedSettings \}\)\}/,
    );
  });
});
