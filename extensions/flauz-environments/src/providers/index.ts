/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Provider dispatch: kind -> provider adapter + the full descriptor
 * validation (structure + kind-specific connection shape).
 */
import {
	isEnvironmentKind,
	isPlainObject,
	isPositiveEpochMs,
	isBoundedString,
	isEnvironmentId,
	isTrustPosture,
	hasExactKeys,
	hasKey,
	SCHEMA_ID,
	type EnvironmentConnection,
	type EnvironmentDescriptor,
	type EnvironmentKind,
} from '../api.ts';
import { sshProvider } from './ssh.ts';
import { containerProvider } from './container.ts';
import { cloudSandboxProvider } from './cloudSandbox.ts';
import { workspaceRemoteProvider } from './workspaceRemote.ts';
import { envelopeError, type ConnectionPlan, type EnvironmentProvider } from './types.ts';

const PROVIDERS_BY_KIND: ReadonlyMap<EnvironmentKind, EnvironmentProvider> = new Map<EnvironmentKind, EnvironmentProvider>([
	[sshProvider.kind, sshProvider],
	[containerProvider.kind, containerProvider],
	[cloudSandboxProvider.kind, cloudSandboxProvider],
	[workspaceRemoteProvider.kind, workspaceRemoteProvider],
]);

/** All four v0 provider adapters (deterministic order for reports/tests). */
export const PROVIDERS: readonly EnvironmentProvider[] = [sshProvider, containerProvider, cloudSandboxProvider, workspaceRemoteProvider];

export function providerFor(kind: EnvironmentKind): EnvironmentProvider {
	const provider = PROVIDERS_BY_KIND.get(kind);
	if (provider === undefined) {
		throw envelopeError(`no provider adapter registered for kind '${kind}'`);
	}
	return provider;
}

export function providerIdForKind(kind: EnvironmentKind): string {
	return providerFor(kind).id;
}

/**
 * Full descriptor validation: exact structure + trust + capabilities +
 * timing, then the kind-specific connection shape via the provider adapter.
 * Returns the descriptor typed; throws with a `flauz.environments/v0:`-prefixed
 * message on the first violation.
 */
export function validateDescriptor(value: unknown): EnvironmentDescriptor {
	if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'kind', 'label', 'connection', 'trust', 'capabilities', 'enabled', 'timing'])) {
		throw envelopeError('invalid descriptor: expected exactly the keys [capabilities, connection, enabled, id, kind, label, timing, trust]');
	}
	if (!isEnvironmentId(value.id)) {
		throw envelopeError(`invalid descriptor: id must match /^env-[a-z0-9][a-z0-9-]{0,47}$/ (got ${JSON.stringify(value.id)})`);
	}
	if (!isEnvironmentKind(value.kind)) {
		throw envelopeError(`invalid descriptor: kind must be one of ssh-local|container|cloud-sandbox|workspace-remote (got ${JSON.stringify(value.kind)})`);
	}
	if (!isBoundedString(value.label, 100)) {
		throw envelopeError(`invalid descriptor: label must be a non-empty string (<= 100 chars) (got ${JSON.stringify(value.label)})`);
	}
	if (!isPlainObject(value.trust) || !hasExactKeys(value.trust, ['posture', 'inheritsWorkspaceTrust'])) {
		throw envelopeError(`invalid descriptor: trust must have exactly the keys [inheritsWorkspaceTrust, posture]`);
	}
	if (!isTrustPosture(value.trust.posture)) {
		throw envelopeError(`invalid descriptor: trust posture must be one of trusted|untrusted|unknown (got ${JSON.stringify(value.trust.posture)})`);
	}
	if (typeof value.trust.inheritsWorkspaceTrust !== 'boolean') {
		throw envelopeError(`invalid descriptor: trust inheritsWorkspaceTrust must be a boolean (got ${JSON.stringify(value.trust.inheritsWorkspaceTrust)})`);
	}
	if (!isPlainObject(value.capabilities) || !hasExactKeys(value.capabilities, ['browser', 'exec', 'agentHost', 'terminal'])) {
		throw envelopeError('invalid descriptor: capabilities must have exactly the keys [agentHost, browser, exec, terminal]');
	}
	for (const flag of ['agentHost', 'browser', 'exec', 'terminal'] as const) {
		if (typeof value.capabilities[flag] !== 'boolean') {
			throw envelopeError(`invalid descriptor: capability '${flag}' must be a boolean (got ${JSON.stringify(value.capabilities[flag])})`);
		}
	}
	if (typeof value.enabled !== 'boolean') {
		throw envelopeError(`invalid descriptor: enabled must be a boolean (got ${JSON.stringify(value.enabled)})`);
	}
	if (!isPlainObject(value.timing) || !hasExactKeys(value.timing, ['created', 'updatedAt'])) {
		throw envelopeError('invalid descriptor: timing must have exactly the keys [created, updatedAt]');
	}
	if (!isPositiveEpochMs(value.timing.created) || !isPositiveEpochMs(value.timing.updatedAt)) {
		throw envelopeError(`invalid descriptor: timing created/updatedAt must be positive epoch-ms integers (got ${JSON.stringify(value.timing)})`);
	}
	if (value.timing.updatedAt < value.timing.created) {
		throw envelopeError(`invalid descriptor: timing updatedAt must be >= created (got ${JSON.stringify(value.timing)})`);
	}
	const connection: EnvironmentConnection = providerFor(value.kind).validateConnection(value.connection);
	return { ...value, connection } as EnvironmentDescriptor;
}

/** Connection-plan generation via the kind's provider adapter. */
export function buildConnectionPlan(descriptor: EnvironmentDescriptor): ConnectionPlan {
	return providerFor(descriptor.kind).buildConnectionPlan(descriptor);
}

/** Envelope schema id re-export (single import site for consumers). */
export { SCHEMA_ID as ENVELOPE_SCHEMA_ID };

/** hasKey re-export for envelope-level consumers (single import site). */
export { hasKey };
