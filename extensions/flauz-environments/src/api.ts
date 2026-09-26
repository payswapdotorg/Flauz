/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/** Schema identifier pinned into `.flauz/environments.json`. */
export const SCHEMA_ID = 'flauz.environments/v0';

/** Directory (relative to the workspace root) holding all Flauz state. */
export const FLAUZ_DIR = '.flauz';

/** Registry path, relative to the workspace root (sibling of flauz-workspace's tasks.json). */
export const ENVIRONMENTS_PATH = '.flauz/environments.json';

export const ENVIRONMENT_KINDS = ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const TRUST_POSTURES = ['trusted', 'untrusted', 'unknown'] as const;
export type TrustPosture = (typeof TRUST_POSTURES)[number];

export const SSH_AUTH_METHODS = ['agent', 'key', 'password'] as const;
export type SshAuthMethod = (typeof SSH_AUTH_METHODS)[number];

export const CLOUD_SANDBOX_PROVIDERS = ['e2b', 'custom'] as const;
export type CloudSandboxProviderId = (typeof CLOUD_SANDBOX_PROVIDERS)[number];

export const CAPABILITY_FLAGS = ['browser', 'exec', 'agentHost', 'terminal'] as const;
export type EnvironmentCapabilityFlag = (typeof CAPABILITY_FLAGS)[number];

/** How the agent host is reached for a connection plan (see providers/*.ts). */
export const AGENT_HOST_MODES = ['none', 'embedded', 'bridged', 'remote-proxy'] as const;
export type AgentHostMode = (typeof AGENT_HOST_MODES)[number];

/**
 * SSH connection shape (own OSS resolver posture -- DL-7/DL-8).
 *
 * `agentHostBridge` follows the vscode-test-resolver blueprint: bridging the
 * renderer to an EXTERNALLY-running agent host (`code agent host`) is
 * `--agent-host-bridge-port` + `VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN`
 * (extensions/vscode-test-resolver/src/extension.ts:166-194). The token itself
 * is NEVER persisted here -- only a vault-style reference (`tokenRef`), per
 * SECURITY-MODEL 3.5 (keys referenced, never materialized).
 */
export interface SshConnection {
	readonly host: string;
	readonly port?: number;
	readonly user?: string;
	readonly authMethod: SshAuthMethod;
	readonly remotePath?: string;
	readonly agentHostBridge?: {
		readonly bridgePort: number;
		readonly tokenRef: string;
	};
}

/**
 * Dev-container connection shape, aligned with the in-tree platform contract
 * `IDevContainerAgentHostConfig` (src/vs/platform/agentHost/common/devContainerAgentHost.ts:13-19:
 * connectionId, workspaceFolder, name). `connectionId` is minted at connect
 * time by `IDevContainerAgentHostMainService.connect()` (:40) -- v0 descriptors
 * carry only the stable inputs.
 */
export interface ContainerConnection {
	readonly workspaceFolder: string;
	readonly name: string;
	readonly devcontainerConfig?: string;
}

/**
 * E2B-class cloud sandbox shape. Entitlement-free by construction (DL-8: the
 * in-tree `cloudSandbox*` services are Copilot-entitlement-bound and stay
 * reference-only); Flauz cloud sandboxes are provider extensions. The API key
 * is referenced through the vault, never materialized (SECURITY-MODEL 3.5).
 */
export interface CloudSandboxConnection {
	readonly provider: CloudSandboxProviderId;
	readonly apiKeyRef: string;
	readonly sandboxTemplate: string;
	readonly region?: string;
}

/**
 * In-tree remote authority shape (C-30: the resolver API + in-repo server;
 * C-31: tunnels). `authorityPrefix` is what a resolver registers under --
 * `vscode.workspace.registerRemoteAuthorityResolver(authorityPrefix, resolver)`
 * (src/vscode-dts/vscode.proposed.resolvers.d.ts:456).
 */
export interface WorkspaceRemoteConnection {
	readonly authorityPrefix: string;
	readonly remotePath?: string;
	readonly viaTunnel?: boolean;
}

export type EnvironmentConnection = SshConnection | ContainerConnection | CloudSandboxConnection | WorkspaceRemoteConnection;

/** Trust posture (SECURITY-MODEL 2.1/3.4): inherits workspace trust or declares its own). */
export interface EnvironmentTrust {
	readonly posture: TrustPosture;
	readonly inheritsWorkspaceTrust: boolean;
}

/** Capability flags. `agentHost` = an AHP agent host can run in this environment. */
export interface EnvironmentCapabilities {
	readonly browser: boolean;
	readonly exec: boolean;
	readonly agentHost: boolean;
	readonly terminal: boolean;
}

export interface EnvironmentTiming {
	readonly created: number;
	readonly updatedAt: number;
}

/** A registered environment descriptor -- the persisted unit of the registry. */
export interface EnvironmentDescriptor {
	readonly id: string;
	readonly kind: EnvironmentKind;
	readonly label: string;
	readonly connection: EnvironmentConnection;
	readonly trust: EnvironmentTrust;
	readonly capabilities: EnvironmentCapabilities;
	readonly enabled: boolean;
	readonly timing: EnvironmentTiming;
}

/** The `.flauz/environments.json` envelope. */
export interface EnvironmentsEnvelope {
	readonly $schema: string;
	readonly activeId: string | null;
	readonly environments: readonly EnvironmentDescriptor[];
}

export function isEnvironmentKind(value: unknown): value is EnvironmentKind {
	return typeof value === 'string' && (ENVIRONMENT_KINDS as readonly string[]).includes(value);
}

export function isTrustPosture(value: unknown): value is TrustPosture {
	return typeof value === 'string' && (TRUST_POSTURES as readonly string[]).includes(value);
}

export function isSshAuthMethod(value: unknown): value is SshAuthMethod {
	return typeof value === 'string' && (SSH_AUTH_METHODS as readonly string[]).includes(value);
}

export function isCloudSandboxProviderId(value: unknown): value is CloudSandboxProviderId {
	return typeof value === 'string' && (CLOUD_SANDBOX_PROVIDERS as readonly string[]).includes(value);
}

const ENVIRONMENT_ID_PATTERN = /^env-[a-z0-9][a-z0-9-]{0,47}$/;

export function isEnvironmentId(value: unknown): value is string {
	return typeof value === 'string' && ENVIRONMENT_ID_PATTERN.test(value);
}

/** Vault-style secret reference (`vault:...` / `env:...`) -- SECURITY-MODEL 3.5. */
const SECRET_REF_PATTERN = /^(vault|env):[A-Za-z0-9._\/-]+$/;

export function isSecretRef(value: unknown): value is string {
	return typeof value === 'string' && SECRET_REF_PATTERN.test(value);
}

const AUTHORITY_PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isAuthorityPrefix(value: unknown): value is string {
	return typeof value === 'string' && AUTHORITY_PREFIX_PATTERN.test(value);
}

const HOST_PATTERN = /^[A-Za-z0-9._-]{1,253}$/;

export function isHost(value: unknown): value is string {
	return typeof value === 'string' && HOST_PATTERN.test(value);
}

const ABSOLUTE_POSIX_PATH_PATTERN = /^\/[^\\]*$/;

export function isAbsolutePosixPath(value: unknown): value is string {
	return typeof value === 'string' && ABSOLUTE_POSIX_PATH_PATTERN.test(value) && value.length > 1;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasKey(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/** Keys must be exactly `expected` (no more, no less). */
export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value);
	if (actual.length !== expected.length) {
		return false;
	}
	return expected.every(key => hasKey(value, key));
}

/** Every key must be known (required present, optional allowed, unknown rejected). */
export function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			return false;
		}
	}
	return required.every(key => hasKey(value, key));
}

export function isPort(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65535;
}

export function isPositiveEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

/** Non-empty string at most `max` chars. */
export function isBoundedString(value: unknown, max: number): value is string {
	return isNonEmptyString(value) && value.length <= max;
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` values dropped. Same discipline as the flauz-workspace
 * envelope (DL-9 git-diffability).
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return '[' + value.map(canonicalJson).join(',') + ']';
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
		return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
	}
	throw new Error(`${SCHEMA_ID}: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
}

/** Deep copy with recursively sorted keys (input to the pretty serializer). */
export function deepSorted(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(deepSorted);
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(record).filter(k => record[k] !== undefined).sort()) {
			result[key] = deepSorted(record[key]);
		}
		return result;
	}
	return value;
}

/**
 * Envelope serialization with the git-diffability discipline (DL-9):
 * fully canonical (sorted) key order, 2-space indent, exactly one trailing
 * newline. Logically identical states always serialize to identical bytes.
 */
export function serializeEnvelope(envelope: unknown): string {
	return JSON.stringify(deepSorted(envelope), null, 2) + '\n';
}

/** Structured deep clone (drops `undefined`; key order canonicalized). */
export function clone<T>(value: T): T {
	return JSON.parse(canonicalJson(value)) as T;
}

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Filesystem port consumed by the registry. The extension host wires a
 * node-backed implementation (src/extension.ts); tests wire the same against
 * temp dirs. Keeping this a port is what lets the core typecheck without
 * @types/node and run under plain `node --test` (same discipline as
 * flauz-workspace's FileSystemPort).
 */
export interface FileSystemPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;
