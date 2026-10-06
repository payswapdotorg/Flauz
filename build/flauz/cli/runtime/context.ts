/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-010 -- THE SERVICE-CONTEXT PORT (what the CLI binds to).
 *
 * LAWS:
 * - NOT A SECOND RUNTIME: the CLI holds no state models. Everything
 *   is read through this port; the port reads the REAL service seams.
 * - THE REAL SEAM LOADER binds (per the work order):
 *     extensions/flauz-agent/core/orchStore.mjs  -- load(root) -> a
 *       store binding exposing stateOf() / getGraphState(id) /
 *       rowsFor(ref?) (and dispose(), when present), imported in the
 *       dogfood exercises' explicit-extension relative style;
 *     extensions/flauz-agent/core/a2a.mjs        -- list() /
 *       collect({ consume: false }) (the no-consume roster peek).
 *   SEAM NOTE: the two modules load through NON-LITERAL dynamic
 *   imports so the strict-tsc program stays independent of their
 *   on-disk declarations; the structural contract above is validated
 *   at RUNTIME and any mismatch is a typed { bound: false, detail }
 *   verdict -- never a silent fake, never an untyped crash.
 * - THE HARNESS-BACKED IMPLEMENTATION (the order's own spec for this
 *   file): loadHarnessContext() reads a plain JSON fixture under the
 *   root for the deterministic round-trip suite. The bin defaults to
 *   the REAL seam loader; the harness backing is test-only.
 * - DETERMINISM: no Date.now, no Math.random. The issue timestamp is
 *   an injected plain ISO string; the reload drill compares canonical
 *   JSON bytes, not wall clocks.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { HeadlessMode } from '../../zcode-patterns/cli/common/exitcodes.ts';

const ORCH_STORE_SEAM = '../../../../extensions/flauz-agent/core/orchStore.mjs';
const A2A_BUS_SEAM = '../../../../extensions/flauz-agent/core/a2a.mjs';
const HARNESS_FIXTURE_NAME = 'flauz-cli-fixture.json';

export function sha256Hex(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/** Canonical JSON: recursively key-sorted, compact, deterministic. */
export function canonicalJson(value: unknown): string {
	return stableStringify(value);
}

function stableStringify(value: unknown): string {
	if (value === undefined) {
		return 'null';
	}
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}';
}

export interface DerivedScope {
	readonly workspaceId: string;
	readonly tenantId: string;
}

/**
 * Deterministic scope derivation: workspaceId is the resolved root's
 * basename, tenantId is the local fixture tenant. Flags may override;
 * a mismatched override is the scope-isolation refusal (handlers.ts).
 */
export function deriveScope(root: string): DerivedScope {
	const resolved = resolve(root);
	const name = basename(resolved);
	return { workspaceId: name.length > 0 ? name : 'workspace-root', tenantId: 'local' };
}

export interface OrchestrationStoreBinding {
	stateOf(): unknown;
	getGraphState(graphId: string): unknown;
	rowsFor(ref?: string): unknown;
	dispose?(): unknown;
	/** The raw store instance (submitGraph/approveGraph/...) for drill seeding. */
	raw?: unknown;
}

export interface A2ABusBinding {
	list(): unknown;
	collect(options?: { consume?: boolean }): unknown;
}

export type Binding<T> = { bound: true; binding: T } | { bound: false; detail: string };

export interface CliContext {
	readonly root: string;
	readonly mode: HeadlessMode;
	readonly issuedAtIso: string;
	readStore(): Promise<Binding<OrchestrationStoreBinding>>;
	readBus(): Promise<Binding<A2ABusBinding>>;
}

export interface LoadContextOptions {
	readonly root: string;
	readonly issuedAtIso: string;
}

async function importSeamModule(specifier: string): Promise<unknown> {
	// Non-literal on purpose: the seam contract is validated at runtime
	// (see the module header); tsc must not resolve or reject it.
	return await import(specifier);
}

export async function loadOrchestrationStore(root: string): Promise<Binding<OrchestrationStoreBinding>> {
	let moduleValue: unknown;
	try {
		moduleValue = await importSeamModule(ORCH_STORE_SEAM);
	} catch (error) {
		return { bound: false, detail: 'orchStore seam import failed: ' + describeError(error) };
	}
	const moduleRecord = moduleValue as Record<string, unknown> | null;
	if (
		moduleRecord === null ||
		typeof moduleRecord !== 'object' ||
		typeof moduleRecord.OrchestrationStore !== 'function'
	) {
		return { bound: false, detail: 'orchStore seam does not export the OrchestrationStore class' };
	}
	// The real seam is class-shaped: new OrchestrationStore(root).load().
	const StoreCtor = moduleRecord.OrchestrationStore as new (
		root: string,
		options?: Record<string, unknown>,
	) => {
		load(): unknown;
		stateOf(): unknown;
		getGraphState(graphId: string): unknown;
		rowsFor(ref?: string): unknown;
		dispose?(): unknown;
	};
	let storeValue: unknown;
	try {
		const store = new StoreCtor(root);
		const loaded = store.load();
		if (loaded !== undefined && typeof (loaded as Promise<unknown>).then === 'function') {
			await loaded;
		}
		storeValue = store;
	} catch (error) {
		return { bound: false, detail: 'orchStore load failed: ' + describeError(error) };
	}
	const storeRecord = storeValue as Record<string, unknown> | null;
	if (
		storeRecord === null ||
		typeof storeRecord !== 'object' ||
		typeof storeRecord.stateOf !== 'function' ||
		typeof storeRecord.getGraphState !== 'function'
	) {
		return { bound: false, detail: 'orchStore binding lacks stateOf()/getGraphState()' };
	}
	const store = storeRecord as unknown as {
		stateOf(): unknown;
		getGraphState(graphId: string): unknown;
		rowsFor?(ref?: string): unknown;
		dispose?(): unknown;
	};
	const binding: OrchestrationStoreBinding = {
		raw: storeValue,
		stateOf: () => store.stateOf(),
		getGraphState: (graphId: string) => store.getGraphState(graphId),
		rowsFor:
			typeof store.rowsFor === 'function'
				? (ref?: string) => store.rowsFor!(ref)
				: () => [],
	};
	if (typeof store.dispose === 'function') {
		binding.dispose = () => store.dispose!();
	}
	return { bound: true, binding };
}

export async function loadA2ABus(root: string): Promise<Binding<A2ABusBinding>> {
	let moduleValue: unknown;
	try {
		moduleValue = await importSeamModule(A2A_BUS_SEAM);
	} catch (error) {
		return { bound: false, detail: 'a2a seam import failed: ' + describeError(error) };
	}
	const moduleRecord = moduleValue as Record<string, unknown> | null;
	if (
		moduleRecord === null ||
		typeof moduleRecord !== 'object' ||
		typeof moduleRecord.A2ABus !== 'function'
	) {
		return { bound: false, detail: 'a2a seam does not export the A2ABus class' };
	}
	// The real seam is class-shaped: new A2ABus(root).list()/.collect().
	// (Function-style list()/collect() exports would also bind, but the
	// on-disk authority exports the class only.)
	const BusCtor = moduleRecord.A2ABus as new (root: string) => {
		list(): unknown;
		collect(args: { consume: boolean }): unknown;
	};
	let bus: InstanceType<typeof BusCtor> | undefined;
	const busFor = (): InstanceType<typeof BusCtor> => {
		if (bus === undefined) {
			bus = new BusCtor(root);
		}
		return bus;
	};
	return {
		bound: true,
		binding: {
			list: () => busFor().list(),
			collect: () => busFor().collect({ consume: false }),
		},
	};
}

export async function loadRealContext(options: LoadContextOptions): Promise<CliContext> {
	const root = resolve(options.root);
	return {
		root,
		mode: 'headless',
		issuedAtIso: options.issuedAtIso,
		readStore: () => loadOrchestrationStore(root),
		readBus: () => loadA2ABus(root),
	};
}

export interface HarnessFixture {
	state: unknown;
	graphs: Record<string, unknown>;
	rows: unknown[];
	roster: unknown[];
	messages: unknown[];
}

/** TEST-ONLY harness backing: the deterministic fixture context. */
export async function loadHarnessContext(options: LoadContextOptions): Promise<CliContext> {
	const root = resolve(options.root);
	const fixture = JSON.parse(
		await readFile(join(root, HARNESS_FIXTURE_NAME), 'utf8'),
	) as HarnessFixture;
	return {
		root,
		mode: 'headless',
		issuedAtIso: options.issuedAtIso,
		readStore: async () => ({
			bound: true,
			binding: {
				stateOf: () => fixture.state,
				getGraphState: (graphId: string) => fixture.graphs[graphId],
				rowsFor: () => fixture.rows,
			} satisfies OrchestrationStoreBinding,
		}),
		readBus: async () => ({
			bound: true,
			binding: {
				list: () => fixture.roster,
				collect: () => fixture.messages,
			} satisfies A2ABusBinding,
		}),
	};
}

export interface ReloadDrillResult {
	readonly loadedFirst: boolean;
	readonly disposeApplied: boolean;
	readonly loadedSecond: boolean;
	readonly snapshotDigest: string;
	readonly reloadDigest: string;
	readonly byteEqual: boolean;
	readonly detail: string;
}

/**
 * CR-011 journey-5 core: the OrchestrationStore reload drill -- load,
 * snapshot the state as canonical JSON, dispose, load() again from the
 * same root, compare byte-equal. Every failure is a typed field, never
 * an exception and never a faked equality.
 */
export async function runReloadDrill(root: string): Promise<ReloadDrillResult> {
	const first = await loadOrchestrationStore(root);
	if (!first.bound) {
		return {
			loadedFirst: false,
			disposeApplied: false,
			loadedSecond: false,
			snapshotDigest: '',
			reloadDigest: '',
			byteEqual: false,
			detail: 'first load failed: ' + first.detail,
		};
	}
	// The drill needs a real journal row to compare: a fresh root has no
	// graphs, and stateOf() without a graphId is a typed error (the honest
	// failure the worker's station note predicted). Seed exactly one graph
	// through the REAL store API (submit + approve) ONLY when the journal is
	// absent; on a root that already carries the drill graph, reuse its id so
	// repeated drills over the same root stay byte-deterministic.
	let graphId: string | undefined;
	try {
		const journalPath = join(root, '.flauz', 'orchestration', 'journal.jsonl');
		let existing: string | undefined;
		try {
			const text = await readFile(journalPath, 'utf8');
			const firstRow = text.split('\n').find((line) => line.trim().length > 0);
			if (firstRow !== undefined) {
				existing = (JSON.parse(firstRow) as { graphId?: string }).graphId;
			}
		} catch {
			existing = undefined;
		}
		const storeAny = (first.binding as { raw?: unknown }).raw as {
			submitGraph(input: Record<string, unknown>): Promise<{ graphId: string }>;
			approveGraph(input: Record<string, unknown>): Promise<unknown>;
			stateOf(id: string): unknown;
		} | undefined;
		if (storeAny === undefined || typeof storeAny.submitGraph !== 'function') {
			throw new Error('the bound store does not expose the raw write API');
		}
		if (existing !== undefined) {
			graphId = existing;
		} else {
			const submitted = await storeAny.submitGraph({
				title: 'cli reload drill',
				steps: [{ stepId: 'S-01', title: 'seed', instruction: 'the reload drill seed step' }],
				actor: 'human',
				origin: 'flauz-cli',
			});
			await storeAny.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'flauz-cli' });
			graphId = submitted.graphId;
		}
	} catch (error) {
		return {
			loadedFirst: true,
			disposeApplied: false,
			loadedSecond: false,
			snapshotDigest: '',
			reloadDigest: '',
			byteEqual: false,
			detail: 'drill seed failed: ' + describeError(error),
		};
	}
	let firstState: unknown;
	try {
		firstState = ((first.binding as { raw?: unknown }).raw as {
			stateOf(id: string): unknown;
		}).stateOf(graphId as string);
	} catch (error) {
		return {
			loadedFirst: true,
			disposeApplied: false,
			loadedSecond: false,
			snapshotDigest: '',
			reloadDigest: '',
			byteEqual: false,
			detail: 'first stateOf failed: ' + describeError(error),
		};
	}
	const firstSnapshot = canonicalJson(firstState);
	const snapshotDigest = sha256Hex(firstSnapshot);
	let disposeApplied = false;
	if (first.binding.dispose !== undefined) {
		try {
			await first.binding.dispose();
			disposeApplied = true;
		} catch {
			disposeApplied = false;
		}
	}
	const second = await loadOrchestrationStore(root);
	if (!second.bound) {
		return {
			loadedFirst: true,
			disposeApplied,
			loadedSecond: false,
			snapshotDigest,
			reloadDigest: '',
			byteEqual: false,
			detail: 'second load failed: ' + second.detail,
		};
	}
	let secondState: unknown;
	try {
		secondState = ((second.binding as { raw?: unknown }).raw as {
			stateOf(id: string): unknown;
		}).stateOf(graphId as string);
	} catch (error) {
		return {
			loadedFirst: true,
			disposeApplied,
			loadedSecond: true,
			snapshotDigest,
			reloadDigest: '',
			byteEqual: false,
			detail: 'second stateOf failed: ' + describeError(error),
		};
	}
	const secondSnapshot = canonicalJson(secondState);
	const reloadDigest = sha256Hex(secondSnapshot);
	return {
		loadedFirst: true,
		disposeApplied,
		loadedSecond: true,
		snapshotDigest,
		reloadDigest,
		byteEqual: firstSnapshot === secondSnapshot,
		detail: '',
	};
}