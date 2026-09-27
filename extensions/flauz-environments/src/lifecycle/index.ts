/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — the environment lifecycle module (single import site).
 *
 *   - executor contract  : EnvironmentExecutor (typed ops + describe probe)
 *   - state machine      : registered -> created -> starting -> running <->
 *                          stopping -> stopped -> destroyed (+ failed, +
 *                          the /attached connection substate)
 *   - PIN-2 persistence  : .flauz/environments-lifecycle.json +
 *                          .flauz/environments-ops.jsonl (exact shapes; a
 *                          cross-worker contract — consumers read-only)
 *   - manager            : EnvironmentLifecycleManager (provenance law,
 *                          fail-closed trust gate, typed outcomes)
 *   - local-real         : LocalProcessExecutor (workspace-remote,
 *                          local-loopback posture; fixed harness only)
 *   - remote-simulated   : SimulatedRemoteExecutor (TEST INFRASTRUCTURE)
 */
export type { EnvironmentExecutor, ExecutorOpContext, ExecutorOpDetail } from './executor.ts';
export { EnvironmentLifecycleManager, type EnvironmentLifecycleManagerOptions, type LifecycleOpRequest } from './manager.ts';
export {
	LIFECYCLE_TRANSITIONS,
	canTransition,
	legalOpsFrom,
	successState,
	failureState,
	transitionFor,
	transitionRule,
	isLifecycleState,
	LIFECYCLE_STATES,
	type LifecycleTransitionRule,
} from './stateMachine.ts';
export {
	LifecycleStore,
	parseLifecycleEntry,
	parseLifecycleEnvelope,
	parseOpLine,
	parseOpRecord,
	serializeLifecycleEnvelope,
	serializeOpRecord,
} from './store.ts';
export {
	ATTACHED_STATES,
	ENVIRONMENT_OPS,
	EnvironmentLifecycleError,
	HEALTH_VERDICTS,
	LIFECYCLE_ERROR_CODES,
	LIFECYCLE_PATH,
	LIFECYCLE_PHASES,
	LIFECYCLE_SCHEMA_ID,
	LIFECYCLE_SCHEMA_VERSION,
	OPS_PATH,
	OPS_SCHEMA_ID,
	PROVENANCE_ACTORS,
	isAttachedState,
	isRunningState,
	phaseOf,
	type DescribeReport,
	type DescribeVerdict,
	type EnvironmentOpError,
	type EnvironmentOpName,
	type EnvironmentOpOutcome,
	type EnvironmentOpRecord,
	type ExecutorEffectResult,
	type HealthVerdict,
	type LifecycleEntry,
	type LifecycleEnvelope,
	type LifecycleErrorCode,
	type LifecyclePhase,
	type ProvenanceActor,
} from './types.ts';
export {
	LOCAL_PROCESS_EXECUTOR_KIND,
	LocalProcessExecutor,
	SNAPSHOT_MANIFEST_SCHEMA_ID,
	type ChildHandle,
	type HashPort,
	type LocalEnvFsPort,
	type LocalProcessExecutorOptions,
	type ProcessPort,
	type SnapshotManifest,
	type SnapshotManifestFile,
} from './localProcess.ts';
export {
	SimulatedRemoteExecutor,
	type SimFailureCue,
	type SimFsPort,
	type SimulatedRemoteExecutorOptions,
	type SimEnvState,
} from './simulated.ts';
