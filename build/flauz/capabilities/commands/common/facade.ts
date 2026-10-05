/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-008 agent-native command facade contracts: the facade surface -
 * typed requests, the routing verdict and the receipt (contract module,
 * the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Bounded optimizations only: this module declares types, constants,
 *   pure guards and the routing verdict function over the EXISTING
 *   Tool/Resource/Approval authorities. It declares no facade runtime,
 *   no command executor, no cache engine, no storage. The facade never
 *   bypasses an authority: every request routes exactly as the
 *   authority it touches would route.
 * - Side effects are always visible: the SideEffectDisclosure type
 *   admits no invisible effect; confirmation-gated tools route through
 *   the Approval authority; guards fail closed and name violations.
 * - THE NEVER-SILENT LAW: a stale or expired mirror is never served.
 *   The MirroredReadRouting union is constructed so that freshness
 *   'stale' or 'expired' can only coexist with routeTarget
 *   'direct-read' AND a required bypass disclosure.
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. Timestamps are plain ISO-8601 strings; the mirror
 *   clock delta is injected by callers via RoutingContext.
 * - Zero-dependency: this module pulls in nothing from other modules.
 *   Shapes shared with the compound and mirror contract modules are
 *   re-declared here as sibling copies and pinned structurally by the
 *   test suite (deep-equal on the seam copies, compile-time structural
 *   compatibility on the record shapes).
 * - Every persisted record carries scope (FacadeScope), contractVersion
 *   and plain-string ISO timestamps.
 */

/** Version of the command-facade contract set (all modules carry it). */
export const COMMAND_FACADE_CONTRACTS_VERSION = '1.0.0';

/**
 * THE BOUND LAW (sibling copy of compound.ts's constant; the test suite
 * pins both copies deep-equal). Unbounded compounds are rejected by the
 * admission re-check with the bound named. Changing the value is a
 * contract change requiring a version bump.
 */
export const MAX_COMPOUND_STEPS = 16;

/** Closed request-kind list (as const + derived union, by style law). */
export const FACADE_REQUEST_KINDS = ['compound', 'mirrored-read', 'direct-tool'] as const;
export type FacadeRequestKind = (typeof FACADE_REQUEST_KINDS)[number];

/** Closed side-effect kind list (sibling copy of compound.ts's). */
export const SIDE_EFFECT_KINDS = ['read', 'write', 'network', 'spawn'] as const;
export type SideEffectKind = (typeof SIDE_EFFECT_KINDS)[number];

/**
 * SIDE-EFFECT VISIBILITY LAW (sibling copy of compound.ts's list): side
 * effects are always visible; the list admits exactly one visibility,
 * so the disclosure type admits no invisible effect.
 */
export const SIDE_EFFECT_VISIBILITIES = ['visible'] as const;
export type SideEffectVisibility = (typeof SIDE_EFFECT_VISIBILITIES)[number];

/** Closed approval-requirement list (sibling copy of compound.ts's). */
export const APPROVAL_REQUIREMENTS = ['none', 'confirmation'] as const;
export type ApprovalRequirement = (typeof APPROVAL_REQUIREMENTS)[number];

/** Closed freshness verdict list (sibling copy of mirror.ts's). */
export const MIRROR_VERDICTS = ['fresh', 'stale', 'expired'] as const;
export type MirrorVerdict = (typeof MIRROR_VERDICTS)[number];

/** Closed routing-rejection reason list (fail-closed, violations named). */
export const FACADE_ROUTING_REJECTION_REASONS = [
        'invalid-scope',
        'contract-version-mismatch',
        'invalid-facade-id',
        'invalid-requested-at',
        'invalid-request',
        'unknown-request-kind',
        'unknown-compound',
        'compound-admission-failed',
        'scope-mismatch',
        'unknown-mirror',
        'mirror-admission-failed',
        'missing-clock-delta',
        'unknown-tool',
] as const;
export type FacadeRoutingRejectionReason = (typeof FACADE_ROUTING_REJECTION_REASONS)[number];

/** Closed receipt-rejection reason list. */
export const FACADE_RECEIPT_REJECTION_REASONS = [
        'invalid-scope',
        'invalid-facade-id',
        'invalid-routing',
        'invalid-completed-at',
] as const;
export type FacadeReceiptRejectionReason = (typeof FACADE_RECEIPT_REJECTION_REASONS)[number];

/** Isolation scope stamped on every persisted record. */
export interface FacadeScope {
        readonly workspaceId: string;
        readonly tenantId: string;
}

/** Authority surface reference (resource surfaces and effect surfaces). */
export interface AuthoritySurfaceRef {
        readonly surfaceKind: string;
        readonly resourceId: string;
}

/** The shared side-effect disclosure shape (sibling copy of compound.ts's). */
export interface SideEffectDisclosure {
        readonly surfaceRef: AuthoritySurfaceRef;
        readonly kind: SideEffectKind;
        /** Opaque provenance digest (authority digest format). */
        readonly provenanceDigest: string;
        readonly visibility: SideEffectVisibility;
}

/** Typed reference to a Tool-authority vocabulary tool (never a new tool). */
export interface ToolRef {
        readonly toolName: string;
}

/** One step of a compound command (sibling copy of compound.ts's shape). */
export interface CompoundStep {
        readonly stepId: string;
        readonly toolRef: ToolRef;
        readonly argsDigest: string;
        readonly expectedSideEffects: readonly SideEffectDisclosure[];
        readonly approvalRequirement: ApprovalRequirement;
}

/** A bounded typed compound command (sibling copy of compound.ts's shape). */
export interface CompoundCommand {
        readonly scope: FacadeScope;
        readonly contractVersion: string;
        readonly commandId: string;
        readonly nameDigest: string;
        readonly steps: readonly CompoundStep[];
}

/** Freshness policy thresholds (sibling copy of mirror.ts's shape). */
export interface FreshnessPolicy {
        readonly maxAgeMs: number;
        readonly staleMaxAgeMs: number;
}

/** A read-only local mirror record (sibling copy of mirror.ts's shape). */
export interface LocalMirror {
        readonly scope: FacadeScope;
        readonly contractVersion: string;
        readonly mirrorId: string;
        readonly surfaceRef: AuthoritySurfaceRef;
        readonly contentDigest: string;
        readonly byteSize: number;
        readonly mirroredAtIso: string;
        readonly freshnessPolicy: FreshnessPolicy;
}

/** One entry of the frozen tool-vocabulary projection (sibling copy). */
export interface ToolVocabularyEntry {
        readonly toolName: string;
        readonly confirmationGated: boolean;
}

/**
 * SEAM(TOOL_VOCABULARY) - SIBLING COPY of compound.ts's
 * FROZEN_TOOL_VOCABULARY. Transcribe the IDENTICAL entries into BOTH
 * copies repo-side (see compound.ts for the exact transcription
 * instruction and authority sources). The facade test suite pins both
 * copies deep-equal; mismatched copies fail the gates. Until the seam
 * is transcribed, routeFor fails closed on every tool reference with
 * 'unknown-tool' / 'compound-admission-failed'.
 */
export const FROZEN_TOOL_VOCABULARY: readonly ToolVocabularyEntry[] = Object.freeze([
        // SEAM(TOOL_VOCABULARY): CLOSED 2026-10-05 — transcribed IDENTICAL to the
        // module-of-record copy in compound.ts (the sole registered tool,
        // 'flauz_terminal', routed through the HumanApproval confirmation gate).
        { toolName: 'flauz_terminal', confirmationGated: true },
]);

/** One entry of the frozen mirrorable-surface table (sibling copy). */
export interface MirrorableSurfaceEntry {
        readonly surfaceKind: string;
}

/**
 * SEAM(MIRRORABLE_SURFACES) - SIBLING COPY of mirror.ts's
 * FROZEN_MIRRORABLE_SURFACES. Transcribe the IDENTICAL entries into
 * BOTH copies repo-side (see mirror.ts for the exact transcription
 * instruction and authority sources). The facade test suite pins both
 * copies deep-equal. Until the seam is transcribed, mirrored-read
 * routing fails closed with 'mirror-admission-failed'.
 */
export const FROZEN_MIRRORABLE_SURFACES: readonly MirrorableSurfaceEntry[] = Object.freeze([
        // SEAM(MIRRORABLE_SURFACES): CLOSED 2026-10-05 — transcribed from the
        // Resource authority (extensions/flauz-execution/src/contracts.ts
        // RESOURCE_KINDS), cross-checked against flauz-isolation: the
        // workspace-scoped record kinds whose surfaces are pure read
        // projections (state/log/artifact/ledger reads). Excluded by the
        // read-only law: file, directory, agent-session, browser-session,
        // environment, workspace (write/control/exec/boundary-shaped).
        // IDENTICAL to the module-of-record copy in mirror.ts.
        { surfaceKind: 'task' },
        { surfaceKind: 'artifact' },
        { surfaceKind: 'evidence' },
        { surfaceKind: 'workflow' },
]);

/** A facade request for a registered compound command. */
export interface CompoundFacadeRequest {
        readonly kind: 'compound';
        readonly scope: FacadeScope;
        readonly contractVersion: string;
        readonly facadeId: string;
        readonly commandRef: { readonly commandId: string };
        readonly requestedAtIso: string;
}

/** A facade request for a read served (or re-routed) via a local mirror. */
export interface MirroredReadFacadeRequest {
        readonly kind: 'mirrored-read';
        readonly scope: FacadeScope;
        readonly contractVersion: string;
        readonly facadeId: string;
        readonly mirrorRef: { readonly mirrorId: string };
        readonly requestedAtIso: string;
}

/**
 * A facade request for a single direct tool invocation. The request
 * carries no approval field BY DESIGN: approval routing is derived from
 * the Tool authority's confirmation gating, exactly as the authority
 * itself would route it - the facade never bypasses, and callers never
 * opt out.
 */
export interface DirectToolFacadeRequest {
        readonly kind: 'direct-tool';
        readonly scope: FacadeScope;
        readonly contractVersion: string;
        readonly facadeId: string;
        readonly toolRef: ToolRef;
        readonly argsDigest: string;
        readonly expectedSideEffects: readonly SideEffectDisclosure[];
        readonly requestedAtIso: string;
}

export type CommandFacadeRequest =
        | CompoundFacadeRequest
        | MirroredReadFacadeRequest
        | DirectToolFacadeRequest;

/**
 * Injected routing inputs. The order fixes routeFor(request,
 * compoundRegistry, mirrorRegistry); this optional context carries what
 * the laws force outside those three arguments: the clock delta
 * (determinism law - contract modules never read a clock) and the
 * authority tables (Tool vocabulary, mirrorable surfaces), injectable
 * so tests never depend on seam transcription. Defaults are the frozen
 * sibling copies above.
 */
export interface RoutingContext {
        readonly toolVocabulary?: readonly ToolVocabularyEntry[];
        readonly mirrorableSurfaces?: readonly MirrorableSurfaceEntry[];
        readonly clockDeltaMs?: number;
}

/** Per-step routing of a compound through the Tool/Approval authorities. */
export interface CompoundStepRouting {
        readonly stepId: string;
        readonly toolName: string;
        /**
         * True iff this step routes through the Approval authority: its
         * approvalRequirement is 'confirmation'. Admission guarantees every
         * confirmation-gated tool always is (over-declaring confirmation on
         * a non-gated tool is permitted; under-declaring is not).
         */
        readonly routesThroughApprovalAuthority: boolean;
        readonly expectedSideEffects: readonly SideEffectDisclosure[];
}

/** The routing verdict for a compound request. */
export interface CompoundRouting {
        readonly kind: 'compound';
        readonly commandId: string;
        readonly nameDigest: string;
        readonly stepRoutings: readonly CompoundStepRouting[];
        /** Union of every step's disclosures, in step order. */
        readonly sideEffects: readonly SideEffectDisclosure[];
}

/**
 * The bypass disclosure: the typed record that a mirror existed, was
 * judged stale or expired, and was bypassed for a direct read through
 * the Resource authority. Required on every redirect - a stale mirror
 * is never served silently, by construction.
 */
export interface MirrorBypassDisclosure {
        readonly mirrorId: string;
        readonly surfaceRef: AuthoritySurfaceRef;
        readonly recordedContentDigest: string;
        readonly freshness: MirrorVerdict;
        readonly redirectedTo: 'direct-read';
}

/** A fresh mirror served locally through the Resource-authority projection. */
export interface MirrorServeRouting {
        readonly kind: 'mirrored-read';
        readonly mirrorId: string;
        readonly surfaceRef: AuthoritySurfaceRef;
        readonly freshness: 'fresh';
        readonly routeTarget: 'mirror';
        readonly sideEffects: readonly SideEffectDisclosure[];
}

/** A stale or expired mirror re-routed to a direct read, disclosed. */
export interface MirrorRedirectRouting {
        readonly kind: 'mirrored-read';
        readonly mirrorId: string;
        readonly surfaceRef: AuthoritySurfaceRef;
        readonly freshness: 'stale' | 'expired';
        readonly routeTarget: 'direct-read';
        readonly bypass: MirrorBypassDisclosure;
        readonly sideEffects: readonly SideEffectDisclosure[];
}

/**
 * THE NEVER-SILENT LAW, made structural: this union admits exactly two
 * shapes - fresh-and-served, or stale/expired-and-redirected-with-
 * bypass. No variant serves a stale mirror; no redirect lacks its
 * disclosure. The runtime out of scope (by law) cannot construct a
 * silent stale serve from these types.
 */
export type MirroredReadRouting = MirrorServeRouting | MirrorRedirectRouting;

/** The routing verdict for a direct tool invocation. */
export interface DirectToolRouting {
        readonly kind: 'direct-tool';
        readonly toolName: string;
        readonly argsDigest: string;
        /** Derived from the Tool authority's confirmation gating. */
        readonly routesThroughApprovalAuthority: boolean;
        readonly sideEffects: readonly SideEffectDisclosure[];
}

export type FacadeRouting = CompoundRouting | MirroredReadRouting | DirectToolRouting;

export interface Routed {
        readonly routed: true;
        readonly routing: FacadeRouting;
}

/** Typed routing rejection: closed reason, detail names the violation. */
export interface RoutingRejected {
        readonly routed: false;
        readonly reason: FacadeRoutingRejectionReason;
        readonly detail: string;
}

export type RoutingOutcome = Routed | RoutingRejected;

/**
 * Pure routing verdict. Every request routes through the existing
 * authorities:
 * - compound: looked up in the registry, admission RE-CHECKED (the
 *   facade trusts no registry entry; the re-check duplicates
 *   canAdmitCompound's laws by the zero-import discipline and is pinned
 *   in agreement by the test suite), then routed step-by-step through
 *   the Tool/Approval authorities per the compound's disclosures.
 * - mirrored-read: the mirror is looked up, its shape and scope
 *   re-checked, the safe-mirror law re-checked against the mirrorable
 *   table, and the injected clock delta yields the freshness verdict.
 *   Fresh mirrors serve locally; stale or expired mirrors re-route to
 *   a direct read through the Resource authority, DISCLOSED.
 * - direct-tool: routed exactly as the Tool authority would - approval
 *   routing derived from the authority's confirmation gating, never
 *   from the caller. The facade never bypasses.
 *
 * Registries are plain readonly arrays (data, lookup by id). Guards
 * never mutate inputs.
 */
export function routeFor(
        request: CommandFacadeRequest,
        compoundRegistry: readonly CompoundCommand[],
        mirrorRegistry: readonly LocalMirror[],
        context?: RoutingContext,
): RoutingOutcome {
        const kind = (request as { kind?: unknown }).kind;
        if (!(FACADE_REQUEST_KINDS as readonly string[]).includes(kind as string)) {
                return rejectRouting(
                        'unknown-request-kind',
                        `request kind must be one of compound/mirrored-read/direct-tool, got '${String(kind)}'`,
                );
        }
        if (!isFacadeScope(request.scope)) {
                return rejectRouting('invalid-scope', 'scope must carry non-empty workspaceId and tenantId');
        }
        if (request.contractVersion !== COMMAND_FACADE_CONTRACTS_VERSION) {
                return rejectRouting(
                        'contract-version-mismatch',
                        `contractVersion must be '${COMMAND_FACADE_CONTRACTS_VERSION}', got '${request.contractVersion}'`,
                );
        }
        if (!isNonEmptyString(request.facadeId)) {
                return rejectRouting('invalid-facade-id', 'facadeId must be a non-empty string');
        }
        if (!isNonEmptyString(request.requestedAtIso)) {
                return rejectRouting('invalid-requested-at', 'requestedAtIso must be a non-empty ISO-8601 string');
        }
        const toolVocabulary = context?.toolVocabulary ?? FROZEN_TOOL_VOCABULARY;
        const mirrorableSurfaces = context?.mirrorableSurfaces ?? FROZEN_MIRRORABLE_SURFACES;
        switch (request.kind) {
                case 'compound':
                        return routeCompound(request, compoundRegistry, toolVocabulary);
                case 'mirrored-read':
                        return routeMirroredRead(request, mirrorRegistry, mirrorableSurfaces, context?.clockDeltaMs);
                case 'direct-tool':
                        return routeDirectTool(request, toolVocabulary);
        }
}

/**
 * Deterministic receipts digest over a routing verdict: canonical JSON
 * (object keys sorted, no whitespace) under a versioned prefix. Pure;
 * same verdict always yields the same digest. The format is a contract
 * decision ('facade-receipts:v1'); changing it requires a version bump.
 */
export function deriveFacadeReceiptsDigest(routing: FacadeRouting): string {
        return `facade-receipts:v1:${canonicalJson(routing)}`;
}

/** The facade receipt: the persisted record of one routed request. */
export interface FacadeReceipt {
        readonly scope: FacadeScope;
        readonly contractVersion: string;
        readonly facadeId: string;
        readonly routingVerdict: FacadeRouting;
        readonly receiptsDigest: string;
        readonly completedAtIso: string;
}

export interface ReceiptBuilt {
        readonly built: true;
        readonly receipt: FacadeReceipt;
}

export interface ReceiptRejected {
        readonly built: false;
        readonly reason: FacadeReceiptRejectionReason;
        readonly detail: string;
}

export type FacadeReceiptOutcome = ReceiptBuilt | ReceiptRejected;

/**
 * Pure receipt constructor. contractVersion is forced to the contract
 * set version; receiptsDigest is derived deterministically from the
 * routing verdict; completedAtIso is injected (determinism law). The
 * routing verdict is structurally re-checked, INCLUDING the
 * never-silent correlation for mirrored-read routings - a redirect
 * without its bypass disclosure cannot produce a receipt.
 */
export function buildFacadeReceipt(
        scope: FacadeScope,
        facadeId: string,
        routing: FacadeRouting,
        completedAtIso: string,
): FacadeReceiptOutcome {
        if (!isFacadeScope(scope)) {
                return rejectReceipt('invalid-scope', 'scope must carry non-empty workspaceId and tenantId');
        }
        if (!isNonEmptyString(facadeId)) {
                return rejectReceipt('invalid-facade-id', 'facadeId must be a non-empty string');
        }
        if (!isNonEmptyString(completedAtIso)) {
                return rejectReceipt('invalid-completed-at', 'completedAtIso must be a non-empty ISO-8601 string');
        }
        const violation = routingViolation(routing);
        if (violation !== undefined) {
                return rejectReceipt('invalid-routing', violation);
        }
        return {
                built: true,
                receipt: {
                        scope,
                        contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
                        facadeId,
                        routingVerdict: routing,
                        receiptsDigest: deriveFacadeReceiptsDigest(routing),
                        completedAtIso,
                },
        };
}

/** Pure guard: a scope with non-empty workspace and tenant ids. */
export function isFacadeScope(value: unknown): value is FacadeScope {
        if (typeof value !== 'object' || value === null) {
                return false;
        }
        const scope = value as { workspaceId?: unknown; tenantId?: unknown };
        return isNonEmptyString(scope.workspaceId) && isNonEmptyString(scope.tenantId);
}

/** Pure guard: a surface reference with non-empty kind and resource id. */
export function isAuthoritySurfaceRef(value: unknown): value is AuthoritySurfaceRef {
        if (typeof value !== 'object' || value === null) {
                return false;
        }
        const ref = value as { surfaceKind?: unknown; resourceId?: unknown };
        return isNonEmptyString(ref.surfaceKind) && isNonEmptyString(ref.resourceId);
}

/** Pure guard: a named tool reference. */
export function isToolRef(value: unknown): value is ToolRef {
        if (typeof value !== 'object' || value === null) {
                return false;
        }
        const ref = value as { toolName?: unknown };
        return isNonEmptyString(ref.toolName);
}

/** Pure guard: a well-formed, visible side-effect disclosure. */
export function isSideEffectDisclosure(value: unknown): value is SideEffectDisclosure {
        return sideEffectViolation(value) === undefined;
}

/** Pure guard: finite, non-negative, integral thresholds, stale at least fresh. */
export function isFreshnessPolicy(value: unknown): value is FreshnessPolicy {
        if (typeof value !== 'object' || value === null) {
                return false;
        }
        const policy = value as { maxAgeMs?: unknown; staleMaxAgeMs?: unknown };
        if (typeof policy.maxAgeMs !== 'number' || typeof policy.staleMaxAgeMs !== 'number') {
                return false;
        }
        if (!Number.isInteger(policy.maxAgeMs) || !Number.isInteger(policy.staleMaxAgeMs)) {
                return false;
        }
        if (policy.maxAgeMs < 0 || policy.staleMaxAgeMs < 0) {
                return false;
        }
        return policy.staleMaxAgeMs >= policy.maxAgeMs;
}

interface RecheckResult {
        readonly ok: boolean;
        readonly detail: string;
}

function routeCompound(
        request: CompoundFacadeRequest,
        registry: readonly CompoundCommand[],
        toolVocabulary: readonly ToolVocabularyEntry[],
): RoutingOutcome {
        if (typeof request.commandRef !== 'object' || request.commandRef === null) {
                return rejectRouting('invalid-request', 'compound request must carry a commandRef object');
        }
        if (!isNonEmptyString(request.commandRef.commandId)) {
                return rejectRouting('invalid-request', 'compound request must carry a non-empty commandRef.commandId');
        }
        const commandId = request.commandRef.commandId;
        const command = findCompound(registry, commandId);
        if (command === undefined) {
                return rejectRouting('unknown-compound', `no compound registered under commandId '${commandId}'`);
        }
        const recheck = recheckCompoundAdmission(command, toolVocabulary);
        if (!recheck.ok) {
                return rejectRouting('compound-admission-failed', recheck.detail);
        }
        if (
                command.scope.workspaceId !== request.scope.workspaceId ||
                command.scope.tenantId !== request.scope.tenantId
        ) {
                return rejectRouting(
                        'scope-mismatch',
                        `compound '${commandId}' belongs to a different scope than the requesting facade; compounds route only within their isolation boundary`,
                );
        }
        const stepRoutings: CompoundStepRouting[] = command.steps.map((step) => ({
                stepId: step.stepId,
                toolName: step.toolRef.toolName,
                routesThroughApprovalAuthority: step.approvalRequirement === 'confirmation',
                expectedSideEffects: step.expectedSideEffects,
        }));
        const routing: CompoundRouting = {
                kind: 'compound',
                commandId: command.commandId,
                nameDigest: command.nameDigest,
                stepRoutings,
                sideEffects: command.steps.flatMap((step) => step.expectedSideEffects),
        };
        return { routed: true, routing };
}

function routeMirroredRead(
        request: MirroredReadFacadeRequest,
        registry: readonly LocalMirror[],
        mirrorableSurfaces: readonly MirrorableSurfaceEntry[],
        clockDeltaMs: number | undefined,
): RoutingOutcome {
        if (typeof request.mirrorRef !== 'object' || request.mirrorRef === null) {
                return rejectRouting('invalid-request', 'mirrored-read request must carry a mirrorRef object');
        }
        if (!isNonEmptyString(request.mirrorRef.mirrorId)) {
                return rejectRouting('invalid-request', 'mirrored-read request must carry a non-empty mirrorRef.mirrorId');
        }
        const mirrorId = request.mirrorRef.mirrorId;
        const mirror = findMirror(registry, mirrorId);
        if (mirror === undefined) {
                return rejectRouting('unknown-mirror', `no mirror registered under mirrorId '${mirrorId}'`);
        }
        const shape = recheckMirrorShape(mirror);
        if (!shape.ok) {
                return rejectRouting('mirror-admission-failed', shape.detail);
        }
        if (mirror.scope.workspaceId !== request.scope.workspaceId || mirror.scope.tenantId !== request.scope.tenantId) {
                return rejectRouting(
                        'scope-mismatch',
                        `mirror '${mirrorId}' belongs to a different scope than the requesting facade; mirrors are local to their workspace (isolation boundary)`,
                );
        }
        if (resolveMirrorableSurface(mirror.surfaceRef.surfaceKind, mirrorableSurfaces) === undefined) {
                return rejectRouting(
                        'mirror-admission-failed',
                        `surfaceKind '${mirror.surfaceRef.surfaceKind}' does not resolve in the mirrorable-surface table; mirrors are READ-ONLY projections of resource surfaces - write-shaped or approval-shaped surfaces never mirror (safe-mirror law)`,
                );
        }
        if (clockDeltaMs === undefined || !Number.isFinite(clockDeltaMs)) {
                return rejectRouting(
                        'missing-clock-delta',
                        'mirrored-read routing requires an injected finite clockDeltaMs (determinism law: contract modules never read a clock)',
                );
        }
        const verdict = freshnessVerdict(mirror.freshnessPolicy, clockDeltaMs);
        /*
         * The read disclosure for a mirrored read: a visible 'read' effect on
         * the mirrored authority surface. Its provenanceDigest carries the
         * mirror's contentDigest - the evidence anchor available at routing
         * time; the runtime executor (out of scope by law) replaces it with
         * the authority's execution provenance digest.
         */
        const readDisclosure: SideEffectDisclosure = {
                surfaceRef: mirror.surfaceRef,
                kind: 'read',
                provenanceDigest: mirror.contentDigest,
                visibility: 'visible',
        };
        if (verdict === 'fresh') {
                const routing: MirrorServeRouting = {
                        kind: 'mirrored-read',
                        mirrorId: mirror.mirrorId,
                        surfaceRef: mirror.surfaceRef,
                        freshness: 'fresh',
                        routeTarget: 'mirror',
                        sideEffects: [readDisclosure],
                };
                return { routed: true, routing };
        }
        const routing: MirrorRedirectRouting = {
                kind: 'mirrored-read',
                mirrorId: mirror.mirrorId,
                surfaceRef: mirror.surfaceRef,
                freshness: verdict,
                routeTarget: 'direct-read',
                bypass: {
                        mirrorId: mirror.mirrorId,
                        surfaceRef: mirror.surfaceRef,
                        recordedContentDigest: mirror.contentDigest,
                        freshness: verdict,
                        redirectedTo: 'direct-read',
                },
                sideEffects: [readDisclosure],
        };
        return { routed: true, routing };
}

function routeDirectTool(
        request: DirectToolFacadeRequest,
        toolVocabulary: readonly ToolVocabularyEntry[],
): RoutingOutcome {
        if (typeof request.toolRef !== 'object' || request.toolRef === null || !isNonEmptyString((request.toolRef as { toolName?: unknown }).toolName)) {
                return rejectRouting('invalid-request', 'direct-tool request must carry a toolRef with a non-empty toolName');
        }
        if (!isNonEmptyString(request.argsDigest)) {
                return rejectRouting('invalid-request', 'direct-tool request must carry a non-empty argsDigest');
        }
        if (!Array.isArray(request.expectedSideEffects)) {
                return rejectRouting('invalid-request', 'direct-tool request must list its expected side effects');
        }
        for (const disclosure of request.expectedSideEffects) {
                const violation = sideEffectViolation(disclosure);
                if (violation !== undefined) {
                        return rejectRouting('invalid-request', `direct-tool request carries a malformed disclosure: ${violation}`);
                }
        }
        const entry = resolveToolEntry(request.toolRef, toolVocabulary);
        if (entry === undefined) {
                return rejectRouting(
                        'unknown-tool',
                        `direct-tool request references tool '${request.toolRef.toolName}' which does not resolve in the tool vocabulary (the facade never bypasses the Tool authority)`,
                );
        }
        const routing: DirectToolRouting = {
                kind: 'direct-tool',
                toolName: entry.toolName,
                argsDigest: request.argsDigest,
                routesThroughApprovalAuthority: entry.confirmationGated,
                sideEffects: request.expectedSideEffects,
        };
        return { routed: true, routing };
}

/**
 * Admission RE-CHECK (the facade trusts no registry entry). Duplicates
 * canAdmitCompound's laws from compound.ts - forced by the zero-import
 * discipline - with detail strings that embed the compound-module
 * rejection-reason vocabulary so the test suite can pin agreement.
 */
function recheckCompoundAdmission(
        command: CompoundCommand,
        toolVocabulary: readonly ToolVocabularyEntry[],
): RecheckResult {
        if (!isFacadeScope(command.scope)) {
                return { ok: false, detail: 'invalid-scope: scope must carry non-empty workspaceId and tenantId' };
        }
        if (command.contractVersion !== COMMAND_FACADE_CONTRACTS_VERSION) {
                return {
                        ok: false,
                        detail: `contract-version-mismatch: contractVersion must be '${COMMAND_FACADE_CONTRACTS_VERSION}', got '${command.contractVersion}'`,
                };
        }
        if (!isNonEmptyString(command.commandId)) {
                return { ok: false, detail: 'invalid-command-id: commandId must be a non-empty string' };
        }
        if (!isNonEmptyString(command.nameDigest)) {
                return { ok: false, detail: 'invalid-name-digest: nameDigest must be a non-empty string' };
        }
        if (!Array.isArray(command.steps) || command.steps.length === 0) {
                return { ok: false, detail: 'empty-steps: a compound command must carry at least one step' };
        }
        if (command.steps.length > MAX_COMPOUND_STEPS) {
                return {
                        ok: false,
                        detail: `too-many-steps: compound carries ${command.steps.length} steps; the bound is MAX_COMPOUND_STEPS=${MAX_COMPOUND_STEPS} (unbounded compounds are rejected by law)`,
                };
        }
        const seenStepIds = new Set<string>();
        for (const step of command.steps) {
                if (!isNonEmptyString(step.stepId)) {
                        return { ok: false, detail: 'invalid-step: every step must carry a non-empty stepId' };
                }
                if (seenStepIds.has(step.stepId)) {
                        return { ok: false, detail: `duplicate-step-id: stepId '${step.stepId}' appears more than once` };
                }
                seenStepIds.add(step.stepId);
                if (!isToolRef(step.toolRef)) {
                        return { ok: false, detail: `invalid-step: step '${step.stepId}' carries an invalid toolRef` };
                }
                if (!isNonEmptyString(step.argsDigest)) {
                        return { ok: false, detail: `invalid-step: step '${step.stepId}' carries an empty argsDigest` };
                }
                if (!(APPROVAL_REQUIREMENTS as readonly string[]).includes(step.approvalRequirement)) {
                        return { ok: false, detail: `invalid-step: step '${step.stepId}' carries an unknown approvalRequirement` };
                }
                if (!Array.isArray(step.expectedSideEffects)) {
                        return { ok: false, detail: `invalid-step: step '${step.stepId}' must list its expected side effects` };
                }
                for (const disclosure of step.expectedSideEffects) {
                        const violation = sideEffectViolation(disclosure);
                        if (violation !== undefined) {
                                return { ok: false, detail: `invalid-step: step '${step.stepId}': ${violation}` };
                        }
                }
                const entry = resolveToolEntry(step.toolRef, toolVocabulary);
                if (entry === undefined) {
                        return {
                                ok: false,
                                detail: `unknown-tool: step '${step.stepId}' references tool '${step.toolRef.toolName}' which does not resolve in the tool vocabulary`,
                        };
                }
                if (entry.confirmationGated && step.approvalRequirement !== 'confirmation') {
                        return {
                                ok: false,
                                detail: `approval-requirement-mismatch: step '${step.stepId}' uses confirmation-gated tool '${entry.toolName}' with approvalRequirement 'none'; side effects may never silently escape approval`,
                        };
                }
        }
        return { ok: true, detail: 'admitted' };
}

/** Mirror shape RE-CHECK (duplicates isLocalMirror's laws from mirror.ts). */
function recheckMirrorShape(mirror: LocalMirror): RecheckResult {
        if (!isFacadeScope(mirror.scope)) {
                return { ok: false, detail: 'mirror record must carry a valid scope' };
        }
        if (mirror.contractVersion !== COMMAND_FACADE_CONTRACTS_VERSION) {
                return {
                        ok: false,
                        detail: `mirror record contractVersion must be '${COMMAND_FACADE_CONTRACTS_VERSION}', got '${mirror.contractVersion}'`,
                };
        }
        if (!isNonEmptyString(mirror.mirrorId)) {
                return { ok: false, detail: 'mirror record must carry a non-empty mirrorId' };
        }
        if (!isAuthoritySurfaceRef(mirror.surfaceRef)) {
                return { ok: false, detail: 'mirror record must carry a well-formed surfaceRef' };
        }
        if (!isNonEmptyString(mirror.contentDigest)) {
                return { ok: false, detail: 'mirror record must carry a non-empty contentDigest' };
        }
        if (typeof mirror.byteSize !== 'number' || !Number.isInteger(mirror.byteSize) || mirror.byteSize < 0) {
                return { ok: false, detail: 'mirror record byteSize must be a non-negative integer' };
        }
        if (!isNonEmptyString(mirror.mirroredAtIso)) {
                return { ok: false, detail: 'mirror record must carry a non-empty mirroredAtIso' };
        }
        if (!isFreshnessPolicy(mirror.freshnessPolicy)) {
                return { ok: false, detail: 'mirror record must carry a well-formed freshnessPolicy' };
        }
        return { ok: true, detail: 'well-formed' };
}

/** Freshness verdict (duplicates mirror.ts's semantics: inclusive boundaries, clamped, fail-closed). */
function freshnessVerdict(policy: FreshnessPolicy, clockDeltaMs: number): MirrorVerdict {
        if (!Number.isFinite(clockDeltaMs)) {
                return 'expired';
        }
        if (!policyIsWellFormed(policy)) {
                return 'expired';
        }
        const deltaMs = clockDeltaMs < 0 ? 0 : clockDeltaMs;
        if (deltaMs <= policy.maxAgeMs) {
                return 'fresh';
        }
        if (deltaMs <= policy.staleMaxAgeMs) {
                return 'stale';
        }
        return 'expired';
}

/** Structural re-check of a routing verdict, including the never-silent correlation. */
function routingViolation(routing: FacadeRouting): string | undefined {
        if (typeof routing !== 'object' || routing === null) {
                return 'routing verdict must be an object';
        }
        const kind = (routing as { kind?: unknown }).kind;
        if (kind === 'compound') {
                const compoundRouting = routing as CompoundRouting;
                if (!isNonEmptyString(compoundRouting.commandId)) {
                        return 'compound routing must carry a non-empty commandId';
                }
                if (!Array.isArray(compoundRouting.stepRoutings) || compoundRouting.stepRoutings.length === 0) {
                        return 'compound routing must carry at least one step routing';
                }
                return undefined;
        }
        if (kind === 'mirrored-read') {
                const mirroredRead = routing as MirroredReadRouting;
                const wideMirrored = routing as { freshness?: unknown; routeTarget?: unknown };
                if (!isNonEmptyString(mirroredRead.mirrorId)) {
                        return 'mirrored-read routing must carry a non-empty mirrorId';
                }
                if (mirroredRead.routeTarget === 'mirror') {
                        if (mirroredRead.freshness !== 'fresh') {
                                return `a mirror-served routing must carry freshness 'fresh', got '${String(wideMirrored.freshness)}' (never a silent stale serve)`;
                        }
                        return undefined;
                }
                if (mirroredRead.routeTarget === 'direct-read') {
                        if (mirroredRead.freshness !== 'stale' && mirroredRead.freshness !== 'expired') {
                                return `a redirected routing must carry freshness 'stale' or 'expired', got '${String(mirroredRead.freshness)}'`;
                        }
                        const bypass = mirroredRead.bypass;
                        if (typeof bypass !== 'object' || bypass === null) {
                                return 'a redirected routing must carry its bypass disclosure (never a silent stale serve)';
                        }
                        const disclosure = bypass as MirrorBypassDisclosure;
                        if (disclosure.redirectedTo !== 'direct-read') {
                                return "bypass disclosure must carry redirectedTo 'direct-read'";
                        }
                        if (!isNonEmptyString(disclosure.mirrorId) || !isNonEmptyString(disclosure.recordedContentDigest)) {
                                return 'bypass disclosure must carry mirrorId and recordedContentDigest';
                        }
                        return undefined;
                }
                return `mirrored-read routing must carry routeTarget 'mirror' or 'direct-read', got '${String(wideMirrored.routeTarget)}'`;
        }
        if (kind === 'direct-tool') {
                const directTool = routing as DirectToolRouting;
                if (!isNonEmptyString(directTool.toolName)) {
                        return 'direct-tool routing must carry a non-empty toolName';
                }
                return undefined;
        }
        return `routing verdict kind must be compound/mirrored-read/direct-tool, got '${String(kind)}'`;
}

/** Canonical JSON: sorted object keys, no whitespace, arrays in order. */
function canonicalJson(value: unknown): string {
        if (value === null) {
                return 'null';
        }
        if (typeof value === 'boolean' || typeof value === 'number') {
                return String(value);
        }
        if (typeof value === 'string') {
                return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
                const items = value.map((item) => canonicalJson(item));
                return `[${items.join(',')}]`;
        }
        if (typeof value === 'object') {
                const record = value as Record<string, unknown>;
                const keys = Object.keys(record)
                        .filter((key) => record[key] !== undefined)
                        .sort();
                const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
                return `{${members.join(',')}}`;
        }
        return 'null';
}

function findCompound(registry: readonly CompoundCommand[], commandId: string): CompoundCommand | undefined {
        for (const command of registry) {
                if (command.commandId === commandId) {
                        return command;
                }
        }
        return undefined;
}

function findMirror(registry: readonly LocalMirror[], mirrorId: string): LocalMirror | undefined {
        for (const mirror of registry) {
                if (mirror.mirrorId === mirrorId) {
                        return mirror;
                }
        }
        return undefined;
}

function resolveToolEntry(
        toolRef: ToolRef,
        vocabulary: readonly ToolVocabularyEntry[],
): ToolVocabularyEntry | undefined {
        for (const entry of vocabulary) {
                if (entry.toolName === toolRef.toolName) {
                        return entry;
                }
        }
        return undefined;
}

function resolveMirrorableSurface(
        surfaceKind: string,
        table: readonly MirrorableSurfaceEntry[],
): MirrorableSurfaceEntry | undefined {
        for (const entry of table) {
                if (entry.surfaceKind === surfaceKind) {
                        return entry;
                }
        }
        return undefined;
}

function policyIsWellFormed(policy: FreshnessPolicy): boolean {
        return (
                Number.isFinite(policy.maxAgeMs) &&
                Number.isFinite(policy.staleMaxAgeMs) &&
                policy.maxAgeMs >= 0 &&
                policy.staleMaxAgeMs >= policy.maxAgeMs
        );
}

/** Returns a precise violation message, or undefined when well-formed. */
function sideEffectViolation(value: unknown): string | undefined {
        if (typeof value !== 'object' || value === null) {
                return 'side-effect disclosure must be an object';
        }
        const disclosure = value as Record<string, unknown>;
        const surfaceRef = disclosure.surfaceRef;
        if (typeof surfaceRef !== 'object' || surfaceRef === null) {
                return 'side-effect disclosure must carry a surfaceRef object';
        }
        const surface = surfaceRef as Record<string, unknown>;
        if (!isNonEmptyString(surface.surfaceKind) || !isNonEmptyString(surface.resourceId)) {
                return 'surfaceRef must carry non-empty surfaceKind and resourceId';
        }
        if (!(SIDE_EFFECT_KINDS as readonly string[]).includes(disclosure.kind as string)) {
                return `side-effect kind must be one of read/write/network/spawn, got '${String(disclosure.kind)}'`;
        }
        if (!isNonEmptyString(disclosure.provenanceDigest)) {
                return 'side-effect disclosure must carry a non-empty provenanceDigest';
        }
        if (disclosure.visibility !== 'visible') {
                return `side-effect visibility must be 'visible' (side effects are always visible by law), got '${String(disclosure.visibility)}'`;
        }
        return undefined;
}

function rejectRouting(reason: FacadeRoutingRejectionReason, detail: string): RoutingRejected {
        return { routed: false, reason, detail };
}

function rejectReceipt(reason: FacadeReceiptRejectionReason, detail: string): ReceiptRejected {
        return { built: false, reason, detail };
}

function isNonEmptyString(value: unknown): value is string {
        return typeof value === 'string' && value.length > 0;
}
