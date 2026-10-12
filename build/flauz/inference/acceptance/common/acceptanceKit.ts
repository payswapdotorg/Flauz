/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 Free Inference Fabric kit: the deterministic LIVE-PROVIDER
 * ACCEPTANCE and FAILURE DRILLS kit over the landed inference fabric
 * (the fail-closed factory binding the landed catalog / adapter /
 * scope-set records, the injected network port (fixture respond or
 * live fetchLike - the ONLY exchange seam; the shipped code never
 * calls a global fetch, never opens a socket), the caller-injected
 * handle-shaped credential port, the acceptance and failure drill
 * folds whose every payload member is a PROJECTION through the
 * landed families' own folds (the adapter report fold, the capacity
 * disclosure fold, the presentation kit's view projections, the
 * isolation kit's eligibility fold - never re-implemented), and the
 * append-only acceptance-drills.jsonl evidence ledger (kit module,
 * the labContracts discipline).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE UPGRADE LAW: the evidence label is DERIVED from the exchange
 *   class - 'fixture' for a drill over the injected fixture port,
 *   'live-real' ONLY for a real exchange over the live port (a
 *   failed live probe is live-real FAILURE evidence, never retried,
 *   never converted). A live-real claim over a fixture-configured
 *   port - a ledger line the kit reads - is the typed 'no-live-port'
 *   rejection. No drill record is ever 'local-real'.
 * - THE SAFETY LAW: credentials reach the drill ONLY through the
 *   caller-injected handle-shaped credential port; a drill without
 *   one is the typed 'credential-shape' refusal, never a silent
 *   unauthenticated exchange; a secret-shaped port, a resolution
 *   beyond the typed reference, or a handle that does not equal the
 *   bound adapter record's own credentialHandle is the typed
 *   'credential-shape' rejection. No credential material anywhere.
 * - THE HONEST-FAILURE LAW: the port's refusal reason is recorded
 *   VERBATIM as network-refused failure evidence - never re-worded,
 *   never retried into success, never silently dropped, never
 *   converted to fixture.
 * - THE NEVER-RE-DERIVE LAW: every drill payload member rides the
 *   landed folds - the report through the landed reportAdapterSnapshot,
 *   the disclosure through the landed projectCapacityDisclosure, the
 *   views through the landed presentation kit, the verdict through
 *   the landed isolation kit's eligibility fold; the byte citations
 *   name the landed serializers and are produced by them.
 * - THE NO-DANGLING-REF LAW: the drill's scope, adapter and decision
 *   bindings resolve against the bound records - or the drill is a
 *   typed rejection; the ledger walk resolves every line's own
 *   bindings the same way.
 * - THE INJECTED-CLOCK LAW: the kit never reads a clock. Every
 *   timestamp is a read of the caller-injected clock (drill start,
 *   completion, failure instant, snapshot fold). No Date.now, no
 *   Math.random, no process.env in this module (law comments
 *   excepted).
 * - THE LEDGER LAW: the kit appends acceptance-drills.jsonl under
 *   the injected root, one canonical line per recorded
 *   evidence record, append-only; the drill's eligibility decision
 *   and projected views ride the landed isolation and presentation
 *   kits' own ledgers at the same root (isolation-decisions.jsonl,
 *   presentation-audits.jsonl) - the full honest evidence chain.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT:
 *   every drill / ledger rejection is a typed member of the frozen
 *   ACCEPTANCE_REJECTION_REASONS list, applied in the exact list
 *   order per walk; the first failing check is THE verdict.
 * - Zero external dependencies: node:fs / node:path builtins and the
 *   landed sibling families only.
 */
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INFERENCE_ACCEPTANCE_VERSION, FAILURE_DRILL_CLASSES, isAcceptanceLedgerLine, isDrillEvidence, isDrillRecord, isFailureDrillClass, isFailureEvidence, serializeAcceptanceRecord } from './acceptanceContract.js';
import type {
	AcceptanceCredentialPort,
	AcceptanceDrillOutcome,
	AcceptanceDrillRefused,
	AcceptanceLedgerLine,
	AcceptanceLedgerLineOutcome,
	AcceptanceNetworkPort,
	AcceptanceOutcome,
	AcceptanceRejectionReason,
	DrillRecord,
	DrillWireRequest,
	DrillWireResponse,
	FailureDrillScenario,
	FailureEvidence,
} from './acceptanceContract.js';
import { admitProviderAdapterRecord, reportAdapterSnapshot, serializeAdapterReport } from '../../adapters/common/providerAdapter.js';
import type { AdapterObservation, ProviderAdapterDescriptor, ProviderAdapterRecord, ProviderAdapterHealthReport } from '../../adapters/common/providerAdapter.js';
import { COOLDOWN_REASONS, projectCapacityDisclosure, serializeCapacityDisclosure, unverifiedProvenance } from '../../semantics/common/capacityDisclosure.js';
import type { CooldownReason, ProviderCapacityDisclosure } from '../../semantics/common/capacityDisclosure.js';
import { admitCatalogRecord, catalogIndexById } from '../../catalog/common/providerCatalog.js';
import type { ProviderCatalogEntry, ProviderCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { admitCredentialScope, admitCredentialScopeSet, serializeCredentialScope, serializeEligibilityDecision, verdictForTermState } from '../../isolation/common/isolationContract.js';
import type { CredentialScopeDescriptor, CredentialScopeSetRecord, EligibilityDecided, HandleResolution } from '../../isolation/common/isolationContract.js';
import { createIsolationKit } from '../../isolation/common/isolationKit.js';
import type { IsolationKit } from '../../isolation/common/isolationKit.js';
import { serializePresentationRecord } from '../../presentation/common/presentationContract.js';
import { createPresentationKit } from '../../presentation/common/presentationKit.js';
import type { PresentationKit } from '../../presentation/common/presentationKit.js';

export { INFERENCE_ACCEPTANCE_VERSION } from './acceptanceContract.js';

/**
 * The drill-evidence ledger file name under the caller-injected root
 * (THE LEDGER LAW): acceptance-drills.jsonl - one canonical
 * serializeAcceptanceRecord line per recorded evidence record
 * (either side), append-only, the delivery-evidence stream the
 * post-INF binders consume.
 */
export const ACCEPTANCE_DRILLS_LEDGER_FILE = 'acceptance-drills.jsonl';

/**
 * The disclosed fixture adapter-binding ids (evidence label
 * 'fixture'). The kit does NOT pre-bind them (a drill binds the
 * caller's landed records, which the kit cannot know at creation -
 * the landed fixture registration note carries over); the battery
 * binds the three disclosed fixture adapters at these ids against
 * the fixture bound records:
 *   fixture.acceptance.healthy  - the fixture adapter whose
 *                                 provider's termsState is
 *                                 'permitted' (verdict 'eligible')
 *                                 whose fixture observation
 *                                 discloses the healthy 'available'
 *                                 capacity (the acceptance-exchange
 *                                 drill);
 *   fixture.acceptance.refused  - the fixture adapter whose
 *                                 provider's termsState is
 *                                 'prohibited' (verdict
 *                                 'ineligible' - the
 *                                 eligibility-refusal failure drill;
 *                                 a prohibited scope never reaches
 *                                 the wire);
 *   fixture.acceptance.unknown  - the fixture adapter whose
 *                                 provider's termsState is 'unknown'
 *                                 (verdict 'term-unknown' - the
 *                                 term-unknown eligibility law)
 *                                 whose fixture observation
 *                                 discloses the honest 'unknown'
 *                                 capacity states (the
 *                                 provenance-unknown failure drill).
 */
export const FIXTURE_ACCEPTANCE_HEALTHY_ID = 'fixture.acceptance.healthy';
export const FIXTURE_ACCEPTANCE_REFUSED_ID = 'fixture.acceptance.refused';
export const FIXTURE_ACCEPTANCE_UNKNOWN_ID = 'fixture.acceptance.unknown';

/**
 * The provenance scope-label convention for the failure drills (the
 * landed probe-scope convention, mirrored verbatim): a failure drill
 * scenario names no model id, so the failure report's provenance
 * scopeLabel names the ACCEPTANCE failure-probe scope - a scope
 * label, never a model claim (mirroring the routing family's
 * ROUTING_PROBE_SCOPE and the isolation family's
 * ISOLATION_ELIGIBILITY_PROBE_SCOPE conventions).
 */
export const ACCEPTANCE_FAILURE_PROBE_SCOPE = 'acceptance.failure-probe';

/**
 * The usage class every acceptance drill's eligibility check rides
 * (the landed closed USAGE_CLASSES vocabulary): the drill proves the
 * product-inference path's live-provider acceptance, so the
 * eligibility question is asked for 'product-inference'.
 */
export const ACCEPTANCE_DRILL_USAGE_CLASS = 'product-inference';

/**
 * The kit options: the injected clock (THE INJECTED-CLOCK LAW), the
 * bound catalog / adapter record and the bound credential scope set
 * (arriving as unknown at the runtime boundary, validated through the
 * LANDED guards - admitCatalogRecord, admitProviderAdapterRecord with
 * the catalog, admitCredentialScopeSet with both), the injected
 * network port (the ONLY exchange seam: the fixture respond fold or
 * the live fetchLike - validated against the frozen port shapes), the
 * OPTIONAL caller-injected handle-shaped credential port (validated
 * when present; a drill without one is the typed 'credential-shape'
 * refusal - THE SAFETY LAW), and the caller-injected ledger root (an
 * existing directory; the kit appends acceptance-drills.jsonl inside
 * it and the landed isolation / presentation kits append their own
 * ledgers at the same root - THE LEDGER LAW).
 */
export interface AcceptanceKitOptions {
	readonly now: () => number;
	readonly catalog: unknown;
	readonly adapters: unknown;
	readonly scopes: unknown;
	readonly networkPort: unknown;
	readonly credentialPort?: unknown;
	readonly ledgerRoot: string;
}

/**
 * The kit's own state fold (the audit shape): the acceptance stamp
 * (the kit's re-carried copy), the injected fold instant, the
 * honest deterministic drill / refusal / read counters (what the kit
 * did), the honest disclosure of the binding surface (the bound
 * adapter ids and the bound scope ids, sorted ascending), and the
 * injected network port's own kind (the evidence-label source of
 * every drill it ran - 'fixture' or 'live', never a guess). Zero
 * evidence records are cached: the fold is the honest state, never
 * an event authority.
 */
export interface AcceptanceKitSnapshot {
	readonly contractVersion: string;
	readonly foldedAtEpochMs: number;
	readonly acceptanceDrillsPerformed: number;
	readonly failureDrillsPerformed: number;
	readonly refusalsEmitted: number;
	readonly ledgerLinesProjected: number;
	readonly boundAdapterIds: readonly string[];
	readonly boundScopeIds: readonly string[];
	readonly networkPortKind: 'fixture' | 'live';
}

/**
 * The deterministic acceptance kit: the acceptance and failure drill
 * folds over the injected network port (every payload member a
 * projection through the landed folds), the drill-ledger reader and
 * the stream projector, the kit state fold, and the append-only JSONL
 * drill-evidence ledger. Pure vocabulary over injected values plus
 * the bounded ledger surfaces (the drill append, the landed decision
 * and view-audit appends, the ledger read): no global fetch, no
 * socket, no randomness, no credential material, no event authority.
 */
export interface AcceptanceKit {
	runAcceptanceDrill(request: unknown): Promise<AcceptanceDrillOutcome>;
	runFailureDrill(scenario: unknown): Promise<AcceptanceDrillOutcome>;
	readDrillLedger(path: unknown, line: unknown): AcceptanceOutcome<AcceptanceLedgerLine>;
	projectDrillLedger(lines: unknown): AcceptanceOutcome<readonly AcceptanceLedgerLineOutcome[]>;
	snapshot(): AcceptanceKitSnapshot;
}

/**
 * Creates an acceptance kit (fail-closed factory). Validation order
 * is deterministic: the options shape (now must be a function; the
 * ledger root must be a non-empty string), the bound catalog through
 * the LANDED admitCatalogRecord, the bound adapter record through
 * the LANDED admitProviderAdapterRecord with the catalog, the bound
 * credential scope set through the LANDED admitCredentialScopeSet
 * (with both), the injected network port against the frozen port
 * shapes (the fixture two-field form or the live three-field form -
 * anything else is a fail-closed TypeError, never a guessed seam),
 * the OPTIONAL credential port against the handle-shaped
 * three-field form with its scope admitted through the LANDED
 * admitCredentialScope and resolved against the bound scope set (a
 * secret-shaped port is rejected at the boundary - THE SAFETY LAW),
 * the ledger root (an existing directory), and finally ONE read of
 * the injected clock to validate it can produce a finite fold time.
 * The kit starts with ZERO drills, refusals and ledger reads.
 */
export function createAcceptanceKit(options: AcceptanceKitOptions): AcceptanceKit {
	if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
		throw new TypeError(
			'createAcceptanceKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const optionsRecord = options as AcceptanceKitOptions;
	const ledgerRoot = optionsRecord.ledgerRoot;
	if (!isNonEmptyString(ledgerRoot)) {
		throw new TypeError(
			'createAcceptanceKit: options.ledgerRoot must be a non-empty string (the caller-injected root the drill-evidence ledger lives at - the kit never invents a location)',
		);
	}
	const catalogAdmission = admitCatalogRecord(optionsRecord.catalog);
	if (!catalogAdmission.admitted) {
		throw new TypeError(
			`createAcceptanceKit: the bound catalog must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const boundCatalog: ProviderCatalogRecord = catalogAdmission.record;
	const adaptersAdmission = admitProviderAdapterRecord(optionsRecord.adapters, optionsRecord.catalog);
	if (!adaptersAdmission.admitted) {
		throw new TypeError(
			`createAcceptanceKit: the bound adapter record must satisfy admitProviderAdapterRecord: '${adaptersAdmission.reason}': ${adaptersAdmission.detail}`,
		);
	}
	const boundAdapters: ProviderAdapterRecord = adaptersAdmission.record;
	const scopesAdmission = admitCredentialScopeSet(optionsRecord.scopes, boundAdapters, boundCatalog);
	if (!scopesAdmission.admitted) {
		throw new TypeError(
			`createAcceptanceKit: the bound credential scope set must satisfy admitCredentialScopeSet: '${scopesAdmission.reason}': ${scopesAdmission.detail}`,
		);
	}
	const boundScopes: CredentialScopeSetRecord = scopesAdmission.record;
	const port = validateNetworkPort(optionsRecord.networkPort);
	const credentialPort = validateCredentialPort(optionsRecord.credentialPort, boundAdapters, boundCatalog);
	const ledgerStats = statSync(ledgerRoot, { throwIfNoEntry: false });
	if (ledgerStats === undefined || !ledgerStats.isDirectory()) {
		throw new TypeError(
			`createAcceptanceKit: options.ledgerRoot '${ledgerRoot}' must be an existing directory (the caller injects the root; the kit appends ${ACCEPTANCE_DRILLS_LEDGER_FILE} inside it)`,
		);
	}
	const drillLedgerPath = join(ledgerRoot, ACCEPTANCE_DRILLS_LEDGER_FILE);
	const now = optionsRecord.now;
	if (!isFiniteEpochMs(now())) {
		throw new TypeError(
			'createAcceptanceKit: the injected clock must produce a finite epoch-ms number (one validation read at creation)',
		);
	}
	const adaptersById = new Map<string, ProviderAdapterDescriptor>();
	for (const adapter of boundAdapters.adapters) {
		adaptersById.set(adapter.adapterId, adapter);
	}
	const scopesById = new Map<string, CredentialScopeDescriptor>();
	for (const scope of boundScopes.scopes) {
		scopesById.set(scope.id, scope);
	}
	const catalogIndex: Readonly<Record<string, ProviderCatalogEntry>> = catalogIndexById(boundCatalog);
	// THE NEVER-RE-DERIVE LAW's binding chain: the drill's eligibility
	// decisions ride the LANDED isolation kit (its own fold, its own
	// isolation-decisions.jsonl ledger at the same root), and the drill's
	// payload views ride the LANDED presentation kit (its own projections,
	// its own presentation-audits.jsonl ledger at the same root) - both
	// bound to the SAME records, clock and root, never re-implemented here.
	const isolationKit: IsolationKit = createIsolationKit({
		now,
		adapters: boundAdapters,
		catalog: boundCatalog,
		ledgerRoot,
	});
	for (const scope of boundScopes.scopes) {
		const registration = isolationKit.register(scope);
		if (!registration.admitted) {
			throw new TypeError(
				`createAcceptanceKit: the bound scope '${scope.id}' must register in the landed isolation kit: '${registration.reason}': ${registration.detail}`,
			);
		}
	}
	const presentationKit: PresentationKit = createPresentationKit({
		now,
		catalog: boundCatalog,
		adapters: boundAdapters,
		scopes: boundScopes,
		ledgerRoot,
	});
	let acceptanceDrillsPerformed = 0;
	let failureDrillsPerformed = 0;
	let refusalsEmitted = 0;
	let ledgerLinesProjected = 0;

	function refuse(reason: AcceptanceRejectionReason, detail: string): AcceptanceDrillRefused {
		refusalsEmitted += 1;
		return { drilled: false, reason, detail };
	}

	function readClock(foldName: string): number {
		const value = now();
		if (!isFiniteEpochMs(value)) {
			throw new TypeError(
				`${foldName}: the injected clock must produce a finite epoch-ms number (the injected-clock law - the kit never reads a clock itself)`,
			);
		}
		return value;
	}

	async function resolveCredentialBinding(): Promise<CredentialBindingOutcome> {
		if (credentialPort === undefined) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'no credential port is injected - credentials reach the drill ONLY through a caller-INJECTED handle-shaped credential port (the safety law); a drill without one is a typed refusal, never a silent unauthenticated exchange',
			};
		}
		if (
			!isRecord(credentialPort.scope)
			|| !carriesOnlyFields(credentialPort.scope as Record<string, unknown>, CREDENTIAL_TRIPLE_FIELDS)
		) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'the credential port\'s scope must be the landed typed reference triple (id, adapterId, handleRef) and nothing else - a scope beyond the typed reference is the secret shape, never admitted (the safety law)',
			};
		}
		const scopeAdmission = admitCredentialScope(credentialPort.scope, boundAdapters, boundCatalog);
		if (!scopeAdmission.admitted) {
			if (scopeAdmission.reason === 'unresolved-adapter-binding' || scopeAdmission.reason === 'unresolved-catalog-entry') {
				return {
					bound: false,
					reason: 'unresolved-adapter-binding',
					detail: `the credential port's scope must satisfy the landed admitCredentialScope: '${scopeAdmission.reason}': ${scopeAdmission.detail}`,
				};
			}
			return {
				bound: false,
				reason: 'credential-shape',
				detail: `the credential port's scope must satisfy the landed admitCredentialScope: '${scopeAdmission.reason}': ${scopeAdmission.detail}`,
			};
		}
		const scope = scopeAdmission.scope;
		if (!scopesById.has(scope.id)) {
			return {
				bound: false,
				reason: 'unresolved-scope-binding',
				detail: `the credential port's scope id '${scope.id}' resolves to no bound credential scope - a dangling scope reference is a typed rejection, never a silent dangling ref`,
			};
		}
		let resolution: unknown;
		try {
			resolution = await credentialPort.resolve();
		} catch {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'the credential port\'s resolve fold threw - a broken injected seam is the typed credential-shape refusal, never a silent exchange',
			};
		}
		if (!isRecord(resolution)) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'the credential port\'s resolution must be a non-null object (the landed HandleResolution shape)',
			};
		}
		const resolutionRecord = resolution as Record<string, unknown>;
		if (resolutionRecord.resolved === false) {
			if (
				!carriesOnlyFields(resolutionRecord, HANDLE_REFUSED_FIELDS)
				|| resolutionRecord.reason !== 'unknown-scope'
				|| !isNonEmptyString(resolutionRecord.detail)
			) {
				return {
					bound: false,
					reason: 'credential-shape',
					detail: 'the unresolved resolution is the landed three-field form { resolved: false, reason: \'unknown-scope\', detail } and nothing else - the landed closed resolution vocabulary applies verbatim',
				};
			}
			return {
				bound: false,
				reason: 'unresolved-scope-binding',
				detail: `the credential port's handle resolution refused: '${String(resolutionRecord.reason)}': ${String(resolutionRecord.detail)}`,
			};
		}
		if (resolutionRecord.resolved !== true) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'the credential port\'s resolution must name its side (resolved: true or the landed refusal form)',
			};
		}
		if (!carriesOnlyFields(resolutionRecord, HANDLE_RESOLVED_FIELDS)) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'the resolved handle is the landed typed reference (scopeId, adapterId, credentialHandle) and nothing else - a resolution beyond the typed reference is the secret shape, never admitted (the safety law)',
			};
		}
		const resolvedScopeId = resolutionRecord.scopeId;
		const resolvedAdapterId = resolutionRecord.adapterId;
		const resolvedHandle = resolutionRecord.credentialHandle;
		if (!isNonEmptyString(resolvedScopeId) || !isNonEmptyString(resolvedAdapterId) || !isNonEmptyString(resolvedHandle)) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: 'the resolved handle\'s scopeId, adapterId and credentialHandle must be non-empty strings (the landed typed reference shape)',
			};
		}
		const adapter = adaptersById.get(scope.adapterId);
		if (adapter === undefined) {
			return {
				bound: false,
				reason: 'unresolved-adapter-binding',
				detail: `the scope's adapterId '${scope.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
			};
		}
		if (resolvedScopeId !== scope.id || resolvedAdapterId !== scope.adapterId) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: `the resolved handle's binding (scope '${String(resolvedScopeId)}', adapter '${String(resolvedAdapterId)}') must equal the port scope's own binding (scope '${scope.id}', adapter '${scope.adapterId}') - a cross-inconsistent resolution is the typed credential-shape rejection`,
			};
		}
		if (resolvedHandle !== adapter.credentialHandle) {
			return {
				bound: false,
				reason: 'credential-shape',
				detail: `the resolved handle reference must EQUAL the bound adapter record's own credentialHandle for adapter '${adapter.adapterId}' - a caller-invented handle reference is a typed rejection, never a silent substitution`,
			};
		}
		return { bound: true, scope, adapter };
	}

	function checkEligibilityBinding(scope: CredentialScopeDescriptor): EligibilityWalk {
		const decision = isolationKit.checkEligibility(scope.id, ACCEPTANCE_DRILL_USAGE_CLASS);
		if (decision.kind !== 'decided') {
			return {
				ok: false,
				reason: 'unresolved-scope-binding',
				detail: `the eligibility fold refused for scope '${scope.id}': no-eligible-binding: ${decision.detail}`,
			};
		}
		// THE NEVER-RE-DERIVE LAW's evidence chain: the drill's decision is
		// recorded through the landed isolation kit's own ledger
		// (isolation-decisions.jsonl), never re-serialized here.
		isolationKit.recordDecision(decision);
		return { ok: true, decision };
	}

	async function exchangeOverPort(wireRequest: DrillWireRequest, foldName: string): Promise<ExchangeWalk> {
		const startedAtEpochMs = readClock(foldName);
		let response: unknown;
		if (port.kind === 'fixture') {
			response = port.respond(wireRequest);
		} else {
			response = await port.fetchLike(port.endpoint, wireRequest);
		}
		const completedAtEpochMs = readClock(foldName);
		const validated = validatePortResponse(response);
		if (!validated.valid) {
			return {
				ok: false,
				reason: 'shape-law-violation',
				detail: `the network port's response must satisfy the typed wire shapes: ${validated.message}`,
			};
		}
		return { ok: true, response: validated.response, startedAtEpochMs, completedAtEpochMs };
	}

	function validatePortResponse(response: unknown): { readonly valid: true; readonly response: DrillWireResponse } | { readonly valid: false; readonly message: string } {
		// The port's response walk (the frozen subset: shape-law-violation
		// only - the port is the injected seam, its response is validated
		// against the typed wire shapes before any fold sees it). A port that
		// THROWS is a broken injected seam - the failure propagates fail-closed,
		// never converted to a typed refusal (the honest failure reason rides
		// the refused side, where the port itself carries it).
		if (!isRecord(response)) {
			return {
				valid: false,
				message: 'the network port\'s response must be a non-null object (the typed DrillWireResponse shape - the completed observation side or the refused side)',
			};
		}
		const responseRecord = response as Record<string, unknown>;
		if (responseRecord.completed === false) {
			if (!carriesOnlyFields(responseRecord, WIRE_REFUSED_FIELDS) || !isNonEmptyString(responseRecord.refusalReason)) {
				return {
					valid: false,
					message: 'the refused wire response is the two-field shape { completed: false, refusalReason } and nothing else - the port\'s honest failure reason is a non-empty string carried verbatim',
				};
			}
			return { valid: true, response: { completed: false, refusalReason: responseRecord.refusalReason } };
		}
		if (responseRecord.completed !== true) {
			return {
				valid: false,
				message: 'the network port\'s response must name its completed side (completed: true or completed: false)',
			};
		}
		if (!carriesOnlyFields(responseRecord, WIRE_COMPLETED_FIELDS) || !isRecord(responseRecord.observation)) {
			return {
				valid: false,
				message: 'the completed wire response is the two-field shape { completed: true, observation } and nothing else - the observation is the landed AdapterObservation shape',
			};
		}
		const observationRecord = responseRecord.observation as Record<string, unknown>;
		if (
			!carriesOnlyFields(observationRecord, OBSERVATION_FIELDS)
			|| !isFiniteEpochMs(observationRecord.observedAtEpochMs)
		) {
			return {
				valid: false,
				message: 'the observation is the landed five-field AdapterObservation shape (observedAtEpochMs, health, quota, cooldown, reset) with a finite injected timestamp - all fields required, never silent defaults',
			};
		}
		return {
			valid: true,
			response: {
				completed: true,
				observation: responseRecord.observation as unknown as AdapterObservation,
			},
		};
	}

	function foldReportAndDisclosure(
		adapter: ProviderAdapterDescriptor,
		observation: AdapterObservation,
		requestedModelId: string,
		startedAtEpochMs: number,
		completedAtEpochMs: number,
	): ReportWalk {
		// The provenance input through the LANDED unverifiedProvenance
		// constructor: the drill asks its bound provider for the requested
		// model - 'unverified' by construction, a hidden substitution
		// unrepresentable (requested equals actual by construction).
		const provenance = unverifiedProvenance({
			requestedProviderId: adapter.providerEntryId,
			requestedModelId,
			actualProviderId: adapter.providerEntryId,
			actualModelId: requestedModelId,
			recordedAtEpochMs: startedAtEpochMs,
		});
		let report: ProviderAdapterHealthReport;
		try {
			report = reportAdapterSnapshot(adapter, observation, provenance);
		} catch (error) {
			return {
				ok: false,
				reason: 'shape-law-violation',
				detail: `the completed observation must satisfy the landed reportAdapterSnapshot: ${(error as Error).message}`,
			};
		}
		const disclosureOutcome = projectCapacityDisclosure(report.snapshot, report.provenance, completedAtEpochMs);
		if (!disclosureOutcome.disclosed) {
			return {
				ok: false,
				reason: 'shape-law-violation',
				detail: `the completed observation must satisfy the landed projectCapacityDisclosure: '${disclosureOutcome.reason}': ${disclosureOutcome.detail}`,
			};
		}
		return { ok: true, report, disclosure: disclosureOutcome.disclosure };
	}

	function recordFailureEvidence(evidence: FailureEvidence): AcceptanceDrillOutcome {
		if (!isFailureEvidence(evidence)) {
			throw new TypeError(
				'recordFailureEvidence: the produced failure evidence must satisfy isFailureEvidence (the kit and contract version copies must agree - the drift fails closed)',
			);
		}
		appendFileSync(drillLedgerPath, serializeAcceptanceRecord(evidence) + '\n', 'utf8');
		failureDrillsPerformed += 1;
		return { drilled: true, evidence };
	}

	function parseDrillLineCore(line: string, position: number): AcceptanceLedgerLineOutcome {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return {
				projected: false,
				line: position,
				reason: 'malformed-record',
				detail: `the ledger line ${position} is not parseable JSON bytes - a ledger line must be this family's own canonical byte form, never a silent drop`,
			};
		}
		if (!isDrillEvidence(parsed)) {
			return {
				projected: false,
				line: position,
				reason: 'malformed-record',
				detail: `the ledger line ${position} admits under no acceptance guard (isDrillRecord / isFailureEvidence) - a ledger line must be this family's own canonical byte form, never a silent drop`,
			};
		}
		if (serializeAcceptanceRecord(parsed) !== line) {
			return {
				projected: false,
				line: position,
				reason: 'malformed-record',
				detail: `the ledger line ${position} does not round-trip byte-equal through serializeAcceptanceRecord - a ledger line must be this family's own canonical byte form, never a silent drop`,
			};
		}
		const evidence = parsed;
		if (evidence.evidenceLabel === 'live-real' && port.kind === 'fixture') {
			// THE UPGRADE LAW, at the read boundary: a live-real claim over a
			// fixture-configured network port is the typed no-live-port
			// rejection - live-real is claimed ONLY when a live exchange
			// actually happened, never promoted.
			return {
				projected: false,
				line: position,
				reason: 'no-live-port',
				detail: `the ledger line ${position} claims 'live-real' evidence over a fixture-configured network port - live-real is claimed ONLY when a live exchange actually happened, never promoted (the upgrade law)`,
			};
		}
		const boundAdapter = adaptersById.get(evidence.adapterId);
		if (boundAdapter === undefined) {
			return {
				projected: false,
				line: position,
				reason: 'unresolved-adapter-binding',
				detail: `the ledger line's adapterId '${evidence.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
			};
		}
		if (evidence.kind === 'drill') {
			const boundScope = scopesById.get(evidence.scope.id);
			if (boundScope === undefined) {
				return {
					projected: false,
					line: position,
					reason: 'unresolved-scope-binding',
					detail: `the drill line's scope id '${evidence.scope.id}' resolves to no bound credential scope - a dangling scope reference is a typed rejection, never a silent dangling ref`,
				};
			}
			if (boundScope.adapterId !== evidence.adapterId || evidence.scope.adapterId !== evidence.adapterId) {
				return {
					projected: false,
					line: position,
					reason: 'unresolved-scope-binding',
					detail: `the drill line's scope binding cross-inconsists with its adapter binding '${evidence.adapterId}' - a cross-inconsistent scope binding is a typed rejection, never a silent dangling ref`,
				};
			}
			const catalogEntry = catalogIndex[boundAdapter.providerEntryId];
			const landedVerdict = verdictForTermState(catalogEntry.termsState);
			if (evidence.payload.eligibilityVerdict !== landedVerdict) {
				return {
					projected: false,
					line: position,
					reason: 'unresolved-decision-binding',
					detail: `the drill line's eligibility verdict '${evidence.payload.eligibilityVerdict}' does not resolve against the bound provider's term state folded through the landed verdictForTermState ('${landedVerdict}') - a verdict the bound records never produced is a typed rejection, never a silent dangling ref`,
				};
			}
		}
		const view: AcceptanceLedgerLine = {
			contractVersion: INFERENCE_ACCEPTANCE_VERSION,
			line: position,
			recordKind: evidence.kind,
			canonicalBytes: line,
			record: evidence,
		};
		if (!isAcceptanceLedgerLine(view)) {
			throw new TypeError(
				'readDrillLedger: the produced ledger line view must satisfy isAcceptanceLedgerLine (the kit and contract version copies must agree - the drift fails closed)',
			);
		}
		return { projected: true, line: position, view };
	}

	function readDrillLedgerCore(path: unknown, line: unknown): AcceptanceOutcome<AcceptanceLedgerLine> {
		if (!isNonEmptyString(path) || !isPositiveLine(line)) {
			return {
				projected: false,
				reason: 'shape-law-violation',
				detail: 'the ledger path must be a non-empty string and the line a 1-based positive integer (the caller-injected ledger surface shape)',
			};
		}
		const stats = statSync(path, { throwIfNoEntry: false });
		if (stats === undefined || !stats.isFile()) {
			return {
				projected: false,
				reason: 'unresolved-ledger-line',
				detail: `the ledger path '${path}' resolves to no ledger file - a dangling ledger reference is a typed rejection, never a silent dangling ref`,
			};
		}
		const lines = readFileSync(path, 'utf8')
			.split('\n')
			.filter((entry) => entry.length > 0);
		if (line > lines.length) {
			return {
				projected: false,
				reason: 'unresolved-ledger-line',
				detail: `the ledger at '${path}' carries ${lines.length} line(s); line ${line} is out of range - a dangling ledger line reference is a typed rejection, never a silent dangling ref`,
			};
		}
		const outcome = parseDrillLineCore(lines[line - 1], line);
		if (outcome.projected) {
			ledgerLinesProjected += 1;
			return { projected: true, view: outcome.view };
		}
		refusalsEmitted += 1;
		return { projected: false, reason: outcome.reason, detail: outcome.detail };
	}

	const kit: AcceptanceKit = {
		async runAcceptanceDrill(request: unknown): Promise<AcceptanceDrillOutcome> {
			const requestWalk = walkDrillRequest(request);
			if (!requestWalk.ok) {
				return refuse(requestWalk.reason, requestWalk.detail);
			}
			const binding = await resolveCredentialBinding();
			if (!binding.bound) {
				return refuse(binding.reason, binding.detail);
			}
			const decisionWalk = checkEligibilityBinding(binding.scope);
			if (!decisionWalk.ok) {
				return refuse(decisionWalk.reason, decisionWalk.detail);
			}
			if (decisionWalk.decision.verdict !== 'eligible') {
				return refuse(
					'unresolved-decision-binding',
					`the bound provider's term state folds the landed verdict '${decisionWalk.decision.verdict}' - an acceptance exchange is drilled ONLY for an eligible binding; unknown is never auto-eligible (the honest-unknown eligibility law)`,
				);
			}
			const wireRequest: DrillWireRequest = {
				adapterId: binding.adapter.adapterId,
				providerEntryId: binding.adapter.providerEntryId,
				scopeId: binding.scope.id,
				handleRef: binding.scope.handleRef,
				requestedModelId: requestWalk.requestedModelId,
			};
			let exchange: ExchangeWalk;
			try {
				exchange = await exchangeOverPort(wireRequest, 'runAcceptanceDrill');
			} catch (error) {
				return refuse(
					'shape-law-violation',
					`the network port's response must satisfy the typed wire shapes: ${(error as Error).message}`,
				);
			}
			if (!exchange.ok) {
				return refuse(exchange.reason, exchange.detail);
			}
			const response = exchange.response;
			if (!response.completed) {
				// THE HONEST-FAILURE LAW: the port's refusal is recorded verbatim
				// as network-refused failure evidence - never retried into
				// success, never silently dropped, never converted to fixture.
				const evidence: FailureEvidence = {
					kind: 'failure',
					contractVersion: INFERENCE_ACCEPTANCE_VERSION,
					drillId: requestWalk.drillId,
					drillClass: 'network-refused',
					evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
					adapterId: binding.adapter.adapterId,
					failureReason: response.refusalReason,
					disclosure: { side: 'refused', reasons: [response.refusalReason] },
					failedAtEpochMs: readClock('runAcceptanceDrill'),
				};
				return recordFailureEvidence(evidence);
			}
			const reportWalk = foldReportAndDisclosure(
				binding.adapter,
				response.observation,
				requestWalk.requestedModelId,
				exchange.startedAtEpochMs,
				exchange.completedAtEpochMs,
			);
			if (!reportWalk.ok) {
				return refuse(reportWalk.reason, reportWalk.detail);
			}
			const provenanceOutcome = presentationKit.projectProvenance(reportWalk.report.provenance);
			if (!provenanceOutcome.projected) {
				return refuse(
					'shape-law-violation',
					`the drill's provenance must project through the landed presentation fold: '${provenanceOutcome.reason}': ${provenanceOutcome.detail}`,
				);
			}
			const capacityOutcome = presentationKit.projectCapacity(reportWalk.disclosure);
			if (!capacityOutcome.projected) {
				return refuse(
					'shape-law-violation',
					`the drill's capacity disclosure must project through the landed presentation fold: '${capacityOutcome.reason}': ${capacityOutcome.detail}`,
				);
			}
			const resetExpectationView = presentationKit.projectReset(response.observation.reset);
			const decisionViewOutcome = presentationKit.projectDecision(decisionWalk.decision);
			if (!decisionViewOutcome.projected) {
				return refuse(
					'shape-law-violation',
					`the drill's eligibility decision must project through the landed presentation fold: '${decisionViewOutcome.reason}': ${decisionViewOutcome.detail}`,
				);
			}
			// THE LEDGER LAW's evidence chain: every projected view is audited
			// through the landed presentation kit's own ledger
			// (presentation-audits.jsonl), never re-serialized here.
			presentationKit.recordViewAudit(provenanceOutcome.view);
			presentationKit.recordViewAudit(capacityOutcome.view);
			presentationKit.recordViewAudit(resetExpectationView);
			presentationKit.recordViewAudit(decisionViewOutcome.view);
			const record: DrillRecord = {
				kind: 'drill',
				contractVersion: INFERENCE_ACCEPTANCE_VERSION,
				drillId: requestWalk.drillId,
				drillClass: 'acceptance-exchange',
				evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
				adapterId: binding.adapter.adapterId,
				providerEntryId: binding.adapter.providerEntryId,
				transportKind: binding.adapter.transportKind,
				capacityProvenance: binding.adapter.capacityProvenance,
				credentialHandle: binding.scope.handleRef,
				scope: binding.scope,
				payload: {
					provenanceView: provenanceOutcome.view,
					capacityView: capacityOutcome.view,
					resetExpectationView,
					decisionView: decisionViewOutcome.view,
					eligibilityVerdict: decisionWalk.decision.verdict,
				},
				byteCitations: [
					{ serializer: 'serializeCredentialScope', bytes: serializeCredentialScope(binding.scope) },
					{ serializer: 'serializeAdapterReport', bytes: serializeAdapterReport(reportWalk.report) },
					{ serializer: 'serializeCapacityDisclosure', bytes: serializeCapacityDisclosure(reportWalk.disclosure) },
					{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(provenanceOutcome.view) },
					{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(capacityOutcome.view) },
					{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(resetExpectationView) },
					{ serializer: 'serializePresentationRecord', bytes: serializePresentationRecord(decisionViewOutcome.view) },
					{ serializer: 'serializeEligibilityDecision', bytes: serializeEligibilityDecision(decisionWalk.decision) },
				],
				startedAtEpochMs: exchange.startedAtEpochMs,
				completedAtEpochMs: exchange.completedAtEpochMs,
				failureReason: 'none',
			};
			if (!isDrillRecord(record)) {
				throw new TypeError(
					'runAcceptanceDrill: the produced drill record must satisfy isDrillRecord (the kit and contract version copies must agree - the drift fails closed)',
				);
			}
			appendFileSync(drillLedgerPath, serializeAcceptanceRecord(record) + '\n', 'utf8');
			acceptanceDrillsPerformed += 1;
			return { drilled: true, evidence: record };
		},

		async runFailureDrill(scenario: unknown): Promise<AcceptanceDrillOutcome> {
			const scenarioWalk = walkFailureScenario(scenario);
			if (!scenarioWalk.ok) {
				return refuse(scenarioWalk.reason, scenarioWalk.detail);
			}
			const drilled = scenarioWalk.scenario;
			const binding = await resolveCredentialBinding();
			if (!binding.bound) {
				return refuse(binding.reason, binding.detail);
			}
			const decisionWalk = checkEligibilityBinding(binding.scope);
			if (!decisionWalk.ok) {
				return refuse(decisionWalk.reason, decisionWalk.detail);
			}
			if (drilled.drillClass === 'eligibility-refusal') {
				if (drilled.scopeId !== binding.scope.id) {
					return refuse(
						'unresolved-scope-binding',
						`the scenario names scope '${drilled.scopeId}' but the injected credential port binds scope '${binding.scope.id}' - a cross-inconsistent scope binding is a typed rejection, never a silent dangling ref`,
					);
				}
				if (decisionWalk.decision.verdict === 'eligible') {
					return refuse(
						'shape-law-violation',
						`the scenario names scope '${binding.scope.id}' whose bound provider's term state folds the landed verdict 'eligible' - an eligibility refusal for an eligible scope is not honest evidence`,
					);
				}
				// The eligibility refusal never reaches the wire (fail-closed: a
				// prohibited or unknown-term scope is never exchanged); the
				// landed verdict is the honest failure reason, verbatim.
				const evidence: FailureEvidence = {
					kind: 'failure',
					contractVersion: INFERENCE_ACCEPTANCE_VERSION,
					drillId: drilled.drillId,
					drillClass: 'eligibility-refusal',
					evidenceLabel: 'fixture',
					adapterId: binding.adapter.adapterId,
					failureReason: decisionWalk.decision.verdict,
					disclosure: { side: 'refused', reasons: [decisionWalk.decision.verdict] },
					failedAtEpochMs: readClock('runFailureDrill'),
				};
				return recordFailureEvidence(evidence);
			}
			if (decisionWalk.decision.verdict !== 'eligible') {
				return refuse(
					'unresolved-decision-binding',
					`the bound provider's term state folds the landed verdict '${decisionWalk.decision.verdict}' - a wire-reaching failure drill is drilled ONLY for an eligible binding (the honest-unknown eligibility law: unknown is never auto-eligible)`,
				);
			}
			const wireRequest: DrillWireRequest = {
				adapterId: binding.adapter.adapterId,
				providerEntryId: binding.adapter.providerEntryId,
				scopeId: binding.scope.id,
				handleRef: binding.scope.handleRef,
				requestedModelId: ACCEPTANCE_FAILURE_PROBE_SCOPE,
			};
			let exchange: ExchangeWalk;
			try {
				exchange = await exchangeOverPort(wireRequest, 'runFailureDrill');
			} catch (error) {
				return refuse(
					'shape-law-violation',
					`the network port's response must satisfy the typed wire shapes: ${(error as Error).message}`,
				);
			}
			if (!exchange.ok) {
				return refuse(exchange.reason, exchange.detail);
			}
			const response = exchange.response;
			if (!response.completed) {
				if (drilled.drillClass !== 'network-refused') {
					return refuse(
						'shape-law-violation',
						`the scenario class '${drilled.drillClass}' requires a completed observation but the port refused: '${response.refusalReason}' - the kit never re-words a refusal into another class`,
					);
				}
				if (drilled.refusalReason !== response.refusalReason) {
					return refuse(
						'shape-law-violation',
						`the scenario pins refusal reason '${drilled.refusalReason}' but the port refused with '${response.refusalReason}' - a scenario that disagrees with its own port is a typed rejection; the kit never guesses which is honest`,
					);
				}
				const evidence: FailureEvidence = {
					kind: 'failure',
					contractVersion: INFERENCE_ACCEPTANCE_VERSION,
					drillId: drilled.drillId,
					drillClass: 'network-refused',
					evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
					adapterId: binding.adapter.adapterId,
					failureReason: response.refusalReason,
					disclosure: { side: 'refused', reasons: [response.refusalReason] },
					failedAtEpochMs: readClock('runFailureDrill'),
				};
				return recordFailureEvidence(evidence);
			}
			if (drilled.drillClass === 'network-refused') {
				return refuse(
					'shape-law-violation',
					'the scenario class \'network-refused\' requires the port\'s refused side but the port completed - the kit never re-words a completion into a refusal',
				);
			}
			const reportWalk = foldReportAndDisclosure(
				binding.adapter,
				response.observation,
				ACCEPTANCE_FAILURE_PROBE_SCOPE,
				exchange.startedAtEpochMs,
				exchange.completedAtEpochMs,
			);
			if (!reportWalk.ok) {
				return refuse(reportWalk.reason, reportWalk.detail);
			}
			const disclosure = reportWalk.disclosure;
			const observation = response.observation;
			if (drilled.drillClass === 'quota-failure') {
				if (disclosure.capacityState !== 'exhausted') {
					return refuse(
						'shape-law-violation',
						`the scenario class 'quota-failure' requires the landed disclosed capacity state 'exhausted' but the observation disclosed '${disclosure.capacityState}' - the landed exhaustion vocabulary applies verbatim, never re-worded`,
					);
				}
				const evidence: FailureEvidence = {
					kind: 'failure',
					contractVersion: INFERENCE_ACCEPTANCE_VERSION,
					drillId: drilled.drillId,
					drillClass: 'quota-failure',
					evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
					adapterId: binding.adapter.adapterId,
					failureReason: 'quota-exhausted',
					disclosure: { side: 'refused', reasons: ['exhausted', 'quota-exhausted'] },
					failedAtEpochMs: readClock('runFailureDrill'),
				};
				return recordFailureEvidence(evidence);
			}
			if (drilled.drillClass === 'cooldown-failure') {
				const activeReason = readActiveCooldownReason(observation.cooldown);
				if (disclosure.capacityState !== 'cooldown' || activeReason !== drilled.cooldownReason) {
					return refuse(
						'shape-law-violation',
						`the scenario class 'cooldown-failure' requires the landed disclosed capacity state 'cooldown' with the active cooldown's own reason '${drilled.cooldownReason}' but the observation disclosed '${disclosure.capacityState}' with reason '${String(activeReason)}' - the landed COOLDOWN_REASONS vocabulary applies verbatim, never re-worded`,
					);
				}
				const evidence: FailureEvidence = {
					kind: 'failure',
					contractVersion: INFERENCE_ACCEPTANCE_VERSION,
					drillId: drilled.drillId,
					drillClass: 'cooldown-failure',
					evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
					adapterId: binding.adapter.adapterId,
					failureReason: drilled.cooldownReason,
					disclosure: { side: 'refused', reasons: ['cooldown', drilled.cooldownReason] },
					failedAtEpochMs: readClock('runFailureDrill'),
				};
				return recordFailureEvidence(evidence);
			}
			if (drilled.drillClass === 'reset-failure') {
				if (observation.reset.kind !== 'fixed-instant' || disclosure.resetExpectation.kind !== 'unknown') {
					return refuse(
						'shape-law-violation',
						`the scenario class 'reset-failure' requires a stale fixed-instant reset (the honest 'unknown' expectation, never a fabricated future) but the observation carried reset kind '${observation.reset.kind}' with expectation '${disclosure.resetExpectation.kind}' - the landed stale-reset law applies verbatim, never re-worded`,
					);
				}
				const evidence: FailureEvidence = {
					kind: 'failure',
					contractVersion: INFERENCE_ACCEPTANCE_VERSION,
					drillId: drilled.drillId,
					drillClass: 'reset-failure',
					evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
					adapterId: binding.adapter.adapterId,
					failureReason: 'unknown',
					disclosure: { side: 'refused', reasons: ['fixed-instant', 'unknown'] },
					failedAtEpochMs: readClock('runFailureDrill'),
				};
				return recordFailureEvidence(evidence);
			}
			// The remaining class: provenance-unknown.
			if (disclosure.capacityState !== 'unknown' || reportWalk.report.provenance.modelVerification !== 'unverified') {
				return refuse(
					'shape-law-violation',
					`the scenario class 'provenance-unknown' requires the landed disclosed capacity state 'unknown' with 'unverified' metadata but the observation disclosed '${disclosure.capacityState}' with '${reportWalk.report.provenance.modelVerification}' - the landed honest-unknown vocabulary applies verbatim, never re-worded`,
				);
			}
			const evidence: FailureEvidence = {
				kind: 'failure',
				contractVersion: INFERENCE_ACCEPTANCE_VERSION,
				drillId: drilled.drillId,
				drillClass: 'provenance-unknown',
				evidenceLabel: port.kind === 'fixture' ? 'fixture' : 'live-real',
				adapterId: binding.adapter.adapterId,
				failureReason: 'unknown',
				disclosure: { side: 'refused', reasons: ['unknown', 'unverified'] },
				failedAtEpochMs: readClock('runFailureDrill'),
			};
			return recordFailureEvidence(evidence);
		},

		readDrillLedger(path: unknown, line: unknown): AcceptanceOutcome<AcceptanceLedgerLine> {
			return readDrillLedgerCore(path, line);
		},

		projectDrillLedger(lines: unknown): AcceptanceOutcome<readonly AcceptanceLedgerLineOutcome[]> {
			if (!Array.isArray(lines) || !lines.every((entry) => typeof entry === 'string')) {
				refusalsEmitted += 1;
				return {
					projected: false,
					reason: 'shape-law-violation',
					detail: 'the drill ledger stream must be an array of line strings (the caller-injected line stream shape)',
				};
			}
			const outcomes: AcceptanceLedgerLineOutcome[] = [];
			for (let index = 0; index < lines.length; index++) {
				const outcome = parseDrillLineCore(lines[index], index + 1);
				if (outcome.projected) {
					ledgerLinesProjected += 1;
				} else {
					refusalsEmitted += 1;
				}
				outcomes.push(outcome);
			}
			return { projected: true, view: outcomes };
		},

		snapshot(): AcceptanceKitSnapshot {
			const foldedAtEpochMs = now();
			if (!isFiniteEpochMs(foldedAtEpochMs)) {
				throw new TypeError(
					'snapshot: the injected clock must produce a finite epoch-ms fold time',
				);
			}
			return {
				contractVersion: INFERENCE_ACCEPTANCE_VERSION,
				foldedAtEpochMs,
				acceptanceDrillsPerformed,
				failureDrillsPerformed,
				refusalsEmitted,
				ledgerLinesProjected,
				boundAdapterIds: sortedIds(adaptersById.keys()),
				boundScopeIds: sortedIds(scopesById.keys()),
				networkPortKind: port.kind,
			};
		},
	};
	return kit;
}

/** The typed refusal shape the kit's refuse fold emits (the contract's own). */
type AcceptanceDrillRefusedShape = {
	readonly drilled: false;
	readonly reason: AcceptanceRejectionReason;
	readonly detail: string;
};

/** The credential binding walk's outcome sides. */
type CredentialBindingOutcome =
	| { readonly bound: true; readonly scope: CredentialScopeDescriptor; readonly adapter: ProviderAdapterDescriptor }
	| { readonly bound: false; readonly reason: AcceptanceRejectionReason; readonly detail: string };

/** The eligibility walk's outcome sides. */
type EligibilityWalk =
	| { readonly ok: true; readonly decision: EligibilityDecided }
	| { readonly ok: false; readonly reason: AcceptanceRejectionReason; readonly detail: string };

/** The wire exchange walk's outcome sides. */
type ExchangeWalk =
	| {
			readonly ok: true;
			readonly response: DrillWireResponse;
			readonly startedAtEpochMs: number;
			readonly completedAtEpochMs: number;
		}
	| { readonly ok: false; readonly reason: AcceptanceRejectionReason; readonly detail: string };

/** The report / disclosure fold walk's outcome sides. */
type ReportWalk =
	| { readonly ok: true; readonly report: ProviderAdapterHealthReport; readonly disclosure: ProviderCapacityDisclosure }
	| { readonly ok: false; readonly reason: AcceptanceRejectionReason; readonly detail: string };

/**
 * Validates the injected network port against the frozen port shapes
 * (fail-closed): the fixture two-field form { kind: 'fixture',
 * respond } or the live three-field form { kind: 'live', endpoint,
 * fetchLike }. Anything else - a global-fetch-shaped seam, a socket
 * reference, a guessed endpoint - is a fail-closed TypeError: the
 * injected port is the ONLY exchange seam this family knows.
 */
function validateNetworkPort(candidate: unknown): AcceptanceNetworkPort {
	if (!isRecord(candidate)) {
		throw new TypeError(
			'createAcceptanceKit: options.networkPort must be a non-null object (the injected network port is the ONLY exchange seam - the shipped code never calls a global fetch, never opens a socket)',
		);
	}
	const portRecord = candidate as Record<string, unknown>;
	if (portRecord.kind === 'fixture') {
		if (!carriesOnlyFields(portRecord, FIXTURE_PORT_FIELDS) || typeof portRecord.respond !== 'function') {
			throw new TypeError(
				'createAcceptanceKit: the fixture network port is the two-field shape { kind: \'fixture\', respond } and nothing else - the respond fold returns the injected fixture response (vocabulary behavior only; the evidence label derives \'fixture\')',
			);
		}
		return {
			kind: 'fixture',
			respond: portRecord.respond as (request: DrillWireRequest) => DrillWireResponse,
		};
	}
	if (portRecord.kind === 'live') {
		if (
			!carriesOnlyFields(portRecord, LIVE_PORT_FIELDS)
			|| !isNonEmptyString(portRecord.endpoint)
			|| typeof portRecord.fetchLike !== 'function'
		) {
			throw new TypeError(
				'createAcceptanceKit: the live network port is the three-field shape { kind: \'live\', endpoint, fetchLike } and nothing else - the caller-supplied fetchLike performs the REAL exchange against the real provider endpoint (a completed exchange derives \'live-real\')',
			);
		}
		return {
			kind: 'live',
			endpoint: portRecord.endpoint,
			fetchLike: portRecord.fetchLike as (endpoint: string, request: DrillWireRequest) => Promise<DrillWireResponse>,
		};
	}
	throw new TypeError(
		`createAcceptanceKit: options.networkPort.kind must be 'fixture' or 'live' (the frozen port vocabulary), got '${String(portRecord.kind)}'`,
	);
}

/**
 * Validates the OPTIONAL caller-injected credential port (fail-closed,
 * THE SAFETY LAW): the handle-shaped three-field form { kind:
 * 'handle', scope, resolve } and NOTHING else - a secret-shaped port
 * is rejected at the boundary; the scope must satisfy the LANDED
 * admitCredentialScope against the bound records and resolve against
 * the bound scope set (no dangling scope). Returns undefined when no
 * port is injected (the drill folds refuse with the typed
 * 'credential-shape' reason - a drill without an injected credential
 * port never exchanges).
 */
function validateCredentialPort(
	candidate: unknown,
	boundAdapters: ProviderAdapterRecord,
	boundCatalog: ProviderCatalogRecord,
): AcceptanceCredentialPort | undefined {
	if (candidate === undefined) {
		return undefined;
	}
	if (!isRecord(candidate)) {
		throw new TypeError(
			'createAcceptanceKit: options.credentialPort must be a non-null object when injected (the handle-shaped credential port - the safety law: credentials reach the drill ONLY through it)',
		);
	}
	const portRecord = candidate as Record<string, unknown>;
	if (
		portRecord.kind !== 'handle'
		|| !carriesOnlyFields(portRecord, CREDENTIAL_PORT_FIELDS)
		|| typeof portRecord.resolve !== 'function'
	) {
		throw new TypeError(
			'createAcceptanceKit: the credential port is the handle-shaped three-field form { kind: \'handle\', scope, resolve } and NOTHING else - a secret-shaped port is rejected at the boundary (the safety law: no credential material anywhere in the vocabulary)',
		);
	}
	const scopeAdmission = admitCredentialScope(portRecord.scope, boundAdapters, boundCatalog);
	if (!scopeAdmission.admitted) {
		throw new TypeError(
			`createAcceptanceKit: the credential port's scope must satisfy the landed admitCredentialScope: '${scopeAdmission.reason}': ${scopeAdmission.detail}`,
		);
	}
	return {
		kind: 'handle',
		scope: scopeAdmission.scope,
		resolve: portRecord.resolve as () => Promise<HandleResolution>,
	};
}

/**
 * The acceptance drill request walk (the frozen subset: not-an-object
 * -> caller-supplied-label -> caller-supplied-verdict ->
 * shape-law-violation). THE UPGRADE LAW fires at the boundary: a
 * request carrying an evidenceLabel field is the typed
 * 'caller-supplied-label' rejection (labels are DERIVED from the
 * exchange class, never supplied); a request carrying a verdict field
 * is the typed caller-supplied-verdict rejection (THE
 * NEVER-RE-DERIVE LAW); any field beyond the two-field request shape,
 * or a malformed member, is the shape-law rejection. Deterministic;
 * never mutates its input.
 */
function walkDrillRequest(request: unknown): RequestWalk {
	if (!isRecord(request)) {
		return { ok: false, reason: 'not-an-object', detail: 'the drill request must be a non-null object' };
	}
	const record = request as Record<string, unknown>;
	if (Object.prototype.hasOwnProperty.call(record, 'evidenceLabel')) {
		return {
			ok: false,
			reason: 'caller-supplied-label',
			detail: 'the drill request carries a caller-supplied evidence label - labels are DERIVED from the exchange class (the injected fixture port, the live port\'s real exchange), never supplied (the upgrade law)',
		};
	}
	if (
		Object.prototype.hasOwnProperty.call(record, 'verdict')
		|| Object.prototype.hasOwnProperty.call(record, 'eligibilityVerdict')
	) {
		return {
			ok: false,
			reason: 'caller-supplied-verdict',
			detail: 'the drill request carries a caller-supplied eligibility verdict - verdicts are derived through the landed folds (the never-re-derive law), never supplied',
		};
	}
	if (!carriesOnlyFields(record, DRILL_REQUEST_FIELDS)) {
		return {
			ok: false,
			reason: 'shape-law-violation',
			detail: 'the drill request is the two-field shape { drillId, requestedModelId } and nothing else - the payload projections are DERIVED through the landed kit folds, never supplied',
		};
	}
	if (!isNonEmptyString(record.drillId)) {
		return {
			ok: false,
			reason: 'shape-law-violation',
			detail: 'the drill request\'s drillId must be a non-empty string (the \'fixture.\' prefix convention names synthetic ids)',
		};
	}
	if (!isNonEmptyString(record.requestedModelId)) {
		return {
			ok: false,
			reason: 'shape-law-violation',
			detail: 'the drill request\'s requestedModelId must be a non-empty string',
		};
	}
	return { ok: true, drillId: record.drillId, requestedModelId: record.requestedModelId };
}

/**
 * The failure drill scenario walk (the frozen subset: not-an-object
 * -> caller-supplied-label -> caller-supplied-verdict ->
 * shape-law-violation). The class must be a member of the frozen
 * FAILURE_DRILL_CLASSES (the acceptance-exchange class is not a
 * failure scenario); the class-specific members ride the landed
 * vocabularies verbatim (cooldownReason a COOLDOWN_REASONS member;
 * scopeId and refusalReason non-empty strings); the class's exact
 * field set is pinned (nothing beyond it is representable).
 * Deterministic; never mutates its input.
 */
function walkFailureScenario(scenario: unknown): ScenarioWalk {
	if (!isRecord(scenario)) {
		return { ok: false, reason: 'not-an-object', detail: 'the failure drill scenario must be a non-null object' };
	}
	const record = scenario as Record<string, unknown>;
	if (Object.prototype.hasOwnProperty.call(record, 'evidenceLabel')) {
		return {
			ok: false,
			reason: 'caller-supplied-label',
			detail: 'the failure drill scenario carries a caller-supplied evidence label - labels are DERIVED from the exchange class, never supplied (the upgrade law)',
		};
	}
	if (
		Object.prototype.hasOwnProperty.call(record, 'verdict')
		|| Object.prototype.hasOwnProperty.call(record, 'eligibilityVerdict')
	) {
		return {
			ok: false,
			reason: 'caller-supplied-verdict',
			detail: 'the failure drill scenario carries a caller-supplied eligibility verdict - verdicts are derived through the landed folds (the never-re-derive law), never supplied',
		};
	}
	const drillClass = record.drillClass;
	if (!isFailureDrillClass(drillClass)) {
		return {
			ok: false,
			reason: 'shape-law-violation',
			detail: `the failure drill scenario's drillClass must be a member of the frozen failure classes (${FAILURE_DRILL_CLASSES.join(' / ')}), got '${String(drillClass)}' - the acceptance-exchange class is a DrillRecord, never a failure scenario`,
		};
	}
	const classFields = FAILURE_SCENARIO_FIELDS[drillClass];
	if (!carriesOnlyFields(record, classFields)) {
		return {
			ok: false,
			reason: 'shape-law-violation',
			detail: `the '${drillClass}' scenario is the exact field set { ${classFields.join(', ')} } and nothing else - the class-specific vocabulary members are pinned, never widened`,
		};
	}
	if (!isNonEmptyString(record.drillId)) {
		return {
			ok: false,
			reason: 'shape-law-violation',
			detail: 'the failure drill scenario\'s drillId must be a non-empty string (the \'fixture.\' prefix convention names synthetic ids)',
		};
	}
	if (drillClass === 'cooldown-failure') {
		if (!(COOLDOWN_REASONS as readonly string[]).includes(record.cooldownReason as string)) {
			return {
				ok: false,
				reason: 'shape-law-violation',
				detail: `the cooldown-failure scenario's cooldownReason must be a member of the landed COOLDOWN_REASONS vocabulary (${COOLDOWN_REASONS.join(' / ')}), got '${String(record.cooldownReason)}'`,
			};
		}
		return { ok: true, scenario: record as unknown as FailureDrillScenario };
	}
	if (drillClass === 'eligibility-refusal') {
		if (!isNonEmptyString(record.scopeId)) {
			return {
				ok: false,
				reason: 'shape-law-violation',
				detail: 'the eligibility-refusal scenario\'s scopeId must be a non-empty string naming the scope whose bound provider\'s term state folds non-eligible',
			};
		}
		return { ok: true, scenario: record as unknown as FailureDrillScenario };
	}
	if (drillClass === 'network-refused') {
		if (!isNonEmptyString(record.refusalReason)) {
			return {
				ok: false,
				reason: 'shape-law-violation',
				detail: 'the network-refused scenario\'s refusalReason must be a non-empty string - the port\'s honest failure reason, carried verbatim into the recorded evidence',
			};
		}
	}
	return { ok: true, scenario: record as unknown as FailureDrillScenario };
}

/** Reads the active cooldown's own reason, undefined for any other state. */
function readActiveCooldownReason(cooldown: unknown): CooldownReason | undefined {
	if (!isRecord(cooldown) || cooldown.state !== 'active') {
		return undefined;
	}
	const reason = (cooldown as Record<string, unknown>).reason;
	if (!(COOLDOWN_REASONS as readonly string[]).includes(reason as string)) {
		return undefined;
	}
	return reason as CooldownReason;
}

/** The request walk's outcome sides. */
type RequestWalk =
	| { readonly ok: true; readonly drillId: string; readonly requestedModelId: string }
	| { readonly ok: false; readonly reason: AcceptanceRejectionReason; readonly detail: string };

/** The scenario walk's outcome sides. */
type ScenarioWalk =
	| { readonly ok: true; readonly scenario: FailureDrillScenario }
	| { readonly ok: false; readonly reason: AcceptanceRejectionReason; readonly detail: string };

/** The drill request's exact own-field set. */
const DRILL_REQUEST_FIELDS = ['drillId', 'requestedModelId'] as const;

/** The failure scenario's exact own-field set, per drill class. */
const FAILURE_SCENARIO_FIELDS: Readonly<Record<string, readonly string[]>> = {
	'quota-failure': ['drillId', 'drillClass'],
	'cooldown-failure': ['drillId', 'drillClass', 'cooldownReason'],
	'reset-failure': ['drillId', 'drillClass'],
	'eligibility-refusal': ['drillId', 'drillClass', 'scopeId'],
	'provenance-unknown': ['drillId', 'drillClass'],
	'network-refused': ['drillId', 'drillClass', 'refusalReason'],
};

/** The fixture network port's exact own-field set. */
const FIXTURE_PORT_FIELDS = ['kind', 'respond'] as const;

/** The live network port's exact own-field set. */
const LIVE_PORT_FIELDS = ['kind', 'endpoint', 'fetchLike'] as const;

/** The credential port's exact own-field set (handle-shaped ONLY). */
const CREDENTIAL_PORT_FIELDS = ['kind', 'scope', 'resolve'] as const;

/** The landed typed reference triple's exact own-field set. */
const CREDENTIAL_TRIPLE_FIELDS = ['id', 'adapterId', 'handleRef'] as const;

/** The resolved handle resolution's exact own-field set (the landed form). */
const HANDLE_RESOLVED_FIELDS = ['resolved', 'scopeId', 'adapterId', 'credentialHandle'] as const;

/** The unresolved handle resolution's exact own-field set (the landed form). */
const HANDLE_REFUSED_FIELDS = ['resolved', 'reason', 'detail'] as const;

/** The completed wire response's exact own-field set. */
const WIRE_COMPLETED_FIELDS = ['completed', 'observation'] as const;

/** The refused wire response's exact own-field set. */
const WIRE_REFUSED_FIELDS = ['completed', 'refusalReason'] as const;

/** The landed AdapterObservation's exact own-field set. */
const OBSERVATION_FIELDS = ['observedAtEpochMs', 'health', 'quota', 'cooldown', 'reset'] as const;

/** The no-extra-own-fields check (the landed families' no-extra-keys idiom). */
function carriesOnlyFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
	for (const key of Object.keys(record)) {
		if (!(fields as readonly string[]).includes(key)) {
			return false;
		}
	}
	return true;
}

/** A 1-based positive integer line index (the landed ledger-line idiom). */
function isPositiveLine(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isFiniteEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/** Sorted ascending id list (the honest binding-surface disclosure idiom). */
function sortedIds(ids: Iterable<string>): readonly string[] {
	return [...ids].sort();
}
