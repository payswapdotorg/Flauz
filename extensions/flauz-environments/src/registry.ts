/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The Flauz environment registry (v0).
 *
 * Persisted at `.flauz/environments.json` with the flauz-workspace envelope
 * discipline (DL-9): schema-validated, fully canonical serialization (sorted
 * keys, 2-space indent, single trailing newline), atomic tmp+rename writes --
 * git-diffable and stable across re-opens, which is exactly what the env
 * switch continuity story needs (the registry itself is one of the things
 * that PERSISTS across a switch; see src/continuity.ts).
 *
 * Registry lifecycle: bootstrap / register / unregister / list / get /
 * activate / deactivate. `activate` is registry-level state (the selected
 * environment id), NOT a live connection -- v0 connections are connection
 * PLANS (src/providers/) executed by runners/real-world wiring.
 */
import {
	ENVIRONMENTS_PATH,
	FLAUZ_DIR,
	canonicalJson,
	clone,
	isEnvironmentId,
	isPlainObject,
	hasKey,
	joinPath,
	serializeEnvelope,
	type Clock,
	type EnvironmentDescriptor,
	type EnvironmentKind,
	type EnvironmentTrust,
	type EnvironmentCapabilities,
	type EnvironmentsEnvelope,
	type FileSystemPort,
} from './api.ts';
import { buildConnectionPlan, validateDescriptor } from './providers/index.ts';
import type { ConnectionPlan } from './providers/types.ts';

/** Input to `register` -- timing is minted by the registry clock. */
export interface EnvironmentRegistration {
	readonly id: string;
	readonly kind: EnvironmentKind;
	readonly label: string;
	readonly connection: unknown;
	readonly trust: EnvironmentTrust;
	readonly capabilities: EnvironmentCapabilities;
	readonly enabled?: boolean;
}

export interface EnvironmentRegistryOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

function isRegistryError(message: string): boolean {
	return message.startsWith('flauz.environments/v0:');
}

export class EnvironmentRegistry {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private envelope: EnvironmentsEnvelope | undefined;
	private readonly path: string;

	constructor(options: EnvironmentRegistryOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.path = joinPath(options.root, ENVIRONMENTS_PATH);
	}

	/** Absolute path of the registry file (diagnostics/reporting). */
	get filePath(): string {
		return this.path;
	}

	/** Loads + validates the envelope, or creates the empty one. Idempotent. */
	async bootstrap(): Promise<EnvironmentsEnvelope> {
		if (this.envelope !== undefined) {
			return this.envelope;
		}
		await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
		const raw = await this.fs.readFileUtf8(this.path);
		if (raw === undefined) {
			this.envelope = { $schema: 'flauz.environments/v0', activeId: null, environments: [] };
			await this.persist();
			return this.envelope;
		}
		this.envelope = EnvironmentRegistry.parseEnvelope(raw);
		return this.envelope;
	}

	/** Validates + parses a registry document (used by bootstrap + tests + canary). */
	static parseEnvelope(raw: string): EnvironmentsEnvelope {
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.environments/v0: registry is not valid JSON -- ${(err as Error).message}`);
		}
		if (!isPlainObject(value) || !hasKey(value, '$schema') || value.$schema !== 'flauz.environments/v0') {
			throw new Error(`flauz.environments/v0: registry must be an object with $schema exactly 'flauz.environments/v0'`);
		}
		if (!hasKey(value, 'activeId')) {
			throw new Error('flauz.environments/v0: registry must carry activeId (string or null)');
		}
		if (value.activeId !== null && !isEnvironmentId(value.activeId)) {
			throw new Error(`flauz.environments/v0: activeId must be null or a valid environment id (got ${JSON.stringify(value.activeId)})`);
		}
		if (!hasKey(value, 'environments') || !Array.isArray(value.environments)) {
			throw new Error('flauz.environments/v0: registry must carry an environments array');
		}
		const seen = new Set<string>();
		const environments = value.environments.map((entry, index) => {
			let descriptor: EnvironmentDescriptor;
			try {
				descriptor = validateDescriptor(entry);
			} catch (err) {
				throw new Error(`flauz.environments/v0: environments[${index}]: ${(err as Error).message}`);
			}
			if (seen.has(descriptor.id)) {
				throw new Error(`flauz.environments/v0: duplicate environment id '${descriptor.id}'`);
			}
			seen.add(descriptor.id);
			return descriptor;
		});
		if (value.activeId !== null && !seen.has(value.activeId)) {
			throw new Error(`flauz.environments/v0: activeId '${value.activeId}' does not reference a registered environment`);
		}
		// stable order for git-diffability: sorted by id
		environments.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		return { $schema: 'flauz.environments/v0', activeId: value.activeId, environments };
	}

	/** Current envelope (bootstrapped). */
	environments(): EnvironmentsEnvelope {
		this.assertBootstrapped();
		return this.envelope!;
	}

	/** All registered descriptors, sorted by id (stable diffs). */
	list(): readonly EnvironmentDescriptor[] {
		return this.environments().environments;
	}

	get(id: string): EnvironmentDescriptor | undefined {
		const found = this.environments().environments.find(descriptor => descriptor.id === id);
		return found === undefined ? undefined : clone(found);
	}

	/** The active environment id (null = local/no environment). */
	activeId(): string | null {
		return this.environments().activeId;
	}

	active(): EnvironmentDescriptor | undefined {
		const id = this.activeId();
		return id === null ? undefined : this.get(id);
	}

	/**
	 * Registers a new environment. Validates the full descriptor (structure +
	 * kind-specific connection via the provider), rejects duplicate ids,
	 * mints timing from the registry clock, persists atomically.
	 */
	async register(registration: EnvironmentRegistration): Promise<EnvironmentDescriptor> {
		this.assertBootstrapped();
		const now = this.clock();
		const candidate = {
			id: registration.id,
			kind: registration.kind,
			label: registration.label,
			connection: registration.connection,
			trust: registration.trust,
			capabilities: registration.capabilities,
			enabled: registration.enabled ?? true,
			timing: { created: now, updatedAt: now },
		};
		let descriptor: EnvironmentDescriptor;
		try {
			descriptor = validateDescriptor(candidate);
		} catch (err) {
			throw new Error(`flauz.environments/v0: register rejected: ${(err as Error).message}`);
		}
		if (this.get(descriptor.id) !== undefined) {
			throw new Error(`flauz.environments/v0: register rejected: environment '${descriptor.id}' already exists`);
		}
		this.envelope = {
			...this.envelope!,
			environments: [...this.envelope!.environments, descriptor].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		};
		await this.persist();
		return clone(descriptor);
	}

	/** Removes an environment (and clears activeId if it pointed at it). */
	async unregister(id: string): Promise<void> {
		this.assertBootstrapped();
		if (this.get(id) === undefined) {
			throw new Error(`flauz.environments/v0: unregister rejected: environment '${id}' does not exist`);
		}
		const remaining = this.envelope!.environments.filter(descriptor => descriptor.id !== id);
		const activeId = this.envelope!.activeId === id ? null : this.envelope!.activeId;
		this.envelope = { ...this.envelope!, activeId, environments: remaining };
		await this.persist();
	}

	/**
	 * Activates an environment: sets activeId + persists + returns the
	 * connection plan (the v0 artifact -- no live connection). Same-id
	 * activation is a no-op returning the plan with note.
	 */
	async activate(id: string): Promise<ConnectionPlan> {
		this.assertBootstrapped();
		const descriptor = this.get(id);
		if (descriptor === undefined) {
			throw new Error(`flauz.environments/v0: activate rejected: environment '${id}' does not exist`);
		}
		if (!descriptor.enabled) {
			throw new Error(`flauz.environments/v0: activate rejected: environment '${id}' is disabled`);
		}
		if (this.envelope!.activeId !== id) {
			this.envelope = { ...this.envelope!, activeId: id };
			await this.persist();
		}
		return buildConnectionPlan(descriptor);
	}

	/** Clears activeId (back to local/no environment). */
	async deactivate(): Promise<void> {
		this.assertBootstrapped();
		if (this.envelope!.activeId !== null) {
			this.envelope = { ...this.envelope!, activeId: null };
			await this.persist();
		}
	}

	/** Connection plan for a registered environment (no state change). */
	planFor(id: string): ConnectionPlan {
		const descriptor = this.get(id);
		if (descriptor === undefined) {
			throw new Error(`flauz.environments/v0: plan rejected: environment '${id}' does not exist`);
		}
		return buildConnectionPlan(descriptor);
	}

	/** Canonical serialization of the current state (git-diff discipline). */
	serialize(): string {
		return serializeEnvelope(this.environments());
	}

	/** Round-trip check: serialized state must re-parse to the same state. */
	verifyRoundTrip(): void {
		const parsed = EnvironmentRegistry.parseEnvelope(this.serialize());
		if (canonicalJson(parsed) !== canonicalJson(this.environments())) {
			throw new Error('flauz.environments/v0: round-trip mismatch (serialization is not canonical)');
		}
	}

	private async persist(): Promise<void> {
		const contents = serializeEnvelope(this.envelope);
		const tmp = `${this.path}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, this.path);
	}

	private assertBootstrapped(): void {
		if (this.envelope === undefined) {
			throw new Error('flauz.environments/v0: registry not bootstrapped (call bootstrap() first)');
		}
	}
}

/** Re-exported so consumers get one import site for registry-facing types. */
export { isRegistryError };
