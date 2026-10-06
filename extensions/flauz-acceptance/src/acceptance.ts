/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The launch-act law (A-PROD-006-W2, DL-87). UNVERIFIED-BY-ME: authored
 * against the unblock-packet surfaces; the station runs the battery.
 *
 * flauz.acceptance.launch mints a release-acceptance record ONLY over a
 * GREEN, FRESH flauz.release.checklist artifact -- read through the
 * contract-pinned parser (api.ts), refused typed on red/absent/torn/stale,
 * never a silent default. The record carries:
 *   - the acceptance id flauz:acc:<16-hex> (a deterministic double-fnv1a32
 *     derivation from the bound content -- no random);
 *   - the bound checklist artifact path VERBATIM (the release identity the
 *     incidents loop carries);
 *   - the pinned product state (the version-inventory + census snapshot
 *     shapes, contract-duplicated from flauz-release);
 *   - the NAMED OWNING CHECKS set (the release's acceptance set: the
 *     checklist row kinds + the incident's named regression test when
 *     launched to close an incident loop).
 *
 * THE GATE VOCABULARY DOES NOT GROW: the eleven prove-items stay verbatim;
 * this law binds the gate by READING the checklist verdict, never by
 * redefining it. THE TWO-REGISTRY SEPARATION: acceptance records NEVER mint
 * registry items; WORK-REGISTRY.md stays the control plane.
 */

import {
	type AcceptanceFsPort,
	type AcceptanceRecord,
	type CensusPin,
	type CensusRowPin,
	type ExtensionManifestSummaryPin,
	type IncidentBinding,
	type OwningCheck,
	type ProductStatePin,
	AcceptanceError,
	acceptanceIdFromContent,
	acceptanceRelPath,
	canonicalJson,
	isIncidentIdPin,
	isPlainObject,
	isUnderFlauz,
	joinPath,
	latestChecklistArtifactPath,
	readChecklistArtifact,
	readLoopJournalPin,
	sha256Hex,
} from './api.ts';
import {
	ACCEPTANCE_SCHEMA_ID,
	BOUNDARY_DISCLOSURE,
	CHECKLIST_COMMAND_LINE,
	CENSUS_BROWSER_SESSIONS_PATH,
	CENSUS_ENVIRONMENTS_REGISTRY_PATH,
	CENSUS_ORCH_GRAPHS_PATH,
	CENSUS_ORCH_JOURNAL_PATH,
	CENSUS_PROVIDERS_PATH,
	CENSUS_RESOURCES_GRAPH_PATH,
	CENSUS_RESOURCES_OPS_PATH,
	CENSUS_ROUTING_DECISIONS_PATH,
	CENSUS_TASKS_PATH,
	CENSUS_WORKFLOWS_DIR,
	EXTENSION_ID,
	FRESHNESS_WINDOW_MS,
	PRIVACY_LAW,
	PRODUCT_EXTENSIONS_DIR,
	PRODUCT_PARITY_REGISTRY_PATH,
	PRODUCT_SBOM_PATH,
	RELEASE_DIR,
	type Clock,
} from './globals.ts';
import { toIsoStamp } from './format.ts';
import { persistAcceptance, type PersistedAcceptance } from './ledger.ts';

// ---------------------------------------------------------------------------
// The args
// ---------------------------------------------------------------------------

export interface LaunchArgs {
	/** The checklist artifact path (workspace-relative); when absent, the NEWEST artifact under .flauz/release/ is bound. */
	readonly checklistArtifactPath?: string;
	/** The incident binding (present when the launch closes an incident loop: the incident must sit at the release stage). */
	readonly incidentBinding?: { readonly incidentId: string; readonly regressionTestName: string };
	/** The operator id firing the launch (never contents). */
	readonly actor: string;
}

export function parseLaunchArgs(arg: unknown): LaunchArgs {
	if (!isPlainObject(arg)) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: the launch args must be an object { checklistArtifactPath?, incidentBinding?, actor }');
	}
	if (typeof arg.actor !== 'string' || arg.actor.length === 0) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: actor must be a non-empty string (the operator id firing the launch)');
	}
	let checklistArtifactPath: string | undefined;
	if (arg.checklistArtifactPath !== undefined) {
		if (typeof arg.checklistArtifactPath !== 'string' || arg.checklistArtifactPath.length === 0) {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: checklistArtifactPath, when present, must be a non-empty workspace-relative string');
		}
		if (!isUnderFlauz(arg.checklistArtifactPath)) {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', `flauz.acceptance.launch: the checklist artifact path '${arg.checklistArtifactPath}' must live under .flauz/ (paths under .flauz/ only)`);
		}
		if (!arg.checklistArtifactPath.startsWith(`${RELEASE_DIR}/`)) {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', `flauz.acceptance.launch: the checklist artifact path '${arg.checklistArtifactPath}' must live under ${RELEASE_DIR}/ (the flauz-release artifact home)`);
		}
		checklistArtifactPath = arg.checklistArtifactPath;
	}
	let incidentBinding: LaunchArgs['incidentBinding'];
	if (arg.incidentBinding !== undefined) {
		if (!isPlainObject(arg.incidentBinding)) {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: incidentBinding, when present, must be an object { incidentId, regressionTestName }');
		}
		if (!isIncidentIdPin(arg.incidentBinding.incidentId)) {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', `flauz.acceptance.launch: the incident id '${String(arg.incidentBinding.incidentId)}' is not the flauz:inc:<16-hex> shape`);
		}
		if (typeof arg.incidentBinding.regressionTestName !== 'string' || arg.incidentBinding.regressionTestName.length === 0) {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: incidentBinding.regressionTestName must be a non-empty string (the named regression test the release must not hide)');
		}
		incidentBinding = { incidentId: arg.incidentBinding.incidentId, regressionTestName: arg.incidentBinding.regressionTestName };
	}
	return {
		...(checklistArtifactPath !== undefined ? { checklistArtifactPath } : {}),
		...(incidentBinding !== undefined ? { incidentBinding } : {}),
		actor: arg.actor,
	};
}

// ---------------------------------------------------------------------------
// The pinned product state (the version-inventory shapes, contract-duplicated from flauz-release/productState.ts)
// ---------------------------------------------------------------------------

/** Reads the version-inventory pin: the flauz-* extension manifests + the parity registry + the SBOM (summary shapes only, never contents). */
export async function readProductStatePin(productRoot: string, fs: AcceptanceFsPort): Promise<ProductStatePin> {
	const entries = await fs.readdir(joinPath(productRoot, PRODUCT_EXTENSIONS_DIR));
	const flauzNames = entries === undefined ? [] : [...entries].filter(name => /^flauz-[a-z0-9-]+$/.test(name)).sort();

	const extensions: ExtensionManifestSummaryPin[] = [];
	for (const name of flauzNames) {
		const extensionDir = joinPath(PRODUCT_EXTENSIONS_DIR, name);
		const manifestPath = joinPath(extensionDir, 'package.json');
		const text = await fs.readFileUtf8(joinPath(productRoot, manifestPath));
		if (text === undefined) {
			extensions.push({ extensionDir, manifestPath, name, manifestPresent: false, activationEvents: [] });
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			extensions.push({ extensionDir, manifestPath, name, manifestPresent: true, parseError: (err as Error).message, activationEvents: [] });
			continue;
		}
		if (!isPlainObject(parsed)) {
			extensions.push({ extensionDir, manifestPath, name, manifestPresent: true, parseError: 'the manifest is not a JSON object', activationEvents: [] });
			continue;
		}
		const activationEvents = Array.isArray(parsed.activationEvents) ? parsed.activationEvents.filter((event): event is string => typeof event === 'string') : [];
		extensions.push({
			extensionDir,
			manifestPath,
			name,
			manifestPresent: true,
			...(typeof parsed.publisher === 'string' ? { publisher: parsed.publisher } : {}),
			...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
			...(typeof parsed.main === 'string' ? { main: parsed.main } : {}),
			...(typeof parsed.browser === 'string' ? { browser: parsed.browser } : {}),
			activationEvents,
			...(isPlainObject(parsed.engines) && typeof (parsed.engines as Record<string, unknown>).vscode === 'string' ? { enginesVscode: (parsed.engines as Record<string, unknown>).vscode as string } : {}),
			...(typeof parsed.publisher === 'string' ? { id: `${parsed.publisher}.${name}` } : {}),
		});
	}

	// the parity registry (absent surfaces as torn data, never guesses)
	const parityText = await fs.readFileUtf8(joinPath(productRoot, PRODUCT_PARITY_REGISTRY_PATH));
	let parity: ProductStatePin['parity'];
	if (parityText === undefined) {
		parity = { present: false, rowCount: 0, rows: [], extensionSurfaces: [] };
	} else {
		let parseError: string | undefined;
		let rows: { surface: string; capability: string; class: string }[] = [];
		try {
			const parsed: unknown = JSON.parse(parityText);
			if (!isPlainObject(parsed) || !Array.isArray(parsed.rows)) {
				parseError = 'the registry does not carry a rows[] array (not a packaging-parity registry body)';
			} else {
				for (const row of parsed.rows) {
					if (isPlainObject(row) && typeof row.surface === 'string' && typeof row.capability === 'string' && typeof row.class === 'string') {
						rows.push({ surface: row.surface, capability: row.capability, class: row.class });
					}
				}
			}
		} catch (err) {
			parseError = (err as Error).message;
		}
		if (parseError !== undefined) {
			parity = { present: true, parseError, rowCount: 0, rows: [], extensionSurfaces: [] };
		} else {
			parity = {
				present: true,
				rowCount: rows.length,
				rows,
				extensionSurfaces: [...new Set(rows.map(row => row.surface).filter(surface => surface.startsWith(`${PRODUCT_EXTENSIONS_DIR}/`)))].sort(),
			};
		}
	}

	// the SBOM (absent surfaces as torn data, never guesses)
	const sbomText = await fs.readFileUtf8(joinPath(productRoot, PRODUCT_SBOM_PATH));
	let sbom: ProductStatePin['sbom'];
	if (sbomText === undefined) {
		sbom = { present: false, componentCount: 0, extensionComponents: [], dependsOn: [] };
	} else {
		let parseError: string | undefined;
		let componentCount = 0;
		const extensionComponents: { name: string; version: string; bomRef: string; artifact?: string }[] = [];
		let dependsOn: string[] = [];
		try {
			const parsed: unknown = JSON.parse(sbomText);
			if (!isPlainObject(parsed)) {
				parseError = 'the SBOM is not a JSON object';
			} else {
				const components = Array.isArray(parsed.components) ? parsed.components : [];
				componentCount = components.length;
				for (const component of components) {
					if (!isPlainObject(component) || typeof component.name !== 'string') {
						continue;
					}
					const kind = Array.isArray(component.properties)
						? (component.properties as unknown[]).filter((property): property is Record<string, unknown> => isPlainObject(property) && property.name === 'flauz:component-kind' && typeof property.value === 'string').map(property => property.value as string)[0]
						: undefined;
					if (kind !== 'flauz-extension') {
						continue;
					}
					const artifact = Array.isArray(component.properties)
						? (component.properties as unknown[]).filter((property): property is Record<string, unknown> => isPlainObject(property) && property.name === 'flauz:artifact' && typeof property.value === 'string').map(property => property.value as string)[0]
						: undefined;
					extensionComponents.push({
						name: component.name,
						version: typeof component.version === 'string' ? component.version : '',
						bomRef: typeof component.bomRef === 'string' ? component.bomRef : typeof component.purl === 'string' ? component.purl : component.name,
						...(artifact !== undefined ? { artifact } : {}),
					});
				}
				if (Array.isArray(parsed.dependencies)) {
					for (const dependency of parsed.dependencies) {
						if (isPlainObject(dependency) && Array.isArray(dependency.dependsOn)) {
							dependsOn = (dependency.dependsOn as unknown[]).filter((ref): ref is string => typeof ref === 'string');
						}
					}
				}
			}
		} catch (err) {
			parseError = (err as Error).message;
		}
		sbom = parseError !== undefined
			? { present: true, parseError, componentCount: 0, extensionComponents: [], dependsOn: [] }
			: { present: true, componentCount, extensionComponents: extensionComponents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), dependsOn };
	}

	return { extensions, parity, sbom };
}

// ---------------------------------------------------------------------------
// The pinned durable-state census (the census snapshot shapes, contract-duplicated from flauz-release/census.ts)
// ---------------------------------------------------------------------------

interface CensusSurface {
	readonly row: string;
	readonly path: string;
	readonly kind: 'json' | 'jsonl' | 'dir';
}

const CENSUS_SURFACES: readonly CensusSurface[] = [
	{ row: 'tasks', path: CENSUS_TASKS_PATH, kind: 'json' },
	{ row: 'evidenceLedger', path: '.flauz/evidence/ledger.jsonl', kind: 'jsonl' },
	{ row: 'evidenceWatermark', path: '.flauz/evidence/size.json', kind: 'json' },
	{ row: 'resourcesGraph', path: CENSUS_RESOURCES_GRAPH_PATH, kind: 'json' },
	{ row: 'opsChain', path: CENSUS_RESOURCES_OPS_PATH, kind: 'jsonl' },
	{ row: 'environmentsRegistry', path: CENSUS_ENVIRONMENTS_REGISTRY_PATH, kind: 'json' },
	{ row: 'browserSessions', path: CENSUS_BROWSER_SESSIONS_PATH, kind: 'jsonl' },
	{ row: 'workflows', path: CENSUS_WORKFLOWS_DIR, kind: 'dir' },
	{ row: 'orchestration', path: CENSUS_ORCH_GRAPHS_PATH, kind: 'json' },
	{ row: 'providerLanesState', path: CENSUS_PROVIDERS_PATH, kind: 'json' },
];

/**
 * Reads the census snapshot pin: one summary row per durable surface (present
 * + path + parse integrity, never contents). The paths are the
 * contract-duplicated census surfaces; `.flauz/evidence/*` are pinned
 * verbatim from the W1 globals surface, the rest carry the globals.ts
 * INFERENCE reconciliation note (delivery-report seam 2).
 */
export async function readCensusPin(root: string, fs: AcceptanceFsPort): Promise<CensusPin> {
	const rows: { row: string; censusRow: CensusRowPin }[] = [];
	const problems: { row: string; problem: string }[] = [];
	for (const surface of CENSUS_SURFACES) {
		if (surface.kind === 'dir') {
			const entries = await fs.readdir(joinPath(root, surface.path));
			rows.push({ row: surface.row, censusRow: { present: entries !== undefined, path: surface.path } });
			continue;
		}
		const text = await fs.readFileUtf8(joinPath(root, surface.path));
		if (text === undefined) {
			rows.push({ row: surface.row, censusRow: { present: false, path: surface.path } });
			continue;
		}
		if (surface.kind === 'jsonl') {
			let parseError: string | undefined;
			for (const [index, line] of text.split('\n').entries()) {
				if (line === '') {
					continue;
				}
				try {
					JSON.parse(line);
				} catch (err) {
					parseError = `line ${String(index + 1)} is not valid JSON: ${(err as Error).message}`;
					break;
				}
			}
			rows.push({ row: surface.row, censusRow: { present: true, path: surface.path, ...(parseError !== undefined ? { parseError } : {}) } });
			if (parseError !== undefined) {
				problems.push({ row: surface.row, problem: parseError });
			}
			continue;
		}
		try {
			JSON.parse(text);
			rows.push({ row: surface.row, censusRow: { present: true, path: surface.path } });
		} catch (err) {
			const parseError = (err as Error).message;
			rows.push({ row: surface.row, censusRow: { present: true, path: surface.path, parseError } });
			problems.push({ row: surface.row, problem: parseError });
		}
	}
	// the orchestration journal + the routing decisions (the secondary files of the orchestration/provider surfaces)
	const journalText = await fs.readFileUtf8(joinPath(root, CENSUS_ORCH_JOURNAL_PATH));
	if (journalText !== undefined) {
		for (const [index, line] of journalText.split('\n').entries()) {
			if (line === '') {
				continue;
			}
			try {
				JSON.parse(line);
			} catch (err) {
				const problem = `orchestration journal line ${String(index + 1)} is not valid JSON: ${(err as Error).message}`;
				problems.push({ row: 'orchestration', problem });
				break;
			}
		}
	}
	const decisionsText = await fs.readFileUtf8(joinPath(root, CENSUS_ROUTING_DECISIONS_PATH));
	if (decisionsText !== undefined) {
		for (const [index, line] of decisionsText.split('\n').entries()) {
			if (line === '') {
				continue;
			}
			try {
				JSON.parse(line);
			} catch (err) {
				const problem = `provider routing-decisions line ${String(index + 1)} is not valid JSON: ${(err as Error).message}`;
				problems.push({ row: 'providerLanesState', problem });
				break;
			}
		}
	}
	return { rows, problems };
}

// ---------------------------------------------------------------------------
// The launch-act law (fail-closed)
// ---------------------------------------------------------------------------

export interface LaunchResult {
	readonly ok: true;
	readonly acceptanceId: string;
	readonly record: AcceptanceRecord;
	readonly persisted: PersistedAcceptance;
}

export async function launchReleaseAcceptance(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, args: LaunchArgs): Promise<LaunchResult> {
	// --- resolve + read the checklist artifact through the contract-pinned parser ---
	const relPath = args.checklistArtifactPath ?? await latestChecklistArtifactPath(deps.root, deps.fs);
	if (relPath === undefined) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_ABSENT', `flauz.acceptance.launch: REFUSED -- no ${CHECKLIST_COMMAND_LINE} artifact exists under ${RELEASE_DIR}/ (the launch-act law mints a release-acceptance record ONLY over a GREEN, FRESH checklist artifact; run flauz.release.checklist first)`);
	}
	const artifactState = await readChecklistArtifact(deps.root, deps.fs, relPath);
	if (artifactState.state === 'absent') {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_ABSENT', `flauz.acceptance.launch: REFUSED -- the checklist artifact '${relPath}' does not exist (an absent artifact is never a launch; run flauz.release.checklist first)`);
	}
	if (artifactState.state === 'torn') {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_TORN', `flauz.acceptance.launch: REFUSED -- the checklist artifact '${relPath}' is torn (${artifactState.reason}); a launch over torn data would silently erase the evidence -- route to the operator`);
	}
	if (!artifactState.idReDerives) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_TORN', `flauz.acceptance.launch: REFUSED -- the checklist artifact '${relPath}' carries checklistId ${artifactState.artifact.checklistId.slice(0, 12)}... which does NOT re-derive over the re-read bytes (the flauz-release re-read cycle law, mirrored here); the artifact is torn -- route to the operator`);
	}
	const artifact = artifactState.artifact;

	// --- GREEN: the gate vocabulary does NOT grow; the verdict is READ, never redefined ---
	if (artifact.verdict === 'NO-GO') {
		const redRows = artifact.rows.filter(row => row.verdict !== 'green').map(row => `${row.id} (${row.verdict})`);
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_RED', `flauz.acceptance.launch: REFUSED -- the checklist artifact '${relPath}' carries verdict NO-GO (the gate is READ, never redefined; the failing row(s): ${redRows.length > 0 ? redRows.join(', ') : 'the artifact declares NO-GO'}); a launch over a red gate is forbidden`);
	}
	const notGreen = artifact.rows.filter(row => row.verdict !== 'green');
	if (notGreen.length > 0) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_TORN', `flauz.acceptance.launch: REFUSED -- the checklist artifact '${relPath}' declares GO but carries non-green rows (${notGreen.map(row => `${row.id} (${row.verdict})`).join(', ')}); the artifact is internally inconsistent (torn) -- route to the operator`);
	}

	// --- FRESH: the artifact's createdAt must sit inside the freshness window of the injected clock ---
	const now = deps.clock();
	const age = now - artifact.createdAt;
	if (age < -60_000 || age > FRESHNESS_WINDOW_MS) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_CHECKLIST_STALE', `flauz.acceptance.launch: REFUSED -- the checklist artifact '${relPath}' is NOT FRESH (createdAt ${toIsoStamp(artifact.createdAt)}, ${age < 0 ? 'future-dated' : `${String(Math.floor(age / 60_000))}m old`} against the injected clock ${toIsoStamp(now)}; the freshness window is 24h); re-run flauz.release.checklist and launch over the fresh artifact`);
	}

	// --- the incident binding (present when the launch closes an incident loop) ---
	let incidentBinding: IncidentBinding | undefined;
	if (args.incidentBinding !== undefined) {
		const journal = await readLoopJournalPin(deps.root, deps.fs, args.incidentBinding.incidentId);
		if (journal.state === 'absent') {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_INCIDENT_ABSENT', `flauz.acceptance.launch: REFUSED -- the loop journal for ${args.incidentBinding.incidentId} is absent (an incident-bound launch requires the incident's loop to exist; report the incident with flauz.incidents.report and advance it to the release stage)`);
		}
		if (journal.state === 'torn') {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_INCIDENT_ABSENT', `flauz.acceptance.launch: REFUSED -- the loop journal for ${args.incidentBinding.incidentId} is torn (${journal.reason}); a launch over torn loop data would silently erase the evidence -- route to the operator`);
		}
		const lastStage = journal.rows[journal.rows.length - 1]?.toStage;
		if (lastStage !== 'release') {
			throw new AcceptanceError('FLAUZ_ACCEPTANCE_INCIDENT_NOT_AT_RELEASE', `flauz.acceptance.launch: REFUSED -- the incident ${args.incidentBinding.incidentId} sits at loop stage '${String(lastStage)}' (an incident-bound launch requires the release stage: the regression->release transition's release-identity carry; advance the loop with flauz.incidents.advance)`);
		}
		incidentBinding = { incidentId: args.incidentBinding.incidentId, stage: 'release', regressionTestName: args.incidentBinding.regressionTestName };
	}

	// --- the pinned product state (the version-inventory + census snapshot shapes) ---
	const productRoot = artifact.workspaceRoot;
	const productStatePin = await readProductStatePin(productRoot, deps.fs);
	const censusPin = await readCensusPin(deps.root, deps.fs);

	// --- the NAMED OWNING CHECKS set (the release's acceptance set) ---
	const owningChecks: OwningCheck[] = artifact.rows.map(row => ({
		name: row.id,
		kind: 'checklist-row',
		command: row.evidence.command,
		observable: row.evidence.observable,
		owner: 'flauz-release',
		evaluableByPlane: false,
	}));
	owningChecks.push({
		name: 'binding-checklist-re-read',
		kind: 'binding-checklist-re-read',
		command: 'flauz.acceptance.verify',
		observable: 'the bound checklist artifact re-reads and its checklistId re-derives over the re-read bytes (the release identity still pins)',
		owner: 'flauz-acceptance',
		evaluableByPlane: true,
	});
	owningChecks.push({
		name: 'product-inventory',
		kind: 'product-inventory',
		command: 'flauz.acceptance.verify',
		observable: 'the pinned product inventory (the flauz-* extension set + the parity row count + the SBOM extension components) still matches the pinned state',
		owner: 'flauz-acceptance',
		evaluableByPlane: true,
	});
	owningChecks.push({
		name: 'census-integrity',
		kind: 'census-integrity',
		command: 'flauz.acceptance.verify',
		observable: 'the pinned durable-state census surfaces parse (no parseError rows in the re-walked census)',
		owner: 'flauz-acceptance',
		evaluableByPlane: true,
	});
	if (incidentBinding !== undefined) {
		owningChecks.push({
			name: 'binding-incident-journal',
			kind: 'binding-incident-journal',
			command: 'flauz.acceptance.verify',
			observable: 'the bound incident loop journal re-reads and the incident sits at (or past) the release stage',
			owner: 'flauz-acceptance',
			evaluableByPlane: true,
		});
		owningChecks.push({
			name: incidentBinding.regressionTestName,
			kind: 'incident-regression-test',
			command: 'flauz.incidents.advance',
			observable: `the named regression test '${incidentBinding.regressionTestName}' passes against the released state`,
			owner: 'flauz-incidents',
			evaluableByPlane: false,
		});
	}

	// --- the acceptance id (deterministic fnv1a32-style derivation from the bound content) ---
	const idContent = canonicalJson({
		artifactPath: relPath,
		checklistId: artifact.checklistId,
		createdAt: now,
		productName: artifact.productName,
		productVersion: artifact.productVersion,
		incidentBinding: incidentBinding ?? null,
		owningCheckNames: owningChecks.map(check => check.name),
	});
	const acceptanceId = acceptanceIdFromContent(idContent);

	const record: AcceptanceRecord = {
		$schema: ACCEPTANCE_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-acceptance',
		extensionId: EXTENSION_ID,
		acceptanceId,
		createdAt: now,
		createdAtIso: toIsoStamp(now),
		actor: args.actor,
		checklist: {
			artifactPath: relPath,
			checklistId: artifact.checklistId,
			createdAt: artifact.createdAt,
			productName: artifact.productName,
			productVersion: artifact.productVersion,
			verdict: 'GO',
			rowCount: artifact.rows.length,
			fileSha256: sha256Hex(artifactState.text),
		},
		productStatePin,
		censusPin,
		owningChecks,
		...(incidentBinding !== undefined ? { incidentBinding } : {}),
		boundaryDisclosure: BOUNDARY_DISCLOSURE,
		privacyLaw: PRIVACY_LAW,
	};

	const persisted = await persistAcceptance(deps, record);
	return { ok: true, acceptanceId, record, persisted };
}

export function renderLaunch(result: LaunchResult): readonly string[] {
	const lines: string[] = [];
	lines.push(`  acceptance: ${result.acceptanceId} (the deterministic id -- a double fnv1a32 derivation from the bound content, no random)`);
	lines.push(`    bound checklist: ${result.record.checklist.artifactPath} VERBATIM (checklistId ${result.record.checklist.checklistId.slice(0, 12)}..., verdict GO, ${String(result.record.checklist.rowCount)} rows -- the release identity the incidents loop carries)`);
	lines.push(`    product pin: ${String(result.record.productStatePin.extensions.length)} flauz extensions | parity rows ${String(result.record.productStatePin.parity.rowCount)} | sbom components ${String(result.record.productStatePin.sbom.componentCount)} (the version-inventory + census snapshot shapes, contract-pinned from flauz-release)`);
	lines.push(`    owning checks: ${String(result.record.owningChecks.length)} (the release's acceptance set${result.record.incidentBinding !== undefined ? `, incl. the incident's named regression test '${result.record.incidentBinding.regressionTestName}' for ${result.record.incidentBinding.incidentId}` : ''})`);
	lines.push(`    launched at: ${result.record.createdAtIso} (the injected clock -- the only timestamp source)`);
	lines.push(`  ${BOUNDARY_DISCLOSURE}`);
	return lines;
}

export { acceptanceRelPath };
