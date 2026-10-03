/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The enforcement-verdict core (A-PROD-005-W3): `flauz.isolation.enforce`.
 *
 * THE SIX CHECKS (the order's law, verbatim semantics) -- each evaluated for
 * the CURRENT workspace, each with the typed verdict table
 * green / violation / unknown / absent (absent surfaces degrade typed,
 * NEVER a silent green; an unresolved check is unknown, never guessed):
 *
 *   1. crossWorkspaceCensus  -- how many `.flauz/` trees are reachable from
 *                               this workspace root: exactly ONE by law
 *                               (multiple = typed violation with the paths;
 *                               zero = the typed absent degradation);
 *   2. exportDirShape        -- exports live ONLY in `.flauz-exports/`
 *                               (the W2 law, contract-duplicated: the real
 *                               product's exports dir is `.flauz-exports/`
 *                               at the workspace root, DELIBERATELY outside
 *                               `.flauz/` so an export never recurses into
 *                               itself; an export-shaped dir anywhere else
 *                               -- including inside `.flauz/` -- is a typed
 *                               violation; an unresolvable exports dir
 *                               (a file where the dir belongs) is unknown);
 *   3. telemetryLocalOnly    -- the W4 plane's state exists only at its
 *                               lawful workspace-local paths: present +
 *                               the one-tree census holds + no boundary
 *                               leak targets the telemetry surface = green;
 *                               a violated census degrades this to unknown
 *                               (containment unprovable while a second
 *                               state tree exists), never a silent green;
 *   4. memoryTierContainment -- the same containment law for the memory
 *                               tiers + the watermarks envelope;
 *   5. migrationStateContainment -- the same containment law for the
 *                               migration state;
 *   6. bankedRecordTaskId    -- every banked evidence-ledger row names its
 *                               owning extension (a non-empty taskId):
 *                               anonymous rows = typed violation (the row
 *                               seqs); torn rows (unparseable lines) =
 *                               typed unknown (the line numbers); an absent
 *                               ledger = the typed absent degradation.
 *
 * THE NEVER-SILENT-GREEN LAW: the record's `ok` is true ONLY when every
 * check is green; any violation/unknown/absent row keeps `ok` false with
 * the exact row-level truth. The record persists WHATEVER the verdict says
 * (swept fail-closed, banked census-visible).
 */

import {
	type Clock,
	type IsolationFsPort,
	ENFORCE_PREFIX,
	ENFORCE_SCHEMA_ID,
	EXTENSION_ID,
	FLAUZ_DIR,
	EXPORTS_DIR,
	ISOLATION_DIR,
	ISOLATION_TASK_ID,
	LEDGER_PATH,
	ONE_TREE_LAW,
	isPlainObject,
	hasKey,
	joinPath,
	serializeArtifact,
	splitJsonl,
} from './api.ts';
import { LAW_SURFACES } from './law.ts';
import { type BoundaryScan, scanBoundary, isUnder } from './scan.ts';
import { BOUNDARY_DISCLOSURE } from './audit.ts';
import { sweepArtifact } from './privacy.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

/** The typed verdict vocabulary (the order's table, verbatim). */
export type EnforceVerdict = 'green' | 'violation' | 'unknown' | 'absent';

/** One enforce-check row. */
export interface EnforceCheckRow {
	readonly id: string;
	readonly title: string;
	readonly verdict: EnforceVerdict;
	readonly reasons: readonly string[];
	/** Shape-only details (paths, counts, row seqs -- never contents). */
	readonly details: Record<string, unknown>;
}

/** The persisted enforcement-verdict record (schema `flauz-isolation-enforce/v1`). */
export interface IsolationEnforceRecord {
	readonly $schema: typeof ENFORCE_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly kind: 'flauz-isolation-enforce';
	readonly createdAt: number;
	readonly extensionId: typeof EXTENSION_ID;
	readonly boundaryDisclosure: string;
	readonly checks: readonly EnforceCheckRow[];
	readonly counts: {
		readonly green: number;
		readonly violation: number;
		readonly unknown: number;
		readonly absent: number;
	};
	/** True ONLY when every check is green (the never-silent-green law). */
	readonly ok: boolean;
}

/** The enforce outcome (command-level). */
export interface EnforceResult {
	readonly ok: boolean;
	readonly record: IsolationEnforceRecord;
}

/** The persisted outcome. */
export interface PersistedEnforce {
	readonly recordPath: string;
	readonly record: IsolationEnforceRecord;
	readonly banking: BankingOutcome;
}

/** The filename-safe stamp of an enforce record (the export-stamp convention). */
export function enforceStamp(epochMs: number): string {
	return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The ledger-row verdict of the banked-record taskId law. */
interface LedgerRowVerdict {
	readonly anonymous: number[];
	readonly torn: number[];
	readonly named: number;
}

/** Evaluates the banked-record taskId law over the evidence ledger (anonymous rows = violation; torn lines = unknown). */
async function bankedRowVerdicts(root: string, fs: IsolationFsPort): Promise<LedgerRowVerdict | undefined> {
	const text = await fs.readFileUtf8(joinPath(root, LEDGER_PATH));
	if (text === undefined) {
		return undefined; // the typed absent degradation
	}
	const anonymous: number[] = [];
	const torn: number[] = [];
	let named = 0;
	for (const [index, line] of splitJsonl(text).entries()) {
		const lineNo = index + 1;
		if (line === '') {
			torn.push(lineNo);
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			torn.push(lineNo);
			continue;
		}
		if (!isPlainObject(parsed) || !hasKey(parsed, 'taskId')) {
			anonymous.push(lineNo);
			continue;
		}
		const taskId = (parsed as Record<string, unknown>)['taskId'];
		if (typeof taskId !== 'string' || taskId.length === 0) {
			anonymous.push(lineNo);
			continue;
		}
		named += 1;
	}
	return { anonymous, torn, named };
}

/** The shared containment-check evaluation (the telemetry/memory/migration law). */
function containmentCheck(
	id: string,
	title: string,
	present: boolean,
	presentPaths: readonly string[],
	censusHolds: boolean,
	targetedLeaks: readonly { readonly path: string; readonly detail?: string }[],
): EnforceCheckRow {
	if (!present) {
		return {
			id,
			title,
			verdict: 'absent',
			reasons: ['the surface does not exist in this workspace (the typed absent degradation, never a silent green)'],
			details: {},
		};
	}
	if (targetedLeaks.length > 0) {
		return {
			id,
			title,
			verdict: 'violation',
			reasons: targetedLeaks.map(leak => `a boundary leak targets the surface: ${leak.path}${leak.detail !== undefined ? ` (${leak.detail})` : ''}`),
			details: { leaks: targetedLeaks.map(leak => leak.path), lawfulPaths: presentPaths },
		};
	}
	if (!censusHolds) {
		return {
			id,
			title,
			verdict: 'unknown',
			reasons: ['containment is unprovable while the one-tree census is violated (a second .flauz/ state tree exists -- the surface may be duplicated there); degraded typed, never a silent green'],
			details: { lawfulPaths: presentPaths },
		};
	}
	return {
		id,
		title,
		verdict: 'green',
		reasons: [`the surface exists only at its lawful workspace-local paths (${presentPaths.join(', ')}); the one-tree census holds and no boundary leak targets it`],
		details: { lawfulPaths: presentPaths },
	};
}

/**
 * Runs the enforcement verdict over the CURRENT workspace: the six typed
 * checks over the boundary scan + the real durable-state reads. Pure
 * deps-injected core; callers render + persist. The scan runs BEFORE the
 * record is persisted (the record's own write never affects the verdicts).
 */
export async function runEnforce(deps: { root: string; fs: IsolationFsPort; clock: Clock }): Promise<EnforceResult> {
	const scan: BoundaryScan = await scanBoundary({ root: deps.root, fs: deps.fs });
	// the one-tree law holds ONLY when the single reachable tree IS the root's own
	// (a workspace whose only .flauz is a NESTED one is a violation, never a green)
	const censusHolds = scan.flauzTrees.length === ONE_TREE_LAW && scan.flauzTrees[0] === FLAUZ_DIR;

	// --- 1. the cross-workspace census (exactly ONE .flauz tree by law) ---
	let crossWorkspaceCensus: EnforceCheckRow;
	if (scan.flauzTrees.length === ONE_TREE_LAW && scan.flauzTrees[0] === FLAUZ_DIR) {
		crossWorkspaceCensus = {
			id: 'crossWorkspaceCensus',
			title: 'cross-workspace census (one .flauz/ tree by law)',
			verdict: 'green',
			reasons: [`exactly ${String(ONE_TREE_LAW)} .flauz/ tree is reachable from this workspace root and it IS the root's own (${FLAUZ_DIR})`],
			details: { flauzTrees: scan.flauzTrees },
		};
	} else if (scan.flauzTrees.length === 0) {
		crossWorkspaceCensus = {
			id: 'crossWorkspaceCensus',
			title: 'cross-workspace census (one .flauz/ tree by law)',
			verdict: 'absent',
			reasons: ['no .flauz/ tree is reachable from this workspace root (the typed absent degradation -- this enforcement run\'s own record is the first durable state to land)'],
			details: { flauzTrees: [] },
		};
	} else {
		crossWorkspaceCensus = {
			id: 'crossWorkspaceCensus',
			title: 'cross-workspace census (one .flauz/ tree by law)',
			verdict: 'violation',
			reasons: [`${String(scan.flauzTrees.length)} .flauz/ trees are reachable from this workspace root (exactly ${String(ONE_TREE_LAW)} by law) -- the cross-workspace state bleed: ${scan.flauzTrees.join(', ')}`],
			details: { flauzTrees: scan.flauzTrees },
		};
	}

	// --- 2. the export-dir shape (exports live ONLY in .flauz-exports/) ---
	const exportFindings = scan.findings.filter(finding => finding.kind === 'export-outside-exports-dir' || finding.kind === 'nested-exports-dir');
	const exportsDirListable = await deps.fs.readdir(joinPath(deps.root, EXPORTS_DIR)) !== undefined;
	const exportsDirIsFile = !exportsDirListable && await deps.fs.readFileUtf8(joinPath(deps.root, EXPORTS_DIR)) !== undefined;
	let exportDirShape: EnforceCheckRow;
	if (exportsDirIsFile) {
		exportDirShape = {
			id: 'exportDirShape',
			title: 'export-dir shape (exports live only in .flauz-exports/)',
			verdict: 'unknown',
			reasons: [`${EXPORTS_DIR} exists but does not resolve as a directory (a file where the exports dir belongs) -- the export-dir shape cannot be evaluated, degraded typed`],
			details: {},
		};
	} else if (exportFindings.length > 0) {
		exportDirShape = {
			id: 'exportDirShape',
			title: 'export-dir shape (exports live only in .flauz-exports/)',
			verdict: 'violation',
			reasons: exportFindings.map(finding => `${finding.kind}: ${finding.path}${finding.detail !== undefined ? ` (${finding.detail})` : ''}`),
			details: { findings: exportFindings.map(finding => finding.path), lawfulHome: EXPORTS_DIR },
		};
	} else if (exportsDirListable) {
		exportDirShape = {
			id: 'exportDirShape',
			title: 'export-dir shape (exports live only in .flauz-exports/)',
			verdict: 'green',
			reasons: [`the exports dir ${EXPORTS_DIR} exists and every export-shaped directory lives directly under it (none inside ${FLAUZ_DIR}/: the W2 anti-recursion law)`],
			details: { lawfulHome: EXPORTS_DIR, exportsDirs: scan.exportsDirs },
		};
	} else {
		exportDirShape = {
			id: 'exportDirShape',
			title: 'export-dir shape (exports live only in .flauz-exports/)',
			verdict: 'absent',
			reasons: [`no ${EXPORTS_DIR}/ dir exists in this workspace (the typed absent degradation -- no export has been taken)`],
			details: { lawfulHome: EXPORTS_DIR },
		};
	}

	// --- the containment checks' paths + leaks, derived from the LAW TABLE
	//     (the surfaces' own law rows -- never a second list that can drift) ---
	const pathsOf = (surfaceIds: readonly string[]): string[] =>
		[...new Set(LAW_SURFACES.filter(surface => surfaceIds.includes(surface.id)).flatMap(surface => [...surface.files, ...surface.dirs]))].sort();

	const leaksTargeting = (paths: readonly string[]): { path: string; detail?: string }[] =>
		scan.findings
			.filter(finding => finding.kind === 'symlink-into-boundary' && finding.target !== undefined && paths.some(p => isUnder(finding.target as string, p)))
			.map(finding => ({ path: finding.path, ...(finding.detail !== undefined ? { detail: finding.detail } : {}) }));

	/** The law paths of one containment group, split by probe kind (files read, dirs listed). */
	const groupPaths = (surfaceIds: readonly string[]): { files: string[]; dirs: string[] } => {
		const files: string[] = [];
		const dirs: string[] = [];
		for (const surface of LAW_SURFACES) {
			if (!surfaceIds.includes(surface.id)) {
				continue;
			}
			files.push(...surface.files);
			dirs.push(...surface.dirs);
		}
		return { files: [...new Set(files)].sort(), dirs: [...new Set(dirs)].sort() };
	};

	const presentPathsOf = async (group: { files: string[]; dirs: string[] }): Promise<string[]> => {
		const present: string[] = [];
		for (const file of group.files) {
			if (await deps.fs.readFileUtf8(joinPath(deps.root, file)) !== undefined) {
				present.push(file);
			}
		}
		for (const dir of group.dirs) {
			if (await deps.fs.readdir(joinPath(deps.root, dir)) !== undefined) {
				present.push(dir);
			}
		}
		return present;
	};

	const telemetryGroup = groupPaths(['telemetryState', 'telemetryLedger']);
	const telemetryPaths = pathsOf(['telemetryState', 'telemetryLedger']);
	const telemetryPresent = await presentPathsOf(telemetryGroup);
	const telemetryLocalOnly = containmentCheck('telemetryLocalOnly', 'telemetry local-only law (the W4 plane never writes outside the workspace)', telemetryPresent.length > 0, telemetryPresent, censusHolds, leaksTargeting(telemetryPaths));

	const memoryGroup = groupPaths(['memoryTiers', 'memoryWatermarks']);
	const memoryPaths = pathsOf(['memoryTiers', 'memoryWatermarks']);
	const memoryPresent = await presentPathsOf(memoryGroup);
	const memoryTierContainment = containmentCheck('memoryTierContainment', 'memory-tier containment (the tiers + the watermarks envelope)', memoryPresent.length > 0, memoryPresent, censusHolds, leaksTargeting(memoryPaths));

	const migrationGroup = groupPaths(['migrationState']);
	const migrationPaths = pathsOf(['migrationState']);
	const migrationPresent = await presentPathsOf(migrationGroup);
	const migrationStateContainment = containmentCheck('migrationStateContainment', 'migration-state containment', migrationPresent.length > 0, migrationPresent, censusHolds, leaksTargeting(migrationPaths));

	// --- 6. the banked-record taskId law (every banked row names its owning extension) ---
	const ledger = await bankedRowVerdicts(deps.root, deps.fs);
	let bankedRecordTaskId: EnforceCheckRow;
	if (ledger === undefined) {
		bankedRecordTaskId = {
			id: 'bankedRecordTaskId',
			title: 'banked-record taskId law (every banked row names its owning extension)',
			verdict: 'absent',
			reasons: [`no evidence ledger exists at ${LEDGER_PATH} (the typed absent degradation -- nothing has been banked in this workspace)`],
			details: {},
		};
	} else if (ledger.anonymous.length > 0) {
		bankedRecordTaskId = {
			id: 'bankedRecordTaskId',
			title: 'banked-record taskId law (every banked row names its owning extension)',
			verdict: 'violation',
			reasons: [`${String(ledger.anonymous.length)} anonymous banked row(s) -- a ledger row carrying no owning-extension taskId (line numbers: ${ledger.anonymous.map(lineNo => String(lineNo)).join(', ')})`],
			details: { anonymousLines: ledger.anonymous, namedRows: ledger.named },
		};
	} else if (ledger.torn.length > 0) {
		bankedRecordTaskId = {
			id: 'bankedRecordTaskId',
			title: 'banked-record taskId law (every banked row names its owning extension)',
			verdict: 'unknown',
			reasons: [`${String(ledger.torn.length)} torn banked row(s) cannot be classified (unparseable lines -- the taskId law cannot be evaluated over them; line numbers: ${ledger.torn.map(lineNo => String(lineNo)).join(', ')})`],
			details: { tornLines: ledger.torn, namedRows: ledger.named },
		};
	} else {
		bankedRecordTaskId = {
			id: 'bankedRecordTaskId',
			title: 'banked-record taskId law (every banked row names its owning extension)',
			verdict: 'green',
			reasons: [`all ${String(ledger.named)} banked row(s) name their owning extension (this plane's own rows bank as taskId '${ISOLATION_TASK_ID}')`],
			details: { namedRows: ledger.named },
		};
	}

	const checks: EnforceCheckRow[] = [crossWorkspaceCensus, exportDirShape, telemetryLocalOnly, memoryTierContainment, migrationStateContainment, bankedRecordTaskId];
	const counts = {
		green: checks.filter(check => check.verdict === 'green').length,
		violation: checks.filter(check => check.verdict === 'violation').length,
		unknown: checks.filter(check => check.verdict === 'unknown').length,
		absent: checks.filter(check => check.verdict === 'absent').length,
	};
	const createdAt = deps.clock();
	const record: IsolationEnforceRecord = {
		$schema: ENFORCE_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-isolation-enforce',
		createdAt,
		extensionId: EXTENSION_ID,
		boundaryDisclosure: BOUNDARY_DISCLOSURE,
		checks,
		counts,
		ok: counts.green === checks.length,
	};
	return { ok: record.ok, record };
}

/**
 * Persists the enforce record workspace-locally + banks it census-visible:
 * sweep (fail-closed) -> serializeArtifact (DL-9) -> write
 * `.flauz/isolation/enforce-<stamp>.json` -> bank the evidence-ledger note
 * row (+ watermark resync when one exists).
 */
export async function persistEnforce(deps: { root: string; fs: IsolationFsPort; clock: Clock }, record: IsolationEnforceRecord): Promise<PersistedEnforce> {
	sweepArtifact(record, 'isolation-enforce');
	const line = serializeArtifact(record);
	const dir = joinPath(deps.root, ISOLATION_DIR);
	await deps.fs.mkdir(dir);
	const recordPath = joinPath(dir, `${ENFORCE_PREFIX}${enforceStamp(record.createdAt)}.json`);
	await deps.fs.writeFile(recordPath, line);
	const banking = await bankRecord(deps, record, line, joinPath(ISOLATION_DIR, `${ENFORCE_PREFIX}${enforceStamp(record.createdAt)}.json`));
	return { recordPath, record, banking };
}

/** The command render (channel lines; shape-only, canary-clean by construction). */
export function renderEnforce(result: EnforceResult): string[] {
	const lines: string[] = [];
	const { record } = result;
	lines.push(`flauz.isolation.enforce: the enforcement verdict -- ${String(record.checks.length)} typed check(s) for the CURRENT workspace (green ${String(record.counts.green)} · violation ${String(record.counts.violation)} · unknown ${String(record.counts.unknown)} · absent ${String(record.counts.absent)}). ok=${String(record.ok)} (true only when every check is green -- absent surfaces degrade typed, never a silent green).`);
	for (const check of record.checks) {
		lines.push(`  [${check.verdict.toUpperCase()}] ${check.id} -- ${check.reasons.join('; ')}`);
	}
	lines.push(`  ${BOUNDARY_DISCLOSURE}`);
	return lines;
}
