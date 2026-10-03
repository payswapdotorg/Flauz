/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The boundary-audit core (A-PROD-005-W3): `flauz.isolation.audit`.
 *
 * THE DERIVATION LAW: the audit NEVER hardcodes the extension set. It reads
 * the REAL product registry (the `extensions/flauz-*` manifests through the
 * product-root port, the parity registry's row count, the SBOM's component
 * inventory -- shape-only summaries) and classifies every registry
 * extension's durable surfaces through the isolation law table
 * (law.ts). A registry extension the law does not know = a typed UNKNOWN
 * row (fail-closed disclosure, never a guessed verdict). A `.flauz/`
 * top-level entry no law surface claims = a typed UNKNOWN surface (the
 * registry grew a surface class the law does not know). The contract suite
 * pins the law table byte-equal against the REAL owning constants -- the
 * drift protection.
 *
 * THE HONEST PRESENCE LAW: every surface reports its real presence
 * (present/absent per path); absence is honest data (a workspace may
 * legitimately not carry a surface class), never faked, never a violation.
 *
 * THE VIOLATION LAW: the boundary scan's findings ride the record as typed
 * BOUNDARY_VIOLATION rows, each with the exact workspace-relative path (a
 * record outside its lawful boundary: a stamp-shaped record file, an
 * export- or bundle-shaped directory outside its lawful home, a nested
 * `.flauz/`/`.flauz-exports/` tree, a symlink leaking the boundary). The
 * audit NEVER repairs: it reports; the operator adjudicates.
 *
 * THE METADATA LAW: the record enumerates SHAPES only (paths,
 * classifications, counts, extension names); workspace-RELATIVE paths only
 * (never absolute host paths); swept fail-closed before a single byte is
 * written; banked census-visible (taskId `flauz-isolation`).
 */

import {
	type Clock,
	type IsolationFsPort,
	type ProductRegistry,
	AUDIT_PREFIX,
	AUDIT_SCHEMA_ID,
	EXTENSION_ID,
	FLAUZ_DIR,
	ISOLATION_DIR,
	IsolationError,
	isProductRoot,
	joinPath,
	PRODUCT_PARITY_REGISTRY_PATH,
	readProductRegistry,
	serializeArtifact,
} from './api.ts';
import {
	type LawSurface,
	type SurfaceClassification,
	LAW_SURFACES,
	KNOWN_EXTENSIONS,
	boundaryOf,
	flauzEntryIsClaimed,
} from './law.ts';
import { type BoundaryFinding, type BoundaryScan, scanBoundary } from './scan.ts';
import { sweepArtifact } from './privacy.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

/** One classified surface row of the audit record. */
export interface AuditSurfaceRow {
	readonly id: string;
	readonly owner: string;
	readonly classification: SurfaceClassification;
	/** The lawful boundary the surface lives under. */
	readonly boundary: string;
	/** The surface's fixed paths (workspace-relative, sorted). */
	readonly paths: readonly string[];
	/** True when at least one path resolves (honest presence, never faked). */
	readonly present: boolean;
}

/** One typed UNKNOWN disclosure row (a registry-grown extension the law does not know). */
export interface UnknownExtensionRow {
	readonly owner: string;
	readonly reason: string;
}

/** One typed UNKNOWN surface disclosure (a `.flauz/` top-level entry no law surface claims). */
export interface UnknownSurfaceRow {
	readonly path: string;
	readonly reason: string;
}

/** One typed BOUNDARY_VIOLATION row (the boundary scan's findings, verbatim). */
export interface AuditViolationRow extends BoundaryFinding {
	readonly violation: 'BOUNDARY_VIOLATION';
}

/** The persisted boundary-audit record (schema `flauz-isolation-audit/v1`). */
export interface IsolationAuditRecord {
	readonly $schema: typeof AUDIT_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly kind: 'flauz-isolation-audit';
	readonly createdAt: number;
	readonly extensionId: typeof EXTENSION_ID;
	/** The honest-boundary disclosure, verbatim in every record. */
	readonly boundaryDisclosure: string;
	/** The product-registry summary the derivation enumerated (shapes only). */
	readonly registry: {
		readonly extensionCount: number;
		readonly extensions: readonly string[];
		readonly parityRowCount: number;
		readonly sbomComponentCount: number;
	};
	readonly surfaces: readonly AuditSurfaceRow[];
	readonly unknownExtensions: readonly UnknownExtensionRow[];
	readonly unknownSurfaces: readonly UnknownSurfaceRow[];
	readonly violations: readonly AuditViolationRow[];
	readonly scan: {
		readonly skipped: readonly string[];
		readonly walkedDirs: number;
		readonly walkedFiles: number;
		readonly flauzTreeCount: number;
		readonly exportsDirCount: number;
	};
	readonly counts: {
		readonly extensionsKnown: number;
		readonly extensionsUnknown: number;
		readonly surfaces: number;
		readonly surfacesPresent: number;
		readonly workspaceBound: number;
		readonly workspaceExportable: number;
		readonly portOwned: number;
		readonly unknownSurfaces: number;
		readonly violations: number;
	};
}

/** The audit outcome (command-level). */
export interface AuditResult {
	readonly ok: true;
	readonly record: IsolationAuditRecord;
	readonly disclosure: string;
}

/** The persisted outcome. */
export interface PersistedAudit {
	readonly recordPath: string;
	readonly record: IsolationAuditRecord;
	readonly banking: BankingOutcome;
}

/** The filename-safe stamp of an audit record (the export-stamp convention). */
export function auditStamp(epochMs: number): string {
	return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The honest-boundary disclosure carried by every audit record + render. */
export const BOUNDARY_DISCLOSURE = 'THE HONEST BOUNDARY: the workspace is the isolatable unit this product owns; the boundary laws are enforced within the workspace root\'s reachable tree (the disclosed skip law: .git + node_modules are host/tooling trees, never scanned). OS-level sandboxing, containerization and multi-tenant host isolation are the HOST\'s posture, outside this plane\'s jurisdiction (disclosed, never claimed).';

/** Reads the registry-grown `.flauz/` top-level entries no law surface claims (the UNKNOWN surface disclosure). */
async function unclaimedFlauzEntries(root: string, fs: IsolationFsPort): Promise<string[]> {
	const entries = await fs.readdir(joinPath(root, FLAUZ_DIR));
	if (entries === undefined) {
		return [];
	}
	return [...entries].filter(entry => !flauzEntryIsClaimed(entry)).sort();
}

/** Evaluates one law surface's honest presence (any path resolves). */
async function surfacePresent(root: string, fs: IsolationFsPort, surface: LawSurface): Promise<boolean> {
	for (const file of surface.files) {
		if (await fs.readFileUtf8(joinPath(root, file)) !== undefined) {
			return true;
		}
	}
	for (const dir of surface.dirs) {
		if (await fs.readdir(joinPath(root, dir)) !== undefined) {
			return true;
		}
	}
	// a stamp-shaped directory surface (export-/bundle-) is present when its
	// lawful home lists at least one entry of its shape
	for (const dir of surface.dirs) {
		const entries = await fs.readdir(joinPath(root, dir));
		if (entries === undefined) {
			continue;
		}
		for (const prefix of surface.dirPrefixes) {
			if ([...entries].some(entry => entry.startsWith(prefix))) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Runs the boundary audit: derive the surface classification from the REAL
 * product registry through the law table (UNKNOWN disclosed, never guessed),
 * evaluate honest presence, scan the boundary laws. Pure deps-injected
 * core; callers render + persist.
 */
export async function runAudit(deps: { root: string; productRoot: string; fs: IsolationFsPort; clock: Clock }): Promise<AuditResult> {
	// the product-state probe (the W5 law): a root without the parity registry is not a
	// repo-state product -- the typed refusal, never a guessed derivation subject
	if (!await isProductRoot(deps.productRoot, deps.fs)) {
		throw new IsolationError('FLAUZ_ISOLATION_NO_PRODUCT_STATE', `flauz.isolation/v1: ${deps.productRoot} is not a repo-state product (no parity registry at ${PRODUCT_PARITY_REGISTRY_PATH}) -- the audit's surface derivation enumerates the REAL product registry (the extensions/flauz-* manifests + the parity registry + the SBOM)`);
	}
	const registry: ProductRegistry | undefined = await readProductRegistry(deps.productRoot, deps.fs);
	if (registry === undefined) {
		throw new IsolationError('FLAUZ_ISOLATION_NO_PRODUCT_STATE', `flauz.isolation/v1: ${joinPath(deps.productRoot, 'extensions')} does not resolve a product registry -- the audit's surface derivation enumerates the REAL product registry (the extensions/flauz-* manifests + the parity registry + the SBOM)`);
	}

	// --- the derivation: every registry extension through the law table ---
	const unknownExtensions: UnknownExtensionRow[] = [];
	for (const name of registry.extensions) {
		if (!KNOWN_EXTENSIONS.includes(name)) {
			unknownExtensions.push({
				owner: name,
				reason: 'a registry-grown extension the isolation law does not know (fail-closed disclosure, never a guessed verdict; the law table grows only through a reviewed wave)',
			});
		}
	}

	const surfaces: AuditSurfaceRow[] = [];
	for (const surface of LAW_SURFACES) {
		surfaces.push({
			id: surface.id,
			owner: surface.owner,
			classification: surface.classification,
			boundary: boundaryOf(surface),
			paths: [...surface.files, ...surface.dirs].sort(),
			present: await surfacePresent(deps.root, deps.fs, surface),
		});
	}

	// --- the UNKNOWN surfaces: unclaimed .flauz/ top-level entries ---
	const unknownSurfaces: UnknownSurfaceRow[] = [];
	for (const entry of await unclaimedFlauzEntries(deps.root, deps.fs)) {
		unknownSurfaces.push({
			path: joinPath(FLAUZ_DIR, entry),
			reason: 'a .flauz/ surface class no law surface claims (the registry grew a surface the isolation law does not know -- fail-closed disclosure, never a guessed verdict)',
		});
	}

	// --- the boundary scan (the typed BOUNDARY_VIOLATION rows) ---
	const scan: BoundaryScan = await scanBoundary({ root: deps.root, fs: deps.fs });
	const violations: AuditViolationRow[] = scan.findings.map(finding => ({ violation: 'BOUNDARY_VIOLATION', ...finding }));

	const createdAt = deps.clock();
	const record: IsolationAuditRecord = {
		$schema: AUDIT_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-isolation-audit',
		createdAt,
		extensionId: EXTENSION_ID,
		boundaryDisclosure: BOUNDARY_DISCLOSURE,
		registry: {
			extensionCount: registry.extensions.length,
			extensions: registry.extensions,
			parityRowCount: registry.parityRowCount,
			sbomComponentCount: registry.sbomComponentCount,
		},
		surfaces,
		unknownExtensions,
		unknownSurfaces,
		violations,
		scan: {
			skipped: scan.skipped,
			walkedDirs: scan.walkedDirs,
			walkedFiles: scan.walkedFiles,
			flauzTreeCount: scan.flauzTrees.length,
			exportsDirCount: scan.exportsDirs.length,
		},
		counts: {
			extensionsKnown: registry.extensions.filter(name => KNOWN_EXTENSIONS.includes(name)).length,
			extensionsUnknown: unknownExtensions.length,
			surfaces: surfaces.length,
			surfacesPresent: surfaces.filter(surface => surface.present).length,
			workspaceBound: surfaces.filter(surface => surface.classification === 'workspace-bound').length,
			workspaceExportable: surfaces.filter(surface => surface.classification === 'workspace-exportable').length,
			portOwned: surfaces.filter(surface => surface.classification === 'port-owned').length,
			unknownSurfaces: unknownSurfaces.length,
			violations: violations.length,
		},
	};

	const disclosure = `${BOUNDARY_DISCLOSURE} Derived ${String(surfaces.length)} law surfaces over ${String(registry.extensions.length)} registry extension(s) (${String(unknownExtensions.length)} UNKNOWN extension(s) disclosed, ${String(unknownSurfaces.length)} UNKNOWN surface(s) disclosed, ${String(violations.length)} boundary violation(s)).`;
	return { ok: true, record, disclosure };
}

/**
 * Persists the audit record workspace-locally + banks it census-visible:
 * sweep (fail-closed) -> serializeArtifact (DL-9) -> write
 * `.flauz/isolation/audit-<stamp>.json` -> bank the evidence-ledger note row
 * (+ watermark resync when one exists).
 */
export async function persistAudit(deps: { root: string; fs: IsolationFsPort; clock: Clock }, record: IsolationAuditRecord): Promise<PersistedAudit> {
	sweepArtifact(record, 'isolation-audit');
	const line = serializeArtifact(record);
	const dir = joinPath(deps.root, ISOLATION_DIR);
	await deps.fs.mkdir(dir);
	const recordPath = joinPath(dir, `${AUDIT_PREFIX}${auditStamp(record.createdAt)}.json`);
	await deps.fs.writeFile(recordPath, line);
	const banking = await bankRecord(deps, record, line, joinPath(ISOLATION_DIR, `${AUDIT_PREFIX}${auditStamp(record.createdAt)}.json`));
	return { recordPath, record, banking };
}

/** The command render (channel lines; shape-only, canary-clean by construction). */
export function renderAudit(result: AuditResult): string[] {
	const lines: string[] = [];
	const { record } = result;
	lines.push(`flauz.isolation.audit: the boundary audit -- ${String(record.counts.surfaces)} durable surface(s) classified over the REAL product registry (${String(record.registry.extensionCount)} extension(s): parity rows ${String(record.registry.parityRowCount)}, SBOM components ${String(record.registry.sbomComponentCount)}), every classification derived through the isolation law table (never a hardcoded list).`);
	lines.push(`  classifications: workspace-bound ${String(record.counts.workspaceBound)} · workspace-exportable ${String(record.counts.workspaceExportable)} (the typed allowlist: the backup export, the release self-export, the diagnostics bundle) · port-owned ${String(record.counts.portOwned)} (the integrity key store, sealed to the port's path law) · present ${String(record.counts.surfacesPresent)}/${String(record.counts.surfaces)}.`);
	if (record.unknownExtensions.length > 0) {
		lines.push(`  UNKNOWN extension(s) disclosed (fail-closed, never a guessed verdict): ${record.unknownExtensions.map(row => row.owner).join(', ')}`);
	}
	if (record.unknownSurfaces.length > 0) {
		lines.push(`  UNKNOWN surface(s) disclosed (unclaimed .flauz/ entries): ${record.unknownSurfaces.map(row => row.path).join(', ')}`);
	}
	lines.push(`  boundary scan: ${String(record.scan.walkedDirs)} dir(s) + ${String(record.scan.walkedFiles)} file(s) walked (skipped: ${record.scan.skipped.join(', ')}), ${String(record.scan.flauzTreeCount)} .flauz/ tree(s), ${String(record.scan.exportsDirCount)} .flauz-exports/ dir(s), ${String(record.counts.violations)} typed BOUNDARY_VIOLATION(s).`);
	for (const violation of record.violations) {
		lines.push(`  BOUNDARY_VIOLATION ${violation.kind}: ${violation.path}${violation.detail !== undefined ? ` (${violation.detail})` : ''}`);
	}
	lines.push(`  ${BOUNDARY_DISCLOSURE}`);
	return lines;
}
