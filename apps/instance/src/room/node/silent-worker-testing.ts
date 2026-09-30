// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A room worker that says it is ready and then answers nothing — so a router
 * test can hold a request open and kill the worker under it (#895's review,
 * N4). Test support, never forked by the instance.
 */

process.send?.({ type: 'ready', pid: process.pid });
process.on('message', () => undefined);
process.on('disconnect', () => process.exit(0));
