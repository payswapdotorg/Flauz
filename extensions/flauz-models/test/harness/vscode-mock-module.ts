/**
 * Runtime stand-in for the real 'vscode' module. vscode-redirect.ts rewrites
 * every runtime import of the specifier 'vscode' to THIS file (node:module
 * registerHooks), so src/extension.ts's `import * as vscode from 'vscode'`
 * resolves to the mock when tests run under `node --test`.
 *
 * This must stay a VALUE module: it must not contain any runtime 'vscode'
 * import (type-only imports are fine — Node's type stripping erases them
 * before resolution). Tests import this file directly to reach the same
 * process-wide `lm` singleton the redirect serves (same URL => same module
 * registry entry => same instance).
 */

import { createMockLm, MockCancellationTokenSource } from './vscode-mock.ts';

/** The process-wide mock `vscode.lm` instance used by the redirect. */
export const lm = createMockLm();

/** Fidelity shim for vscode.CancellationTokenSource (not used by flauz-models v0). */
export { MockCancellationTokenSource as CancellationTokenSource };
