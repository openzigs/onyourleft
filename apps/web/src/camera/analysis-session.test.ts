// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The controller's half of #387: nothing is taken or sent until a computer is
 * configured and switched on, the local answer grants nothing hosted, and the
 * picture is dropped after it is asked about unless the rider is keeping this
 * ride's pictures.
 */

import { describe, expect, it } from 'vitest';

import type { AnalysisCall, AnalysisPort, AnalysisRequest } from './analysis-port';
import { endpointDecision, readAnalysisEndpoint, type EndpointStorage } from './analysis-endpoint';
import { riderAnalysisPort, type AnalysisSend } from './analysis-transport';
import { CameraController, type FrameSink } from './session';
import { manualSchedule, scriptedCamera } from './testing';

const AGREED = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false } as const;

/** A send that must never be reached; it records if it is. */
function forbiddenSend(): { readonly send: AnalysisSend; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    send: async (url) => {
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'ready' } }] })),
      );
    },
  };
}

function emptyStorage(): EndpointStorage {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value) && undefined,
    removeItem: (key) => rows.delete(key) && undefined,
  };
}

/** A port that answers `ready` and records every request. */
function answeringPort(): { readonly port: AnalysisPort; readonly asked: AnalysisRequest[] } {
  const asked: AnalysisRequest[] = [];
  return {
    asked,
    port: {
      askAboutFrame: (request): AnalysisCall => {
        asked.push(request);
        return {
          outcome: Promise.resolve({
            kind: 'described',
            description: 'ready' as never,
          }),
          cancel: () => undefined,
        };
      },
    },
  };
}

async function liveController(
  analysis: () => AnalysisPort | undefined,
  sink?: FrameSink,
): Promise<{ controller: CameraController; camera: ReturnType<typeof scriptedCamera> }> {
  const camera = scriptedCamera();
  const controller = new CameraController({
    port: camera.port,
    schedule: manualSchedule().schedule,
    analysis,
    ...(sink === undefined ? {} : { sink }),
  });
  controller.agree(AGREED);
  await controller.turnOn();
  return { controller, camera };
}

describe('with no configuration the app makes no request at all', () => {
  it('takes no picture and calls no send, through the real transport over an empty device', async () => {
    // The whole production chain, with nothing stored: `readAnalysisEndpoint`
    // answers nothing, `riderAnalysisPort` builds nothing, and the controller
    // refuses before the camera is asked for a frame.
    const forbidden = forbiddenSend();
    const storage = emptyStorage();
    const { controller, camera } = await liveController(() =>
      riderAnalysisPort(readAnalysisEndpoint(storage), { send: forbidden.send }),
    );
    const outcome = await controller.askAboutPicture('connection-check').outcome;
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'not-configured' });
    expect(forbidden.calls).toStrictEqual([]);
    expect(camera.calls).not.toContain('capture');
    expect(controller.state().captured).toBe(0);
  });

  it('refuses the same way when the controller was built with no analysis at all', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
    });
    controller.agree(AGREED);
    await controller.turnOn();
    expect(await controller.askAboutPicture('connection-check').outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-configured',
    });
    expect(camera.calls).not.toContain('capture');
  });

  it('sends nothing to an address that is saved and switched OFF', async () => {
    const forbidden = forbiddenSend();
    const off = endpointDecision({
      address: 'http://192.168.1.20:8080',
      model: 'm',
      switchedOn: false,
    }).endpoint;
    const { controller, camera } = await liveController(() =>
      riderAnalysisPort(off, { send: forbidden.send }),
    );
    expect((await controller.askAboutPicture('connection-check').outcome).kind).toBe('failed');
    expect(forbidden.calls).toStrictEqual([]);
    expect(camera.calls).not.toContain('capture');
  });
});

describe('the local answer grants nothing hosted', () => {
  it('leaves consent.hosted false, and a public address is still refused', async () => {
    // Everything a rider can do for LOCAL analysis — agree, turn on, type an
    // address and switch it on — and the hosted answer is untouched and a
    // hosted service cannot be the address.
    const forbidden = forbiddenSend();
    const hosted = endpointDecision({
      address: 'https://api.example.com',
      model: 'm',
      switchedOn: true,
    });
    expect(hosted.refusal).toBe('not-local');
    const { controller } = await liveController(() =>
      riderAnalysisPort(hosted.endpoint, { send: forbidden.send }),
    );
    expect(controller.state().consent).toStrictEqual({ local: true, hosted: false });
    expect(await controller.askAboutPicture('connection-check').outcome).toStrictEqual({
      kind: 'failed',
      failure: 'not-configured',
    });
    expect(forbidden.calls).toStrictEqual([]);
  });
});

describe('consent and the camera come first', () => {
  it('does not consult the computer without consent', async () => {
    let consulted = 0;
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      analysis: () => {
        consulted += 1;
        return answeringPort().port;
      },
    });
    expect(await controller.askAboutPicture('connection-check').outcome).toStrictEqual({
      kind: 'failed',
      failure: 'no-picture',
    });
    expect(consulted).toBe(0);
    expect(camera.calls).toStrictEqual([]);
  });

  it('asks nothing when the camera is off', async () => {
    const answering = answeringPort();
    const camera = scriptedCamera();
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      analysis: () => answering.port,
    });
    controller.agree(AGREED);
    expect((await controller.askAboutPicture('connection-check').outcome).kind).toBe('failed');
    expect(answering.asked).toHaveLength(0);
  });

  it('asks nothing when the quality ladder has taken capture away', async () => {
    const answering = answeringPort();
    const { controller } = await liveController(() => answering.port);
    controller.throttle(false);
    expect((await controller.askAboutPicture('connection-check').outcome).kind).toBe('failed');
    expect(answering.asked).toHaveLength(0);
  });

  it('asks nothing when the picture cannot be taken', async () => {
    const answering = answeringPort();
    const camera = scriptedCamera({ captureFails: 'unavailable' });
    const controller = new CameraController({
      port: camera.port,
      schedule: manualSchedule().schedule,
      analysis: () => answering.port,
    });
    controller.agree(AGREED);
    await controller.turnOn();
    expect(await controller.askAboutPicture('connection-check').outcome).toStrictEqual({
      kind: 'failed',
      failure: 'no-picture',
    });
    expect(answering.asked).toHaveLength(0);
  });
});

describe('one picture, one question, and then the picture is done with', () => {
  it('sends the picture it took, with the question it was given', async () => {
    const answering = answeringPort();
    const { controller, camera } = await liveController(() => answering.port);
    const outcome = await controller.askAboutPicture('connection-check').outcome;
    expect(outcome.kind).toBe('described');
    expect(answering.asked).toHaveLength(1);
    expect(answering.asked[0]?.question).toBe('connection-check');
    expect(camera.calls.filter((call) => call === 'capture')).toHaveLength(1);
  });

  it('drops the picture after, unless this ride’s keep is on — ADR 0029 D-2', async () => {
    const accepted: number[] = [];
    const sink: FrameSink = {
      accept: async (frame) => {
        accepted.push(frame.bytes.length);
        return Promise.resolve(false);
      },
    };
    const answering = answeringPort();
    const { controller } = await liveController(() => answering.port, sink);
    await controller.askAboutPicture('connection-check').outcome;
    // Through the same sink `captureOne` uses, so the keep means what it says
    // for an analysed picture too.
    expect(accepted).toHaveLength(1);
    expect(controller.state().captured).toBe(1);
    expect(controller.state().keptThisSession).toBe(0);
  });

  it('counts a kept one, and survives a keep that fails', async () => {
    const answering = answeringPort();
    const keeping = await liveController(() => answering.port, {
      accept: async () => Promise.resolve(true),
    });
    await keeping.controller.askAboutPicture('connection-check').outcome;
    expect(keeping.controller.state().keptThisSession).toBe(1);

    const full = await liveController(() => answering.port, {
      accept: async () => Promise.reject(new Error('QuotaExceededError on key frames/1')),
    });
    expect((await full.controller.askAboutPicture('connection-check').outcome).kind).toBe(
      'described',
    );
  });

  it('looks the computer up on every press, so switching it off stops the next one', async () => {
    const answering = answeringPort();
    let on = true;
    const { controller } = await liveController(() => (on ? answering.port : undefined));
    await controller.askAboutPicture('connection-check').outcome;
    on = false;
    expect((await controller.askAboutPicture('connection-check').outcome).kind).toBe('failed');
    expect(answering.asked).toHaveLength(1);
  });

  it('cancels a request in flight', async () => {
    let cancelled = 0;
    const port: AnalysisPort = {
      askAboutFrame: () => ({
        outcome: new Promise(() => undefined),
        cancel: () => {
          cancelled += 1;
        },
      }),
    };
    const { controller } = await liveController(() => port);
    const call = controller.askAboutPicture('connection-check');
    await new Promise((resolve) => setTimeout(resolve, 0));
    call.cancel();
    expect(cancelled).toBe(1);
  });

  it('asks nothing when cancelled before the picture was taken', async () => {
    const answering = answeringPort();
    const { controller } = await liveController(() => answering.port);
    const call = controller.askAboutPicture('connection-check');
    call.cancel();
    expect(await call.outcome).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
    expect(answering.asked).toHaveLength(0);
  });
});
