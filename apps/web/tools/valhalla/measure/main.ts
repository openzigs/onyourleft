// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The dev-only measurement page's entry (#2320). Not part of the product:
 * `vite.valhalla.config.ts` builds it, from this directory, and
 * `vite.config.ts` never sees it. `stays-out.test.ts` holds that line.
 *
 * The worker and the WebAssembly are imported as URLs, so Vite serves them
 * from the page's own origin (spike 0035, change 6), and the SDK is given
 * both through its `workerUrl` and `wasmUrl` overrides: no CDN, no blob
 * worker.
 */

import { Router } from 'valhalla-browser';
import runtime from 'valhalla-browser/runtime.json';
import wasmUrl from 'valhalla-browser/valhalla-browser.wasm?url';
import workerUrl from 'valhalla-browser/worker.js?url';

import { ODBL_LICENCE_URL, OSM_ATTRIBUTION } from '../../../src/map/basemap';

import { runMeasurement, type MeasureReport } from './measure';
import { MeasureParamError, parseMeasureParams } from './params';
import { appendRow, REPORT_COLUMNS } from './report';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`measure: #${id} is missing from index.html`);
  return found as T;
}

function start(): void {
  const status = element<HTMLParagraphElement>('status');
  const button = element<HTMLButtonElement>('start');
  const copy = element<HTMLButtonElement>('copy');
  const output = element<HTMLPreElement>('json');
  const head = element<HTMLTableSectionElement>('head');
  const body = element<HTMLTableSectionElement>('body');
  element<HTMLParagraphElement>('attribution').textContent =
    `Routing graph: ${OSM_ATTRIBUTION}, ODbL 1.0 (${ODBL_LICENCE_URL}). Router: ${runtime.sdk}, MIT.`;

  const headRow = document.createElement('tr');
  for (const column of REPORT_COLUMNS) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    headRow.append(th);
  }
  head.append(headRow);

  let config: ReturnType<typeof parseMeasureParams>;
  try {
    config = parseMeasureParams(location.search, location.href);
  } catch (error: unknown) {
    status.textContent =
      error instanceof MeasureParamError ? error.message : 'The query string could not be read';
    return;
  }
  if (!window.isSecureContext) {
    status.textContent =
      'This page is not a secure context, and the router checks every tile with Web Crypto. Open it on localhost (adb reverse) or over https.';
    return;
  }
  status.textContent = `${config.pairs.length} pair(s), ${config.runs} run(s). Clear this site's data first for a cold HTTP cache.`;
  button.disabled = false;

  let report: MeasureReport | undefined;
  button.addEventListener('click', () => {
    button.disabled = true;
    body.replaceChildren();
    output.textContent = '';
    status.textContent = 'Measuring…';
    const startedAt = new Date().toISOString();
    void runMeasurement(
      config,
      {
        createRouter: (options) => new Router(options),
        now: () => performance.now(),
        workerUrl,
        wasmUrl,
      },
      (record) => appendRow(body, record),
    )
      .then((done) => {
        report = done;
        output.textContent = JSON.stringify(
          { sdk: runtime.sdk, userAgent: navigator.userAgent, startedAt, ...done },
          null,
          2,
        );
        status.textContent = `Done: ${done.records.length} record(s).`;
        copy.disabled = false;
      })
      .catch(() => {
        status.textContent = 'The measurement stopped.';
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  copy.addEventListener('click', () => {
    if (report === undefined) return;
    void navigator.clipboard.writeText(output.textContent).then(
      () => (status.textContent = 'Copied.'),
      () => (status.textContent = 'Copying failed; select the text below instead.'),
    );
  });
}

start();
