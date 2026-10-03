/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The read-only state view (A-PROD-005-W3): `flauz.isolation.status`.
 *
 * THE READ-ONLY LAW (the W2 status precedent): the status view renders the
 * audit's surface-classification summary + the LAST enforcement verdict --
 * nothing written, nothing banked, no state change (proven by the
 * write-refusing fs port in the suite). The newest records resolve by the
 * stamp sort (the export-stamp convention sorts lexicographically); absent
 * records render the honest typed degradation, never a guessed summary.
 */

import {
	type IsolationFsPort,
	AUDIT_PREFIX,
	ENFORCE_PREFIX,
	EXTENSION_ID,
	ISOLATION_DIR,
	isPlainObject,
	joinPath,
} from './api.ts';

/** The audit summary the status view renders. */
export interface AuditSummary {
	readonly present: boolean;
	readonly recordPath?: string;
	readonly counts?: {
		readonly surfaces: number;
		readonly workspaceBound: number;
		readonly workspaceExportable: number;
		readonly portOwned: number;
		readonly unknownSurfaces: number;
		readonly violations: number;
	};
	readonly unknownExtensions?: readonly string[];
}

/** The enforcement summary the status view renders. */
export interface EnforceSummary {
	readonly present: boolean;
	readonly recordPath?: string;
	readonly ok?: boolean;
	readonly counts?: {
		readonly green: number;
		readonly violation: number;
		readonly unknown: number;
		readonly absent: number;
	};
	readonly verdicts?: readonly { readonly id: string; readonly verdict: string }[];
}

/** The status view (a shape summary of the newest records; never a record itself). */
export interface IsolationStatus {
	readonly extensionId: typeof EXTENSION_ID;
	readonly audit: AuditSummary;
	readonly enforce: EnforceSummary;
}

/** The newest record of one prefix under `.flauz/isolation/` (the stamp sorts lexicographically). */
async function newestRecord(root: string, fs: IsolationFsPort, prefix: string): Promise<string | undefined> {
	const entries = await fs.readdir(joinPath(root, ISOLATION_DIR));
	if (entries === undefined) {
		return undefined;
	}
	const stamps = [...entries].filter(entry => entry.startsWith(prefix) && entry.endsWith('.json')).sort();
	return stamps.length === 0 ? undefined : stamps[stamps.length - 1];
}

/**
 * Collects the read-only status: the newest audit + enforce records'
 * summaries. NEVER writes (the port's write surface is not even consulted).
 */
export async function runStatus(deps: { root: string; fs: IsolationFsPort }): Promise<IsolationStatus> {
	const auditName = await newestRecord(deps.root, deps.fs, AUDIT_PREFIX);
	const enforceName = await newestRecord(deps.root, deps.fs, ENFORCE_PREFIX);

	// the mutable summaries (composed into the frozen status once, at the end)
	const audit: { present: boolean; recordPath?: string; counts?: AuditSummary['counts']; unknownExtensions?: readonly string[] } = { present: auditName !== undefined };
	const enforce: { present: boolean; recordPath?: string; ok?: boolean; counts?: EnforceSummary['counts']; verdicts?: EnforceSummary['verdicts'] } = { present: enforceName !== undefined };

	if (auditName !== undefined) {
		const text = await deps.fs.readFileUtf8(joinPath(deps.root, ISOLATION_DIR, auditName));
		if (text !== undefined) {
			try {
				const parsed: unknown = JSON.parse(text);
				if (isPlainObject(parsed) && isPlainObject(parsed.counts)) {
					const counts = parsed.counts as Record<string, unknown>;
					audit.recordPath = joinPath(ISOLATION_DIR, auditName);
					audit.counts = {
						surfaces: typeof counts.surfaces === 'number' ? counts.surfaces : 0,
						workspaceBound: typeof counts.workspaceBound === 'number' ? counts.workspaceBound : 0,
						workspaceExportable: typeof counts.workspaceExportable === 'number' ? counts.workspaceExportable : 0,
						portOwned: typeof counts.portOwned === 'number' ? counts.portOwned : 0,
						unknownSurfaces: typeof counts.unknownSurfaces === 'number' ? counts.unknownSurfaces : 0,
						violations: typeof counts.violations === 'number' ? counts.violations : 0,
					};
					if (Array.isArray(parsed.unknownExtensions)) {
						audit.unknownExtensions = (parsed.unknownExtensions as unknown[])
							.filter((row): row is Record<string, unknown> => isPlainObject(row) && typeof row.owner === 'string')
							.map(row => row.owner as string);
					}
				}
			} catch {
				// a torn record renders as present-but-unreadable (the honest degradation below)
			}
		}
	}

	if (enforceName !== undefined) {
		const text = await deps.fs.readFileUtf8(joinPath(deps.root, ISOLATION_DIR, enforceName));
		if (text !== undefined) {
			try {
				const parsed: unknown = JSON.parse(text);
				if (isPlainObject(parsed) && isPlainObject(parsed.counts)) {
					const counts = parsed.counts as Record<string, unknown>;
					enforce.recordPath = joinPath(ISOLATION_DIR, enforceName);
					enforce.ok = parsed.ok === true;
					enforce.counts = {
						green: typeof counts.green === 'number' ? counts.green : 0,
						violation: typeof counts.violation === 'number' ? counts.violation : 0,
						unknown: typeof counts.unknown === 'number' ? counts.unknown : 0,
						absent: typeof counts.absent === 'number' ? counts.absent : 0,
					};
					if (Array.isArray(parsed.checks)) {
						enforce.verdicts = (parsed.checks as unknown[])
							.filter((check): check is Record<string, unknown> => isPlainObject(check) && typeof check.id === 'string' && typeof check.verdict === 'string')
							.map(check => ({ id: check.id as string, verdict: check.verdict as string }));
					}
				}
			} catch {
				// a torn record renders as present-but-unreadable (the honest degradation below)
			}
		}
	}

	return { extensionId: EXTENSION_ID, audit, enforce };
}

/** The command render (channel lines; shape-only, canary-clean by construction). */
export function renderStatus(status: IsolationStatus): string[] {
	const lines: string[] = [];
	lines.push(`flauz.isolation.status: the read-only state view -- the audit's surface-classification summary + the last enforcement verdict. No state change: nothing written, nothing banked.`);
	if (status.audit.present && status.audit.counts !== undefined) {
		const counts = status.audit.counts;
		lines.push(`  last audit: ${status.audit.recordPath} -- ${String(counts.surfaces)} surface(s): workspace-bound ${String(counts.workspaceBound)}, workspace-exportable ${String(counts.workspaceExportable)}, port-owned ${String(counts.portOwned)}; UNKNOWN surface(s) ${String(counts.unknownSurfaces)}; BOUNDARY_VIOLATION(s) ${String(counts.violations)}.${status.audit.unknownExtensions !== undefined && status.audit.unknownExtensions.length > 0 ? ` UNKNOWN extension(s): ${status.audit.unknownExtensions.join(', ')}.` : ''}`);
	} else if (status.audit.present) {
		lines.push('  last audit: a record exists but does not parse (torn -- re-run flauz.isolation.audit for a fresh record)');
	} else {
		lines.push('  last audit: none (no audit record exists in this workspace -- run flauz.isolation.audit)');
	}
	if (status.enforce.present && status.enforce.counts !== undefined) {
		const counts = status.enforce.counts;
		lines.push(`  last enforcement: ${status.enforce.recordPath} -- ok=${String(status.enforce.ok)} (green ${String(counts.green)} · violation ${String(counts.violation)} · unknown ${String(counts.unknown)} · absent ${String(counts.absent)})${status.enforce.verdicts !== undefined ? `: ${status.enforce.verdicts.map(row => `${row.id}=${row.verdict}`).join(', ')}` : ''}`);
	} else if (status.enforce.present) {
		lines.push('  last enforcement: a record exists but does not parse (torn -- re-run flauz.isolation.enforce for a fresh verdict)');
	} else {
		lines.push('  last enforcement: none (no enforce record exists in this workspace -- run flauz.isolation.enforce)');
	}
	return lines;
}
