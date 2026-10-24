// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's entry — `demo/index.html` loads it, and `vite.demo.config.ts`
 * builds it into `demo/dist/`. Nothing in the rider app imports it
 * (`tools/demo/demo-stays-out.ts`), and it may import nothing that reaches a
 * trainer, Bluetooth, the network or storage (`tools/demo/forbidden-modules.ts`).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../design/theme.css';
import { DemoPlaceholder } from './DemoPlaceholder';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('demo/index.html has no #root to mount the demo in');
}
createRoot(root).render(
  <StrictMode>
    <DemoPlaceholder />
  </StrictMode>,
);
