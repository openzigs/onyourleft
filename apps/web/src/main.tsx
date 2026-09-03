// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element the client mounts into');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
