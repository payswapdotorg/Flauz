/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-009 (B2, Phase C-R wave 5) -- THE COMPOUND CAPABILITY COMMANDS.
 *
 * LAWS:
 * - ORCHESTRATION ONLY, NEVER A SECOND AUTHORITY: the CR-006 registry
 *   IS the capability lifecycle authority; the CR-008 gate IS the
 *   verification + permission authority. Every step routes through
 *   the authorities' OWN public operations over the SAME registry
 *   root (one journal, one gate-records file). This module holds no
 *   state model, owns no refusal vocabulary, keeps no shadow
 *   permission state, and writes no file of its own.
 * - THE STATION'S D8 ARBITRATION (binding; disclosed verbatim in
 *   REPORT.md): the CR-010b read-only ruling was wave-2 scope pinned
 *   to the capability-discovery family; this wave-5 compound family
 *   MAY invoke the authorities' mutating public operations.
 * - THE MACHINE IS THE SOLE CONTINUATION ARBITER: the compound never
 *   pre-checks a next step against the state machine. An unlawful
 *   continuation simply attempts the authority operation; the
 *   authority refuses typed (a refused registry operation writes
 *   nothing -- every refusal path in registry.mjs returns before
 *   persist), and the refusal passes through VERBATIM (code, law,
 *   entryId, state, detail, source) wrapped with the orchestration
 *   ledger. GateError is caught and normalized; non-GateError
 *   exceptions are infrastructure failures and propagate; factory
 *   misuse throws TypeError (the createRegistry/createGate doctrine).
 * - INSTANCE CHOREOGRAPHY (the registry's own laws: load() is
 *   first-call-only; a live instance never sees another instance's
 *   journal writes; a fresh instance replays everything): the
 *   onboarding head runs on its own registry instance; the gate is
 *   constructed AFTER the head so its internal registry replays the
 *   head's writes; the final disclosure reads a FRESH registry
 *   (journal truth) plus the gate's own policy summary. Teardown is
 *   single-instance and reads its own writes.
 * - PARTIAL FAILURE IS DISCLOSED, NEVER COMPENSATED: there is no
 *   undo and the compound makes no lifecycle decisions -- on refusal
 *   it stops and returns the completed-steps ledger (op, authority,
 *   entryId, state, disclosure per step) plus the verbatim refusal.
 *   The teardown compound is the operator's remedy.
 * - DETERMINISM: no Date.now, no Math.random, no new Date(). The only
 *   time source is the injected issuedAtIso (Date.parse of a plain
 *   ISO string -- the landed context.ts bindRegistryRead idiom);
 *   every journal timestamp is stamped by the authorities' own
 *   injected clocks.
 * - INPUTS ARE DELIBERATELY LOOSE (the registry family doctrine): the
 *   authorities validate every value and refuse typed. Receipts on
 *   the gate tail must satisfy the gate's own strict CR-008 4.2 shape
 *   (frozen verificationStatus + a non-empty checks array of
 *   { checkId, verdict }); the registry's machine accepts a looser
 *   check shape -- the divergence is the authorities', disclosed.
 * - PLACEMENT (the grammar ruling, FINAL NO -- station-endorsed): the
 *   frozen ZC-009 tables admit no amendment (no amendment law exists
 *   in grammar.ts or wire.ts), so these compounds are LIBRARY
 *   surface consumed by tests and future waves -- no CLI grammar row,
 *   no bin dispatch, no battery edit. Evidence label: local-real
 *   (real registry + real gate over real fs, injected clock).
 */

import { createRegistry } from '../../capabilities/registry/registry.mjs';
import type {
	DiscoveredArtifactInput,
	ImportedEntryInput,
	RegistryEntryView,
} from '../../capabilities/registry/registry.mjs';
import { createGate, GateError } from '../../capabilities/gate/gate.ts';
import type {
	GateDecisionInput,
	GateDecisionOutcome,
	GateEnableOutcome,
	GateOutcome,
	GatePolicySummary,
	GateReceiptInput,
	GateRuntime,
	GateWarningView,
} from '../../capabilities/gate/gate.ts';
import { deriveScope, realRegistryFsPort, registryRootFor } from './context.ts';

/* ------------------------------------------------------------------ */
/* The typed surface.                                                  */
/* ------------------------------------------------------------------ */

export type CompoundAuthority = 'registry' | 'gate';

/** One completed authority operation in the compound's ledger. */
export interface CompoundStepView {
	readonly op: string;
	readonly authority: CompoundAuthority;
	readonly entryId: string | null;
	readonly state: string | null;
	readonly disclosure: CompoundDisclosureView | null;
}

/** An authority disclosure (the registry's { code, note, detail } and the gate's view share the shape). */
export interface CompoundDisclosureView {
	readonly code: string;
	readonly note: string;
	readonly detail: string | null;
}

/**
 * The typed refusal surface: the authority's OWN refusal, verbatim
 * (code, law, entryId, state, detail, source), plus the orchestration
 * context (the failed operation and the completed-steps ledger). The
 * compound contributes no refusal vocabulary of its own.
 */
export interface CompoundRefusalView {
	readonly code: string;
	readonly law: string;
	readonly entryId: string | null;
	readonly state: string | null;
	readonly detail: string | null;
	readonly source: CompoundAuthority;
	readonly failedOp: string;
	readonly completedSteps: readonly CompoundStepView[];
}

export interface CompoundOkView {
	readonly ok: true;
	readonly entryId: string;
	readonly state: string;
	readonly steps: readonly CompoundStepView[];
	readonly entry: RegistryEntryView;
}

/** The gate-tailed compounds surface the enable warning and the gate's own policy summary. */
export interface LifecycleCompoundOkView extends CompoundOkView {
	readonly warning: GateWarningView | null;
	readonly policySummary: GatePolicySummary;
}

export type OnboardCapabilityResult =
	| LifecycleCompoundOkView
	| { readonly ok: false; readonly refusal: CompoundRefusalView };
export type GateFlowCapabilityResult =
	| LifecycleCompoundOkView
	| { readonly ok: false; readonly refusal: CompoundRefusalView };
export type TeardownCapabilityResult =
	| CompoundOkView
	| { readonly ok: false; readonly refusal: CompoundRefusalView };

export interface CompoundScope {
	readonly workspaceId: string;
	readonly tenantId: string;
}

export interface CompoundOptions {
	readonly root: string;
	readonly issuedAtIso: string;
	/** Defaults to deriveScope(root): the same derivation the CLI context uses (no second scope law). */
	readonly scope?: CompoundScope;
}

/** The compound census (the handler-family organization law; pinned by tests). */
export const COMPOUND_FAMILIES: readonly string[] = Object.freeze(['onboard', 'gate-flow', 'teardown']);

/* ------------------------------------------------------------------ */
/* Internals.                                                          */
/* ------------------------------------------------------------------ */

interface CompoundContext {
	readonly registryRoot: string;
	readonly clock: () => number;
	readonly scope: CompoundScope;
}

function compoundContext(options: CompoundOptions): CompoundContext {
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('CR-009 compounds require an options object');
	}
	if (typeof options.root !== 'string' || options.root === '') {
		throw new TypeError('CR-009 compounds: root must be a non-empty string');
	}
	if (typeof options.issuedAtIso !== 'string' || options.issuedAtIso === '') {
		throw new TypeError('CR-009 compounds: issuedAtIso must be a non-empty ISO-8601 string');
	}
	const scope: CompoundScope = options.scope === undefined ? deriveScope(options.root) : options.scope;
	if (
		typeof scope !== 'object' ||
		scope === null ||
		typeof scope.workspaceId !== 'string' ||
		scope.workspaceId === '' ||
		typeof scope.tenantId !== 'string' ||
		scope.tenantId === ''
	) {
		throw new TypeError('CR-009 compounds: scope must be { workspaceId, tenantId } non-empty strings');
	}
	const issuedAtIso = options.issuedAtIso;
	return {
		registryRoot: registryRootFor(options.root),
		clock: (): number => Date.parse(issuedAtIso),
		scope: { workspaceId: scope.workspaceId, tenantId: scope.tenantId },
	};
}

function stepOf(
	op: string,
	authority: CompoundAuthority,
	entryId: string | null,
	state: string | null,
	disclosure: CompoundDisclosureView | null,
): CompoundStepView {
	return { op, authority, entryId, state, disclosure };
}

/** Shape-agnostic disclosure read (the registry's Disclosure and the gate's view agree on { code, note, detail }). */
function disclosureOf(disclosure: unknown): CompoundDisclosureView | null {
	if (disclosure === null || disclosure === undefined) {
		return null;
	}
	const record = disclosure as { code?: unknown; note?: unknown; detail?: unknown };
	if (typeof record.code !== 'string' || typeof record.note !== 'string') {
		return null; /* defensive: unreachable per the authorities' shapes */
	}
	return {
		code: record.code,
		note: record.note,
		detail: typeof record.detail === 'string' ? record.detail : null,
	};
}

function refusalOfRegistry(
	refusal: unknown,
	failedOp: string,
	steps: readonly CompoundStepView[],
): { ok: false; refusal: CompoundRefusalView } {
	const record = refusal as { code?: unknown; law?: unknown; entryId?: unknown; state?: unknown; detail?: unknown };
	return {
		ok: false,
		refusal: {
			code: typeof record.code === 'string' ? record.code : 'unknown-refusal',
			law: typeof record.law === 'string' ? record.law : '',
			entryId: typeof record.entryId === 'string' ? record.entryId : null,
			state: typeof record.state === 'string' ? record.state : null,
			detail: typeof record.detail === 'string' ? record.detail : null,
			source: 'registry',
			failedOp,
			completedSteps: [...steps],
		},
	};
}

function refusalOfGate(
	error: GateError,
	failedOp: string,
	steps: readonly CompoundStepView[],
): { ok: false; refusal: CompoundRefusalView } {
	return {
		ok: false,
		refusal: {
			code: error.code,
			law: error.law,
			entryId: error.entryId,
			state: error.state,
			detail: error.detail,
			source: error.source,
			failedOp,
			completedSteps: [...steps],
		},
	};
}

function gateErrorOf(error: unknown): GateError | null {
	return error instanceof GateError ? error : null;
}

/** The gate over the SAME registry root as the compound's registry instances: one journal, one records file. */
async function constructGateOrRefuse(
	context: CompoundContext,
	steps: readonly CompoundStepView[],
): Promise<{ gate: GateRuntime } | { refusal: { ok: false; refusal: CompoundRefusalView } }> {
	try {
		const gate = await createGate({
			root: context.registryRoot,
			clock: context.clock,
			fsPort: realRegistryFsPort(),
			scope: context.scope,
		});
		return { gate };
	} catch (error) {
		const gateError = gateErrorOf(error);
		if (gateError === null) {
			throw error;
		}
		return { refusal: refusalOfGate(gateError, 'gate-construction', steps) };
	}
}

interface GateTailOutcome {
	readonly ok: true;
	readonly state: string;
	readonly warning: GateWarningView | null;
}

type GateTailResult = GateTailOutcome | { ok: false; refusal: CompoundRefusalView };

/**
 * THE GATE TAIL, in the gate's own order: submitVerificationReceipt ->
 * decidePermissions -> approve -> enable. The gate owns verification
 * and permission; the registry inside the gate owns the lifecycle; a
 * decision is evidence and writes no registry line. A GateError at
 * any step stops the compound with the verbatim refusal (the
 * decide-before-approve order is the CR-008 gate's own fail-closed
 * law: approve refuses without a recorded decision).
 */
async function runGateTail(
	gate: GateRuntime,
	entryId: string,
	receipt: GateReceiptInput,
	decision: GateDecisionInput,
	steps: CompoundStepView[],
): Promise<GateTailResult> {
	let receiptOutcome: GateOutcome;
	try {
		receiptOutcome = await gate.submitVerificationReceipt(entryId, receipt);
	} catch (error) {
		return gateTailRefusal(error, 'submit-verification-receipt', steps);
	}
	steps.push(
		stepOf('submit-verification-receipt', 'gate', receiptOutcome.entryId, receiptOutcome.state, receiptOutcome.disclosure === null ? null : { code: receiptOutcome.disclosure.code, note: receiptOutcome.disclosure.note, detail: receiptOutcome.disclosure.detail }),
	);
	let decisionOutcome: GateDecisionOutcome;
	try {
		decisionOutcome = await gate.decidePermissions(entryId, decision);
	} catch (error) {
		return gateTailRefusal(error, 'decide-permissions', steps);
	}
	steps.push(stepOf('decide-permissions', 'gate', decisionOutcome.entryId, decisionOutcome.state, null));
	let approveOutcome: GateOutcome;
	try {
		approveOutcome = await gate.approve(entryId);
	} catch (error) {
		return gateTailRefusal(error, 'approve', steps);
	}
	steps.push(
		stepOf('approve', 'gate', approveOutcome.entryId, approveOutcome.state, approveOutcome.disclosure === null ? null : { code: approveOutcome.disclosure.code, note: approveOutcome.disclosure.note, detail: approveOutcome.disclosure.detail }),
	);
	let enableOutcome: GateEnableOutcome;
	try {
		enableOutcome = await gate.enable(entryId);
	} catch (error) {
		return gateTailRefusal(error, 'enable', steps);
	}
	steps.push(
		stepOf('enable', 'gate', enableOutcome.entryId, enableOutcome.state, enableOutcome.disclosure === null ? null : { code: enableOutcome.disclosure.code, note: enableOutcome.disclosure.note, detail: enableOutcome.disclosure.detail }),
	);
	return { ok: true, state: enableOutcome.state, warning: enableOutcome.warning };
}

function gateTailRefusal(error: unknown, failedOp: string, steps: readonly CompoundStepView[]): GateTailResult {
	const gateError = gateErrorOf(error);
	if (gateError === null) {
		throw error; /* an infrastructure exception (never a typed refusal): propagate honestly */
	}
	return refusalOfGate(gateError, failedOp, steps);
}

/**
 * The journal-truth final read: a FRESH registry instance (a live one
 * never sees another instance's writes; a fresh one replays the whole
 * journal). Post-success, these reads are infallible under the journal
 * laws -- a refusal here would mean the read view diverges from the
 * journal, so it throws plainly rather than faking an outcome.
 */
async function freshEntryView(context: CompoundContext, entryId: string): Promise<RegistryEntryView> {
	const registry = createRegistry({
		root: context.registryRoot,
		clock: context.clock,
		fsPort: realRegistryFsPort(),
		scope: context.scope,
	});
	const loaded = await registry.load();
	if (!loaded.ok) {
		const record = loaded.refusal as { code?: unknown; detail?: unknown };
		throw new Error('cr-009 post-success disclosure read refused at load: ' + String(record.code) + ': ' + String(record.detail));
	}
	const inspected = await registry.inspect(entryId);
	if (!inspected.ok) {
		const record = inspected.refusal as { code?: unknown; detail?: unknown };
		throw new Error('cr-009 post-success disclosure read refused at inspect: ' + String(record.code) + ': ' + String(record.detail));
	}
	return inspected.entry;
}

/* ------------------------------------------------------------------ */
/* The compounds.                                                      */
/* ------------------------------------------------------------------ */

/**
 * THE ONBOARDING COMPOUND: discover -> register (the registry's own
 * binding law: register locates the discovered entry by digest over
 * the same root) -> the gate tail (receipt -> decision -> approve ->
 * enable) -> the honest final disclosure (a fresh registry's journal
 * truth + the gate's own policy summary, including the
 * W_ENABLE_VERIFICATION_PARTIAL census when the gate discloses one).
 */
export async function onboardCapability(
	options: CompoundOptions,
	discovery: DiscoveredArtifactInput,
	imported: ImportedEntryInput,
	receipt: GateReceiptInput,
	decision: GateDecisionInput,
): Promise<OnboardCapabilityResult> {
	const context = compoundContext(options);
	const steps: CompoundStepView[] = [];
	const head = createRegistry({
		root: context.registryRoot,
		clock: context.clock,
		fsPort: realRegistryFsPort(),
		scope: context.scope,
	});
	const loaded = await head.load();
	if (!loaded.ok) {
		return refusalOfRegistry(loaded.refusal, 'load', steps);
	}
	const discovered = await head.discover(discovery);
	if (!discovered.ok) {
		return refusalOfRegistry(discovered.refusal, 'discover', steps);
	}
	steps.push(stepOf('discover', 'registry', discovered.entryId, discovered.state, disclosureOf(discovered.disclosure)));
	const registered = await head.register(imported);
	if (!registered.ok) {
		return refusalOfRegistry(registered.refusal, 'register', steps);
	}
	steps.push(stepOf('register', 'registry', registered.entryId, registered.state, disclosureOf(registered.disclosure)));
	const entryId = registered.entryId;
	const gateConstructed = await constructGateOrRefuse(context, steps);
	if (!('gate' in gateConstructed)) {
		return gateConstructed.refusal;
	}
	const tail = await runGateTail(gateConstructed.gate, entryId, receipt, decision, steps);
	if (!tail.ok) {
		return tail;
	}
	const entry = await freshEntryView(context, entryId);
	const policySummary = await gateConstructed.gate.gatePolicySummary(entryId);
	return { ok: true, entryId, state: tail.state, steps, warning: tail.warning, entry, policySummary };
}

/**
 * THE GATE-FLOW COMPOUND: the gate tail over an EXISTING entry (the
 * verify + decide + approve + enable sequence through the CR-008
 * gate's own API), plus the same final disclosure. The gate is
 * constructed first so its internal registry replays the journal as
 * it stands.
 */
export async function gateFlowCapability(
	options: CompoundOptions,
	entryId: string,
	receipt: GateReceiptInput,
	decision: GateDecisionInput,
): Promise<GateFlowCapabilityResult> {
	const context = compoundContext(options);
	const steps: CompoundStepView[] = [];
	const gateConstructed = await constructGateOrRefuse(context, steps);
	if (!('gate' in gateConstructed)) {
		return gateConstructed.refusal;
	}
	const tail = await runGateTail(gateConstructed.gate, entryId, receipt, decision, steps);
	if (!tail.ok) {
		return tail;
	}
	const entry = await freshEntryView(context, entryId);
	const policySummary = await gateConstructed.gate.gatePolicySummary(entryId);
	return { ok: true, entryId, state: tail.state, steps, warning: tail.warning, entry, policySummary };
}

/**
 * THE TEARDOWN COMPOUND: disable -> remove through the registry's own
 * public operations, then the terminal read on the SAME instance (its
 * own writes). The terminal-state laws are the machine's own: remove
 * lands `revoked` (terminal, never re-entered, still queryable with
 * its revocation record); a second teardown refuses through the
 * machine. Single-instance by construction -- no cross-instance
 * exposure.
 */
export async function teardownCapability(
	options: CompoundOptions,
	entryId: string,
	reason?: string,
): Promise<TeardownCapabilityResult> {
	const context = compoundContext(options);
	const steps: CompoundStepView[] = [];
	const registry = createRegistry({
		root: context.registryRoot,
		clock: context.clock,
		fsPort: realRegistryFsPort(),
		scope: context.scope,
	});
	const loaded = await registry.load();
	if (!loaded.ok) {
		return refusalOfRegistry(loaded.refusal, 'load', steps);
	}
	const disabled = await registry.disable(entryId, reason);
	if (!disabled.ok) {
		return refusalOfRegistry(disabled.refusal, 'disable', steps);
	}
	steps.push(stepOf('disable', 'registry', disabled.entryId, disabled.state, disclosureOf(disabled.disclosure)));
	const removed = await registry.remove(entryId, reason);
	if (!removed.ok) {
		return refusalOfRegistry(removed.refusal, 'remove', steps);
	}
	steps.push(stepOf('remove', 'registry', removed.entryId, removed.state, disclosureOf(removed.disclosure)));
	const inspected = await registry.inspect(entryId);
	if (!inspected.ok) {
		return refusalOfRegistry(inspected.refusal, 'inspect', steps);
	}
	return { ok: true, entryId, state: removed.state, steps, entry: inspected.entry };
}
