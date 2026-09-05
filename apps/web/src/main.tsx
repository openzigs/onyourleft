// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './design/theme.css';
import { AppShell } from './shell/AppShell';
import { probeBrowser } from './support/bluetooth-support';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element the client mounts into');
}

/**
 * Probed once, here, and passed down.
 *
 * Once because `useBluetoothSupport` takes it as an effect dependency and a new
 * object every render would re-probe forever. Here because this is the entry
 * point: everything below it takes the capabilities as a parameter, which is
 * what makes the Safari, Firefox and Chrome-on-Linux paths reachable from a
 * test on a machine that is none of those.
 */
const capabilities = probeBrowser();

createRoot(container).render(
  <StrictMode>
    <AppShell capabilities={capabilities} />
  </StrictMode>,
);
