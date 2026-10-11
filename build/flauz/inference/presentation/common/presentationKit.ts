/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-008 Free Inference Fabric contracts: the typed PROVENANCE /
 * CAPACITY / RESET presentation kit - the fail-closed factory over
 * the bound catalog, adapter record and credential scope set
 * (validated through the LANDED guards), the pure read-side
 * projection folds over the landed canonical surfaces (the
 * provenance / capacity / reset folds through the landed
 * vocabularies, the unified selected/refused decision view over the
 * landed routing / matching / isolation decision records), the
 * ledger-line reader parsing the LANDED canonical bytes through
 * round-trip byte equality, the full ledger stream projection (every
 * line exactly once - a malformed line is the typed refusal outcome,
 * never a silent drop), the kit state fold, and the append-only JSONL
 * view-audit ledger at the caller-injected root (kit module, the
 * labContracts discipline; binds the landed INF-001..007 family
 * vocabularies verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..007 family laws are INHERITED and binding here):
 * - THE NEVER-RE-DERIVE LAW (binding, this family's charter): every
 *   view this kit emits is a PROJECTION of the landed canonical
 *   surfaces. The provenance / capacity / reset folds carry the landed
 *   record's own values verbatim and stamp only the presentation
 *   version; the ledger lines parse through the LANDED
 *   serializeRoutingDecision / serializeMatchDecision /
 *   serializeEligibilityDecision canonical bytes (round-trip
 *   byte-equal, cited, never re-derived); the decision vocabularies
 *   are the landed ones verbatim; NO parallel display vocabulary
 *   exists. A caller-supplied provenance, substitution, verification
 *   or scope label - any field beyond the landed canonical shape, at
 *   any depth this kit reads - is the typed 'caller-supplied-label'
 *   rejection (derived, never caller-supplied).
 * - THE INJECTED-CLOCK LAW (binding): this kit never reads a clock.
 *   The single injected now() function is read ONCE at creation (the
 *   validation read), ONCE per reset-countdown projection (the pure
 *   fold of (schedule, now)) and ONCE per snapshot fold; the
 *   provenance / capacity / decision / ledger folds read NO clock at
 *   all (every timestamp is the landed record's own). No Date.now, no
 *   Math.random, no process.env in this module (law comments
 *   excepted).
 * - THE NEVER-SILENT-EMPTY LAW (binding): the refused sides are
 *   shown. The unified decision view carries the selected side AND
 *   the refused side with the landed typed reasons verbatim; the
 *   ledger stream projects every line exactly once (a malformed line
 *   is the typed 'malformed-ledger-line' refusal outcome, never a
 *   silent drop); honest-unknown states project AS unknown (the
 *   stale fixed-instant reset, the unknown capacity state, the
 *   term-unknown verdict) - never fabricated healthy, eligible or
 *   future values.
 * - THE NO-DANGLING-REF LAW (extended to presentation): every view's
 *   source binding resolves against the BOUND record surface - the
 *   bound adapter record (every adapter binding the decision carries,
 *   selected or refused), the bound credential scope set (every
 *   isolation decision's scope binding, checked consistent with the
 *   decision's adapter binding), the bound ledger file (every line
 *   index) - or projection is the typed 'unresolved-*' rejection,
 *   never a silent dangling ref. The bound records arrive as unknown
 *   at the runtime boundary and are validated through the LANDED
 *   guards (admitCatalogRecord, admitProviderAdapterRecord with the
 *   catalog, admitCredentialScopeSet with both) - the landed binding
 *   laws cited verbatim in the TypeErrors, never re-implemented.
 * - THE LEDGER LAW (this family's own): the append-only JSONL
 *   view-audit ledger at the caller-injected root
 *   (presentation-audits.jsonl) is the family's one bounded local-IO
 *   surface. It is DELIVERY EVIDENCE, never an event authority: the
 *   kit never reads it back; views derive from the landed records and
 *   the injected clock, never from the audit ledger. Appends are
 *   canonical serializePresentationRecord bytes, one view per line,
 *   in call order (append-only: the file grows, earlier lines never
 *   change). readLedger performs the family's one bounded READ
 *   surface over a caller-injected ledger file - parsed through the
 *   LANDED canonical bytes, never through a parallel shape. No
 *   network I/O (live-provider acceptance is INF-009, never here); no
 *   credential material ever reaches a view or a ledger.
 * - THE DRIFT FAIL-CLOSED LAW: every view the kit emits is
 *   self-checked through the CONTRACT module's shape guards before it
 *   reaches the caller or the audit ledger - a mismatch fails closed
 *   as a TypeError, never as a valid-looking view.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every projection rejection is a typed member of the
 *   frozen PRESENTATION_REJECTION_REASONS list (the contract module's
 *   own list, re-carried here); each walk applies its applicable
 *   subset in the list order and the FIRST failure is THE verdict,
 *   and every rejection names its reason.
 * - THE TYPED REFUSAL, NEVER AN EXCEPTION (binding): the projection
 *   walks refuse through the frozen reason list; the only TypeErrors
 *   this kit throws are the landed factory idiom's own (a malformed
 *   options shape, a non-finite injected clock read, a dishonest view
 *   at the audit boundary) - never a projection verdict.
 * - Zero external dependencies: node: builtins (path, fs - the ledger
 *   law's bounded surfaces) and the landed sibling families only.
 */
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INFERENCE_PRESENTATION_VERSION } from './presentationContract.js';
import {
	LANDED_DECISION_FIELDS,
	LANDED_DISCLOSURE_FIELDS,
	LANDED_PROVENANCE_FIELDS,
	isCapacityView,
	isDecisionView,
	isLedgerLineView,
	isProvenanceView,
	isResetExpectationView,
	serializePresentationRecord,
} from './presentationContract.js';
import type {
	CapacityView,
	DecisionView,
	LedgerLineOutcome,
	LedgerLineRefused,
	LedgerLineView,
	PresentationDecisionFamily,
	PresentationOutcome,
	PresentationRefused,
	PresentationRejectionReason,
	ProvenanceView,
	ResetExpectationView,
} from './presentationContract.js';
export { INFERENCE_PRESENTATION_VERSION } from './presentationContract.js';
import {
	RESET_SCHEDULE_KINDS,
	admitProvenance,
	isProviderCapacityDisclosure,
	nextResetAt,
} from '../../semantics/common/capacityDisclosure.js';
import type { ResetExpectation, ResetSchedule, ResetScheduleKind } from '../../semantics/common/capacityDisclosure.js';
import {
	INFERENCE_ROUTING_VERSION,
	ROUTING_ATTEMPT_OUTCOMES,
	ROUTING_ATTEMPT_REASONS,
	isRoutingDecision,
	serializeRoutingDecision,
} from '../../routing/common/routingContract.js';
import type { RoutingExhausted } from '../../routing/common/routingContract.js';
import { isMatchDecisionRecord, serializeMatchDecision } from '../../matching/common/matchingContract.js';
import type { MatchDecisionRecord } from '../../matching/common/matchingContract.js';
import {
	admitCredentialScopeSet,
	isEligibilityDecisionRecord,
	serializeEligibilityDecision,
} from '../../isolation/common/isolationContract.js';
import type { CredentialScopeDescriptor, EligibilityDecisionRecord } from '../../isolation/common/isolationContract.js';
import { admitCatalogRecord } from '../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { admitProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import type { ProviderAdapterDescriptor, ProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';

/**
 * The kit options: the injected clock (THE INJECTED-CLOCK LAW), the
 * bound catalog and adapter record and the bound credential scope set
 * (arriving as unknown at the runtime boundary, validated through the
 * LANDED guards - admitCatalogRecord, admitProviderAdapterRecord with
 * the catalog, admitCredentialScopeSet with both; the scope set is
 * REQUIRED by THE NO-DANGLING-REF LAW's scope-binding resolution -
 * the honest EMPTY set, zero scopes, is a legal binding when no scope
 * bindings serve the caller's views), and the caller-injected audit
 * root (an existing directory; the kit appends
 * presentation-audits.jsonl inside it - THE LEDGER LAW).
 */
export interface PresentationKitOptions {
	readonly now: () => number;
	readonly catalog: unknown;
	readonly adapters: unknown;
	readonly scopes: unknown;
	readonly ledgerRoot: string;
}

/**
 * The kit's own state fold (the audit shape): the presentation stamp,
 * the injected fold instant, the deterministic projection / refusal /
 * audit counters (what the kit did), and the honest disclosure of the
 * binding surface (the bound adapter ids and the bound scope ids,
 * sorted ascending - the surfaces every view's source binding resolves
 * against). Zero views are cached: the fold is the honest state, never
 * an event authority.
 */
export interface PresentationKitSnapshot {
	readonly contractVersion: string;
	readonly foldedAtEpochMs: number;
	readonly projectionsPerformed: number;
	readonly refusalsEmitted: number;
	readonly viewAuditsRecorded: number;
	readonly boundAdapterIds: readonly string[];
	readonly boundScopeIds: readonly string[];
}

/**
 * The deterministic presentation kit: the pure read-side projection
 * folds over the landed canonical surfaces, the ledger-line reader
 * and stream projector, the kit state fold, and the append-only JSONL
 * view-audit ledger. Pure vocabulary over injected values plus the
 * two bounded ledger surfaces (the audit append and the ledger read):
 * no network, no clock reading, no randomness, no credential
 * material, no event authority.
 */
export interface PresentationKit {
	projectProvenance(record: unknown): PresentationOutcome<ProvenanceView>;
	projectCapacity(disclosure: unknown): PresentationOutcome<CapacityView>;
	projectReset(schedule: unknown): ResetExpectationView;
	projectDecision(decisionRecord: unknown): PresentationOutcome<DecisionView>;
	readLedger(path: unknown, line: unknown): PresentationOutcome<LedgerLineView>;
	projectLedger(lines: unknown): PresentationOutcome<readonly LedgerLineOutcome[]>;
	snapshot(): PresentationKitSnapshot;
	recordViewAudit(view: unknown): void;
}

/**
 * The view-audit ledger file name under the caller-injected root (THE
 * LEDGER LAW): presentation-audits.jsonl.
 */
export const PRESENTATION_AUDITS_LEDGER_FILE = 'presentation-audits.jsonl';

/**
 * The disclosed fixture adapter-binding ids (evidence label
 * 'fixture'). The kit does NOT pre-bind them (a view binds the
 * caller's landed records, which the kit cannot know at creation -
 * the isolation family's fixture registration note carries over); the
 * battery binds the three disclosed fixture adapters at these ids
 * against its fixture bound records:
 *   fixture.view.healthy       - the fixture adapter whose provider's
 *                                capacity disclosure projects the
 *                                healthy 'available' view (quota at
 *                                full, no cooldown, a future
 *                                fixed-instant reset);
 *   fixture.view.refused       - the fixture adapter behind the
 *                                fixture refused decision views (the
 *                                no-routable-candidate-class and
 *                                EligibilityRefused-class refusals
 *                                whose "why" reasons the battery
 *                                projects verbatim);
 *   fixture.view.unknown-reset - the fixture adapter whose provider's
 *                                stale fixed-instant reset projects
 *                                the honest 'unknown' reset
 *                                expectation (the INF-001 stale-reset
 *                                law, never a fabricated future).
 */
export const FIXTURE_VIEW_HEALTHY_ID = 'fixture.view.healthy';
export const FIXTURE_VIEW_REFUSED_ID = 'fixture.view.refused';
export const FIXTURE_VIEW_UNKNOWN_RESET_ID = 'fixture.view.unknown-reset';

/**
 * Creates a presentation kit (fail-closed factory). Validation order
 * is deterministic: the options shape (now must be a function; the
 * audit root must be a non-empty string), the bound catalog through
 * the LANDED admitCatalogRecord, the bound adapter record through the
 * LANDED admitProviderAdapterRecord with the catalog, the bound
 * credential scope set through the LANDED admitCredentialScopeSet with
 * both, the audit root (an existing directory), and finally ONE read
 * of the injected clock to validate it can produce a finite fold time.
 * The kit starts with ZERO projections, refusals and audits.
 */
export function createPresentationKit(options: PresentationKitOptions): PresentationKit {
	if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
		throw new TypeError(
			'createPresentationKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const record = options as PresentationKitOptions;
	const ledgerRoot = record.ledgerRoot;
	if (!isNonEmptyString(ledgerRoot)) {
		throw new TypeError(
			'createPresentationKit: options.ledgerRoot must be a non-empty string (the caller-injected root the view-audit ledger lives at - the kit never invents a location)',
		);
	}
	const catalogAdmission = admitCatalogRecord(record.catalog);
	if (!catalogAdmission.admitted) {
		throw new TypeError(
			`createPresentationKit: the bound catalog must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const boundCatalog: ProviderCatalogRecord = catalogAdmission.record;
	const adaptersAdmission = admitProviderAdapterRecord(record.adapters, record.catalog);
	if (!adaptersAdmission.admitted) {
		throw new TypeError(
			`createPresentationKit: the bound adapter record must satisfy admitProviderAdapterRecord: '${adaptersAdmission.reason}': ${adaptersAdmission.detail}`,
		);
	}
	const boundAdapters: ProviderAdapterRecord = adaptersAdmission.record;
	const scopesAdmission = admitCredentialScopeSet(record.scopes, boundAdapters, boundCatalog);
	if (!scopesAdmission.admitted) {
		throw new TypeError(
			`createPresentationKit: the bound credential scope set must satisfy admitCredentialScopeSet: '${scopesAdmission.reason}': ${scopesAdmission.detail}`,
		);
	}
	const boundScopes = scopesAdmission.record;
	const ledgerStats = statSync(ledgerRoot, { throwIfNoEntry: false });
	if (ledgerStats === undefined || !ledgerStats.isDirectory()) {
		throw new TypeError(
			`createPresentationKit: options.ledgerRoot '${ledgerRoot}' must be an existing directory (the caller injects the root; the kit appends ${PRESENTATION_AUDITS_LEDGER_FILE} inside it)`,
		);
	}
	const auditLedgerPath = join(ledgerRoot, PRESENTATION_AUDITS_LEDGER_FILE);
	const now = record.now;
	if (!isFiniteEpochMs(now())) {
		throw new TypeError(
			'createPresentationKit: the injected clock must produce a finite epoch-ms number (one validation read at creation)',
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
	let projectionsPerformed = 0;
	let refusalsEmitted = 0;
	let viewAuditsRecorded = 0;

	const countOutcome = (outcome: PresentationOutcome<unknown>): void => {
		if (outcome.projected) {
			projectionsPerformed += 1;
		} else {
			refusalsEmitted += 1;
		}
	};

	const kit: PresentationKit = {
		projectProvenance(record: unknown): PresentationOutcome<ProvenanceView> {
			const outcome = projectProvenanceCore(record);
			countOutcome(outcome);
			return outcome;
		},
		projectCapacity(disclosure: unknown): PresentationOutcome<CapacityView> {
			const outcome = projectCapacityCore(disclosure);
			countOutcome(outcome);
			return outcome;
		},
		projectReset(schedule: unknown): ResetExpectationView {
			// THE INJECTED-CLOCK LAW: one read per projection - the reset
			// countdown view is a pure fold of (schedule, now), never a
			// hidden clock read.
			const projectedAtEpochMs = now();
			if (!isFiniteEpochMs(projectedAtEpochMs)) {
				throw new TypeError(
					'projectReset: the injected clock must produce a finite epoch-ms probe instant (one read per projection - the kit never reads a clock itself)',
				);
			}
			const view = projectResetCore(schedule, projectedAtEpochMs);
			projectionsPerformed += 1;
			return view;
		},
		projectDecision(decisionRecord: unknown): PresentationOutcome<DecisionView> {
			const outcome = projectDecisionCore(decisionRecord, { adaptersById, scopesById });
			countOutcome(outcome);
			return outcome;
		},
		readLedger(path: unknown, line: unknown): PresentationOutcome<LedgerLineView> {
			const outcome = readLedgerCore(path, line, { adaptersById, scopesById });
			countOutcome(outcome);
			return outcome;
		},
		projectLedger(lines: unknown): PresentationOutcome<readonly LedgerLineOutcome[]> {
			if (!Array.isArray(lines) || !lines.every((entry) => typeof entry === 'string')) {
				const refusal = refuse(
					'shape-law-violation',
					'the ledger stream must be an array of line strings (the caller-injected line stream shape)',
				);
				refusalsEmitted += 1;
				return refusal;
			}
			const outcomes: LedgerLineOutcome[] = [];
			for (let index = 0; index < lines.length; index++) {
				const outcome = parseLedgerLineCore(lines[index], index + 1, { adaptersById, scopesById });
				if (outcome.projected) {
					projectionsPerformed += 1;
				} else {
					refusalsEmitted += 1;
				}
				outcomes.push(outcome);
			}
			return { projected: true, view: outcomes };
		},
		snapshot(): PresentationKitSnapshot {
			const foldedAtEpochMs = now();
			if (!isFiniteEpochMs(foldedAtEpochMs)) {
				throw new TypeError(
					'snapshot: the injected clock must produce a finite epoch-ms fold time',
				);
			}
			return {
				contractVersion: INFERENCE_PRESENTATION_VERSION,
				foldedAtEpochMs,
				projectionsPerformed,
				refusalsEmitted,
				viewAuditsRecorded,
				boundAdapterIds: sortedIds(adaptersById.keys()),
				boundScopeIds: sortedIds(scopesById.keys()),
			};
		},
		recordViewAudit(view: unknown): void {
			// THE DRIFT FAIL-CLOSED LAW rides the contract serializer's own
			// guards: a dishonest view throws here, never reaching the
			// ledger.
			const bytes = serializePresentationRecord(view);
			appendFileSync(auditLedgerPath, bytes + '\n', 'utf8');
			viewAuditsRecorded += 1;
		},
	};
	return kit;
}

/**
 * The provenance projection walk (the frozen subset: not-an-object ->
 * caller-supplied-label -> shape-law-violation). THE NEVER-RE-DERIVE
 * LAW: a candidate carrying any field beyond the landed
 * InferenceProvenance shape is the typed caller-supplied-label
 * rejection FIRST; the landed admitProvenance is then the ONLY shape
 * authority (its own rejection cited verbatim in the detail). The
 * view's scope label is the landed record's own actual model field
 * carried VERBATIM. Zero clock reads. Deterministic: same candidate,
 * same verdict, same view bytes. Never mutates its input.
 */
function projectProvenanceCore(candidate: unknown): PresentationOutcome<ProvenanceView> {
	if (!isRecord(candidate)) {
		return refuse('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	if (!carriesOnlyFields(record, LANDED_PROVENANCE_FIELDS)) {
		return refuse(
			'caller-supplied-label',
			'the provenance candidate carries a field beyond the landed InferenceProvenance shape - a caller-supplied provenance, substitution, verification or scope label; the view\'s labels are DERIVED from the landed record, never supplied (the never-re-derive law)',
		);
	}
	const admission = admitProvenance(record);
	if (!admission.admitted) {
		return refuse(
			'shape-law-violation',
			`the provenance candidate must satisfy the landed admitProvenance: '${admission.reason}': ${admission.detail}`,
		);
	}
	const provenance = admission.provenance;
	const view: ProvenanceView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		verification: provenance.modelVerification,
		substitution: provenance.substitution,
		scopeLabel: provenance.actualModelId,
		requestedProviderId: provenance.requestedProviderId,
		requestedModelId: provenance.requestedModelId,
		actualProviderId: provenance.actualProviderId,
		actualModelId: provenance.actualModelId,
		recordedAtEpochMs: provenance.recordedAtEpochMs,
	};
	if (!isProvenanceView(view)) {
		throw new TypeError(
			'projectProvenance: the produced view must satisfy isProvenanceView (the kit and contract version copies must agree - the drift fails closed)',
		);
	}
	return { projected: true, view };
}

/**
 * The capacity projection walk (the frozen subset: not-an-object ->
 * caller-supplied-label -> shape-law-violation). The candidate must
 * satisfy the LANDED isProviderCapacityDisclosure (the landed
 * disclosure shape laws apply verbatim, never re-implemented); every
 * disclosed field is carried VERBATIM; the cooldown verdict is the
 * landed disclosed capacity state's own 'cooldown' membership (the
 * inclusive-boundary fold happened upstream through the landed
 * projection, never re-computed here); the nested provenance rides
 * the provenance walk (a label-bearing provenance sub-record is the
 * typed caller-supplied-label rejection too). Zero clock reads.
 */
function projectCapacityCore(candidate: unknown): PresentationOutcome<CapacityView> {
	if (!isRecord(candidate)) {
		return refuse('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	if (!carriesOnlyFields(record, LANDED_DISCLOSURE_FIELDS)) {
		return refuse(
			'caller-supplied-label',
			'the capacity disclosure candidate carries a field beyond the landed ProviderCapacityDisclosure shape - a caller-supplied label; the view\'s labels are DERIVED from the landed record, never supplied (the never-re-derive law)',
		);
	}
	if (!isProviderCapacityDisclosure(record)) {
		return refuse(
			'shape-law-violation',
			'the capacity disclosure candidate must satisfy the landed isProviderCapacityDisclosure - the landed disclosure shape laws apply verbatim, never re-implemented',
		);
	}
	const disclosure = record;
	const provenanceOutcome = projectProvenanceCore(disclosure.provenance);
	if (!provenanceOutcome.projected) {
		return provenanceOutcome;
	}
	const view: CapacityView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		providerId: disclosure.providerId,
		health: disclosure.health,
		verification: disclosure.verification,
		capacityState: disclosure.capacityState,
		cooldown: disclosure.capacityState === 'cooldown',
		quotaRemaining: disclosure.quotaRemaining,
		resetExpectation: disclosure.resetExpectation,
		provenance: provenanceOutcome.view,
		generatedAtEpochMs: disclosure.generatedAtEpochMs,
	};
	if (!isCapacityView(view)) {
		throw new TypeError(
			'projectCapacity: the produced view must satisfy isCapacityView (the kit and contract version copies must agree - the drift fails closed)',
		);
	}
	return { projected: true, view };
}

/**
 * The reset countdown fold: the PURE fold of (the landed
 * ResetSchedule, the injected probe). resetClass is the landed
 * schedule's own kind through the landed RESET_SCHEDULE_KINDS
 * membership (the honest 'unknown' class for a malformed or non-member
 * schedule - never a fabricated class); the expectation rides the
 * LANDED nextResetAt with its INCLUSIVE boundary law verbatim (a
 * probe exactly at a reset instant names that instant) and its
 * stale-reset law verbatim (a fixed-instant reset in the past
 * projects the honest 'unknown' EXPECTATION - never a fabricated
 * future); a known expectation's basis is the schedule's own class -
 * the landed projectCapacityDisclosure fold mirrored verbatim. Never
 * mutates its input; never re-implements boundary math.
 */
function projectResetCore(schedule: unknown, projectedAtEpochMs: number): ResetExpectationView {
	const resetClass = readResetClass(schedule);
	const nextReset = nextResetAt(schedule as ResetSchedule, projectedAtEpochMs);
	const expectation: ResetExpectation =
		typeof nextReset === 'number'
			? {
					kind: 'known',
					nextResetEpochMs: nextReset,
					basis: resetClass as 'fixed-instant' | 'interval-aligned',
				}
			: { kind: 'unknown' };
	const view: ResetExpectationView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		resetClass,
		expectation,
		projectedAtEpochMs,
	};
	if (!isResetExpectationView(view)) {
		throw new TypeError(
			'projectReset: the produced view must satisfy isResetExpectationView (the kit and contract version copies must agree - the drift fails closed)',
		);
	}
	return view;
}

/**
 * The unified decision projection walk (the frozen subset:
 * not-an-object -> unknown-decision-family -> caller-supplied-label
 * -> shape-law-violation -> unresolved-decision-record ->
 * unresolved-adapter-binding). The discrimination rides the landed
 * kind / shape discriminators (routing / matching / isolation, in the
 * frozen family order); a caller-supplied label is any field beyond
 * the discriminated landed shape (the refusal sides carry NO
 * provenance or substitution by landed law - nothing is fabricated);
 * the landed guards are the ONLY shape authority (the exhausted
 * outcome rides the landed RoutingExhausted shape mirror, its
 * vocabulary checks over the LANDED attempt lists); the binding
 * checks resolve every source binding against the bound records.
 * The view carries the selected side AND the refused side with the
 * landed typed reasons verbatim (THE NEVER-SILENT-EMPTY LAW). Zero
 * clock reads; never mutates its input.
 */
function projectDecisionCore(
	candidate: unknown,
	bound: BoundSurfaces,
): PresentationOutcome<DecisionView> {
	if (!isRecord(candidate)) {
		return refuse('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const hasKind = Object.prototype.hasOwnProperty.call(record, 'kind');
	const kind = record.kind;
	if (hasKind && kind === 'exhausted') {
		return projectRoutingExhausted(record, bound);
	}
	if (hasKind && (kind === 'matched' || kind === 'no-matching-candidate')) {
		return projectMatchingDecision(record, bound);
	}
	if (hasKind && (kind === 'decided' || kind === 'no-eligible-binding')) {
		return projectIsolationDecision(record, bound);
	}
	if (
		!hasKind
		&& Object.prototype.hasOwnProperty.call(record, 'selectionRule')
		&& Object.prototype.hasOwnProperty.call(record, 'disclosure')
	) {
		return projectRoutingDecision(record, bound);
	}
	return refuse(
		'unknown-decision-family',
		`the decision record discriminates to no landed decision family (routing / matching / isolation) - got kind '${String(kind)}' with no landed decision shape`,
	);
}

/** The routing-decision branch of the unified decision walk. */
function projectRoutingDecision(
	record: Record<string, unknown>,
	bound: BoundSurfaces,
): PresentationOutcome<DecisionView> {
	if (!carriesOnlyFields(record, LANDED_DECISION_FIELDS.routingDecision)) {
		return refuseCallerSuppliedLabel('routing decision');
	}
	if (!isRoutingDecision(record)) {
		return refuse(
			'shape-law-violation',
			'the routing decision candidate must satisfy the landed isRoutingDecision - the landed decision shape laws apply verbatim, never re-implemented',
		);
	}
	const decision = record;
	if (!bound.adaptersById.has(decision.adapterId)) {
		return refuse(
			'unresolved-adapter-binding',
			`the routing decision's adapterId '${decision.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const provenanceOutcome = projectProvenanceCore(decision.disclosure.provenance);
	if (!provenanceOutcome.projected) {
		return provenanceOutcome;
	}
	const view: DecisionView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'routing',
		side: 'selected',
		decidedAtEpochMs: decision.decidedAtEpochMs,
		adapterId: decision.adapterId,
		reasons: [decision.disclosure.capacityState],
		provenance: provenanceOutcome.view,
	};
	return finishDecisionView(view);
}

/** The routing-exhausted branch of the unified decision walk (the no-routable-candidate class). */
function projectRoutingExhausted(
	record: Record<string, unknown>,
	bound: BoundSurfaces,
): PresentationOutcome<DecisionView> {
	if (!carriesOnlyFields(record, LANDED_DECISION_FIELDS.routingExhausted)) {
		return refuseCallerSuppliedLabel('routing exhausted outcome');
	}
	if (!isRoutingExhaustedShape(record)) {
		return refuse(
			'shape-law-violation',
			'the routing exhausted outcome must satisfy the landed RoutingExhausted shape (the landed family exports no outcome guard; this mirror rides the landed attempt vocabularies verbatim - kind, the routing stamp, a finite instant, and well-formed ledger lines)',
		);
	}
	const outcome = record as unknown as RoutingExhausted;
	for (const entry of outcome.attemptLedger) {
		if (!bound.adaptersById.has(entry.adapterId)) {
			return refuse(
				'unresolved-adapter-binding',
				`the attempt ledger entry for adapter '${entry.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
			);
		}
	}
	// THE NEVER-SILENT-EMPTY LAW: the refused side carries the FULL
	// honest attempt ledger reasons verbatim in ledger order - honestly
	// empty exactly when the landed refusal honestly carried nothing (a
	// routing set with zero admitted candidates).
	const view: DecisionView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'routing',
		side: 'refused',
		decidedAtEpochMs: outcome.atEpochMs,
		adapterId: 'none',
		reasons: outcome.attemptLedger.map((entry) => entry.reason),
		provenance: 'none',
	};
	return finishDecisionView(view);
}

/** The matching branch of the unified decision walk (either side). */
function projectMatchingDecision(
	record: Record<string, unknown>,
	bound: BoundSurfaces,
): PresentationOutcome<DecisionView> {
	if (!carriesOnlyFields(record, record.kind === 'matched' ? LANDED_DECISION_FIELDS.matchingMatched : LANDED_DECISION_FIELDS.matchingNoMatch)) {
		return refuseCallerSuppliedLabel(record.kind === 'matched' ? 'matched decision' : 'no-matching-candidate decision');
	}
	if (!isMatchDecisionRecord(record)) {
		return refuse(
			'shape-law-violation',
			'the match decision candidate must satisfy the landed isMatchDecisionRecord - the landed decision shape laws apply verbatim, never re-implemented',
		);
	}
	const decision: MatchDecisionRecord = record;
	for (const row of decision.rows) {
		if (!bound.adaptersById.has(row.adapterId)) {
			return refuse(
				'unresolved-adapter-binding',
				`the verdict row for adapter '${row.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
			);
		}
	}
	if (decision.kind === 'no-matching-candidate') {
		// THE NEVER-SILENT-EMPTY LAW: the refused side carries every
		// verdict row's own verdict values verbatim in row order - the
		// honest-unknown rows ride the landed 'capability-unknown' verdict
		// member.
		const reasons: string[] = [];
		for (const row of decision.rows) {
			if (row.kind === 'unknown-descriptor') {
				reasons.push('capability-unknown');
			} else {
				reasons.push(row.contextWindowVerdict, row.modalityCoverageVerdict, row.outputCapVerdict);
			}
		}
		const view: DecisionView = {
			contractVersion: INFERENCE_PRESENTATION_VERSION,
			family: 'matching',
			side: 'refused',
			decidedAtEpochMs: decision.decidedAtEpochMs,
			adapterId: 'none',
			reasons,
			provenance: 'none',
		};
		return finishDecisionView(view);
	}
	if (!bound.adaptersById.has(decision.selected.adapterId)) {
		return refuse(
			'unresolved-adapter-binding',
			`the selected candidate's adapterId '${decision.selected.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const provenanceOutcome = projectProvenanceCore(decision.provenance);
	if (!provenanceOutcome.projected) {
		return provenanceOutcome;
	}
	const view: DecisionView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'matching',
		side: 'selected',
		decidedAtEpochMs: decision.decidedAtEpochMs,
		adapterId: decision.selected.adapterId,
		reasons: [decision.substitution],
		provenance: provenanceOutcome.view,
	};
	return finishDecisionView(view);
}

/** The isolation branch of the unified decision walk (either side). */
function projectIsolationDecision(
	record: Record<string, unknown>,
	bound: BoundSurfaces,
): PresentationOutcome<DecisionView> {
	const decided = record.kind === 'decided';
	if (!carriesOnlyFields(record, decided ? LANDED_DECISION_FIELDS.isolationDecided : LANDED_DECISION_FIELDS.isolationRefused)) {
		return refuseCallerSuppliedLabel(decided ? 'decided eligibility decision' : 'no-eligible-binding decision');
	}
	if (!isEligibilityDecisionRecord(record)) {
		return refuse(
			'shape-law-violation',
			'the eligibility decision candidate must satisfy the landed isEligibilityDecisionRecord - the landed decision shape laws apply verbatim, never re-implemented',
		);
	}
	const decision = record as EligibilityDecisionRecord;
	if (decision.kind === 'no-eligible-binding') {
		// THE NEVER-SILENT-EMPTY LAW: the EligibilityRefused-class
		// refusal projects to the "why nothing was eligible" view - the
		// landed record's own typed detail, verbatim.
		const view: DecisionView = {
			contractVersion: INFERENCE_PRESENTATION_VERSION,
			family: 'isolation',
			side: 'refused',
			decidedAtEpochMs: decision.decidedAtEpochMs,
			adapterId: 'none',
			reasons: [decision.detail],
			provenance: 'none',
		};
		return finishDecisionView(view);
	}
	const scope = bound.scopesById.get(decision.scopeId);
	if (scope === undefined) {
		return refuse(
			'unresolved-decision-record',
			`the eligibility decision's scopeId '${decision.scopeId}' resolves to no scope in the bound credential scope set - a dangling decision reference is a typed rejection, never a silent dangling ref`,
		);
	}
	if (scope.adapterId !== decision.adapterId) {
		return refuse(
			'unresolved-decision-record',
			`the bound scope '${decision.scopeId}' carries adapter binding '${scope.adapterId}' but the decision carries '${decision.adapterId}' - a cross-inconsistent decision reference is a typed rejection, never a silent dangling ref`,
		);
	}
	if (!bound.adaptersById.has(decision.adapterId)) {
		return refuse(
			'unresolved-adapter-binding',
			`the eligibility decision's adapterId '${decision.adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const provenanceOutcome = projectProvenanceCore(decision.provenance);
	if (!provenanceOutcome.projected) {
		return provenanceOutcome;
	}
	const view: DecisionView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'isolation',
		side: 'selected',
		decidedAtEpochMs: decision.decidedAtEpochMs,
		adapterId: decision.adapterId,
		reasons: [decision.verdict],
		provenance: provenanceOutcome.view,
	};
	return finishDecisionView(view);
}

/**
 * The ledger-line read walk (the frozen subset: shape-law-violation
 * -> unresolved-ledger-line -> malformed-ledger-line ->
 * unresolved-decision-record -> unresolved-adapter-binding). The path
 * and line-index input shapes first; then the ledger surface
 * resolution (an existing file; an in-range 1-based line index over
 * the non-empty lines - the trailing-newline artifact is not a line);
 * then THE CANONICAL-BYTES LAW: the line must parse as the LANDED
 * canonical bytes (the parsed record admits under a landed decision
 * guard AND round-trips byte-equal through the landed serializer -
 * the byte comparison IS the parse, cited, never re-derived); then
 * the decision projection walk's binding checks. Zero clock reads.
 */
function readLedgerCore(
	path: unknown,
	line: unknown,
	bound: BoundSurfaces,
): PresentationOutcome<LedgerLineView> {
	if (!isNonEmptyString(path) || !isPositiveLine(line)) {
		return refuse(
			'shape-law-violation',
			'the ledger path must be a non-empty string and the line a 1-based positive integer (the caller-injected ledger surface shape)',
		);
	}
	const stats = statSync(path, { throwIfNoEntry: false });
	if (stats === undefined || !stats.isFile()) {
		return refuse(
			'unresolved-ledger-line',
			`the ledger path '${path}' resolves to no ledger file - a dangling ledger reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const lines = readFileSync(path, 'utf8')
		.split('\n')
		.filter((entry) => entry.length > 0);
	if (line > lines.length) {
		return refuse(
			'unresolved-ledger-line',
			`the ledger at '${path}' carries ${lines.length} line(s); line ${line} is out of range - a dangling ledger line reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const outcome = parseLedgerLineCore(lines[line - 1], line, bound);
	if (outcome.projected) {
		return { projected: true, view: outcome.view };
	}
	return { projected: false, reason: outcome.reason, detail: outcome.detail };
}

/**
 * The one-line ledger fold: parse ONE line through the LANDED
 * canonical shape (the frozen family order routing -> matching ->
 * isolation), round-trip the landed serializer's own bytes, then the
 * decision projection walk. A malformed line is the typed
 * 'malformed-ledger-line' refusal outcome, never a silent drop - and
 * never a re-serialized stand-in.
 */
function parseLedgerLineCore(
	line: string,
	position: number,
	bound: BoundSurfaces,
): LedgerLineOutcome {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return {
			projected: false,
			line: position,
			reason: 'malformed-ledger-line',
			detail: `the ledger line ${position} is not parseable JSON bytes - a ledger line must be the landed canonical byte form, never a silent drop`,
		};
	}
	if (isRoutingDecision(parsed)) {
		if (serializeRoutingDecision(parsed) !== line) {
			return refuseMalformedLine(position, 'serializeRoutingDecision');
		}
		return ledgerLineOutcome(position, 'routing', line, projectDecisionCore(parsed, bound));
	}
	if (isMatchDecisionRecord(parsed)) {
		if (serializeMatchDecision(parsed) !== line) {
			return refuseMalformedLine(position, 'serializeMatchDecision');
		}
		return ledgerLineOutcome(position, 'matching', line, projectDecisionCore(parsed, bound));
	}
	if (isEligibilityDecisionRecord(parsed)) {
		if (serializeEligibilityDecision(parsed) !== line) {
			return refuseMalformedLine(position, 'serializeEligibilityDecision');
		}
		return ledgerLineOutcome(position, 'isolation', line, projectDecisionCore(parsed, bound));
	}
	return {
		projected: false,
		line: position,
		reason: 'malformed-ledger-line',
		detail: `the ledger line ${position} admits under no landed decision guard (isRoutingDecision / isMatchDecisionRecord / isEligibilityDecisionRecord) - a ledger line must be the landed canonical byte form, never a silent drop`,
	};
}

/** The bound-record surfaces the decision walk resolves against. */
interface BoundSurfaces {
	readonly adaptersById: ReadonlyMap<string, ProviderAdapterDescriptor>;
	readonly scopesById: ReadonlyMap<string, CredentialScopeDescriptor>;
}

/**
 * The routing exhausted shape mirror: the landed family exports no
 * outcome guard, so this check mirrors the landed RoutingExhausted
 * TYPE with its vocabulary checks riding the LANDED
 * ROUTING_ATTEMPT_OUTCOMES / ROUTING_ATTEMPT_REASONS lists verbatim
 * (the routing kit's cited-idiom binding - the shape is the landed
 * type's own, never a re-derived vocabulary). The kind was already
 * discriminated by the walk.
 */
function isRoutingExhaustedShape(value: Record<string, unknown>): boolean {
	if (value.contractVersion !== INFERENCE_ROUTING_VERSION) {
		return false;
	}
	if (!isFiniteEpochMs(value.atEpochMs)) {
		return false;
	}
	const ledger = value.attemptLedger;
	if (!Array.isArray(ledger)) {
		return false;
	}
	for (const entry of ledger) {
		if (!isRecord(entry)) {
			return false;
		}
		const attempt = entry as Record<string, unknown>;
		if (!isNonEmptyString(attempt.adapterId)) {
			return false;
		}
		if (!isFiniteEpochMs(attempt.atEpochMs)) {
			return false;
		}
		if (!(ROUTING_ATTEMPT_OUTCOMES as readonly string[]).includes(attempt.outcome as string)) {
			return false;
		}
		if (!(ROUTING_ATTEMPT_REASONS as readonly string[]).includes(attempt.reason as string)) {
			return false;
		}
	}
	return true;
}

/** The honest reset-class fold: the landed RESET_SCHEDULE_KINDS membership, 'unknown' otherwise (never a fabricated class). */
function readResetClass(schedule: unknown): ResetScheduleKind {
	if (!isRecord(schedule)) {
		return 'unknown';
	}
	const kind = (schedule as Record<string, unknown>).kind;
	if ((RESET_SCHEDULE_KINDS as readonly string[]).includes(kind as string)) {
		return kind as ResetScheduleKind;
	}
	return 'unknown';
}

/** The drift fail-closed self-check over the unified decision view. */
function finishDecisionView(view: DecisionView): PresentationOutcome<DecisionView> {
	if (!isDecisionView(view)) {
		throw new TypeError(
			'projectDecision: the produced view must satisfy isDecisionView (the kit and contract version copies must agree - the drift fails closed)',
		);
	}
	return { projected: true, view };
}

/** The ledger line outcome wrap with the drift fail-closed self-check. */
function ledgerLineOutcome(
	position: number,
	family: PresentationDecisionFamily,
	canonicalBytes: string,
	decisionOutcome: PresentationOutcome<DecisionView>,
): LedgerLineOutcome {
	if (!decisionOutcome.projected) {
		return {
			projected: false,
			line: position,
			reason: decisionOutcome.reason,
			detail: decisionOutcome.detail,
		};
	}
	const view: LedgerLineView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		line: position,
		family,
		canonicalBytes,
		decision: decisionOutcome.view,
	};
	if (!isLedgerLineView(view)) {
		throw new TypeError(
			'readLedger: the produced view must satisfy isLedgerLineView (the kit and contract version copies must agree - the drift fails closed)',
		);
	}
	return { projected: true, line: position, view };
}

/** The malformed-line refusal (the canonical-bytes law's round-trip miss). */
function refuseMalformedLine(position: number, serializer: string): LedgerLineRefused {
	return {
		projected: false,
		line: position,
		reason: 'malformed-ledger-line',
		detail: `the ledger line ${position} is not the landed canonical byte form - the round-trip through the landed ${serializer} differs from the line's own bytes (the canonical bytes are the parse, cited, never re-derived)`,
	};
}

/** The caller-supplied-label refusal (the never-re-derive law's own). */
function refuseCallerSuppliedLabel(shape: string): PresentationRefused {
	return refuse(
		'caller-supplied-label',
		`the ${shape} candidate carries a field beyond the landed canonical shape - a caller-supplied provenance, substitution, verification or scope label; the view's labels are DERIVED from the landed record, never supplied (the never-re-derive law)`,
	);
}

function refuse(reason: PresentationRejectionReason, detail: string): PresentationRefused {
	return { projected: false, reason, detail };
}

/** The sorted bound-id disclosure (the landed sorted-id fold idiom). */
function sortedIds(ids: IterableIterator<string>): string[] {
	return [...ids].sort((left, right) => {
		if (left < right) {
			return -1;
		}
		return left > right ? 1 : 0;
	});
}

/** The no-extra-own-fields check (the isolation family's no-extra-keys idiom, local copy). */
function carriesOnlyFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
	for (const key of Object.keys(record)) {
		if (!(fields as readonly string[]).includes(key)) {
			return false;
		}
	}
	return true;
}

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
