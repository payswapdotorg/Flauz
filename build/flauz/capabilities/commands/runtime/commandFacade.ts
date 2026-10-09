/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * CR-009 -- THE LIVE COMMAND-FACADE RUNTIME (Phase C-R, B2, wave 5).
 *
 * LAWS:
 * - BOUNDED OPTIMIZATION ONLY: the runtime adds NO new executor, NO cache
 *   engine, NO storage -- it is a typed routing/admission/receipt layer
 *   over the real authorities. Every side effect remains visible and
 *   provenance-bearing: the only durable writes it participates in are
 *   the approval-lane journal rows appended by the REAL OrchestrationStore
 *   (the CR-002 pattern), and every step receipt carries its
 *   SideEffectDisclosure. The compound registry and the mirror set are
 *   in-memory request/read-model state -- the sanctioned bounded
 *   optimization itself, never a second authority.
 * - THE CONTRACT IS THE COMPOSITION AUTHORITY: every table, guard and
 *   verdict rides the three frozen contract modules -- compound.ts
 *   (canAdmitCompound / isCompleteExecutionRecord / MAX_COMPOUND_STEPS),
 *   mirror.ts (canMirror / mirrorVerdict / invalidateMirror /
 *   DEFAULT_FRESHNESS_POLICY) and facade.ts (routeFor /
 *   buildFacadeReceipt / deriveFacadeReceiptsDigest) -- imported as
 *   namespaces with .ts specifiers (the B1 precedent law, so the suite
 *   runs directly under type stripping). This module never re-implements
 *   a frozen table it can call instead.
 * - FAIL-CLOSED TYPED: every refusal is a typed verdict naming the
 *   violated law (FACADE_REFUSAL_LAWS below); the authority truths are
 *   derived BEFORE the contract routing, and the contract's own typed
 *   rejections pass through verbatim (reason + detail). No silent
 *   successes, no partial effects after a refusal: a refused admission
 *   leaves every authority journal untouched.
 * - DETERMINISM BY INJECTION: the injected clock drives every timestamp;
 *   epoch-ms <-> ISO conversion is pure civil-calendar arithmetic. No
 *   Math.random, no Date.now, and no new Date(...) appear anywhere in
 *   this module (the law-comment greps in the suite pin this: matches
 *   live in comment lines only). Every persisted record carries
 *   contractVersion: COMMAND_FACADE_CONTRACTS_VERSION.
 *
 * THE REAL SEAMS this runtime binds (and nothing else):
 * - the CR-006 capability-exchange registry (registry.mjs): the READ
 *   surface the mirrors serve, the availability truth the routing inputs
 *   derive, and the JSONL journal whose position (load().seq) is the
 *   mirrors' freshness anchor. Every registry read rides a FRESH
 *   instance over the same root (the one-journal-many-instances
 *   semantics; the journal on disk is the truth), so a journal append
 *   through any instance is observed on the next read.
 * - the CR-008 verification + permission gate (gate.ts): the permission
 *   truth (gatePolicySummary). The gate holds ONE registry instance
 *   loaded at construction (the gate's own law 4.1, mirrored here at
 *   ensure() time); the runtime never mutates through the gate.
 * - the approval/step authority (extensions/flauz-agent/core/orchStore.mjs):
 *   the confirmation-gated routing target for compound steps carrying
 *   approvalRequirement 'confirmation' -- submitGraph + approveGraph +
 *   approvalRequest/approvalDecide with the frozen actor vocabulary
 *   (the request is agent-attributed, the decision human-only; the
 *   CR-002 actor vocabulary law). The approval lane's store tree lives
 *   under the runtime root's own .flauz/orchestration directory.
 */

import { createGate } from '../../gate/gate.ts';
import type { GateRuntime } from '../../gate/gate.ts';
import { createRegistry } from '../../registry/registry.mjs';
import type {
        FsPort,
        InspectResult,
        QueryResult,
        RegistryRuntime,
} from '../../registry/registry.mjs';
import { canonicalJSON, sha256Hex } from '../../registry/registry.mjs';
import { OrchestrationStore } from '../../../../../extensions/flauz-agent/core/orchStore.mjs';
import * as CompoundContract from '../common/compound.ts';
import * as MirrorContract from '../common/mirror.ts';
import * as FacadeContract from '../common/facade.ts';

// ---------------------------------------------------------------------------
// Runtime constants + the contract vocabulary re-exports
// ---------------------------------------------------------------------------

/** Version of the command-facade runtime (the CR-009 landing). */
export const COMMAND_FACADE_RUNTIME_VERSION = 'cr-009.1';

/** The artifact kind of the capability family this facade serves (the registry's own frozen vocabulary). */
const COMMANDS_ARTIFACT_KIND = 'commands';

export type FacadeScope = FacadeContract.FacadeScope;
export type CommandFacadeRequest = FacadeContract.CommandFacadeRequest;
export type FacadeRouting = FacadeContract.FacadeRouting;
export type FacadeReceipt = FacadeContract.FacadeReceipt;
export type CompoundCommand = CompoundContract.CompoundCommand;
export type CompoundAdmission = CompoundContract.CompoundAdmission;
export type CompoundExecutionRecord = CompoundContract.CompoundExecutionRecord;
export type ExecutionRecordCheck = CompoundContract.ExecutionRecordCheck;
export type LocalMirror = MirrorContract.LocalMirror;
export type MirrorInvalidation = MirrorContract.MirrorInvalidation;
export type MirrorVerdict = MirrorContract.MirrorVerdict;
export type AuthoritySurfaceRef = MirrorContract.AuthoritySurfaceRef;

// ---------------------------------------------------------------------------
// The typed error (constructor/binding misuse + authority transport failures)
// ---------------------------------------------------------------------------

export type CommandFacadeErrorCode =
        | 'INVALID-PARAMS'
        | 'DISPOSED'
        | 'NOT-BOUND'
        | 'REGISTRY-REFUSED'
        | 'APPROVAL-LANE-REFUSED';

export class CommandFacadeError extends Error {
        readonly code: CommandFacadeErrorCode;

        constructor(code: CommandFacadeErrorCode, message: string) {
                super(message);
                this.name = 'CommandFacadeError';
                this.code = code;
        }
}

// ---------------------------------------------------------------------------
// The typed refusal vocabulary (fail-closed; every refusal names one law)
// ---------------------------------------------------------------------------

/**
 * The runtime's closed violated-law vocabulary. The first six are the
 * runtime's own admission laws over the real authority truths; the last
 * four carry the contract's own typed rejections verbatim.
 */
export const FACADE_REFUSAL_LAWS = [
        'capability-unknown',
        'capability-unavailable',
        'gate-permission-denied',
        'mirror-invalidated',
        'registry-read-bridge-absent',
        'scope-mismatch',
        'contract-routing-refused',
        'compound-admission-refused',
        'mirror-admission-refused',
        'approval-lane-refused',
] as const;
export type FacadeRefusalLaw = (typeof FACADE_REFUSAL_LAWS)[number];

/** A typed refusal: the law names the violation; the contract's own records ride verbatim. */
export interface FacadeRefused {
        readonly refused: true;
        readonly law: FacadeRefusalLaw;
        readonly detail: string;
        /** The contract's own rejection reason when the refusal wraps one (verbatim). */
        readonly contractReason?: string;
        /** The registry entry the refusal names (capability-truth refusals). */
        readonly entryId?: string;
        /** The registry state the refusal observed (capability-truth refusals). */
        readonly state?: string;
        /** The typed invalidation receipt (mirror-invalidated refusals). */
        readonly invalidation?: MirrorInvalidation;
}

function refused(
        law: FacadeRefusalLaw,
        detail: string,
        extras?: {
                contractReason?: string;
                entryId?: string;
                state?: string;
                invalidation?: MirrorInvalidation;
        },
): FacadeRefused {
        return {
                refused: true,
                law,
                detail,
                ...(extras?.contractReason !== undefined ? { contractReason: extras.contractReason } : {}),
                ...(extras?.entryId !== undefined ? { entryId: extras.entryId } : {}),
                ...(extras?.state !== undefined ? { state: extras.state } : {}),
                ...(extras?.invalidation !== undefined ? { invalidation: extras.invalidation } : {}),
        };
}

// ---------------------------------------------------------------------------
// The registry read bridge (the frozen, disclosed table)
// ---------------------------------------------------------------------------

/**
 * THE REGISTRY READ BRIDGE: the frozen table mapping the contract's
 * mirrorable surface kinds onto the registry's read surface. RATIONALE:
 * surfaceKind 'artifact' (a member of the frozen mirrorable table, the
 * immutable-artifact class named by the SEAM(MIRRORABLE_SURFACES)
 * transcription) maps the registry entry's IMMUTABLE imported-artifact
 * view (inspect(entryId): entryId + contentHash + imported) -- immutable
 * by the registry's own drift law (a new version lands a fresh lineage
 * entry, never an in-place mutation), which is exactly what a safe local
 * mirror projects. The other mirrorable kinds (task / evidence /
 * workflow) name Resource-authority surfaces the registry does not
 * serve: the runtime refuses them typedly with this law named (the
 * honest-gap discipline), never silently and never by inventing a read.
 */
export interface RegistryReadBridgeRow {
        readonly surfaceKind: string;
        readonly readKind: 'imported-artifact-view';
        readonly rationale: string;
}

export const REGISTRY_READ_BRIDGE: readonly RegistryReadBridgeRow[] = [
        {
                surfaceKind: 'artifact',
                readKind: 'imported-artifact-view',
                rationale:
                        "surfaceKind 'artifact' (the frozen mirrorable table's immutable-artifact class) projects the registry entry's imported-artifact view (inspect: entryId + contentHash + imported) -- immutable by the registry's own drift law; the read rides the registry's inspect surface",
        },
];

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/** A routed request: the contract's routing verdict + the facade receipt. */
export interface FacadeRouted {
        readonly routed: true;
        readonly routing: FacadeRouting;
        readonly receipt: FacadeReceipt;
}

export type FacadeRouteOutcome = FacadeRouted | FacadeRefused;

/** A provenance-bearing projection of one approval-lane journal row (the store's own digests ride verbatim). */
export interface ApprovalLaneRow {
        readonly seq: number;
        readonly rowId: string;
        readonly type: string;
        readonly actor: string;
        readonly contentHash: string;
}

export interface ApprovalLaneRecord {
        readonly graphId: string;
        readonly rows: readonly ApprovalLaneRow[];
}

/** An executed compound: the routing verdict, the provenance-bearing trail, the receipt, the lane rows. */
export interface FacadeExecuted {
        readonly executed: true;
        readonly routing: FacadeContract.CompoundRouting;
        readonly executionRecord: CompoundExecutionRecord;
        readonly trailCheck: ExecutionRecordCheck;
        readonly receipt: FacadeReceipt;
        readonly approvalLane: ApprovalLaneRecord;
}

export type FacadeExecutionOutcome = FacadeExecuted | FacadeRefused;

/** A captured mirror: the LocalMirror record + its journal-position anchor + the served read's digest. */
export interface MirrorCaptured {
        readonly captured: true;
        readonly mirror: LocalMirror;
        /** The registry journal position at capture (the freshness anchor). */
        readonly anchorSeq: number;
        /** Digest over the served registry read (the authority digest format). */
        readonly readDigest: string;
}

export type MirrorCaptureOutcome = MirrorCaptured | FacadeRefused;

/** The human decisions injected into a compound execution (stepId -> granted | denied); the runtime never decides. */
export type ApprovalDecisions = Readonly<Record<string, 'granted' | 'denied'>>;

export interface CommandFacadeRuntimeOptions {
        /** The runtime root: hosts the registry journal, the gate records (.flauz/gate) and the approval lane's store tree (.flauz/orchestration). */
        readonly root: string;
        /** The fs port for the registry + gate (defaults to a node-backed port). */
        readonly fs?: FsPort;
        /** The injected clock: drives every timestamp; REQUIRED (the runtime never reads a wall clock). */
        readonly clock: () => number;
        /** The isolation scope (the registry scope; the gate's own option shape). */
        readonly scope: FacadeScope;
}

// ---------------------------------------------------------------------------
// Pure epoch-ms <-> ISO conversion (civil-calendar arithmetic; no calendar
// object is constructed anywhere in this module -- the memoryRuntime law)
// ---------------------------------------------------------------------------

function pad2(value: number): string {
        return value < 10 ? `0${String(value)}` : String(value);
}

function pad4(value: number): string {
        const text = String(value);
        return text.length >= 4 ? text : '0'.repeat(4 - text.length) + text;
}

/** Pure epoch-ms -> ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ, second precision -- the contract set's timestamp shape). */
export function epochMsToIsoUtc(epochMs: number): string {
        const secondsTotal = Math.floor(epochMs / 1000);
        const days = Math.floor(secondsTotal / 86400);
        let secondsOfDay = secondsTotal - days * 86400;
        const hours = Math.floor(secondsOfDay / 3600);
        secondsOfDay -= hours * 3600;
        const minutes = Math.floor(secondsOfDay / 60);
        const seconds = secondsOfDay - minutes * 60;
        const z = days + 719468;
        const era = Math.floor(z / 146097);
        const dayOfEra = z - era * 146097;
        const yearOfEra = Math.floor(
                (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
        );
        const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
        const monthPattern = Math.floor((5 * dayOfYear + 2) / 153);
        const day = dayOfYear - Math.floor((153 * monthPattern + 2) / 5) + 1;
        const month = monthPattern < 10 ? monthPattern + 3 : monthPattern - 9;
        let year = yearOfEra + era * 400;
        if (month <= 2) {
                year += 1;
        }
        return `${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}Z`;
}

const ISO_PARSE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

function daysFromCivil(year: number, month: number, day: number): number {
        let y = year;
        y -= month <= 2 ? 1 : 0;
        const era = Math.floor(y / 400);
        const yoe = y - era * 400;
        const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
        const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
        return era * 146097 + doe - 719468;
}

/** Pure ISO-8601 UTC -> epoch-ms (NaN for unparseable stamps; callers fail closed on NaN). */
export function isoToEpochMs(iso: string): number {
        const match = ISO_PARSE_PATTERN.exec(iso);
        if (match === null) {
                return Number.NaN;
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hours = Number(match[4]);
        const minutes = Number(match[5]);
        const seconds = Number(match[6]);
        if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) {
                return Number.NaN;
        }
        const secondsOfDay = hours * 3600 + minutes * 60 + seconds;
        const millis = match[7] === undefined ? 0 : Number(match[7]);
        return (daysFromCivil(year, month, day) * 86400 + secondsOfDay) * 1000 + millis;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
        return typeof value === 'string' && value.length > 0;
}

function describeError(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
}

/** A snapshot of the registry read through a FRESH instance (the journal is the truth). */
interface RegistrySnapshot {
        readonly runtime: RegistryRuntime;
        readonly seq: number;
}

/** Projects one store journal row onto the lane-row shape. */
function laneRowOf(row: { seq: number; rowId: string; type: string; actor: string; contentHash: string }): ApprovalLaneRow {
        return { seq: row.seq, rowId: row.rowId, type: row.type, actor: row.actor, contentHash: row.contentHash };
}

/** The default node-backed fs port (the registry's FsPort shape; the observatory runtime's discipline, restated). */
function nodeFsPort(): FsPort {
        return {
                readFile: async (path: string, encoding: 'utf8'): Promise<string> => {
                        const { readFile } = await import('node:fs/promises');
                        return readFile(path, encoding);
                },
                writeFile: async (path: string, text: string): Promise<void> => {
                        const { writeFile } = await import('node:fs/promises');
                        await writeFile(path, text);
                },
                appendFile: async (path: string, text: string): Promise<void> => {
                        const { appendFile } = await import('node:fs/promises');
                        await appendFile(path, text);
                },
                mkdir: async (path: string, options: { recursive: boolean }): Promise<void> => {
                        const { mkdir } = await import('node:fs/promises');
                        await mkdir(path, options);
                },
                readdir: async (path: string): Promise<string[]> => {
                        const { readdir } = await import('node:fs/promises');
                        return readdir(path);
                },
        };
}

// ---------------------------------------------------------------------------
// THE RUNTIME
// ---------------------------------------------------------------------------

export class CommandFacadeRuntime {
        readonly root: string;
        readonly scope: FacadeScope;

        private readonly fs: FsPort;
        private readonly clock: () => number;
        private readonly compounds: CompoundCommand[] = [];
        private readonly mirrors: LocalMirror[] = [];
        private readonly anchors = new Map<string, number>();
        private gate: GateRuntime | undefined;
        private store: OrchestrationStore | undefined;
        private ensured = false;
        private disposed = false;

        constructor(options: CommandFacadeRuntimeOptions) {
                if (!isRecord(options)) {
                        throw new CommandFacadeError('INVALID-PARAMS', 'CommandFacadeRuntime: options {root, fs?, clock, scope} are required');
                }
                if (!isNonEmptyString(options.root)) {
                        throw new CommandFacadeError('INVALID-PARAMS', 'CommandFacadeRuntime: a non-empty runtime root is required');
                }
                if (typeof options.clock !== 'function') {
                        throw new CommandFacadeError('INVALID-PARAMS', 'CommandFacadeRuntime: an injected clock (() => epoch-ms number) is required: the runtime never reads a wall clock');
                }
                if (options.fs !== undefined && !isRecord(options.fs)) {
                        throw new CommandFacadeError('INVALID-PARAMS', 'CommandFacadeRuntime: the fs port must implement the registry FsPort {readFile, writeFile, appendFile, mkdir, readdir}');
                }
                if (!FacadeContract.isFacadeScope(options.scope)) {
                        throw new CommandFacadeError('INVALID-PARAMS', 'CommandFacadeRuntime: the scope must be {workspaceId, tenantId} with non-empty strings (isFacadeScope)');
                }
                this.root = options.root.replace(/\/+$/, '');
                this.scope = { workspaceId: options.scope.workspaceId, tenantId: options.scope.tenantId };
                this.fs = options.fs ?? nodeFsPort();
                this.clock = options.clock;
        }

        // ---------------------------------------------------------------------------
        // Binding + lifecycle
        // ---------------------------------------------------------------------------

        /**
         * Binds the real authorities: the permission gate (createGate: the
         * registry journal + the gate records under root/.flauz/gate replayed
         * once -- the gate's own law 4.1) and the approval lane's
         * OrchestrationStore over the same root. Idempotent.
         */
        async ensure(): Promise<void> {
                this.assertLive();
                if (this.ensured) {
                        return;
                }
                this.gate = await createGate({
                        root: this.root,
                        clock: this.clock,
                        fsPort: this.fs,
                        scope: { workspaceId: this.scope.workspaceId, tenantId: this.scope.tenantId },
                });
                this.store = new OrchestrationStore(this.root, { clock: this.clock });
                this.store.load();
                this.ensured = true;
        }

        dispose(): void {
                this.disposed = true;
        }

        private assertLive(): void {
                if (this.disposed) {
                        throw new CommandFacadeError('DISPOSED', 'the command-facade runtime has been disposed');
                }
        }

        private async ensureReady(): Promise<void> {
                await this.ensure();
        }

        private requireGate(): GateRuntime {
                if (this.gate === undefined) {
                        throw new CommandFacadeError('NOT-BOUND', 'the runtime is not bound: call ensure() first');
                }
                return this.gate;
        }

        private requireStore(): OrchestrationStore {
                if (this.store === undefined) {
                        throw new CommandFacadeError('NOT-BOUND', 'the runtime is not bound: call ensure() first');
                }
                return this.store;
        }

        /**
         * A FRESH registry instance over the same root, loaded (the journal
         * on disk is the truth; the one-journal-many-instances semantics).
         * Every registry read rides a snapshot taken per public operation,
         * so a journal append through ANY instance is observed here.
         */
        private async registrySnapshot(): Promise<RegistrySnapshot> {
                const runtime = createRegistry({
                        root: this.root,
                        clock: this.clock,
                        fsPort: this.fs,
                        scope: { workspaceId: this.scope.workspaceId, tenantId: this.scope.tenantId },
                });
                const loaded = await runtime.load();
                if (!loaded.ok) {
                        throw new CommandFacadeError(
                                'REGISTRY-REFUSED',
                                `the registry refused to load: ${loaded.refusal.code}: ${loaded.refusal.detail ?? loaded.refusal.law}`,
                        );
                }
                return { runtime, seq: loaded.seq };
        }

        // ---------------------------------------------------------------------------
        // The capability truth (the routing inputs derived from the real authorities)
        // ---------------------------------------------------------------------------

        /**
         * THE AVAILABILITY + PERMISSION TRUTH for the commands capability
         * family: the artifactKind='commands' entries of the exchange. A
         * tool-touching request (compound | direct-tool) routes only over a
         * capability that is BOTH gate-cleared (the gate's approval record --
         * the permission truth) and available (the registry's projected
         * availability state). Refusal priority is fail-closed and names the
         * first violated law: no capability at all -> capability-unknown; a
         * capability exists but none carries a gate approval ->
         * gate-permission-denied; an approved capability exists but none is
         * available -> capability-unavailable.
         */
        private async commandsCapabilityTruth(
                snapshot: RegistrySnapshot,
        ): Promise<FacadeRefused | { ok: true; entryId: string; state: string }> {
                const queried: QueryResult = await snapshot.runtime.query({ artifactKind: COMMANDS_ARTIFACT_KIND });
                if (!queried.ok) {
                        throw new CommandFacadeError(
                                'REGISTRY-REFUSED',
                                `the registry refused the commands-capability query: ${queried.refusal.code}: ${queried.refusal.detail ?? queried.refusal.law}`,
                        );
                }
                if (queried.count === 0) {
                        return refused(
                                'capability-unknown',
                                `no ${COMMANDS_ARTIFACT_KIND} capability is registered in the exchange; the facade routes tool-touching requests only over an available, gate-cleared ${COMMANDS_ARTIFACT_KIND} capability (fail closed)`,
                        );
                }
                const gate = this.requireGate();
                let approvedExists = false;
                let approvedButUnavailable: { entryId: string; state: string } | undefined;
                for (const summary of queried.entries) {
                        const policy = await gate.gatePolicySummary(summary.entryId);
                        if (policy.approval !== null) {
                                approvedExists = true;
                                if (summary.state === 'available') {
                                        return { ok: true, entryId: summary.entryId, state: summary.state };
                                }
                                if (approvedButUnavailable === undefined) {
                                        approvedButUnavailable = { entryId: summary.entryId, state: summary.state };
                                }
                        }
                }
                if (!approvedExists) {
                        return refused(
                                'gate-permission-denied',
                                `every ${COMMANDS_ARTIFACT_KIND} capability in the exchange lacks a gate permission approval (the gate's own policy summary shows approval null); a request may never silently escape the permission gate`,
                        );
                }
                const named = approvedButUnavailable ?? { entryId: queried.entries[0]!.entryId, state: queried.entries[0]!.state };
                const states = queried.entries.map((entry) => `${entry.entryId}:${entry.state}`).sort().join(', ');
                return refused(
                        'capability-unavailable',
                        `an approved ${COMMANDS_ARTIFACT_KIND} capability exists but none is in the available state (registry truth: ${states}); routing waits for the availability projection`,
                        { entryId: named.entryId, state: named.state },
                );
        }

        /**
         * The same truth for ONE named entry (the mirrored-read lane: the
         * capability whose artifact surface the mirror projects).
         */
        private async entryTruth(
                snapshot: RegistrySnapshot,
                entryId: string,
        ): Promise<FacadeRefused | { ok: true; entryId: string; state: string }> {
                const inspected: InspectResult = await snapshot.runtime.inspect(entryId);
                if (!inspected.ok) {
                        return refused(
                                'capability-unknown',
                                `the registry does not know entry '${entryId}' (${inspected.refusal.code}: ${inspected.refusal.detail ?? inspected.refusal.law})`,
                                { entryId },
                        );
                }
                const gate = this.requireGate();
                const policy = await gate.gatePolicySummary(entryId);
                if (policy.approval === null) {
                        return refused(
                                'gate-permission-denied',
                                `entry '${entryId}' carries no gate permission approval (the gate's own policy summary shows approval null); a mirrored read of its artifact may never silently escape the permission gate`,
                                { entryId, state: inspected.entry.state },
                        );
                }
                if (inspected.entry.state !== 'available') {
                        return refused(
                                'capability-unavailable',
                                `entry '${entryId}' is in state '${inspected.entry.state}' (the registry's availability projection); a mirrored read of its artifact surface waits for availability`,
                                { entryId, state: inspected.entry.state },
                        );
                }
                return { ok: true, entryId, state: inspected.entry.state };
        }

        // ---------------------------------------------------------------------------
        // The compound registry (the runtime's own in-memory request model)
        // ---------------------------------------------------------------------------

        /**
         * Registers a compound command: the contract's pure admission guard
         * (canAdmitCompound over the real step shapes, MAX_COMPOUND_STEPS
         * enforced) gates the registry. A refused admission is the contract's
         * typed rejection, carried verbatim; nothing is stored.
         */
        registerCompound(command: CompoundCommand): CompoundAdmission {
                this.assertLive();
                const admission = CompoundContract.canAdmitCompound(command);
                if (!admission.admitted) {
                        return admission;
                }
                const existing = this.compounds.findIndex((candidate) => candidate.commandId === command.commandId);
                if (existing >= 0) {
                        this.compounds.splice(existing, 1);
                }
                this.compounds.push(command);
                return admission;
        }

        /** The registered compounds (the contract's routeFor registry argument). */
        registeredCompounds(): readonly CompoundCommand[] {
                this.assertLive();
                return [...this.compounds];
        }

        // ---------------------------------------------------------------------------
        // The mirror lane (capture over the registry's read surface)
        // ---------------------------------------------------------------------------

        /**
         * Captures a safe local mirror over the registry's read surface: the
         * contract's canMirror guard (the frozen mirrorable-surface table)
         * plus this runtime's disclosed REGISTRY_READ_BRIDGE select the read;
         * the entry's capability truth (gate permission + registry
         * availability) is derived BEFORE any capture; the mirror is anchored
         * at the registry journal position (load().seq -- the freshness
         * anchor; a later journal append is source-digest drift).
         */
        async captureMirror(surfaceRef: AuthoritySurfaceRef): Promise<MirrorCaptureOutcome> {
                this.assertLive();
                await this.ensureReady();
                const mirrorable = MirrorContract.canMirror(surfaceRef);
                if (!mirrorable.mirrorable) {
                        return refused('mirror-admission-refused', mirrorable.detail, { contractReason: mirrorable.reason });
                }
                const bridgeRow = REGISTRY_READ_BRIDGE.find((row) => row.surfaceKind === surfaceRef.surfaceKind);
                if (bridgeRow === undefined) {
                        return refused(
                                'registry-read-bridge-absent',
                                `surfaceKind '${surfaceRef.surfaceKind}' resolves in the frozen mirrorable table but the registry serves no such read (REGISTRY_READ_BRIDGE covers: ${REGISTRY_READ_BRIDGE.map((row) => row.surfaceKind).join(', ')}); the honest gap is disclosed, never bridged by invention`,
                        );
                }
                const snapshot = await this.registrySnapshot();
                const truth = await this.entryTruth(snapshot, surfaceRef.resourceId);
                if ('refused' in truth) {
                        return truth;
                }
                const read = await this.readBridgedSurface(snapshot, surfaceRef);
                const contentBytes = canonicalJSON(read);
                const contentDigest = sha256Hex(contentBytes);
                const mirrorId = `m-${sha256Hex(
                        canonicalJSON({
                                surfaceKind: surfaceRef.surfaceKind,
                                resourceId: surfaceRef.resourceId,
                                anchorSeq: snapshot.seq,
                                contentDigest,
                        }),
                )}`;
                const mirror: LocalMirror = {
                        scope: this.scope,
                        contractVersion: FacadeContract.COMMAND_FACADE_CONTRACTS_VERSION,
                        mirrorId,
                        surfaceRef: { surfaceKind: surfaceRef.surfaceKind, resourceId: surfaceRef.resourceId },
                        contentDigest,
                        byteSize: Buffer.byteLength(contentBytes, 'utf8'),
                        mirroredAtIso: epochMsToIsoUtc(this.clock()),
                        freshnessPolicy: MirrorContract.DEFAULT_FRESHNESS_POLICY,
                };
                const existing = this.mirrors.findIndex((candidate) => candidate.mirrorId === mirrorId);
                if (existing >= 0) {
                        this.mirrors.splice(existing, 1);
                }
                this.mirrors.push(mirror);
                this.anchors.set(mirrorId, snapshot.seq);
                return { captured: true, mirror, anchorSeq: snapshot.seq, readDigest: contentDigest };
        }

        /** The registered mirrors (the contract's routeFor registry argument). */
        registeredMirrors(): readonly LocalMirror[] {
                this.assertLive();
                return [...this.mirrors];
        }

        /** The bridged registry read (the imported-artifact view: the immutable read-only projection). */
        private async readBridgedSurface(
                snapshot: RegistrySnapshot,
                surfaceRef: AuthoritySurfaceRef,
        ): Promise<Record<string, unknown>> {
                const inspected: InspectResult = await snapshot.runtime.inspect(surfaceRef.resourceId);
                if (!inspected.ok) {
                        throw new CommandFacadeError(
                                'REGISTRY-REFUSED',
                                `the registry refused the mirrored read of '${surfaceRef.resourceId}': ${inspected.refusal.code}: ${inspected.refusal.detail ?? inspected.refusal.law}`,
                        );
                }
                return {
                        entryId: inspected.entry.entryId,
                        contentHash: inspected.entry.contentHash,
                        imported: inspected.entry.imported,
                };
        }

        /**
         * The drift check: a mirror is valid only while the registry journal
         * position still equals its anchor. A moved position is source-digest
         * drift: the mirror dies through the contract's typed invalidateMirror
         * transition (kind 'source-digest-drift', the evidence digest over
         * the anchor transition) and is removed from the mirror set -- never
         * a bespoke cache engine, never a silent serve.
         */
        private checkAnchor(
                mirror: LocalMirror,
                currentSeq: number,
        ): { drifted: false } | { drifted: true; refusal: FacadeRefused } {
                const anchorSeq = this.anchors.get(mirror.mirrorId) ?? 0;
                if (currentSeq === anchorSeq) {
                        return { drifted: false };
                }
                const evidenceDigest = sha256Hex(
                        canonicalJSON({
                                mirrorId: mirror.mirrorId,
                                surfaceRef: mirror.surfaceRef,
                                anchorSeq,
                                currentSeq,
                                recordedContentDigest: mirror.contentDigest,
                        }),
                );
                const outcome = MirrorContract.invalidateMirror(
                        mirror,
                        'source-digest-drift',
                        evidenceDigest,
                        epochMsToIsoUtc(this.clock()),
                );
                if (!outcome.invalidated) {
                        return {
                                drifted: true,
                                refusal: refused('mirror-invalidated', `the mirror could not be invalidated: ${outcome.reason}: ${outcome.detail}`),
                        };
                }
                this.removeMirror(mirror.mirrorId);
                return {
                        drifted: true,
                        refusal: refused(
                                'mirror-invalidated',
                                `the registry journal moved (anchor seq ${anchorSeq} -> ${currentSeq}): the mirror is invalidated by source-digest drift (the typed invalidateMirror transition); re-capture over the current read`,
                                { invalidation: outcome.receipt },
                        ),
                };
        }

        private removeMirror(mirrorId: string): void {
                const index = this.mirrors.findIndex((candidate) => candidate.mirrorId === mirrorId);
                if (index >= 0) {
                        this.mirrors.splice(index, 1);
                }
                this.anchors.delete(mirrorId);
        }

        // ---------------------------------------------------------------------------
        // THE ROUTING (every request routes through the contract's routeFor)
        // ---------------------------------------------------------------------------

        /**
         * Routes one CommandFacadeRequest (compound | mirrored-read |
         * direct-tool):
         * 1. the scope-isolation admission (the runtime serves its own scope);
         * 2. the capability truth over the real authorities (the touched
         *    capability: the commands family for tool-touching requests, the
         *    mirrored entry for mirrored reads) -- a violated truth is a
         *    typed refusal naming the law, BEFORE any contract routing;
         * 3. the contract's routeFor with the derived routing context (the
         *    frozen tables + the injected clock delta for mirrored reads) --
         *    a contract rejection passes through verbatim;
         * 4. the FacadeReceipt (buildFacadeReceipt + the deterministic
         *    receipts digest).
         */
        async route(request: CommandFacadeRequest): Promise<FacadeRouteOutcome> {
                this.assertLive();
                await this.ensureReady();
                if (request.scope.workspaceId !== this.scope.workspaceId || request.scope.tenantId !== this.scope.tenantId) {
                        return refused(
                                'scope-mismatch',
                                `the request scope {workspaceId: '${request.scope.workspaceId}', tenantId: '${request.scope.tenantId}'} does not match the facade's isolation boundary {workspaceId: '${this.scope.workspaceId}', tenantId: '${this.scope.tenantId}'}; requests are served only within their own workspace and tenant scope`,
                        );
                }
                const snapshot = await this.registrySnapshot();
                if (request.kind === 'mirrored-read') {
                        return this.routeMirroredRead(request, snapshot);
                }
                const truth = await this.commandsCapabilityTruth(snapshot);
                if ('refused' in truth) {
                        return truth;
                }
                return this.routeThroughContract(request, undefined);
        }

        private async routeMirroredRead(
                request: FacadeContract.MirroredReadFacadeRequest,
                snapshot: RegistrySnapshot,
        ): Promise<FacadeRouteOutcome> {
                const mirror = this.mirrors.find((candidate) => candidate.mirrorId === request.mirrorRef.mirrorId);
                if (mirror === undefined) {
                        // The contract owns the not-found law (unknown-mirror / invalid-request).
                        return this.routeThroughContract(request, undefined);
                }
                const drift = this.checkAnchor(mirror, snapshot.seq);
                if (drift.drifted) {
                        return drift.refusal;
                }
                const truth = await this.entryTruth(snapshot, mirror.surfaceRef.resourceId);
                if ('refused' in truth) {
                        return truth;
                }
                const mirroredAtMs = isoToEpochMs(mirror.mirroredAtIso);
                if (!Number.isFinite(mirroredAtMs)) {
                        return refused(
                                'contract-routing-refused',
                                `the mirror's mirroredAtIso '${mirror.mirroredAtIso}' is not a parseable ISO-8601 timestamp (fail closed)`,
                                { contractReason: 'invalid-request' },
                        );
                }
                const clockDeltaMs = this.clock() - mirroredAtMs;
                return this.routeThroughContract(request, clockDeltaMs);
        }

        private async routeThroughContract(
                request: CommandFacadeRequest,
                clockDeltaMs: number | undefined,
        ): Promise<FacadeRouteOutcome> {
                const outcome = FacadeContract.routeFor(request, this.compounds, this.mirrors, { clockDeltaMs });
                if (!outcome.routed) {
                        return refused('contract-routing-refused', outcome.detail, { contractReason: outcome.reason });
                }
                const built = FacadeContract.buildFacadeReceipt(
                        this.scope,
                        request.facadeId,
                        outcome.routing,
                        epochMsToIsoUtc(this.clock()),
                );
                if (!built.built) {
                        return refused(
                                'contract-routing-refused',
                                `the receipt could not be built: ${built.reason}: ${built.detail}`,
                                { contractReason: 'invalid-routing' },
                        );
                }
                return { routed: true, routing: outcome.routing, receipt: built.receipt };
        }

        // ---------------------------------------------------------------------------
        // THE COMPOUND EXECUTION (the approval lane + the provenance-bearing trail)
        // ---------------------------------------------------------------------------

        /**
         * Executes a registered compound: route FIRST (the same admission
         * laws, fail closed -- a refused routing leaves every authority
         * journal untouched), then run the steps' confirmation gating through
         * the REAL approval lane exactly as the authority routes it: one
         * graph per execution (submitGraph, agent-attributed; approveGraph,
         * human-only), one approval-requested row per confirmation-gated step
         * (agent-attributed), and the injected human decisions (granted |
         * denied, human-only) where provided. NO new executor: the tool
         * effects remain the Tool authority's business; this runtime records
         * the routing, the disclosures and the provenance-bearing trail (a
         * CompoundStepReceipt per step, the approval receipt digest over the
         * lane rows' own content hashes, the deriveFacadeReceiptsDigest fold
         * inside the receipt).
         */
        async executeCompound(
                request: FacadeContract.CompoundFacadeRequest,
                decisions?: ApprovalDecisions,
        ): Promise<FacadeExecutionOutcome> {
                this.assertLive();
                const routed = await this.route(request);
                if ('refused' in routed) {
                        return routed;
                }
                if (routed.routing.kind !== 'compound') {
                        return refused(
                                'contract-routing-refused',
                                `the routed verdict for '${request.facadeId}' is not a compound routing (got '${routed.routing.kind}')`,
                        );
                }
                const command = this.compounds.find((candidate) => candidate.commandId === request.commandRef.commandId);
                if (command === undefined) {
                        return refused(
                                'contract-routing-refused',
                                `the compound '${request.commandRef.commandId}' is no longer registered (the registry changed under the routing; fail closed)`,
                                { contractReason: 'unknown-compound' },
                        );
                }
                const store = this.requireStore();
                const graphId = await this.submitExecutionGraph(store, command);
                const laneRows: ApprovalLaneRow[] = [];
                const stepReceipts: CompoundContract.CompoundStepReceipt[] = [];
                for (const step of command.steps) {
                        stepReceipts.push(await this.routeStepThroughLane(store, graphId, step, decisions, laneRows));
                }
                const executionRecord: CompoundExecutionRecord = {
                        scope: this.scope,
                        contractVersion: FacadeContract.COMMAND_FACADE_CONTRACTS_VERSION,
                        commandId: command.commandId,
                        stepReceipts,
                        executedAtIso: epochMsToIsoUtc(this.clock()),
                };
                const trailCheck = CompoundContract.isCompleteExecutionRecord(command, executionRecord);
                if (!trailCheck.complete) {
                        return refused('approval-lane-refused', `the execution trail is incomplete: ${trailCheck.reason}: ${trailCheck.detail}`);
                }
                const receiptOutcome = FacadeContract.buildFacadeReceipt(
                        this.scope,
                        request.facadeId,
                        routed.routing,
                        executionRecord.executedAtIso,
                );
                if (!receiptOutcome.built) {
                        return refused(
                                'contract-routing-refused',
                                `the receipt could not be built: ${receiptOutcome.reason}: ${receiptOutcome.detail}`,
                                { contractReason: 'invalid-routing' },
                        );
                }
                const lane = this.approvalLaneRows(graphId);
                return {
                        executed: true,
                        routing: routed.routing,
                        executionRecord,
                        trailCheck,
                        receipt: receiptOutcome.receipt,
                        approvalLane: { graphId, rows: lane },
                };
        }

        /** Submits the execution graph through the real store (agent submits, human approves the graph). */
        private async submitExecutionGraph(store: OrchestrationStore, command: CompoundCommand): Promise<string> {
                try {
                        const steps = command.steps.map((step) => ({
                                stepId: step.stepId,
                                title: `compound step ${step.stepId} (${step.toolRef.toolName})`,
                                instruction: `Route the facade compound '${command.commandId}' step '${step.stepId}' through the ${
                                        step.approvalRequirement === 'confirmation' ? 'confirmation gate' : 'tool authority'
                                }.`,
                                ...(step.approvalRequirement === 'confirmation' ? { gate: 'human-approval' } : {}),
                        }));
                        const submitted = await store.submitGraph({
                                title: `command-facade compound ${command.commandId}`,
                                steps,
                                actor: 'agent',
                                origin: 'flauz-command-facade',
                        });
                        await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'flauz-command-facade' });
                        return submitted.graphId;
                } catch (error) {
                        throw new CommandFacadeError('APPROVAL-LANE-REFUSED', `the approval lane refused the compound submission: ${describeError(error)}`);
                }
        }

        /**
         * Routes ONE step through the approval lane: a confirmation-gated
         * step lands its approval-requested row (agent-attributed) plus the
         * injected human decision row (granted | denied, human-only) when a
         * decision is provided; a 'none' step documents that no approval was
         * required. The approvalRoutingDigest folds the lane rows' own
         * content hashes (the authority's provenance).
         */
        private async routeStepThroughLane(
                store: OrchestrationStore,
                graphId: string,
                step: CompoundContract.CompoundStep,
                decisions: ApprovalDecisions | undefined,
                laneRows: ApprovalLaneRow[],
        ): Promise<CompoundContract.CompoundStepReceipt> {
                if (step.approvalRequirement !== 'confirmation') {
                        return {
                                stepId: step.stepId,
                                toolRef: step.toolRef,
                                argsDigest: step.argsDigest,
                                sideEffects: step.expectedSideEffects,
                                approvalReceipt: {
                                        stepId: step.stepId,
                                        requirement: 'none',
                                        approvalRoutingDigest: sha256Hex(
                                                canonicalJSON({
                                                        graphId,
                                                        stepId: step.stepId,
                                                        requirement: 'none',
                                                        toolName: step.toolRef.toolName,
                                                }),
                                        ),
                                },
                        };
                }
                const requested = await this.appendApprovalRow(laneRows, () =>
                        store.approvalRequest({
                                graphId,
                                stepId: step.stepId,
                                reason: `compound step '${step.stepId}' uses confirmation-gated tool '${step.toolRef.toolName}'`,
                                actor: 'agent',
                                origin: 'flauz-command-facade',
                        }),
                );
                const decision = decisions?.[step.stepId];
                const decided =
                        decision !== undefined
                                ? await this.appendApprovalRow(laneRows, () =>
                                          store.approvalDecide({
                                                  graphId,
                                                  stepId: step.stepId,
                                                  decision,
                                                  actor: 'human',
                                                  origin: 'flauz-command-facade',
                                          }),
                                  )
                                : undefined;
                const approvalRoutingDigest = sha256Hex(
                        canonicalJSON({
                                requestedRow: { seq: requested.seq, rowId: requested.rowId, contentHash: requested.contentHash },
                                decision: decision ?? 'pending',
                                decidedRow:
                                        decided === undefined
                                                ? null
                                                : { seq: decided.seq, rowId: decided.rowId, contentHash: decided.contentHash },
                        }),
                );
                return {
                        stepId: step.stepId,
                        toolRef: step.toolRef,
                        argsDigest: step.argsDigest,
                        sideEffects: step.expectedSideEffects,
                        approvalReceipt: {
                                stepId: step.stepId,
                                requirement: 'confirmation',
                                approvalRoutingDigest,
                        },
                };
        }

        private async appendApprovalRow(
                laneRows: ApprovalLaneRow[],
                append: () => Promise<{ seq: number; rowId: string; type: string; actor: string; contentHash: string }>,
        ): Promise<ApprovalLaneRow> {
                try {
                        const row = await append();
                        const laneRow = laneRowOf(row);
                        laneRows.push(laneRow);
                        return laneRow;
                } catch (error) {
                        throw new CommandFacadeError('APPROVAL-LANE-REFUSED', `the approval lane refused the routing: ${describeError(error)}`);
                }
        }

        /** The full approval-lane census for one execution (the store's own rows over the runtime's graph). */
        approvalLaneRows(graphId: string): ApprovalLaneRow[] {
                this.assertLive();
                const store = this.requireStore();
                return store.rowsFor(graphId).map((row) => laneRowOf(row));
        }
}
