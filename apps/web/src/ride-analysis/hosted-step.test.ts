// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride analysis on the hosted model (#803), through the REAL camera
 * controller and the REAL hosted transport with a scripted service behind its
 * `fetch`: every step is gated on the hosted consent, only a sealed step is
 * sent, the rider's key goes in one header, and a cancel reaches the `fetch`.
 */

import { describe, expect, it, vi } from 'vitest';

import { hostedModelDecision, type HostedModel } from '../camera/hosted-model';
import { hostedModelPort, type HostedSend } from '../camera/hosted-transport';
import { CameraController } from '../camera/session';
import { manualSchedule, scriptedCamera } from '../camera/testing';
import { hostedStepPort, type HostedStepAsker } from './hosted-step';
import type { RideAnalysisInput } from './input';
import { modelServer, STILL_CLOCK, type ModelServer } from './model-server-testing';
import type { ModelStepPort, StepRequest } from './model-step-port';
import { runAnalysis } from './runner';
import { sealStep } from './sealed-step';

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

/** A ride with three sections. */
const INPUT: RideAnalysisInput = {
  templateVersion: 'ride-analysis/1',
  ride: { movingMinutes: 62, distanceKilometres: 31.4 },
  rider: { massKilograms: 72, thresholdPower: 250 },
  whole: { power: { coverage: 1, mean: 190, max: 410 } },
  sections: [1, 2, 3].map((index) => ({
    index,
    kind: 'flat' as const,
    minutes: 20,
    metrics: { power: { coverage: 1, mean: 185 + index, max: 300 } },
  })),
};

const STEP: StepRequest = {
  kind: 'summary',
  system: 'You describe bicycle rides from their numbers.',
  user: 'The whole ride: {"ride":{"movingMinutes":62}}',
  maximumTokens: 900,
  temperature: 0.2,
};

/** The hosted service's `fetch`, counted: the scripted model server behind it. */
function counted(server: ModelServer = modelServer()): {
  readonly send: ReturnType<typeof vi.fn<HostedSend>>;
  readonly server: ModelServer;
} {
  const send = vi.fn<HostedSend>(async (url, init) => server.send(url, init));
  return { send, server };
}

/** A camera controller with the hosted model turned on, or not. */
function controller(send: HostedSend, hostedOn = true): CameraController {
  const camera = new CameraController({
    port: scriptedCamera().port,
    schedule: manualSchedule().schedule,
    hosted: () => hostedModelPort(service(), { send }),
  });
  camera.agree({ acknowledgedBystanders: true, allowLocal: true, allowHosted: false });
  if (hostedOn) {
    camera.agreeToHosted(true);
  }
  return camera;
}

function portOver(camera: HostedStepAsker, configured = true): ModelStepPort {
  const port = hostedStepPort(camera, () => configured);
  if (port === undefined) {
    throw new Error('fixture: no hosted step port');
  }
  return port;
}

describe('when the hosted model is offered on a ride’s page', () => {
  it('is offered only while it is turned on and a service is saved', () => {
    const { send } = counted();
    expect(hostedStepPort(controller(send), () => true)).toBeDefined();
    expect(hostedStepPort(controller(send, false), () => true)).toBeUndefined();
    expect(hostedStepPort(controller(send), () => false)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a whole run on the hosted model', () => {
  it('sends one request per step, each with the key in its header and none in its body', async () => {
    const { send } = counted();
    const outcome = await runAnalysis(INPUT, {
      port: portOver(controller(send)),
      clock: STILL_CLOCK,
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe('written');
    // Three sections and the summary.
    expect(send).toHaveBeenCalledTimes(4);
    for (const [url, init] of send.mock.calls) {
      expect(url).toBe('https://models.example.invalid/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
      expect(init.body as string).not.toContain(KEY);
      expect(Object.keys(JSON.parse(init.body as string) as object).sort()).toStrictEqual([
        'max_tokens',
        'messages',
        'model',
        'stream',
        'temperature',
      ]);
    }
  });

  it('checks the hosted consent on EVERY step: turned off mid-run, the next step is not sent', async () => {
    const server = modelServer();
    // The rider turns the hosted model off while the first step is out.
    const holder: { camera?: CameraController } = {};
    const send = vi.fn<HostedSend>(async (url, init) => {
      holder.camera?.agreeToHosted(false);
      return server.send(url, init);
    });
    const camera = controller(send);
    holder.camera = camera;
    const outcome = await runAnalysis(INPUT, {
      port: portOver(camera),
      clock: STILL_CLOCK,
      signal: new AbortController().signal,
    });
    // The first step went; every later one was refused before the transport.
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome).toStrictEqual({ kind: 'failed', why: 'too-few-sections' });
  });

  it('refuses a step the runner did not seal, before the controller is asked', async () => {
    const { send } = counted();
    const camera = controller(send);
    const ask = vi.spyOn(camera, 'askHostedModel');
    const reply = await portOver(camera).runModelStep({ ...STEP }, new AbortController().signal);
    expect(reply).toStrictEqual({ kind: 'failed', failure: 'not-numbers' });
    expect(ask).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('hands the runner the service’s words and how its reply ended', async () => {
    const send = vi.fn<HostedSend>(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Cut off mid' }, finish_reason: 'length' }],
          }),
        ),
      ),
    );
    const reply = await portOver(controller(send)).runModelStep(
      sealStep(STEP),
      new AbortController().signal,
    );
    expect(reply).toStrictEqual({ kind: 'answered', text: 'Cut off mid', finish: 'length' });
  });

  it('hands the runner the hosted path’s named failure, and nothing the service said', async () => {
    const send = vi.fn<HostedSend>(async () =>
      Promise.resolve(new Response(`{"error":"bad key ${KEY}"}`, { status: 401 })),
    );
    const reply = await portOver(controller(send)).runModelStep(
      sealStep(STEP),
      new AbortController().signal,
    );
    expect(reply).toStrictEqual({ kind: 'failed', failure: 'key-refused' });
    expect(JSON.stringify(reply)).not.toContain(KEY);
  });
});

describe('cancelling', () => {
  it('reaches the fetch: aborting the runner’s signal aborts the request', async () => {
    let requestSignal: AbortSignal | undefined;
    const send = vi.fn<HostedSend>(async (_url, init) => {
      requestSignal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const run = new AbortController();
    const replied = portOver(controller(send)).runModelStep(sealStep(STEP), run.signal);
    await Promise.resolve();
    expect(requestSignal?.aborted).toBe(false);
    run.abort();
    expect(await replied).toStrictEqual({ kind: 'failed', failure: 'cancelled' });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('sends nothing for a step whose signal is already aborted', async () => {
    const { send } = counted();
    const run = new AbortController();
    run.abort();
    expect(await portOver(controller(send)).runModelStep(sealStep(STEP), run.signal)).toStrictEqual(
      { kind: 'failed', failure: 'cancelled' },
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('stops a whole run at the step in flight, and sends no step after it', async () => {
    let requestSignal: AbortSignal | undefined;
    const send = vi.fn<HostedSend>(async (_url, init) => {
      requestSignal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const run = new AbortController();
    const outcome = runAnalysis(INPUT, {
      port: portOver(controller(send)),
      clock: STILL_CLOCK,
      signal: run.signal,
    });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    run.abort();
    expect(await outcome).toStrictEqual({ kind: 'failed', why: 'cancelled' });
    expect(requestSignal?.aborted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
