// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The controller's half of #518: the hosted model is off until the rider
 * turns it on — separately — and consenting to local analysis, however far
 * the rider goes with it, does not turn it on.
 */

import { describe, expect, it, vi } from 'vitest';

import { endpointDecision } from './analysis-endpoint';
import { riderAnalysisPort, type AnalysisSend } from './analysis-transport';
import { hostedModelDecision, type HostedModel } from './hosted-model';
import { hostedModelPort, type HostedSend } from './hosted-transport';
import { CameraController } from './session';
import { manualSchedule, scriptedCamera } from './testing';
import { patternsOnlyGuard } from '../ride-analysis/personal-details-testing';
import { browserSecureWindow } from './secure-window-testing';

const AGREED = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false } as const;
const KEY = 'fixture-hosted-key-DO-NOT-LEAK-0123456789';

function service(): HostedModel {
  const model = hostedModelDecision({
    address: 'https://models.example.invalid',
    model: 'a-model',
    key: KEY,
  }).model;
  if (model === undefined) {
    throw new Error('fixture service refused');
  }
  return model;
}

function answering(): HostedSend {
  return vi.fn<HostedSend>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }), {
        status: 200,
      }),
    ),
  );
}

function controllerWith(send: HostedSend, analysisSend?: AnalysisSend): CameraController {
  const local = endpointDecision({
    address: 'http://192.168.1.20:8080',
    model: 'vision',
    switchedOn: true,
  }).endpoint;
  return new CameraController({
    secureWindow: browserSecureWindow(),
    port: scriptedCamera().port,
    schedule: manualSchedule().schedule,
    analysis: () => riderAnalysisPort(local, { send: analysisSend }),
    hosted: () => hostedModelPort(service(), { guard: patternsOnlyGuard, send }),
  });
}

describe('consenting to local analysis does not enable the hosted model', () => {
  it('leaves it off after the camera is agreed to, turned on and a computer switched on', async () => {
    const hostedSend = answering();
    const analysisSend = vi.fn<AnalysisSend>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ready' } }] })),
      ),
    );
    const controller = controllerWith(hostedSend, analysisSend);
    controller.agree(AGREED);
    await controller.turnOn();
    // The whole local path, used: a picture sent to the rider's own computer.
    expect((await controller.askAboutPicture('connection-check').outcome).kind).toBe('described');
    expect(analysisSend).toHaveBeenCalledTimes(1);

    expect(controller.state().consent.hosted).toBe(false);
    expect(await controller.askHostedModel('connection-check').outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-consented',
    });
    expect(hostedSend).not.toHaveBeenCalled();
  });

  it('never looks up the service before consent', async () => {
    const lookUp = vi.fn(() =>
      hostedModelPort(service(), { guard: patternsOnlyGuard, send: answering() }),
    );
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: scriptedCamera().port,
      schedule: manualSchedule().schedule,
      hosted: lookUp,
    });
    controller.agree(AGREED);
    await controller.askHostedModel('connection-check').outcome;
    expect(lookUp).not.toHaveBeenCalled();
  });
});

describe('the hosted model’s own consent', () => {
  it('is refused without the camera’s consent under it', () => {
    const controller = controllerWith(answering());
    expect(controller.agreeToHosted(true).refusal).toBe('hosted-without-local');
    expect(controller.state().consent).toStrictEqual({ local: false, hosted: false });
  });

  it('turns it on, sends the one question, and takes no picture', async () => {
    const send = answering();
    const camera = scriptedCamera();
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: camera.port,
      schedule: manualSchedule().schedule,
      hosted: () => hostedModelPort(service(), { guard: patternsOnlyGuard, send }),
    });
    controller.agree(AGREED);
    expect(controller.agreeToHosted(true).refusal).toBeUndefined();
    expect(controller.state().consent).toStrictEqual({ local: true, hosted: true });
    expect((await controller.askHostedModel('connection-check').outcome).kind).toBe('described');
    expect(send).toHaveBeenCalledTimes(1);
    // Never a picture: the camera was not even asked to open.
    expect(camera.calls).toStrictEqual([]);
  });

  it('says not-configured when nothing is saved, after consent', async () => {
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: scriptedCamera().port,
      schedule: manualSchedule().schedule,
      hosted: () => hostedModelPort(undefined, { guard: patternsOnlyGuard }),
    });
    controller.agree(AGREED);
    controller.agreeToHosted(true);
    expect(await controller.askHostedModel('connection-check').outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-configured',
    });
  });

  it('turns off without touching the camera’s consent, and revoking the camera takes it too', async () => {
    const send = answering();
    const controller = controllerWith(send);
    controller.agree(AGREED);
    controller.agreeToHosted(true);
    controller.agreeToHosted(false);
    expect(controller.state().consent).toStrictEqual({ local: true, hosted: false });
    controller.agreeToHosted(true);
    controller.revoke();
    expect(controller.state().consent).toStrictEqual({ local: false, hosted: false });
    await controller.askHostedModel('connection-check').outcome;
    expect(send).not.toHaveBeenCalled();
  });

  it('is off in a new controller, which is what opening the app again builds', () => {
    expect(controllerWith(answering()).state().consent.hosted).toBe(false);
  });
});
