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
 *
 * TL3-004 rung 1 — the REAL remote providers behind the same contract:
 *   - cliPort            : CliPort/NodeCliPort (the process seam every real
 *                          remote executor goes through; the harness stdio
 *                          protocol parser) + HttpPort/SecretResolverPort
 *                          (the cloud seams).
 *   - ssh-cli            : SshCliExecutor (ssh-local over the system ssh;
 *                          fixed harness shipped over stdin; kill-only-owned).
 *   - docker-cli         : DockerCliExecutor (container over the system
 *                          docker; run/cp/exec of the fixed harness only).
 *   - cloud-http         : CloudHttpExecutor (E2B-style REST client over the
 *                          Flauz cloud-sandbox wire contract v0; vault-
 *                          gated apiKeyRef, never holds key material).
 */
export type { EnvironmentExecutor, ExecutorOpContext, ExecutorOpDetail } from './executor.ts';
export { EnvironmentLifecycleManager, type EnvironmentLifecycleManagerOptions, type LifecycleOpRequest } from './manager.ts';
export {
	PROVIDER_RETRY_AFTER_CAP_MS,
	PROVIDER_RETRY_ATTEMPT_PREFIX,
	PROVIDER_RETRY_FIXED_DELAY_MS,
	PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT,
	defaultRetryWait,
	formatProviderRetryAttemptMessage,
	isRetryableProviderStatus,
	parseProviderRetryAttemptMessage,
	providerRetryWaitMs,
	readProviderRetryHint,
	resolveRetryBound,
	type ProviderRetryAttemptFacts,
	type ProviderRetryOptions,
	type RetryWaitPort,
} from './providerRetry.ts';
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
	type ExecutorEffectError,
	type ExecutorEffectResult,
	type HealthVerdict,
	type LifecycleEntry,
	type LifecycleEnvelope,
	type LifecycleErrorCode,
	type LifecyclePhase,
	type ProviderRetryHint,
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
export {
	NodeCliPort,
	excerpt,
	parseHarnessStdio,
	type CliPort,
	type CliRunOptions,
	type CliRunResult,
} from './cliPort.ts';
export {
	SSH_CLI_EXECUTOR_KIND,
	SSH_SNAPSHOT_MANIFEST_SCHEMA_ID,
	SshCliExecutor,
	type SshCliExecutorOptions,
} from './sshCli.ts';
export {
	DOCKER_CLI_EXECUTOR_KIND,
	DOCKER_CONTAINER_STATE_DIR,
	DOCKER_SNAPSHOT_MANIFEST_SCHEMA_ID,
	DockerCliExecutor,
	type DockerCliExecutorOptions,
} from './dockerCli.ts';
export {
	CLOUD_HTTP_EXECUTOR_KIND,
	CLOUD_SNAPSHOT_DOC_SCHEMA_ID,
	CLOUD_SNAPSHOT_MANIFEST_SCHEMA_ID,
	CLOUD_TRACK_SCHEMA_ID,
	CloudHttpExecutor,
	nodeHttpPort,
	type CloudHttpExecutorOptions,
	type CloudTrackRecord,
	type HttpPort,
	type SecretResolverPort,
} from './cloudHttp.ts';
