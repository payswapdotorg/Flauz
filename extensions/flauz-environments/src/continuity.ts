/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Env-switch session-continuity model (N-8 / matrix C-34).
 *
 * The contract is RE-OPEN-BASED: live hand-off of a running session is not
 * built-in (PERFORMANCE-PLAN 5.5, citing N-8); a switch = persist Flauz state
 * -> re-open the workspace on the target environment's authority
 * (vscode.newWindow { remoteAuthority } -- the vscode-test-resolver blueprint
 * :396-403) -> re-hydrate what the native infra persists. This module is the
 * VERIFICATION STORY: the artifact classification (persists / re-hydrates /
 * lost), the switch state machine, the switch-plan document, and the
 * overhead-accounting hooks against the PERF 5.5 budgets.
 *
 * Tree citations (all @ flauz/main):
 *   - persists: `.flauz/tasks.json` + `.flauz/evidence/ledger.jsonl` +
 *     `.flauz/artifacts/` -- extensions/flauz-workspace/src/api.ts (ENVELOPE_PATH,
 *     LEDGER_PATH, EVIDENCE_DIR); `.flauz/environments.json` -- this lane.
 *   - re-hydrates: chat sessions -- src/vs/workbench/contrib/chat/common/
 *     chatSessionsService.ts:802-804 (IChatSessionsService); chat editing +
 *     checkpoints -- src/vs/workbench/contrib/chat/browser/chatEditing/
 *     (chatEditingSessionStorage.ts, chatEditingSessionCheckpointTimeline.ts);
 *     edit sessions -- src/vs/workbench/contrib/editSessions/; agent sessions +
 *     replay -- src/vs/platform/agentHost/common/ (sessionDatabase.ts,
 *     taskEventReplay.ts); persisted approvals -- AHP session-permission
 *     entries (SECURITY-MODEL 3.4).
 *   - lost (renderer-local): terminal scrollback (per-connection ptys),
 *     browser pane live CDP state, in-flight streaming chat turns, window
 *     layout, resolver sockets/tunnels.
 */
import type { EnvironmentDescriptor } from './api.ts';
import { buildConnectionPlan } from './providers/index.ts';

/** Schema identifier for emitted switch plans. */
export const SWITCH_PLAN_SCHEMA_ID = 'flauz.switchPlan/v0';

/** Continuity classification of a workspace-state surface. */
export type ContinuityClass = 'persists' | 'rehydrates' | 'lost';

export interface ContinuityArtifact {
	readonly id: string;
	readonly label: string;
	readonly continuityClass: ContinuityClass;
	readonly treeRef: string;
}

/** The canon -- every surface the v0 contract classifies. */
export const CONTINUITY_ARTIFACTS: readonly ContinuityArtifact[] = [
	{
		id: 'flauz-tasks-envelope',
		label: 'flauz.tasks/v0 task envelope (.flauz/tasks.json)',
		continuityClass: 'persists',
		treeRef: 'extensions/flauz-workspace/src/api.ts (ENVELOPE_PATH = .flauz/tasks.json; DL-9 git-diffable envelope)',
	},
	{
		id: 'flauz-evidence-ledger',
		label: 'hash-chained evidence ledger (.flauz/evidence/ledger.jsonl)',
		continuityClass: 'persists',
		treeRef: 'extensions/flauz-workspace/src/api.ts (LEDGER_PATH = .flauz/evidence/ledger.jsonl; DL-20 hash chain)',
	},
	{
		id: 'flauz-evidence-artifacts',
		label: 'evidence artifacts (.flauz/artifacts/<taskId>/)',
		continuityClass: 'persists',
		treeRef: 'extensions/flauz-workspace/src/api.ts (EVIDENCE_DIR / artifacts dir; DL-21 interpretation 5)',
	},
	{
		id: 'flauz-environments-registry',
		label: 'environment registry (.flauz/environments.json) -- this lane; the registry surviving the switch is what makes re-open continuity work',
		continuityClass: 'persists',
		treeRef: 'extensions/flauz-environments/src/registry.ts (flauz.environments/v0)',
	},
	{
		id: 'scm-working-tree',
		label: 'git working tree + branches (workspace-committed .flauz rides it)',
		continuityClass: 'persists',
		treeRef: 'src/vs/workbench/contrib/scm/ (async-collab substrate; ARCHITECTURE-MAPPING row 25)',
	},
	{
		id: 'chat-sessions',
		label: 'chat sessions (re-opened by the sessions infra on the target env)',
		continuityClass: 'rehydrates',
		treeRef: 'src/vs/workbench/contrib/chat/common/chatSessionsService.ts:802-804 (IChatSessionsService); src/vs/workbench/contrib/chat/browser/chatSessions/ (contrib)',
	},
	{
		id: 'chat-editing-checkpoints',
		label: 'chat editing sessions + checkpoint timeline',
		continuityClass: 'rehydrates',
		treeRef: 'src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSessionStorage.ts + chatEditingSessionCheckpointTimeline.ts (EV-02 section 8)',
	},
	{
		id: 'edit-sessions',
		label: 'edit sessions (working-copy continuation across machines/envs)',
		continuityClass: 'rehydrates',
		treeRef: 'src/vs/workbench/contrib/editSessions/ (matrix C-34: continuity = persisted sessions + editSessions + checkpoints)',
	},
	{
		id: 'agent-sessions',
		label: 'AHP agent sessions + task-event replay (server-side)',
		continuityClass: 'rehydrates',
		treeRef: 'src/vs/platform/agentHost/common/ (sessionDatabase.ts, taskEventReplay.ts; agentService.ts:66-72 RemoteProxy carries frames server-side)',
	},
	{
		id: 'flauz-task-state-machine',
		label: 'flauz task state machine (rehydrated from the persisted envelope)',
		continuityClass: 'rehydrates',
		treeRef: 'extensions/flauz-workspace/src/api.ts (TRANSITIONS -- the binding seam contract, DL-21)',
	},
	{
		id: 'persisted-approvals',
		label: 'persisted approvals (AHP session-permission entries with provenance + expiry)',
		continuityClass: 'rehydrates',
		treeRef: 'src/vs/platform/agentHost/common/ (session permission surfaces; SECURITY-MODEL 3.4)',
	},
	{
		id: 'terminal-scrollback',
		label: 'terminal scrollback + live ptys (per-connection; remote ptys do not follow the window)',
		continuityClass: 'lost',
		treeRef: 'src/vs/workbench/contrib/terminal/ (remote terminal backend per connection; PERF 5.4 pty path)',
	},
	{
		id: 'browser-pane-state',
		label: 'browser pane live CDP state (pages, DOM, sessions); screenshots persist only as evidence artifacts',
		continuityClass: 'lost',
		treeRef: 'src/vs/workbench/contrib/browserView/ (WebContentsView panes are renderer-local; PERF 5.3 remote-pane ladder governs re-attached panes)',
	},
	{
		id: 'inflight-chat-streams',
		label: 'in-flight streaming chat turns (unfinished requests do not survive the re-open)',
		continuityClass: 'lost',
		treeRef: 'src/vs/workbench/contrib/chat/ (streaming turn state is renderer+ext-host local; sessions persist only completed turns)',
	},
	{
		id: 'window-layout',
		label: 'window/editor layout, visible panes (machine-local workspace state)',
		continuityClass: 'lost',
		treeRef: 'src/vs/platform/storage/common/storage.ts (IStorageService machine-scoped state; Memento/globalState machine scope)',
	},
	{
		id: 'resolver-connection-state',
		label: 'resolver sockets/tunnels (connection state; re-established by resolve())',
		continuityClass: 'lost',
		treeRef: 'src/vscode-dts/vscode.proposed.resolvers.d.ts:383-389 (resolve re-invoked at startup + every disconnection)',
	},
];

const ARTIFACTS_BY_ID: ReadonlyMap<string, ContinuityArtifact> = new Map(CONTINUITY_ARTIFACTS.map(artifact => [artifact.id, artifact]));

export function artifactFor(id: string): ContinuityArtifact {
	const artifact = ARTIFACTS_BY_ID.get(id);
	if (artifact === undefined) {
		throw new Error(`${SWITCH_PLAN_SCHEMA_ID}: unknown continuity artifact '${id}' (not in the v0 canon)`);
	}
	return artifact;
}

/**
 * Classifies an observed workspace-state snapshot (fixture format:
 * `{ "surfaces": ["flauz-tasks-envelope", ...] }`). Unknown surface ids are
 * rejected -- the canon is closed so fixtures cannot silently under-cover.
 */
export interface ContinuitySnapshot {
	readonly surfaces: readonly string[];
}

export interface ContinuityReport {
	readonly persists: readonly ContinuityArtifact[];
	readonly rehydrates: readonly ContinuityArtifact[];
	readonly lost: readonly ContinuityArtifact[];
}

export function classifyWorkspaceState(snapshot: ContinuitySnapshot): ContinuityReport {
	const persists: ContinuityArtifact[] = [];
	const rehydrates: ContinuityArtifact[] = [];
	const lost: ContinuityArtifact[] = [];
	const seen = new Set<string>();
	for (const surface of snapshot.surfaces) {
		const artifact = artifactFor(surface);
		if (seen.has(artifact.id)) {
			throw new Error(`${SWITCH_PLAN_SCHEMA_ID}: duplicate surface '${artifact.id}' in snapshot`);
		}
		seen.add(artifact.id);
		if (artifact.continuityClass === 'persists') {
			persists.push(artifact);
		} else if (artifact.continuityClass === 'rehydrates') {
			rehydrates.push(artifact);
		} else {
			lost.push(artifact);
		}
	}
	return { persists, rehydrates, lost };
}

// ---------------------------------------------------------------------------
// Switch state machine (the choreography the orchestrator walks)
// ---------------------------------------------------------------------------

export const SWITCH_STATES = ['idle', 'persisting', 'persisted', 'reopening', 'reconnecting', 'rehydrating', 'active'] as const;
export type SwitchState = (typeof SWITCH_STATES)[number];

export const SWITCH_EVENT_TYPES = ['begin-switch', 'persist-complete', 'reopen', 'reconnect', 'resolver-ready', 'rehydrate-complete', 'fail'] as const;
export type SwitchEventType = (typeof SWITCH_EVENT_TYPES)[number];

export interface SwitchTransitionRule {
	readonly type: SwitchEventType;
	readonly from: readonly SwitchState[];
	readonly to: SwitchState;
}

/**
 * Legal transitions of the env-switch choreography. `fail` is legal from any
 * in-flight state (persisting..rehydrating) back to idle; `idle` and `active`
 * are the rest states. The re-open is the pivot: nothing between `persisted`
 * and `rehydrating` carries live session state (N-8).
 */
export const SWITCH_TRANSITIONS: readonly SwitchTransitionRule[] = [
	{ type: 'begin-switch', from: ['idle'], to: 'persisting' },
	{ type: 'persist-complete', from: ['persisting'], to: 'persisted' },
	{ type: 'reopen', from: ['persisted'], to: 'reopening' },
	{ type: 'reconnect', from: ['reopening'], to: 'reconnecting' },
	{ type: 'resolver-ready', from: ['reconnecting'], to: 'rehydrating' },
	{ type: 'rehydrate-complete', from: ['rehydrating'], to: 'active' },
	{ type: 'fail', from: ['persisting', 'persisted', 'reopening', 'reconnecting', 'rehydrating'], to: 'idle' },
];

export function transitionRule(type: SwitchEventType): SwitchTransitionRule | undefined {
	return SWITCH_TRANSITIONS.find(rule => rule.type === type);
}

export function canApplyEvent(state: SwitchState, type: SwitchEventType): boolean {
	const rule = transitionRule(type);
	return rule !== undefined && rule.from.includes(state);
}

export function applySwitchEvent(state: SwitchState, type: SwitchEventType): SwitchState {
	const rule = transitionRule(type);
	if (rule === undefined || !rule.from.includes(state)) {
		const legal = SWITCH_TRANSITIONS.filter(candidate => candidate.from.includes(state)).map(candidate => candidate.type);
		throw new Error(`${SWITCH_PLAN_SCHEMA_ID}: event '${type}' is illegal from state '${state}' (legal: ${legal.join(', ') || 'none'})`);
	}
	return rule.to;
}

// ---------------------------------------------------------------------------
// Overhead accounting (PERF 5.5 budgets) -- the verification hooks
// ---------------------------------------------------------------------------

/** PERF 5.5: warm switch (same machine, resolver cached) <= 1.5 s. */
export const WARM_SWITCH_BUDGET_MS = 1500;
/** PERF 5.5: Flauz choreography overhead <= 500 ms on top of container/resolver cold start. */
export const CHOREOGRAPHY_BUDGET_MS = 500;
/** Phase split of the choreography budget (persist + rehydrate = 500). */
export const PERSIST_PHASE_BUDGET_MS = 200;
export const REHYDRATE_PHASE_BUDGET_MS = 300;

/** Mark names (code/flauz/* pairs; DL-23 forwarding posture, PERF 6.3 mark-pair integrity). */
export const SWITCH_MARKS = {
	willPersist: 'code/flauz/willPersistEnvSwitch',
	didPersist: 'code/flauz/didPersistEnvSwitch',
	willRehydrate: 'code/flauz/willRehydrateEnvSwitch',
	didRehydrate: 'code/flauz/didRehydrateEnvSwitch',
} as const;

export type SwitchOverheadPhase = 'persist' | 'rehydrate' | 'warm-switch';

export interface OverheadVerdict {
	readonly phase: SwitchOverheadPhase;
	readonly elapsedMs: number;
	readonly budgetMs: number;
	readonly withinBudget: boolean;
	readonly markPair: readonly [string, string];
}

/** Checks an observed phase duration against the PERF 5.5 budget. */
export function checkOverhead(phase: SwitchOverheadPhase, elapsedMs: number): OverheadVerdict {
	const budgetMs = phase === 'persist'
		? PERSIST_PHASE_BUDGET_MS
		: phase === 'rehydrate'
			? REHYDRATE_PHASE_BUDGET_MS
			: WARM_SWITCH_BUDGET_MS;
	const markPair = phase === 'persist'
		? [SWITCH_MARKS.willPersist, SWITCH_MARKS.didPersist] as const
		: phase === 'rehydrate'
			? [SWITCH_MARKS.willRehydrate, SWITCH_MARKS.didRehydrate] as const
			: [SWITCH_MARKS.willPersist, SWITCH_MARKS.didRehydrate] as const;
	if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
		throw new Error(`${SWITCH_PLAN_SCHEMA_ID}: overhead accounting requires a non-negative finite elapsedMs (got ${JSON.stringify(elapsedMs)})`);
	}
	return { phase, elapsedMs, budgetMs, withinBudget: elapsedMs <= budgetMs, markPair };
}

// ---------------------------------------------------------------------------
// The switch plan document
// ---------------------------------------------------------------------------

export interface SwitchPlanPhase {
	readonly id: 'persist' | 'reopen' | 'reconnect' | 'rehydrate';
	readonly title: string;
	readonly budgetMs: number;
	readonly marks: readonly string[];
	readonly artifactIds: readonly string[];
	readonly treeRef: string;
}

export interface SwitchPlan {
	readonly $schema: string;
	readonly fromEnvironmentId: string | null;
	readonly toEnvironmentId: string;
	readonly toKind: string;
	readonly toAuthority: string;
	readonly mechanism: 're-open';
	readonly phases: readonly SwitchPlanPhase[];
	readonly budgets: {
		readonly warmSwitchMs: number;
		readonly choreographyMs: number;
	};
	readonly artifacts: {
		readonly persists: readonly string[];
		readonly rehydrates: readonly string[];
		readonly lost: readonly string[];
	};
	readonly notes: readonly string[];
}

/**
 * Plans a switch from `from` (null = local) to `to`. The plan chains the
 * target's connection plan (authority + resolver phases) behind the persist
 * choreography and carries the full artifact classification.
 */
export function planSwitch(from: EnvironmentDescriptor | null, to: EnvironmentDescriptor): SwitchPlan {
	const connectionPlan = buildConnectionPlan(to);
	const persists = CONTINUITY_ARTIFACTS.filter(a => a.continuityClass === 'persists').map(a => a.id);
	const rehydrates = CONTINUITY_ARTIFACTS.filter(a => a.continuityClass === 'rehydrates').map(a => a.id);
	const lost = CONTINUITY_ARTIFACTS.filter(a => a.continuityClass === 'lost').map(a => a.id);
	return {
		$schema: SWITCH_PLAN_SCHEMA_ID,
		fromEnvironmentId: from === null ? null : from.id,
		toEnvironmentId: to.id,
		toKind: to.kind,
		toAuthority: connectionPlan.authority,
		mechanism: 're-open',
		phases: [
			{
				id: 'persist',
				title: 'Persist Flauz workspace state (.flauz/ envelope, ledger, artifacts, registry)',
				budgetMs: PERSIST_PHASE_BUDGET_MS,
				marks: [SWITCH_MARKS.willPersist, SWITCH_MARKS.didPersist],
				artifactIds: persists,
				treeRef: 'extensions/flauz-workspace/src/taskService.ts (envelope persist, atomic tmp+rename); extensions/flauz-environments/src/registry.ts (registry persist)',
			},
			{
				id: 'reopen',
				title: `Re-open the workspace on authority ${connectionPlan.authority} (re-open-based continuity, N-8)`,
				budgetMs: 0,
				marks: [],
				artifactIds: ['resolver-connection-state'],
				treeRef: 'extensions/vscode-test-resolver/src/extension.ts:396-403 (vscode.newWindow { remoteAuthority }); src/vs/workbench/contrib/remote/browser/remoteIndicator.ts:132-133',
			},
			{
				id: 'reconnect',
				title: 'Resolver resolve() + connection establishment (target-env cold/warm start; not Flauz-budgeted)',
				budgetMs: 0,
				marks: ['code/flauz/willResolveEnv', 'code/flauz/didResolveEnv'],
				artifactIds: ['resolver-connection-state'],
				treeRef: 'src/vscode-dts/vscode.proposed.resolvers.d.ts:381-433 (resolver contract); connection plan steps (providers/)',
			},
			{
				id: 'rehydrate',
				title: 'Re-hydrate sessions/checkpoints/task state on the target environment',
				budgetMs: REHYDRATE_PHASE_BUDGET_MS,
				marks: [SWITCH_MARKS.willRehydrate, SWITCH_MARKS.didRehydrate],
				artifactIds: rehydrates,
				treeRef: 'src/vs/workbench/contrib/chat/common/chatSessionsService.ts:802-804; src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSessionStorage.ts; src/vs/workbench/contrib/editSessions/; src/vs/platform/agentHost/common/taskEventReplay.ts',
			},
		],
		budgets: { warmSwitchMs: WARM_SWITCH_BUDGET_MS, choreographyMs: CHOREOGRAPHY_BUDGET_MS },
		artifacts: { persists, rehydrates, lost },
		notes: [
			'N-8: live hand-off of a running session is not built-in -- the switch is re-open-based (PERF 5.5).',
			'renderer-local state (terminal scrollback, live browser panes, in-flight turns, window layout) is LOST by design; artifacts list them explicitly so UX can warn.',
			'overhead accounting: emit the code/flauz/* mark pairs at the phase boundaries; checkOverhead() verdicts feed the PERF 5.5 CI gates.',
		],
	};
}
