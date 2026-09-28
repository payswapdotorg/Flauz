/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Typed mirror of core/seamUsageMap.json - the machine-readable map of
 * which seam methods/events serve each Agent OS lifecycle phase today, and
 * which phases need an ADDITIVE protocol extension (TL2-S1 M1 artifact).
 *
 * CONSISTENCY LAW: the JSON artifact is the exchange format; this typed
 * mirror is the code-facing form. test/agentOsService.test.ts pins them
 * deep-equal, so the two can never drift apart silently. Data sections are
 * generated from the artifact (do not hand-edit the object literal).
 */

/** Seam protocol version strings (the frozen v0 + the additive v1). */
export type SeamProtocolVersionId = 'flauz.seam/v0' | 'flauz.seam/v1';

/** What serves a lifecycle phase today. */
export interface SeamUsageServedBy {
	methods: string[];
	events: string[];
	minProtocolVersion: SeamProtocolVersionId | null;
	v1Additions: string;
	v0Path: string;
}

/** A proposed (NOT implemented) additive protocol extension. */
export interface SeamUsageAdditiveExtension {
	status: 'proposed-not-implemented';
	proposed: string[];
	rationale: string;
}

/** One Agent OS lifecycle phase and its seam coverage. */
export interface SeamUsagePhase {
	phase: string;
	summary: string;
	servedBy: SeamUsageServedBy;
	agentOsStateSurface: string;
	gaps: string[];
	additiveExtension: SeamUsageAdditiveExtension | null;
}

/** The versioned usage-map artifact shape ('flauz.seam-usage-map/v1'). */
export interface SeamUsageMap {
	$schema: string;
	version: number;
	generatedFor: string;
	baseCommit: string;
	definitionModule: string;
	protocolVersions: {
		supported: SeamProtocolVersionId[];
		negotiation: string;
		v0IsFrozen: boolean;
	};
	phases: SeamUsagePhase[];
}

/** The typed usage map - deep-equal to core/seamUsageMap.json (pinned by test). */
export const SEAM_USAGE_MAP: SeamUsageMap = {
	'$schema': 'flauz.seam-usage-map/v1',
	'version': 1,
	'generatedFor': 'TL2-S1 service integration (durable Agent OS <-> TL1-003 service seam)',
	'baseCommit': 'ad22c450185d978cabe1f1bde253059d220ebc7f',
	'definitionModule': 'extensions/flauz-agent/core/protocol.mjs',
	'protocolVersions': {
		'supported': [
			'flauz.seam/v0',
			'flauz.seam/v1'
		],
		'negotiation': 'hello.protocolVersions -> highest mutually supported; absent/non-array -> v0; no overlap -> flauz.err.unsupported-version + exit 4',
		'v0IsFrozen': true
	},
	'phases': [
		{
			'phase': 'orchestrator-start',
			'summary': 'Bring the Agent OS runtime up against a workspace: spawn the real service, hello + version negotiation, capability affirmation, lifecycle initialize, initial state read.',
			'servedBy': {
				'methods': [
					'flauz.lifecycle.initialize',
					'flauz.health.status',
					'flauz.workspace.listTasks'
				],
				'events': [],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'flauz.lifecycle.initialize (idempotent bring-up affirmation with replay marker) and flauz.health.status (connectivity row facts)',
				'v0Path': 'hello handshake + flauz.workspace.listTasks as the initial state read; no lifecycle/health namespaces'
			},
			'agentOsStateSurface': '.flauz/tasks.json (read) + service session state',
			'gaps': [],
			'additiveExtension': null
		},
		{
			'phase': 'task-submit',
			'summary': 'Create the durable work item (flauz.tasks/v0 task envelope) the orchestration graph attaches to (graph records reference taskId).',
			'servedBy': {
				'methods': [
					'flauz.workspace.createTask'
				],
				'events': [
					'task-created'
				],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'none (v0 method; wire shape identical at v1)',
				'v0Path': 'identical'
			},
			'agentOsStateSurface': '.flauz/tasks.json',
			'gaps': [],
			'additiveExtension': null
		},
		{
			'phase': 'step-state',
			'summary': 'Record step lifecycle state. Two surfaces exist: the workspace task timeline (the 9-transition machine, human-gated) and the durable graph step rows (step-started/step-succeeded/step-failed/... in the orchestration journal).',
			'servedBy': {
				'methods': [
					'flauz.workspace.appendEvent',
					'flauz.workspace.getTask'
				],
				'events': [
					'task-event'
				],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'none (v0 methods)',
				'v0Path': 'identical'
			},
			'agentOsStateSurface': 'workspace: .flauz/tasks.json events; graph: .flauz/orchestration/journal.jsonl (store-side only today)',
			'gaps': [
				'durable graph step rows (14-field journal rows, idempotency keys, attempt discipline) have NO seam method: the orchestration store writes them directly; a remote/stateful Agent OS cannot drive step state through the seam'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'flauz.orch.appendStepRow (or a journal-append namespace)'
				],
				'rationale': 'the durable graph journal row shape is defined by core/orchestration.mjs (flauz.orch.journal/v1); exposing append+derive over the seam is the minimal additive surface for service-side orchestration (new negotiated version or v1 additions, per the versioning policy)'
			}
		},
		{
			'phase': 'approval-request',
			'summary': 'Human gate. Workspace surface: submit-plan (agent) moves plan->awaiting-approval; approve/request-changes (human) resolve it. Graph surface: approval-requested/approval-granted/approval-rejected journal rows (grants are human-actor-only by the transition table).',
			'servedBy': {
				'methods': [
					'flauz.workspace.appendEvent'
				],
				'events': [
					'task-event'
				],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'none (v0 method)',
				'v0Path': 'identical'
			},
			'agentOsStateSurface': 'workspace: task status machine; graph: approval rows in .flauz/orchestration/journal.jsonl',
			'gaps': [
				'graph-level approval rows have no seam method (same gap as step-state); the human-gate invariant is enforced store-side today'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'flauz.orch.appendApprovalRow (human-actor gate preserved by the transition table)'
				],
				'rationale': 'approval-granted must remain human-actor-only; an additive seam surface would reuse the same transition table, never a new gate implementation'
			}
		},
		{
			'phase': 'lease-op',
			'summary': 'Claims and leases on shared resources (claim/release, lease acquire/expire) with conflict semantics.',
			'servedBy': {
				'methods': [],
				'events': [],
				'minProtocolVersion': null,
				'v1Additions': 'none',
				'v0Path': 'none'
			},
			'agentOsStateSurface': '.flauz/orchestration/journal.jsonl (claim/lease rows, store-side only)',
			'gaps': [
				'NO seam method serves lease operations today; leases live only as orchestration journal rows written by the store; flauz.a2a resource-claim messages are NOTICES (no enforcement semantics)'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'flauz.orch.claim',
					'flauz.orch.leaseAcquire',
					'flauz.orch.leaseRelease'
				],
				'rationale': 'lease/claim conflict semantics (CONFLICT_VIOLATIONS claim|lease in core/orchestration.mjs) need a service boundary once more than one process can hold execution resources; single-writer v0 assumption documented in orchStore.mjs'
			}
		},
		{
			'phase': 'recovery-scan',
			'summary': 'Restart recovery. Served path (M3 adapter): service re-spawn + re-hello + state re-read (listTasks + verifyLedger + a2a.list) with lifecycle.initialize replay marker affirming the fresh session. The graph-level recovery pass (step-interrupted, lease-expired, cancel continuation) runs against the orchestration store.',
			'servedBy': {
				'methods': [
					'flauz.workspace.listTasks',
					'flauz.workspace.verifyLedger',
					'flauz.a2a.list',
					'flauz.lifecycle.initialize'
				],
				'events': [],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'flauz.lifecycle.initialize replay marker distinguishes a fresh session from a repeat call in the same session',
				'v0Path': 're-spawn + re-hello + listTasks/verifyLedger/a2a.list without the lifecycle affirmation'
			},
			'agentOsStateSurface': '.flauz/tasks.json + .flauz/evidence/ledger.jsonl + .flauz/a2a/ (all re-read over the seam); .flauz/orchestration/ (store-side)',
			'gaps': [
				'graph-level recoveryScan has no seam method; the orchestration recovery pass is invoked on the store in-process today'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'flauz.orch.recoveryScan'
				],
				'rationale': 'once the durable Agent OS runs as a service, the recovery pass itself must be drivable and observable through the seam; the row discipline (recovery-scan row per graph, never fabricating) already exists in core/recovery.mjs'
			}
		},
		{
			'phase': 'evidence-checkpoint-append',
			'summary': 'Append hash-chained evidence rows and create checkpoints for task state.',
			'servedBy': {
				'methods': [
					'flauz.workspace.appendEvidence',
					'flauz.workspace.createCheckpoint'
				],
				'events': [
					'evidence-row',
					'checkpoint'
				],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'none (v0 methods)',
				'v0Path': 'identical'
			},
			'agentOsStateSurface': '.flauz/evidence/ledger.jsonl + .flauz/tasks.json changes[]',
			'gaps': [],
			'additiveExtension': null
		},
		{
			'phase': 'ledger-verify',
			'summary': 'Verify the hash-chained evidence ledger integrity.',
			'servedBy': {
				'methods': [
					'flauz.workspace.verifyLedger'
				],
				'events': [],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'none (v0 method)',
				'v0Path': 'identical'
			},
			'agentOsStateSurface': '.flauz/evidence/ledger.jsonl',
			'gaps': [
				'the ORCHESTRATION journal chain (flauz.orch.journal/v1, one global hash chain across graphs) is verified by the store load path only; no seam method exposes journal verification'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'flauz.orch.verifyJournal'
				],
				'rationale': 'symmetry with flauz.workspace.verifyLedger for the durable graph journal; the strict-load discipline (torn tail vs corruption) already exists in core/orchStore.mjs'
			}
		},
		{
			'phase': 'a2a-post-collect',
			'summary': 'Agent-to-agent coordination: post typed messages, collect mailbox deliveries, list agents.',
			'servedBy': {
				'methods': [
					'flauz.a2a.post',
					'flauz.a2a.collect',
					'flauz.a2a.list'
				],
				'events': [
					'a2a-message'
				],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'none (v0 methods)',
				'v0Path': 'identical'
			},
			'agentOsStateSurface': '.flauz/a2a/messages.jsonl + cursors.json',
			'gaps': [
				'a2a bus rejections classify as flauz.err.internal on the wire (typed bus errors are a recorded TL2 follow-up in SERVICE-SEAM section 8)'
			],
			'additiveExtension': null
		},
		{
			'phase': 'health-watch',
			'summary': 'Service liveness and degradation watching (poll loop on the adapter).',
			'servedBy': {
				'methods': [
					'flauz.health.ping',
					'flauz.health.status',
					'ping'
				],
				'events': [],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'flauz.health.ping/status (uptimeMs, tasks, ledgerRows facts for degradation rows)',
				'v0Path': 'legacy bare ping (pong + ts only)'
			},
			'agentOsStateSurface': 'service session state (no workspace mutation)',
			'gaps': [],
			'additiveExtension': null
		},
		{
			'phase': 'shutdown',
			'summary': 'Graceful teardown: lifecycle shutdown (idempotent, batched repeats answered) or the v0 bare shutdown; both exit 0.',
			'servedBy': {
				'methods': [
					'flauz.lifecycle.shutdown',
					'shutdown'
				],
				'events': [],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'flauz.lifecycle.shutdown (idempotent; batched repeats all answered before the single exit)',
				'v0Path': 'bare shutdown (v0-carried exception, dispatchable pre-hello)'
			},
			'agentOsStateSurface': 'none (session termination)',
			'gaps': [],
			'additiveExtension': null
		},
		{
			'phase': 'auth-check',
			'summary': 'Authorization surface. SKELETON by design: every flauz.auth.* call answers flauz.err.not-implemented; the namespace is intentionally absent from the v1 capability advertisement.',
			'servedBy': {
				'methods': [
					'flauz.auth.status',
					'flauz.auth.login',
					'flauz.auth.logout'
				],
				'events': [],
				'minProtocolVersion': 'flauz.seam/v0',
				'v1Additions': 'structured flauz.err.not-implemented envelope (v0 answers the code-prefixed string projection)',
				'v0Path': 'dispatchable, always not-implemented'
			},
			'agentOsStateSurface': 'none (implements nothing)',
			'gaps': [
				'real auth semantics require a future additive protocol version with an explicit security review (SERVICE-SEAM section 4); the Agent OS boundary must not depend on flauz.auth.* for anything'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'auth semantics beyond the skeleton (future version + security review)'
				],
				'rationale': 'fail-closed skeleton posture is deliberate (ARCHITECTURE-LOCK section 3); no client surface is wrapped in seamClient.ts and the adapter locally refuses the unadvertised namespace under v1'
			}
		},
		{
			'phase': 'event-observation',
			'summary': 'Server-initiated event envelopes on stdout (v1) mirroring the v0 file relay (relay.jsonl); the adapter subscribes via onEvent and reports delivery gaps across reconnects.',
			'servedBy': {
				'methods': [],
				'events': [
					'task-created',
					'task-event',
					'evidence-row',
					'checkpoint',
					'a2a-message'
				],
				'minProtocolVersion': 'flauz.seam/v1',
				'v1Additions': 'wire event envelopes {type, event, payload, ts} (stable key order); emitted exactly when the v0 file relay fires',
				'v0Path': 'file-based relay.jsonl in extension globalStorage only (no wire events; v0 stdout carries ready/error/response lines only)'
			},
			'agentOsStateSurface': 'observational only (state lives in the workspace artifacts)',
			'gaps': [
				'no replay/backfill surface: events lost while the client is disconnected are gone on the wire (the adapter reports a gap marker; consumers re-read state)'
			],
			'additiveExtension': {
				'status': 'proposed-not-implemented',
				'proposed': [
					'flauz.events.since (cursor-based event replay from the relay journal)'
				],
				'rationale': 'a durable event cursor would let a reconnecting Agent OS close gaps without a full state re-read; additive event names only, consumers must ignore unknown names (already pinned)'
			}
		}
	]
};

/** All phase names, in artifact order. */
export const SEAM_USAGE_PHASES: readonly string[] = SEAM_USAGE_MAP.phases.map((phase) => phase.phase);

/** Look up one phase by name (undefined when absent). */
export function seamUsagePhaseOf(phase: string): SeamUsagePhase | undefined {
	return SEAM_USAGE_MAP.phases.find((candidate) => candidate.phase === phase);
}

/** Every seam method the map marks as serving some phase today. */
export function seamMethodsInUse(): string[] {
	const methods = new Set<string>();
	for (const phase of SEAM_USAGE_MAP.phases) {
		for (const method of phase.servedBy.methods) {
			methods.add(method);
		}
	}
	return [...methods].sort();
}
