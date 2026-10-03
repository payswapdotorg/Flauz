/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.isolation.*` command surface (A-PROD-005-W3).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock, the
 * product-root probe) is a port wired by the extension layer or injected by
 * tests; command args never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W2 precedent): every command states
 * what it is about to do BEFORE it does it -- including the
 * honest-boundary disclosure (the workspace is the isolatable unit this
 * product owns; host-level isolation is the HOST's posture, disclosed
 * never claimed) on every render; the typed refusals (no-workspace,
 * no-product-state, secret-shaped) render the gate, not a wall; the
 * enforce command persists its record WHATEVER the verdict says (never a
 * silent green); the status command renders read-only.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
	type Clock,
	type IsolationFsPort,
	type OutputChannelPort,
	IsolationError,
	isProductRoot,
	PRODUCT_PARITY_REGISTRY_PATH,
	PRODUCT_EXTENSIONS_DIR,
} from './api.ts';
import { renderAudit, persistAudit, runAudit, type AuditResult } from './audit.ts';
import { renderEnforce, persistEnforce, runEnforce, type EnforceResult } from './enforce.ts';
import { renderStatus, runStatus, type IsolationStatus } from './status.ts';

export const COMMAND_IDS = ['flauz.isolation.audit', 'flauz.isolation.enforce', 'flauz.isolation.status'] as const;
export type IsolationCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-integrity services pattern). */
export interface IsolationCommandServices {
	readonly fs: IsolationFsPort;
	readonly clock: Clock;
	readonly channel: OutputChannelPort;
	/** The workspace root (undefined: the honest no-workspace degradation). */
	readonly getWorkspaceRoot: () => string | undefined;
	/**
	 * The repo-state product root (the audit's derivation subject): the
	 * workspace root when it carries the packaging-parity registry, else
	 * undefined -- the typed no-product-state refusal (the surface
	 * derivation enumerates the REAL product registry: the
	 * extensions/flauz-* manifests + the parity registry + the SBOM).
	 */
	readonly getProductRoot: () => Promise<string | undefined>;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
	if (err instanceof IsolationError) {
		channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
		throw err;
	}
	throw err;
}

export type IsolationHandler = (arg: unknown) => Promise<unknown>;

export function registerIsolationCommands(services: IsolationCommandServices): vscode.Disposable[] {
	const api = vscodeApi();
	const handlers: Record<IsolationCommandId, IsolationHandler> = {
		'flauz.isolation.audit': async () => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.isolation.audit: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to audit the boundaries of.');
				return { ok: false, code: 'FLAUZ_ISOLATION_NO_WORKSPACE' };
			}
			const productRoot = await services.getProductRoot();
			if (productRoot === undefined) {
				services.channel.appendLine(`flauz.isolation.audit: REFUSED -- no repo-state product in this workspace (the boundary audit's surface derivation enumerates the REAL product registry: the ${PRODUCT_EXTENSIONS_DIR}/flauz-* manifests + the parity registry at ${PRODUCT_PARITY_REGISTRY_PATH} + the SBOM; without the product tree there is no registry to derive from).`);
				return { ok: false, code: 'FLAUZ_ISOLATION_NO_PRODUCT_STATE' };
			}
			services.channel.appendLine(`flauz.isolation.audit: the boundary audit -- every persistent surface the product writes, enumerated through the REAL product registry (the census derivation, never a hardcoded list) and classified against the isolation law: workspace-bound (the default: the record's lifetime is the workspace's, it never leaves the tree) / workspace-exportable (the operator-initiated export surfaces: the backup export, the release self-export, the diagnostics bundle -- the typed allowlist) / port-owned (the integrity key store, sealed to the port's path law); a registry-grown extension or surface class the law does not know = typed UNKNOWN (fail-closed, never a guessed verdict); a record found OUTSIDE its lawful boundary = typed BOUNDARY_VIOLATION with the exact path. Record persisted + banked census-visible (taskId 'flauz-isolation').`);
			try {
				const result: AuditResult = await runAudit({ root, productRoot, fs: services.fs, clock: services.clock });
				const persisted = await persistAudit({ root, fs: services.fs, clock: services.clock }, result.record);
				for (const line of renderAudit(result)) {
					services.channel.appendLine(line);
				}
				services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-isolation', uri = the record path${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
				return { ok: true, counts: result.record.counts, recordPath: persisted.recordPath, banking: persisted.banking };
			} catch (err) {
				return renderRefusal(services.channel, 'isolation.audit', err);
			}
		},
		'flauz.isolation.enforce': async () => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.isolation.enforce: no workspace folder open -- there is no workspace to record the enforcement verdict in.');
				return { ok: false, code: 'FLAUZ_ISOLATION_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.isolation.enforce: the enforcement verdict for the CURRENT workspace -- the cross-workspace census (exactly ONE .flauz/ tree reachable from this root by law), the export-dir shape (exports live ONLY in .flauz-exports/, never inside .flauz/ -- the W2 anti-recursion law), the telemetry local-only law (the W4 plane), the memory-tier containment, the migration-state containment, the banked-record taskId law (every banked evidence row names its owning extension). The typed verdict table per check: green / violation / unknown / absent -- absent surfaces degrade typed, never a silent green. The record persists whatever the verdict says.');
			try {
				const result: EnforceResult = await runEnforce({ root, fs: services.fs, clock: services.clock });
				const persisted = await persistEnforce({ root, fs: services.fs, clock: services.clock }, result.record);
				for (const line of renderEnforce(result)) {
					services.channel.appendLine(line);
				}
				services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-isolation'${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
				return { ok: result.ok, counts: result.record.counts, recordPath: persisted.recordPath, banking: persisted.banking };
			} catch (err) {
				return renderRefusal(services.channel, 'isolation.enforce', err);
			}
		},
		'flauz.isolation.status': async () => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.isolation.status: no workspace folder open -- there is no workspace state to view.');
				return { ok: false, code: 'FLAUZ_ISOLATION_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.isolation.status: the read-only state view -- the audit\'s surface classification summary + the last enforcement verdict. No state change: nothing written, nothing banked.');
			try {
				const status: IsolationStatus = await runStatus({ root, fs: services.fs });
				for (const line of renderStatus(status)) {
					services.channel.appendLine(line);
				}
				return { ok: true, status };
			} catch (err) {
				return renderRefusal(services.channel, 'isolation.status', err);
			}
		},
	};
	const disposables: vscode.Disposable[] = [];
	for (const id of COMMAND_IDS) {
		disposables.push(api.commands.registerCommand(id, handlers[id]));
	}
	return disposables;
}

/** Re-exported for the tests' product-root fixtures (the probe seam). */
export const productRootProbe = { isProductRoot };
